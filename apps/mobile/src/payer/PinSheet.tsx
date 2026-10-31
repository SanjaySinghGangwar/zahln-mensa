import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '@zahln/core';
import { Button, H2, Muted, Notice } from '../components/ui';
import { colors, space, TOUCH } from '../theme';
import { checkPin, hasPin, setPin } from './confirm';

type Phase = 'loading' | 'setup' | 'repeat' | 'enter';

/**
 * Bottom sheet that asks for the app PIN (or sets it up on first use).
 * A plain numeric password field, so the system keyboard and TalkBack behave normally.
 */
export function PinSheet({
  userId,
  amount,
  onDone,
  onLocked,
}: {
  userId: string;
  amount: string;
  onDone: (confirmed: boolean) => void;
  onLocked: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [pin, setPinValue] = useState('');
  const [first, setFirst] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    void hasPin(userId).then((has) => setPhase(has ? 'enter' : 'setup'));
  }, [userId]);

  useEffect(() => {
    if (phase !== 'loading') setTimeout(() => inputRef.current?.focus(), 100);
  }, [phase]);

  async function submit(value: string) {
    if (value.length !== 4 || busy) return;
    setBusy(true);
    try {
      if (phase === 'setup') {
        setFirst(value);
        setPinValue('');
        setMessage(null);
        setPhase('repeat');
      } else if (phase === 'repeat') {
        if (value !== first) {
          setMessage(t('pay.pinMismatch'));
          setPinValue('');
          setPhase('setup');
          return;
        }
        await setPin(userId, value);
        onDone(true);
      } else {
        const res = await checkPin(userId, value);
        if (res.ok) return onDone(true);
        setPinValue('');
        if ('locked' in res) {
          AccessibilityInfo.announceForAccessibility(t('pay.pinLocked'));
          return onLocked();
        }
        const msg = t('pay.pinWrong', { left: res.left });
        setMessage(msg);
        AccessibilityInfo.announceForAccessibility(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const title = phase === 'enter' ? t('pay.pinEnter') : phase === 'repeat' ? t('pay.pinRepeat') : t('pay.pinSetupTitle');

  return (
    <Modal transparent animationType="slide" onRequestClose={() => onDone(false)} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <H2>{t('pay.confirmTitle', { amount })}</H2>
          <Text style={styles.title}>{title}</Text>
          {phase === 'setup' && <Muted>{t('pay.pinSetupHint')}</Muted>}

          <TextInput
            ref={inputRef}
            value={pin}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '').slice(0, 4);
              setPinValue(digits);
              if (digits.length === 4) void submit(digits);
            }}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            autoComplete="off"
            textContentType="oneTimeCode"
            accessibilityLabel={title}
            style={styles.pinInput}
            editable={phase !== 'loading' && !busy}
          />

          {message && <Notice tone="bad">{message}</Notice>}
          <Button label={t('common.cancel')} onPress={() => onDone(false)} kind="ghost" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, padding: space.xl, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: space.sm },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  pinInput: {
    minHeight: TOUCH + 12,
    marginVertical: space.md,
    borderWidth: 2,
    borderColor: colors.text,
    borderRadius: 12,
    fontSize: 28,
    letterSpacing: 16,
    textAlign: 'center',
    color: colors.text,
  },
});
