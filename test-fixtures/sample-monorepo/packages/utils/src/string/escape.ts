/**
 * HTML escaping utilities.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_UNESCAPE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(HTML_ESCAPE_MAP).map(([k, v]) => [v, k]),
);

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char] ?? char);
}

export function unescapeHtml(str: string): string {
  return str.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, entity => HTML_UNESCAPE_MAP[entity] ?? entity);
}
