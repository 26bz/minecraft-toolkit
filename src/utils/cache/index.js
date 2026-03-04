const DEFAULT_CACHE_TTL_MS = 30 * 1000;

export class ResponseCache {
  constructor(ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key, value) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

export function createCache(options = {}) {
  if (options.cache === false) {
    return null;
  }

  const ttlSeconds = options.cache?.ttlSeconds ?? options.cacheTtl ?? options.ttlSeconds ?? null;
  if (ttlSeconds === null || ttlSeconds === undefined) {
    return new ResponseCache();
  }

  return new ResponseCache(Math.max(ttlSeconds, 0) * 1000);
}

export async function withCache(cache, key, resolver) {
  if (!cache) {
    return resolver();
  }

  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const value = await resolver();
  cache.set(key, value);
  return value;
}
