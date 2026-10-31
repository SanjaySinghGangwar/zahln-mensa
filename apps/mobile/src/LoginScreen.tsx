import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '@zahln/core';
import { useAuth } from './auth';
import { Button, Card, ErrorNotice, Field, H1, LanguageToggle, Muted, Notice } from './components/ui';
import { colors, space, TOUCH } from './theme';

// Test system: the seeded logins. Production would use the university's SSO.
const GROUPS: { title: 'login.payers' | 'login.cashiers'; users: string[] }[] = [
  { title: 'login.payers', users: ['student', 'staff', 'guest'] },
  {
    title: 'login.cashiers',
    users: ['cashier-campus-1', 'cashier-campus-2', 'cashier-campus-3', 'cashier-nord-1', 'cashier-nord-2', 'cashier-bibliothek-1'],
  },
];

export function LoginScreen() {
  const { login, sessionLost } = useAuth();
  const [username, setUsername] = useState('student');
  const [password, setPassword] = useState('test1234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    if (!username || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="Zahln Mensa">
            <View style={styles.mark}>
              <Text style={styles.markText}>Z</Text>
            </View>
            <Text style={styles.brandText}>Zahln Mensa</Text>
          </View>
          <LanguageToggle />
        </View>

        <Card>
          <H1>{t('login.title')}</H1>
          <Muted style={{ marginBottom: space.md }}>{t('login.subtitle')}</Muted>
          {sessionLost && <Notice tone="warn">{t('login.sessionEnded')}</Notice>}

          {GROUPS.map((g) => (
            <View key={g.title} style={{ marginBottom: space.md }}>
              <Text style={styles.groupTitle} accessibilityRole="header">
                {t(g.title)}
              </Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t(g.title)}>
                {g.users.map((u) => {
                  const on = u === username;
                  return (
                    <Pressable
                      key={u}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => setUsername(u)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{u}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          <Field label={t('login.user')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" />
          <Field label={t('login.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={submit} />

          {error !== null && <ErrorNotice error={error} />}
          <Button testID="login-submit" big kind="primary" label={busy ? t('login.busy') : t('login.submit')} busy={busy} onPress={submit} disabled={!username} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.lg, paddingTop: space.xl, flexGrow: 1, maxWidth: 560, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mark: { width: 36, height: 36, borderRadius: 9, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.accent, fontWeight: '900', fontSize: 20 },
  brandText: { fontSize: 20, fontWeight: '800', color: colors.text },
  groupTitle: { fontSize: 14, fontWeight: '700', color: colors.muted, marginBottom: space.xs, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: TOUCH - 4,
    paddingHorizontal: space.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 15, color: colors.text },
  chipTextOn: { color: colors.brandInk, fontWeight: '700' },
});
