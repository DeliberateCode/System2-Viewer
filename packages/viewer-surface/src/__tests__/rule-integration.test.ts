/**
 * Integration tests for rule authoring workflows.
 *
 *
 * Tests:
 *   1. Full lifecycle: add -> list -> test -> disable -> list -> enable -> export -> import
 *   2. CLI dispatch: viewer rule add --name ... --type ... --from ... --to ...
 *   3. CLI dispatch: viewer rule list
 *   4. CLI dispatch: viewer rule remove --name ...
 *   5. Atomic write safety: after addRule, backup file exists
 *   6. Audit trail: after add+remove, audit file has 2 entries
 *   7. Import validation: invalid JSON exits with error
 *   8. Import collision: same-name rule is skipped
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addRule,
  removeRule,
  listRules,
  testRule,
  disableRule,
  enableRule,
  exportRules,
  importRules,
} from '../rule-authoring.js';
import { runCli } from '../cli.js';
import type { CliOps, ResolveResult } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import type { ViewerConfig } from '@system2-viewer/viewer-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-rule-integ-'));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, config: ViewerConfig): string {
  const configPath = join(dir, 'viewer.config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return configPath;
}

function minimalConfig(): ViewerConfig {
  return {
    version: 1,
    repository: {},
    indexing: { gitHistoryDepth: 50, symbolBackend: 'treesitter' },
    remote: { enabled: false },
  };
}

function readConfig(configPath: string): ViewerConfig {
  return JSON.parse(readFileSync(configPath, 'utf-8')) as ViewerConfig;
}

function readAuditLines(dataDir: string): Array<Record<string, unknown>> {
  const auditPath = join(dataDir, 'rule-audit.jsonl');
  if (!existsSync(auditPath)) return [];
  return readFileSync(auditPath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Minimal mock CliOps for CLI dispatch tests (rule subcommands bypass most ops). */
function makeEnvelope(op: string, data: unknown = {}): ResultEnvelope<unknown> {
  return {
    query: { op, args: {} },
    data,
    evidence: [],
    uncertainties: [],
    suggestedNextCalls: [],
    modelRevision: 'test-rev',
  };
}

