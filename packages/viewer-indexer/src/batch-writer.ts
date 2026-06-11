/**
 * Batch write helper for chunked database operations.
 *
 * Processes items in fixed-size chunks to bound peak memory
 * when writing large collections within a single transaction.
 */

/**
 * Writes items in batches of `batchSize`, calling `writer` for each chunk.
 * The final chunk may be smaller than `batchSize`.
 */
export function batchWrite<T>(
  items: T[],
  batchSize: number,
  writer: (batch: T[]) => void,
): void {
  for (let i = 0; i < items.length; i += batchSize) {
    writer(items.slice(i, i + batchSize));
  }
}
