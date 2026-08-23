import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';

import { getConfigPath } from '@/lib/config-path';
import {
  DEFAULT_SOURCE_PREFETCH_ENABLED,
  DEFAULT_SOURCE_PREFETCH_INTERVAL_MINUTES,
  MAX_SOURCE_PREFETCH_INTERVAL_MINUTES,
  MIN_SOURCE_PREFETCH_INTERVAL_MINUTES,
} from '@/lib/source-prefetch-constants';

export type SubscriptionPoolEntryRaw = {
  url: string;
  disabled?: boolean;
  userAgent?: string;
};

export type ProfileEntryRaw = {
  token: string;
  sources: string[];
  /** 可选展示名，便于在控制台区分客户；不影响 /sub?token 鉴权 */
  name?: string;
  /** 禁用后 /sub 拒绝拉取 */
  disabled?: boolean;
};

export type ProfileEntry = {
  token: string;
  sources: string[];
  name: string;
  disabled: boolean;
};

/** 配置文件中单条额外规则：字符串为启用；对象可标记 disabled */
export type ExtraRuleEntryRaw = string | { line: string; disabled?: boolean };

export type ExtraRuleEntry = {
  line: string;
  disabled: boolean;
};

export type SourcePrefetchRaw = {
  enabled?: boolean;
  intervalMinutes?: number;
};

export type SourcePrefetch = {
  enabled: boolean;
  intervalMinutes: number;
};

export type AppConfigRaw = {
  adminPassword?: string;
  /** 递增后会使旧 JWT 失效（改密时自动 +1） */
  adminSessionVersion?: number;
  subscriptionPool: Record<string, SubscriptionPoolEntryRaw>;
  profiles: ProfileEntryRaw[];
  /** Clash 额外分流规则，生成配置时插入模板 rules 最前面（最高优先级） */
  extraRules?: ExtraRuleEntryRaw[];
  /** 是否定时拉取订阅源并缓存到内存；缺省视为开启 */
  sourcePrefetch?: SourcePrefetchRaw;
};

export type SubscriptionPoolEntry = {
  name: string;
  url: string;
  disabled: boolean;
  userAgent: string;
};

let cachedConfig: {
  mtimeMs: number;
  byToken: Map<string, ProfileEntry>;
  subscriptionPool: Map<string, SubscriptionPoolEntry>;
  extraRules: ExtraRuleEntry[];
  adminPassword: string;
  adminSessionVersion: number;
  sourcePrefetch: SourcePrefetch;
  rawData: AppConfigRaw;
} | null = null;

function parseSubscriptionPool(data: unknown): Map<string, SubscriptionPoolEntry> {
  const pool = (data as AppConfigRaw)?.subscriptionPool;
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) {
    throw new Error('config: root must have object "subscriptionPool"');
  }
  const out = new Map<string, SubscriptionPoolEntry>();
  for (const [name, raw] of Object.entries(pool)) {
    const sourceName = String(name).trim();
    if (!sourceName) {
      throw new Error('config: source name in "subscriptionPool" cannot be empty');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`config: subscriptionPool.${sourceName} must be an object`);
    }
    const url = typeof (raw as SubscriptionPoolEntryRaw).url === 'string' ? (raw as SubscriptionPoolEntryRaw).url.trim() : '';
    if (!url) {
      throw new Error(`config: subscriptionPool.${sourceName}.url must be non-empty string`);
    }
    const disabled = (raw as SubscriptionPoolEntryRaw).disabled == null ? false : Boolean((raw as SubscriptionPoolEntryRaw).disabled);
    const userAgentRaw = (raw as SubscriptionPoolEntryRaw).userAgent;
    const userAgent = userAgentRaw == null ? '' : String(userAgentRaw).trim();
    out.set(sourceName, { name: sourceName, url, disabled, userAgent });
  }
  return out;
}

