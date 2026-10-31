import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, retryPolicy, serverNow, setAuthHooks } from './client';

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  });
}

function problem(status: number, code: string, retryable: boolean) {
  return json(status, { code, title: code, status, retryable });
}

const fetchMock = vi.fn();

function headersOf(call: number): Record<string, string> {
  return (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  retryPolicy.baseDelayMs = 1;
  retryPolicy.maxDelayMs = 2;
  setAuthHooks({ getToken: () => 'token-1', relogin: async () => 'token-2', onSessionLost: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthHooks(null);
});

describe('request', () => {
  it('sends candidate, app version and bearer token headers', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    const res = await request<{ ok: boolean }>('/mensas');
    expect(res.data.ok).toBe(true);
    const h = headersOf(0);
    expect(h['X-Candidate-Id']).toBeTruthy();
    expect(h['X-App-Version']).toBeTruthy();
    expect(h.Authorization).toBe('Bearer token-1');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/mensas');
  });

  it('retries a retryable 503 and succeeds', async () => {
    fetchMock.mockResolvedValueOnce(problem(503, 'unavailable', true)).mockResolvedValueOnce(json(200, { n: 1 }));
    const res = await request<{ n: number }>('/config', { auth: false });
    expect(res.data.n).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses the same Idempotency-Key on every retry of a POST', async () => {
    fetchMock
      .mockResolvedValueOnce(problem(504, 'timeout', true))
      .mockResolvedValueOnce(problem(502, 'connection_dropped', true))
      .mockResolvedValueOnce(json(201, { id: 'pay_1' }, { 'Idempotent-Replayed': 'true' }));
    const res = await request<{ id: string }>('/orders/o1/payments', {
      method: 'POST',
      body: { amountCents: 450 },
      idempotencyKey: 'key-abc',
    });
    expect(res.data.id).toBe('pay_1');
    expect(res.replayed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) expect(headersOf(i)['Idempotency-Key']).toBe('key-abc');
  });

  it('flags a lost response as unknown outcome once retries run out', async () => {
    fetchMock.mockImplementation(async () => problem(504, 'timeout', true));
    const err = await request('/orders', { method: 'POST', body: {}, idempotencyKey: 'k', retries: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('timeout');
    expect(err.unknownOutcome).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a network failure as retryable with unknown outcome', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await request('/mensas', { retries: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('network_error');
    expect(err.unknownOutcome).toBe(true);
    expect(err.retryable).toBe(true);
  });

  it('does not retry a non-retryable error and keeps its code', async () => {
    fetchMock.mockImplementation(async () => problem(409, 'order_already_paid', false));
    const err = await request('/orders/o1/payments', { method: 'POST', body: {}, idempotencyKey: 'k' }).catch((e) => e);
    expect(err.code).toBe('order_already_paid');
    expect(err.unknownOutcome).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a state-changing POST that has no Idempotency-Key', async () => {
    fetchMock.mockImplementation(async () => problem(503, 'unavailable', true));
    await request('/orders', { method: 'POST', body: {} }).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logs in again on 401 and repeats the request with the new token and same key', async () => {
    let token = 'old';
    const relogin = vi.fn(async () => {
      token = 'new';
      return token;
    });
    setAuthHooks({ getToken: () => token, relogin, onSessionLost: vi.fn() });
    fetchMock.mockResolvedValueOnce(problem(401, 'session_expired', false)).mockResolvedValueOnce(json(201, { id: 'o1' }));

    const res = await request<{ id: string }>('/orders', { method: 'POST', body: {}, idempotencyKey: 'k1' });
    expect(res.data.id).toBe('o1');
    expect(relogin).toHaveBeenCalledTimes(1);
    expect(headersOf(0).Authorization).toBe('Bearer old');
    expect(headersOf(1).Authorization).toBe('Bearer new');
    expect(headersOf(1)['Idempotency-Key']).toBe('k1');
  });

  it('reports the session as lost when re-login fails', async () => {
    const onSessionLost = vi.fn();
    setAuthHooks({ getToken: () => 't', relogin: async () => null, onSessionLost });
    fetchMock.mockImplementation(async () => problem(401, 'session_expired', false));
    const err = await request('/mensas').catch((e) => e);
    expect(err.status).toBe(401);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('takes the server time from the Date header', async () => {
    const serverTime = Date.now() + 60 * 60 * 1000; // server is an hour ahead
    fetchMock.mockResolvedValueOnce(json(200, {}, { Date: new Date(serverTime).toUTCString() }));
    await request('/config', { auth: false });
    expect(Math.abs(serverNow() - serverTime)).toBeLessThan(2000);
  });

  it('treats a gateway error without a problem body as unknown outcome', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>Bad gateway</html>', { status: 500 }));
    const err = await request('/orders', { method: 'POST', body: {}, idempotencyKey: 'k', retries: 0 }).catch((e) => e);
    expect(err.unknownOutcome).toBe(true);
    expect(err.retryable).toBe(true);
  });
});
