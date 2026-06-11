/**
 * Tests for three bugfixes:
 *   1. MCP same-process indexing leaves target repo rules inactive
 *   2. MCP schema rejects depth: 0
 *   3. Claim prefix resolution can't work through FTS
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TOOL_TABLE } from '../tool-table.js';
import { ReferenceResolver } from '../reference-resolver.js';
import type { ResolverReadHandle } from '../reference-resolver.js';
import { createViewerEngine } from '../engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-3bugs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Finding 2: MCP schema rejects depth: 0
// ---------------------------------------------------------------------------

describe('Finding 2: MCP schema accepts depth: 0', () => {
  it('viewer.index schema accepts depth: 0', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexTool).toBeDefined();

    const schema = indexTool!.inputSchema;
    const result = schema.safeParse({ repoRoot: '/tmp/repo', depth: 0 });
    expect(result.success).toBe(true);
  });

  it('viewer.index schema accepts depth: 1 (positive still works)', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexTool).toBeDefined();

    const schema = indexTool!.inputSchema;
    const result = schema.safeParse({ repoRoot: '/tmp/repo', depth: 1 });
    expect(result.success).toBe(true);
  });

  it('viewer.index schema rejects depth: -1 (negative)', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexTool).toBeDefined();

    const schema = indexTool!.inputSchema;
    const result = schema.safeParse({ repoRoot: '/tmp/repo', depth: -1 });
    expect(result.success).toBe(false);
  });

  it('viewer.index schema accepts omitted depth (optional)', () => {
    const indexTool = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexTool).toBeDefined();

    const schema = indexTool!.inputSchema;
    const result = schema.safeParse({ repoRoot: '/tmp/repo' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 3: Claim prefix resolution via direct query (not FTS)
// ---------------------------------------------------------------------------

describe('Finding 3: Claim prefix resolution works without FTS', () => {
  it('exact claim ID resolves via getClaim', () => {
    const handle: ResolverReadHandle = {
      getNode: () => null,
      getClaim: (id: string) => {
        if (id === 'claim::abc123') {
          return { id: 'claim::abc123', claimType: 'dependency', statement: 'Module X depends on Y' };
        }
        return null;
      },
      ftsSearch: () => [],  // FTS returns nothing for claims
    };

    const resolver = new ReferenceResolver(handle);
    const result = resolver.resolve('claim::abc123', 'claim');

    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.id).toBe('claim::abc123');
      expect(result.kind).toBe('claim');
    }
  });

  it('claim prefix resolves via claimsByPrefix when FTS returns nothing', () => {
    const handle: ResolverReadHandle = {
      getNode: () => null,
      getClaim: (id: string) => {
        // Exact match only for the full ID
        if (id === 'claim::abc123-full-id') {
          return { id: 'claim::abc123-full-id', claimType: 'dependency', statement: 'Module X depends on Y' };
        }
        return null;
      },
      ftsSearch: () => [],  // FTS never returns claim rows
      claimsByPrefix: (prefix: string) => {
        if ('claim::abc123-full-id'.startsWith(prefix)) {
          return [{
            id: 'claim::abc123-full-id',
            claimType: 'dependency',
            statement: 'Module X depends on Y',
            status: 'active',
            confidenceBand: 'high',
            freshnessBand: 'fresh',
            validFromRevision: 'rev1',
            validToRevision: null,
            scopeJson: '{}',
            supportingEvidenceIds: [],
          }];
        }
        return [];
      },
    };

    const resolver = new ReferenceResolver(handle);
    const result = resolver.resolve('claim::abc', 'claim');

    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.id).toBe('claim::abc123-full-id');
      expect(result.kind).toBe('claim');
    }
  });

  it('claim prefix returns ambiguous when multiple claims match', () => {
    const handle: ResolverReadHandle = {
      getNode: () => null,
      getClaim: () => null,
      ftsSearch: () => [],
      claimsByPrefix: (prefix: string) => {
        if (prefix === 'claim::abc') {
          return [
            {
              id: 'claim::abc-one',
              claimType: 'dependency',
              statement: 'First claim',
              status: 'active',
              confidenceBand: 'high',
              freshnessBand: 'fresh',
              validFromRevision: 'rev1',
              validToRevision: null,
              scopeJson: '{}',
              supportingEvidenceIds: [],
            },
            {
              id: 'claim::abc-two',
              claimType: 'dependency',
              statement: 'Second claim',
              status: 'active',
              confidenceBand: 'high',
              freshnessBand: 'fresh',
              validFromRevision: 'rev1',
              validToRevision: null,
              scopeJson: '{}',
              supportingEvidenceIds: [],
            },
          ];
        }
        return [];
      },
    };

    const resolver = new ReferenceResolver(handle);
    const result = resolver.resolve('claim::abc', 'claim');

    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]!.id).toBe('claim::abc-one');
      expect(result.candidates[1]!.id).toBe('claim::abc-two');
    }
  });

  it('claim prefix returns not_found when no claims match', () => {
    const handle: ResolverReadHandle = {
      getNode: () => null,
      getClaim: () => null,
      ftsSearch: () => [],
      claimsByPrefix: () => [],
    };

    const resolver = new ReferenceResolver(handle);
    const result = resolver.resolve('claim::zzz', 'claim');

    // Should fall through to not_found
    expect(result.status).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// Finding 1: MCP same-process indexing leaves target repo rules inactive
// ---------------------------------------------------------------------------

describe('Finding 1: rules reload after indexing different repo', () => {
  it('after indexing repo with rules, checkInvariants uses target repo rules', async () => {
    // Create ENGINE repo (no rules)
    const engineRepoDir = makeTempDir();
    writeFileSync(
      join(engineRepoDir, 'viewer.config.json'),
      JSON.stringify({ version: 1, rules: [] }),
    );

    // Create TARGET repo (with a forbidden_import rule)
    const targetRepoDir = makeTempDir();
    mkdirSync(join(targetRepoDir, 'src', 'ui'), { recursive: true });
    mkdirSync(join(targetRepoDir, 'src', 'db'), { recursive: true });
    writeFileSync(join(targetRepoDir, 'src', 'ui', 'app.ts'), 'import "../db/conn";\n');
    writeFileSync(join(targetRepoDir, 'src', 'db', 'conn.ts'), 'export const db = {};\n');
    writeFileSync(
      join(targetRepoDir, 'viewer.config.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            name: 'no-ui-to-db',
            type: 'forbidden_import',
            from: { pathGlob: 'src/ui/**' },
            to: { pathGlob: 'src/db/**' },
            severity: 'error',
          },
        ],
      }),
    );

    const dataDir = makeTempDir();
    // Start engine pointed at the engine repo (no rules)
    const engine = createViewerEngine({ dataDir, repoRoot: engineRepoDir });
    try {
      // Before indexing target, rulesChecked should be 0 (engine repo has no rules)
      // But we can't call checkInvariants before indexing since there's no model.

      // Index the TARGET repo (which has rules)
      await engine.indexer.index({ repoRoot: targetRepoDir });

      // Now checkInvariants should use the TARGET repo's rules
      const result = engine.checkInvariants({});
      const data = result.data;

      // The target repo has a rule, so rulesChecked should be > 0
      expect(data.rulesChecked).toBeGreaterThan(0);
    } finally {
      engine.close();
    }
  });
});
