import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError, api, setLanguage, type Session } from '@zahln/core';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { listItem, makePayment, makeRefund, makeTotals, mensa, mensa2 } from './test/fixtures';
import { toQuery } from './features/Dashboard';
import * as download from './lib/download';

const fail = (code = 'unavailable', status = 503) => new ApiError({ code, title: code, status, retryable: true, detail: null }, false);

function signIn(role: Session['user']['role'] = 'finance') {
  const s: Session = {
    accessToken: 't',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: `u_${role}`, displayName: 'Fiona Finance', role },
  };
  sessionStorage.setItem('zahln.session', JSON.stringify(s));
}

function renderApp() {
  return render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
}

let downloads: { name: string; content: string }[];

beforeEach(() => {
  downloads = [];
  vi.spyOn(download, 'downloadText').mockImplementation((name, content) => void downloads.push({ name, content }));
  vi.spyOn(api, 'mensas').mockResolvedValue({ items: [mensa, mensa2] });
  vi.spyOn(api, 'dailyTotals').mockImplementation(async (date) => makeTotals(date ?? '2026-10-31'));
  vi.spyOn(api, 'listPayments').mockResolvedValue({ items: [listItem()], nextCursor: null });
  vi.spyOn(api, 'getPayment').mockResolvedValue(makePayment({ refunds: [makeRefund()] }));
});

afterEach(() => vi.useRealTimers());

describe('login', () => {
  it('lets finance in and turns other roles away', async () => {
    const login = vi.spyOn(api, 'login').mockResolvedValueOnce({
      accessToken: 't',
      expiresAt: new Date().toISOString(),
      user: { id: 'u1', displayName: 'Sam', role: 'cashier' },
    });
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/cannot use this app/));
    expect(login).toHaveBeenCalledWith('finance', 'test1234');

    login.mockRejectedValueOnce(new ApiError({ code: 'invalid_credentials', title: '', status: 401, retryable: false }, false));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong username or password.')).toBeTruthy();

    login.mockResolvedValueOnce({ accessToken: 't', expiresAt: new Date().toISOString(), user: { id: 'f', displayName: 'Fiona', role: 'finance' } });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: ' finance ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('switches the whole UI to German', async () => {
    signIn();
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Deutsch' }));
    expect(await screen.findByRole('heading', { name: 'Finanzen' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem('zahln.lang')).toBe('de');
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('heading', { name: 'Finance' })).toBeTruthy();
  });
});

