/**
 * Tests for polyglot workspace detection and root marker recognition.
 *
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectRootMarker } from '../classify.js';
import { discoverWorkspace } from '../workspace.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ws-detect-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Root marker detection
// ---------------------------------------------------------------------------
describe('detectRootMarker', () => {
  it('detects Cargo.toml as a root marker', () => {
    const markers = detectRootMarker(['Cargo.toml', 'src']);
    expect(markers).toContainEqual({ marker: 'Cargo.toml', kind: 'config' });
  });

  it('detects go.mod as a root marker', () => {
    const markers = detectRootMarker(['go.mod', 'main.go']);
    expect(markers).toContainEqual({ marker: 'go.mod', kind: 'config' });
  });

  it('detects pyproject.toml as a root marker', () => {
    const markers = detectRootMarker(['pyproject.toml', 'src']);
    expect(markers).toContainEqual({ marker: 'pyproject.toml', kind: 'config' });
  });

  it('detects setup.py as a root marker', () => {
    const markers = detectRootMarker(['setup.py', 'src']);
    expect(markers).toContainEqual({ marker: 'setup.py', kind: 'config' });
  });

  it('still detects package.json as a root marker', () => {
    const markers = detectRootMarker(['package.json']);
    expect(markers).toContainEqual({ marker: 'package.json', kind: 'package' });
  });

  it('detects multiple markers in the same directory', () => {
    const markers = detectRootMarker([
      'package.json',
      'Cargo.toml',
      'pyproject.toml',
      '.git',
    ]);
    expect(markers.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Cargo workspace detection
// ---------------------------------------------------------------------------
describe('looksLikeWorkspace - Cargo', () => {
  it('detects Cargo.toml with [workspace] section', () => {
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crate-a", "crate-b"]\n',
    );
    // Create sub-crate directories so it is a real workspace
    for (const name of ['crate-a', 'crate-b']) {
      const d = join(tempDir, name);
      mkdirSync(d);
      writeFileSync(join(d, 'Cargo.toml'), `[package]\nname = "${name}"\n`);
    }
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.mode).toBe('auto');
    // Should find sub-repositories
    expect(result.repositories.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT trigger workspace for Cargo.toml without [workspace]', () => {
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      '[package]\nname = "single-crate"\n',
    );
    const result = discoverWorkspace(tempDir, 'auto');
    // Should fall back to single-repo
    expect(result.repositories).toEqual([
      { root: tempDir, name: expect.any(String) },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Go workspace detection
// ---------------------------------------------------------------------------
describe('looksLikeWorkspace - Go', () => {
  it('detects go.work file as workspace indicator', () => {
    writeFileSync(
      join(tempDir, 'go.work'),
      'go 1.21\n\nuse (\n\t./mod-a\n\t./mod-b\n)\n',
    );
    for (const name of ['mod-a', 'mod-b']) {
      const d = join(tempDir, name);
      mkdirSync(d);
      writeFileSync(join(d, 'go.mod'), `module example.com/${name}\n`);
    }
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.mode).toBe('auto');
    expect(result.repositories.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT trigger workspace for go.mod alone', () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module example.com/single\n');
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories).toEqual([
      { root: tempDir, name: expect.any(String) },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Python workspace detection
// ---------------------------------------------------------------------------
describe('looksLikeWorkspace - Python', () => {
  it('detects pyproject.toml with [tool.hatch.envs]', () => {
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      '[project]\nname = "mono"\n\n[tool.hatch.envs]\ndefault = {}\n',
    );
    for (const name of ['pkg-a', 'pkg-b']) {
      const d = join(tempDir, name);
      mkdirSync(d);
      writeFileSync(join(d, 'pyproject.toml'), `[project]\nname = "${name}"\n`);
    }
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.mode).toBe('auto');
    expect(result.repositories.length).toBeGreaterThanOrEqual(2);
  });

  it('detects pyproject.toml with [tool.poetry.packages]', () => {
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      '[tool.poetry]\nname = "mono"\n\n[tool.poetry.packages]\ninclude = "src"\n',
    );
    for (const name of ['lib-a', 'lib-b']) {
      const d = join(tempDir, name);
      mkdirSync(d);
      writeFileSync(join(d, 'pyproject.toml'), `[project]\nname = "${name}"\n`);
    }
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBeGreaterThanOrEqual(2);
  });

  it('detects pyproject.toml with [tool.setuptools.packages.find]', () => {
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      '[project]\nname = "mono"\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n',
    );
    for (const name of ['sub-a', 'sub-b']) {
      const d = join(tempDir, name);
      mkdirSync(d);
      writeFileSync(join(d, 'setup.py'), 'from setuptools import setup\nsetup()\n');
    }
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT trigger workspace for plain pyproject.toml', () => {
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      '[project]\nname = "single-pkg"\n',
    );
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories).toEqual([
      { root: tempDir, name: expect.any(String) },
    ]);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe('looksLikeWorkspace - malformed files', () => {
  it('does NOT trigger workspace for malformed Cargo.toml (binary garbage)', () => {
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x7f, 0x01, 0x02]),
    );
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('does NOT trigger workspace for empty Cargo.toml', () => {
    writeFileSync(join(tempDir, 'Cargo.toml'), '');
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('does NOT trigger workspace for Cargo.toml with only comments', () => {
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      '# This is a comment\n# [workspace] mentioned in a comment\n',
    );
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('does NOT trigger workspace for malformed pyproject.toml', () => {
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      'this is not valid toml at all {{{{ [[[ garbage',
    );
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });
});

// ---------------------------------------------------------------------------
// Existing npm workspace detection still works
// ---------------------------------------------------------------------------
describe('looksLikeWorkspace - npm (regression)', () => {
  it('still detects npm workspaces field', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    );
    for (const name of ['pkg-a', 'pkg-b']) {
      const d = join(tempDir, name);
      mkdirSync(d);
      writeFileSync(
        join(d, 'package.json'),
        JSON.stringify({ name }),
      );
    }
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.mode).toBe('auto');
    expect(result.repositories.length).toBeGreaterThanOrEqual(2);
  });

  it('still detects multiple package.json in subdirs', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'root' }),
    );
    for (const name of ['app-a', 'app-b']) {
      const d = join(tempDir, name);
      mkdirSync(d);
      writeFileSync(join(d, 'package.json'), JSON.stringify({ name }));
    }
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBeGreaterThanOrEqual(2);
  });
});
