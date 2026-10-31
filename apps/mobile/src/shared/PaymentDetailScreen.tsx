import { useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  api,
  centsToEuroInput,
  clearIntent,
  describeError,
  formatCents,
  formatDateTime,
  groupLabel,
  intentKey,
  isAbort,
  isApiError,
  localized,
  parseEuroToCents,
  pickNewer,
  readCache,
  t,
  writeCache,
  type PaymentDetail,
  type User,
} from '@zahln/core';
import { usePolling } from '@zahln/core/react';
import { Badge, Button, Card, ErrorNotice, Field, H2, Muted, Notice, Row, Spinner } from '../components/ui';
import { colors, space } from '../theme';

interface Props {
  paymentId: string;
  user: User;
  onBack: () => void;
}

export function PaymentDetailScreen({ paymentId, user, onBack }: Props) {
  const [detail, setDetail] = useState<PaymentDetail | null>(() => readCache<PaymentDetail>(`payment:${paymentId}`)?.data ?? null);
  const [error, setError] = useState<unknown>(null);
  // Refunds we created and are waiting on. A stale read may not show them yet,
  // so polling continues until each one is visible with a final status.
  const [watched, setWatched] = useState<string[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const unresolved = watched.filter((id) => {
    const r = detail?.refunds.find((x) => x.id === id);
    return !r || r.status === 'pending';
  });
  const moving =
    !detail ||
    detail.status === 'pending' ||
    detail.pendingRefundAmountCents > 0 ||
    detail.refunds.some((r) => r.status === 'pending') ||
    unresolved.length > 0;

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
    detail ? 2500 : 1500,
    moving || !loadedOnce,
  );

  // Only the cashier at the till that took the payment may refund it.
  const canRefund = user.role === 'cashier' && !!detail && detail.till.id === user.tillId;

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Button label={`← ${t('common.back')}`} onPress={onBack} kind="ghost" style={styles.back} />
      {!detail ? (
        error !== null ? (
          <ErrorNotice error={error} />
        ) : (
          <Spinner />
        )
      ) : (
        <>
          <Card>
            {error !== null && <Notice tone="warn">{t('common.connectionIssue')}</Notice>}
            {detail.needsAttention && (
              <Notice tone="warn">{t('detail.needsAttention', { reasons: detail.attentionReasons.map((r) => t(`attention.${r}`)).join(', ') })}</Notice>
            )}
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={styles.amount} accessibilityRole="header">
                  {formatCents(detail.amountCents)}
                </Text>
                <Muted>
                  {t('group.price', { group: groupLabel(detail.priceGroup) })} · {detail.payer.displayName}
                </Muted>
              </View>
              <Badge status={detail.status} />
            </View>
            {detail.status === 'pending' && <Notice tone="warn">{t('detail.stillChecked')}</Notice>}

            <Row label={t('detail.where')} value={`${detail.mensa.name} · ${detail.till.name}`} />
            <Row label={t('detail.created')} value={formatDateTime(detail.createdAt)} />
            <Row
              label={t('detail.refunded')}
              value={
                formatCents(detail.refundedAmountCents) +
                (detail.pendingRefundAmountCents > 0 ? ` (${t('detail.pendingRefund', { amount: formatCents(detail.pendingRefundAmountCents) })})` : '')
              }
            />
            <Row label={t('detail.refundable')} value={formatCents(detail.refundableAmountCents)} />
            <Row label={t('detail.payment')} value={detail.id} mono />
            <Row label={t('detail.order')} value={detail.orderId} mono />
          </Card>

          <Card>
            <H2>{t('detail.items')}</H2>
            {detail.items.map((it) => (
              <Row key={it.itemId} label={`${it.quantity}× ${localized(it.name)}`} value={formatCents(it.unitPriceCents * it.quantity)} />
            ))}
          </Card>

          {user.role === 'cashier' && !canRefund && <Notice tone="muted">{t('refund.otherTill')}</Notice>}
          {canRefund && (
            <RefundForm
              detail={detail}
              userId={user.id}
              onCreated={(id) => setWatched((w) => (w.includes(id) ? w : [...w, id]))}
            />
          )}

          {detail.refunds.length > 0 && (
            <Card>
              <H2>{t('detail.refunds')}</H2>
              {detail.refunds.map((r) => (
                <View key={r.id} style={styles.refund} accessible>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.refundAmount}>{formatCents(r.amountCents)}</Text>
                    <Muted small>
                      {formatDateTime(r.createdAt)} · {r.reason || t('detail.noReason')}
                    </Muted>
                  </View>
                  <Badge status={r.status} />
                </View>
              ))}
            </Card>
          )}

          <Card>
            <H2>{t('detail.history')}</H2>
            {detail.history.map((ev, i) => (
              <Row
                key={`${ev.at}-${i}`}
                label={formatDateTime(ev.at)}
                value={t(`event.${ev.type}`) + (ev.amountCents != null ? ` · ${formatCents(ev.amountCents)}` : '')}
              />
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function RefundForm({ detail, userId, onCreated }: { detail: PaymentDetail; userId: string; onCreated: (refundId: string) => void }) {
  const [amount, setAmount] = useState(() => centsToEuroInput(detail.refundableAmountCents));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  if (detail.status !== 'confirmed') {
    return (
      <Card>
        <H2>{t('refund.title')}</H2>
        <Notice tone="muted">{t('refund.onlyConfirmed')}</Notice>
      </Card>
    );
  }
  if (detail.refundableAmountCents <= 0) {
    return (
      <Card>
        <H2>{t('refund.title')}</H2>
        <Notice tone="muted">{t('refund.nothingLeft')}</Notice>
      </Card>
    );
  }

  const cents = parseEuroToCents(amount);
  const invalid = cents === null || cents <= 0 || cents > detail.refundableAmountCents;
  const trimmedReason = reason.trim() || null;
  const scope = `refund:${userId}:${detail.id}`;
  const unknown = isApiError(error) && error.unknownOutcome;
  const max = formatCents(detail.refundableAmountCents);

  async function submit() {
    if (invalid || busy || cents === null) return;
    setBusy(true);
    setError(null);
    setDone(null);
    // Same amount and reason = same intent = same key, so a retry after a lost
    // response can never create a second refund.
    const key = intentKey(scope, JSON.stringify({ cents, reason: trimmedReason }));
    try {
      const res = await api.refund(detail.id, cents, trimmedReason, key);
      clearIntent(scope);
      const msg = res.replayed ? t('refund.replayed') : t('refund.requested');
      setDone(msg);
      AccessibilityInfo.announceForAccessibility(msg);
      setReason('');
      onCreated(res.data.id);
    } catch (err) {
      // Keep the key when we do not know whether the refund was created.
      if (isApiError(err) && !err.unknownOutcome && !err.retryable) clearIntent(scope);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <H2>{t('refund.title')}</H2>
      <Field
        label={t('refund.amount', { max })}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        accessibilityHint={invalid ? t('refund.invalid', { max }) : undefined}
      />
      <Button label={t('refund.full')} onPress={() => setAmount(centsToEuroInput(detail.refundableAmountCents))} kind="ghost" style={{ alignSelf: 'flex-start', marginTop: -space.sm }} />
      {amount !== '' && invalid && <Notice tone="bad">{t('refund.invalid', { max })}</Notice>}
      <Field label={t('refund.reason')} value={reason} onChangeText={setReason} maxLength={200} placeholder={t('refund.reasonPlaceholder')} />
      {done && <Notice tone="ok">{done}</Notice>}
      {error !== null && (
        <Notice tone={unknown ? 'warn' : 'bad'}>
          {describeError(error)}
          {unknown ? ` ${t('refund.retrySafe')}` : ''}
        </Notice>
      )}
      <Button
        kind="danger"
        label={unknown ? t('refund.retry') : t('refund.submit', { amount: cents !== null && !invalid ? formatCents(cents) : '' })}
        onPress={submit}
        busy={busy}
        disabled={invalid}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: space.xxl },
  back: { alignSelf: 'flex-start', paddingHorizontal: 0, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.sm, gap: space.md },
  amount: { fontSize: 30, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  refund: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  refundAmount: { fontSize: 16, fontWeight: '700', color: colors.text },
});
