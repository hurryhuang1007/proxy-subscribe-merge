'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'adminTheme';

function readStoredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'light';
  }
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(mode: 'light' | 'dark') {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMode(readStoredTheme());
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    applyTheme(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode, mounted]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  const label = mode === 'dark' ? '浅色模式' : '暗色模式';

  return (
    <button type="button" className={className ?? 'theme-toggle-btn'} onClick={toggle} title={label}>
      {mounted ? label : '主题'}
    </button>
  );
}
