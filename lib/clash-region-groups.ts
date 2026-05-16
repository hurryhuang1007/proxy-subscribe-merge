import type { SubscriptionPoolEntry } from '@/lib/config';
import { buildSupplierProxyGroups, legacySupplierGroupNames } from '@/lib/clash-supplier-groups';

const PROBE_URL = 'http://www.gstatic.com/generate_204';

const CORE_POLICY = ['Ⓜ️ 延迟最低', 'Ⓜ️ 负载均衡', 'Ⓜ️ 故障切换', '♻️ 手动切换'];

const POLICY_SELECT_GROUPS = new Set([
  '🎯 总模式',
  '📬 国外dns',
  '📲 聊天软件',
  '🤖 OpenAI',
  '📹 YouTube',
  '🎥 NETFLIX',
  '🔍 谷歌服务',
  '🎮 游戏平台',
  '⛩ 日韩媒体',
  '🌍 国外媒体',
  '🌏 港台媒体',
  '🇺🇳 国外网站',
]);

const POLICY_DIRECT_FIRST_GROUPS = new Set(['🍎 苹果服务', '🧩 微软服务', '🇨🇳 国内网站', '🐟 漏网之鱼']);

type RegionDef = {
  prefix: string;
  label: string;
  filter?: string;
};

const REGIONS: RegionDef[] = [
  { prefix: '🇭🇰', label: '香港', filter: '(?i)(港|hk|hong\\s*kong|hkg|香港)' },
  { prefix: '🇹🇼', label: '台湾', filter: '(?i)(台|tw|taiwan|台北|高雄|台湾)' },
  { prefix: '🇯🇵', label: '日本', filter: '(?i)(日|jp|japan|东京|大阪|日本)' },
  { prefix: '🇰🇷', label: '韩国', filter: '(?i)(韩|kr|korea|首尔|韩国)' },
  { prefix: '🇺🇸', label: '美国', filter: '(?i)(美|us|usa|united\\s*states|洛杉矶|纽约|西雅图|美国)' },
  { prefix: '🇸🇬', label: '新加坡', filter: '(?i)(新加坡|狮城|sg|singapore)' },
  { prefix: '🇬🇧', label: '英国', filter: '(?i)(英|uk|gb|britain|london|伦敦|英国)' },
  { prefix: '🇩🇪', label: '德国', filter: '(?i)(德|de|germany|法兰克福|德国)' },
  { prefix: '🇫🇷', label: '法国', filter: '(?i)(法|fr|france|巴黎|法国)' },
  { prefix: '🇦🇺', label: '澳大利亚', filter: '(?i)(澳|au|australia|悉尼|墨尔本|澳大利亚)' },
  { prefix: '🇨🇦', label: '加拿大', filter: '(?i)(加|ca|canada|多伦多|温哥华|加拿大)' },
  { prefix: '🇮🇳', label: '印度', filter: '(?i)(印|in|india|孟买|印度)' },
  { prefix: '🌐', label: '其他地区' },
];

const REGION_PARENT_NAMES = new Set(REGIONS.map((r) => `${r.prefix} ${r.label}`));

function filteredProbeOpts(filter?: string) {
  return {
    url: PROBE_URL,
    interval: 300,
    'include-all': true,
    ...(filter ? { filter } : {}),
  };
}

function buildPolicyProxies(dynamicPickers: string[], directFirst: boolean) {
  const scoped = [...CORE_POLICY, ...dynamicPickers];
  return directFirst ? ['DIRECT', ...scoped] : [...scoped, 'DIRECT'];
}

export function buildRegionProxyGroups() {
  const groups: Record<string, unknown>[] = [];
  const modePickerNames: string[] = [];

  for (const { prefix, filter } of REGIONS) {
    const delay = `${prefix} 延迟最低`;
    const fallback = `${prefix} 故障切换`;
    const balance = `${prefix} 负载均衡`;
    const manual = `${prefix} 手动`;
    const probe = filteredProbeOpts(filter);

    modePickerNames.push(delay, fallback, balance, manual);
    groups.push({
      name: delay,
      type: 'url-test',
      tolerance: 100,
      ...probe,
    });
    groups.push({
      name: fallback,
      type: 'fallback',
      ...probe,
    });
    groups.push({
      name: balance,
      type: 'load-balance',
      strategy: 'consistent-hashing',
      ...probe,
    });
    groups.push({
      name: manual,
      type: 'select',
      ...probe,
    });
  }

  return { modePickerNames, groups };
}

function isLegacyRegionGroup(name: string) {
  if (REGION_PARENT_NAMES.has(name) || name === '🌏 节点地区' || name === '📦 节点供应商') {
    return true;
  }
  return REGIONS.some((r) => {
    const p = r.prefix;
    return (
      name === `${p} 延迟最低` ||
      name === `${p} 故障切换` ||
      name === `${p} 负载均衡` ||
      name === `${p} 手动`
    );
  });
}

/** 将模板中的 proxy-groups 与动态地区/供应商模式组合并，并展平到各分流组 */
export function mergeDynamicProxyGroups(
  templateGroups: unknown[],
  sources: string[],
  pool: Map<string, SubscriptionPoolEntry>,
) {
  const { modePickerNames: regionPickers, groups: regionGroups } = buildRegionProxyGroups();
  const { modePickerNames: supplierPickers, groups: supplierGroups } = buildSupplierProxyGroups(sources, pool);
  const dynamicPickers = [...regionPickers, ...supplierPickers];
  const legacySuppliers = legacySupplierGroupNames(sources);

  const out: Record<string, unknown>[] = [];
  let insertedDynamic = false;

  for (const item of templateGroups) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    const name = String(g.name ?? '');

    if (name === '🌏 节点地区' || name === '📦 节点供应商') continue;
    if (isLegacyRegionGroup(name) || legacySuppliers.has(name)) continue;

    if (POLICY_SELECT_GROUPS.has(name)) {
      out.push({ ...g, proxies: buildPolicyProxies(dynamicPickers, false) });
      continue;
    }
    if (POLICY_DIRECT_FIRST_GROUPS.has(name)) {
      out.push({ ...g, proxies: buildPolicyProxies(dynamicPickers, true) });
      continue;
    }

    out.push(g);
    if (name === '♻️ 手动切换' && !insertedDynamic) {
      out.push(...regionGroups, ...supplierGroups);
      insertedDynamic = true;
    }
  }

  if (!insertedDynamic) {
    out.push(...regionGroups, ...supplierGroups);
  }

  return out;
}
