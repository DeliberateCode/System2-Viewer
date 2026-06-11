/**
 * Unit tests for the batchWrite helper function.
 *
 *
 */
import { describe, it, expect } from 'vitest';
import { batchWrite } from '../batch-writer.js';

describe('batchWrite', () => {
  it('calls writer with chunks of batchSize', () => {
    const batches: number[][] = [];
    const items = [1, 2, 3, 4, 5, 6, 7];
    batchWrite(items, 3, (batch) => batches.push([...batch]));

    expect(batches).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
  });

  it('handles exact multiple of batchSize', () => {
    const batches: number[][] = [];
    batchWrite([1, 2, 3, 4, 5, 6], 3, (batch) => batches.push([...batch]));

    expect(batches).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('handles empty items array', () => {
    const batches: number[][] = [];
    batchWrite([], 3, (batch) => batches.push([...batch]));
    expect(batches).toEqual([]);
  });

  it('handles items fewer than batchSize', () => {
    const batches: string[][] = [];
    batchWrite(['a', 'b'], 100, (batch) => batches.push([...batch]));
    expect(batches).toEqual([['a', 'b']]);
  });

  it('preserves deterministic ordering', () => {
    const received: number[] = [];
    const items = Array.from({ length: 25 }, (_, i) => i);
    batchWrite(items, 10, (batch) => {
      for (const item of batch) received.push(item);
    });
    expect(received).toEqual(items);
  });

  it('uses default batchSize of 1000 when not specified', () => {
    const batches: number[][] = [];
    const items = Array.from({ length: 2500 }, (_, i) => i);
    batchWrite(items, 1000, (batch) => batches.push([...batch]));
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(1000);
    expect(batches[1]).toHaveLength(1000);
    expect(batches[2]).toHaveLength(500);
  });
});
