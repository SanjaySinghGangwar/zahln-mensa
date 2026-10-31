import { Component, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { t } from '@zahln/core';
import { colors, space } from '../theme';
import { Button } from './ui';

/**
 * Last line of defence: a rendering bug shows a calm screen with a way back
 * instead of closing the app. Money state is on the server and the
 * idempotency keys are on disk, so starting the screen again is safe.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Crash reporting would go here (see DESIGN.md §4).
    console.error('Screen crashed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title} accessibilityRole="header">
          {t('error.generic')}
        </Text>
        <Text style={styles.body}>{t('error.screenCrashed')}</Text>
        <Button kind="primary" label={t('common.retry')} onPress={() => this.setState({ error: null })} />
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: colors.bg },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, color: colors.muted },
});
