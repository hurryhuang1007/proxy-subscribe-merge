import * as jose from 'jose';
import { cookies } from 'next/headers';

import { loadConfig } from '@/lib/config';

export const ADMIN_COOKIE = 'proxy_subscribe_merge_admin';

function getSecureCookieFlag(): boolean {
  const raw = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') {
    return true;
  }
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return false;
  }
  return process.env.NODE_ENV === 'production';
}

function getJwtSecretRaw(): Uint8Array {
  const s = process.env.SESSION_SECRET?.trim() ?? '';
  if (s.length < 32) {
    throw new Error(
      'SESSION_SECRET must be set to a string at least 32 characters long (used for admin session signing)',
    );
  }
  return new TextEncoder().encode(s);
}

export async function createAdminJwt(): Promise<string> {
  const cfg = await loadConfig();
  const key = getJwtSecretRaw();
  return new jose.SignJWT({ admin: true, sv: cfg.adminSessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

export async function verifyAdminJwt(token: string | undefined): Promise<boolean> {
  if (!token) {
    return false;
  }
  try {
    const cfg = await loadConfig();
    const { payload } = await jose.jwtVerify(token, getJwtSecretRaw());
    if (payload.admin !== true) {
      return false;
    }
    const tokenVersion = typeof payload.sv === 'number' ? payload.sv : 0;
    return tokenVersion === cfg.adminSessionVersion;
  } catch {
    return false;
  }
}

export async function isAdminFromCookies(): Promise<boolean> {
  const jar = await cookies();
  return verifyAdminJwt(jar.get(ADMIN_COOKIE)?.value);
}

export async function setAdminAuthCookie(token: string) {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: getSecureCookieFlag(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearAdminAuthCookie() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}
