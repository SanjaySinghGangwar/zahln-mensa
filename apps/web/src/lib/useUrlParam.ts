import { useCallback, useEffect, useState } from 'react';

function read(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Keeps one piece of UI state (a tab, the open order, the open payment) in the
 * URL query, so the browser's Back/Forward buttons move through the app and a
 * refresh keeps you where you were.
 */
export function useUrlParam(name: string): [string | null, (value: string | null, opts?: { replace?: boolean }) => void] {
  const [value, setValue] = useState<string | null>(() => read(name));

  useEffect(() => {
    const onPop = () => setValue(read(name));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [name]);

  const set = useCallback(
    (next: string | null, opts?: { replace?: boolean }) => {
      const url = new URL(window.location.href);
      if (next === null) url.searchParams.delete(name);
      else url.searchParams.set(name, next);
      if (url.href !== window.location.href) {
        if (opts?.replace) window.history.replaceState(null, '', url);
        else window.history.pushState(null, '', url);
      }
      setValue(next);
    },
    [name],
  );

  return [value, set];
}

/** A tab kept in the URL; the default tab is left out of the URL. */
export function useUrlTab<T extends string>(tabs: readonly T[], fallback: T): [T, (tab: T) => void] {
  const [raw, setRaw] = useUrlParam('tab');
  const tab = raw && (tabs as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const setTab = useCallback((t: T) => setRaw(t === fallback ? null : t), [setRaw, fallback]);
  return [tab, setTab];
}
