import { NextResponse } from 'next/server';

import { loadConfig } from '@/lib/config';
import { createAdminJwt, setAdminAuthCookie } from '@/lib/session';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const password = typeof body?.password === 'string' ? body.password : '';

    const cfg = await loadConfig();
    if (!cfg.adminPassword) {
      return NextResponse.json({ error: 'admin_password_not_configured' }, { status: 503 });
    }
    if (!password || password !== cfg.adminPassword) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }

    const jwt = await createAdminJwt();
    await setAdminAuthCookie(jwt);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'bad_request';
    if (typeof msg === 'string' && msg.includes('SESSION_SECRET')) {
      return NextResponse.json({ error: 'session_config_error', message: msg }, { status: 500 });
    }
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
