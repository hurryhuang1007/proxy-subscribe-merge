import { loadConfig, type SourcePrefetch, type SubscriptionPoolEntry } from '@/lib/config';
import {
  getCachedSourceText,
  getSourceCacheSnapshot,
  markRefreshEnd,
  markRefreshStart,
  putCachedSourceError,
  putCachedSourceSuccess,
  syncCacheWithPool,
  type SourceCacheSnapshot,
} from '@/lib/source-cache';
import { extractShareLinksFromSubscriptionText, fetchHttpSourceBody } from '@/lib/subscribe';

type PrefetchTimerRuntime = {
  timer: ReturnType<typeof setInterval> | null;
  intervalMs: number | null;
  inflight: Promise<SourceCacheSnapshot> | null;
};

function getTimerRuntime(): PrefetchTimerRuntime {
  const g = globalThis as typeof globalThis & { __sourcePrefetchTimer?: PrefetchTimerRuntime };
  if (!g.__sourcePrefetchTimer) {
    g.__sourcePrefetchTimer = { timer: null, intervalMs: null, inflight: null };
  }
  return g.__sourcePrefetchTimer;
}

function stopPrefetchTimer() {
  const rt = getTimerRuntime();
  if (rt.timer) {
    clearInterval(rt.timer);
  }
  rt.timer = null;
  rt.intervalMs = null;
}

async function refreshOneSource(source: SubscriptionPoolEntry) {
  if (source.disabled || !/^https?:\/\//i.test(source.url)) {
    return;
  }
  try {
    const text = await fetchHttpSourceBody(source.url, source.userAgent);
    putCachedSourceSuccess(source.name, {
      url: source.url,
      userAgent: source.userAgent,
      text,
      linkCount: extractShareLinksFromSubscriptionText(text).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    putCachedSourceError(source.name, {
      url: source.url,
      userAgent: source.userAgent,
      error: message,
    });
    console.warn(`source prefetch (${source.name}) failed`, err);
    throw err;
  }
}

async function refreshAllSourcesOnce(): Promise<SourceCacheSnapshot> {
  const cfg = await loadConfig();
  const poolRaw = cfg.rawData.subscriptionPool;
  syncCacheWithPool(poolRaw);

  markRefreshStart();
  const errors: string[] = [];
  try {
    const jobs = [...cfg.subscriptionPool.values()].map(async (source) => {
      try {
        await refreshOneSource(source);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        errors.push(`${source.name}: ${message}`);
      }
    });
    await Promise.all(jobs);
    markRefreshEnd(errors.length > 0 ? errors.join('；') : null);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    markRefreshEnd(message);
  }
  return getSourceCacheSnapshot(poolRaw, cfg.sourcePrefetch);
}

export async function refreshAllSources(): Promise<SourceCacheSnapshot> {
  const rt = getTimerRuntime();
  if (rt.inflight) {
    return rt.inflight;
  }
  rt.inflight = refreshAllSourcesOnce().finally(() => {
    rt.inflight = null;
  });
  return rt.inflight;
}

export async function refreshMissingSources(): Promise<SourceCacheSnapshot> {
  const rt = getTimerRuntime();
  if (rt.inflight) {
    return rt.inflight;
  }
  const cfg = await loadConfig();
  const poolRaw = cfg.rawData.subscriptionPool;
  syncCacheWithPool(poolRaw);
  if (!cfg.sourcePrefetch.enabled) {
    return getSourceCacheSnapshot(poolRaw, cfg.sourcePrefetch);
  }
  const missing = [...cfg.subscriptionPool.values()].filter((source) => {
    if (source.disabled || !/^https?:\/\//i.test(source.url)) {
      return false;
    }
    return getCachedSourceText(source.name, source.url, source.userAgent) == null;
  });
  if (missing.length === 0) {
    return getSourceCacheSnapshot(poolRaw, cfg.sourcePrefetch);
  }

  rt.inflight = (async () => {
    markRefreshStart();
    const errors: string[] = [];
    try {
      await Promise.all(
        missing.map(async (source) => {
          try {
            await refreshOneSource(source);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'unknown';
            errors.push(`${source.name}: ${message}`);
          }
        }),
      );
      markRefreshEnd(errors.length > 0 ? errors.join('；') : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      markRefreshEnd(message);
    }
    return getSourceCacheSnapshot(poolRaw, cfg.sourcePrefetch);
  })().finally(() => {
    rt.inflight = null;
  });
  return rt.inflight;
}

export async function ensurePrefetchScheduler(options?: { refreshNow?: boolean }) {
  const cfg = await loadConfig();
  return applyPrefetchSchedule(cfg.sourcePrefetch, options);
}

export function applyPrefetchSchedule(prefetch: SourcePrefetch, options?: { refreshNow?: boolean }) {
  const rt = getTimerRuntime();
  if (!prefetch.enabled) {
    stopPrefetchTimer();
    return { startedRefresh: false };
  }

  const intervalMs = prefetch.intervalMinutes * 60 * 1000;
  const needTimer = rt.timer == null || rt.intervalMs !== intervalMs;
  if (needTimer) {
    stopPrefetchTimer();
    rt.intervalMs = intervalMs;
    rt.timer = setInterval(() => {
      void refreshAllSources().catch((err) => {
        console.warn('source prefetch interval failed', err);
      });
    }, intervalMs);
  }

  const startedRefresh = Boolean(options?.refreshNow || needTimer);
  if (startedRefresh) {
    void refreshAllSources().catch((err) => {
      console.warn('source prefetch start failed', err);
    });
  }
  return { startedRefresh };
}
