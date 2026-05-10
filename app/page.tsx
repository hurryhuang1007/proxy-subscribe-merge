import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ADMIN_COOKIE, verifyAdminJwt } from '@/lib/session';

export default async function HomePage() {
  const jar = await cookies();
  let ok = false;
  try {
    ok = await verifyAdminJwt(jar.get(ADMIN_COOKIE)?.value);
  } catch {
    redirect('/login?err=session');
  }
  redirect(ok ? '/config' : '/login');
}
