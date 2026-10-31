import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const store = new Map<string, string>();
const auth = { level: 0, success: true, throws: false };

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_a: string, s: string) => createHash('sha256').update(s).digest('hex'),
  randomUUID: () => 'salt-' + Math.random(),
}));
vi.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: async () => {
    if (auth.throws) throw new Error('x');
    return auth.level;
  },
  authenticateAsync: async () => {
    if (auth.throws) throw new Error('x');
    return { success: auth.success };
  },
}));

import { checkPin, confirmMethod, confirmWithSystem, hasPin, MAX_PIN_TRIES, setPin } from './confirm';

beforeEach(() => {
  store.clear();
  Object.assign(auth, { level: 0, success: true, throws: false });
});

describe('confirming a payment', () => {
  it('uses the system prompt when the phone has a screen lock, the app PIN otherwise', async () => {
    expect(await confirmMethod()).toBe('app-pin');
    auth.level = 1;
    expect(await confirmMethod()).toBe('system');
    auth.level = 3;
    expect(await confirmMethod()).toBe('system');
    auth.throws = true;
    expect(await confirmMethod()).toBe('app-pin');
  });

  it('only counts a successful system prompt as confirmed', async () => {
    expect(await confirmWithSystem('4,50 €')).toBe(true);
    auth.success = false;
    expect(await confirmWithSystem('4,50 €')).toBe(false);
    auth.throws = true;
    expect(await confirmWithSystem('4,50 €')).toBe(false);
  });
});

describe('app PIN', () => {
  it('stores only a salted hash, per user', async () => {
    expect(await hasPin('usr_student')).toBe(false);
    await setPin('usr_student', '1234');
    expect(await hasPin('usr_student')).toBe(true);
    expect(await hasPin('usr_staff')).toBe(false);
    const raw = [...store.values()][0];
    expect(raw).not.toContain('1234');
    expect(await checkPin('usr_student', '1234')).toEqual({ ok: true });
  });

  it('counts wrong tries, resets them on success, and locks after the limit', async () => {
    await setPin('u', '1234');
    expect(await checkPin('u', '0000')).toEqual({ ok: false, left: MAX_PIN_TRIES - 1 });
    expect(await checkPin('u', '1234')).toEqual({ ok: true });
    for (let i = 1; i < MAX_PIN_TRIES; i++) expect(await checkPin('u', '0000')).toEqual({ ok: false, left: MAX_PIN_TRIES - i });
    expect(await checkPin('u', '0000')).toEqual({ ok: false, locked: true });
    expect(await hasPin('u')).toBe(false);
    expect(await checkPin('u', '1234')).toEqual({ ok: false, locked: true });
  });

  it('treats an unreadable record as no PIN', async () => {
    store.set('zahln.pin.u', '{bad');
    expect(await hasPin('u')).toBe(false);
  });
});
