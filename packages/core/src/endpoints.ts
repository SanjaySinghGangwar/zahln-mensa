import { request } from './client';
import { newest } from './versioned';
import type {
  AppConfig,
  DailyTotals,
  MensaList,
  Order,
  OrderLineInput,
  Payment,
  PaymentDetail,
  PaymentPage,
  PaymentStatus,
  Refund,
  Session,
} from './types';

export interface PaymentQuery {
  mensaId?: string;
  tillId?: string;
  status?: PaymentStatus;
  from?: string;
  to?: string;
  needsAttention?: boolean;
  q?: string;
  limit?: number;
  cursor?: string;
}

const enc = encodeURIComponent;

export const api = {
  login: async (username: string, password: string) =>
    (await request<Session>('/sessions', { method: 'POST', body: { username, password }, auth: false })).data,

  config: async (signal?: AbortSignal) => (await request<AppConfig>('/config', { auth: false, signal })).data,

  mensas: async (signal?: AbortSignal) => (await request<MensaList>('/mensas', { signal })).data,

  createOrder: async (items: OrderLineInput[], idempotencyKey: string) => {
    const res = await request<Order>('/orders', { method: 'POST', body: { items }, idempotencyKey });
    return { ...res, data: newest('order', res.data) };
  },

  /** Polled by the till and the payer, so a single retry is enough: the next poll retries anyway. */
  getOrder: async (orderId: string, signal?: AbortSignal) =>
    newest('order', (await request<Order>(`/orders/${enc(orderId)}`, { signal, retries: 1 })).data),

  payOrder: async (orderId: string, amountCents: number, idempotencyKey: string) => {
    const res = await request<Payment>(`/orders/${enc(orderId)}/payments`, {
      method: 'POST',
      body: { amountCents },
      idempotencyKey,
    });
    return { ...res, data: newest('payment', res.data) };
  },

  listPayments: async (query: PaymentQuery, signal?: AbortSignal) => {
    const page = (await request<PaymentPage>('/payments', { query: { ...query }, signal })).data;
    return { ...page, items: page.items.map((p) => newest('payment', p)) };
  },

  getPayment: async (paymentId: string, signal?: AbortSignal) =>
    newest('payment-detail', (await request<PaymentDetail>(`/payments/${enc(paymentId)}`, { signal, retries: 1 })).data),

  refund: async (paymentId: string, amountCents: number, reason: string | null, idempotencyKey: string) =>
    request<Refund>(`/payments/${enc(paymentId)}/refunds`, {
      method: 'POST',
      body: { amountCents, reason },
      idempotencyKey,
    }),

  dailyTotals: async (date: string | undefined, signal?: AbortSignal) =>
    (await request<DailyTotals>('/reports/daily-totals', { query: { date }, signal })).data,
};

/**
 * Reads every page for a filter (for the CSV export). Stops at `max` rows so a
 * huge export cannot freeze the browser; the caller tells the user it was capped.
 */
export async function fetchAllPayments(
  query: PaymentQuery,
  opts: { max?: number; pageSize?: number; signal?: AbortSignal; onProgress?: (count: number) => void } = {},
): Promise<{ items: Payment[]; capped: boolean }> {
  const max = opts.max ?? 10_000;
  const items: Payment[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.listPayments({ ...query, limit: opts.pageSize ?? 200, cursor }, opts.signal);
    for (const p of page.items) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      items.push(p);
    }
    opts.onProgress?.(items.length);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && items.length < max);
  return { items: items.slice(0, max), capped: !!cursor || items.length > max };
}
