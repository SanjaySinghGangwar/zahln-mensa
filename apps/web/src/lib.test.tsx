import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, getLanguage, request, type Session } from '@zahln/core';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { downloadText } from './lib/download';
import { chooseLanguage, initLanguage } from './lib/lang';

function Probe() {
  const { session, sessionLost, login } = useAuth();
  return (
    <div>
      <span data-testid="user">{session?.user.displayName ?? 'none'}</span>
      <span data-testid="lost">{String(sessionLost)}</span>
      <button onClick={() => login('finance', 'pw')}>login</button>
      <button onClick={() => void request('/mensas').catch(() => undefined)}>call</button>
    </div>
  );
}

const session = (name: string, token: string): Session => ({
  accessToken: token,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: { id: 'f', displayName: name, role: 'finance' },
});

const expired = () =>
  new Response(JSON.stringify({ code: 'session_expired', title: 'x', status: 401, retryable: false }), {
    status: 401,
    headers: { 'Content-Type': 'application/problem+json' },
  });

describe('auth', () => {
  it('logs in again once when the token expires and retries the request', async () => {
    const login = vi.spyOn(api, 'login').mockResolvedValueOnce(session('First', 't1')).mockResolvedValueOnce(session('Second', 't2'));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => expired())
      .mockImplementation(async () => new Response('{"items":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('First'));
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('Second'));
    expect(login).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer t2' });
    vi.unstubAllGlobals();
  });

  it('sends the user to the login screen when logging in again fails', async () => {
    sessionStorage.setItem('zahln.session', JSON.stringify(session('Stored', 't0')));
    vi.stubGlobal('fetch', vi.fn(async () => expired()));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('user').textContent).toBe('Stored');
    // After a reload the password is gone, so there is nothing to log in again with.
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(screen.getByTestId('lost').textContent).toBe('true'));
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(sessionStorage.getItem('zahln.session')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('gives up when a fresh login is rejected too', async () => {
    vi.spyOn(api, 'login').mockResolvedValueOnce(session('First', 't1')).mockRejectedValueOnce(new Error('down'));
    vi.stubGlobal('fetch', vi.fn(async () => expired()));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('First'));
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(screen.getByTestId('lost').textContent).toBe('true'));
    vi.unstubAllGlobals();
  });

  it('ignores a broken stored session and needs the provider', () => {
    sessionStorage.setItem('zahln.session', '{nope');
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('user').textContent).toBe('none');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
  });
});

describe('language', () => {
  it('uses the saved choice, then the browser language', () => {
    localStorage.setItem('zahln.lang', 'de');
    initLanguage();
    expect(getLanguage()).toBe('de');
    localStorage.removeItem('zahln.lang');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    initLanguage();
    expect(getLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('works when storage is blocked', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    initLanguage();
    expect(getLanguage()).toBe('de');
    chooseLanguage('en');
    expect(getLanguage()).toBe('en');
  });
});

describe('download', () => {
  it('downloads text as a file and frees the URL', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadText('a.csv', 'x;y');
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers();
  });
});