describe('daily totals', () => {
  it('shows totals per mensa, expands tills and exports the day', async () => {
    signIn();
    renderApp();
    expect(await screen.findByText('All mensas')).toBeTruthy();
    expect(screen.queryByText('Kasse 2')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show tills of Mensa am Campus' }));
    expect(screen.getByText('Kasse 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide tills of Mensa am Campus' }));
    expect(screen.queryByText('Kasse 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Till/, pressed: false }));
    expect(screen.getByText('Kasse 2')).toBeTruthy();

    expect(screen.getByText(/Pending payments are not included/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Export day as CSV/ }));
    expect(downloads[0].name).toMatch(/^zahln-tagessummen-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(downloads[0].content).toContain(';till;Mensa am Campus;Kasse 2;');

    fireEvent.change(screen.getByLabelText('Day (Europe/Berlin)'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(api.dailyTotals).toHaveBeenLastCalledWith('2026-10-01', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(api.dailyTotals).toHaveBeenCalledTimes(3));
  });

  it('keeps the saved totals when the server fails, and offers a retry without them', async () => {
    signIn();
    vi.mocked(api.dailyTotals).mockRejectedValue(fail());
    renderApp();
    expect(await screen.findByText('The server is busy right now. Please try again.')).toBeTruthy();

    vi.mocked(api.dailyTotals).mockImplementation(async (d) => makeTotals(d ?? '2026-10-31'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('All mensas')).toBeTruthy();

    vi.mocked(api.dailyTotals).mockRejectedValue(fail());
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(await screen.findByText(/Offline copy from/)).toBeTruthy();
    expect(screen.getByText('All mensas')).toBeTruthy();
  });
});

describe('needs attention', () => {
  it('lists flagged payments and opens their history', async () => {
    signIn();
    vi.mocked(api.listPayments).mockResolvedValue({
      items: [listItem({ needsAttention: true, attentionReasons: ['refund_failed'], pendingRefundAmountCents: 100, refundedAmountCents: 50 })],
      nextCursor: null,
    });
    vi.mocked(api.getPayment).mockResolvedValue(
      makePayment({ needsAttention: true, attentionReasons: ['refund_failed'], refunds: [makeRefund({ status: 'failed', reason: null })] }),
    );
    renderApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Needs attention' }));
    expect(window.location.search).toBe('?tab=attention');
    expect(await screen.findByText('Refund failed')).toBeTruthy();
    expect(api.listPayments).toHaveBeenCalledWith(expect.objectContaining({ needsAttention: true }), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'pay_1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Payment' });
    expect(await within(dialog).findByText('Needs attention: Refund failed')).toBeTruthy();
    expect(within(dialog).getByText('No reason')).toBeTruthy();
    expect(within(dialog).getByText('Payment started')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when nothing needs attention', async () => {
    signIn();
    vi.mocked(api.listPayments).mockResolvedValue({ items: [], nextCursor: null });
    window.history.replaceState(null, '', '/?tab=attention');
    renderApp();
    expect(await screen.findByText(/Nothing needs attention/)).toBeTruthy();
  });
});

describe('payment search', () => {
  it('filters, pages, and exports every matching payment as CSV', async () => {
    signIn();
    vi.mocked(api.listPayments).mockImplementation(async (q) =>
      q.cursor === 'c2'
        ? { items: [listItem({ id: 'pay_2' }), listItem({ id: 'pay_1' })], nextCursor: null }
        : { items: [listItem({ status: 'pending', refundedAmountCents: 0 })], nextCursor: 'c2' },
    );
    window.history.replaceState(null, '', '/?tab=payments');
    renderApp();
    expect(await screen.findByText(/1 shown · more available/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Load more/ }));
    expect(await screen.findByText('2 shown')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(await screen.findByText('2 payments exported.')).toBeTruthy();
    expect(downloads[0].content.split('\r\n').filter(Boolean)).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Mensa'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByLabelText('Till'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'confirmed' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    fireEvent.click(screen.getByLabelText('Needs attention only'));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'pay_' } });
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mensaId: 'm1',
          tillId: 't2',
          status: 'confirmed',
          needsAttention: true,
          q: 'pay_',
          from: '2026-10-01T00:00:00+02:00',
          to: '2026-11-01T00:00:00+01:00',
        }),
        expect.anything(),
      ),
    );
    // A finished export belongs to the previous filter.
    expect(screen.queryByText('2 payments exported.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect((screen.getByLabelText('Mensa') as HTMLSelectElement).value).toBe(''));
  });

  it('reports capped, failed and cancelled exports', async () => {
    signIn();
    window.history.replaceState(null, '', '/?tab=payments');
    renderApp();
    await screen.findByText('1 shown');

    let page = 0;
    vi.mocked(api.listPayments).mockImplementation(async () => {
      page++;
      return { items: Array.from({ length: 200 }, (_, i) => listItem({ id: `p${page}_${i}` })), nextCursor: `n${page}` };
    });
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(await screen.findByText(/Only the first 10000 payments/, {}, { timeout: 5000 })).toBeTruthy();

    vi.mocked(api.listPayments).mockRejectedValue(fail('timeout', 504));
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(await screen.findByText(/The export stopped: The server did not answer in time/)).toBeTruthy();

    vi.mocked(api.listPayments).mockImplementation(
      (_q, signal) =>
        new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' })))),
    );
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Export CSV/ })).toBeTruthy());
    expect(downloads).toHaveLength(1);
  });

  it('shows the saved first page when the server fails, and errors otherwise', async () => {
    signIn();
    window.history.replaceState(null, '', '/?tab=payments');
    const { unmount } = renderApp();
    await screen.findByText('1 shown');
    unmount();

    vi.mocked(api.listPayments).mockRejectedValue(fail());
    renderApp();
    expect(await screen.findByText(/Offline copy from/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'declined' } });
    expect(await screen.findByText('The server is busy right now. Please try again.')).toBeTruthy();
    vi.mocked(api.listPayments).mockResolvedValue({ items: [], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No payments found.')).toBeTruthy();
  });
});

describe('payment detail', () => {
  it('polls a pending payment until it is final and keeps the last state on errors', async () => {
    signIn();
    let n = 0;
    vi.mocked(api.getPayment).mockImplementation(async () => {
      n++;
      if (n === 1) return makePayment({ status: 'pending', version: 1, pendingRefundAmountCents: 0 });
      if (n === 2) throw fail();
      return makePayment({ status: 'confirmed', version: 2, refundedAmountCents: 100, pendingRefundAmountCents: 50 });
    });
    window.history.replaceState(null, '', '/?tab=payments&payment=pay_1');
    renderApp();
    const dialog = await screen.findByRole('dialog', { name: 'Payment' });
    expect(await within(dialog).findByText(/Still being checked/)).toBeTruthy();
    expect(await within(dialog).findByText(/Connection problems/, {}, { timeout: 5000 })).toBeTruthy();
    expect(await within(dialog).findByText('(+€0.50 pending)', {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(window.location.search).toBe('?tab=payments');
  });

  it('shows an error when the payment cannot be loaded at all', async () => {
    signIn();
    vi.mocked(api.getPayment).mockRejectedValue(new ApiError({ code: 'not_found', title: '', status: 404, retryable: false }, false));
    window.history.replaceState(null, '', '/?payment=pay_x');
    renderApp();
    expect(await screen.findByText('Not found.')).toBeTruthy();
  });
});

describe('app shell', () => {
  it('goes home from the logo and shows an offline banner', async () => {
    signIn();
    window.history.replaceState(null, '', '/?tab=payments');
    renderApp();
    fireEvent.click(screen.getByRole('link', { name: /home/ }));
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('link', { name: /home/ }));
    expect(await screen.findByText('All mensas')).toBeTruthy();

    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/You are offline/)).toBeTruthy();
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });

  it('ignores a stored session of a non-finance user', () => {
    signIn('cashier');
    renderApp();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('maps filters to API queries in Berlin time', () => {
    expect(toQuery({ mensaId: '', tillId: '', status: '', from: '', to: '', needsAttention: false, q: '  ' })).toEqual({
      mensaId: undefined,
      tillId: undefined,
      status: undefined,
      needsAttention: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('renders German labels for statuses', async () => {
    signIn();
    setLanguage('de');
    window.history.replaceState(null, '', '/?tab=payments');
    renderApp();
    expect(await screen.findByText('Bestätigt')).toBeTruthy();
  });
});
