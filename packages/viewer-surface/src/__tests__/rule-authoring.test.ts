/**
 * Tests for rule-authoring module: atomic config writes, backup, audit trail,
 * and rule subcommands (add, remove, list, test, enable, disable, export, import).
 *
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
  atomicConfigWrite,
  appendAuditEntry,
  addRule,
  removeRule,
  listRules,
  testRule,
  enableRule,
  disableRule,
  exportRules,
  importRules,
} from '../rule-authoring.js';
import type { ViewerConfig } from '@system2-viewer/viewer-config';
import type { AuditEntry } from '../rule-authoring.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-rule-auth-test-'));
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
// atomicConfigWrite
// ---------------------------------------------------------------------------

describe('atomicConfigWrite', () => {
  it('creates a backup and writes updated config as valid JSON', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());

    atomicConfigWrite(configPath, (config) => ({
      ...config,
      rules: [
        {
          name: 'no-direct-db',
          type: 'dependency-constraint',
          from: { pathGlob: 'src/ui/**' },
          to: { pathGlob: 'src/db/**' },
          severity: 'error',
        },
      ],
    }));

    // Backup exists
    const backupPath = configPath + '.bak';
    expect(existsSync(backupPath)).toBe(true);

    // Backup matches original config
    const backupContent = JSON.parse(readFileSync(backupPath, 'utf-8'));
    expect(backupContent.rules).toBeUndefined();

    // New config is valid JSON with the rule
    const updatedContent = readFileSync(configPath, 'utf-8');
    const updated = JSON.parse(updatedContent) as ViewerConfig;
    expect(updated.rules).toHaveLength(1);
    expect(updated.rules![0].name).toBe('no-direct-db');
    expect(updated.version).toBe(1);
  });

  it('uses defaults when config file does not exist', () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'viewer.config.json');

    atomicConfigWrite(configPath, (config) => ({
      ...config,
      rules: [
        {
          name: 'test-rule',
          type: 'dependency-constraint',
          from: { pathGlob: '*' },
          to: { pathGlob: '*' },
          severity: 'warning',
        },
      ],
    }));

    // No backup (nothing to back up)
    expect(existsSync(configPath + '.bak')).toBe(false);

    // Config was created with defaults + update
    const content = JSON.parse(readFileSync(configPath, 'utf-8')) as ViewerConfig;
    expect(content.version).toBe(1);
    expect(content.rules).toHaveLength(1);
  });

  it('does not leave temp file on success', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());

    atomicConfigWrite(configPath, (config) => config);

    expect(existsSync(configPath + '.tmp')).toBe(false);
    expect(existsSync(configPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// appendAuditEntry
// ---------------------------------------------------------------------------

describe('appendAuditEntry', () => {
  it('appends a JSON line to rule-audit.jsonl', () => {
    const dir = makeTempDir();
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const entry: AuditEntry = {
      timestamp: '2026-06-06T12:00:00.000Z',
      actor: 'cli-user',
      action: 'add',
      ruleId: 'no-direct-db',
    };

    appendAuditEntry(dataDir, entry);

    const auditPath = join(dataDir, 'rule-audit.jsonl');
    expect(existsSync(auditPath)).toBe(true);

    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.timestamp).toBe('2026-06-06T12:00:00.000Z');
    expect(parsed.actor).toBe('cli-user');
    expect(parsed.action).toBe('add');
    expect(parsed.ruleId).toBe('no-direct-db');
  });

  it('appends multiple entries as separate lines', () => {
    const dir = makeTempDir();
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const entry1: AuditEntry = {
      timestamp: '2026-06-06T12:00:00.000Z',
      actor: 'cli-user',
      action: 'add',
      ruleId: 'rule-a',
    };
    const entry2: AuditEntry = {
      timestamp: '2026-06-06T12:01:00.000Z',
      actor: 'ci-bot',
      action: 'remove',
      ruleId: 'rule-b',
      details: 'cleanup',
    };

    appendAuditEntry(dataDir, entry1);
    appendAuditEntry(dataDir, entry2);

    const auditPath = join(dataDir, 'rule-audit.jsonl');
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const p1 = JSON.parse(lines[0]);
    const p2 = JSON.parse(lines[1]);
    expect(p1.ruleId).toBe('rule-a');
    expect(p2.ruleId).toBe('rule-b');
    expect(p2.details).toBe('cleanup');
  });

  it('creates the audit file if it does not exist', () => {
    const dir = makeTempDir();
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const auditPath = join(dataDir, 'rule-audit.jsonl');
    expect(existsSync(auditPath)).toBe(false);

    appendAuditEntry(dataDir, {
      timestamp: '2026-06-06T12:00:00.000Z',
      actor: 'test',
      action: 'enable',
      ruleId: 'r1',
    });

    expect(existsSync(auditPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addRule
// ---------------------------------------------------------------------------

describe('addRule', () => {
  it('adds a rule to the config and creates a backup', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = addRule({
      name: 'no-direct-db',
      type: 'dependency-constraint',
      from: 'src/ui/**',
      to: 'src/db/**',
      severity: 'error',
      configPath,
      dataDir,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('no-direct-db');

    // Config now contains the rule
    const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as ViewerConfig;
    expect(updated.rules).toHaveLength(1);
    expect(updated.rules![0].name).toBe('no-direct-db');
    expect(updated.rules![0].from).toEqual({ pathGlob: 'src/ui/**' });
    expect(updated.rules![0].to).toEqual({ pathGlob: 'src/db/**' });
    expect(updated.rules![0].severity).toBe('error');

    // Backup exists
    expect(existsSync(configPath + '.bak')).toBe(true);

    // Audit entry was written
    const auditPath = join(dataDir, 'rule-audit.jsonl');
    expect(existsSync(auditPath)).toBe(true);
    const auditLine = JSON.parse(readFileSync(auditPath, 'utf-8').trim());
    expect(auditLine.action).toBe('add');
    expect(auditLine.ruleId).toBe('no-direct-db');
  });

  it('rejects duplicate rule names', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'existing-rule',
        type: 'dependency-constraint',
        from: { pathGlob: '**' },
        to: { pathGlob: '**' },
        severity: 'warning',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = addRule({
      name: 'existing-rule',
      type: 'dependency-constraint',
      from: 'src/**',
      to: 'lib/**',
      severity: 'error',
      configPath,
      dataDir,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
  });

  it('rejects empty rule name', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = addRule({
      name: '',
      type: 'dependency-constraint',
      from: '**',
      to: '**',
      severity: 'warning',
      configPath,
      dataDir,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('required');
  });
});

// ---------------------------------------------------------------------------
// removeRule
// ---------------------------------------------------------------------------

describe('removeRule', () => {
  it('removes an existing rule from the config', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'rule-to-remove',
        type: 'dependency-constraint',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'lib/**' },
        severity: 'warning',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = removeRule({
      name: 'rule-to-remove',
      configPath,
      dataDir,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('rule-to-remove');

    // Config no longer contains the rule
    const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as ViewerConfig;
    expect(updated.rules ?? []).toHaveLength(0);

    // Audit entry was written
    const auditPath = join(dataDir, 'rule-audit.jsonl');
    const auditLine = JSON.parse(readFileSync(auditPath, 'utf-8').trim());
    expect(auditLine.action).toBe('remove');
    expect(auditLine.ruleId).toBe('rule-to-remove');
  });

  it('returns not-found for a non-existent rule', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = removeRule({
      name: 'no-such-rule',
      configPath,
      dataDir,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// listRules
// ---------------------------------------------------------------------------

describe('listRules', () => {
  it('returns all rules from the config', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'rule-a',
        type: 'dependency-constraint',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'lib/**' },
        severity: 'error',
      },
      {
        name: 'rule-b',
        type: 'forbidden_import',
        from: { pathGlob: 'ui/**' },
        to: { pathGlob: 'db/**' },
        severity: 'warning',
        enabled: false,
      },
    ];
    const configPath = writeConfig(dir, config);

    const result = listRules(configPath);

    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].name).toBe('rule-a');
    expect(result.rules[0].status).toBe('enabled');
    expect(result.rules[0].severity).toBe('error');
    expect(result.rules[0].source).toBe('explicit');
    expect(result.rules[0].from).toBe('src/**');
    expect(result.rules[0].to).toBe('lib/**');

    expect(result.rules[1].name).toBe('rule-b');
    expect(result.rules[1].status).toBe('disabled');
    expect(result.rules[1].type).toBe('forbidden_import');
  });

  it('returns empty array when no rules are configured', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());

    const result = listRules(configPath);

    expect(result.rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addRule + removeRule round-trip
// ---------------------------------------------------------------------------

describe('addRule + removeRule round-trip', () => {
  it('adds then removes a rule, leaving config clean', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    // Add
    const addResult = addRule({
      name: 'temp-rule',
      type: 'forbidden_import',
      from: 'src/**',
      to: 'vendor/**',
      severity: 'error',
      configPath,
      dataDir,
    });
    expect(addResult.success).toBe(true);

    // Verify the rule is present
    const listed = listRules(configPath);
    expect(listed.rules).toHaveLength(1);
    expect(listed.rules[0].name).toBe('temp-rule');

    // Remove
    const removeResult = removeRule({
      name: 'temp-rule',
      configPath,
      dataDir,
    });
    expect(removeResult.success).toBe(true);

    // Verify it's gone
    const listedAfter = listRules(configPath);
    expect(listedAfter.rules).toHaveLength(0);

    // Audit log has both entries
    const auditPath = join(dataDir, 'rule-audit.jsonl');
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).action).toBe('add');
    expect(JSON.parse(lines[1]).action).toBe('remove');
  });
});

// ---------------------------------------------------------------------------
// testRule
// ---------------------------------------------------------------------------

describe('testRule', () => {
  it('returns empty violations for a rule with no matching imports', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'test-forbidden',
        type: 'forbidden_import',
        from: { pathGlob: 'src/ui/**' },
        to: { pathGlob: 'src/db/**' },
        severity: 'error',
      },
    ];
    const configPath = writeConfig(dir, config);

    const result = testRule({ name: 'test-forbidden', configPath });

    expect(result.ruleName).toBe('test-forbidden');
    expect(result.violations).toHaveLength(0);
    expect(result.violationCount).toBe(0);
  });

  it('returns empty result for a non-existent rule name', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());

    const result = testRule({ name: 'no-such-rule', configPath });

    expect(result.ruleName).toBe('no-such-rule');
    expect(result.violations).toHaveLength(0);
    expect(result.violationCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enableRule
// ---------------------------------------------------------------------------

describe('enableRule', () => {
  it('enables a disabled rule by removing the enabled field', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'disabled-rule',
        type: 'dependency-constraint',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'lib/**' },
        severity: 'warning',
        enabled: false,
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = enableRule({ name: 'disabled-rule', configPath, dataDir });

    expect(result.success).toBe(true);
    expect(result.message).toContain('disabled-rule');
    expect(result.message).toContain('enabled');

    // Config no longer has enabled: false
    const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as ViewerConfig;
    expect(updated.rules![0].enabled).toBeUndefined();

    // List shows it as enabled
    const listed = listRules(configPath);
    expect(listed.rules[0].status).toBe('enabled');
  });

  it('returns not-found for a non-existent rule', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = enableRule({ name: 'no-such-rule', configPath, dataDir });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('rejects empty rule name', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');

    const result = enableRule({ name: '', configPath, dataDir });

    expect(result.success).toBe(false);
    expect(result.message).toContain('required');
  });
});

// ---------------------------------------------------------------------------
// disableRule
// ---------------------------------------------------------------------------

describe('disableRule', () => {
  it('disables an enabled rule by setting enabled: false', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'active-rule',
        type: 'dependency-constraint',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'lib/**' },
        severity: 'error',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = disableRule({ name: 'active-rule', configPath, dataDir });

    expect(result.success).toBe(true);
    expect(result.message).toContain('active-rule');
    expect(result.message).toContain('disabled');

    // Config has enabled: false
    const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as ViewerConfig;
    expect(updated.rules![0].enabled).toBe(false);

    // List shows it as disabled
    const listed = listRules(configPath);
    expect(listed.rules[0].status).toBe('disabled');
  });

  it('returns not-found for a non-existent rule', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = disableRule({ name: 'no-such-rule', configPath, dataDir });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// enable + disable round-trip
// ---------------------------------------------------------------------------

describe('enable + disable round-trip', () => {
  it('toggles a rule between enabled and disabled', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'toggle-me',
        type: 'dependency-constraint',
        from: { pathGlob: 'a/**' },
        to: { pathGlob: 'b/**' },
        severity: 'warning',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    // Initially enabled (no field)
    expect(listRules(configPath).rules[0].status).toBe('enabled');

    // Disable
    disableRule({ name: 'toggle-me', configPath, dataDir });
    expect(listRules(configPath).rules[0].status).toBe('disabled');

    // Re-enable
    enableRule({ name: 'toggle-me', configPath, dataDir });
    expect(listRules(configPath).rules[0].status).toBe('enabled');
  });
});

// ---------------------------------------------------------------------------
// exportRules
// ---------------------------------------------------------------------------

describe('exportRules', () => {
  it('exports rules as JSON with version and timestamp', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'rule-a',
        type: 'dependency-constraint',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'lib/**' },
        severity: 'error',
      },
      {
        name: 'rule-b',
        type: 'forbidden_import',
        from: { pathGlob: 'ui/**' },
        to: { pathGlob: 'db/**' },
        severity: 'warning',
      },
    ];
    const configPath = writeConfig(dir, config);
    const outputPath = join(dir, 'exported-rules.json');

    const result = exportRules({ configPath, outputPath });

    expect(result.ruleCount).toBe(2);
    expect(result.exportPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const exported = JSON.parse(readFileSync(outputPath, 'utf-8'));
    expect(exported.version).toBe(1);
    expect(exported.rules).toHaveLength(2);
    expect(exported.rules[0].name).toBe('rule-a');
    expect(exported.rules[1].name).toBe('rule-b');
    expect(typeof exported.exportedAt).toBe('string');
    // Validate ISO timestamp
    expect(new Date(exported.exportedAt).toISOString()).toBe(exported.exportedAt);
  });

  it('exports empty array when no rules exist', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const outputPath = join(dir, 'empty-export.json');

    const result = exportRules({ configPath, outputPath });

    expect(result.ruleCount).toBe(0);
    const exported = JSON.parse(readFileSync(outputPath, 'utf-8'));
    expect(exported.version).toBe(1);
    expect(exported.rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// importRules
// ---------------------------------------------------------------------------

describe('importRules', () => {
  it('imports rules that do not collide with existing rules', () => {
    const dir = makeTempDir();
    const config = minimalConfig();
    config.rules = [
      {
        name: 'existing-rule',
        type: 'dependency-constraint',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'lib/**' },
        severity: 'error',
      },
    ];
    const configPath = writeConfig(dir, config);
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const importFile = join(dir, 'import.json');
    writeFileSync(
      importFile,
      JSON.stringify({
        version: 1,
        rules: [
          {
            name: 'new-rule',
            type: 'forbidden_import',
            from: { pathGlob: 'ui/**' },
            to: { pathGlob: 'db/**' },
            severity: 'warning',
          },
          {
            name: 'existing-rule',
            type: 'dependency-constraint',
            from: { pathGlob: 'x/**' },
            to: { pathGlob: 'y/**' },
            severity: 'error',
          },
        ],
        exportedAt: '2026-01-01T00:00:00.000Z',
      }),
      'utf-8',
    );

    const result = importRules({ filePath: importFile, configPath, dataDir });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1); // existing-rule collision
    expect(result.rejected).toHaveLength(0);

    // Config has both rules
    const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as ViewerConfig;
    expect(updated.rules).toHaveLength(2);
    expect(updated.rules![0].name).toBe('existing-rule');
    expect(updated.rules![1].name).toBe('new-rule');
  });

  it('rejects invalid JSON in import file', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const importFile = join(dir, 'bad.json');
    writeFileSync(importFile, '{not valid json', 'utf-8');

    const result = importRules({ filePath: importFile, configPath, dataDir });

    expect(result.imported).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Invalid JSON');
  });

  it('rejects missing version field', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const importFile = join(dir, 'no-version.json');
    writeFileSync(importFile, JSON.stringify({ rules: [] }), 'utf-8');

    const result = importRules({ filePath: importFile, configPath, dataDir });

    expect(result.imported).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('missing version');
  });

  it('rejects unsupported version', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const importFile = join(dir, 'v99.json');
    writeFileSync(importFile, JSON.stringify({ version: 99, rules: [] }), 'utf-8');

    const result = importRules({ filePath: importFile, configPath, dataDir });

    expect(result.imported).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Unsupported version');
  });

  it('rejects rules with missing required fields', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const importFile = join(dir, 'bad-rules.json');
    writeFileSync(
      importFile,
      JSON.stringify({
        version: 1,
        rules: [
          { name: '', type: 'x', from: { pathGlob: '*' }, to: { pathGlob: '*' }, severity: 'error' },
          { name: 'ok-rule', type: 'dependency-constraint', from: { pathGlob: 'a/**' }, to: { pathGlob: 'b/**' }, severity: 'warning' },
        ],
      }),
      'utf-8',
    );

    const result = importRules({ filePath: importFile, configPath, dataDir });

    expect(result.imported).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].index).toBe(0);
    expect(result.rejected[0].reason).toContain('name');
  });

  it('returns error for non-existent import file', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const result = importRules({ filePath: join(dir, 'nope.json'), configPath, dataDir });

    expect(result.imported).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('not found');
  });

  it('skips duplicate names within the same import batch', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    const importFile = join(dir, 'dup-batch.json');
    writeFileSync(
      importFile,
      JSON.stringify({
        version: 1,
        rules: [
          { name: 'dup-rule', type: 'dependency-constraint', from: { pathGlob: 'a/**' }, to: { pathGlob: 'b/**' }, severity: 'error' },
          { name: 'dup-rule', type: 'dependency-constraint', from: { pathGlob: 'c/**' }, to: { pathGlob: 'd/**' }, severity: 'warning' },
        ],
      }),
      'utf-8',
    );

    const result = importRules({ filePath: importFile, configPath, dataDir });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// export + import round-trip
// ---------------------------------------------------------------------------

describe('export + import round-trip', () => {
  it('exports rules from one config and imports them into another', () => {
    // Source config with rules
    const srcDir = makeTempDir();
    const srcConfig = minimalConfig();
    srcConfig.rules = [
      {
        name: 'rule-alpha',
        type: 'dependency-constraint',
        from: { pathGlob: 'src/**' },
        to: { pathGlob: 'lib/**' },
        severity: 'error',
      },
    ];
    const srcConfigPath = writeConfig(srcDir, srcConfig);
    const exportPath = join(srcDir, 'rules.json');

    // Export
    const exportResult = exportRules({ configPath: srcConfigPath, outputPath: exportPath });
    expect(exportResult.ruleCount).toBe(1);

    // Destination config (empty)
    const dstDir = makeTempDir();
    const dstConfigPath = writeConfig(dstDir, minimalConfig());
    const dstDataDir = join(dstDir, '.system2-viewer');
    mkdirSync(dstDataDir, { recursive: true });

    // Import
    const importResult = importRules({ filePath: exportPath, configPath: dstConfigPath, dataDir: dstDataDir });
    expect(importResult.imported).toBe(1);
    expect(importResult.skipped).toBe(0);

    // Destination has the rule
    const dstUpdated = JSON.parse(readFileSync(dstConfigPath, 'utf-8')) as ViewerConfig;
    expect(dstUpdated.rules).toHaveLength(1);
    expect(dstUpdated.rules![0].name).toBe('rule-alpha');
  });
});

// ---------------------------------------------------------------------------
// Audit trail across operations
// ---------------------------------------------------------------------------

describe('audit trail', () => {
  it('records entries for add, remove, enable, disable, and import', () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, minimalConfig());
    const dataDir = join(dir, '.system2-viewer');
    mkdirSync(dataDir, { recursive: true });

    // 1. add
    addRule({
      name: 'audit-rule',
      type: 'dependency-constraint',
      from: 'src/**',
      to: 'lib/**',
      severity: 'warning',
      configPath,
      dataDir,
      actor: 'test-actor',
    });

    // 2. disable
    disableRule({ name: 'audit-rule', configPath, dataDir, actor: 'test-actor' });

    // 3. enable
    enableRule({ name: 'audit-rule', configPath, dataDir, actor: 'test-actor' });

    // 4. remove
    removeRule({ name: 'audit-rule', configPath, dataDir, actor: 'test-actor' });

    // 5. import
    const importFile = join(dir, 'import-audit.json');
    writeFileSync(
      importFile,
      JSON.stringify({
        version: 1,
        rules: [
          { name: 'imported-rule', type: 'forbidden_import', from: { pathGlob: 'x/**' }, to: { pathGlob: 'y/**' }, severity: 'error' },
        ],
      }),
      'utf-8',
    );
    importRules({ filePath: importFile, configPath, dataDir, actor: 'test-actor' });

    // Read audit log
    const auditPath = join(dataDir, 'rule-audit.jsonl');
    expect(existsSync(auditPath)).toBe(true);

    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(5);

    const entries = lines.map((l) => JSON.parse(l) as AuditEntry);
    expect(entries[0].action).toBe('add');
    expect(entries[0].ruleId).toBe('audit-rule');
    expect(entries[0].actor).toBe('test-actor');

    expect(entries[1].action).toBe('disable');
    expect(entries[1].ruleId).toBe('audit-rule');

    expect(entries[2].action).toBe('enable');
    expect(entries[2].ruleId).toBe('audit-rule');

    expect(entries[3].action).toBe('remove');
    expect(entries[3].ruleId).toBe('audit-rule');

    expect(entries[4].action).toBe('import');
    expect(entries[4].ruleId).toBe('imported-rule');

    // All entries have timestamps
    for (const entry of entries) {
      expect(typeof entry.timestamp).toBe('string');
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    }
  });
});
