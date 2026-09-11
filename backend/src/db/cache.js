import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Key/value cache abstraction.
 *
 * Uses Redis (ioredis) when `REDIS_URL` is configured — required for live data
 * caching in production — and transparently falls back to an in-memory store
 * (with TTL support) for local development and tests so the platform runs
 * with zero infrastructure.
 */

const memoryStore = new Map();

class MemoryCache {
  async get(key) {
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      memoryStore.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key, value, ttlMs) {
    memoryStore.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
    return true;
  }
  async del(key) {
    memoryStore.delete(key);
    return true;
  }
  async incr(key) {
    const cur = Number((await this.get(key)) || 0) + 1;
    await this.set(key, cur);
    return cur;
  }
  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    return [...memoryStore.keys()].filter((k) => k.startsWith(prefix));
  }
  async flush() {
    memoryStore.clear();
  }
}

class RedisCache {
  constructor(url) {
    this.url = url;
    this.client = null;
  }
  async _ensure() {
    if (this.client) return this.client;
    const { default: Redis } = await import('ioredis');
    this.client = new Redis(this.url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    this.client.on('error', (e) => logger.warn('Redis error', { error: e.message }));
    await this.client.connect().catch((e) => logger.warn('Redis connect failed', { error: e.message }));
    return this.client;
  }
  async get(key) {
    try {
      const c = await this._ensure();
      return await c.get(key);
    } catch {
      return null;
    }
  }
  async set(key, value, ttlMs) {
    try {
      const c = await this._ensure();
      const v = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttlMs) return await c.set(key, v, 'PX', ttlMs);
      return await c.set(key, v);
    } catch {
      return false;
    }
  }
  async del(key) {
    try {
      const c = await this._ensure();
      return await c.del(key);
    } catch {
      return false;
    }
  }
  async incr(key) {
    try {
      const c = await this._ensure();
      return await c.incr(key);
    } catch {
      return 0;
    }
  }
  async keys(pattern) {
    try {
      const c = await this._ensure();
      return await c.keys(pattern);
    } catch {
      return [];
    }
  }
  async flush() {
    try {
      const c = await this._ensure();
      await c.flushall();
    } catch {
      /* ignore */
    }
  }
}

export const cache = config.redisUrl ? new RedisCache(config.redisUrl) : new MemoryCache();

/** Small JSON helpers so callers can store/read objects uniformly. */
export const cacheJson = {
  async get(key) {
    const raw = await cache.get(key);
    if (raw === null || raw === undefined) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  },
  async set(key, value, ttlMs) {
    return cache.set(key, JSON.stringify(value), ttlMs);
  },
};

export default cache;