function parseProfiles(data: unknown, pool: Map<string, SubscriptionPoolEntry>): Map<string, ProfileEntry> {
  const profiles = (data as AppConfigRaw)?.profiles;
  if (!data || !Array.isArray(profiles)) {
    throw new Error('config: root must have a "profiles" array');
  }
  const byToken = new Map<string, ProfileEntry>();
  for (let i = 0; i < profiles.length; i++) {
    const src = profiles[i];
    if (!src || typeof src.token !== 'string' || src.token.length === 0) {
      throw new Error(`config: profiles[${i}] needs a non-empty string "token"`);
    }
    const token = src.token.trim();
    if (byToken.has(token)) {
      throw new Error('config: duplicate "token" in profiles');
    }
    if (!Array.isArray(src.sources) || src.sources.length === 0) {
      throw new Error(`config: profiles[${i}] needs non-empty "sources"`);
    }
    const nameRaw = (src as ProfileEntryRaw).name;
    const name = nameRaw == null ? '' : String(nameRaw).trim();
    const sources: string[] = [];
    for (let j = 0; j < src.sources.length; j++) {
      const sourceName = typeof src.sources[j] === 'string' ? src.sources[j].trim() : '';
      if (!sourceName) {
        throw new Error(`config: profiles[${i}].sources[${j}] must be source name string`);
      }
      if (!pool.has(sourceName)) {
        throw new Error(`config: profiles[${i}].sources[${j}] unknown source name "${sourceName}"`);
      }
      sources.push(sourceName);
    }
    const disabledRaw = (src as ProfileEntryRaw).disabled;
    const disabled = disabledRaw == null ? false : Boolean(disabledRaw);
    byToken.set(token, { token, sources, name, disabled });
  }
  return byToken;
}

function validateExtraRuleLine(line: string, index: number): string {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error(`config: extraRules[${index}] line must be non-empty`);
  }
  if (!trimmed.includes(',')) {
    throw new Error(`config: extraRules[${index}] must be a Clash rule (TYPE,...)`);
  }
  return trimmed;
}

function parseExtraRules(data: unknown): ExtraRuleEntry[] {
  const raw = (data as AppConfigRaw)?.extraRules;
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('config: "extraRules" must be an array');
  }
  const out: ExtraRuleEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === 'string') {
      const line = validateExtraRuleLine(item, i);
      out.push({ line, disabled: false });
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`config: extraRules[${i}] must be a string or { line, disabled? }`);
    }
    const lineRaw = (item as { line?: unknown }).line;
    if (typeof lineRaw !== 'string') {
      throw new Error(`config: extraRules[${i}].line must be a string`);
    }
    const line = validateExtraRuleLine(lineRaw, i);
    const disabledRaw = (item as { disabled?: unknown }).disabled;
    const disabled = disabledRaw == null ? false : Boolean(disabledRaw);
    out.push({ line, disabled });
  }
  return out;
}

export function serializeExtraRulesForDisk(entries: ExtraRuleEntry[]): ExtraRuleEntryRaw[] {
  return entries.map((e) => (e.disabled ? { line: e.line, disabled: true } : e.line));
}

export function enabledExtraRuleLines(entries: ExtraRuleEntry[]): string[] {
  return entries.filter((e) => !e.disabled).map((e) => e.line);
}

function parseAdminPassword(data: AppConfigRaw): string {
  if (typeof data?.adminPassword === 'string' && data.adminPassword.trim().length > 0) {
    return data.adminPassword.trim();
  }
  if (typeof process.env.ADMIN_PASSWORD === 'string' && process.env.ADMIN_PASSWORD.trim().length > 0) {
    return process.env.ADMIN_PASSWORD.trim();
  }
  return '';
}

function parseAdminSessionVersion(data: AppConfigRaw): number {
  const v = data?.adminSessionVersion;
  if (v == null) {
    return 0;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Error('config: "adminSessionVersion" must be a non-negative integer');
  }
  return v;
}

export function parseSourcePrefetch(data: AppConfigRaw): SourcePrefetch {
  const raw = data?.sourcePrefetch;
  if (raw == null) {
    return {
      enabled: DEFAULT_SOURCE_PREFETCH_ENABLED,
      intervalMinutes: DEFAULT_SOURCE_PREFETCH_INTERVAL_MINUTES,
    };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config: "sourcePrefetch" must be an object');
  }
  const enabled = raw.enabled == null ? DEFAULT_SOURCE_PREFETCH_ENABLED : Boolean(raw.enabled);
  const interval = raw.intervalMinutes;
  if (interval == null) {
    return { enabled, intervalMinutes: DEFAULT_SOURCE_PREFETCH_INTERVAL_MINUTES };
  }
  if (typeof interval !== 'number' || !Number.isInteger(interval)) {
    throw new Error('config: "sourcePrefetch.intervalMinutes" must be an integer');
  }
  if (interval < MIN_SOURCE_PREFETCH_INTERVAL_MINUTES) {
    throw new Error(
      `config: "sourcePrefetch.intervalMinutes" must be >= ${MIN_SOURCE_PREFETCH_INTERVAL_MINUTES}`,
    );
  }
  if (interval > MAX_SOURCE_PREFETCH_INTERVAL_MINUTES) {
    throw new Error(
      `config: "sourcePrefetch.intervalMinutes" must be <= ${MAX_SOURCE_PREFETCH_INTERVAL_MINUTES}`,
    );
  }
  return { enabled, intervalMinutes: interval };
}

