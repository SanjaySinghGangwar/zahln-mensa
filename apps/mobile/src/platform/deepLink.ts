// QR codes scanned with the phone's own camera open the app through
// zahln://pay?order=…. The link can arrive before anyone has signed in, so it
// is kept here until the payer screen takes it.

import { Linking } from 'react-native';
import { parseOrderPayload } from '@zahln/core';

let pending: string | null = null;
const listeners = new Set<() => void>();

function receive(url: string | null | undefined) {
  const id = url ? parseOrderPayload(url) : null;
  if (!id) return;
  pending = id;
  listeners.forEach((l) => l());
}

let started = false;

/** Call once at start-up. */
export function startDeepLinks() {
  if (started) return;
  started = true;
  void Linking.getInitialURL().then(receive, () => undefined);
  Linking.addEventListener('url', (e) => receive(e.url));
}

/** Returns the waiting order ID once, then forgets it. */
export function takePendingOrder(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export function onPendingOrder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
