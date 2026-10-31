// Wires the shared core to the phone: durable storage, secure random IDs,
// the app's real version and the device language.

import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { getLocales } from 'expo-localization';
import Storage from 'expo-sqlite/kv-store';
import { configureCore, languageFromLocale, setLanguage, type KeyValueStorage, type Lang } from '@zahln/core';

/**
 * SQLite-backed key-value store with synchronous reads and writes. Idempotency
 * keys are written *before* a payment request leaves the phone, so they must
 * survive the app being killed mid-request — AsyncStorage's write-behind would not.
 */
export const kvStorage: KeyValueStorage = {
  getItem: (k) => Storage.getItemSync(k),
  setItem: (k, v) => Storage.setItemSync(k, v),
  removeItem: (k) => void Storage.removeItemSync(k),
  keys: () => Storage.getAllKeysSync(),
};

export const APP_VERSION = Application.nativeApplicationVersion ?? '1.0.0';

const LANG_KEY = 'zahln.lang';

export function boot() {
  configureCore({
    apiBase: process.env.EXPO_PUBLIC_API_BASE || 'https://dev.zahln.de',
    candidateId: process.env.EXPO_PUBLIC_CANDIDATE_ID || 'c_111437af73',
    appVersion: APP_VERSION,
    storage: kvStorage,
    randomId: () => Crypto.randomUUID(),
  });
  const saved = safeGet(LANG_KEY);
  setLanguage(saved === 'de' || saved === 'en' ? saved : languageFromLocale(getLocales()[0]?.languageTag));
}

export function chooseLanguage(lang: Lang) {
  try {
    kvStorage.setItem(LANG_KEY, lang);
  } catch {
    /* not critical */
  }
  setLanguage(lang);
}

function safeGet(key: string): string | null {
  try {
    return kvStorage.getItem(key);
  } catch {
    return null;
  }
}
