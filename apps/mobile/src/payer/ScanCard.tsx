import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { parseOrderPayload, t } from '@zahln/core';
import { Button, Card, Field, H2, Muted, Notice } from '../components/ui';
import { colors, space } from '../theme';

/** Scan the till's QR code, or type the order code. */
export function ScanCard({ onOrder }: { onOrder: (orderId: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [wrongCode, setWrongCode] = useState(false);
  // The camera reports the same code many times per second; act on it once.
  const handled = useRef(false);

  async function startScan() {
    setWrongCode(false);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    handled.current = false;
    setScanning(true);
  }

  function onScanned(data: string) {
    if (handled.current) return;
    const id = parseOrderPayload(data);
    if (!id) {
      setWrongCode(true);
      return;
    }
    handled.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setScanning(false);
    onOrder(id);
  }

  const manualId = parseOrderPayload(manual);
  const denied = permission && !permission.granted && !permission.canAskAgain;

  return (
    <Card>
      <H2>{t('pay.scanTitle')}</H2>
      <Muted style={{ marginBottom: space.md }}>{t('pay.scanHint')}</Muted>

      {scanning ? (
        <View style={styles.cameraBox}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => onScanned(data)}
            accessibilityLabel={t('pay.cameraFrame')}
          />
          <View style={styles.frame} pointerEvents="none" />
        </View>
      ) : null}

      {wrongCode && <Notice tone="warn">{t('pay.notAnOrder')}</Notice>}
      {denied && (
        <Notice tone="warn" action={<Button label={t('pay.cameraAllow')} onPress={() => void Linking.openSettings()} style={{ marginTop: space.sm }} />}>
          {t('pay.cameraDenied')}
        </Notice>
      )}

      {scanning ? (
        <Button label={t('common.cancel')} onPress={() => setScanning(false)} style={{ marginTop: space.md }} />
      ) : (
        <Button big kind="primary" label={t('pay.scanButton')} onPress={startScan} accessibilityHint={t('pay.scanA11y')} />
      )}

      <View style={{ marginTop: space.xl }}>
        <Field
          label={t('pay.manualLabel')}
          value={manual}
          onChangeText={setManual}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="ord_…"
          returnKeyType="go"
          onSubmitEditing={() => manualId && onOrder(manualId)}
        />
        <Button label={t('pay.manualSubmit')} onPress={() => manualId && onOrder(manualId)} disabled={!manualId} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cameraBox: { height: 300, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', marginBottom: space.sm },
  frame: {
    position: 'absolute',
    top: '15%',
    left: '15%',
    right: '15%',
    bottom: '15%',
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: 16,
  },
});
