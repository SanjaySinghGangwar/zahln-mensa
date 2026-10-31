import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

/**
 * How much of the screen, measured from the bottom edge, the keyboard covers.
 *
 * The app draws edge to edge (Android 15+ requires it), so Android no longer
 * shrinks the window when the keyboard opens. Screens add this as bottom
 * padding themselves, and remove it again when the keyboard closes.
 * Measured from `screenY`, which is consistent across keyboards and devices.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      const screenHeight = Dimensions.get('screen').height;
      setInset(Math.max(0, Math.round(screenHeight - e.endCoordinates.screenY)));
    });
    const hide = Keyboard.addListener(hideEvent, () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}
