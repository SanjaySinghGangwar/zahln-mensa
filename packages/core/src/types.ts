// Types mirror the Zahln Mensa API (openapi.json). Amounts are integer cents.

export type PriceGroup = 'student' | 'staff' | 'guest';
export type Role = PriceGroup | 'cashier' | 'finance';

export interface LocalizedText {
  de: string;
  en: string;
}

export interface Prices {
  student: number;
  staff: number;
  guest: number;
}

export interface Ref {
  id: string;
  name: string;
}

export interface User {
  id: string;
  displayName: string;
  role: Role;
  priceGroup?: PriceGroup | null;
  tillId?: string | null;
  mensaId?: string | null;
}

export interface Session {
  accessToken: string;
  tokenType?: string;
  expiresAt: string;
  user: User;
}

export interface AppConfig {
  minAppVersion: string;
  paymentsEnabled: boolean;
}

export interface Till {
  id: string;
  name: string;
}

export interface MenuItem {
  id: string;
  name: LocalizedText;
  prices: Prices;
}

export interface Mensa {
  id: string;
  name: string;
  city: string;
  tills: Till[];
  menu: MenuItem[];
}

export interface MensaList {
  items: Mensa[];
}

export type OrderStatus = 'open' | 'paying' | 'paid' | 'expired';

export interface OrderLine {
  itemId: string;
  name: LocalizedText;
  quantity: number;
  unitPrices?: Prices | null;
  unitPriceCents?: number | null;
}

export interface OrderLineInput {
  itemId: string;
  quantity: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  mensa: Ref;
  till: Ref;
  items: OrderLine[];
  qrPayload: string;
  currency?: string;
  amounts?: Prices | null;
  priceGroup?: PriceGroup | null;
  amountCents?: number | null;
  paymentId?: string | null;
  createdAt: string;
  expiresAt: string;
  version: number;
}

export type PaymentStatus = 'pending' | 'confirmed' | 'declined';
export type AttentionReason = 'pending_too_long' | 'refund_pending_too_long' | 'refund_failed';

export interface Payer {
  id: string;
  displayName: string;
}

export interface PaymentItem {
  itemId: string;
  name: LocalizedText;
  quantity: number;
  unitPriceCents: number;
}

export interface Payment {
  id: string;
  orderId: string;
  status: PaymentStatus;
  amountCents: number;
  currency?: string;
  priceGroup: PriceGroup;
  mensa: Ref;
  till: Ref;
  payer: Payer;
  items: PaymentItem[];
  refundedAmountCents: number;
  pendingRefundAmountCents: number;
  refundableAmountCents: number;
  needsAttention: boolean;
  attentionReasons: AttentionReason[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type RefundStatus = 'pending' | 'completed' | 'failed';

export interface Refund {
  id: string;
  paymentId: string;
  amountCents: number;
  currency?: string;
  status: RefundStatus;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentEventType =
  | 'payment_created'
  | 'payment_confirmed'
  | 'payment_declined'
  | 'refund_requested'
  | 'refund_completed'
  | 'refund_failed';

export interface PaymentEvent {
  at: string;
  type: PaymentEventType;
  amountCents?: number | null;
  refundId?: string | null;
}

export interface PaymentDetail extends Payment {
  refunds: Refund[];
  history: PaymentEvent[];
}

export interface PaymentPage {
  items: Payment[];
  nextCursor: string | null;
}

export interface Totals {
  paymentCount: number;
  grossCents: number;
  refundedCents: number;
  netCents: number;
  pendingCount: number;
  pendingCents: number;
}

export interface TillTotals extends Totals {
  till: Ref;
}

export interface MensaTotals extends Totals {
  mensa: Ref;
  tills: TillTotals[];
}

export interface DailyTotals extends Totals {
  date: string;
  currency?: string;
  mensas: MensaTotals[];
}

export interface Problem {
  code: string;
  title: string;
  status: number;
  retryable: boolean;
  detail?: string | null;
}