function createMinimalCliOps(): CliOps {
  const stub = () => makeEnvelope('stub');
  const resolveResult: ResolveResult = {
    status: 'resolved',
    id: 'node-1',
    kind: 'path',
    displayName: 'test.ts',
  };
  return {
    getRepositoryOverview: stub,
    findEntrypoints: stub,
    traceFlow: stub,
    explainSubsystem: stub,
    estimateBlastRadius: stub,
    listClaims: stub,
    listUncertainties: stub,
    checkInvariants: stub,
    verifyClaim: stub,
    buildClaimPayload: stub,
    sampleEvidenceAgreement: stub,
    feedback: {
      confirmClaim: () => ({}) as never,
      rejectClaim: () => ({}) as never,
      annotateClaim: () => ({}) as never,
      confirmSubsystem: () => ({}) as never,
      rejectSubsystem: () => ({}) as never,
      annotateSubsystem: () => ({}) as never,
    },
    index: async () => makeEnvelope('index'),
    resolveRef: () => makeEnvelope('resolveReference', resolveResult) as ResultEnvelope<ResolveResult>,
    getClaimHistory: stub,
    compareRevisions: stub,
    doctor: stub,
    status: stub,
    initConfig: () => ({ configPath: '/tmp/viewer.config.json', created: true, existed: false }),
    mcpConfig: () => ({ targetPath: '/tmp/.mcp.json', created: true }),
  } as unknown as CliOps;
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
// 1. Full lifecycle
// ---------------------------------------------------------------------------

describe('Rule authoring full lifecycle', () => {
  it('add -> list (present) -> test -> disable -> list (disabled) -> enable -> export -> import into another config', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    // --- Add ---
    const addResult = addRule({
      name: 'no-ui-to-db',
      type: 'forbidden_import',
      from: 'src/ui/*',
      to: 'src/db/*',
      severity: 'error',
      configPath,
      dataDir,
    });
    expect(addResult.success).toBe(true);

    // --- List (verify present) ---
    const listed1 = listRules(configPath);
    expect(listed1.rules).toHaveLength(1);
    expect(listed1.rules[0].name).toBe('no-ui-to-db');
    expect(listed1.rules[0].type).toBe('forbidden_import');
    expect(listed1.rules[0].status).toBe('enabled');
    expect(listed1.rules[0].from).toBe('src/ui/*');
    expect(listed1.rules[0].to).toBe('src/db/*');

    // --- Test (dry-run) ---
    const testResult = testRule({ name: 'no-ui-to-db', configPath });
    expect(testResult.ruleName).toBe('no-ui-to-db');
    // With no model data the dry-run should find zero violations
    expect(testResult.violationCount).toBe(0);

    // --- Disable ---
    const disableResult = disableRule({ name: 'no-ui-to-db', configPath, dataDir });
    expect(disableResult.success).toBe(true);

    // --- List (verify disabled) ---
    const listed2 = listRules(configPath);
    expect(listed2.rules).toHaveLength(1);
    expect(listed2.rules[0].status).toBe('disabled');

    // --- Enable ---
    const enableResult = enableRule({ name: 'no-ui-to-db', configPath, dataDir });
    expect(enableResult.success).toBe(true);

    const listed3 = listRules(configPath);
    expect(listed3.rules[0].status).toBe('enabled');

    // --- Export ---
    const exportPath = join(dir, 'rules-export.json');
    const exportResult = exportRules({ configPath, outputPath: exportPath });
    expect(exportResult.ruleCount).toBe(1);
    expect(existsSync(exportPath)).toBe(true);

    // --- Import into another config ---
    const dir2 = makeTempDir();
    const configPath2 = writeConfig(dir2, minimalConfig());
    const dataDir2 = join(dir2, '.system2-viewer');
    mkdirSync(dataDir2, { recursive: true });

    const importResult = importRules({
      filePath: exportPath,
      configPath: configPath2,
      dataDir: dataDir2,
    });
    expect(importResult.imported).toBe(1);
    expect(importResult.skipped).toBe(0);
    expect(importResult.rejected).toHaveLength(0);

    // Verify imported rule matches the original
    const imported = readConfig(configPath2);
    expect(imported.rules).toHaveLength(1);
    expect(imported.rules![0].name).toBe('no-ui-to-db');
    expect(imported.rules![0].type).toBe('forbidden_import');
    expect(imported.rules![0].from).toEqual({ pathGlob: 'src/ui/*' });
    expect(imported.rules![0].to).toEqual({ pathGlob: 'src/db/*' });
    expect(imported.rules![0].severity).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// 2-4. CLI dispatch tests
// ---------------------------------------------------------------------------

describe('CLI dispatch for rule subcommands', () => {
  it('viewer rule add --name test-rule --type forbidden_import --from "src/a/*" --to "src/b/*" routes correctly', async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const ops = createMinimalCliOps();
    const output: string[] = [];

    const exitCode = await runCli(
      [
        'rule', 'add',
        '--name', 'test-rule',
        '--type', 'forbidden_import',
        '--from', 'src/a/*',
        '--to', 'src/b/*',
        '--severity', 'error',
        '--config', configPath,
      ],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(0);
    // Output should contain the result JSON
    const joined = output.join('\n');
    expect(joined).toContain('"success"');
    expect(joined).toContain('test-rule');
  });

  it('viewer rule list returns rules', async () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'list-me',
        type: 'forbidden_import',
        from: { pathGlob: 'a/**' },
        to: { pathGlob: 'b/**' },
        severity: 'warning',
      },
    ];
    const configPath = writeConfig(dir, config);

    const ops = createMinimalCliOps();
    const output: string[] = [];

    const exitCode = await runCli(
      ['rule', 'list', '--config', configPath],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(0);
    const joined = output.join('\n');
    expect(joined).toContain('list-me');
    expect(joined).toContain('forbidden_import');
  });

  it('viewer rule remove --name test-rule removes it', async () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'test-rule',
        type: 'forbidden_import',
        from: { pathGlob: 'x/**' },
        to: { pathGlob: 'y/**' },
        severity: 'error',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const ops = createMinimalCliOps();
    const output: string[] = [];

    const exitCode = await runCli(
      [
        'rule', 'remove',
        '--name', 'test-rule',
        '--config', configPath,
      ],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(0);
    const joined = output.join('\n');
    expect(joined).toContain('test-rule');
    expect(joined).toContain('"success"');

    // Verify the rule is actually gone from config
    const updated = readConfig(configPath);
    expect(updated.rules ?? []).toHaveLength(0);
  });

  it('viewer rule with unknown subcommand exits with code 2', async () => {
    const ops = createMinimalCliOps();
    const output: string[] = [];

    const exitCode = await runCli(
      ['rule', 'bogus'],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(2);
    const joined = output.join('\n');
    expect(joined).toContain('Unknown rule subcommand');
  });

  it('viewer rule with no subcommand exits with code 2', async () => {
    const ops = createMinimalCliOps();
    const output: string[] = [];

    const exitCode = await runCli(
      ['rule'],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(2);
    expect(output.some((l) => l.includes('Usage'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Atomic write safety
// ---------------------------------------------------------------------------

describe('Atomic write safety', () => {
  it('after addRule, backup file (.bak) exists with prior config content', () => {
    const dir = makeTempDir();
    const originalConfig = minimalConfig();
    const configPath = writeConfig(dir, originalConfig);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    // Verify no backup yet
    expect(existsSync(configPath + '.bak')).toBe(false);

    addRule({
      name: 'backup-test',
      type: 'forbidden_import',
      from: 'src/**',
      to: 'lib/**',
      severity: 'warning',
      configPath,
      dataDir,
    });

    // Backup must exist
    expect(existsSync(configPath + '.bak')).toBe(true);

    // Backup should contain the original config (no rules)
    const backup = JSON.parse(readFileSync(configPath + '.bak', 'utf-8')) as ViewerConfig;
    expect(backup.rules).toBeUndefined();
    expect(backup.version).toBe(1);

    // Updated config should contain the new rule
    const updated = readConfig(configPath);
    expect(updated.rules).toHaveLength(1);
    expect(updated.rules![0].name).toBe('backup-test');

    // No temp file left behind
    expect(existsSync(configPath + '.tmp')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Audit trail
// ---------------------------------------------------------------------------

describe('Audit trail', () => {
  it('after add+remove, audit file has exactly 2 entries', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    // Add
    addRule({
      name: 'audit-check',
      type: 'forbidden_import',
      from: 'src/a/*',
      to: 'src/b/*',
      severity: 'error',
      configPath,
      dataDir,
      actor: 'integration-test',
    });

    // Remove
    removeRule({
      name: 'audit-check',
      configPath,
      dataDir,
      actor: 'integration-test',
    });

    // Verify audit file
    const entries = readAuditLines(dataDir);
    expect(entries).toHaveLength(2);

    // First entry is add
    expect(entries[0].action).toBe('add');
    expect(entries[0].ruleId).toBe('audit-check');
    expect(entries[0].actor).toBe('integration-test');
    expect(typeof entries[0].timestamp).toBe('string');

    // Second entry is remove
    expect(entries[1].action).toBe('remove');
    expect(entries[1].ruleId).toBe('audit-check');
    expect(entries[1].actor).toBe('integration-test');
    expect(typeof entries[1].timestamp).toBe('string');
  });

  it('all audit entries have valid ISO timestamps', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    addRule({
      name: 'ts-check',
      type: 'forbidden_import',
      from: '**',
      to: '**',
      severity: 'warning',
      configPath,
      dataDir,
    });
    disableRule({ name: 'ts-check', configPath, dataDir });
    enableRule({ name: 'ts-check', configPath, dataDir });

    const entries = readAuditLines(dataDir);
    expect(entries).toHaveLength(3);

    for (const entry of entries) {
      const ts = entry.timestamp as string;
      expect(new Date(ts).toISOString()).toBe(ts);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Import validation: invalid JSON exits with error
// ---------------------------------------------------------------------------

describe('Import validation', () => {
  it('importing file with invalid JSON returns error with zero imports', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const badFile = join(dir, 'bad-import.json');
    writeFileSync(badFile, '{this is not valid json!!!', 'utf-8');

    const result = importRules({
      filePath: badFile,
      configPath,
      dataDir,
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Invalid JSON');
  });

  it('importing file with valid JSON but wrong structure returns error', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const badFile = join(dir, 'wrong-structure.json');
    writeFileSync(badFile, JSON.stringify({ hello: 'world' }), 'utf-8');

    const result = importRules({
      filePath: badFile,
      configPath,
      dataDir,
    });

    expect(result.imported).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('missing version');
  });

  it('importing non-existent file returns file-not-found error', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = importRules({
      filePath: join(dir, 'does-not-exist.json'),
      configPath,
      dataDir,
    });

    expect(result.imported).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('not found');
  });

  it('importing file with unsupported version returns error', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const badFile = join(dir, 'bad-version.json');
    writeFileSync(badFile, JSON.stringify({ version: 42, rules: [] }), 'utf-8');

    const result = importRules({
      filePath: badFile,
      configPath,
      dataDir,
    });

    expect(result.imported).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Unsupported version');
  });
});

// ---------------------------------------------------------------------------
// 8. Import collision: same-name rule skipped
// ---------------------------------------------------------------------------

describe('Import collision', () => {
  it('importing a rule with same name as existing rule is skipped, not overwritten', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'collision-rule',
        type: 'forbidden_import',
        from: { pathGlob: 'src/original/**' },
        to: { pathGlob: 'lib/original/**' },
        severity: 'error',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    // Import file has a rule with the same name but different paths
    const importFile = join(dir, 'collision-import.json');
    writeFileSync(
      importFile,
      JSON.stringify({
        version: 1,
        rules: [
          {
            name: 'collision-rule',
            type: 'forbidden_import',
            from: { pathGlob: 'src/different/**' },
            to: { pathGlob: 'lib/different/**' },
            severity: 'warning',
          },
          {
            name: 'new-unique-rule',
            type: 'dependency-constraint',
            from: { pathGlob: 'ui/**' },
            to: { pathGlob: 'db/**' },
            severity: 'error',
          },
        ],
      }),
      'utf-8',
    );

    const result = importRules({
      filePath: importFile,
      configPath,
      dataDir,
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rejected).toHaveLength(0);

    // Verify the original rule was NOT overwritten
    const updated = readConfig(configPath);
    expect(updated.rules).toHaveLength(2);

    const collisionRule = updated.rules!.find((r) => r.name === 'collision-rule');
    expect(collisionRule).toBeDefined();
    expect(collisionRule!.from.pathGlob).toBe('src/original/**');
    expect(collisionRule!.to.pathGlob).toBe('lib/original/**');
    expect(collisionRule!.severity).toBe('error');

    // The new rule was imported
    const newRule = updated.rules!.find((r) => r.name === 'new-unique-rule');
    expect(newRule).toBeDefined();
    expect(newRule!.type).toBe('dependency-constraint');
  });

  it('duplicate names within a single import batch: only first is imported', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const importFile = join(dir, 'batch-dup.json');
    writeFileSync(
      importFile,
      JSON.stringify({
        version: 1,
        rules: [
          {
            name: 'dup-name',
            type: 'forbidden_import',
            from: { pathGlob: 'first/**' },
            to: { pathGlob: 'first/**' },
            severity: 'error',
          },
          {
            name: 'dup-name',
            type: 'dependency-constraint',
            from: { pathGlob: 'second/**' },
            to: { pathGlob: 'second/**' },
            severity: 'warning',
          },
        ],
      }),
      'utf-8',
    );

    const result = importRules({
      filePath: importFile,
      configPath,
      dataDir,
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);

    // Only the first occurrence was imported
    const updated = readConfig(configPath);
    expect(updated.rules).toHaveLength(1);
    expect(updated.rules![0].from.pathGlob).toBe('first/**');
  });
});

// ---------------------------------------------------------------------------
// CLI dispatch: viewer rule export + import round-trip through CLI
// ---------------------------------------------------------------------------

describe('CLI dispatch: export and import round-trip', () => {
  it('exports via CLI and imports via CLI into a different config', async () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'cli-roundtrip',
        type: 'forbidden_import',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'vendor/**' },
        severity: 'error',
      },
    ];
    const configPath = writeConfig(dir, config);
    const exportPath = join(dir, 'cli-export.json');

    const ops = createMinimalCliOps();
    const output1: string[] = [];

    // Export
    const exitExport = await runCli(
      ['rule', 'export', '--config', configPath, '--output', exportPath],
      ops,
      (line) => output1.push(line),
    );
    expect(exitExport).toBe(0);
    expect(existsSync(exportPath)).toBe(true);

    // Create a second empty config
    const dir2 = makeTempDir();
    const configPath2 = writeConfig(dir2, minimalConfig());
    const dataDir2 = join(dir2, '.system2-viewer');
    mkdirSync(dataDir2, { recursive: true });

    const output2: string[] = [];

    // Import via CLI
    const exitImport = await runCli(
      [
        'rule', 'import',
        '--filePath', exportPath,
        '--config', configPath2,
      ],
      ops,
      (line) => output2.push(line),
    );
    expect(exitImport).toBe(0);

    // Verify the target config now has the rule
    const imported = readConfig(configPath2);
    expect(imported.rules).toHaveLength(1);
    expect(imported.rules![0].name).toBe('cli-roundtrip');
  });
});

// ---------------------------------------------------------------------------
// CLI dispatch: viewer rule enable / disable through CLI
// ---------------------------------------------------------------------------

describe('CLI dispatch: enable and disable', () => {
  it('disable then enable round-trip via CLI', async () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'cli-toggle',
        type: 'dependency-constraint',
        from: { pathGlob: 'a/**' },
        to: { pathGlob: 'b/**' },
        severity: 'warning',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const ops = createMinimalCliOps();

    // Disable via CLI
    const output1: string[] = [];
    const exitDisable = await runCli(
      ['rule', 'disable', '--name', 'cli-toggle', '--config', configPath],
      ops,
      (line) => output1.push(line),
    );
    expect(exitDisable).toBe(0);
    expect(readConfig(configPath).rules![0].enabled).toBe(false);

    // Enable via CLI
    const output2: string[] = [];
    const exitEnable = await runCli(
      ['rule', 'enable', '--name', 'cli-toggle', '--config', configPath],
      ops,
      (line) => output2.push(line),
    );
    expect(exitEnable).toBe(0);
    expect(readConfig(configPath).rules![0].enabled).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CLI dispatch: viewer rule test through CLI
// ---------------------------------------------------------------------------

describe('CLI dispatch: rule test', () => {
  it('test subcommand returns dry-run results via CLI', async () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'test-dryrun',
        type: 'forbidden_import',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'vendor/**' },
        severity: 'error',
      },
    ];
    const configPath = writeConfig(dir, config);

    const ops = createMinimalCliOps();
    const output: string[] = [];

    const exitCode = await runCli(
      ['rule', 'test', '--name', 'test-dryrun', '--config', configPath],
      ops,
      (line) => output.push(line),
    );

    expect(exitCode).toBe(0);
    const joined = output.join('\n');
    expect(joined).toContain('test-dryrun');
    expect(joined).toContain('violationCount');
  });
});
