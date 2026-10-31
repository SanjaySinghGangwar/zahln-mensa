// The till's QR code carries `qrPayload`, e.g. `zahln://pay?order=ord_dca200d0b9d06f7d`.
// It names the order, never an amount: the amount depends on who pays.

const ID = /^ord_[A-Za-z0-9_-]{1,64}$/;

/**
 * Returns the order ID from whatever the camera (or the user) gave us, or null
 * if it is not a Zahln order. Being strict matters: a random QR code on a
 * poster must not open a payment screen.
 */
export function parseOrderPayload(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (ID.test(value)) return value;

  // zahln://pay?order=… and https links with ?order=…
  const query = /^(?:zahln:\/\/pay|https?:\/\/[^\s?#]+)\?(?:[^#\s]*&)?order=([^&#\s]+)/i.exec(value);
  if (query) {
    const id = safeDecode(query[1]);
    return id && ID.test(id) ? id : null;
  }
  // Older style: zahln:order:<id>
  const scheme = /^zahln:order:(.+)$/i.exec(value);
  if (scheme && ID.test(scheme[1])) return scheme[1];
  return null;
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
