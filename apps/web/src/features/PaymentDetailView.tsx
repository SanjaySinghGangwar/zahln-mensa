import { useState } from 'react';
import {
  api,
  formatCents,
  formatDateTime,
  groupLabel,
  isAbort,
  localized,
  pickNewer,
  readCache,
  t,
  writeCache,
  type PaymentDetail,
} from '@zahln/core';
import { usePolling } from '@zahln/core/react';
import { ErrorNotice, Notice, Spinner, StatusBadge } from '../components/ui';

/** Read-only payment with refunds and full history. Refunds are made at the till. */
export function PaymentDetailView({ paymentId }: { paymentId: string }) {
  const [detail, setDetail] = useState<PaymentDetail | null>(() => readCache<PaymentDetail>(`payment:${paymentId}`)?.data ?? null);
  const [error, setError] = useState<unknown>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Load once; keep polling while something is still moving.
  const moving = !detail || detail.status === 'pending' || detail.pendingRefundAmountCents > 0 || detail.refunds.some((r) => r.status === 'pending');
  usePolling(
    async (signal) => {
      try {
        const d = await api.getPayment(paymentId, signal);
        setDetail((prev) => {
          const next = pickNewer(prev, d);
          writeCache(`payment:${paymentId}`, next);
          return next;
        });
        setError(null);
        setLoadedOnce(true);
      } catch (e) {
        if (!isAbort(e)) setError(e);
      }
    },
    detail ? 3000 : 1500,
    moving || !loadedOnce,
  );

  if (!detail) {
    return error !== null ? (
      <ErrorNotice error={error} />
    ) : (
      <div className="center pad">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="detail">
      {error !== null && <Notice tone="warn">{t('common.connectionIssue')}</Notice>}
      {detail.needsAttention && (
        <Notice tone="warn">{t('detail.needsAttention', { reasons: detail.attentionReasons.map((r) => t(`attention.${r}`)).join(', ') })}</Notice>
      )}

      <div className="detail-head">
        <div>
          <div className="big-amount">{formatCents(detail.amountCents)}</div>
          <div className="muted">
            {t('group.price', { group: groupLabel(detail.priceGroup) })} · {detail.payer.displayName}
          </div>
        </div>
        <StatusBadge status={detail.status} />
      </div>

      {detail.status === 'pending' && (
        <Notice tone="warn">
          <Spinner small /> {t('detail.stillChecked')}
        </Notice>
      )}

      <dl className="kv">
        <dt>{t('detail.payment')}</dt>
        <dd>
          <code>{detail.id}</code>
        </dd>
        <dt>{t('detail.order')}</dt>
        <dd>
          <code>{detail.orderId}</code>
        </dd>
        <dt>{t('detail.payer')}</dt>
        <dd>
          {detail.payer.displayName} <code className="muted">{detail.payer.id}</code>
        </dd>
        <dt>{t('detail.where')}</dt>
        <dd>
          {detail.mensa.name} · {detail.till.name}
        </dd>
        <dt>{t('detail.created')}</dt>
        <dd>{formatDateTime(detail.createdAt)}</dd>
        <dt>{t('detail.refunded')}</dt>
        <dd>
          {formatCents(detail.refundedAmountCents)}
          {detail.pendingRefundAmountCents > 0 && (
            <span className="muted"> ({t('detail.pendingRefund', { amount: formatCents(detail.pendingRefundAmountCents) })})</span>
          )}
        </dd>
        <dt>{t('detail.refundable')}</dt>
        <dd>{formatCents(detail.refundableAmountCents)}</dd>
      </dl>

      <h3>{t('detail.items')}</h3>
      <table className="table compact">
        <tbody>
          {detail.items.map((it) => (
            <tr key={it.itemId}>
              <td>{it.quantity}×</td>
              <td>{localized(it.name)}</td>
              <td className="num">{formatCents(it.unitPriceCents * it.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail.refunds.length > 0 && (
        <>
          <h3>{t('detail.refunds')}</h3>
          <table className="table compact">
            <tbody>
              {detail.refunds.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{formatDateTime(r.createdAt)}</td>
                  <td>{r.reason || <span className="muted">{t('detail.noReason')}</span>}</td>
                  <td className="num">{formatCents(r.amountCents)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>{t('detail.history')}</h3>
      <ol className="timeline">
        {detail.history.map((ev, i) => (
          <li key={`${ev.at}-${i}`} className={`tl-${ev.type}`}>
            <span className="tl-time">{formatDateTime(ev.at)}</span>
            <span>{t(`event.${ev.type}`)}</span>
            {ev.amountCents != null && <span className="muted"> · {formatCents(ev.amountCents)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
