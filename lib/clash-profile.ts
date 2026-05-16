import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import yaml from 'js-yaml';

import type { ProfileEntry, SubscriptionPoolEntry } from '@/lib/config';
import { shareLinkToClashProxy, type ClashProxy } from '@/lib/clash';
import { mergeDynamicProxyGroups } from '@/lib/clash-region-groups';
import { mergeShareLinksForSource, type WarnLogger } from '@/lib/subscribe';

const TEMPLATE_PATH = join(process.cwd(), 'templates', 'clash-profile.yaml');
/** proxy-providers 自动更新间隔：4 小时 */
const PROXY_PROVIDER_INTERVAL_SEC = 4 * 3600;

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
  override: { 'additional-suffix': string; udp: boolean };
};

export type SubRelayAuth = {
  subBaseUrl: string;
  token: string;
};

/** proxy-provider 拉取地址：经本服务转接，不暴露上游订阅 URL */
export function buildProviderRelayUrl(relay: SubRelayAuth, sourceName: string) {
  const u = new URL(relay.subBaseUrl);
  u.searchParams.set('token', relay.token);
  u.searchParams.set('source', sourceName);
  u.searchParams.set('type', 'proxies');
  return u.toString();
}

function buildProxyProviders(
  sources: string[],
  pool: Map<string, SubscriptionPoolEntry>,
  relay: SubRelayAuth,
): Record<string, ClashProxyProvider> {
  const providers: Record<string, ClashProxyProvider> = {};
  for (const name of sources) {
    const entry = pool.get(name);
    if (!entry || entry.disabled) continue;
    providers[name] = {
      type: 'http',
      url: buildProviderRelayUrl(relay, name),
      path: `./providers/proxies/${name.toLowerCase()}.yaml`,
      interval: PROXY_PROVIDER_INTERVAL_SEC,
      proxy: 'DIRECT',
      override: {
        'additional-suffix': ` [${name}]`,
        udp: true,
      },
    };
  }
  return providers;
}

function shareLinksToClashProxies(links: string[]): ClashProxy[] {
  const proxies: ClashProxy[] = [];
  const usedNames = new Set<string>();
  for (const link of links) {
    const proxy = shareLinkToClashProxy(link);
    if (!proxy) continue;
    let name = String(proxy.name ?? 'node').trim() || 'node';
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

/** 单订阅源节点（供 proxy-provider 拉取） */
export async function buildClashProxiesYamlForSource(
  sourceName: string,
  pool: Map<string, SubscriptionPoolEntry>,
  log: WarnLogger,
): Promise<string> {
  const links = await mergeShareLinksForSource(sourceName, pool, log);
  const proxies = shareLinksToClashProxies(links);
  if (proxies.length === 0) return '';
  return yaml.dump({ proxies }, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}

export function profileHasEnabledSources(
  profile: Pick<ProfileEntry, 'sources'>,
  pool: Map<string, SubscriptionPoolEntry>,
) {
  return profile.sources.some((name) => {
    const s = pool.get(name);
    return s && !s.disabled;
  });
}

export async function buildClashProfileYaml(
  profile: ProfileEntry,
  pool: Map<string, SubscriptionPoolEntry>,
  relay: SubRelayAuth,
): Promise<string> {
  const proxyProviders = buildProxyProviders(profile.sources, pool, relay);
  if (Object.keys(proxyProviders).length === 0) {
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
  return yaml.dump(config, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}
