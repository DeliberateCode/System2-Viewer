import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from '../store.js';
import type { FileHashRow } from '../types.js';

describe('file_hashes table', () => {
  let dataDir: string;
  let store: ModelStore;

  function openStore(): ModelStore {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-store-file-hashes-'));
    store = ModelStore.open(dataDir);
    return store;
  }

  afterEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should round-trip upsert and read a file hash', () => {
    openStore();
    const now = new Date().toISOString();
    const row: FileHashRow = {
      path: 'src/index.ts',
      repositoryId: 'repo1',
      hash: 'abc123',
      revision: 'rev1',
      updatedAt: now,
      mtimeMs: 1700000000000,
      size: 512,
    };

    const txn = store.beginSnapshot('rev1');
    txn.upsertFileHash(row);
    txn.commit();

    const rh = store.read();
    try {
      const result = rh.getFileHash('src/index.ts', 'repo1');
      expect(result).toEqual(row);
    } finally {
      rh.close();
    }
  });

  it('should return null stat fields when not provided', () => {
    openStore();
    const now = new Date().toISOString();

    const txn = store.beginSnapshot('rev1');
    txn.upsertFileHash({
      path: 'src/legacy.ts',
      repositoryId: 'repo1',
      hash: 'abc123',
      revision: 'rev1',
      updatedAt: now,
    });
    txn.commit();

    const rh = store.read();
    try {
      const result = rh.getFileHash('src/legacy.ts', 'repo1');
      expect(result).not.toBeNull();
      expect(result!.mtimeMs).toBeNull();
      expect(result!.size).toBeNull();
    } finally {
      rh.close();
    }
  });

  it('should return null for a missing file hash', () => {
    openStore();

    const rh = store.read();
    try {
      const result = rh.getFileHash('nonexistent.ts', 'repo1');
      expect(result).toBeNull();
    } finally {
      rh.close();
    }
  });

  it('should overwrite on upsert with same primary key', () => {
    openStore();
    const now = new Date().toISOString();

    const txn1 = store.beginSnapshot('rev1');
    txn1.upsertFileHash({
      path: 'src/lib.ts',
      repositoryId: 'repo1',
      hash: 'hash-v1',
      revision: 'rev1',
      updatedAt: now,
    });
    txn1.commit();

    const later = new Date().toISOString();
    const txn2 = store.beginSnapshot('rev2');
    txn2.upsertFileHash({
      path: 'src/lib.ts',
      repositoryId: 'repo1',
      hash: 'hash-v2',
      revision: 'rev2',
      updatedAt: later,
    });
    txn2.commit();

    const rh = store.read();
    try {
      const result = rh.getFileHash('src/lib.ts', 'repo1');
      expect(result).not.toBeNull();
      expect(result!.hash).toBe('hash-v2');
      expect(result!.revision).toBe('rev2');
    } finally {
      rh.close();
    }
  });

  it('should scope file hashes by repository_id', () => {
    openStore();
    const now = new Date().toISOString();

    const txn = store.beginSnapshot('rev1');
    txn.upsertFileHash({
      path: 'src/shared.ts',
      repositoryId: 'repoA',
      hash: 'hashA',
      revision: 'rev1',
      updatedAt: now,
    });
    txn.upsertFileHash({
      path: 'src/shared.ts',
      repositoryId: 'repoB',
      hash: 'hashB',
      revision: 'rev1',
      updatedAt: now,
    });
    txn.commit();

    const rh = store.read();
    try {
      const resultA = rh.getFileHash('src/shared.ts', 'repoA');
      const resultB = rh.getFileHash('src/shared.ts', 'repoB');
      expect(resultA!.hash).toBe('hashA');
      expect(resultB!.hash).toBe('hashB');
    } finally {
      rh.close();
    }
  });
});
