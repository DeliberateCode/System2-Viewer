/**
 * Rule authoring module: atomic config writes, backup, audit trail,
 * and implementations for rule subcommands.
 *
 * Infrastructure add/remove/list/test
 * enable/disable/export/import.
 */
import {
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { loadConfigResult } from '@system2-viewer/viewer-config';
import type { ViewerConfig, RuleDef } from '@system2-viewer/viewer-config';
import {
  RulesEngine,
  loadExplicitRules,
} from '@system2-viewer/viewer-verify';
import type { RulesReadHandle } from '@system2-viewer/viewer-verify';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  ruleId: string;
  details?: string;
}

export interface RuleAddOpts {
  name: string;
  type: string;
  from: string;
  to: string;
  severity: string;
  configPath: string;
  dataDir: string;
  actor?: string;
}

export interface RuleRemoveOpts {
  name: string;
  configPath: string;
  dataDir: string;
  actor?: string;
}

export interface RuleTestOpts {
  name: string;
  configPath: string;
  dataDir?: string;
}

export interface RuleToggleOpts {
  name: string;
  configPath: string;
  dataDir: string;
  actor?: string;
}

export interface RuleImportOpts {
  filePath: string;
  configPath: string;
  dataDir: string;
  actor?: string;
}

export interface RuleExportOpts {
  configPath: string;
  outputPath: string;
}

export interface RuleAuthoringResult {
  success: boolean;
  message: string;
}

export interface RuleListResult {
  rules: Array<{
    name: string;
    type: string;
    status: 'enabled' | 'disabled';
    severity: string;
    source: 'explicit' | 'inferred';
    from: string;
    to: string;
  }>;
}

export interface RuleTestResult {
  ruleName: string;
  violations: Array<{
    fromPath: string;
    toPath: string;
    edgeKind: string;
  }>;
  violationCount: number;
}

export interface RuleExportResult {
  exportPath: string;
  ruleCount: number;
}

export interface RuleImportResult {
  imported: number;
  skipped: number;
  rejected: Array<{ index: number; reason: string }>;
}

export interface RuleAuthoringOps {
  add(opts: RuleAddOpts): RuleAuthoringResult;
  list(): RuleListResult;
  remove(opts: RuleRemoveOpts): RuleAuthoringResult;
  test(opts: RuleTestOpts): RuleTestResult;
  enable(opts: RuleToggleOpts): RuleAuthoringResult;
  disable(opts: RuleToggleOpts): RuleAuthoringResult;
  export(opts: RuleExportOpts): RuleExportResult;
  import(opts: RuleImportOpts): RuleImportResult;
}

// ---------------------------------------------------------------------------
// Atomic config write
// ---------------------------------------------------------------------------

/**
 * Atomically update a viewer config file.
 *
 * 1. If the config file exists, back it up to `${configPath}.bak`.
 * 2. Load current config (or defaults if missing).
 * 3. Apply the updater function.
 * 4. Validate the result via JSON.parse roundtrip.
 * 5. Write to a temp file `${configPath}.tmp`.
 * 6. Rename temp to configPath (atomic on POSIX).
 */
export function atomicConfigWrite(
  configPath: string,
  updater: (config: ViewerConfig) => ViewerConfig,
): void {
  // 1. Backup current config if it exists
  if (existsSync(configPath)) {
    const backupPath = configPath + '.bak';
    copyFileSync(configPath, backupPath);
  }

  // 2. Load current config from the exact file path
  let current: ViewerConfig;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    current = JSON.parse(raw) as ViewerConfig;
  } catch {
    // File missing or malformed -- start from defaults
    const { config: defaults } = loadConfigResult(dirname(configPath));
    current = defaults;
  }

  // 3. Apply updater
  const updated = updater(current);

  // 4. Serialize and validate (defense-in-depth)
  const json = JSON.stringify(updated, null, 2) + '\n';
  JSON.parse(json); // throws if somehow malformed

  // 5. Write to temp file
  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, json, 'utf-8');

  // 6. Atomic rename
  renameSync(tmpPath, configPath);
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Append a JSON line to the rule audit log.
 *
 * File: `${dataDir}/rule-audit.jsonl`
 */
