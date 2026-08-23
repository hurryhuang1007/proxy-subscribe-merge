import type { SourcePrefetch } from '@/lib/config';

export type SourceCacheEntry = {
  url: string;
  userAgent: string;
  text: string;
  fetchedAt: number;
  linkCount: number;
  lastError?: string;
  lastErrorAt?: number;
};

export type SourceCacheRowKind = 'inline' | 'disabled' | 'empty' | 'ok' | 'stale' | 'error';

export type SourceCacheRowStatus = {
  kind: SourceCacheRowKind;
  fetchedAt?: number;
  linkCount?: number;
  error?: string;
};

export type SourceCacheSnapshot = {
  prefetchEnabled: boolean;
  intervalMinutes: number;
  lastRefreshAt: number | null;
  refreshing: boolean;
  lastRefreshError: string | null;
  sources: Record<string, SourceCacheRowStatus>;
};

type SourceCacheRuntime = {
  cache: Map<string, SourceCacheEntry>;
  lastRefreshAt: number | null;
  refreshing: boolean;
  lastRefreshError: string | null;
};

type PoolLike = Record<string, { url?: string; disabled?: boolean; userAgent?: string }>;

function getRuntime(): SourceCacheRuntime {
  const g = globalThis as typeof globalThis & { __sourceCacheRuntime?: SourceCacheRuntime };
  if (!g.__sourceCacheRuntime) {
    g.__sourceCacheRuntime = {
      cache: new Map(),
      lastRefreshAt: null,
      refreshing: false,
      lastRefreshError: null,
    };
  }
  return g.__sourceCacheRuntime;
}

export function getCachedSourceText(sourceName: string, url: string, userAgent: string): string | null {
  const entry = getRuntime().cache.get(sourceName);
  if (!entry || !entry.text) {
    return null;
  }
  if (entry.url !== url || entry.userAgent !== userAgent) {
    return null;
  }
  return entry.text;
}

export function putCachedSourceSuccess(
  sourceName: string,
  info: { url: string; userAgent: string; text: string; linkCount: number },
) {
  getRuntime().cache.set(sourceName, {
    url: info.url,
    userAgent: info.userAgent,
    text: info.text,
    fetchedAt: Date.now(),
    linkCount: info.linkCount,
  });
}

export function putCachedSourceError(sourceName: string, info: { url: string; userAgent: string; error: string }) {
  const rt = getRuntime();
  const prev = rt.cache.get(sourceName);
  const sameIdentity = prev && prev.url === info.url && prev.userAgent === info.userAgent;
  rt.cache.set(sourceName, {
    url: info.url,
    userAgent: info.userAgent,
    text: sameIdentity ? prev.text : '',
    fetchedAt: sameIdentity ? prev.fetchedAt : 0,
    linkCount: sameIdentity ? prev.linkCount : 0,
    lastError: info.error,
    lastErrorAt: Date.now(),
  });
}

export function syncCacheWithPool(pool: PoolLike) {
  const rt = getRuntime();
  for (const key of [...rt.cache.keys()]) {
    const raw = pool[key];
    if (!raw || typeof raw.url !== 'string') {
      rt.cache.delete(key);
      continue;
    }
    const entry = rt.cache.get(key);
    const userAgent = raw.userAgent == null ? '' : String(raw.userAgent);
    if (entry && (entry.url !== raw.url || entry.userAgent !== userAgent)) {
      rt.cache.delete(key);
    }
  }
}

export function markRefreshStart() {
  const rt = getRuntime();
  rt.refreshing = true;
}

export function markRefreshEnd(error: string | null) {
  const rt = getRuntime();
  rt.refreshing = false;
  rt.lastRefreshAt = Date.now();
  rt.lastRefreshError = error;
}

export function getSourceCacheSnapshot(pool: PoolLike, prefetch: SourcePrefetch): SourceCacheSnapshot {
  const rt = getRuntime();
  const sources: Record<string, SourceCacheRowStatus> = {};
  for (const [name, raw] of Object.entries(pool)) {
    const url = typeof raw?.url === 'string' ? raw.url : '';
    const userAgent = raw?.userAgent == null ? '' : String(raw.userAgent);
    const disabled = Boolean(raw?.disabled);
    if (!/^https?:\/\//i.test(url)) {
      sources[name] = { kind: 'inline' };
      continue;
    }
    if (disabled) {
      sources[name] = { kind: 'disabled' };
      continue;
    }
    const entry = rt.cache.get(name);
    if (!entry || entry.url !== url || entry.userAgent !== userAgent) {
      sources[name] = { kind: 'empty' };
      continue;
    }
    if (entry.lastError && entry.text) {
      sources[name] = {
        kind: 'stale',
        fetchedAt: entry.fetchedAt,
        linkCount: entry.linkCount,
        error: entry.lastError,
      };
      continue;
    }
    if (entry.lastError) {
      sources[name] = {
        kind: 'error',
        fetchedAt: entry.lastErrorAt,
        error: entry.lastError,
      };
      continue;
    }
    sources[name] = {
      kind: 'ok',
      fetchedAt: entry.fetchedAt,
      linkCount: entry.linkCount,
    };
  }
  return {
    prefetchEnabled: prefetch.enabled,
    intervalMinutes: prefetch.intervalMinutes,
    lastRefreshAt: rt.lastRefreshAt,
    refreshing: rt.refreshing,
    lastRefreshError: rt.lastRefreshError,
    sources,
  };
}
