// Everything platform specific is handed in by the app at start-up, so the
// same core runs in the browser (dashboard) and in React Native (app + till).

/** A small synchronous key-value store. Web: localStorage. App: expo-sqlite kv-store. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export interface CoreConfig {
  /** Base URL of the Zahln API, e.g. https://dev.zahln.de (or /api behind the Vite dev proxy). */
  apiBase: string;
  candidateId: string;
  /** Sent as X-App-Version and compared with the remote `minAppVersion`. */
  appVersion: string;
  /** Durable storage for idempotency keys and the offline cache. */
  storage: KeyValueStorage;
  /** Random ID for Idempotency-Keys. Needs a cryptographically strong source. */
  randomId: () => string;
}

export function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    keys: () => Array.from(data.keys()),
  };
}

/** Adapts the browser's localStorage (or any Web Storage) to KeyValueStorage. */
export function webStorage(storage: Storage): KeyValueStorage {
  return {
    getItem: (k) => storage.getItem(k),
    setItem: (k, v) => storage.setItem(k, v),
    removeItem: (k) => storage.removeItem(k),
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    },
  };
}

function defaultRandomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Never fall back to Math.random for keys that protect money.
  throw new Error('No secure random source: pass randomId to configureCore()');
}

export const coreConfig: CoreConfig = {
  apiBase: 'https://dev.zahln.de',
  candidateId: 'c_111437af73',
  appVersion: '1.0.0',
  storage: memoryStorage(),
  randomId: defaultRandomId,
};

export function configureCore(patch: Partial<CoreConfig>) {
  Object.assign(coreConfig, patch);
}
