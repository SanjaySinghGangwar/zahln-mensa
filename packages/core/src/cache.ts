// A small offline cache so the screens stay useful when the server is slow or
// failing: they show the last good data at once and refresh in the background.
// Money-changing requests (orders, payments, refunds) are never answered from
// this cache.
//
// Entries are scoped to the signed-in user, and everything is removed on
// logout so one person's data is not left behind on a shared till.

import { coreConfig } from './config';

const PREFIX = 'zahln.cache.';
let scope = 'anon';

export interface CacheEntry<T> {
  data: T;
  savedAt: number;
}

/** Set by the auth layer whenever the signed-in user changes. */
export function setCacheScope(userId: string | null) {
  scope = userId ?? 'anon';
}

function storageKey(key: string) {
  return `${PREFIX}${coreConfig.candidateId}.${scope}.${key}`;
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = coreConfig.storage.getItem(storageKey(key));
    return raw ? (JSON.parse(raw) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): number {
  const savedAt = Date.now();
  try {
    coreConfig.storage.setItem(storageKey(key), JSON.stringify({ data, savedAt }));
  } catch {
    /* storage full or blocked: the app still works, just without the cache */
  }
  return savedAt;
}

export function removeCache(key: string) {
  try {
    coreConfig.storage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

/** Removes every cached entry for every user (on logout). Idempotency keys are kept. */
export function clearCache() {
  try {
    coreConfig.storage
      .keys()
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => coreConfig.storage.removeItem(k));
  } catch {
    /* ignore */
  }
}
