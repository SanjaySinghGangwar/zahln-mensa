import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './endpoints';
import { retryPolicy, setAuthHooks } from './client';
import { clearVersionCache } from './versioned';

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function call(i: number) {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  const u = new URL(url);
  return { path: u.pathname, search: u.searchParams, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  retryPolicy.baseDelayMs = 1;
  setAuthHooks({ getToken: () => 'tok', relogin: async () => null, onSessionLost: () => {} });
  clearVersionCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthHooks(null);
});

describe('api endpoints', () => {
  it('logs in without a token', async () => {
    fetchMock.mockImplementation(async () => ok({ accessToken: 'a', expiresAt: '', user: {} }, 201));
    const s = await api.login('student', 'test1234');
    expect(s.accessToken).toBe('a');
    const c = call(0);
    expect(c.path).toBe('/api/sessions');
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ username: 'student', password: 'test1234' });
    expect(c.headers.Authorization).toBeUndefined();
  });

  it('reads config and mensas', async () => {
    fetchMock.mockImplementationOnce(async () => ok({ minAppVersion: '1.0.0', paymentsEnabled: true }));
    expect((await api.config()).paymentsEnabled).toBe(true);
    fetchMock.mockImplementationOnce(async () => ok({ items: [] }));
    expect((await api.mensas()).items).toEqual([]);
    expect(call(1).path).toBe('/api/mensas');
  });

  it('creates orders and pays them with the given Idempotency-Key', async () => {
    fetchMock.mockImplementationOnce(async () => ok({ id: 'o1', version: 1 }, 201));
    const order = await api.createOrder([{ itemId: 'i1', quantity: 2 }], 'k-order');
    expect(order.data.id).toBe('o1');
    expect(call(0).headers['Idempotency-Key']).toBe('k-order');
    expect(call(0).body).toEqual({ items: [{ itemId: 'i1', quantity: 2 }] });

    fetchMock.mockImplementationOnce(async () => ok({ id: 'p1', version: 1 }, 201));
    const pay = await api.payOrder('o/1', 450, 'k-pay');
    expect(pay.data.id).toBe('p1');
    expect(call(1).path).toBe('/api/orders/o%2F1/payments');
    expect(call(1).body).toEqual({ amountCents: 450 });
    expect(call(1).headers['Idempotency-Key']).toBe('k-pay');
  });

  it('applies the version guard to orders and payments', async () => {
    fetchMock.mockImplementationOnce(async () => ok({ id: 'o1', version: 3, status: 'paid' }));
    fetchMock.mockImplementationOnce(async () => ok({ id: 'o1', version: 2, status: 'open' }));
    await api.getOrder('o1');
    expect((await api.getOrder('o1')).status).toBe('paid');

    fetchMock.mockImplementationOnce(async () => ok({ id: 'p1', version: 5, status: 'confirmed', refunds: [], history: [] }));
    fetchMock.mockImplementationOnce(async () => ok({ id: 'p1', version: 4, status: 'pending', refunds: [], history: [] }));
    await api.getPayment('p1');
    expect((await api.getPayment('p1')).status).toBe('confirmed');

    fetchMock.mockImplementationOnce(async () => ok({ items: [{ id: 'p9', version: 2 }], nextCursor: 'c2' }));
    const page = await api.listPayments({ status: 'confirmed', limit: 10 });
    expect(page.nextCursor).toBe('c2');
    expect(call(4).search.get('status')).toBe('confirmed');
  });

  it('refunds and reads daily totals', async () => {
    fetchMock.mockImplementationOnce(async () => ok({ id: 'r1', status: 'pending' }, 201));
    const r = await api.refund('p1', 100, 'reason', 'k-ref');
    expect(r.data.id).toBe('r1');
    expect(call(0).path).toBe('/api/payments/p1/refunds');
    expect(call(0).body).toEqual({ amountCents: 100, reason: 'reason' });

    fetchMock.mockImplementationOnce(async () => ok({ date: '2026-10-31', mensas: [] }));
    await api.dailyTotals('2026-10-31');
    expect(call(1).search.get('date')).toBe('2026-10-31');
  });
});
