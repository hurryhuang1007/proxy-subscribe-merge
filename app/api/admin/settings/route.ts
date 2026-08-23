import { NextResponse } from 'next/server';

import {
  getAdminSafePayload,
  parseSourcePrefetch,
  saveSourcePrefetch,
  type AppConfigRaw,
} from '@/lib/config';
import { isAdminFromCookies } from '@/lib/session';
import { getSourceCacheSnapshot } from '@/lib/source-cache';
import { applyPrefetchSchedule } from '@/lib/source-prefetch';

export async function PUT(req: Request) {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { sourcePrefetch?: AppConfigRaw['sourcePrefetch'] };
    if (!body.sourcePrefetch || typeof body.sourcePrefetch !== 'object' || Array.isArray(body.sourcePrefetch)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const sourcePrefetch = parseSourcePrefetch({
      subscriptionPool: {},
      profiles: [],
      sourcePrefetch: body.sourcePrefetch,
    });
    const prev = await getAdminSafePayload();
    await saveSourcePrefetch(sourcePrefetch);
    const { startedRefresh } = applyPrefetchSchedule(sourcePrefetch, {
      refreshNow: sourcePrefetch.enabled && !prev.sourcePrefetch.enabled,
    });
    let sourceCache = getSourceCacheSnapshot(prev.subscriptionPool, sourcePrefetch);
    if (startedRefresh || sourceCache.refreshing) {
      sourceCache = { ...sourceCache, refreshing: true };
    }
    return NextResponse.json({ ok: true, sourcePrefetch, sourceCache });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: 'invalid_settings', message: msg }, { status: 400 });
  }
}
