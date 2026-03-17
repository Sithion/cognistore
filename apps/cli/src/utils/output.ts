export type OutputFormat = 'json' | 'table' | 'plain';

export function formatOutput(data: unknown, format: OutputFormat = 'plain'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'table':
      return formatTable(data);
    case 'plain':
    default:
      return formatPlain(data);
  }
}

function formatTable(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return 'No results.';
    const keys = Object.keys(data[0] ?? {});
    if (keys.length === 0) return 'No results.';
    const widths = keys.map(k =>
      Math.max(k.length, ...data.map(row => String((row as Record<string, unknown>)[k] ?? '').length))
    );
    const header = keys.map((k, i) => k.padEnd(widths[i])).join(' | ');
    const sep = widths.map(w => '-'.repeat(w)).join('-+-');
    const rows = data.map(row =>
      keys.map((k, i) => String((row as Record<string, unknown>)[k] ?? '').padEnd(widths[i])).join(' | ')
    );
    return [header, sep, ...rows].join('\n');
  }
  return JSON.stringify(data, null, 2);
}

function formatPlain(data: unknown): string {
  if (Array.isArray(data)) {
    return data
      .map((item, _i) => {
        if (typeof item === 'object' && item !== null) {
          const entry = (item as Record<string, unknown>).entry ?? item;
          const similarity = (item as Record<string, unknown>).similarity;
          const entryObj = entry as Record<string, unknown>;
          const lines = [
            similarity !== undefined
              ? `[${((similarity as number) * 100).toFixed(1)}%] ${String(entryObj.content ?? '').substring(0, 100)}...`
              : String(entryObj.content ?? '').substring(0, 100),
            `  Type: ${entryObj.type} | Scope: ${entryObj.scope} | Tags: ${((entryObj.tags as unknown[]) ?? []).join(', ')}`,
            `  ID: ${entryObj.id} | v${entryObj.version} | ${entryObj.createdAt}`,
          ];
          return lines.join('\n');
        }
        return String(item);
      })
      .join('\n\n');
  }
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join('\n');
  }
  return String(data);
}

export function printSuccess(message: string): void {
  console.log(`✓ ${message}`);
}

export function printError(message: string): void {
  console.error(`✗ ${message}`);
}

export function printInfo(message: string): void {
  console.log(`ℹ ${message}`);
}
