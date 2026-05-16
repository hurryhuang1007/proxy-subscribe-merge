import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import yaml from 'js-yaml';

import type { ProfileEntry, SubscriptionPoolEntry } from '@/lib/config';
import { shareLinkToClashProxy, type ClashProxy } from '@/lib/clash';
import { mergeDynamicProxyGroups } from '@/lib/clash-region-groups';

const TEMPLATE_PATH = join(process.cwd(), 'templates', 'clash-profile.yaml');

let templateCache: Record<string, unknown> | null = null;

async function loadClashTemplate() {
  if (!templateCache) {
    const raw = await readFile(TEMPLATE_PATH, 'utf8');
    templateCache = yaml.load(raw) as Record<string, unknown>;
  }
  return templateCache;
}

export type ClashProxyProvider = {
  type: 'http';
  url: string;
  path: string;
  interval: number;
  proxy: string;
  header: { 'User-Agent': string[] };
  override: { 'additional-suffix': string; udp: boolean };
};

function buildProxyProviders(
  sources: string[],
  pool: Map<string, SubscriptionPoolEntry>,
): Record<string, ClashProxyProvider> {
  const providers: Record<string, ClashProxyProvider> = {};
  for (const name of sources) {
    const entry = pool.get(name);
    if (!entry || entry.disabled) continue;
    if (!/^https?:\/\//i.test(entry.url)) continue;
    const ua = entry.userAgent.trim() || 'clash.meta.mihomo';
    providers[name] = {
      type: 'http',
      url: entry.url,
      path: `./providers/proxies/${name.toLowerCase()}.yaml`,
      interval: 86400,
      proxy: 'DIRECT',
      header: { 'User-Agent': [ua] },
      override: {
        'additional-suffix': ` [${name}]`,
        udp: true,
      },
    };
  }
  return providers;
}

function buildInlineProxiesFromProfile(
  profile: Pick<ProfileEntry, 'sources'>,
  pool: Map<string, SubscriptionPoolEntry>,
): ClashProxy[] {
  const proxies: ClashProxy[] = [];
  const usedNames = new Set<string>();
  for (const sourceName of profile.sources) {
    const source = pool.get(sourceName);
    if (!source || source.disabled) continue;
    if (/^https?:\/\//i.test(source.url)) continue;
    const proxy = shareLinkToClashProxy(source.url);
    if (!proxy) continue;
    let name = `${String(proxy.name ?? 'node').trim() || 'node'} [${sourceName}]`;
    if (usedNames.has(name)) {
      let i = 2;
      while (usedNames.has(`${name}_${i}`)) i += 1;
      name = `${name}_${i}`;
    }
    usedNames.add(name);
    proxy.name = name;
    proxies.push(proxy);
  }
  return proxies;
}

/** 非 http(s) 的池内直链（如 vless://） */
export function collectInlineShareLinks(
  profile: Pick<ProfileEntry, 'sources'>,
  pool: Map<string, SubscriptionPoolEntry>,
) {
  const links: string[] = [];
  for (const sourceName of profile.sources) {
    const source = pool.get(sourceName);
    if (!source || source.disabled) continue;
    if (/^https?:\/\//i.test(source.url)) continue;
    links.push(source.url);
  }
  return links;
}

export async function buildClashProfileYaml(
  profile: ProfileEntry,
  pool: Map<string, SubscriptionPoolEntry>,
): Promise<string> {
  const proxyProviders = buildProxyProviders(profile.sources, pool);
  const proxies = buildInlineProxiesFromProfile(profile, pool);
  if (Object.keys(proxyProviders).length === 0 && proxies.length === 0) {
    return '';
  }

  const template = await loadClashTemplate();
  const rawGroups = template['proxy-groups'];
  const proxyGroups = Array.isArray(rawGroups)
    ? mergeDynamicProxyGroups(rawGroups, profile.sources, pool)
    : [];

  const config: Record<string, unknown> = {
    ...template,
    'proxy-groups': proxyGroups,
    'proxy-providers': proxyProviders,
  };
  if (proxies.length > 0) {
    config.proxies = proxies;
  }

  return yaml.dump(config, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}
