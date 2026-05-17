import { NextResponse } from 'next/server';

import { getRulePolicyOptions } from '@/lib/clash-profile';
import { getAdminSafePayload, saveConfigPartial, type AppConfigRaw } from '@/lib/config';
import { isAdminFromCookies } from '@/lib/session';

export async function GET() {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const [payload, policyOptions] = await Promise.all([getAdminSafePayload(), getRulePolicyOptions()]);
    return NextResponse.json({ ...payload, policyOptions });
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
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: 'invalid_config', message: msg }, { status: 400 });
  }
}
