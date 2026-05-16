import type { ProfileEntry, SubscriptionPoolEntry } from '@/lib/config';

const MAX_SOURCE_BYTES = Number(process.env.MAX_SOURCE_BYTES || 20_000_000);

function splitLines(s: string) {
  return s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

/** 排除 http(s)://，避免把网页/规则链接误当成节点行 */
function looksLikeShareUri(line: string) {
  if (/^https?:\/\//i.test(line)) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(line);
}

function looksLikeBase64Block(s: string) {
  const t = s.replace(/\s+/g, '');
  return t.length >= 16 && /^[A-Za-z0-9+/=_-]+$/.test(t);
}

function decodeBase64Flexible(b64: string): string | null {
  const t = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (t.length % 4)) % 4;
  const padded = `${t}${'='.repeat(pad)}`;
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 从订阅正文提取分享链接（支持：整段 base64、多行 base64、直接多行 vmess/vless/…）
 */
export function extractShareLinksFromSubscriptionText(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const addFromDecoded = (decoded: string) => {
    for (const line of splitLines(decoded)) {
      if (looksLikeShareUri(line)) {
        push(line);
      }
    }
  };

  const compact = raw.replace(/\s+/g, '');
  if (compact.length >= 20 && looksLikeBase64Block(compact)) {
    const decoded = decodeBase64Flexible(compact);
    if (decoded && decoded.includes('://')) {
      addFromDecoded(decoded);
      if (out.length > 0) {
        return out;
      }
    }
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return out;
  }

  for (const line of splitLines(trimmed)) {
    if (looksLikeShareUri(line)) {
      push(line);
      continue;
    }
    const one = line.replace(/\s+/g, '');
    if (one.length >= 20 && looksLikeBase64Block(one)) {
      const decoded = decodeBase64Flexible(one);
      if (decoded && decoded.includes('://')) {
        addFromDecoded(decoded);
      }
    }
  }
  return out;
}

export async function fetchHttpSourceBody(url: string, ua: string) {
  const init = ua.length > 0 ? { headers: { 'User-Agent': ua } } : undefined;
  const res = await fetch(url, init);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_SOURCE_BYTES) {
    throw new Error(`source response too large (>${MAX_SOURCE_BYTES} bytes)`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return buf.toString('utf8');
}

export type WarnLogger = Pick<Console, 'warn'>;

export async function mergeShareLinksForSource(
  sourceName: string,
  subscriptionPool: Map<string, SubscriptionPoolEntry>,
  log: WarnLogger,
) {
  const source = subscriptionPool.get(sourceName);
  if (!source || source.disabled) {
    return [];
  }
  const { url, userAgent } = source;
  try {
    if (/^https?:\/\//i.test(url)) {
      const text = await fetchHttpSourceBody(url, userAgent);
      return extractShareLinksFromSubscriptionText(text);
    }
    return extractShareLinksFromSubscriptionText(url);
  } catch (err) {
    log.warn(`source (${sourceName}) fetch failed; skipped`, err);
    return [];
  }
}

export async function mergeShareLinksForProfile(
  profile: Pick<ProfileEntry, 'sources'>,
  subscriptionPool: Map<string, SubscriptionPoolEntry>,
  log: WarnLogger,
) {
  const linksBySource = await Promise.all(
    profile.sources.map(async (sourceName, idx) => {
      const source = subscriptionPool.get(sourceName);
      if (!source || source.disabled) {
        return [];
      }
      const { url, userAgent } = source;
      let text;
      try {
        if (/^https?:\/\//i.test(url)) {
          text = await fetchHttpSourceBody(url, userAgent);
        } else {
          text = url;
        }
      } catch (err) {
        log.warn(`source[${idx}] (${sourceName}) fetch failed; skipped`, err);
        return [];
      }
      return extractShareLinksFromSubscriptionText(text);
    }),
  );

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const links of linksBySource) {
    for (const line of links) {
      if (seen.has(line)) continue;
      seen.add(line);
      merged.push(line);
    }
  }
  return merged;
}
