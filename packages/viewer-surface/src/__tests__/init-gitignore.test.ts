/**
 * Tests viewer init appends viewer.config.json to .gitignore.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit } from '../init.js';

describe('runInit .gitignore handling', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'viewer-init-gi-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates .gitignore with viewer.config.json when .gitignore does not exist', () => {
    runInit(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toBe('viewer.config.json\n');
  });

  it('appends viewer.config.json to existing .gitignore', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\n', 'utf-8');
    runInit(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toBe('node_modules\nviewer.config.json\n');
  });

  it('does not duplicate entry when .gitignore already contains viewer.config.json', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\nviewer.config.json\n', 'utf-8');
    runInit(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toBe('node_modules\nviewer.config.json\n');
  });

  it('does not duplicate entry when viewer.config.json appears among other entries', () => {
    writeFileSync(join(tmp, '.gitignore'), 'dist\nviewer.config.json\ncoverage\n', 'utf-8');
    runInit(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toBe('dist\nviewer.config.json\ncoverage\n');
  });

  it('skips .gitignore when noGitignore is true', () => {
    runInit(tmp, { noGitignore: true });
    expect(existsSync(join(tmp, '.gitignore'))).toBe(false);
  });

  it('skips .gitignore modification when noGitignore is true and .gitignore exists', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\n', 'utf-8');
    runInit(tmp, { noGitignore: true });
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toBe('node_modules\n');
  });

  it('handles .gitignore with --force and still updates .gitignore', () => {
    // Pre-create config so --force overwrites it
    writeFileSync(join(tmp, 'viewer.config.json'), '{}', 'utf-8');
    runInit(tmp, { force: true });
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toBe('viewer.config.json\n');
  });

  it('appends with newline separator when .gitignore does not end with newline', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules', 'utf-8');
    runInit(tmp);
    const gi = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toBe('node_modules\nviewer.config.json\n');
  });

  it('returns gitignorePath in result when .gitignore is created', () => {
    const result = runInit(tmp);
    expect(result.gitignorePath).toBe(join(tmp, '.gitignore'));
  });

  it('returns gitignorePath in result when .gitignore is updated', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\n', 'utf-8');
    const result = runInit(tmp);
    expect(result.gitignorePath).toBe(join(tmp, '.gitignore'));
  });

  it('returns undefined gitignorePath when noGitignore is true', () => {
    const result = runInit(tmp, { noGitignore: true });
    expect(result.gitignorePath).toBeUndefined();
  });

  it('returns undefined gitignorePath when entry already existed', () => {
    writeFileSync(join(tmp, '.gitignore'), 'viewer.config.json\n', 'utf-8');
    const result = runInit(tmp);
    expect(result.gitignorePath).toBeUndefined();
  });

  it('includes $schema field in generated config', () => {
    runInit(tmp);
    const content = JSON.parse(readFileSync(join(tmp, 'viewer.config.json'), 'utf-8'));
    expect(content.$schema).toBe(
      './node_modules/@system2-viewer/viewer-config/src/config-schema.json',
    );
  });
});