export function appendAuditEntry(dataDir: string, entry: AuditEntry): void {
  mkdirSync(dataDir, { recursive: true });
  const auditPath = join(dataDir, 'rule-audit.jsonl');
  appendFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Rule subcommand implementations
// ---------------------------------------------------------------------------

export function addRule(opts: RuleAddOpts): RuleAuthoringResult {
  if (!opts.name) {
    return { success: false, message: 'Rule name is required' };
  }

  const repoRoot = dirname(opts.configPath);
  const { config } = loadConfigResult(repoRoot);
  const existing = config.rules ?? [];

  if (existing.some((r) => r.name === opts.name)) {
    return { success: false, message: `Rule "${opts.name}" already exists` };
  }

  const newRule: RuleDef = {
    name: opts.name,
    type: opts.type || 'dependency-constraint',
    from: { pathGlob: opts.from || '**' },
    to: { pathGlob: opts.to || '**' },
    severity: opts.severity || 'warning',
  };

  atomicConfigWrite(opts.configPath, (cfg) => ({
    ...cfg,
    rules: [...(cfg.rules ?? []), newRule],
  }));

  appendAuditEntry(opts.dataDir, {
    timestamp: new Date().toISOString(),
    actor: opts.actor ?? 'cli-user',
    action: 'add',
    ruleId: opts.name,
    details: `type=${newRule.type}, from=${newRule.from.pathGlob}, to=${newRule.to.pathGlob}`,
  });

  return { success: true, message: `Rule "${opts.name}" added` };
}

export function removeRule(opts: RuleRemoveOpts): RuleAuthoringResult {
  if (!opts.name) {
    return { success: false, message: 'Rule name is required' };
  }

  const repoRoot = dirname(opts.configPath);
  const { config } = loadConfigResult(repoRoot);
  const existing = config.rules ?? [];

  if (!existing.some((r) => r.name === opts.name)) {
    return { success: false, message: `Rule "${opts.name}" not found` };
  }

  atomicConfigWrite(opts.configPath, (cfg) => ({
    ...cfg,
    rules: (cfg.rules ?? []).filter((r) => r.name !== opts.name),
  }));

  appendAuditEntry(opts.dataDir, {
    timestamp: new Date().toISOString(),
    actor: opts.actor ?? 'cli-user',
    action: 'remove',
    ruleId: opts.name,
  });

  return { success: true, message: `Rule "${opts.name}" removed` };
}

export function listRules(configPath: string): RuleListResult {
  const repoRoot = dirname(configPath);
  const { config } = loadConfigResult(repoRoot);
  const rules = config.rules ?? [];

  return {
    rules: rules.map((r) => ({
      name: r.name,
      type: r.type,
      status: (r.enabled === false ? 'disabled' : 'enabled') as 'enabled' | 'disabled',
      severity: r.severity,
      source: 'explicit' as const,
      from: r.from.pathGlob,
      to: r.to.pathGlob,
    })),
  };
}

export function testRule(opts: RuleTestOpts): RuleTestResult {
  const repoRoot = dirname(opts.configPath);
  const { config } = loadConfigResult(repoRoot);
  const rules = config.rules ?? [];
  const ruleDef = rules.find((r) => r.name === opts.name);

  if (!ruleDef) {
    return { ruleName: opts.name, violations: [], violationCount: 0 };
  }

  const repositoryId = `repo::${basename(repoRoot) || 'unknown'}`;
  const explicitRules = loadExplicitRules(repositoryId, [
    {
      name: ruleDef.name,
      type: ruleDef.type,
      from: ruleDef.from,
      to: ruleDef.to,
      severity: ruleDef.severity,
      enabled: ruleDef.enabled,
    },
  ]);

  const engine = new RulesEngine(explicitRules, []);

  // Build a RulesReadHandle. When a dataDir with a model exists, query
  // real import edges from the SQLite store so forbidden_import rules
  // can detect actual violations.
  const handle: RulesReadHandle = {
    neighbors: () => [],
    getNode: () => null,
    allImportEdges: () => {
      if (!opts.dataDir) return [];
      const dbPath = join(opts.dataDir, 'model.sqlite');
      if (!existsSync(dbPath)) return [];
      try {
        const db = new Database(dbPath, { readonly: true });
        try {
          const sql = `
            SELECT e.from_node_id, e.to_node_id,
                   nf.path AS from_path, nt.path AS to_path
            FROM edges e
            JOIN nodes nf ON nf.id = e.from_node_id AND nf.valid_to_revision IS NULL
            JOIN nodes nt ON nt.id = e.to_node_id AND nt.valid_to_revision IS NULL
            WHERE e.kind = 'imports' AND e.valid_to_revision IS NULL
          `;
          const rows = db.prepare(sql).all() as Array<{
            from_node_id: string;
            to_node_id: string;
            from_path: string | null;
            to_path: string | null;
          }>;
          return rows
            .filter((r) => r.from_path != null && r.to_path != null)
            .map((r) => ({
              fromNodeId: r.from_node_id,
              toNodeId: r.to_node_id,
              fromPath: r.from_path!,
              toPath: r.to_path!,
            }));
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },
  };

  const result = engine.checkInvariants(handle);

  return {
    ruleName: opts.name,
    violations: result.violations.map((v) => ({
      fromPath: v.fromPath,
      toPath: v.toPath,
      edgeKind: v.ruleType,
    })),
    violationCount: result.violations.length,
  };
}

export function enableRule(opts: RuleToggleOpts): RuleAuthoringResult {
  if (!opts.name) {
    return { success: false, message: 'Rule name is required' };
  }

  const repoRoot = dirname(opts.configPath);
  const { config } = loadConfigResult(repoRoot);
  const existing = config.rules ?? [];

  if (!existing.some((r) => r.name === opts.name)) {
    return { success: false, message: `Rule "${opts.name}" not found` };
  }

  atomicConfigWrite(opts.configPath, (cfg) => ({
    ...cfg,
    rules: (cfg.rules ?? []).map((r) => {
      if (r.name !== opts.name) return r;
      // Remove the enabled field entirely (default is enabled)
      const { enabled: _, ...rest } = r;
      return rest;
    }),
  }));

  appendAuditEntry(opts.dataDir, {
    timestamp: new Date().toISOString(),
    actor: opts.actor ?? 'cli-user',
    action: 'enable',
    ruleId: opts.name,
  });

  return { success: true, message: `Rule "${opts.name}" enabled` };
}

export function disableRule(opts: RuleToggleOpts): RuleAuthoringResult {
  if (!opts.name) {
    return { success: false, message: 'Rule name is required' };
  }

  const repoRoot = dirname(opts.configPath);
  const { config } = loadConfigResult(repoRoot);
  const existing = config.rules ?? [];

  if (!existing.some((r) => r.name === opts.name)) {
    return { success: false, message: `Rule "${opts.name}" not found` };
  }

  atomicConfigWrite(opts.configPath, (cfg) => ({
    ...cfg,
    rules: (cfg.rules ?? []).map((r) =>
      r.name === opts.name ? { ...r, enabled: false } : r,
    ),
  }));

  appendAuditEntry(opts.dataDir, {
    timestamp: new Date().toISOString(),
    actor: opts.actor ?? 'cli-user',
    action: 'disable',
    ruleId: opts.name,
  });

  return { success: true, message: `Rule "${opts.name}" disabled` };
}

export function exportRules(opts: RuleExportOpts): RuleExportResult {
  const repoRoot = dirname(opts.configPath);
  const { config } = loadConfigResult(repoRoot);
  const rules = config.rules ?? [];

  const exportData = {
    version: 1,
    rules,
    exportedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(opts.outputPath), { recursive: true });
  writeFileSync(opts.outputPath, JSON.stringify(exportData, null, 2) + '\n', 'utf-8');

  return { exportPath: opts.outputPath, ruleCount: rules.length };
}

export function importRules(opts: RuleImportOpts): RuleImportResult {
  if (!opts.filePath) {
    return { imported: 0, skipped: 0, rejected: [{ index: -1, reason: 'File path is required' }] };
  }

  if (!existsSync(opts.filePath)) {
    return { imported: 0, skipped: 0, rejected: [{ index: -1, reason: 'Import file not found' }] };
  }

  let parsed: unknown;
  try {
    const raw = readFileSync(opts.filePath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch {
    return { imported: 0, skipped: 0, rejected: [{ index: -1, reason: 'Invalid JSON in import file' }] };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    !('rules' in parsed)
  ) {
    return { imported: 0, skipped: 0, rejected: [{ index: -1, reason: 'Invalid import format: missing version or rules' }] };
  }

  const doc = parsed as { version: unknown; rules: unknown };
  if (doc.version !== 1) {
    return { imported: 0, skipped: 0, rejected: [{ index: -1, reason: `Unsupported version: ${String(doc.version)}` }] };
  }

  if (!Array.isArray(doc.rules)) {
    return { imported: 0, skipped: 0, rejected: [{ index: -1, reason: 'Invalid import format: rules must be an array' }] };
  }

  const repoRoot = dirname(opts.configPath);
  const { config } = loadConfigResult(repoRoot);
  const existingNames = new Set((config.rules ?? []).map((r) => r.name));

  const toImport: RuleDef[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  let skipped = 0;

  for (let i = 0; i < doc.rules.length; i++) {
    const raw = doc.rules[i] as Record<string, unknown>;

    // Validate required fields
    if (!raw || typeof raw !== 'object') {
      rejected.push({ index: i, reason: 'Not an object' });
      continue;
    }
    if (typeof raw.name !== 'string' || !raw.name) {
      rejected.push({ index: i, reason: 'Missing or invalid name' });
      continue;
    }
    if (typeof raw.type !== 'string' || !raw.type) {
      rejected.push({ index: i, reason: 'Missing or invalid type' });
      continue;
    }
    if (!raw.from || typeof raw.from !== 'object' || typeof (raw.from as Record<string, unknown>).pathGlob !== 'string') {
      rejected.push({ index: i, reason: 'Missing or invalid from.pathGlob' });
      continue;
    }
    if (!raw.to || typeof raw.to !== 'object' || typeof (raw.to as Record<string, unknown>).pathGlob !== 'string') {
      rejected.push({ index: i, reason: 'Missing or invalid to.pathGlob' });
      continue;
    }
    if (typeof raw.severity !== 'string' || !raw.severity) {
      rejected.push({ index: i, reason: 'Missing or invalid severity' });
      continue;
    }

    // Check for name collision
    if (existingNames.has(raw.name)) {
      skipped++;
      continue;
    }

    const rule: RuleDef = {
      name: raw.name,
      type: raw.type,
      from: { pathGlob: (raw.from as { pathGlob: string }).pathGlob },
      to: { pathGlob: (raw.to as { pathGlob: string }).pathGlob },
      severity: raw.severity,
      ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    };

    toImport.push(rule);
    existingNames.add(raw.name); // prevent duplicates within the import batch
  }

  if (toImport.length > 0) {
    atomicConfigWrite(opts.configPath, (cfg) => ({
      ...cfg,
      rules: [...(cfg.rules ?? []), ...toImport],
    }));

    for (const rule of toImport) {
      appendAuditEntry(opts.dataDir, {
        timestamp: new Date().toISOString(),
        actor: opts.actor ?? 'cli-user',
        action: 'import',
        ruleId: rule.name,
        details: `type=${rule.type}, from=${rule.from.pathGlob}, to=${rule.to.pathGlob}`,
      });
    }
  }

  return { imported: toImport.length, skipped, rejected };
}
