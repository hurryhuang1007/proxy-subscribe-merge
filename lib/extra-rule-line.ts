export type ExtraRuleParts = {
  type: string;
  matcher: string;
  policy: string;
  extra?: string;
};

export const CLASH_RULE_TYPES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'SRC-IP-CIDR',
  'DST-PORT',
  'SRC-PORT',
  'PROCESS-NAME',
  'RULE-SET',
  'MATCH',
] as const;

export function parseExtraRuleLine(line: string): ExtraRuleParts | null {
  const trimmed = line.trim();
  if (!trimmed.includes(',')) {
    return null;
  }
  const parts = trimmed.split(',').map((p) => p.trim());
  const type = parts[0] ?? '';
  if (!type) {
    return null;
  }
  if (type.toUpperCase() === 'MATCH') {
    return { type, matcher: '', policy: parts[1] ?? '' };
  }
  if (parts.length < 3) {
    return null;
  }
  if (parts.length === 3) {
    return { type, matcher: parts[1] ?? '', policy: parts[2] ?? '' };
  }
  return {
    type,
    matcher: parts[1] ?? '',
    policy: parts[2] ?? '',
    extra: parts.slice(3).join(','),
  };
}

export function buildExtraRuleLine(parts: ExtraRuleParts): string {
  const type = parts.type.trim();
  const policy = parts.policy.trim();
  if (!type || !policy) {
    return '';
  }
  if (type.toUpperCase() === 'MATCH') {
    return `MATCH,${policy}`;
  }
  const matcher = parts.matcher.trim();
  if (!matcher) {
    return '';
  }
  const base = `${type},${matcher},${policy}`;
  const extra = parts.extra?.trim();
  return extra ? `${base},${extra}` : base;
}
