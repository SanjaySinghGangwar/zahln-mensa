import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@zahln/core';
import { useLanguage } from '@zahln/core/react';
import { AuthProvider, useAuth } from './auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Badge, Button, LanguageToggle } from './components/ui';
import { LoginScreen } from './LoginScreen';
import { PayerHome } from './payer/PayerHome';
import { boot } from './platform/boot';
import { startDeepLinks } from './platform/deepLink';
import { useKeyboardInset } from './platform/keyboard';
import { colors, space } from './theme';
import { TillHome } from './till/TillHome';

boot();
startDeepLinks();

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  // Re-render every screen when the language changes.
  useLanguage();
  const { session, logout } = useAuth();
  // Edge to edge: Android does not resize the window for the keyboard any more,
  // so the content is lifted above it here, and drops back when it closes.
  const insets = useSafeAreaInsets();
  const keyboard = Math.max(0, useKeyboardInset() - insets.bottom);

  return (
    <SafeAreaView style={[styles.safe, { paddingBottom: keyboard }]} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={session ? 'light' : 'dark'} />
      {session ? (
        <>
          <View style={styles.topbar}>
            <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel={`Zahln Mensa, ${session.user.displayName}`}>
              <View style={styles.mark}>
                <Text style={styles.markText}>Z</Text>
              </View>
              <Badge status="role" label={t(`role.${session.user.role}`)} />
            </View>
            <View style={styles.right}>
              <LanguageToggle dark />
              <Button label={t('common.logout')} onPress={logout} kind="onDark" />
            </View>
          </View>
          <View style={styles.body}>
            <ErrorBoundary key={session.user.id}>
              {session.user.role === 'cashier' ? (
                <TillHome user={session.user} />
              ) : (
                <PayerHome user={session.user} onLocked={logout} />
              )}
            </ErrorBoundary>
          </View>
        </>
      ) : (
        <LoginScreen />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 3,
    borderBottomColor: colors.accent,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mark: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.accentInk, fontWeight: '900', fontSize: 18 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  body: { flex: 1 },
});
