import { loadConfig, getProfileByToken } from '@/lib/config';
import { isClashClientUserAgent } from '@/lib/clash';
import {
  buildClashProfileYaml,
  buildClashProxiesYamlForSource,
  profileHasEnabledSources,
} from '@/lib/clash-profile';
import { mergeShareLinksForProfile } from '@/lib/subscribe';

function readToken(url: URL) {
  return url.searchParams.get('token')?.trim() ?? '';
}

function readSource(url: URL) {
  return url.searchParams.get('source')?.trim() ?? '';
}

function readPlain(url: URL) {
  const v = url.searchParams.get('plain');
  return v === '1' || v === 'true';
}

type OutputType = 'clash' | 'proxies' | 'plain' | 'default';

function readOutputType(url: URL, req: Request): OutputType {
  const type = url.searchParams.get('type')?.trim().toLowerCase();
  if (type === 'proxies') return 'proxies';
  if (type === 'clash') return 'clash';
  if (isClashClientUserAgent(req.headers.get('user-agent')) && !readSource(url)) return 'clash';
  if (readPlain(url)) return 'plain';
  return 'default';
}

function noStoreHeaders(h: Headers) {
  h.set('cache-control', 'no-store, no-cache, must-revalidate');
  h.set('pragma', 'no-cache');
}

function subBaseUrlFromRequest(url: URL) {
  return `${url.origin}/sub`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenStr = readToken(url);
  const outputType = readOutputType(url, req);
  const sourceName = readSource(url);

  let profile;
  try {
    profile = await getProfileByToken(tokenStr);
  } catch {
    return Response.json({ error: 'config_error' }, { status: 500 });
  }
  if (!profile) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cfg = await loadConfig();
  const relay = { subBaseUrl: subBaseUrlFromRequest(url), token: tokenStr };

  try {
    let body: string;
    let contentType: string;

    if (outputType === 'proxies') {
      if (!sourceName) {
        return Response.json({ error: 'missing_source' }, { status: 400 });
      }
      if (!profile.sources.includes(sourceName)) {
        return Response.json({ error: 'unknown_source' }, { status: 404 });
      }
      const yaml = await buildClashProxiesYamlForSource(sourceName, cfg.subscriptionPool, console);
      if (!yaml) {
        return new Response('No convertible nodes were found!\n', {
          status: 404,
          headers: new Headers([
            ['content-type', 'text/plain; charset=utf-8'],
            ['cache-control', 'no-store'],
          ]),
        });
      }
      body = yaml;
      contentType = 'text/yaml; charset=utf-8';
    } else if (outputType === 'clash') {
      if (!profileHasEnabledSources(profile, cfg.subscriptionPool)) {
        return new Response('No nodes were found!\n', {
          status: 404,
          headers: new Headers([
            ['content-type', 'text/plain; charset=utf-8'],
            ['cache-control', 'no-store'],
          ]),
        });
      }
      let yaml: string;
      try {
        yaml = await buildClashProfileYaml(profile, cfg.subscriptionPool, relay);
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('ENOENT')) {
          return Response.json({ error: 'clash_template_missing' }, { status: 500 });
        }
        throw e;
      }
      if (!yaml) {
        return new Response('No convertible nodes were found!\n', {
          status: 404,
          headers: new Headers([
            ['content-type', 'text/plain; charset=utf-8'],
            ['cache-control', 'no-store'],
          ]),
        });
      }
      body = yaml;
      contentType = 'text/yaml; charset=utf-8';
    } else {
      const lines = await mergeShareLinksForProfile(profile, cfg.subscriptionPool, console);
      if (lines.length === 0) {
        return new Response('No nodes were found!\n', {
          status: 404,
          headers: new Headers([
            ['content-type', 'text/plain; charset=utf-8'],
            ['cache-control', 'no-store'],
          ]),
        });
      }
      const bodyText = `${lines.join('\n')}\n`;
      body =
        outputType === 'plain'
          ? bodyText
          : `${Buffer.from(lines.join('\n'), 'utf8').toString('base64')}\n`;
      contentType = 'text/plain; charset=utf-8';
    }

    const headers = new Headers([['content-type', contentType]]);
    noStoreHeaders(headers);
    return new Response(body, { status: 200, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown_error';
    return Response.json({ error: 'source_fetch_failed', message: msg }, { status: 502 });
  }
}
