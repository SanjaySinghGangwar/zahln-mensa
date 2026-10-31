// The payer's side of a payment as pure functions, so the rules that keep
// money safe are in one place, tested, and the same on every surface.
//
// Two rules matter most:
//  1. Never send a second payment for the same intent: every retry reuses the
//     stored Idempotency-Key, and a lost response is resolved by *looking*
//     (re-reading the order), never by guessing.
//  2. Never show a result that is not true: "paid" is only shown for our own
//     payment once the server says `confirmed`.

import { isApiError } from './client';
import type { Order, Payment } from './types';

export const SLOW_PENDING_MS = 20_000;

export type PayFailure =
  /** 422 amount_mismatch: the price changed. Drop the key, re-read the order, ask again. */
  | { kind: 'reprice' }
  /** The order already has a payment (ours, maybe from a lost response). Re-read and follow it. */
  | { kind: 'follow' }
  /** Final for this attempt (expired, payments off, app too old). Drop the key and show why. */
  | { kind: 'final' }
  /** We do not know whether the payment was created. Keep the key: retrying with it is safe. */
  | { kind: 'uncertain' }
  /** Rejected before anything happened (4xx). Drop the key. */
  | { kind: 'rejected' };

export function classifyPayFailure(e: unknown): PayFailure {
  if (!isApiError(e)) return { kind: 'uncertain' };
  switch (e.code) {
    case 'amount_mismatch':
      return { kind: 'reprice' };
    case 'order_already_paid':
    case 'order_payment_in_progress':
      return { kind: 'follow' };
    case 'order_expired':
    case 'payments_disabled':
    case 'app_version_unsupported':
      return { kind: 'final' };
    default:
      return e.unknownOutcome || e.retryable ? { kind: 'uncertain' } : { kind: 'rejected' };
  }
}

/** Whether the stored Idempotency-Key must be kept for the next attempt. */
export function keepKeyAfter(failure: PayFailure): boolean {
  return failure.kind === 'uncertain' || failure.kind === 'follow';
}

export type PayScreen =
  | { kind: 'loading' }
  | { kind: 'load-error' }
  | { kind: 'payable'; msLeft: number }
  | { kind: 'checking'; slow: boolean }
  | { kind: 'confirmed'; payment: Payment }
  | { kind: 'declined'; canRetry: boolean }
  | { kind: 'paid' }
  | { kind: 'expired' }
  | { kind: 'busy-other' };

export interface PayInputs {
  order: Order | null;
  orderFailed: boolean;
  /** Our payment for this order, if we created (or may have created) one. */
  paymentId: string | null;
  /** The latest copy of that payment. */
  payment: Payment | null;
  /** Server time. */
  now: number;
}

/** What the payer sees. One function, so every state is covered and testable. */
export function payScreen({ order, orderFailed, paymentId, payment, now }: PayInputs): PayScreen {
  const own = payment && payment.id === paymentId ? payment : null;
  if (own) {
    if (own.status === 'confirmed') return { kind: 'confirmed', payment: own };
    if (own.status === 'declined') {
      const canRetry = !!order && order.status !== 'paid' && order.status !== 'expired' && Date.parse(order.expiresAt) > now;
      return { kind: 'declined', canRetry };
    }
    return { kind: 'checking', slow: now - Date.parse(own.createdAt) > SLOW_PENDING_MS };
  }
  // We started a payment but have not read it yet: never offer "Pay" again.
  if (paymentId) return { kind: 'checking', slow: false };
  if (!order) return orderFailed ? { kind: 'load-error' } : { kind: 'loading' };
  if (order.status === 'paid') return { kind: 'paid' };
  const msLeft = Date.parse(order.expiresAt) - now;
  if (order.status === 'expired' || msLeft <= 0) return { kind: 'expired' };
  if (order.status === 'paying') return { kind: 'busy-other' };
  return { kind: 'payable', msLeft };
}

/** The payment ID to follow from an order read, if the order points at one. */
export function paymentToFollow(order: Order): string | null {
  return order.paymentId && (order.status === 'paying' || order.status === 'paid') ? order.paymentId : null;
}
