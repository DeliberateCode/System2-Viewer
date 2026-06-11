/**
 * regression test: ID collision via randomUUID().
 *
 * Generates 100 IDs in a tight synchronous loop using the same
 * pattern as verification-engine.ts and asserts zero collisions.
 *
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

describe('regression: ID collision', () => {
  it('generates 100 unique IDs with zero collisions using randomUUID()', () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(randomUUID());
    }
    expect(new Set(ids).size).toBe(100);
  });

  it('generates 100 unique verification history IDs with the vh- prefix pattern', () => {
    const claimId = 'testClaim';
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(`vh-${claimId}-${randomUUID()}`);
    }
    expect(new Set(ids).size).toBe(100);
  });

  it('generates 100 unique successor IDs with the -v- pattern', () => {
    const claimId = 'testClaim';
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(`${claimId}-v-${randomUUID()}`);
    }
    expect(new Set(ids).size).toBe(100);
  });

  it('generates 100 unique verify evidence IDs', () => {
    const claimId = 'testClaim';
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(`verify-${claimId}-source_span-${randomUUID()}`);
    }
    expect(new Set(ids).size).toBe(100);
  });

  it('generates 1000 unique IDs under heavier load', () => {
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) {
      ids.push(randomUUID());
    }
    expect(new Set(ids).size).toBe(1000);
  });
});