export function parseConfigData(data: AppConfigRaw) {
  const subscriptionPool = parseSubscriptionPool(data);
  const byToken = parseProfiles(data, subscriptionPool);
  const extraRules = parseExtraRules(data);
  const adminPassword = parseAdminPassword(data);
  const adminSessionVersion = parseAdminSessionVersion(data);
  const sourcePrefetch = parseSourcePrefetch(data);
  return { byToken, subscriptionPool, extraRules, adminPassword, adminSessionVersion, sourcePrefetch, rawData: data };
}

export async function loadConfig() {
  const CONFIG_PATH = getConfigPath();
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`config file not found: ${CONFIG_PATH}`);
  }
  const st = await stat(CONFIG_PATH);
  if (!cachedConfig || st.mtimeMs !== cachedConfig.mtimeMs) {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw) as AppConfigRaw;
    cachedConfig = { mtimeMs: st.mtimeMs, ...parseConfigData(data) };
  }
  return cachedConfig;
}

export async function getProfileByToken(token: string) {
  await loadConfig();
  if (!cachedConfig) {
    throw new Error('config not loaded');
  }
  if (!token.trim()) {
    return null;
  }
  return cachedConfig.byToken.get(token.trim()) ?? null;
}

export async function saveConfigPartial(partial: {
  subscriptionPool: AppConfigRaw['subscriptionPool'];
  profiles: ProfileEntryRaw[];
  extraRules: ExtraRuleEntryRaw[];
}) {
  const CONFIG_PATH = getConfigPath();
  const existing = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as AppConfigRaw;
  const parsedExtraRules = parseExtraRules({ extraRules: partial.extraRules });
  const next: AppConfigRaw = {
    ...existing,
    subscriptionPool: partial.subscriptionPool,
    profiles: partial.profiles,
    extraRules: serializeExtraRulesForDisk(parsedExtraRules),
  };
  parseConfigData(next);
  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  const st = await stat(CONFIG_PATH);
  cachedConfig = { mtimeMs: st.mtimeMs, ...parseConfigData(next) };
}

export async function updateAdminPassword(newPassword: string) {
  const CONFIG_PATH = getConfigPath();
  const trimmed = newPassword.trim();
  if (!trimmed) {
    throw new Error('new password must not be empty');
  }
  const existing = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as AppConfigRaw;
  const prevVersion = parseAdminSessionVersion(existing);
  const next: AppConfigRaw = {
    ...existing,
    adminPassword: trimmed,
    adminSessionVersion: prevVersion + 1,
  };
  parseConfigData(next);
  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  const st = await stat(CONFIG_PATH);
  cachedConfig = { mtimeMs: st.mtimeMs, ...parseConfigData(next) };
}

export async function saveSourcePrefetch(prefetch: SourcePrefetch) {
  const CONFIG_PATH = getConfigPath();
  const existing = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as AppConfigRaw;
  const next: AppConfigRaw = {
    ...existing,
    sourcePrefetch: {
      enabled: prefetch.enabled,
      intervalMinutes: prefetch.intervalMinutes,
    },
  };
  parseConfigData(next);
  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  const st = await stat(CONFIG_PATH);
  cachedConfig = { mtimeMs: st.mtimeMs, ...parseConfigData(next) };
}

export async function getAdminSafePayload(): Promise<
  Omit<AppConfigRaw, 'adminPassword'> & {
    adminPasswordConfigured: boolean;
    extraRules: ExtraRuleEntry[];
    sourcePrefetch: SourcePrefetch;
  }
> {
  const c = await loadConfig();
  const { subscriptionPool, profiles } = c.rawData;
  return {
    subscriptionPool,
    profiles,
    extraRules: c.extraRules,
    sourcePrefetch: c.sourcePrefetch,
    adminPasswordConfigured: c.adminPassword.length > 0,
  };
}
