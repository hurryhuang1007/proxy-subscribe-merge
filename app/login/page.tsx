import { Suspense } from 'react';

import LoginClient from '@/app/login/LoginClient';

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>载入中……</div>}>
      <LoginClient />
    </Suspense>
  );
}
