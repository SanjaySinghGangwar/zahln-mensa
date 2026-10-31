import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import {
  api,
  formatCents,
  formatDateTime,
  isAbort,
  localized,
  readCache,
  t,
  writeCache,
  type Payment,
} from '@zahln/core';
import { Badge, ErrorNotice, Muted, StaleNotice } from '../components/ui';
import { colors, space, TOUCH } from '../theme';

/**
 * Paged list of payments. The server already limits it to what this user may
 * see: a payer sees their own payments, a cashier the payments of their till.
 */
export function PaymentsListView({ onOpen, header, cacheKey }: { onOpen: (id: string) => void; header?: ReactElement; cacheKey: string }) {
  const [items, setItems] = useState<Payment[]>(() => readCache<Payment[]>(cacheKey)?.data ?? []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(
    async (fromCursor: string | null) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      setError(null);
      try {
        const page = await api.listPayments({ limit: 30, cursor: fromCursor ?? undefined }, c.signal);
        setItems((prev) => {
          if (!fromCursor) return page.items;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setCursor(page.nextCursor);
        setStaleSince(null);
        if (!fromCursor) writeCache(cacheKey, page.items);
      } catch (e) {
        if (isAbort(e)) return;
        const cached = readCache<Payment[]>(cacheKey);
        if (!fromCursor && cached) setStaleSince(cached.savedAt);
        else setError(e);
      } finally {
        if (ctrl.current === c) setLoading(false);
      }
    },
    [cacheKey],
  );

  useEffect(() => {
    void load(null);
    return () => ctrl.current?.abort();
  }, [load]);

  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => load(null)} />}
      ListHeaderComponent={
        <>
          {header}
          {staleSince !== null && <StaleNotice savedAt={staleSince} onRetry={() => load(null)} />}
          {error !== null && <ErrorNotice error={error} onRetry={() => load(cursor)} />}
        </>
      }
      ListEmptyComponent={!loading && error === null ? <Muted style={{ textAlign: 'center', marginTop: space.xl }}>{t('history.empty')}</Muted> : undefined}
      onEndReached={() => cursor && !loading && load(cursor)}
      onEndReachedThreshold={0.4}
      initialNumToRender={10}
      windowSize={7}
      removeClippedSubviews
      renderItem={({ item: p }) => <PaymentRow p={p} onPress={() => onOpen(p.id)} />}
      ListFooterComponent={loading ? <Muted style={{ textAlign: 'center', padding: space.lg }}>{t('common.loading')}</Muted> : undefined}
    />
  );
}

function PaymentRow({ p, onPress }: { p: Payment; onPress: () => void }) {
  const items = p.items.map((i) => `${i.quantity}× ${localized(i.name)}`).join(', ');
  const status = t(`status.${p.status}`);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${formatCents(p.amountCents)}, ${status}, ${p.mensa.name}, ${formatDateTime(p.createdAt)}. ${items}`}
      style={({ pressed }) => [styles.row, p.needsAttention && styles.attention, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.amount}>{formatCents(p.amountCents)}</Text>
        <Text style={styles.items} numberOfLines={1}>
          {items}
        </Text>
        <Muted small>
          {p.mensa.name} · {p.till.name} · {formatDateTime(p.createdAt)}
        </Muted>
        {p.refundedAmountCents > 0 && <Muted small>{`${t('detail.refunded')}: ${formatCents(p.refundedAmountCents)}`}</Muted>}
      </View>
      <Badge status={p.status} label={p.status === 'pending' ? t('history.stillChecking') : undefined} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TOUCH + 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: space.md,
    marginBottom: space.sm,
  },
  attention: { borderLeftWidth: 4, borderLeftColor: colors.warn },
  amount: { fontSize: 18, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  items: { fontSize: 14, color: colors.text },
});
