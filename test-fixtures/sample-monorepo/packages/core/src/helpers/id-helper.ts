/**
 * ID formatting and parsing utilities.
 */

const ID_SEPARATOR = '_';
const ID_PATTERN = /^[a-z]+_[a-zA-Z0-9]+$/;

export function formatId(prefix: string, value: string | number): string {
  return `${prefix}${ID_SEPARATOR}${value}`;
}

export function parseId(id: string): { prefix: string; value: string } | null {
  const sepIndex = id.indexOf(ID_SEPARATOR);
  if (sepIndex === -1) {
    return null;
  }
  return {
    prefix: id.substring(0, sepIndex),
    value: id.substring(sepIndex + 1),
  };
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function generateSequentialId(prefix: string, sequence: number): string {
  return formatId(prefix, String(sequence).padStart(6, '0'));
}
