import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, abortError, buildUrl, isAbort } from './client';
import { configureCore, coreConfig, memoryStorage, webStorage } from './config';
import { clearCache, readCache, removeCache, setCacheScope, writeCache } from './cache';
import { describeError } from './errors';
import {
  berlinDate,
  berlinStartOfDay,
  centsToDecimal,
  centsToEuroInput,
  formatCents,
  formatCountdown,
  formatDateTime,
  formatTime,
  groupLabel,
  nextDate,
  parseEuroToCents,
  versionAtLeast,
} from './format';
import { clearIntent, intentKey, loadIntent, updateIntent } from './idempotency';
import { getLanguage, languageFromLocale, locale, localized, setLanguage, subscribeLanguage, t } from './i18n';
import { de } from './i18n/de';
import { en } from './i18n/en';
import { parseOrderPayload } from './order';
import { classifyPayFailure, keepKeyAfter, payScreen, paymentToFollow, SLOW_PENDING_MS } from './payFlow';
import { clearVersionCache, newest, pickNewer } from './versioned';
import { csvCell, dailyTotalsToCsv, paymentsToCsv, toCsv } from './csv';
import { makeOrder, makePayment, totals } from './test/fixtures';

const apiError = (code: string, opts: { status?: number; retryable?: boolean; unknown?: boolean; detail?: string; title?: string } = {}) =>
  new ApiError(
    { code, title: opts.title ?? '', status: opts.status ?? 400, retryable: opts.retryable ?? false, detail: opts.detail ?? null },
    opts.unknown ?? false,
  );

describe('i18n', () => {
  it('has a German text for every English key', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const v of Object.values(de)) expect(v.length).toBeGreaterThan(0);
  });

  it('keeps the same placeholders in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(vars(de[key]), key).toBe(vars(en[key]));
  });

  it('switches language, notifies listeners and fills placeholders', () => {
    const listener = vi.fn();
    const off = subscribeLanguage(listener);
    setLanguage('de');
    setLanguage('de'); // no change, no event
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLanguage()).toBe('de');
    expect(locale()).toBe('de-DE');
    expect(t('pay.payButton', { amount: '4,50 €' })).toBe('4,50 € bezahlen');
    expect(t('pay.payButton')).toBe('{amount} bezahlen');
    expect(t('pay.payButton', { other: 1 })).toBe('{amount} bezahlen');
    off();
    setLanguage('en');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(locale()).toBe('en-GB');
  });

  it('picks German for German locales only', () => {
    expect(languageFromLocale('de-AT')).toBe('de');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale(null)).toBe('en');
  });

  it('shows server text in the current language with fallback', () => {
    expect(localized({ de: 'Nudeln', en: 'Pasta' })).toBe('Pasta');
    expect(localized({ de: 'Nudeln', en: '' })).toBe('Nudeln');
    setLanguage('de');
    expect(localized({ de: 'Nudeln', en: 'Pasta' })).toBe('Nudeln');
    expect(localized({ de: '', en: 'Pasta' })).toBe('Pasta');
    expect(localized(null)).toBe('');
  });
});

