/** 将额外规则插入模板 rules 最前面，作为最高优先级 */
export function mergeClashRules(templateRules: unknown, extraRules: string[]): string[] {
  const base = Array.isArray(templateRules) ? templateRules.map((r) => String(r).trim()).filter(Boolean) : [];
  const extra = extraRules.map((r) => r.trim()).filter(Boolean);
  if (extra.length === 0) {
    return base;
  }
  return [...extra, ...base];
}
