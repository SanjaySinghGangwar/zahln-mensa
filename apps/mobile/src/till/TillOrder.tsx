import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  api,
  formatCents,
  formatCountdown,
  GROUPS,
  groupLabel,
  isAbort,
  localized,
  pickNewer,
  t,
  type Order,
  type Payment,
} from '@zahln/core';
import { usePolling, useServerNow } from '@zahln/core/react';
import { Badge, Button, Card, H1, H2, Muted, Notice, Spinner } from '../components/ui';
import { colors, space } from '../theme';
import { QrCode } from './QrCode';

interface Props {
  initial: Order;
  onOrderChange: (o: Order) => void;
  onNewOrder: () => void;
  onRingAgain: () => void;
  onOpenPayment: (paymentId: string) => void;
}

/**
 * Shows the QR and follows the order until the server says it is paid or expired.
 * "Paid" is only shown when the *order* is `paid` — never because a payment
 * was started — so the cashier never hands out food on a payment still being checked.
 */
export function TillOrder({ initial, onOrderChange, onNewOrder, onRingAgain, onOpenPayment }: Props) {
  const [order, setOrder] = useState<Order>(initial);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const now = useServerNow(500);
  const { width, height } = useWindowDimensions();
  const wide = width >= 700;

  const final = order.status === 'paid' || order.status === 'expired';

  usePolling(
    async (signal) => {
      try {
        const o = await api.getOrder(order.id, signal);
        setOrder((prev) => pickNewer(prev, o));
        setConnectionIssue(false);
        if (o.status === 'paid' || o.status === 'expired') return 'stop';
      } catch (e) {
        if (!isAbort(e)) setConnectionIssue(true);
      }
    },
    order.status === 'paying' ? 1000 : 1500,
    !final,
  );

  // Keep the till's saved copy current, so a restart resumes this order.
  const changeRef = useRef(onOrderChange);
  changeRef.current = onOrderChange;
  useEffect(() => {
    changeRef.current(order);
  }, [order]);

  // Once paid, read the payment to show the amount and price group that was charged.
  useEffect(() => {
    if (order.status !== 'paid' || !order.paymentId || payment) return;
    const c = new AbortController();
    api.getPayment(order.paymentId, c.signal).then(setPayment, () => undefined);
    return () => c.abort();
  }, [order.status, order.paymentId, payment]);

  const announced = useRef(false);
  useEffect(() => {
    if (order.status === 'paid' && !announced.current) {
      announced.current = true;
      AccessibilityInfo.announceForAccessibility(t('till.paidTitle'));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [order.status]);

  const msLeft = Date.parse(order.expiresAt) - now;
  const count = order.items.reduce((n, l) => n + l.quantity, 0);

  if (order.status === 'paid') {
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Card style={[styles.result, { backgroundColor: colors.okSoft, borderColor: colors.ok }]}>
          <Text style={[styles.bigIcon, { color: colors.ok }]} importantForAccessibility="no">
            ✓
          </Text>
          <H1 style={{ color: colors.ok, fontSize: 40 }}>{t('till.paidTitle')}</H1>
          {payment && (
            <Text style={styles.paidBy}>{t('till.paidBy', { amount: formatCents(payment.amountCents), group: groupLabel(payment.priceGroup) })}</Text>
          )}
          <Muted>
            {t('till.orderRef')}: {order.id}
          </Muted>
          <View style={styles.actions}>
            {order.paymentId && <Button label={t('till.viewPayment')} onPress={() => onOpenPayment(order.paymentId as string)} />}
            <Button label={t('till.nextOrder')} onPress={onNewOrder} kind="primary" big />
          </View>
        </Card>
      </ScrollView>
    );
  }

  if (order.status === 'expired') {
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Card style={styles.result}>
          <Text style={[styles.bigIcon, { color: colors.muted }]} importantForAccessibility="no">
            ⏱
          </Text>
          <H1>{t('till.expiredTitle')}</H1>
          <Muted>{t('till.expiredHint')}</Muted>
          <View style={styles.actions}>
            <Button label={t('till.startOver')} onPress={onNewOrder} />
            <Button label={t('till.ringAgain')} onPress={onRingAgain} kind="primary" />
          </View>
        </Card>
      </ScrollView>
    );
  }

  // Fit the QR on screen under the header in both orientations.
  const qrSize = Math.max(200, Math.min(wide ? height - 420 : width - 2 * space.xl - 2 * space.lg, 420));

  return (
    <ScrollView contentContainerStyle={[styles.wrap, wide && styles.wide]}>
      <Card style={[styles.qrCard, wide && { flex: 1 }]}>
        <View style={styles.qrHead} accessibilityLiveRegion="polite">
          <Badge status={order.status} />
          {order.status === 'open' && (
            <Text style={[styles.countdown, msLeft < 60_000 && { color: colors.bad }]}>
              {msLeft > 0 ? t('pay.expiresIn', { time: formatCountdown(msLeft) }) : t('till.expiring')}
            </Text>
          )}
        </View>
        <View style={styles.qrFrame}>
          <QrCode value={order.qrPayload} size={qrSize} label={t('till.qrA11y', { id: order.id })} dim={order.status === 'paying'} />
          {order.status === 'paying' && (
            <View style={styles.qrOverlay}>
              <Spinner />
            </View>
          )}
        </View>
        {order.status === 'open' && <Text style={styles.hint}>{t('till.scanToPay')}</Text>}
        {order.status === 'paying' && <Notice tone="warn">{t('till.beingChecked')}</Notice>}
        {connectionIssue && <Notice tone="warn">{t('common.connectionIssue')}</Notice>}
        <Muted small style={{ textAlign: 'center' }}>
          {t('till.orderRef')}: {order.id}
        </Muted>
      </Card>

      <Card style={wide ? { width: 340 } : undefined}>
        <H2>{t('common.items', { count })}</H2>
        {order.items.map((l) => (
          <Text key={l.itemId} style={styles.line}>
            {l.quantity}× {localized(l.name)}
          </Text>
        ))}
        {order.amounts && (
          <View style={{ marginVertical: space.md }}>
            <Muted small>{t('till.totals')}</Muted>
            {GROUPS.map((g) => (
              <View key={g} style={styles.groupRow} accessible accessibilityLabel={`${groupLabel(g)}: ${formatCents(order.amounts?.[g])}`}>
                <Text style={styles.groupLabel}>{groupLabel(g)}</Text>
                <Text style={styles.groupValue}>{formatCents(order.amounts?.[g])}</Text>
              </View>
            ))}
          </View>
        )}
        <Button label={t('till.cancelOrder')} onPress={onNewOrder} disabled={order.status === 'paying'} />
        {order.status === 'paying' && <Muted small style={{ marginTop: space.sm }}>{t('till.cannotCancel')}</Muted>}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: space.xxl },
  wide: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  result: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl },
  bigIcon: { fontSize: 72, fontWeight: '800' },
  paidBy: { fontSize: 20, fontWeight: '600', color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.lg, justifyContent: 'center' },
  qrCard: { alignItems: 'center' },
  qrHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginBottom: space.md },
  countdown: { fontSize: 16, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  qrFrame: { padding: space.md, borderWidth: 4, borderColor: colors.accent, borderRadius: 16, backgroundColor: '#fff' },
  qrOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: space.md, textAlign: 'center' },
  line: { fontSize: 16, color: colors.text, paddingVertical: 4 },
  groupRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  groupLabel: { fontSize: 16, color: colors.text },
  groupValue: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
});
