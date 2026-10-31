import { useCallback, useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { api, coreConfig, groupLabel, t, versionAtLeast, writeCache, type AppConfig, type User } from '@zahln/core';
import { useCachedQuery } from '@zahln/core/react';
import { H1, Muted, Notice, Tabs } from '../components/ui';
import { PaymentDetailScreen } from '../shared/PaymentDetailScreen';
import { PaymentsListView } from '../shared/PaymentsListView';
import { onPendingOrder, takePendingOrder } from '../platform/deepLink';
import { space } from '../theme';
import { PayOrderScreen } from './PayOrderScreen';
import { ScanCard } from './ScanCard';

type Screen = { kind: 'home' } | { kind: 'order'; id: string } | { kind: 'payment'; id: string };

export function PayerHome({ user, onLocked }: { user: User; onLocked: () => void }) {
  const [tab, setTab] = useState<'pay' | 'history'>('pay');
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });

  // Remote config: the saved copy is used at once and when the server fails.
  const configQuery = useCachedQuery('config', (signal) => api.config(signal));
  const [freshConfig, setFreshConfig] = useState<AppConfig | null>(null);
  const config = freshConfig ?? configQuery.data;

  const refreshConfig = useCallback(async (): Promise<AppConfig | null> => {
    try {
      const c = await api.config();
      writeCache('config', c);
      setFreshConfig(c);
      return c;
    } catch {
      return config;
    }
  }, [config]);

  // A till QR scanned with the phone's own camera (zahln://pay?order=…) opens that order.
  useEffect(() => {
    const open = () => {
      const id = takePendingOrder();
      if (id) {
        setTab('pay');
        setScreen({ kind: 'order', id });
      }
    };
    open();
    return onPendingOrder(open);
  }, []);

  // Android back button goes back inside the app before leaving it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen.kind === 'home') return false;
      setScreen({ kind: 'home' });
      return true;
    });
    return () => sub.remove();
  }, [screen]);

  if (screen.kind === 'order')
    return (
      <PayOrderScreen
        key={screen.id}
        orderId={screen.id}
        user={user}
        config={config}
        refreshConfig={refreshConfig}
        onClose={() => setScreen({ kind: 'home' })}
        onLocked={onLocked}
      />
    );
  if (screen.kind === 'payment') return <PaymentDetailScreen paymentId={screen.id} user={user} onBack={() => setScreen({ kind: 'home' })} />;

  const outdated = config !== null && !versionAtLeast(coreConfig.appVersion, config.minAppVersion);
  const header = (
    <View>
      <H1>{t('pay.hello', { name: user.displayName })}</H1>
      {user.priceGroup && <Muted style={{ marginBottom: space.md }}>{t('pay.youPay', { group: groupLabel(user.priceGroup) })}</Muted>}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'pay', label: t('pay.tab.pay') },
          { id: 'history', label: t('pay.tab.history') },
        ]}
      />
      {outdated && <Notice tone="bad">{t('pay.updateRequired', { version: coreConfig.appVersion, min: config?.minAppVersion ?? '' })}</Notice>}
      {config && !config.paymentsEnabled && <Notice tone="warn">{t('pay.paused')}</Notice>}
    </View>
  );

  if (tab === 'history') {
    return <PaymentsListView cacheKey="history" header={header} onOpen={(id) => setScreen({ kind: 'payment', id })} />;
  }
  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      {header}
      <ScanCard onOrder={(id) => setScreen({ kind: 'order', id })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingBottom: space.xxl },
});
