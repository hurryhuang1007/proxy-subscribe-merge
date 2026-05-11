import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import 'animal-island-ui/style';
import './animal-appearance.css';
import { THEME_INIT_SCRIPT } from '@/app/theme-init-script';

export const metadata: Metadata = {
  title: '订阅合并网关',
  description: 'Manage subscription pools and merged client profiles.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Script id="admin-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
