import yaml from 'js-yaml';

export type ClashProxy = Record<string, unknown>;

function decodeFragmentName(fragment: string) {
  if (!fragment) return 'node';
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function decodeBase64Loose(b64: string): string | null {
  const t = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (t.length % 4)) % 4;
  try {
    return Buffer.from(`${t}${'='.repeat(pad)}`, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function parseUrlLike(uri: string) {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function setTransport(proxy: ClashProxy, network: string, params: URLSearchParams) {
  const net = network.toLowerCase();
  if (net === 'tcp' || !net) {
    proxy.network = 'tcp';
    return;
  }
  proxy.network = net;
  if (net === 'ws') {
    const path = params.get('path') ?? '/';
    const host = params.get('host') ?? params.get('wsHost') ?? '';
    const opts: Record<string, unknown> = { path };
    if (host) {
      opts.headers = { Host: host };
    }
    proxy['ws-opts'] = opts;
    return;
  }
  if (net === 'grpc') {
    proxy['grpc-opts'] = {
      'grpc-service-name': params.get('serviceName') ?? params.get('path') ?? '',
    };
  }
  if (net === 'h2') {
    const path = params.get('path') ?? '/';
    const host = params.get('host') ?? '';
    const opts: Record<string, unknown> = { path: [path] };
    if (host) {
      opts.host = [host];
    }
    proxy['h2-opts'] = opts;
  }
}

function applyTls(proxy: ClashProxy, params: URLSearchParams, host: string) {
  const security = (params.get('security') ?? params.get('tls') ?? '').toLowerCase();
  if (security === 'reality') {
    proxy.tls = true;
    const sni = params.get('sni') ?? params.get('peer') ?? host;
    if (sni) proxy.servername = sni;
    const pbk = params.get('pbk') ?? params.get('publicKey') ?? '';
    const sid = params.get('sid') ?? params.get('shortId') ?? '';
    if (pbk) {
      proxy['reality-opts'] = {
        'public-key': pbk,
        ...(sid ? { 'short-id': sid } : {}),
      };
    }
    return;
  }
  if (security === 'tls' || security === 'true' || params.has('sni') || params.has('peer')) {
    proxy.tls = true;
    const sni = params.get('sni') ?? params.get('peer') ?? host;
    if (sni) proxy.servername = sni;
    const alpn = params.get('alpn');
    if (alpn) proxy.alpn = alpn.split(',');
    const fp = params.get('fp') ?? params.get('client-fingerprint');
    if (fp) proxy['client-fingerprint'] = fp;
  }
}

function parseVless(uri: string): ClashProxy | null {
  const u = parseUrlLike(uri);
  if (!u || u.protocol !== 'vless:') return null;
  const uuid = decodeURIComponent(u.username);
  const server = u.hostname;
  const port = Number(u.port || 443);
  if (!uuid || !server || !Number.isFinite(port)) return null;

  const params = u.searchParams;
  const proxy: ClashProxy = {
    name: decodeFragmentName(u.hash.slice(1)),
    type: 'vless',
    server,
    port,
    uuid,
    udp: true,
  };

  const flow = params.get('flow');
  if (flow) proxy.flow = flow;

  const encryption = params.get('encryption');
  if (encryption && encryption !== 'none') proxy['packet-encoding'] = encryption;

  const network = params.get('type') ?? 'tcp';
  setTransport(proxy, network, params);
  applyTls(proxy, params, server);

  const fp = params.get('fp');
  if (fp && !proxy['client-fingerprint']) proxy['client-fingerprint'] = fp;

  return proxy;
}

function parseTrojan(uri: string): ClashProxy | null {
  const u = parseUrlLike(uri);
  if (!u || u.protocol !== 'trojan:') return null;
  const password = decodeURIComponent(u.username);
  const server = u.hostname;
  const port = Number(u.port || 443);
  if (!password || !server || !Number.isFinite(port)) return null;

  const params = u.searchParams;
  const proxy: ClashProxy = {
    name: decodeFragmentName(u.hash.slice(1)),
    type: 'trojan',
    server,
    port,
    password,
    udp: true,
  };

  const sni = params.get('sni') ?? params.get('peer');
  if (sni) proxy.sni = sni;

  const network = params.get('type');
  if (network) setTransport(proxy, network, params);
  applyTls(proxy, params, server);

  return proxy;
}

function parseVmess(uri: string): ClashProxy | null {
  const payload = uri.slice('vmess://'.length).trim();
  const decoded = decodeBase64Loose(payload);
  if (!decoded) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }

  const server = String(data.add ?? data.host ?? '');
  const port = Number(data.port ?? 0);
  const uuid = String(data.id ?? '');
  if (!server || !port || !uuid) return null;

  const proxy: ClashProxy = {
    name: String(data.ps ?? data.remark ?? 'vmess'),
    type: 'vmess',
    server,
    port,
    uuid,
    alterId: Number(data.aid ?? data.alterId ?? 0),
    cipher: String(data.scy ?? data.cipher ?? 'auto'),
    udp: true,
  };

  const tlsFlag = String(data.tls ?? '').toLowerCase();
  if (tlsFlag === 'tls' || tlsFlag === 'true' || tlsFlag === '1') {
    proxy.tls = true;
    const sni = String(data.sni ?? data.host ?? '');
    if (sni) proxy.servername = sni;
  }

  const network = String(data.net ?? data.network ?? 'tcp');
  const params = new URLSearchParams();
  const host = String(data.host ?? '');
  const path = String(data.path ?? '');
  if (host) params.set('host', host);
  if (path) params.set('path', path);
  setTransport(proxy, network, params);

  const fp = data.fp ?? data['client-fingerprint'];
  if (fp) proxy['client-fingerprint'] = String(fp);

  return proxy;
}

function parseSs(uri: string): ClashProxy | null {
  const u = parseUrlLike(uri);
  if (!u || u.protocol !== 'ss:') return null;

  let method: string;
  let password: string;
  let server: string;
  let port: number;

  if (u.username && u.password) {
    method = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
    server = u.hostname;
    port = Number(u.port);
  } else {
    const hostPart = u.host;
    const at = hostPart.lastIndexOf('@');
    if (at < 0) return null;
    const userinfo = decodeBase64Loose(hostPart.slice(0, at));
    if (!userinfo) return null;
    const colon = userinfo.indexOf(':');
    if (colon < 0) return null;
    method = userinfo.slice(0, colon);
    password = userinfo.slice(colon + 1);
    const rest = hostPart.slice(at + 1);
    const colonPort = rest.lastIndexOf(':');
    if (colonPort < 0) return null;
    server = rest.slice(0, colonPort);
    port = Number(rest.slice(colonPort + 1));
  }

  if (!method || !password || !server || !Number.isFinite(port)) return null;

  const proxy: ClashProxy = {
    name: decodeFragmentName(u.hash.slice(1)),
    type: 'ss',
    server,
    port,
    cipher: method,
    password,
    udp: true,
  };

  const plugin = u.searchParams.get('plugin');
  if (plugin?.startsWith('obfs-local')) {
    proxy.plugin = 'obfs';
    const opts: Record<string, string> = {};
    for (const part of plugin.split(';').slice(1)) {
      const eq = part.indexOf('=');
      if (eq > 0) opts[part.slice(0, eq)] = part.slice(eq + 1);
    }
    if (Object.keys(opts).length > 0) proxy['plugin-opts'] = opts;
  }

  return proxy;
}

function parseHysteria2(uri: string): ClashProxy | null {
  const u = parseUrlLike(uri);
  if (!u || (u.protocol !== 'hysteria2:' && u.protocol !== 'hy2:')) return null;
  const password = decodeURIComponent(u.username);
  const server = u.hostname;
  const port = Number(u.port || 443);
  if (!password || !server || !Number.isFinite(port)) return null;

  const params = u.searchParams;
  const proxy: ClashProxy = {
    name: decodeFragmentName(u.hash.slice(1)),
    type: 'hysteria2',
    server,
    port,
    password,
    udp: true,
  };

  const sni = params.get('sni') ?? params.get('peer');
  if (sni) proxy.sni = sni;
  const obfs = params.get('obfs');
  const obfsPassword = params.get('obfs-password');
  if (obfs) {
    proxy.obfs = obfs;
    if (obfsPassword) proxy['obfs-password'] = obfsPassword;
  }
  const insecure = params.get('insecure');
  if (insecure === '1' || insecure === 'true') proxy['skip-cert-verify'] = true;

  return proxy;
}

export function shareLinkToClashProxy(link: string): ClashProxy | null {
  const trimmed = link.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('vless://')) return parseVless(trimmed);
  if (lower.startsWith('vmess://')) return parseVmess(trimmed);
  if (lower.startsWith('trojan://')) return parseTrojan(trimmed);
  if (lower.startsWith('ss://')) return parseSs(trimmed);
  if (lower.startsWith('hysteria2://') || lower.startsWith('hy2://')) return parseHysteria2(trimmed);
  return null;
}

function uniqueProxyName(base: string, used: Set<string>) {
  let name = base.trim() || 'node';
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (used.has(`${name}_${i}`)) i += 1;
  const next = `${name}_${i}`;
  used.add(next);
  return next;
}

export function shareLinksToClashYaml(links: string[]): string {
  const proxies: ClashProxy[] = [];
  const usedNames = new Set<string>();

  for (const link of links) {
    const proxy = shareLinkToClashProxy(link);
    if (!proxy) continue;
    const baseName = String(proxy.name ?? 'node');
    proxy.name = uniqueProxyName(baseName, usedNames);
    proxies.push(proxy);
  }

  if (proxies.length === 0) return '';

  // proxy-providers (http) 仅需 proxies 段，规则/策略组由主配置维护
  return yaml.dump({ proxies }, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}
