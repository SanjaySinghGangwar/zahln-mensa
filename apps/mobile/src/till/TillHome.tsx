import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import {
  api,
  clearIntent,
  describeError,
  formatCents,
  GROUPS,
  groupLabel,
  intentKey,
  isApiError,
  localized,
  readCache,
  removeCache,
  t,
  writeCache,
  type Order,
  type OrderLineInput,
  type User,
} from '@zahln/core';
import { useCachedQuery } from '@zahln/core/react';
import { Button, Card, ErrorNotice, H1, H2, Muted, Notice, Spinner, StaleNotice, Tabs } from '../components/ui';
import { PaymentDetailScreen } from '../shared/PaymentDetailScreen';
import { PaymentsListView } from '../shared/PaymentsListView';
import { colors, space, TOUCH } from '../theme';
import { TillOrder } from './TillOrder';

type Screen = { kind: 'till' } | { kind: 'payment'; id: string };

export function TillHome({ user }: { user: User }) {
  // A till screen must not go dark while a student is scanning.
  useKeepAwake();
  const [tab, setTab] = useState<'till' | 'payments'>('till');
  const [screen, setScreen] = useState<Screen>({ kind: 'till' });
  const [reloadMenu, setReloadMenu] = useState(0);
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  // The cart and the order on screen survive an app restart.
  const cartKey = `till-cart:${user.tillId ?? ''}`;
  const orderKey = `till-order:${user.tillId ?? ''}`;
  const [cart, setCart] = useState<Record<string, number>>(() => readCache<Record<string, number>>(cartKey)?.data ?? {});
  const [order, setOrderState] = useState<Order | null>(() => readCache<Order>(orderKey)?.data ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  // Menu: shown at once from the saved copy, refreshed from the server.
  const menuQuery = useCachedQuery('mensas', (signal) => api.mensas(signal), reloadMenu);
  const mensa = menuQuery.data?.items.find((m) => m.id === user.mensaId) ?? null;
  const till = mensa?.tills.find((tl) => tl.id === user.tillId);
  const loadError = menuQuery.data ? null : menuQuery.error;

  useEffect(() => {
    writeCache(cartKey, cart);
  }, [cartKey, cart]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen.kind === 'payment') {
        setScreen({ kind: 'till' });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen]);

  function setOrder(o: Order | null) {
    if (o) writeCache(orderKey, o);
    else removeCache(orderKey);
    setOrderState(o);
  }

  const lines: OrderLineInput[] = useMemo(
    () => Object.entries(cart).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity })),
    [cart],
  );
  const totals = useMemo(() => {
    const sum = { student: 0, staff: 0, guest: 0 };
    for (const l of lines) {
      const item = mensa?.menu.find((m) => m.id === l.itemId);
      if (item) for (const g of GROUPS) sum[g] += item.prices[g] * l.quantity;
    }
    return sum;
  }, [lines, mensa]);

  const orderScope = `order:${user.id}:${user.tillId ?? ''}`;

  function changeQty(itemId: string, delta: number) {
    setSubmitError(null);
    setCart((c) => {
      const next = Math.max(0, Math.min(20, (c[itemId] ?? 0) + delta));
      const copy = { ...c };
      if (next === 0) delete copy[itemId];
      else copy[itemId] = next;
      return copy;
    });
  }

  async function ringUp() {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    // Same cart = same intent = same key. If the response is lost and the
    // cashier taps again, the server returns the original order, not a second one.
    const key = intentKey(orderScope, JSON.stringify(lines));
    try {
      const res = await api.createOrder(lines, key);
      clearIntent(orderScope);
      setOrder(res.data);
    } catch (e) {
      if (isApiError(e) && !e.unknownOutcome && !e.retryable) clearIntent(orderScope);
      setSubmitError(e);
    } finally {
      setSubmitting(false);
    }
  }

  function newOrder() {
    setOrder(null);
    setCart({});
  }

  function ringAgain() {
    // Same cart, new intent: the old order expired.
    clearIntent(orderScope);
    setOrder(null);
  }

  if (screen.kind === 'payment') return <PaymentDetailScreen paymentId={screen.id} user={user} onBack={() => setScreen({ kind: 'till' })} />;

  const header = (
    <View style={{ marginBottom: space.sm }}>
      <H1>{till?.name ?? t('till.title')}</H1>
      <Muted style={{ marginBottom: space.md }}>{mensa ? `${mensa.name} · ${mensa.city}` : t('common.loading')}</Muted>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'till', label: t('till.tab.till') },
          { id: 'payments', label: t('till.tab.payments') },
        ]}
      />
    </View>
  );

  if (tab === 'payments') {
    return <PaymentsListView cacheKey="till-payments" header={header} onOpen={(id) => setScreen({ kind: 'payment', id })} />;
  }

  if (order) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>{header}</View>
        <TillOrder
          key={order.id}
          initial={order}
          onOrderChange={(o) => writeCache(orderKey, o)}
          onNewOrder={newOrder}
          onRingAgain={ringAgain}
          onOpenPayment={(id) => setScreen({ kind: 'payment', id })}
        />
      </View>
    );
  }

  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const unknown = isApiError(submitError) && submitError.unknownOutcome;

  return (
    <ScrollView contentContainerStyle={[styles.wrap]} keyboardShouldPersistTaps="handled">
      {header}
      <View style={wide ? styles.grid : undefined}>
        <Card style={wide ? { flex: 1 } : undefined}>
          <H2>{t('till.menu')}</H2>
          {menuQuery.stale && <StaleNotice savedAt={menuQuery.savedAt} onRetry={() => setReloadMenu((n) => n + 1)} />}
          {loadError !== null && <ErrorNotice error={loadError} onRetry={() => setReloadMenu((n) => n + 1)} />}
          {!mensa && loadError === null && menuQuery.loading && <Spinner />}
          {mensa && mensa.menu.length === 0 && <Notice>{t('till.noMenu')}</Notice>}
          {mensa?.menu.map((item) => {
            const qty = cart[item.id] ?? 0;
            const name = localized(item.name);
            return (
              <View key={item.id} style={[styles.item, qty > 0 && styles.itemOn]}>
                <View style={{ flex: 1 }} accessible accessibilityLabel={`${name}. ${GROUPS.map((g) => `${groupLabel(g)} ${formatCents(item.prices[g])}`).join(', ')}`}>
                  <Text style={styles.itemName}>{name}</Text>
                  <Text style={styles.prices}>{GROUPS.map((g) => `${groupLabel(g)} ${formatCents(item.prices[g])}`).join('  ·  ')}</Text>
                </View>
                <View style={styles.stepper}>
                  <StepButton label="−" a11y={t('till.remove', { item: name })} onPress={() => changeQty(item.id, -1)} disabled={qty === 0} />
                  <Text style={styles.qty} accessibilityLabel={t('till.quantity', { count: qty })} accessibilityLiveRegion="polite">
                    {qty}
                  </Text>
                  <StepButton label="+" a11y={t('till.add', { item: name })} onPress={() => changeQty(item.id, 1)} dark />
                </View>
              </View>
            );
          })}
        </Card>

        <Card style={wide ? { width: 340 } : undefined}>
          <H2>{t('till.currentOrder')}</H2>
          {lines.length === 0 ? (
            <Muted>{t('till.tapToAdd')}</Muted>
          ) : (
            <>
              <Muted small>{t('common.items', { count: itemCount })}</Muted>
              {lines.map((l) => {
                const item = mensa?.menu.find((m) => m.id === l.itemId);
                return (
                  <Text key={l.itemId} style={styles.cartLine}>
                    {l.quantity}× {item ? localized(item.name) : l.itemId}
                  </Text>
                );
              })}
            </>
          )}
          <View style={{ marginVertical: space.md }}>
            <Muted small>{t('till.totals')}</Muted>
            {GROUPS.map((g) => (
              <View key={g} style={styles.groupRow} accessible accessibilityLabel={`${groupLabel(g)}: ${formatCents(totals[g])}`}>
                <Text style={styles.groupLabel}>{groupLabel(g)}</Text>
                <Text style={styles.groupValue}>{formatCents(totals[g])}</Text>
              </View>
            ))}
            <Muted small>{t('till.groupDecides')}</Muted>
          </View>

          {submitError !== null && (
            <Notice tone={unknown ? 'warn' : 'bad'}>
              {describeError(submitError)}
              {isApiError(submitError) && submitError.retryable ? ` ${t('till.retrySafe')}` : ''}
            </Notice>
          )}
          <Button
            big
            kind="primary"
            label={submitting ? t('till.creating') : submitError ? t('common.retry') : t('till.ringUp')}
            busy={submitting}
            onPress={ringUp}
            disabled={lines.length === 0 || !mensa}
          />
          <Button label={t('till.clear')} onPress={() => setCart({})} disabled={lines.length === 0 || submitting} style={{ marginTop: space.sm }} />
        </Card>
      </View>
    </ScrollView>
  );
}

function StepButton({ label, a11y, onPress, disabled, dark }: { label: string; a11y: string; onPress: () => void; disabled?: boolean; dark?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.step, dark && styles.stepDark, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.stepText, dark && { color: colors.brandInk }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: space.xxl },
  grid: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    borderRadius: 8,
  },
  itemOn: { backgroundColor: colors.accentSoft },
  itemName: { fontSize: 17, fontWeight: '600', color: colors.text },
  prices: { fontSize: 14, color: colors.muted, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  step: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepDark: { backgroundColor: colors.brand, borderColor: colors.brand },
  stepText: { fontSize: 24, fontWeight: '700', color: colors.text, lineHeight: 28 },
  qty: { minWidth: 28, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  cartLine: { fontSize: 16, color: colors.text, paddingVertical: 3 },
  groupRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  groupLabel: { fontSize: 16, color: colors.text },
  groupValue: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
});
