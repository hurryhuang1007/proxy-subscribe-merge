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
const SUBCONVERTER_URL = (process.env.SUBCONVERTER_URL || 'http://127.0.0.1:25500').replace(
  /\/$/,
  '',
);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const MERGE_CONFIG_PATH = path.resolve(
  process.env.MERGE_CONFIG_PATH || path.join(process.cwd(), 'merge-config.json'),
);

const SUBCONVERTER_CUSTOM_KEYS = new Set([
  'generateRules',
  'overwriteRules',
  'prefixByTag',
  'extraRename',
  'emojis',
  'rawAppend',
]);

function readTokenFromQuery(req) {
  const raw = req.query.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return typeof token === 'string' ? token : '';
}

function assertNoLegacyExternalConfig(profile, index) {
  if (profile.externalConfig != null && String(profile.externalConfig).trim() !== '') {
    throw new Error(
      `merge-config: profiles[${index}] 使用了已废弃的 "externalConfig" 外链，请改为使用 "subconverterCustom"（或高级选项 "externalConfigIni"），并设置 PUBLIC_BASE_URL`,
    );
  }
}

function validateSubconverterCustomKeys(custom, profileIndex) {
  for (const k of Object.keys(custom)) {
    if (!SUBCONVERTER_CUSTOM_KEYS.has(k)) {
      throw new Error(
        `merge-config: profiles[${profileIndex}].subconverterCustom 含有未知字段 "${k}"，允许: ${[...SUBCONVERTER_CUSTOM_KEYS].join(', ')}`,
      );
    }
  }
}

function buildIniFromSubconverterCustom(custom, profileIndex) {
  validateSubconverterCustomKeys(custom, profileIndex);
  const lines = ['[custom]'];
  lines.push(`enable_rule_generator=${custom.generateRules === true ? 'true' : 'false'}`);
  lines.push(`overwrite_original_rules=${custom.overwriteRules === true ? 'true' : 'false'}`);

  const prefixByTag = custom.prefixByTag;
  if (prefixByTag != null) {
    if (typeof prefixByTag !== 'object' || Array.isArray(prefixByTag)) {
      throw new Error(
        `merge-config: profiles[${profileIndex}].subconverterCustom.prefixByTag 必须为对象`,
      );
    }
    const keys = Object.keys(prefixByTag).sort();
    for (const tag of keys) {
      const prefix = prefixByTag[tag];
      if (typeof tag !== 'string' || !/^[-\w.]+$/.test(tag)) {
        throw new Error(
          `merge-config: prefixByTag 的键 "${tag}" 须与 sources[].tag 相同格式（字母数字 - _ .）`,
        );
      }
      if (typeof prefix !== 'string' || /[\r\n]/.test(prefix)) {
        throw new Error(`merge-config: prefixByTag."${tag}" 必须为不含换行的字符串`);
      }
      lines.push(`rename=!!GROUP=${tag}!!^@${prefix}`);
    }
  }

  if (custom.extraRename != null) {
    if (!Array.isArray(custom.extraRename)) {
      throw new Error(
        `merge-config: profiles[${profileIndex}].subconverterCustom.extraRename 必须为数组`,
      );
    }
    for (let j = 0; j < custom.extraRename.length; j++) {
      const item = custom.extraRename[j];
      if (typeof item === 'string') {
        if (!item.includes('@')) {
          throw new Error(
            `merge-config: extraRename[${j}] 字符串须为 subconverter 的「匹配@替换」整段（至少含一个 @）`,
          );
        }
        if (/[\r\n]/.test(item)) {
          throw new Error(`merge-config: extraRename[${j}] 不得含换行`);
        }
        lines.push(`rename=${item}`);
      } else if (
        item &&
        typeof item === 'object' &&
        typeof item.pattern === 'string' &&
        typeof item.replacement === 'string'
      ) {
        if (/[\r\n]/.test(item.pattern) || /[\r\n]/.test(item.replacement)) {
          throw new Error(`merge-config: extraRename[${j}] 的 pattern / replacement 不得含换行`);
        }
        lines.push(`rename=${item.pattern}@${item.replacement}`);
      } else {
        throw new Error(
          `merge-config: extraRename[${j}] 须为字符串，或 { "pattern": "…", "replacement": "…" }`,
        );
      }
    }
  }

  if (custom.emojis != null) {
    if (!Array.isArray(custom.emojis)) {
      throw new Error(
        `merge-config: profiles[${profileIndex}].subconverterCustom.emojis 必须为数组`,
      );
    }
    for (let j = 0; j < custom.emojis.length; j++) {
      const row = custom.emojis[j];
      if (
        !row ||
        typeof row !== 'object' ||
        typeof row.match !== 'string' ||
        typeof row.emoji !== 'string'
      ) {
        throw new Error(
          `merge-config: emojis[${j}] 须为 { "match": "关键词或正则片段", "emoji": "🇭🇰" }`,
        );
      }
      if (/[\r\n]/.test(row.match) || /[\r\n]/.test(row.emoji)) {
        throw new Error(`merge-config: emojis[${j}] 不得含换行`);
      }
      lines.push(`emoji=(${row.match}),${row.emoji}`);
    }
  }

  if (custom.rawAppend != null) {
    if (typeof custom.rawAppend !== 'string') {
      throw new Error(
        `merge-config: profiles[${profileIndex}].subconverterCustom.rawAppend 必须为字符串`,
      );
    }
    const rest = custom.rawAppend.trim();
    if (rest) {
      lines.push(rest);
    }
  }

  return `${lines.join('\n')}\n`;
}

