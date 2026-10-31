import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  formatCents,
  formatDateTime,
  groupLabel,
  isAbort,
  readCache,
  t,
  writeCache,
  type Payment,
  type PaymentQuery,
} from '@zahln/core';
import { Empty, ErrorNotice, Spinner, StaleNotice, StatusBadge } from '../components/ui';

interface Props {
  query: PaymentQuery;
  onOpen: (paymentId: string) => void;
  pageSize?: number;
  emptyText?: string;
}

export function PaymentsList({ query, onOpen, pageSize = 50, emptyText }: Props) {
  const [items, setItems] = useState<Payment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Set when the first page could not be loaded and the saved copy is shown instead.
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  // The last request, so "Try again" repeats exactly what failed (refresh or load more).
  const lastRequestRef = useRef<{ append: boolean; cursor: string | null }>({ append: false, cursor: null });
  const queryKey = JSON.stringify(query);

  const load = useCallback(
    async (append: boolean, fromCursor: string | null) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      lastRequestRef.current = { append, cursor: fromCursor };
      setLoading(true);
      setError(null);
      // The first page of each filter is saved, so the list appears at once and survives a failing server.
      const cacheKey = !append && !fromCursor ? `payments:${queryKey}` : null;
      const cached = cacheKey ? readCache<{ items: Payment[]; nextCursor: string | null }>(cacheKey) : null;
      if (cached) {
        setItems(cached.data.items);
        setCursor(cached.data.nextCursor);
      }
      try {
        const page = await api.listPayments(
          { ...(JSON.parse(queryKey) as PaymentQuery), limit: pageSize, cursor: fromCursor ?? undefined },
          controller.signal,
        );
        setItems((prev) => {
          if (!append) return page.items;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setCursor(page.nextCursor);
        setStaleSince(null);
        if (cacheKey) writeCache(cacheKey, page);
      } catch (e) {
        if (isAbort(e)) return;
        if (cached) setStaleSince(cached.savedAt);
        else setError(e);
      } finally {
        if (requestRef.current === controller) setLoading(false);
      }
    },
    [queryKey, pageSize],
  );

  // When the filters change, drop the old rows right away so results for a
  // previous filter are never shown under the new one.
  const shownKeyRef = useRef(queryKey);
  useEffect(() => {
    if (shownKeyRef.current !== queryKey) {
      shownKeyRef.current = queryKey;
      setItems([]);
      setCursor(null);
      setStaleSince(null);
    }
    void load(false, null);
    return () => requestRef.current?.abort();
  }, [load, queryKey]);

  return (
    <div className="payments-list">
      <div className="list-toolbar">
        <span className="muted" aria-live="polite">
          {t('dash.shown', { count: items.length })}
          {cursor ? ` · ${t('dash.more')}` : ''}
        </span>
        <button className="btn btn-sm" onClick={() => load(false, null)} disabled={loading}>
          {loading ? <Spinner small /> : <span aria-hidden="true">↻</span>} {t('common.refresh')}
        </button>
      </div>

      {staleSince !== null && <StaleNotice savedAt={staleSince} onRetry={() => load(false, null)} />}
      {error !== null && <ErrorNotice error={error} onRetry={() => load(lastRequestRef.current.append, lastRequestRef.current.cursor)} />}

      {items.length === 0 && loading ? (
        <div className="center pad">
          <Spinner />
        </div>
      ) : items.length === 0 && !loading && error === null ? (
        <Empty>{emptyText ?? t('dash.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('dash.time')}</th>
                <th scope="col">{t('detail.payment')}</th>
                <th scope="col">{t('dash.place')}</th>
                <th scope="col">{t('detail.payer')}</th>
                <th scope="col" className="num">
                  {t('dash.amount')}
                </th>
                <th scope="col" className="num">
                  {t('dash.refunded')}
                </th>
                <th scope="col">{t('dash.status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  className={p.needsAttention ? 'clickable row-attention' : 'clickable'}
                  onClick={() => onOpen(p.id)}
                >
                  <td className="nowrap">{formatDateTime(p.createdAt)}</td>
                  <td>
                    {/* A real button inside the row, so keyboard and screen reader users can open it too. */}
                    <button className="link-btn mono" onClick={(e) => (e.stopPropagation(), onOpen(p.id))}>
                      {p.id}
                    </button>
                    {p.needsAttention && (
                      <div className="attention">
                        <span aria-hidden="true">⚠ </span>
                        {p.attentionReasons.map((r) => t(`attention.${r}`)).join(', ')}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.mensa.name}
                    <div className="muted small">{p.till.name}</div>
                  </td>
                  <td>
                    {p.payer.displayName}
                    <div className="muted small">{groupLabel(p.priceGroup)}</div>
                  </td>
                  <td className="num">{formatCents(p.amountCents)}</td>
                  <td className="num">
                    {p.refundedAmountCents > 0 ? formatCents(p.refundedAmountCents) : '–'}
                    {p.pendingRefundAmountCents > 0 && (
                      <div className="muted small">{t('detail.pendingRefund', { amount: formatCents(p.pendingRefundAmountCents) })}</div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <div className="center">
          <button className="btn" onClick={() => load(true, cursor)} disabled={loading}>
            {loading ? <Spinner small /> : null} {t('dash.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
