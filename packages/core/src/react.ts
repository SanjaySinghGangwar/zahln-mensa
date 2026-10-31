// React hooks shared by the dashboard (React DOM) and the app (React Native).
// Nothing here touches the DOM.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isAbort, serverNow } from './client';
import { readCache, writeCache } from './cache';
import { getLanguage, subscribeLanguage, type Lang } from './i18n';

/** Re-renders when the language changes and returns it. Call it at the top of screens that use t(). */
export function useLanguage(): Lang {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/**
 * Runs `task` now and then every `intervalMs` while `active` is true.
 * The task returns 'stop' to end polling. Each run waits for the previous one,
 * so slow responses never pile up. Unmounting aborts the request in flight.
 */
export function usePolling(task: (signal: AbortSignal) => Promise<'stop' | void>, intervalMs: number, active: boolean) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      let stop = false;
      try {
        stop = (await taskRef.current(controller.signal)) === 'stop';
      } catch {
        /* the task reports its own errors; keep polling */
      }
      if (!stop && !controller.signal.aborted) timer = setTimeout(tick, intervalMs);
    };
    void tick();

    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, intervalMs]);
}

/** Current time according to the server's clock, refreshed every `tickMs`. */
export function useServerNow(tickMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

export interface CachedQuery<T> {
  data: T | null;
  /** When `data` was fetched from the server. */
  savedAt: number | null;
  loading: boolean;
  error: unknown;
  /** True when the server could not be reached and `data` is the saved copy. */
  stale: boolean;
}

/**
 * Stale-while-revalidate: shows the saved copy for `key` at once, then asks the
 * server. A successful answer replaces it and is saved; a failure keeps the
 * saved copy on screen and marks it stale. With `key` null nothing is cached.
 */
export function useCachedQuery<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, reloadToken = 0): CachedQuery<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [state, setState] = useState<CachedQuery<T>>(() => {
    const cached = key ? readCache<T>(key) : null;
    return { data: cached?.data ?? null, savedAt: cached?.savedAt ?? null, loading: true, error: null, stale: false };
  });

  const keyRef = useRef(key);

  useEffect(() => {
    const controller = new AbortController();
    const cached = key ? readCache<T>(key) : null;
    // A different key is different data: never keep showing the old key's copy.
    const sameKey = keyRef.current === key;
    keyRef.current = key;
    setState((s) => ({
      data: cached ? cached.data : sameKey ? s.data : null,
      savedAt: cached ? cached.savedAt : sameKey ? s.savedAt : null,
      loading: true,
      error: null,
      stale: false,
    }));
    fetcherRef
      .current(controller.signal)
      .then((data) => {
        const savedAt = key ? writeCache(key, data) : Date.now();
        setState({ data, savedAt, loading: false, error: null, stale: false });
      })
      .catch((error) => {
        if (isAbort(error)) return;
        setState((s) => ({ ...s, loading: false, error, stale: s.data !== null }));
      });
    return () => controller.abort();
  }, [key, reloadToken]);

  return state;
}
