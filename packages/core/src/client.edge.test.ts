import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isAbort, isApiError, request, retryPolicy, serverNow, setAuthHooks, sleep } from './client';

const fetchMock = vi.fn();

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

/** A fetch that only settles when its signal is aborted. */
function hangingFetch(_url: string, init: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  retryPolicy.baseDelayMs = 1;
  retryPolicy.maxDelayMs = 2;
  retryPolicy.requestTimeoutMs = 15_000;
  setAuthHooks(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthHooks(null);
});

describe('helpers', () => {
  it('recognises aborts and api errors', () => {
    expect(isAbort(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbort(new Error('x'))).toBe(false);
    expect(isApiError(new Error('x'))).toBe(false);
  });

  it('builds the error message from detail, title or code', () => {
    expect(new ApiError({ code: 'c', title: 't', status: 400, retryable: false, detail: 'd' }, false).message).toBe('d');
    expect(new ApiError({ code: 'c', title: 't', status: 400, retryable: false }, false).message).toBe('t');
    expect(new ApiError({ code: 'c', title: '', status: 400, retryable: false }, false).message).toBe('c');
  });

  it('sleep resolves, and rejects when aborted before or during the wait', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
    const pre = new AbortController();
    pre.abort();
    await expect(sleep(1000, pre.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const during = new AbortController();
    const p = sleep(1000, during.signal);
    during.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const ok = new AbortController();
    await expect(sleep(1, ok.signal)).resolves.toBeUndefined();
  });
});

describe('request edge cases', () => {
  it('builds the query string and skips empty values', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    await request('/payments', { query: { status: 'confirmed', limit: 5, needsAttention: true, q: '', a: undefined, b: null } });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/payments');
    expect(url.searchParams.get('status')).toBe('confirmed');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('needsAttention')).toBe('true');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('a')).toBe(false);
    expect(url.searchParams.has('b')).toBe(false);
  });

  it('sends no Authorization header without a token and handles an empty body', async () => {
    fetchMock.mockImplementation(async () => json(204, undefined));
    const res = await request('/x');
    expect(res.data).toBeUndefined();
    expect(res.replayed).toBe(false);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('times out a hanging request as unknown outcome', async () => {
    retryPolicy.requestTimeoutMs = 10;
    fetchMock.mockImplementation(hangingFetch);
    const err = await request('/x', { retries: 0 }).catch((e) => e);
    expect(err.code).toBe('client_timeout');
    expect(err.unknownOutcome).toBe(true);
    expect(err.message).toMatch(/too long/);
  });

  it('turns a caller abort into an AbortError without retrying', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const controller = new AbortController();
    const p = request('/x', { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a success whose body never arrives as a dropped connection', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.reject(new TypeError('body stream broke')),
    }));
    const err = await request('/x', { retries: 0 }).catch((e) => e);
    expect(err.code).toBe('connection_dropped');
    expect(err.unknownOutcome).toBe(true);
  });

  it('reports an abort that happens while reading the body as an abort', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => {
        controller.abort();
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      },
    }));
    await expect(request('/x', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fills in missing problem fields', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ code: 'weird' }), { status: 503, statusText: 'Service Unavailable' }));
    const err = await request('/x', { retries: 0 }).catch((e) => e);
    expect(err.code).toBe('weird');
    expect(err.problem.title).toBe('Service Unavailable');
    expect(err.status).toBe(503);
    expect(err.retryable).toBe(true);
    expect(err.problem.detail).toBeNull();
    expect(err.unknownOutcome).toBe(false);
  });

  it('uses the problem fields the server sent', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ code: 'c', title: 'T', status: 418, retryable: false, detail: 'D' }), { status: 400 }),
    );
    const err = await request('/x').catch((e) => e);
    expect(err.status).toBe(418);
    expect(err.problem.detail).toBe('D');
  });

  it('handles an error body that is JSON but not a problem', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ hello: 1 }), { status: 400 }));
    const err = await request('/x').catch((e) => e);
    expect(err.code).toBe('http_400');
    expect(err.retryable).toBe(false);
    expect(err.problem.title).toBe('Request failed');
  });

  it('rethrows unexpected (non-API) errors without retrying', async () => {
    // A programming error (not an API failure) must surface as-is.
    const boom = new Error('bug');
    const bad = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => { throw boom; } }, text: async () => '{}' }));
    fetchMock.mockImplementation(bad);
    await expect(request('/x')).rejects.toBe(boom);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('ignores an unreadable Date header', async () => {
    const before = serverNow() - Date.now();
    fetchMock.mockImplementation(async () => json(200, {}, { Date: 'not a date' }));
    await request('/x');
    expect(Math.abs(serverNow() - Date.now() - before)).toBeLessThan(1000);
  });

  it('does not re-login for endpoints without auth, or without hooks', async () => {
    fetchMock.mockImplementation(async () => json(401, { code: 'invalid_credentials', title: 't', status: 401, retryable: false }));
    const relogin = vi.fn(async () => 'x');
    setAuthHooks({ getToken: () => null, relogin, onSessionLost: vi.fn() });
    await expect(request('/sessions', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(relogin).not.toHaveBeenCalled();

    setAuthHooks(null);
    await expect(request('/mensas')).rejects.toMatchObject({ status: 401 });
  });

  it('gives up when the request still gets 401 after logging in again', async () => {
    const onSessionLost = vi.fn();
    setAuthHooks({ getToken: () => 't', relogin: async () => 't2', onSessionLost });
    fetchMock.mockImplementation(async () => json(401, { code: 'session_expired', title: 't', status: 401, retryable: false }));
    await expect(request('/mensas')).rejects.toMatchObject({ code: 'session_expired' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('retries login (a POST without key) because it is safe', async () => {
    fetchMock
      .mockImplementationOnce(async () => json(503, { code: 'unavailable', title: 't', status: 503, retryable: true }))
      .mockImplementationOnce(async () => json(201, { accessToken: 'a' }));
    const res = await request<{ accessToken: string }>('/sessions', { method: 'POST', body: {}, auth: false });
    expect(res.data.accessToken).toBe('a');
  });
});
