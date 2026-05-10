import { redirect } from 'next/navigation';

import AdminConfigShell from '@/app/config/AdminConfigShell';
import { isAdminFromCookies } from '@/lib/session';

export default async function ConfigPage() {
  let authed = false;
  try {
    authed = await isAdminFromCookies();
  } catch {
    redirect('/login?err=session');
  }
  if (!authed) {
    redirect('/login');
  }

  return <AdminConfigShell />;
}
