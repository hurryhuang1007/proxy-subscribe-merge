import { NextResponse } from 'next/server';

import { getRulePolicyOptions } from '@/lib/clash-profile';
import { getAdminSafePayload, saveConfigPartial, type AppConfigRaw } from '@/lib/config';
import { isAdminFromCookies } from '@/lib/session';
import { getSourceCacheSnapshot, syncCacheWithPool } from '@/lib/source-cache';
import { ensurePrefetchScheduler, refreshMissingSources } from '@/lib/source-prefetch';

export async function GET() {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const [payload, policyOptions] = await Promise.all([getAdminSafePayload(), getRulePolicyOptions()]);
    const { startedRefresh } = await ensurePrefetchScheduler();
    let sourceCache = getSourceCacheSnapshot(payload.subscriptionPool, payload.sourcePrefetch);
    if (startedRefresh || sourceCache.refreshing) {
      sourceCache = { ...sourceCache, refreshing: true };
    }
    return NextResponse.json({ ...payload, policyOptions, sourceCache });
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as Pick<AppConfigRaw, 'subscriptionPool' | 'profiles' | 'extraRules'>;
    if (!body.subscriptionPool || typeof body.subscriptionPool !== 'object' || !Array.isArray(body.profiles)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    if (body.extraRules != null && !Array.isArray(body.extraRules)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    await saveConfigPartial({
      subscriptionPool: body.subscriptionPool,
      profiles: body.profiles,
      extraRules: body.extraRules ?? [],
    });
    const payload = await getAdminSafePayload();
    syncCacheWithPool(payload.subscriptionPool);
    await ensurePrefetchScheduler();
    let sourceCache = getSourceCacheSnapshot(payload.subscriptionPool, payload.sourcePrefetch);
    if (payload.sourcePrefetch.enabled && Object.values(sourceCache.sources).some((row) => row.kind === 'empty')) {
      void refreshMissingSources();
      sourceCache = { ...sourceCache, refreshing: true };
    }
    return NextResponse.json({ ok: true, sourceCache });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: 'invalid_config', message: msg }, { status: 400 });
  }
}