describe('format', () => {
  it('formats euros per language', () => {
    expect(formatCents(450)).toBe('€4.50');
    setLanguage('de');
    expect(formatCents(450).replace(/\s/g, ' ')).toBe('4,50 €');
    expect(formatCents(null)).toBe('–');
    expect(formatCents(undefined)).toBe('–');
  });

  it('parses amounts without float errors', () => {
    expect(parseEuroToCents('4,50')).toBe(450);
    expect(parseEuroToCents('0.29')).toBe(29);
    expect(parseEuroToCents(' 12 € ')).toBe(1200);
    expect(parseEuroToCents('1,234')).toBeNull();
    expect(parseEuroToCents('abc')).toBeNull();
    expect(centsToEuroInput(450)).toBe('4,50');
    expect(centsToDecimal(1205)).toBe('12,05');
    expect(centsToDecimal(-7)).toBe('-0,07');
  });

  it('uses Berlin time whatever the device zone, including daylight saving', () => {
    expect(berlinStartOfDay('2026-10-31')).toBe('2026-10-31T00:00:00+01:00');
    expect(berlinStartOfDay('2026-07-01')).toBe('2026-07-01T00:00:00+02:00');
    expect(berlinDate(Date.parse('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(formatDateTime('2026-10-31T11:00:00Z')).toMatch(/31\/10\/2026.*12:00:00/);
    expect(formatDateTime('nope')).toBe('nope');
    expect(formatTime(Date.parse('2026-07-01T10:05:00Z'))).toBe('12:05');
  });

  it('formats countdowns, groups and compares versions', () => {
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(groupLabel('staff')).toBe('Staff');
    expect(versionAtLeast('1.0.0', '1.0.0')).toBe(true);
    expect(versionAtLeast('1.0.0', '1.2')).toBe(false);
    expect(versionAtLeast('2.0', '1.9.9')).toBe(true);
    expect(versionAtLeast('1.0', '1.0.0')).toBe(true);
  });
});

describe('errors', () => {
  it('maps known codes in the current language and flags unknown outcomes', () => {
    expect(describeError(apiError('order_expired'))).toMatch(/expired/);
    expect(describeError(apiError('timeout', { unknown: true }))).toMatch(/could not confirm/);
    setLanguage('de');
    expect(describeError(apiError('order_expired'))).toMatch(/abgelaufen/);
  });

  it('falls back to detail, title, then a generic text', () => {
    expect(describeError(apiError('new_code', { detail: 'From server' }))).toBe('From server');
    expect(describeError(apiError('new_code', { title: 'Title' }))).toBe('Title');
    expect(describeError(apiError('new_code'))).toBe('Something went wrong.');
    expect(describeError(new Error('plain'))).toBe('plain');
    expect(describeError(new Error(''))).toBe('Something went wrong.');
    expect(describeError('?')).toBe('Something went wrong.');
  });
});

describe('client helpers', () => {
  it('recognises aborts without DOMException (React Native)', () => {
    expect(isAbort(abortError())).toBe(true);
    expect(isAbort(new Error('x'))).toBe(false);
    expect(isAbort(null)).toBe(false);
  });

  it('builds URLs without window.location', () => {
    configureCore({ apiBase: 'https://dev.zahln.de/' });
    expect(buildUrl('/payments', { q: 'a b', limit: 5, x: undefined, y: null, z: '' })).toBe('https://dev.zahln.de/payments?q=a%20b&limit=5');
    expect(buildUrl('/config')).toBe('https://dev.zahln.de/config');
  });
});

describe('storage adapters', () => {
  it('memory storage behaves like a key-value store', () => {
    const s = memoryStorage();
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
    expect(s.getItem('b')).toBeNull();
    expect(s.keys()).toEqual(['a']);
    s.removeItem('a');
    expect(s.keys()).toEqual([]);
  });

  it('wraps Web Storage', () => {
    const backing = new Map<string, string>();
    const web = {
      get length() {
        return backing.size;
      },
      key: (i: number) => Array.from(backing.keys())[i] ?? null,
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
    } as Storage;
    const s = webStorage(web);
    s.setItem('x', 'y');
    expect(s.getItem('x')).toBe('y');
    expect(s.keys()).toEqual(['x']);
    s.removeItem('x');
    expect(s.getItem('x')).toBeNull();
  });

  it('refuses to make keys without a secure random source', () => {
    const gen = coreConfig.randomId;
    vi.stubGlobal('crypto', undefined);
    expect(() => gen()).toThrow(/secure random/);
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(171) });
    expect(gen()).toBe('ab'.repeat(16));
    vi.unstubAllGlobals();
    expect(gen()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('idempotency keys', () => {
  it('keeps one key per intent until it is cleared', () => {
    const k1 = intentKey('pay:u:o1', '450');
    expect(intentKey('pay:u:o1', '450')).toBe(k1);
    clearIntent('pay:u:o1');
    expect(intentKey('pay:u:o1', '450')).not.toBe(k1);
  });

  it('creates a new key when the body changes and remembers the payment', () => {
    const k1 = intentKey('pay:u:o1', '450');
    expect(intentKey('pay:u:o1', '500')).not.toBe(k1);
    updateIntent('pay:u:o1', { paymentId: 'pay_9' });
    expect(loadIntent('pay:u:o1')?.paymentId).toBe('pay_9');
    updateIntent('missing', { paymentId: 'p' });
    expect(loadIntent('missing')).toBeNull();
  });

  it('forgets keys older than the server keeps them, and survives broken storage', () => {
    coreConfig.storage.setItem('zahln.intent.s', JSON.stringify({ key: 'old', fingerprint: 'f', createdAt: Date.now() - 25 * 3600e3 }));
    expect(loadIntent('s')).toBeNull();
    expect(coreConfig.storage.getItem('zahln.intent.s')).toBeNull();
    coreConfig.storage.setItem('zahln.intent.s', '{not json');
    expect(loadIntent('s')).toBeNull();

    const broken = memoryStorage();
    broken.setItem = () => {
      throw new Error('quota');
    };
    broken.removeItem = () => {
      throw new Error('blocked');
    };
    configureCore({ storage: broken });
    expect(typeof intentKey('t', 'f')).toBe('string');
    expect(() => clearIntent('t')).not.toThrow();
  });
});

describe('offline cache', () => {
  it('is scoped per user and cleared on logout without touching idempotency keys', () => {
    setCacheScope('u1');
    writeCache('menu', [1]);
    expect(readCache<number[]>('menu')?.data).toEqual([1]);
    setCacheScope('u2');
    expect(readCache('menu')).toBeNull();
    writeCache('menu', [2]);
    removeCache('menu');
    expect(readCache('menu')).toBeNull();
    intentKey('keep', 'f');
    setCacheScope(null);
    writeCache('x', 1);
    clearCache();
    setCacheScope('u1');
    expect(readCache('menu')).toBeNull();
    expect(loadIntent('keep')).not.toBeNull();
  });

  it('keeps working when storage fails', () => {
    const broken = memoryStorage();
    broken.setItem = () => {
      throw new Error('quota');
    };
    broken.removeItem = () => {
      throw new Error('blocked');
    };
    broken.keys = () => {
      throw new Error('blocked');
    };
    configureCore({ storage: broken });
    expect(writeCache('a', 1)).toBeGreaterThan(0);
    expect(() => removeCache('a')).not.toThrow();
    expect(() => clearCache()).not.toThrow();
    broken.getItem = () => '{bad';
    expect(readCache('a')).toBeNull();
  });
});

describe('version guard', () => {
  beforeEach(() => clearVersionCache());

  it('never goes back to a lower version', () => {
    const v3 = { id: 'o1', version: 3, status: 'paid' };
    const v2 = { id: 'o1', version: 2, status: 'open' };
    expect(newest('order', v3)).toBe(v3);
    expect(newest('order', v2)).toBe(v3);
    expect(pickNewer(v3, v2)).toBe(v3);
    expect(pickNewer(v2, v3)).toBe(v3);
    expect(pickNewer(null, v2)).toBe(v2);
    expect(pickNewer({ id: 'a', version: 9 }, { id: 'b', version: 1 }).id).toBe('b');
  });
});

describe('parseOrderPayload', () => {
  it('reads the till QR and links', () => {
    expect(parseOrderPayload('zahln://pay?order=ord_dca200d0b9d06f7d')).toBe('ord_dca200d0b9d06f7d');
    expect(parseOrderPayload('https://mensa.example/?lang=de&order=ord_abc')).toBe('ord_abc');
    expect(parseOrderPayload(' ord_123 ')).toBe('ord_123');
    expect(parseOrderPayload('zahln:order:ord_q1')).toBe('ord_q1');
  });

  it('rejects anything that is not a Zahln order', () => {
    expect(parseOrderPayload('')).toBeNull();
    expect(parseOrderPayload('https://example.com/menu')).toBeNull();
    expect(parseOrderPayload('zahln://pay?order=../../payments')).toBeNull();
    expect(parseOrderPayload('zahln://pay?order=%E0%A4%A')).toBeNull();
    expect(parseOrderPayload('zahln:order:12345')).toBeNull();
    expect(parseOrderPayload('WIFI:S:mensa;T:WPA;P:secret;;')).toBeNull();
  });
});

describe('pay flow rules', () => {
  it('classifies failures and decides whether to keep the key', () => {
    expect(classifyPayFailure(apiError('amount_mismatch', { status: 422 }))).toEqual({ kind: 'reprice' });
    expect(classifyPayFailure(apiError('order_already_paid', { status: 409 }))).toEqual({ kind: 'follow' });
    expect(classifyPayFailure(apiError('order_payment_in_progress', { status: 409 }))).toEqual({ kind: 'follow' });
    for (const c of ['order_expired', 'payments_disabled', 'app_version_unsupported'])
      expect(classifyPayFailure(apiError(c))).toEqual({ kind: 'final' });
    expect(classifyPayFailure(apiError('timeout', { status: 504, unknown: true, retryable: true }))).toEqual({ kind: 'uncertain' });
    expect(classifyPayFailure(apiError('unavailable', { status: 503, retryable: true }))).toEqual({ kind: 'uncertain' });
    expect(classifyPayFailure(new TypeError('boom'))).toEqual({ kind: 'uncertain' });
    expect(classifyPayFailure(apiError('invalid_request'))).toEqual({ kind: 'rejected' });

    expect(keepKeyAfter({ kind: 'uncertain' })).toBe(true);
    expect(keepKeyAfter({ kind: 'follow' })).toBe(true);
    expect(keepKeyAfter({ kind: 'reprice' })).toBe(false);
    expect(keepKeyAfter({ kind: 'final' })).toBe(false);
    expect(keepKeyAfter({ kind: 'rejected' })).toBe(false);
  });

  const now = Date.parse('2026-10-31T12:00:00Z');
  const base = { orderFailed: false, paymentId: null, payment: null, now };

  it('shows loading, errors and an open order', () => {
    expect(payScreen({ ...base, order: null })).toEqual({ kind: 'loading' });
    expect(payScreen({ ...base, order: null, orderFailed: true })).toEqual({ kind: 'load-error' });
    const order = makeOrder({ expiresAt: new Date(now + 90_000).toISOString() });
    expect(payScreen({ ...base, order })).toEqual({ kind: 'payable', msLeft: 90_000 });
  });

  it('never offers Pay again once a payment may exist', () => {
    const order = makeOrder({ expiresAt: new Date(now + 90_000).toISOString() });
    expect(payScreen({ ...base, order, paymentId: 'pay_1' })).toEqual({ kind: 'checking', slow: false });
    // A payment of someone else in the state (wrong id) is ignored.
    expect(payScreen({ ...base, order, paymentId: 'pay_1', payment: makePayment({ id: 'pay_2' }) })).toEqual({ kind: 'checking', slow: false });
  });

  it('shows paid only for our own confirmed payment', () => {
    const order = makeOrder({ status: 'paid', expiresAt: new Date(now + 90_000).toISOString() });
    expect(payScreen({ ...base, order })).toEqual({ kind: 'paid' });
    const mine = makePayment({ id: 'pay_1', status: 'confirmed' });
    expect(payScreen({ ...base, order, paymentId: 'pay_1', payment: mine })).toEqual({ kind: 'confirmed', payment: mine });
  });

  it('marks a slow pending payment and allows a retry only on a still open order after a decline', () => {
    const order = makeOrder({ expiresAt: new Date(now + 90_000).toISOString() });
    const pending = makePayment({ status: 'pending', createdAt: new Date(now - SLOW_PENDING_MS - 1).toISOString() });
    expect(payScreen({ ...base, order, paymentId: 'pay_1', payment: pending })).toEqual({ kind: 'checking', slow: true });
    const declined = makePayment({ status: 'declined' });
    expect(payScreen({ ...base, order, paymentId: 'pay_1', payment: declined })).toEqual({ kind: 'declined', canRetry: true });
    expect(payScreen({ ...base, order: { ...order, status: 'expired' }, paymentId: 'pay_1', payment: declined })).toEqual({
      kind: 'declined',
      canRetry: false,
    });
    expect(payScreen({ ...base, order: null, paymentId: 'pay_1', payment: declined })).toEqual({ kind: 'declined', canRetry: false });
    expect(
      payScreen({ ...base, order: { ...order, expiresAt: new Date(now - 1).toISOString() }, paymentId: 'pay_1', payment: declined }),
    ).toEqual({ kind: 'declined', canRetry: false });
  });

  it('handles expired and busy orders', () => {
    expect(payScreen({ ...base, order: makeOrder({ status: 'expired' }) })).toEqual({ kind: 'expired' });
    expect(payScreen({ ...base, order: makeOrder({ expiresAt: new Date(now - 1).toISOString() }) })).toEqual({ kind: 'expired' });
    expect(payScreen({ ...base, order: makeOrder({ status: 'paying', expiresAt: new Date(now + 1000).toISOString() }) })).toEqual({
      kind: 'busy-other',
    });
  });

  it('follows the payment an order points at', () => {
    expect(paymentToFollow(makeOrder({ status: 'paying', paymentId: 'pay_1' }))).toBe('pay_1');
    expect(paymentToFollow(makeOrder({ status: 'paid', paymentId: 'pay_1' }))).toBe('pay_1');
    expect(paymentToFollow(makeOrder({ status: 'open', paymentId: 'pay_1' }))).toBeNull();
    expect(paymentToFollow(makeOrder({ status: 'paying', paymentId: null }))).toBeNull();
  });
});

describe('csv', () => {
  it('quotes cells and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+49 123')).toBe("'+49 123");
    expect(csvCell('-0,07')).toBe('-0,07');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(toCsv([['a', 1]])).toBe('﻿a;1\r\n');
  });

  it('exports payments with German decimals', () => {
    const csv = paymentsToCsv([makePayment({ amountCents: 450, refundedAmountCents: 100, needsAttention: true, attentionReasons: ['refund_failed'] })]);
    const [header, row] = csv.replace('﻿', '').trim().split('\r\n');
    expect(header.split(';')[0]).toBe('payment_id');
    expect(row).toContain('pay_1;ord_1;');
    expect(row).toContain(';4,50;1,00;');
    expect(row).toContain(';yes;refund_failed;1x Nudeln');
    expect(paymentsToCsv([makePayment()])).toContain(';no;;');
  });

  it('exports daily totals per mensa and till', () => {
    const lines = dailyTotalsToCsv(totals()).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^date;level;mensa;till/);
    expect(lines[1]).toBe('2026-10-31;mensa;Mensa am Campus;;2;9,00;1,00;8,00;1;3,50');
    expect(lines[2]).toBe('2026-10-31;till;Mensa am Campus;Kasse 1;2;9,00;1,00;8,00;1;3,50');
    expect(lines[3]).toMatch(/^2026-10-31;total;;;/);
  });
});

afterEach(() => vi.unstubAllGlobals());
