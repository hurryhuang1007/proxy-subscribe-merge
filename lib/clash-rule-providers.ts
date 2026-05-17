const ACL4SSR_RULES_BASE =
  process.env.ACL4SSR_RULES_BASE_URL?.trim() ||
  'https://cdn.jsdelivr.net/gh/ACL4SSR/ACL4SSR@master';

/** Custom rules shipped in this repo (DnsProxy, TwMedia, …). */
const REPO_RULES_BASE =
  process.env.REPO_RULES_BASE_URL?.trim() ||
  'https://cdn.jsdelivr.net/gh/hurryhuang1007/proxy-subscribe-merge@main';

const RULE_PROVIDER_INTERVAL_SEC = 86400;

/** Provider name → path relative to ACL4SSR_RULES_BASE. */
const ACL4SSR_RULE_PATH: Record<string, string> = {
  Direct: 'Clash/Providers/Ruleset/Download.yaml',
  BanADP: 'Clash/Providers/BanEasyPrivacy.yaml',
  ChatGPT: 'Clash/Providers/Ruleset/AI.yaml',
  Games: 'Clash/Providers/Ruleset/GameDownload.yaml',
  GoogleIP: 'Clash/Providers/Ruleset/Google.yaml',
  Proxy: 'Clash/Providers/ProxyGFWlist.yaml',
  China: 'Clash/Providers/ChinaIp.yaml',
  TelegramP: 'Clash/Providers/Ruleset/Telegram.yaml',
  ProxyMediaP: 'Clash/Providers/ProxyMedia.yaml',
  LocalAreaNetwork: 'Clash/Providers/LocalAreaNetwork.yaml',
  UnBan: 'Clash/Providers/UnBan.yaml',
  BanAD: 'Clash/Providers/BanAD.yaml',
  BanProgramAD: 'Clash/Providers/BanProgramAD.yaml',
  ChinaMedia: 'Clash/Providers/ChinaMedia.yaml',
  ChinaDomain: 'Clash/Providers/ChinaDomain.yaml',
  ChinaCompanyIp: 'Clash/Providers/ChinaCompanyIp.yaml',
  ProxyMedia: 'Clash/Providers/ProxyMedia.yaml',
  ProxyGFWlist: 'Clash/Providers/ProxyGFWlist.yaml',
  Line: 'Clash/Ruleset/Line.list',
  Dmm: 'Clash/Ruleset/Dmm.list',
  DAZN: 'Clash/Ruleset/DAZN.list',
  KKTV: 'Clash/Ruleset/KKTV.list',
  LiTV: 'Clash/Ruleset/LiTV.list',
  HWTV: 'Clash/Ruleset/HWTV.list',
};

/** Provider name → path relative to REPO_RULES_BASE. */
const REPO_RULE_PATH: Record<string, string> = {
  DnsProxy: 'templates/rule-providers/DnsProxy.yaml',
  TwMedia: 'templates/rule-providers/TwMedia.yaml',
  Paramount: 'templates/rule-providers/Paramount.yaml',
  Starplus: 'templates/rule-providers/Starplus.yaml',
};

function resolveRuleUrl(name: string): string {
  const repoRel = REPO_RULE_PATH[name];
  if (repoRel) {
    return `${REPO_RULES_BASE.replace(/\/$/, '')}/${repoRel}`;
  }
  const aclRel = ACL4SSR_RULE_PATH[name] ?? `Clash/Providers/Ruleset/${name}.yaml`;
  return `${ACL4SSR_RULES_BASE.replace(/\/$/, '')}/${aclRel}`;
}

function isYamlPayloadSource(name: string, url: string): boolean {
  if (REPO_RULE_PATH[name]) return true;
  return url.endsWith('.yaml');
}

/** Rewrite template `rule-providers` from local file paths to HTTP downloads. */
export function applyHttpRuleProviders(
  ruleProviders: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!ruleProviders) return ruleProviders;

  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(ruleProviders)) {
    const path =
      typeof raw.path === 'string' ? raw.path : `./providers/rules/${name.toLowerCase()}.yaml`;
    const behavior =
      raw.behavior === 'ipcidr' || raw.behavior === 'domain' || raw.behavior === 'classical'
        ? raw.behavior
        : name === 'ChinaCompanyIp'
          ? 'ipcidr'
          : 'classical';

    const url = resolveRuleUrl(name);
    const entry: Record<string, unknown> = {
      type: 'http',
      behavior,
      url,
      path,
      interval: RULE_PROVIDER_INTERVAL_SEC,
    };
    if (isYamlPayloadSource(name, url)) {
      entry.format = 'yaml';
    }
    out[name] = entry;
  }
  return out;
}
