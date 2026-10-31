// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError, abortError } from './client';
import { api, fetchAllPayments } from './endpoints';
import { setLanguage } from './i18n';
import { readCache, writeCache } from './cache';
import { useCachedQuery, useLanguage, usePolling, useServerNow } from './react';
import { listItem } from './test/fixtures';

const fail = () => new ApiError({ code: 'unavailable', title: '', status: 503, retryable: true }, false);

describe('useLanguage', () => {
  it('re-renders on a language change', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current).toBe('en');
    act(() => setLanguage('de'));
    expect(result.current).toBe('de');
  });
});

describe('usePolling', () => {
  it('runs until the task says stop, and keeps going after a throw', async () => {
    let n = 0;
    const task = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('flaky');
      return n >= 3 ? ('stop' as const) : undefined;
    });
    renderHook(() => usePolling(task, 5, true));
    await waitFor(() => expect(task).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 30));
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('does nothing while inactive and aborts on unmount', async () => {
    const idle = vi.fn(async () => undefined);
    renderHook(() => usePolling(idle, 5, false));
    expect(idle).not.toHaveBeenCalled();

    let signal: AbortSignal | undefined;
    const { unmount } = renderHook(() =>
      usePolling(async (s) => {
        signal = s;
      }, 5, true),
    );
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe('useServerNow', () => {
  it('ticks', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useServerNow(100));
    const first = result.current;
    act(() => vi.advanceTimersByTime(250));
    expect(result.current).toBeGreaterThanOrEqual(first);
    vi.useRealTimers();
  });
});

describe('useCachedQuery', () => {
  it('shows the saved copy at once, then the fresh answer', async () => {
    writeCache('k', 'old');
    const { result } = renderHook(() => useCachedQuery('k', async () => 'new'));
    expect(result.current.data).toBe('old');
    await waitFor(() => expect(result.current.data).toBe('new'));
    expect(readCache('k')?.data).toBe('new');
  });

  it('marks the saved copy stale when the server fails, and reports errors without one', async () => {
    writeCache('s', 'saved');
    const stale = renderHook(() => useCachedQuery('s', async () => Promise.reject(fail())));
    await waitFor(() => expect(stale.result.current.stale).toBe(true));
    expect(stale.result.current.data).toBe('saved');

    const none = renderHook(() => useCachedQuery(null, async () => Promise.reject(fail())));
    await waitFor(() => expect(none.result.current.error).toBeTruthy());
    expect(none.result.current.stale).toBe(false);
  });

  it('never shows another key’s data, keeps data on reload of the same key, ignores aborts', async () => {
    let value = 'a1';
    const { result, rerender } = renderHook(({ k, r }) => useCachedQuery(k, async () => value, r), { initialProps: { k: 'a', r: 0 } });
    await waitFor(() => expect(result.current.data).toBe('a1'));
    value = 'b1';
    rerender({ k: 'b', r: 0 });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe('b1'));
    value = 'b2';
    rerender({ k: 'b', r: 1 });
    expect(result.current.data).toBe('b1');
    await waitFor(() => expect(result.current.data).toBe('b2'));

    const aborted = renderHook(() => useCachedQuery(null, async () => Promise.reject(abortError())));
    await new Promise((r) => setTimeout(r, 10));
    expect(aborted.result.current.loading).toBe(true);
  });
});

describe('fetchAllPayments', () => {
  it('pages through, drops duplicates, and caps the export', async () => {
    const pages = [
      { items: [listItem({ id: 'p1' }), listItem({ id: 'p2' })], nextCursor: 'c1' },
      { items: [listItem({ id: 'p2' }), listItem({ id: 'p3' })], nextCursor: null },
    ];
    const list = vi.spyOn(api, 'listPayments').mockImplementation(async (q) => (q.cursor === 'c1' ? pages[1] : pages[0]));
    const progress = vi.fn();
    const all = await fetchAllPayments({ status: 'confirmed' }, { onProgress: progress });
    expect(all.items.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(all.capped).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(3);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', limit: 200 }), undefined);

    const capped = await fetchAllPayments({}, { max: 1, pageSize: 2 });
    expect(capped.items).toHaveLength(1);
    expect(capped.capped).toBe(true);
  });
});
