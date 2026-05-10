import { loadConfig, getProfileByToken } from '@/lib/config';
import { mergeShareLinksForProfile } from '@/lib/subscribe';

function readToken(url: URL) {
  return url.searchParams.get('token')?.trim() ?? '';
}

function readPlain(url: URL) {
  const v = url.searchParams.get('plain');
  return v === '1' || v === 'true';
}

function noStoreHeaders(h: Headers) {
  h.set('cache-control', 'no-store, no-cache, must-revalidate');
  h.set('pragma', 'no-cache');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenStr = readToken(url);
  const wantPlain = readPlain(url);

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

  try {
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
    const body = wantPlain
      ? bodyText
      : `${Buffer.from(lines.join('\n'), 'utf8').toString('base64')}\n`;

    const headers = new Headers([['content-type', 'text/plain; charset=utf-8']]);
    noStoreHeaders(headers);
    return new Response(body, { status: 200, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown_error';
    return Response.json({ error: 'source_fetch_failed', message: msg }, { status: 502 });
  }
}
