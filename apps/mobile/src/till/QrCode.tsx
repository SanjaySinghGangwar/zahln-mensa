import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import QRCode from 'qrcode';

/**
 * Draws a QR code as a single SVG path: one native view instead of hundreds,
 * which keeps a low-end tablet smooth while the till polls.
 */
export function QrCode({ value, size, label, dim }: { value: string; size: number; label: string; dim?: boolean }) {
  const { d, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) path += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { d: path, count: n };
  }, [value]);

  const quiet = 2;
  const box = count + quiet * 2;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ opacity: dim ? 0.25 : 1 }}>
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`}>
        <Rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
}
