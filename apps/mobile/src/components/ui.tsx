import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { describeError, formatTime, t, type Lang, type MessageKey } from '@zahln/core';
import { useLanguage } from '@zahln/core/react';
import { chooseLanguage } from '../platform/boot';
import { colors, radius, space, STATUS_TONE, toneColors, TOUCH, type Tone } from '../theme';

export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text accessibilityRole="header" style={[styles.h1, style]}>
      {children}
    </Text>
  );
}

export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text accessibilityRole="header" style={[styles.h2, style]}>
      {children}
    </Text>
  );
}

export function Muted({ children, style, small }: { children: ReactNode; style?: StyleProp<TextStyle>; small?: boolean }) {
  return <Text style={[styles.muted, small && styles.small, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'onDark';

export function Button({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  busy,
  big,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: {
  testID?: string;
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  const k = buttonKinds[kind];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, big && styles.btnBig, { backgroundColor: k.bg, borderColor: k.border }, off && styles.off, pressed && styles.pressed, style]}
    >
      {busy ? <ActivityIndicator color={k.fg} style={{ marginRight: space.sm }} /> : null}
      <Text style={[styles.btnText, big && styles.btnTextBig, { color: k.fg }]}>{label}</Text>
    </Pressable>
  );
}

const buttonKinds: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.brand, fg: colors.brandInk, border: colors.brand },
  secondary: { bg: colors.surface, fg: colors.text, border: colors.line },
  danger: { bg: colors.bad, fg: '#ffffff', border: colors.bad },
  ghost: { bg: 'transparent', fg: colors.text, border: 'transparent' },
  onDark: { bg: 'transparent', fg: '#ffffff', border: 'rgba(255,255,255,0.35)' },
};

export function Notice({ tone = 'info', children, action }: { tone?: Tone; children: ReactNode; action?: ReactNode }) {
  const c = toneColors[tone];
  return (
    <View
      style={[styles.notice, { backgroundColor: c.bg, borderLeftColor: c.fg }]}
      accessibilityLiveRegion={tone === 'bad' ? 'assertive' : 'polite'}
      accessibilityRole={tone === 'bad' ? 'alert' : 'text'}
    >
      <Text style={[styles.noticeText, { color: tone === 'muted' ? colors.text : c.fg }]}>{children}</Text>
      {action}
    </View>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Notice tone="bad" action={onRetry ? <Button label={t('common.retry')} onPress={onRetry} style={{ marginTop: space.sm }} /> : undefined}>
      {describeError(error)}
    </Notice>
  );
}

export function StaleNotice({ savedAt, onRetry }: { savedAt: number | null; onRetry?: () => void }) {
  return (
    <Notice tone="warn" action={onRetry ? <Button label={t('common.retry')} onPress={onRetry} style={{ marginTop: space.sm }} /> : undefined}>
      {t('common.stale', { time: savedAt ? formatTime(savedAt) : '–' })}
    </Notice>
  );
}

export function Badge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? 'muted';
  const c = toneColors[tone];
  const text = label ?? (STATUS_TONE[status] ? t(`status.${status}` as MessageKey) : status);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{text}</Text>
    </View>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <View style={styles.center} accessible accessibilityLabel={label ?? t('common.loading')} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={colors.text} />
      {label ? <Muted style={{ marginTop: space.sm, textAlign: 'center' }}>{label}</Muted> : null}
    </View>
  );
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label} nativeID={`label-${label}`}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={`label-${label}`}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...input}
      />
    </View>
  );
}

/** Segmented tabs. Each tab is a real tab for screen readers. */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[] }) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.id)}
            style={[styles.tab, on && styles.tabOn]}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LanguageToggle({ dark }: { dark?: boolean }) {
  const lang = useLanguage();
  const options: Lang[] = ['de', 'en'];
  return (
    <View style={[styles.lang, dark && { borderColor: 'rgba(255,255,255,0.3)' }]} accessibilityRole="radiogroup" accessibilityLabel={t('lang.switch')}>
      {options.map((l) => (
        <Pressable
          key={l}
          accessibilityRole="radio"
          accessibilityState={{ checked: lang === l }}
          accessibilityLabel={t(`lang.${l}`)}
          onPress={() => chooseLanguage(l)}
          style={[styles.langBtn, lang === l && { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.langText, { color: lang === l ? colors.accentInk : dark ? '#fff' : colors.text }]}>{l.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A label/value row for detail screens, read as one item by screen readers. */
export function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={typeof value === 'string' ? `${label}: ${value}` : undefined}>
      <Text style={styles.rowLabel}>{label}</Text>
      {typeof value === 'string' ? <Text style={[styles.rowValue, mono && styles.mono]}>{value}</Text> : value}
    </View>
  );
}

export const styles = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: space.xs },
  h2: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: space.sm },
  muted: { color: colors.muted, fontSize: 15 },
  small: { fontSize: 13 },
  mono: { fontFamily: 'monospace', fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    marginBottom: space.lg,
  },
  btn: {
    minHeight: TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnBig: { minHeight: 60 },
  btnText: { fontSize: 16, fontWeight: '600' },
  btnTextBig: { fontSize: 19 },
  off: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  notice: { borderLeftWidth: 4, borderRadius: 8, padding: space.md, marginVertical: space.sm },
  noticeText: { fontSize: 15, lineHeight: 21 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 13, fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: space.xs },
  input: {
    minHeight: TOUCH,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: 12, padding: 4, marginBottom: space.lg },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  tabOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent },
  tabText: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  tabTextOn: { color: colors.text },
  lang: { flexDirection: 'row', borderWidth: 1, borderColor: colors.line, borderRadius: 999, overflow: 'hidden' },
  langBtn: { minWidth: TOUCH, minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  langText: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: space.md },
  rowLabel: { color: colors.muted, fontSize: 15 },
  rowValue: { color: colors.text, fontSize: 15, flexShrink: 1, textAlign: 'right' },
});
