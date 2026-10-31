// Confirming a payment on the phone.
//
// 1. If the phone has a screen lock, the system prompt is used: fingerprint or
//    face, with the phone's own PIN/pattern as fallback. The app never sees
//    any of it.
// 2. If the phone has no screen lock at all, the app asks for its own 4-digit
//    PIN (see pin.ts), set on first use.

import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { t } from '@zahln/core';

export type ConfirmMethod = 'system' | 'app-pin';

export async function confirmMethod(): Promise<ConfirmMethod> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level >= LocalAuthentication.SecurityLevel.SECRET ? 'system' : 'app-pin';
  } catch {
    return 'app-pin';
  }
}

/** Shows the system prompt. Resolves true only when the user really confirmed. */
export async function confirmWithSystem(amount: string): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: t('pay.confirmTitle', { amount }),
      cancelLabel: t('common.cancel'),
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// App PIN, for phones without a screen lock.
// Stored as a salted SHA-256 in the Android Keystore-backed SecureStore, per user.

export const MAX_PIN_TRIES = 5;

interface PinRecord {
  salt: string;
  hash: string;
  fails: number;
}

function pinKey(userId: string) {
  return `zahln.pin.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

async function hash(pin: string, salt: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

async function read(userId: string): Promise<PinRecord | null> {
  try {
    const raw = await SecureStore.getItemAsync(pinKey(userId));
    return raw ? (JSON.parse(raw) as PinRecord) : null;
  } catch {
    return null;
  }
}

async function write(userId: string, rec: PinRecord) {
  await SecureStore.setItemAsync(pinKey(userId), JSON.stringify(rec), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function hasPin(userId: string): Promise<boolean> {
  return (await read(userId)) !== null;
}

export async function setPin(userId: string, pin: string) {
  const salt = Crypto.randomUUID();
  await write(userId, { salt, hash: await hash(pin, salt), fails: 0 });
}

export type PinCheck = { ok: true } | { ok: false; left: number } | { ok: false; locked: true };

/** Checks the PIN. After MAX_PIN_TRIES wrong tries the PIN is deleted and the user must sign in again. */
export async function checkPin(userId: string, pin: string): Promise<PinCheck> {
  const rec = await read(userId);
  if (!rec) return { ok: false, locked: true };
  if ((await hash(pin, rec.salt)) === rec.hash) {
    if (rec.fails) await write(userId, { ...rec, fails: 0 });
    return { ok: true };
  }
  const fails = rec.fails + 1;
  if (fails >= MAX_PIN_TRIES) {
    await SecureStore.deleteItemAsync(pinKey(userId));
    return { ok: false, locked: true };
  }
  await write(userId, { ...rec, fails });
  return { ok: false, left: MAX_PIN_TRIES - fails };
}
