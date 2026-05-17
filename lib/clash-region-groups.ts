import type { SubscriptionPoolEntry } from '@/lib/config';
import { buildSupplierProxyGroups, legacySupplierGroupNames } from '@/lib/clash-supplier-groups';

const PROBE_URL = 'http://www.gstatic.com/generate_204';

/** 排除名称中含 Cloudflare 服务商的节点 */
const EXCLUDE_CLOUDFLARE = '(?i)cloudflare';

const MODE_SELECTOR = '🎯 总模式';

const CORE_POLICY = ['Ⓜ️ 延迟最低', 'Ⓜ️ 故障切换', '♻️ 手动切换'];

const DNS_POLICY_GROUP = '📬 国外dns';

const POLICY_SELECT_GROUPS = new Set([
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
  { prefix: '🇭🇰', label: '香港', filter: '(?i)(港|hk|hong[\\s+]+kong|hkg|香港)' },
  { prefix: '🇯🇵', label: '日本', filter: '(?i)(日|jp|japan|东京|大阪|日本)' },
  {
    prefix: '🇸🇬',
    label: '新加坡',
    filter: '(?i)(新加坡|狮城|singapore|(?:^|[\\s|｜\\-\\[\\]#:,])sg(?:$|[\\s|｜\\-\\[\\]#:,]))',
  },
  { prefix: '🇺🇸', label: '美国', filter: '(?i)(美|us|usa|united[\\s+]+states|洛杉矶|纽约|西雅图|美国)' },
];

const REGION_PARENT_NAMES = new Set(REGIONS.map((r) => `${r.prefix} ${r.label}`));

/** 历史地区组（已从 REGIONS 移除，合并时需清理） */
const LEGACY_REGION_PARENT_NAMES = new Set([
  '🇹🇼 台湾',
  '🇰🇷 韩国',
  '🇬🇧 英国',
  '🇩🇪 德国',
  '🇫🇷 法国',
  '🇦🇺 澳大利亚',
  '🇨🇦 加拿大',
  '🇮🇳 印度',
  '🌐 其他地区',
]);

const LEGACY_REGION_PREFIXES = [
  '🇭🇰',
  '🇹🇼',
  '🇯🇵',
  '🇰🇷',
  '🇺🇸',
  '🇸🇬',
  '🇬🇧',
  '🇩🇪',
  '🇫🇷',
  '🇦🇺',
  '🇨🇦',
  '🇮🇳',
  '🌐',
];

function filteredProbeOpts(filter?: string) {
  return {
    url: PROBE_URL,
    interval: 300,
    'include-all': true,
    'exclude-filter': EXCLUDE_CLOUDFLARE,
    ...(filter ? { filter } : {}),
  };
}

function buildMainModeProxies(dynamicPickers: string[]) {
  return [...CORE_POLICY, ...dynamicPickers, 'DIRECT'];
}

function buildPolicyProxies(dynamicPickers: string[], directFirst: boolean) {
  const scoped = [MODE_SELECTOR, ...CORE_POLICY, ...dynamicPickers];
  return directFirst ? ['DIRECT', ...scoped] : [...scoped, 'DIRECT'];
}

function buildDnsProxies(dynamicPickers: string[]) {
  const delayPickers = dynamicPickers.filter((n) => n.endsWith(' 延迟最低'));
  return [MODE_SELECTOR, 'Ⓜ️ 延迟最低', ...delayPickers, 'DIRECT'];
}

export function buildRegionProxyGroups() {
  const groups: Record<string, unknown>[] = [];
  const modePickerNames: string[] = [];

  for (const { prefix, filter } of REGIONS) {
    const delay = `${prefix} 延迟最低`;
    const fallback = `${prefix} 故障切换`;
    const manual = `${prefix} 手动切换`;
    const probe = filteredProbeOpts(filter);

    modePickerNames.push(delay, fallback, manual);
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
      name: manual,
      type: 'select',
      ...probe,
    });
  }

  return { modePickerNames, groups };
}

function isLegacyRegionGroup(name: string) {
  if (
    REGION_PARENT_NAMES.has(name) ||
    LEGACY_REGION_PARENT_NAMES.has(name) ||
    name === '🌏 节点地区' ||
    name === '📦 节点供应商'
  ) {
    return true;
  }
  return LEGACY_REGION_PREFIXES.some((p) => {
    return (
      name === `${p} 延迟最低` ||
      name === `${p} 故障切换` ||
      name === `${p} 手动切换`
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

    if (name === MODE_SELECTOR) {
      out.push({ ...g, proxies: buildMainModeProxies(dynamicPickers) });
      continue;
    }
    if (name === DNS_POLICY_GROUP) {
      out.push({ ...g, proxies: buildDnsProxies(dynamicPickers) });
      continue;
    }
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
