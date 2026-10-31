import { beforeEach } from 'vitest';
import { configureCore, setLanguage, webStorage } from '@zahln/core';

// Newer Node versions ship an experimental global `localStorage` that hides
// jsdom's. Install a simple in-memory Storage so tests behave like a browser.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
}

window.scrollTo = () => {};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  configureCore({ apiBase: '/api', storage: webStorage(localStorage) });
  setLanguage('en');
});
