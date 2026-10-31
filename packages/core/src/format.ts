import type { PriceGroup } from './types';
import { locale, t } from './i18n';

const BERLIN = 'Europe/Berlin';
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let f = formatters.get(key) as T | undefined;
  if (!f) {
    f = make();
    formatters.set(key, f);
  }
  return f;
}

/** 450 → "4,50 €" (de) or "€4.50" (en). Amounts are integer cents in EUR. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '–';
  const loc = locale();
  return cached(`eur:${loc}`, () => new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR' })).format(cents / 100);
}

/** Parses "4,50", "4.50" or "4,50 €" into 450. Returns null if it is not a valid amount. */
export function parseEuroToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** 450 → "4,50" for an input field (German decimal comma, also accepted when typing in English). */
export function centsToEuroInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** 450 → "4,50" without currency, for CSV files opened in a German Excel. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Date and time in Europe/Berlin — the mensa's time, whatever the device is set to. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const loc = locale();
  return cached(
    `dt:${loc}`,
    () => new Intl.DateTimeFormat(loc, { timeZone: BERLIN, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  ).format(d);
}

export function formatTime(epochMs: number): string {
  const loc = locale();
  return cached(`t:${loc}`, () => new Intl.DateTimeFormat(loc, { timeZone: BERLIN, hour: '2-digit', minute: '2-digit' })).format(
    new Date(epochMs),
  );
}

/** YYYY-MM-DD of the given instant in Europe/Berlin. */
export function berlinDate(epochMs: number): string {
  const parts = cached('ymd', () => new Intl.DateTimeFormat('en-GB', { timeZone: BERLIN, year: 'numeric', month: '2-digit', day: '2-digit' }))
    .formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** UTC offset of Europe/Berlin at noon on `date`, e.g. "+01:00" or "+02:00". */
export function berlinOffset(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  // Berlin wall-clock hour at 12:00 UTC is 13 (CET) or 14 (CEST).
  const hour = Number(
    cached('h', () => new Intl.DateTimeFormat('en-GB', { timeZone: BERLIN, hour: '2-digit', hourCycle: 'h23' })).format(probe),
  );
  const diff = hour - 12;
  return `${diff >= 0 ? '+' : '-'}${String(Math.abs(diff)).padStart(2, '0')}:00`;
}

/** Start of a Berlin day as ISO 8601 with offset, e.g. 2026-10-31T00:00:00+01:00. */
export function berlinStartOfDay(date: string): string {
  return `${date}T00:00:00${berlinOffset(date)}`;
}

export function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const GROUPS: PriceGroup[] = ['student', 'staff', 'guest'];

export function groupLabel(g: PriceGroup): string {
  return t(`group.${g}`);
}

/** Compares dotted versions: returns true when `version` >= `min`. */
export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