function getResolvedExternalConfigBody(profile, profileIndex) {
  const rawIni =
    typeof profile.externalConfigIni === 'string' ? profile.externalConfigIni.trim() : '';
  const custom = profile.subconverterCustom;
  const hasCustomObject =
    custom != null &&
    typeof custom === 'object' &&
    !Array.isArray(custom) &&
    Object.keys(custom).length > 0;

  if (rawIni && hasCustomObject) {
    throw new Error(
      `merge-config: profiles[${profileIndex}] 不能同时使用 externalConfigIni 与 subconverterCustom，请只保留其一`,
    );
  }
  if (rawIni) {
    return rawIni;
  }
  if (hasCustomObject) {
    return buildIniFromSubconverterCustom(custom, profileIndex);
  }
  return '';
}

function buildUrlQueryParam(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('profile "sources" must be a non-empty array');
  }
  const parts = [];
  for (const s of sources) {
    if (!s || typeof s.url !== 'string' || s.url.length === 0) {
      throw new Error('each source needs a non-empty string "url"');
    }
    const tag = typeof s.tag === 'string' ? s.tag.trim() : '';
    if (tag.length > 0) {
      if (!/^[-\w.]+$/.test(tag)) {
        throw new Error(
          `source tag "${tag}" should use only letters, digits, hyphen, underscore, dot`,
        );
      }
      parts.push(`tag:${tag},${encodeURIComponent(s.url)}`);
    } else {
      parts.push(encodeURIComponent(s.url));
    }
  }
  return parts.join('|');
}

function buildGatewayConfigUrl(token) {
  if (!PUBLIC_BASE_URL) {
    throw new Error(
      '已配置 subconverter 外部规则时必须在环境变量中设置 PUBLIC_BASE_URL（subconverter 能访问到的网关基址，无末尾斜杠）',
    );
  }
  return `${PUBLIC_BASE_URL}/config?token=${encodeURIComponent(token)}`;
}

