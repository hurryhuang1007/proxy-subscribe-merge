import dotenv from 'dotenv';
import Fastify from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envPath = existsSync(path.join(root, '.env'))
  ? path.join(root, '.env')
  : path.join(root, '.env.example');
dotenv.config({ path: envPath });

const PORT = Number(process.env.PORT || 8787);
const MERGE_CONFIG_PATH = path.resolve(
  process.env.MERGE_CONFIG_PATH || path.join(process.cwd(), 'merge-config.json'),
);
const MAX_SOURCE_BYTES = Number(process.env.MAX_SOURCE_BYTES || 20_000_000);

function readTokenFromQuery(req) {
  const raw = req.query.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return typeof token === 'string' ? token : '';
}

function readPlainFromQuery(req) {
  const raw = req.query.plain;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === '1' || v === 'true';
}

function noStoreCacheHeaders(reply) {
  reply.header('cache-control', 'no-store, no-cache, must-revalidate');
  reply.header('pragma', 'no-cache');
}

function splitLines(s) {
  return s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

/** 排除 http(s)://，避免把网页/规则链接误当成节点行 */
function looksLikeShareUri(line) {
  if (/^https?:\/\//i.test(line)) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(line);
}

function looksLikeBase64Block(s) {
  const t = s.replace(/\s+/g, '');
  return t.length >= 16 && /^[A-Za-z0-9+/=_-]+$/.test(t);
}

function decodeBase64Flexible(b64) {
  const t = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (t.length % 4)) % 4;
  const padded = t + '='.repeat(pad);
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 从订阅正文提取分享链接（支持：整段 base64、多行 base64、直接多行 vmess/vless/…）
 */
function extractShareLinksFromSubscriptionText(raw) {
  const out = [];
  const seen = new Set();
  const push = (s) => {
    if (seen.has(s)) {
      return;
    }
    seen.add(s);
    out.push(s);
  };
  const addFromDecoded = (decoded) => {
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

function parseSourceFetchUserAgent(data) {
  const raw = data?.sourceFetchUserAgent;
  if (raw == null) {
    return '';
  }
  if (typeof raw !== 'string') {
    throw new Error('merge-config: "sourceFetchUserAgent" 必须为字符串（可省略，默认空）');
  }
  return raw.trim();
}

function parseProfiles(data) {
  if (!data || !Array.isArray(data.profiles) || data.profiles.length === 0) {
    throw new Error('merge-config: root must have a non-empty "profiles" array');
  }
  const byToken = new Map();
  for (let i = 0; i < data.profiles.length; i++) {
    const src = data.profiles[i];
    if (!src || typeof src.token !== 'string' || src.token.length === 0) {
      throw new Error(`merge-config: profiles[${i}] needs a non-empty string "token"`);
    }
    const token = src.token.trim();
    if (byToken.has(token)) {
      throw new Error('merge-config: duplicate "token" in profiles');
    }
    if (!Array.isArray(src.sources) || src.sources.length === 0) {
      throw new Error(`merge-config: profiles[${i}] needs non-empty "sources"`);
    }
    const sources = [];
    for (let j = 0; j < src.sources.length; j++) {
      const s = src.sources[j];
      if (!s || typeof s.url !== 'string' || s.url.trim().length === 0) {
        throw new Error(`merge-config: profiles[${i}].sources[${j}] needs non-empty "url"`);
      }
      sources.push({ url: s.url.trim() });
    }
    byToken.set(token, { token, sources });
  }
  return byToken;
}

let cachedConfig = { mtimeMs: 0, byToken: null, sourceFetchUserAgent: '' };

async function loadProfileByToken(token) {
  if (!existsSync(MERGE_CONFIG_PATH)) {
    throw new Error(`merge-config file not found: ${MERGE_CONFIG_PATH}`);
  }
  const st = await stat(MERGE_CONFIG_PATH);
  if (!cachedConfig.byToken || st.mtimeMs !== cachedConfig.mtimeMs) {
    const raw = await readFile(MERGE_CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw);
    const byToken = parseProfiles(data);
    const sourceFetchUserAgent = parseSourceFetchUserAgent(data);
    cachedConfig = { mtimeMs: st.mtimeMs, byToken, sourceFetchUserAgent };
  }
  if (!token || typeof token !== 'string') {
    return null;
  }
  return cachedConfig.byToken.get(token.trim()) ?? null;
}

async function fetchHttpSourceBody(url, ua) {
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

/**
 * 按 sources 顺序合并；同一链接去重（保留先出现的顺序）
 * 单个源拉取失败时跳过该源，不影响其它源。
 */
async function mergeShareLinksForProfile(profile, ua, log) {
  const linksBySource = await Promise.all(
    profile.sources.map(async (source, idx) => {
      const url = source.url;
      let text;
      try {
        if (/^https?:\/\//i.test(url)) {
          text = await fetchHttpSourceBody(url, ua);
        } else {
          text = url;
        }
      } catch (e) {
        log.warn({ err: e, idx }, `source[${idx}] fetch failed; skipped`);
        return [];
      }
      return extractShareLinksFromSubscriptionText(text);
    }),
  );

  const merged = [];
  const seen = new Set();
  for (const links of linksBySource) {
    for (const line of links) {
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
      merged.push(line);
    }
  }
  return merged;
}

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true }));

app.get('/sub', async (req, reply) => {
  const tokenStr = readTokenFromQuery(req);
  const wantPlain = readPlainFromQuery(req);
  let profile;
  try {
    profile = await loadProfileByToken(tokenStr);
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ error: 'config_error', message: e.message });
  }
  if (!profile) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const ua = (cachedConfig.sourceFetchUserAgent ?? '').trim();
  let lines;
  try {
    lines = await mergeShareLinksForProfile(profile, ua, req.log);
  } catch (e) {
    req.log.error(e);
    return reply
      .code(502)
      .header('content-type', 'application/json; charset=utf-8')
      .send({ error: 'source_fetch_failed', message: e.message });
  }

  if (lines.length === 0) {
    return reply
      .code(404)
      .header('content-type', 'text/plain; charset=utf-8')
      .header('cache-control', 'no-store')
      .send('No nodes were found!\n');
  }

  const body = wantPlain
    ? `${lines.join('\n')}\n`
    : `${Buffer.from(lines.join('\n'), 'utf8').toString('base64')}\n`;

  noStoreCacheHeaders(reply);
  return reply
    .header('content-type', 'text/plain; charset=utf-8')
    .code(200)
    .send(body);
});

await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`listening on ${PORT}, merge-config ${MERGE_CONFIG_PATH}`);
