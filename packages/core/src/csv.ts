// CSV for the finance team. German Excel expects `;` as separator and a
// decimal comma, and needs a BOM to read UTF-8 (umlauts in mensa names).

import { centsToDecimal } from './format';
import type { DailyTotals, Payment, Totals } from './types';

export const CSV_BOM = '﻿';

/**
 * Quotes a cell when needed and defuses formula injection: a payer name like
 * `=HYPERLINK(...)` must not run as a formula when the file is opened.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export const PAYMENT_CSV_HEADER = [
  'payment_id',
  'order_id',
  'created_at',
  'mensa',
  'till',
  'payer_id',
  'payer_name',
  'price_group',
  'status',
  'amount_eur',
  'refunded_eur',
  'pending_refund_eur',
  'refundable_eur',
  'needs_attention',
  'attention_reasons',
  'items',
];

export function paymentCsvRow(p: Payment): (string | number)[] {
  return [
    p.id,
    p.orderId,
    p.createdAt,
    p.mensa.name,
    p.till.name,
    p.payer.id,
    p.payer.displayName,
    p.priceGroup,
    p.status,
    centsToDecimal(p.amountCents),
    centsToDecimal(p.refundedAmountCents),
    centsToDecimal(p.pendingRefundAmountCents),
    centsToDecimal(p.refundableAmountCents),
    p.needsAttention ? 'yes' : 'no',
    p.attentionReasons.join(' '),
    p.items.map((i) => `${i.quantity}x ${i.name.de}`).join(', '),
  ];
}

export function paymentsToCsv(payments: Payment[]): string {
  return toCsv([PAYMENT_CSV_HEADER, ...payments.map(paymentCsvRow)]);
}

function totalsCells(t: Totals): string[] {
  return [
    String(t.paymentCount),
    centsToDecimal(t.grossCents),
    centsToDecimal(t.refundedCents),
    centsToDecimal(t.netCents),
    String(t.pendingCount),
    centsToDecimal(t.pendingCents),
  ];
}

/** One row per till, one per mensa and one for the whole day. */
export function dailyTotalsToCsv(d: DailyTotals): string {
  const header = ['date', 'level', 'mensa', 'till', 'payments', 'gross_eur', 'refunded_eur', 'net_eur', 'pending_count', 'pending_eur'];
  const rows: string[][] = [header];
  for (const m of d.mensas) {
    rows.push([d.date, 'mensa', m.mensa.name, '', ...totalsCells(m)]);
    for (const tl of m.tills) rows.push([d.date, 'till', m.mensa.name, tl.till.name, ...totalsCells(tl)]);
  }
  rows.push([d.date, 'total', '', '', ...totalsCells(d)]);
  return toCsv(rows);
}
