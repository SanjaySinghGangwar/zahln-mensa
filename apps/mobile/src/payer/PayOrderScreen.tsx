import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  api,
  classifyPayFailure,
  clearIntent,
  coreConfig,
  describeError,
  formatCents,
  formatCountdown,
  groupLabel,
  intentKey,
  isAbort,
  isApiError,
  keepKeyAfter,
  loadIntent,
  localized,
  paymentToFollow,
  payScreen,
  pickNewer,
  t,
  updateIntent,
  versionAtLeast,
  type AppConfig,
  type Order,
  type Payment,
  type User,
} from '@zahln/core';
import { usePolling, useServerNow } from '@zahln/core/react';
import { Badge, Button, Card, ErrorNotice, H1, H2, Muted, Notice, Spinner } from '../components/ui';
import { colors, space } from '../theme';
import { confirmMethod, confirmWithSystem } from './confirm';
import { PinSheet } from './PinSheet';

interface Props {
  orderId: string;
  user: User;
  config: AppConfig | null;
  refreshConfig: () => Promise<AppConfig | null>;
  onClose: () => void;
  /** Called when the app PIN was entered wrong too often. */
  onLocked: () => void;
}

export function PayOrderScreen({ orderId, user, config, refreshConfig, onClose, onLocked }: Props) {
  // One scope per user and order: the Idempotency-Key for this payment lives here.
  const scope = `pay:${user.id}:${orderId}`;
  const now = useServerNow();

  const [order, setOrder] = useState<Order | null>(null);
  const [orderError, setOrderError] = useState<unknown>(null);
  // A payment started earlier (before the app was killed, or before a lost
  // response) is followed instead of offering "Pay" again.
  const [paymentId, setPaymentId] = useState<string | null>(() => loadIntent(scope)?.paymentId ?? null);
  const [resumed] = useState(() => !!loadIntent(scope)?.paymentId);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [pollIssue, setPollIssue] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<{ resolve: (ok: boolean) => void } | null>(null);

  const screen = payScreen({ order, orderFailed: orderError !== null, paymentId, payment, now });
  const final = screen.kind === 'confirmed' || screen.kind === 'declined' || screen.kind === 'paid' || screen.kind === 'expired';

  // ---- Order polling: stops once the order (or our payment) is final.
  usePolling(
    async (signal) => {
      try {
        const o = await api.getOrder(orderId, signal);
        setOrder((prev) => pickNewer(prev, o));
        setOrderError(null);
        // For a payer, the order only ever points at their own payment.
        const follow = paymentToFollow(o);
        if (follow) setPaymentId((p) => p ?? follow);
        if (o.status === 'paid' || o.status === 'expired') return 'stop';
      } catch (e) {
        if (!isAbort(e)) setOrderError(e);
        if (isApiError(e) && e.code === 'not_found') return 'stop';
      }
    },
    2000,
    !final,
  );

  // ---- Payment polling: until confirmed or declined. Slower when it takes long.
  usePolling(
    async (signal) => {
      if (!paymentId) return 'stop';
      try {
        const p = await api.getPayment(paymentId, signal);
        setPayment((prev) => pickNewer(prev, p));
        setPollIssue(false);
        if (p.status !== 'pending') {
          // The outcome is final: the next attempt (after a decline) needs a new key.
          clearIntent(scope);
          if (p.status === 'declined') void reloadOrder();
          return 'stop';
        }
      } catch (e) {
        if (!isAbort(e)) setPollIssue(true);
      }
    },
    screen.kind === 'checking' && screen.slow ? 5000 : 1500,
    paymentId !== null && screen.kind !== 'confirmed' && screen.kind !== 'declined',
  );

  // Tell screen-reader users and give a buzz when the result is in.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (screen.kind === announced.current) return;
    if (screen.kind === 'confirmed') {
      announced.current = screen.kind;
      AccessibilityInfo.announceForAccessibility(t('pay.paidTitle', { amount: formatCents(screen.payment.amountCents) }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (screen.kind === 'declined') {
      announced.current = screen.kind;
      AccessibilityInfo.announceForAccessibility(`${t('pay.declinedTitle')}. ${t('pay.declinedHint')}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [screen]);

  async function reloadOrder(): Promise<Order | null> {
    try {
      const o = await api.getOrder(orderId);
      setOrder((prev) => pickNewer(prev, o));
      return o;
    } catch {
      return null;
    }
  }

  function askPin(): Promise<boolean> {
    return new Promise((resolve) => setPinFor({ resolve }));
  }

  async function pay() {
    if (!order || order.amountCents == null || paying) return;
    const amount = order.amountCents;
    setPaying(true);
    setPayError(null);
    setNotice(null);
    try {
      // Read the remote switches right before paying; fall back to the last known copy.
      const cfg = await refreshConfig();
      if (cfg && !cfg.paymentsEnabled) return setNotice(t('pay.paused'));
      if (cfg && !versionAtLeast(coreConfig.appVersion, cfg.minAppVersion))
        return setNotice(t('pay.updateRequired', { version: coreConfig.appVersion, min: cfg.minAppVersion }));

      const label = formatCents(amount);
      const confirmed = (await confirmMethod()) === 'system' ? await confirmWithSystem(label) : await askPin();
      if (!confirmed) return setNotice(t('pay.authFailed'));

      // One key per (order, amount). Every retry — automatic or by tapping again
      // after an unclear result — reuses it, so the server never charges twice.
      const key = intentKey(scope, String(amount));
      const res = await api.payOrder(order.id, amount, key);
      updateIntent(scope, { paymentId: res.data.id });
      setPayment((prev) => pickNewer(prev, res.data));
      setPaymentId(res.data.id);
    } catch (e) {
      await handlePayError(e);
    } finally {
      setPaying(false);
    }
  }

  async function handlePayError(e: unknown) {
    const failure = classifyPayFailure(e);
    if (!keepKeyAfter(failure)) clearIntent(scope);
    switch (failure.kind) {
      case 'reprice':
        await reloadOrder();
        setNotice(t('pay.priceUpdated'));
        return;
      case 'follow':
      case 'uncertain': {
        // The payment may exist although we got no answer: look before asking to retry.
        const o = await reloadOrder();
        const follow = o ? paymentToFollow(o) : null;
        if (follow) {
          updateIntent(scope, { paymentId: follow });
          setPaymentId(follow);
          return;
        }
        setPayError(e);
        return;
      }
      default:
        await reloadOrder();
        setPayError(e);
    }
  }

  function tryAgainAfterDecline() {
    setPaymentId(null);
    setPayment(null);
    setPayError(null);
    announced.current = null;
    void reloadOrder();
  }

  const outdated = config !== null && !versionAtLeast(coreConfig.appVersion, config.minAppVersion);
  const paused = config !== null && !config.paymentsEnabled;

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Button label={`← ${t('pay.otherOrder')}`} onPress={onClose} kind="ghost" style={styles.back} />

      {screen.kind === 'loading' && <Spinner />}
      {screen.kind === 'load-error' && (
        <Card>
          <ErrorNotice error={orderError} onRetry={() => void reloadOrder().then((o) => o && setOrderError(null))} />
        </Card>
      )}

      {order && (
        <Card>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <H1>{order.mensa.name}</H1>
              <Muted>{order.till.name}</Muted>
            </View>
            {order.priceGroup && <Badge status="info" label={t('group.price', { group: groupLabel(order.priceGroup) })} />}
          </View>

          <View accessibilityRole="list">
            {order.items.map((l) => (
              <View key={l.itemId} style={styles.line} accessible>
                <Text style={styles.qty}>{l.quantity}×</Text>
                <Text style={styles.item}>{localized(l.name)}</Text>
                <Text style={styles.price}>{l.unitPriceCents != null ? formatCents(l.unitPriceCents * l.quantity) : ''}</Text>
              </View>
            ))}
          </View>

          <View style={styles.total} accessible accessibilityLabel={`${t('common.total')}: ${formatCents(order.amountCents)}`}>
            <Text style={styles.totalLabel}>{t('common.total')}</Text>
            <Text style={styles.totalValue}>{formatCents(order.amountCents)}</Text>
          </View>

          {orderError !== null && <Notice tone="warn">{t('common.connectionIssue')}</Notice>}
          {resumed && screen.kind === 'checking' && <Notice tone="info">{t('pay.resumed')}</Notice>}
          {notice && <Notice tone="warn">{notice}</Notice>}
          {outdated && <Notice tone="bad">{t('pay.updateRequired', { version: coreConfig.appVersion, min: config?.minAppVersion ?? '' })}</Notice>}
          {paused && <Notice tone="warn">{t('pay.paused')}</Notice>}

          <Result
            screen={screen}
            pollIssue={pollIssue}
            onTryAgain={tryAgainAfterDecline}
            onDone={onClose}
          />

          {screen.kind === 'payable' && (
            <>
              <Muted style={styles.center} >{t('pay.expiresIn', { time: formatCountdown(screen.msLeft) })}</Muted>
              {payError !== null && (
                <Notice tone={isApiError(payError) && payError.unknownOutcome ? 'warn' : 'bad'}>
                  {describeError(payError)}
                  {isApiError(payError) && payError.retryable ? ` ${t('pay.retrySafe')}` : ''}
                </Notice>
              )}
              <Button
                testID="pay-button"
                big
                kind="primary"
                label={paying ? t('pay.paying') : t('pay.payButton', { amount: formatCents(order.amountCents) })}
                busy={paying}
                onPress={pay}
                disabled={outdated || paused || order.amountCents == null}
                accessibilityHint={t('pay.confirmBiometric')}
              />
            </>
          )}
        </Card>
      )}

      {pinFor && (
        <PinSheet
          userId={user.id}
          amount={formatCents(order?.amountCents)}
          onDone={(ok) => {
            pinFor.resolve(ok);
            setPinFor(null);
          }}
          onLocked={() => {
            pinFor.resolve(false);
            setPinFor(null);
            onLocked();
          }}
        />
      )}
    </ScrollView>
  );
}

function Result({
  screen,
  pollIssue,
  onTryAgain,
  onDone,
}: {
  screen: ReturnType<typeof payScreen>;
  pollIssue: boolean;
  onTryAgain: () => void;
  onDone: () => void;
}) {
  switch (screen.kind) {
    case 'confirmed':
      return (
        <View style={[styles.result, { backgroundColor: colors.okSoft }]} accessibilityLiveRegion="assertive">
          <Text style={[styles.icon, { color: colors.ok }]} importantForAccessibility="no">
            ✓
          </Text>
          <H2 style={{ color: colors.ok }}>{t('pay.paidTitle', { amount: formatCents(screen.payment.amountCents) })}</H2>
          <Muted style={styles.center}>{t('pay.paidHint')}</Muted>
          <Text style={styles.mono} selectable>
            {screen.payment.id}
          </Text>
          <Button label={t('pay.done')} onPress={onDone} kind="primary" style={{ alignSelf: 'stretch' }} />
        </View>
      );
    case 'declined':
      return (
        <View style={[styles.result, { backgroundColor: colors.badSoft }]} accessibilityLiveRegion="assertive">
          <Text style={[styles.icon, { color: colors.bad }]} importantForAccessibility="no">
            ✕
          </Text>
          <H2 style={{ color: colors.bad }}>{t('pay.declinedTitle')}</H2>
          <Muted>{t('pay.declinedHint')}</Muted>
          {screen.canRetry ? (
            <Button label={t('common.retry')} onPress={onTryAgain} kind="primary" style={{ alignSelf: 'stretch' }} />
          ) : (
            <Button label={t('pay.done')} onPress={onDone} style={{ alignSelf: 'stretch' }} />
          )}
        </View>
      );
    case 'checking':
      return (
        <View style={[styles.result, { backgroundColor: colors.warnSoft }]} accessibilityLiveRegion="polite">
          <Spinner />
          <H2>{t('pay.checking')}</H2>
          <Muted style={styles.center}>{screen.slow ? t('pay.checkingSlow') : t('pay.checkingUsual')}</Muted>
          {pollIssue && <Muted small>{t('pay.checkingNetwork')}</Muted>}
        </View>
      );
    case 'paid':
      return <Notice tone="ok">{t('pay.alreadyPaid')}</Notice>;
    case 'expired':
      return <Notice tone="bad">{t('pay.expired')}</Notice>;
    case 'busy-other':
      return <Notice tone="warn">{t('pay.otherPaymentChecking')}</Notice>;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: space.xxl },
  back: { alignSelf: 'flex-start', paddingHorizontal: 0, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.md },
  line: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  qty: { width: 36, color: colors.muted, fontSize: 16 },
  item: { flex: 1, color: colors.text, fontSize: 16 },
  price: { color: colors.text, fontSize: 16, fontVariant: ['tabular-nums'] },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginVertical: space.lg },
  totalLabel: { fontSize: 17, color: colors.muted },
  totalValue: { fontSize: 32, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  center: { textAlign: 'center', marginBottom: space.sm },
  result: { alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: 12, marginTop: space.sm },
  icon: { fontSize: 44, fontWeight: '800' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: colors.muted },
});
