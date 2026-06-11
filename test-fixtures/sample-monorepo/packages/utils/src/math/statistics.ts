/**
 * Statistical utility functions.
 */

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export function mean(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot compute mean of empty array');
  }
  return sum(values) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot compute median of empty array');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function range(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.max(...values) - Math.min(...values);
}

export function variance(values: number[]): number {
  const avg = mean(values);
  return mean(values.map(v => (v - avg) ** 2));
}

export function standardDeviation(values: number[]): number {
  return Math.sqrt(variance(values));
}