function buildSubconverterSearch(profile, token) {
  const target = typeof profile.target === 'string' ? profile.target : 'mixed';
  const urlParam = buildUrlQueryParam(profile.sources);
  const params = [
    `target=${encodeURIComponent(target)}`,
    `url=${encodeURIComponent(urlParam)}`,
  ];
  const iniBody = profile._resolvedExternalBody ?? '';
  if (iniBody.length > 0) {
    params.push(`config=${encodeURIComponent(buildGatewayConfigUrl(token))}`);
  }
  if (profile.extraQuery && typeof profile.extraQuery === 'object') {
    for (const [k, v] of Object.entries(profile.extraQuery)) {
      if (k === 'target' || k === 'url' || k === 'config') {
        continue;
      }
      params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return params.join('&');
}

function parseProfiles(data) {
  if (!data || !Array.isArray(data.profiles) || data.profiles.length === 0) {
    throw new Error('merge-config: root must have a non-empty "profiles" array');
  }
  const byToken = new Map();
  for (let i = 0; i < data.profiles.length; i++) {
    const p = { ...data.profiles[i] };
    if (!p || typeof p.token !== 'string' || p.token.length === 0) {
      throw new Error(`merge-config: profiles[${i}] needs a non-empty string "token"`);
    }
    assertNoLegacyExternalConfig(p, i);
    const token = p.token.trim();
    if (byToken.has(token)) {
      throw new Error('merge-config: duplicate "token" in profiles');
    }
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      throw new Error(`merge-config: profiles[${i}] needs non-empty "sources"`);
    }
    const resolvedBody = getResolvedExternalConfigBody(p, i);
    if (resolvedBody && !PUBLIC_BASE_URL) {
      throw new Error(
        'merge-config: 某 profile 配置了 subconverterCustom 或 externalConfigIni，但未设置环境变量 PUBLIC_BASE_URL',
      );
    }
    p._resolvedExternalBody = resolvedBody;
    byToken.set(token, p);
  }
  return byToken;
}

let cachedConfig = { mtimeMs: 0, byToken: null };

async function loadProfileByToken(token) {
  if (!existsSync(MERGE_CONFIG_PATH)) {
    throw new Error(`merge-config file not found: ${MERGE_CONFIG_PATH}`);
  }
  const st = await stat(MERGE_CONFIG_PATH);
  if (!cachedConfig.byToken || st.mtimeMs !== cachedConfig.mtimeMs) {
    const raw = await readFile(MERGE_CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw);
    const byToken = parseProfiles(data);
    cachedConfig = { mtimeMs: st.mtimeMs, byToken };
  }
  if (!token || typeof token !== 'string') {
    return null;
  }
  return cachedConfig.byToken.get(token.trim()) ?? null;
}

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true }));

app.get('/config', async (req, reply) => {
  const tokenStr = readTokenFromQuery(req);
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
  const body = profile._resolvedExternalBody ?? '';
  if (!body) {
    return reply.code(404).send({ error: 'no_subconverter_external' });
  }
  return reply
    .header('content-type', 'text/plain; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(body);
});

app.get('/sub', async (req, reply) => {
  const tokenStr = readTokenFromQuery(req);
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

  let search;
  try {
    search = buildSubconverterSearch(profile, tokenStr.trim());
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ error: 'invalid_profile', message: e.message });
  }

  const scUrl = `${SUBCONVERTER_URL}/sub?${search}`;
  let res;
  try {
    res = await fetch(scUrl, {
      headers: { 'User-Agent': 'proxy-subscribe-merge/1.0' },
    });
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: 'subconverter_unreachable', message: e.message });
  }

  const body = await res.text();
  const ct = res.headers.get('content-type');
  if (ct) {
    reply.header('content-type', ct);
  }
  return reply.code(res.status).send(body);
});

await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`listening on ${PORT}, subconverter ${SUBCONVERTER_URL}`);
if (PUBLIC_BASE_URL) {
  app.log.info(`PUBLIC_BASE_URL=${PUBLIC_BASE_URL} (subconverter 将从此基址拉取 /config)`);
}
