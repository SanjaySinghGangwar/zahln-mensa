// One Idempotency-Key per *intent*, reused for every retry of that intent.
//
// Keys are kept in durable storage (localStorage on the web, SQLite on the
// phone), so a retry after the app was killed — for example while a payment
// response was lost — still uses the same key and can never charge twice.
// The fingerprint describes the request body: if the body changes (a different
// cart, a different amount) it is a new intent and gets a new key, which
// avoids `422 idempotency_mismatch`.

import { coreConfig } from './config';

export interface Intent {
  key: string;
  fingerprint: string;
  createdAt: number;
  /** The payment this intent created, once known. Lets the app follow it after a restart. */
  paymentId?: string;
}

const PREFIX = 'zahln.intent.';
// The server keeps keys for 24 hours; stay safely below that.
export const INTENT_MAX_AGE_MS = 23 * 60 * 60 * 1000;

function storageKey(scope: string) {
  return PREFIX + scope;
}

export function loadIntent(scope: string): Intent | null {
  try {
    const raw = coreConfig.storage.getItem(storageKey(scope));
    if (!raw) return null;
    const intent = JSON.parse(raw) as Intent;
    if (Date.now() - intent.createdAt > INTENT_MAX_AGE_MS) {
      coreConfig.storage.removeItem(storageKey(scope));
      return null;
    }
    return intent;
  } catch {
    return null;
  }
}

function saveIntent(scope: string, intent: Intent) {
  try {
    coreConfig.storage.setItem(storageKey(scope), JSON.stringify(intent));
  } catch {
    /* storage full or blocked: the key still lives for this call */
  }
}

/** Returns the key for this intent, creating one if the intent is new or its body changed. */
export function intentKey(scope: string, fingerprint: string): string {
  const current = loadIntent(scope);
  if (current && current.fingerprint === fingerprint) return current.key;
  const intent: Intent = { key: coreConfig.randomId(), fingerprint, createdAt: Date.now() };
  saveIntent(scope, intent);
  return intent.key;
}

export function updateIntent(scope: string, patch: Partial<Pick<Intent, 'paymentId'>>) {
  const current = loadIntent(scope);
  if (current) saveIntent(scope, { ...current, ...patch });
}

/** Call once the intent has a final, known outcome. The next attempt gets a fresh key. */
export function clearIntent(scope: string) {
  try {
    coreConfig.storage.removeItem(storageKey(scope));
  } catch {
    /* ignore */
  }
}
