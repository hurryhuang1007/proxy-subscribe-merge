import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';

import { getConfigPath } from '@/lib/config-path';

export type SubscriptionPoolEntryRaw = {
  url: string;
  disabled?: boolean;
  userAgent?: string;
};

export type AppConfigRaw = {
  adminPassword?: string;
  subscriptionPool: Record<string, SubscriptionPoolEntryRaw>;
  profiles: Array<{ token: string; sources: string[] }>;
};

export type SubscriptionPoolEntry = {
  name: string;
  url: string;
  disabled: boolean;
  userAgent: string;
};

let cachedConfig: {
  mtimeMs: number;
  byToken: Map<string, { token: string; sources: string[] }>;
  subscriptionPool: Map<string, SubscriptionPoolEntry>;
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

function parseProfiles(data: unknown, pool: Map<string, SubscriptionPoolEntry>): Map<string, { token: string; sources: string[] }> {
  const profiles = (data as AppConfigRaw)?.profiles;
  if (!data || !Array.isArray(profiles)) {
    throw new Error('config: root must have a "profiles" array');
  }
  const byToken = new Map<string, { token: string; sources: string[] }>();
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
    byToken.set(token, { token, sources });
  }
  return byToken;
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
  const adminPassword = parseAdminPassword(data);
  return { byToken, subscriptionPool, adminPassword, rawData: data };
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

export async function saveConfigPartial(partial: { subscriptionPool: AppConfigRaw['subscriptionPool']; profiles: AppConfigRaw['profiles'] }) {
  const CONFIG_PATH = getConfigPath();
  const existing = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as AppConfigRaw;
  const next: AppConfigRaw = {
    ...existing,
    subscriptionPool: partial.subscriptionPool,
    profiles: partial.profiles,
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

export async function getAdminSafePayload(): Promise<Omit<AppConfigRaw, 'adminPassword'> & { adminPasswordConfigured: boolean }> {
  const c = await loadConfig();
  const { subscriptionPool, profiles } = c.rawData;
  return {
    subscriptionPool,
    profiles,
    adminPasswordConfigured: c.adminPassword.length > 0,
  };
}
