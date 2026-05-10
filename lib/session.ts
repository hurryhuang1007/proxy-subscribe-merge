import * as jose from 'jose';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'proxy_subscribe_merge_admin';

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
  const key = getJwtSecretRaw();
  return new jose.SignJWT({ admin: true })
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
    const key = getJwtSecretRaw();
    const { payload } = await jose.jwtVerify(token, key);
    return payload.admin === true;
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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearAdminAuthCookie() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}
