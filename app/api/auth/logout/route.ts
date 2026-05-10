import { NextResponse } from 'next/server';

import { clearAdminAuthCookie } from '@/lib/session';

export async function POST() {
  try {
    await clearAdminAuthCookie();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'logout_failed' }, { status: 500 });
  }
}
