export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
}

export class Cache<T> {
  private cache = new Map<string, { value: T; expiresAt: number }>();
  private ttl: number;
  private maxSize: number;

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl || 5 * 60 * 1000;
    this.maxSize = options.maxSize || 1000;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this.ttl),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private evictOldest(): void {
    const now = Date.now();
    let oldestKey: string | null = null;
    let oldestExpires = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
        continue;
      }

      if (entry.expiresAt < oldestExpires) {
        oldestExpires = entry.expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

export const searchCache = new Cache<any>({ ttl: 10 * 60 * 1000, maxSize: 500 });
export const contentCache = new Cache<any>({ ttl: 30 * 60 * 1000, maxSize: 200 });
