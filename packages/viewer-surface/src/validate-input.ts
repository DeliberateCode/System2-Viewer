/**
 * Structural guard for untrusted MCP tool input.
 *
 * Rejects:
 *   - Function values (anywhere in the tree)
 *   - Prototype-pollution keys: __proto__, constructor, prototype
 *
 * Recursive deep check on every key/value pair.
 */

const POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validates that untrusted input contains no functions or
 * prototype-pollution keys. Throws on first violation.
 *
 * @param value  The untrusted value (typically parsed JSON args from MCP)
 * @param path   Internal breadcrumb for error messages
 */
export function validateUntrustedInput(
  value: unknown,
  path = '$',
): void {
  if (typeof value === 'function') {
    throw new TypeError(
      `Untrusted input contains a function at ${path}`,
    );
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateUntrustedInput(value[i], `${path}[${i}]`);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (POISON_KEYS.has(key)) {
      throw new TypeError(
        `Untrusted input contains prohibited key "${key}" at ${path}.${key}`,
      );
    }
    validateUntrustedInput(obj[key], `${path}.${key}`);
  }
}
