import type { Metadata } from 'next';
import './globals.css';
import 'animal-island-ui/style';

export const metadata: Metadata = {
  title: '订阅合并网关',
  description: 'Manage subscription pools and merged client profiles.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
