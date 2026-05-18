import { NextResponse } from 'next/server';

import { loadConfig, updateAdminPassword } from '@/lib/config';
import { createAdminJwt, isAdminFromCookies, setAdminAuthCookie } from '@/lib/session';

export async function POST(req: Request) {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const nextPwd = typeof body?.newPassword === 'string' ? body.newPassword : '';

    const cfg = await loadConfig();
    if (!cfg.adminPassword) {
      return NextResponse.json({ error: 'admin_password_not_configured' }, { status: 503 });
    }
    if (current !== cfg.adminPassword) {
      return NextResponse.json({ error: 'invalid_current_password' }, { status: 400 });
    }
    await updateAdminPassword(nextPwd);
    const jwt = await createAdminJwt();
    await setAdminAuthCookie(jwt);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: 'password_change_failed', message: msg }, { status: 400 });
  }
}
