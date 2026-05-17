export type ProfileSubFormat = 'default' | 'clash';

/** 生成客户档案订阅地址（普通 = Base64 合并链接；clash = 完整 Clash 配置） */
export function buildProfileSubUrl(origin: string, token: string, format: ProfileSubFormat) {
  const u = new URL('/sub', origin.replace(/\/$/, '') || 'http://localhost');
  u.searchParams.set('token', token.trim());
  if (format === 'clash') {
    u.searchParams.set('type', 'clash');
  }
  return u.toString();
}
