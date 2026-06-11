/**
 * Output formatting.
 */

export enum OutputFormat {
  Text = 'text',
  Json = 'json',
  Table = 'table',
}

export function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case OutputFormat.Json:
      return JSON.stringify(data, null, 2);
    case OutputFormat.Table:
      return formatTable(data);
    case OutputFormat.Text:
    default:
      return formatText(data);
  }
}

function formatText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return '';
  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n');
  }
  return String(data);
}

function formatTable(data: unknown): string {
  if (!Array.isArray(data)) {
    return formatText(data);
  }
  if (data.length === 0) return '(empty)';

  const headers = Object.keys(data[0] as Record<string, unknown>);
  const rows = data.map(row =>
    headers.map(h => String((row as Record<string, unknown>)[h] ?? '')),
  );

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length)),
  );

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const separator = widths.map(w => '-'.repeat(w)).join('-+-');
  const bodyLines = rows.map(row =>
    row.map((cell, i) => cell.padEnd(widths[i])).join(' | '),
  );

  return [headerLine, separator, ...bodyLines].join('\n');
}
