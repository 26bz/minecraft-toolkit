const DEFAULT_CACHE_TTL_MS = 30 * 1000;
const DEFAULT_MAX_SIZE = Infinity;

export class ResponseCache {
  constructor(ttlMs = DEFAULT_CACHE_TTL_MS, maxSize = DEFAULT_MAX_SIZE) {
    this.ttlMs = ttlMs;
    this.maxSize = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : Infinity;
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
    if (!this.store.has(key)) {
      while (this.store.size >= this.maxSize) {
        this.store.delete(this.store.keys().next().value);
      }
    }
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

  get size() {
    return this.store.size;
  }
}

export function createCache(options = {}) {
  if (options.cache === false) {
    return null;
  }

  const ttlSeconds = options.cache?.ttlSeconds ?? options.cacheTtl ?? options.ttlSeconds ?? null;
  const maxSize = options.cache?.maxSize ?? options.maxSize ?? DEFAULT_MAX_SIZE;

  if (ttlSeconds === null || ttlSeconds === undefined) {
    return new ResponseCache(DEFAULT_CACHE_TTL_MS, maxSize);
  }

  return new ResponseCache(Math.max(ttlSeconds, 0) * 1000, maxSize);
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
