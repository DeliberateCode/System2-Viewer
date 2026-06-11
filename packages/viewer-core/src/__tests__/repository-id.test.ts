/**
 * Tests for deriveRepositoryId.
 *
 * Validates that:
 *   - Two repos with the same basename but different absolute paths get distinct IDs
 *   - A configName overrides the suffix when provided
 *   - The output matches the expected format
 */
import { describe, it, expect } from 'vitest';
import { deriveRepositoryId } from '../repository-id.js';

describe('deriveRepositoryId', () => {
  it('produces different IDs for repos with same basename but different paths', () => {
    const idA = deriveRepositoryId('/tmp/a/service');
    const idB = deriveRepositoryId('/tmp/b/service');

    expect(idA).not.toBe(idB);
    // Both should contain the basename suffix
    expect(idA).toMatch(/^repo::[0-9a-f]{12}::service$/);
    expect(idB).toMatch(/^repo::[0-9a-f]{12}::service$/);
  });

  it('produces the same ID for the same absolute path', () => {
    const id1 = deriveRepositoryId('/home/user/project');
    const id2 = deriveRepositoryId('/home/user/project');

    expect(id1).toBe(id2);
  });

  it('uses configName as suffix when provided', () => {
    const id = deriveRepositoryId('/tmp/repos/my-service', 'custom-name');

    expect(id).toMatch(/^repo::[0-9a-f]{12}::custom-name$/);
    expect(id).not.toContain('my-service');
  });

  it('falls back to basename when configName is undefined', () => {
    const id = deriveRepositoryId('/home/user/my-project');

    expect(id).toContain('my-project');
  });

  it('uses "unknown" when path has no basename', () => {
    // Extremely edge case: resolve('/') is '/' and '/'.split('/').pop() is ''
    const id = deriveRepositoryId('/');

    expect(id).toMatch(/^repo::[0-9a-f]{12}::unknown$/);
  });

  it('resolves relative paths to absolute before hashing', () => {
    // Two equivalent paths should get the same ID
    const id1 = deriveRepositoryId('/tmp/a/../a/service');
    const id2 = deriveRepositoryId('/tmp/a/service');

    expect(id1).toBe(id2);
  });
});
