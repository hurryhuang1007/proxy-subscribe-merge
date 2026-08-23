import { NextResponse } from 'next/server';

import { isAdminFromCookies } from '@/lib/session';
import { refreshAllSources } from '@/lib/source-prefetch';

export async function POST() {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const sourceCache = await refreshAllSources();
    return NextResponse.json({ ok: true, sourceCache });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: 'refresh_failed', message: msg }, { status: 500 });
  }
}
