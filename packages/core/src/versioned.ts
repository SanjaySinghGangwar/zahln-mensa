// The server can return an older state of a resource than one we have already
// seen. Orders and payments carry a `version` that only grows, so we never
// replace what we show with a lower version.

interface Versioned {
  id: string;
  version: number;
}

const caches = new Map<string, Map<string, Versioned>>();

/**
 * Remembers the highest version seen per id within a namespace and returns the
 * newest known copy. Namespaces keep differently shaped views apart
 * (e.g. a list `payment` vs a `payment-detail` with refunds and history).
 */
export function newest<T extends Versioned>(namespace: string, item: T): T {
  let cache = caches.get(namespace);
  if (!cache) {
    cache = new Map();
    caches.set(namespace, cache);
  }
  const known = cache.get(item.id) as T | undefined;
  if (known && known.version > item.version) return known;
  cache.set(item.id, item);
  return item;
}

/** For React state: keep the current value unless `next` is the same resource at an equal or higher version. */
export function pickNewer<T extends Versioned>(current: T | null | undefined, next: T): T {
  if (!current || current.id !== next.id) return next;
  return next.version >= current.version ? next : current;
}

export function clearVersionCache() {
  caches.clear();
}
