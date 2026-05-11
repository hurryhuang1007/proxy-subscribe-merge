'use client';

import { ThemeToggle } from '@/app/components/ThemeToggle';
import { Button, Card, Cursor, Divider, Footer, Input } from 'animal-island-ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetErr = searchParams?.get('err');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const bannerFromQuery = useMemo(() => {
    if (presetErr === 'session') {
      return '会话初始化失败（请检查是否已配置至少 32 位的 SESSION_SECRET）';
    }
    return null;
  }, [presetErr]);

  async function submit() {
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.message === 'string' ? data.message : '登录失败，请核对管理密码或服务配置');
        return;
      }
      router.replace('/config');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Cursor>
      <main
        style={{
          position: 'relative',
          minHeight: '100vh',
          boxSizing: 'border-box',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '56px 20px',
          overflow: 'auto',
        }}
      >
        <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 2 }}>
          <ThemeToggle />
        </div>
        <Card color="default" style={{ width: '100%', maxWidth: 470, paddingBottom: 8 }}>
          <Card type="title" style={{ marginBottom: 12 }}>
            🏝 管理登录 · 订阅合并网关
          </Card>
          {bannerFromQuery ? (
            <Card color="app-yellow" style={{ marginBottom: 12 }}>
              {bannerFromQuery}
            </Card>
          ) : null}
          {message ? (
            <Card color="app-pink" style={{ marginBottom: 12 }}>
              {message}
            </Card>
          ) : null}
          <Divider type="wave-yellow" />
          <label style={{ display: 'block', marginTop: 16, marginBottom: 8, fontWeight: 600, color: 'var(--animal-text-color)' }}>
            管理密码
          </label>
          <Input
            allowClear
            type="password"
            size="large"
            placeholder="来自 config.json 的 adminPassword"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="primary"
            block
            loading={loading}
            style={{ marginTop: 18 }}
            onClick={() => void submit()}
            htmlType="button"
          >
            登录
          </Button>
          <Divider type="line-teal" style={{ marginTop: 14 }} />
          <Footer type="tree" />
        </Card>
      </main>
    </Cursor>
  );
}
