import type { DailyTotals, Mensa, Order, Payment, PaymentDetail, Refund } from '@zahln/core';

export const mensa: Mensa = {
  id: 'm1',
  name: 'Mensa am Campus',
  city: 'Augsburg',
  tills: [
    { id: 't1', name: 'Kasse 1' },
    { id: 't2', name: 'Kasse 2' },
  ],
  menu: [
    { id: 'i1', name: { de: 'Nudeln', en: 'Pasta' }, prices: { student: 350, staff: 500, guest: 650 } },
    { id: 'i2', name: { de: 'Salat', en: 'Salad' }, prices: { student: 200, staff: 300, guest: 400 } },
  ],
};

export const mensa2: Mensa = {
  id: 'm2',
  name: 'Mensa Nord',
  city: 'Augsburg',
  tills: [{ id: 't9', name: 'Nord 1' }],
  menu: [],
};

export function makeOrder(patch: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    status: 'open',
    mensa: { id: 'm1', name: 'Mensa am Campus' },
    till: { id: 't1', name: 'Kasse 1' },
    items: [{ itemId: 'i1', name: { de: 'Nudeln', en: 'Pasta' }, quantity: 1, unitPriceCents: 450, unitPrices: mensa.menu[0].prices }],
    qrPayload: 'zahln:order:ord_1',
    priceGroup: 'student',
    amountCents: 450,
    amounts: { student: 350, staff: 500, guest: 650 },
    paymentId: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    version: 1,
    ...patch,
  };
}

export function makePayment(patch: Partial<PaymentDetail> = {}): PaymentDetail {
  return {
    id: 'pay_1',
    orderId: 'ord_1',
    status: 'confirmed',
    amountCents: 450,
    priceGroup: 'student',
    mensa: { id: 'm1', name: 'Mensa am Campus' },
    till: { id: 't1', name: 'Kasse 1' },
    payer: { id: 'u_student', displayName: 'Sam Student' },
    items: [{ itemId: 'i1', name: { de: 'Nudeln', en: 'Pasta' }, quantity: 1, unitPriceCents: 450 }],
    refundedAmountCents: 0,
    pendingRefundAmountCents: 0,
    refundableAmountCents: 450,
    needsAttention: false,
    attentionReasons: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    refunds: [],
    history: [{ at: new Date().toISOString(), type: 'payment_created', amountCents: 450, refundId: null }],
    ...patch,
  };
}

export function listItem(patch: Partial<Payment> = {}): Payment {
  const p: Partial<PaymentDetail> = { ...makePayment() };
  delete p.refunds;
  delete p.history;
  return { ...(p as Payment), ...patch };
}

export function makeRefund(patch: Partial<Refund> = {}): Refund {
  return {
    id: 'ref_1',
    paymentId: 'pay_1',
    amountCents: 100,
    status: 'completed',
    reason: 'cold food',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}

const zero = { paymentCount: 0, grossCents: 0, refundedCents: 0, netCents: 0, pendingCount: 0, pendingCents: 0 };

export function makeTotals(date: string, patch: Partial<DailyTotals> = {}): DailyTotals {
  return {
    date,
    paymentCount: 12,
    grossCents: 5400,
    refundedCents: 300,
    netCents: 5100,
    pendingCount: 1,
    pendingCents: 450,
    mensas: [
      {
        mensa: { id: 'm1', name: 'Mensa am Campus' },
        paymentCount: 12,
        grossCents: 5400,
        refundedCents: 300,
        netCents: 5100,
        pendingCount: 1,
        pendingCents: 450,
        tills: [
          { till: { id: 't1', name: 'Kasse 1' }, ...zero, paymentCount: 12, grossCents: 5400, netCents: 5400 },
          { till: { id: 't2', name: 'Kasse 2' }, ...zero },
        ],
      },
    ],
    ...patch,
  };
}

const day = { paymentCount: 2, grossCents: 900, refundedCents: 100, netCents: 800, pendingCount: 1, pendingCents: 350 };

/** Small, round numbers for CSV assertions. */
export function totals(): DailyTotals {
  return {
    date: '2026-10-31',
    ...day,
    mensas: [{ mensa: { id: 'm1', name: 'Mensa am Campus' }, ...day, tills: [{ till: { id: 't1', name: 'Kasse 1' }, ...day }] }],
  };
}
