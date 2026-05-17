import type { SubscriptionPoolEntry } from '@/lib/config';

const PROBE_URL = 'http://www.gstatic.com/generate_204';

function probeOptsForProvider(providerName: string) {
  return {
    url: PROBE_URL,
    interval: 300,
    use: [providerName],
  };
}

function appendSupplierModeGroups(
  groups: Record<string, unknown>[],
  modePickerNames: string[],
  sourceName: string,
  probe: Record<string, unknown>,
) {
  const delay = `${sourceName} 延迟最低`;
  const fallback = `${sourceName} 故障切换`;
  const manual = `${sourceName} 手动切换`;

  modePickerNames.push(delay, fallback, manual);
  groups.push({
    name: delay,
    type: 'url-test',
    tolerance: 100,
    ...probe,
  });
  groups.push({
    name: fallback,
    type: 'fallback',
    ...probe,
  });
  groups.push({
    name: manual,
    type: 'select',
    ...probe,
  });
}

export function buildSupplierProxyGroups(
  sources: string[],
  pool: Map<string, SubscriptionPoolEntry>,
) {
  const groups: Record<string, unknown>[] = [];
  const modePickerNames: string[] = [];

  for (const sourceName of sources) {
    const entry = pool.get(sourceName);
    if (!entry || entry.disabled) continue;

    appendSupplierModeGroups(groups, modePickerNames, sourceName, probeOptsForProvider(sourceName));
  }

  return { modePickerNames, groups };
}

export function legacySupplierGroupNames(sources: string[]) {
  const names = new Set<string>();
  for (const sourceName of sources) {
    names.add(`📦 ${sourceName}`);
    names.add(`${sourceName} 延迟最低`);
    names.add(`${sourceName} 故障切换`);
    names.add(`${sourceName} 手动切换`);
  }
  return names;
}
