import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';

import { getConfigPath } from '@/lib/config-path';

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

export type AppConfigRaw = {
  adminPassword?: string;
  subscriptionPool: Record<string, SubscriptionPoolEntryRaw>;
  profiles: ProfileEntryRaw[];
  /** Clash 额外分流规则，生成配置时插入模板 rules 最前面（最高优先级） */
  extraRules?: string[];
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
  extraRules: string[];
  adminPassword: string;
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

function parseExtraRules(data: unknown): string[] {
  const raw = (data as AppConfigRaw)?.extraRules;
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('config: "extraRules" must be an array of strings');
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (typeof raw[i] !== 'string') {
      throw new Error(`config: extraRules[${i}] must be a string`);
    }
    const line = raw[i].trim();
    if (!line) {
      continue;
    }
    if (!line.includes(',')) {
      throw new Error(`config: extraRules[${i}] must be a Clash rule (TYPE,...)`);
    }
    out.push(line);
  }
  return out;
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

export function parseConfigData(data: AppConfigRaw) {
  const subscriptionPool = parseSubscriptionPool(data);
  const byToken = parseProfiles(data, subscriptionPool);
  const extraRules = parseExtraRules(data);
  const adminPassword = parseAdminPassword(data);
  return { byToken, subscriptionPool, extraRules, adminPassword, rawData: data };
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
  extraRules: string[];
}) {
  const CONFIG_PATH = getConfigPath();
  const existing = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as AppConfigRaw;
  const next: AppConfigRaw = {
    ...existing,
    subscriptionPool: partial.subscriptionPool,
    profiles: partial.profiles,
    extraRules: partial.extraRules,
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
  const next: AppConfigRaw = { ...existing, adminPassword: trimmed };
  parseConfigData(next);
  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  const st = await stat(CONFIG_PATH);
  cachedConfig = { mtimeMs: st.mtimeMs, ...parseConfigData(next) };
}

export async function getAdminSafePayload(): Promise<
  Omit<AppConfigRaw, 'adminPassword'> & { adminPasswordConfigured: boolean; extraRules: string[] }
> {
  const c = await loadConfig();
  const { subscriptionPool, profiles } = c.rawData;
  return {
    subscriptionPool,
    profiles,
    extraRules: c.extraRules,
    adminPasswordConfigured: c.adminPassword.length > 0,
  };
}
