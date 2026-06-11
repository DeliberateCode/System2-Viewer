/**
 * Integration tests for polyglot workspace discovery.
 *
 *
 * Test classification: missing coverage
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectRootMarker } from '../classify.js';
import { discoverWorkspace } from '../workspace.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'polyglot-ws-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: create a subdirectory with a root marker file
// ---------------------------------------------------------------------------
function makeSubRepo(
  parent: string,
  name: string,
  markerFile: string,
  markerContent: string,
): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, markerFile), markerContent);
  return dir;
}

// ---------------------------------------------------------------------------
// 1. Mixed Cargo + npm workspace
// ---------------------------------------------------------------------------
describe('Mixed Cargo + npm workspace', () => {
  it('detects both Cargo workspace and npm workspace markers', () => {
    // Root has both a Cargo.toml with [workspace] and a package.json with workspaces
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["crate-a", "crate-b"]\n',
    );
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'polyglot-root', workspaces: ['packages/*'] }),
    );

    // Cargo sub-crates
    makeSubRepo(tempDir, 'crate-a', 'Cargo.toml', '[package]\nname = "crate-a"\n');
    makeSubRepo(tempDir, 'crate-b', 'Cargo.toml', '[package]\nname = "crate-b"\n');

    // npm sub-packages
    makeSubRepo(
      tempDir,
      'packages/pkg-a',
      'package.json',
      JSON.stringify({ name: 'pkg-a' }),
    );
    makeSubRepo(
      tempDir,
      'packages/pkg-b',
      'package.json',
      JSON.stringify({ name: 'pkg-b' }),
    );

    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.mode).toBe('auto');
    // Should discover both Cargo crates and npm packages as sub-repos
    expect(result.repositories.length).toBeGreaterThanOrEqual(4);

    const names = result.repositories.map((r) => r.name);
    expect(names).toContain('crate-a');
    expect(names).toContain('crate-b');
    expect(names).toContain('pkg-a');
    expect(names).toContain('pkg-b');
  });
});

// ---------------------------------------------------------------------------
// 2. Go + Python workspace
// ---------------------------------------------------------------------------
describe('Go + Python workspace', () => {
  it('detects both go.work and pyproject.toml workspace markers', () => {
    // Root: go.work makes it a workspace
    writeFileSync(
      join(tempDir, 'go.work'),
      'go 1.21\n\nuse (\n\t./svc-a\n\t./svc-b\n)\n',
    );

    // Go modules
    makeSubRepo(tempDir, 'svc-a', 'go.mod', 'module example.com/svc-a\n');
    makeSubRepo(tempDir, 'svc-b', 'go.mod', 'module example.com/svc-b\n');

    // Python packages (subdirectories with pyproject.toml as root markers)
    makeSubRepo(
      tempDir,
      'py-lib-a',
      'pyproject.toml',
      '[project]\nname = "py-lib-a"\n',
    );
    makeSubRepo(
      tempDir,
      'py-lib-b',
      'pyproject.toml',
      '[project]\nname = "py-lib-b"\n',
    );

    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.mode).toBe('auto');
    // go.work triggers workspace; findRepos finds all subdirs with root markers
    expect(result.repositories.length).toBeGreaterThanOrEqual(4);

    const names = result.repositories.map((r) => r.name);
    expect(names).toContain('svc-a');
    expect(names).toContain('svc-b');
    expect(names).toContain('py-lib-a');
    expect(names).toContain('py-lib-b');
  });
});

// ---------------------------------------------------------------------------
// 3. Polyglot repo with all root markers
// ---------------------------------------------------------------------------
describe('Polyglot repo with all root markers', () => {
  it('detects all four root marker types in one directory', () => {
    const entries = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];
    const markers = detectRootMarker(entries);

    // Each file should be detected as a root marker
    expect(markers).toContainEqual({ marker: 'package.json', kind: 'package' });
    expect(markers).toContainEqual({ marker: 'Cargo.toml', kind: 'config' });
    expect(markers).toContainEqual({ marker: 'go.mod', kind: 'config' });
    expect(markers).toContainEqual({ marker: 'pyproject.toml', kind: 'config' });
    expect(markers.length).toBe(4);
  });

  it('detects all markers including setup.py', () => {
    const entries = [
      'package.json',
      'Cargo.toml',
      'go.mod',
      'pyproject.toml',
      'setup.py',
    ];
    const markers = detectRootMarker(entries);
    expect(markers.length).toBe(5);
    expect(markers).toContainEqual({ marker: 'setup.py', kind: 'config' });
  });
});

// ---------------------------------------------------------------------------
// 4. Workspace with nested repos -- depth bounds apply
// ---------------------------------------------------------------------------
describe('Workspace with nested repos (depth bounds)', () => {
  it('discovers npm workspace at root and Cargo workspace in a subdir', () => {
    // Root is an npm workspace
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
    );

    // npm sub-package
    makeSubRepo(
      tempDir,
      'packages/web-app',
      'package.json',
      JSON.stringify({ name: 'web-app' }),
    );

    // Cargo workspace in a subdir (with its own crates deeper)
    const cargoWs = join(tempDir, 'rust-services');
    mkdirSync(cargoWs, { recursive: true });
    writeFileSync(
      join(cargoWs, 'Cargo.toml'),
      '[workspace]\nmembers = ["api", "core"]\n',
    );

    // The Cargo workspace dir itself has a root marker (Cargo.toml is kind: config),
    // so findRepos treats it as a sub-repo and does NOT recurse into it.
    // The nested crates inside should not be discovered separately.
    makeSubRepo(cargoWs, 'api', 'Cargo.toml', '[package]\nname = "api"\n');
    makeSubRepo(cargoWs, 'core', 'Cargo.toml', '[package]\nname = "core"\n');

    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.mode).toBe('auto');

    // Should find: web-app (npm package) + rust-services (Cargo workspace root)
    // The nested api/core should NOT be discovered because findRepos stops recursion
    // at rust-services since it has a root marker (Cargo.toml -> kind: config).
    const names = result.repositories.map((r) => r.name);
    expect(names).toContain('web-app');
    expect(names).toContain('rust-services');
    expect(result.repositories.length).toBe(2);
  });

  it('respects maxDepth bounds on deeply nested structures', () => {
    // Root is a workspace
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'deep-mono', workspaces: ['a/*'] }),
    );

    // Create a deeply nested chain: a/b/c/d/e/f with a Cargo.toml at depth 6
    let currentDir = tempDir;
    const dirs = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const d of dirs) {
      currentDir = join(currentDir, d);
      mkdirSync(currentDir, { recursive: true });
    }
    writeFileSync(join(currentDir, 'Cargo.toml'), '[package]\nname = "deep"\n');

    // With maxDepth=3, we should NOT find the deeply nested crate
    const shallow = discoverWorkspace(tempDir, 'force', { maxDepth: 3 });
    const shallowNames = shallow.repositories.map((r) => r.name);
    expect(shallowNames).not.toContain('f');

    // With maxDepth=8 (default), the deeply nested crate should be found
    const deep = discoverWorkspace(tempDir, 'force', { maxDepth: 8 });
    const deepNames = deep.repositories.map((r) => r.name);
    expect(deepNames).toContain('f');
  });

  it('respects maxRepos bounds and sets bounded flag', () => {
    // Root is a workspace
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'big-mono', workspaces: ['pkgs/*'] }),
    );

    // Create 5 sub-repos
    for (let i = 0; i < 5; i++) {
      makeSubRepo(
        tempDir,
        `sub-${i}`,
        'package.json',
        JSON.stringify({ name: `sub-${i}` }),
      );
    }

    // With maxRepos=3, should truncate and mark bounded
    const result = discoverWorkspace(tempDir, 'force', { maxRepos: 3 });
    expect(result.bounded).toBe(true);
    expect(result.boundReason).toBeDefined();
    expect(result.repositories.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Workspace mode 'off' ignores non-npm markers
// ---------------------------------------------------------------------------
describe("Workspace mode 'off' ignores all markers", () => {
  it('returns single root even when Cargo workspace markers exist', () => {
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      '[workspace]\nmembers = ["a", "b"]\n',
    );
    makeSubRepo(tempDir, 'a', 'Cargo.toml', '[package]\nname = "a"\n');
    makeSubRepo(tempDir, 'b', 'Cargo.toml', '[package]\nname = "b"\n');

    const result = discoverWorkspace(tempDir, 'off');
    expect(result.mode).toBe('off');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
    expect(result.bounded).toBe(false);
  });

  it('returns single root even when go.work exists', () => {
    writeFileSync(join(tempDir, 'go.work'), 'go 1.21\n\nuse (\n\t./m\n)\n');
    makeSubRepo(tempDir, 'm', 'go.mod', 'module example.com/m\n');

    const result = discoverWorkspace(tempDir, 'off');
    expect(result.mode).toBe('off');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('returns single root even when Python workspace markers exist', () => {
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      '[project]\nname = "mono"\n\n[tool.hatch.envs]\ndefault = {}\n',
    );
    makeSubRepo(tempDir, 'lib', 'pyproject.toml', '[project]\nname = "lib"\n');

    const result = discoverWorkspace(tempDir, 'off');
    expect(result.mode).toBe('off');
    expect(result.repositories.length).toBe(1);
  });

  it('returns single root even when npm workspace markers exist', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    );
    makeSubRepo(
      tempDir,
      'packages/a',
      'package.json',
      JSON.stringify({ name: 'a' }),
    );

    const result = discoverWorkspace(tempDir, 'off');
    expect(result.mode).toBe('off');
    expect(result.repositories.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. False positive prevention
// ---------------------------------------------------------------------------
describe('False positive prevention', () => {
  it('bare Cargo.toml without [workspace] does NOT trigger workspace detection', () => {
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      '[package]\nname = "single"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n',
    );
    // Add a subdirectory with its own Cargo.toml to confirm they are NOT discovered
    makeSubRepo(tempDir, 'examples', 'Cargo.toml', '[package]\nname = "ex"\n');

    const result = discoverWorkspace(tempDir, 'auto');
    // No workspace detected; single root returned
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('go.mod without go.work does NOT trigger workspace detection', () => {
    writeFileSync(
      join(tempDir, 'go.mod'),
      'module example.com/mymod\n\ngo 1.21\n',
    );
    makeSubRepo(tempDir, 'internal', 'go.mod', 'module example.com/mymod/internal\n');

    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('plain pyproject.toml without workspace markers does NOT trigger workspace detection', () => {
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      '[project]\nname = "simple"\nversion = "0.1.0"\n\n[build-system]\nrequires = ["setuptools"]\n',
    );
    makeSubRepo(tempDir, 'subpkg', 'pyproject.toml', '[project]\nname = "sub"\n');

    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('Cargo.toml with [workspace] text inside a comment or string does NOT trigger false positive', () => {
    // The regex /^\[workspace\]/m requires [workspace] at the start of a line.
    // A comment line should NOT match.
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      '[package]\nname = "single"\n# Note: does not use [workspace] feature\nversion = "0.1.0"\n',
    );

    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });

  it('empty directory does NOT trigger workspace detection', () => {
    // tempDir is empty -- no markers at all
    const result = discoverWorkspace(tempDir, 'auto');
    expect(result.repositories.length).toBe(1);
    expect(result.repositories[0]!.root).toBe(tempDir);
  });
});
