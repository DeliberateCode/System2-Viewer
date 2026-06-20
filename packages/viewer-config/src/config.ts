import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_GIT_HISTORY_DEPTH,
  DEFAULT_SYMBOL_BACKEND,
  DEFAULT_SQLITE_PAGE_SIZE,
  DEFAULT_SQLITE_CACHE_SIZE,
  DEFAULT_SQLITE_MMAP_SIZE,
  DEFAULT_SQLITE_BUSY_TIMEOUT,
  DEFAULT_WORKER_MIN_FILES,
} from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SqliteConfig {
  pageSize?: number;
  cacheSize?: number;
  mmapSize?: number;
  busyTimeout?: number;
}

export interface ViewerConfig {
  version: 1;
  repository: {
    name?: string;
    exclude?: string[];
  };
  indexing: {
    gitHistoryDepth: number;
    /**
     * Symbol extraction backend.
     * - 'treesitter': Fast, syntax-level extraction via tree-sitter WASM.
     * - 'lsp': TypeScript compiler API for type-aware extraction (same cross-file resolution).
     * - 'scip': Reserved for future SCIP index support.
     */
    symbolBackend: 'treesitter' | 'lsp' | 'scip';
    workspaceDepth?: number;
    workspaceMaxRepos?: number;
    workerCount?: number;
    workerMinFiles?: number;
    sqlite?: SqliteConfig;
  };
  subsystems?: Array<{ id: string; name: string; paths: string[] }>;
  rules?: RuleDef[];
  claimTypes?: ClaimTypeDef[];
  frameworkHints?: FrameworkHintDef[];
  moduleBoundaries?: BoundaryDef[];
  topologyHints?: TopologyHintDef[];
  remote: {
    enabled: boolean;
  };
}

export interface RecipeDef {
  recipeType: string;
  description: string;
}

export interface ClaimTypeDef {
  id: string;
  displayTemplate: string;
  defaultVerificationRecipes?: RecipeDef[];
  evidenceRequirements?: string[];
  severity?: 'low' | 'medium' | 'high';
}

export interface RuleDef {
  name: string;
  type: string;
  from: { pathGlob: string };
  to: { pathGlob: string };
  severity: string;
  enabled?: boolean;
}

export interface FrameworkHintDef {
  pattern: string;
  framework: string;
  entrypointKind: string;
  excludePaths?: string[];
}

export interface BoundaryDef {
  name: string;
  paths: string[];
  publicInterface: string[];
  allowedDependencies?: string[];
}

export type TopologyDirection = 'publish' | 'subscribe' | 'request' | 'respond';

export interface TopologyHintDef {
  source: string;
  sink: string;
  channel: string;
  transport: string;
  direction: TopologyDirection;
}

export interface ConfigIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ConfigResult {
  config: ViewerConfig;
  issues: ConfigIssue[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultConfig(): ViewerConfig {
  return {
    version: 1,
    repository: {},
    indexing: {
      gitHistoryDepth: DEFAULT_GIT_HISTORY_DEPTH,
      symbolBackend: DEFAULT_SYMBOL_BACKEND,
      workerMinFiles: DEFAULT_WORKER_MIN_FILES,
      sqlite: {
        pageSize: DEFAULT_SQLITE_PAGE_SIZE,
        cacheSize: DEFAULT_SQLITE_CACHE_SIZE,
        mmapSize: DEFAULT_SQLITE_MMAP_SIZE,
        busyTimeout: DEFAULT_SQLITE_BUSY_TIMEOUT,
      },
    },
    remote: { enabled: false },
  };
}

// ---------------------------------------------------------------------------
// Schema validation (internal)
// Runtime validation must match config-schema.json. See
// __tests__/config-schema-sync.test.ts for drift detection.
// ---------------------------------------------------------------------------

const VALID_SYMBOL_BACKENDS = new Set<string>(['treesitter', 'lsp', 'scip']);

// Reserved names — prevent user-defined collisions.
// Most are reservation-only. 'boundary-violation' is also seeded in
// kind_registry because the system generates claims of this type.
export const BUILT_IN_CLAIM_TYPES = new Set<string>([
  'file-defines-symbol',
  'file-defines-symbols',
  'package-imports-package',
  'directory-derived-subsystem-hypothesis',
  'subsystem-owns-file',
  'likely-entrypoint',
  'boundary-violation',
]);

function validateSchema(raw: unknown): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ path: '', message: 'Config must be a JSON object', severity: 'error' });
    return issues;
  }

  const obj = raw as Record<string, unknown>;

  // version
  if (!('version' in obj)) {
    issues.push({ path: 'version', message: 'Missing required field "version"', severity: 'error' });
  } else if (obj.version !== 1) {
    issues.push({ path: 'version', message: 'Unsupported version; expected 1', severity: 'error' });
  }

  // repository
  if ('repository' in obj && obj.repository !== undefined) {
    if (typeof obj.repository !== 'object' || obj.repository === null || Array.isArray(obj.repository)) {
      issues.push({ path: 'repository', message: '"repository" must be an object', severity: 'error' });
    } else {
      const repo = obj.repository as Record<string, unknown>;
      if ('name' in repo && repo.name !== undefined && typeof repo.name !== 'string') {
        issues.push({ path: 'repository.name', message: '"repository.name" must be a string', severity: 'error' });
      }
      if ('exclude' in repo && repo.exclude !== undefined) {
        if (!Array.isArray(repo.exclude)) {
          issues.push({ path: 'repository.exclude', message: '"repository.exclude" must be an array', severity: 'error' });
        } else if (!repo.exclude.every((e: unknown) => typeof e === 'string')) {
          issues.push({ path: 'repository.exclude', message: '"repository.exclude" entries must be strings', severity: 'error' });
        }
      }
    }
  }

  // indexing
  if ('indexing' in obj && obj.indexing !== undefined) {
    if (typeof obj.indexing !== 'object' || obj.indexing === null || Array.isArray(obj.indexing)) {
      issues.push({ path: 'indexing', message: '"indexing" must be an object', severity: 'error' });
    } else {
      const idx = obj.indexing as Record<string, unknown>;
      if ('gitHistoryDepth' in idx && idx.gitHistoryDepth !== undefined) {
        if (typeof idx.gitHistoryDepth !== 'number' || !Number.isInteger(idx.gitHistoryDepth) || idx.gitHistoryDepth < 0) {
          issues.push({ path: 'indexing.gitHistoryDepth', message: '"indexing.gitHistoryDepth" must be a non-negative integer', severity: 'error' });
        }
      }
      if ('symbolBackend' in idx && idx.symbolBackend !== undefined) {
        if (typeof idx.symbolBackend !== 'string' || !VALID_SYMBOL_BACKENDS.has(idx.symbolBackend)) {
          issues.push({ path: 'indexing.symbolBackend', message: '"indexing.symbolBackend" must be one of: treesitter, lsp, scip', severity: 'error' });
        }
      }
      if ('workspaceDepth' in idx && idx.workspaceDepth !== undefined) {
        if (typeof idx.workspaceDepth !== 'number' || !Number.isInteger(idx.workspaceDepth) || idx.workspaceDepth < 1) {
          issues.push({ path: 'indexing.workspaceDepth', message: '"indexing.workspaceDepth" must be a positive integer', severity: 'error' });
        }
      }
      if ('workspaceMaxRepos' in idx && idx.workspaceMaxRepos !== undefined) {
        if (typeof idx.workspaceMaxRepos !== 'number' || !Number.isInteger(idx.workspaceMaxRepos) || idx.workspaceMaxRepos < 1) {
          issues.push({ path: 'indexing.workspaceMaxRepos', message: '"indexing.workspaceMaxRepos" must be a positive integer', severity: 'error' });
        }
      }
      if ('workerCount' in idx && idx.workerCount !== undefined) {
        if (typeof idx.workerCount !== 'number' || !Number.isInteger(idx.workerCount) || idx.workerCount < 1 || idx.workerCount > 16) {
          issues.push({ path: 'indexing.workerCount', message: '"indexing.workerCount" must be an integer between 1 and 16', severity: 'warning' });
        }
      }
      if ('workerMinFiles' in idx && idx.workerMinFiles !== undefined) {
        if (typeof idx.workerMinFiles !== 'number' || !Number.isInteger(idx.workerMinFiles) || idx.workerMinFiles < 1) {
          issues.push({ path: 'indexing.workerMinFiles', message: '"indexing.workerMinFiles" must be a positive integer', severity: 'warning' });
        }
      }
      if ('sqlite' in idx && idx.sqlite !== undefined) {
        if (typeof idx.sqlite !== 'object' || idx.sqlite === null || Array.isArray(idx.sqlite)) {
          issues.push({ path: 'indexing.sqlite', message: '"indexing.sqlite" must be an object', severity: 'warning' });
        }
      }
    }
  }

  // subsystems
  if ('subsystems' in obj && obj.subsystems !== undefined) {
    if (!Array.isArray(obj.subsystems)) {
      issues.push({ path: 'subsystems', message: '"subsystems" must be an array', severity: 'error' });
    } else {
      for (let i = 0; i < obj.subsystems.length; i++) {
        const s = obj.subsystems[i] as unknown;
        if (typeof s !== 'object' || s === null || Array.isArray(s)) {
          issues.push({ path: `subsystems[${i}]`, message: 'Subsystem entry must be an object', severity: 'error' });
          continue;
        }
        const sub = s as Record<string, unknown>;
        if (typeof sub.id !== 'string') {
          issues.push({ path: `subsystems[${i}].id`, message: '"id" must be a string', severity: 'error' });
        }
        if (typeof sub.name !== 'string') {
          issues.push({ path: `subsystems[${i}].name`, message: '"name" must be a string', severity: 'error' });
        }
        if (!Array.isArray(sub.paths) || !sub.paths.every((p: unknown) => typeof p === 'string')) {
          issues.push({ path: `subsystems[${i}].paths`, message: '"paths" must be an array of strings', severity: 'error' });
        }
      }
    }
  }

  // rules
  if ('rules' in obj && obj.rules !== undefined) {
    if (!Array.isArray(obj.rules)) {
      issues.push({ path: 'rules', message: '"rules" must be an array', severity: 'error' });
    } else {
      for (let i = 0; i < obj.rules.length; i++) {
        const r = obj.rules[i] as unknown;
        if (typeof r !== 'object' || r === null || Array.isArray(r)) {
          issues.push({ path: `rules[${i}]`, message: 'Rule entry must be an object', severity: 'error' });
          continue;
        }
        const rule = r as Record<string, unknown>;
        if (typeof rule.name !== 'string') {
          issues.push({ path: `rules[${i}].name`, message: '"name" must be a string', severity: 'error' });
        }
        if (typeof rule.type !== 'string') {
          issues.push({ path: `rules[${i}].type`, message: '"type" must be a string', severity: 'error' });
        }
      }
    }
  }

  // claimTypes
  if ('claimTypes' in obj && obj.claimTypes !== undefined) {
    if (!Array.isArray(obj.claimTypes)) {
      issues.push({ path: 'claimTypes', message: '"claimTypes" must be an array', severity: 'error' });
    } else {
      for (let i = 0; i < obj.claimTypes.length; i++) {
        const c = obj.claimTypes[i] as unknown;
        if (typeof c !== 'object' || c === null || Array.isArray(c)) {
          issues.push({ path: `claimTypes[${i}]`, message: 'ClaimType entry must be an object', severity: 'warning' });
          continue;
        }
        const ct = c as Record<string, unknown>;
        if (typeof ct.id !== 'string') {
          issues.push({ path: `claimTypes[${i}].id`, message: '"id" must be a string', severity: 'warning' });
        } else if (BUILT_IN_CLAIM_TYPES.has(ct.id)) {
          issues.push({ path: `claimTypes[${i}].id`, message: `Claim type "${ct.id}" collides with a built-in type`, severity: 'error' });
        }
        if (typeof ct.displayTemplate !== 'string') {
          issues.push({ path: `claimTypes[${i}].displayTemplate`, message: '"displayTemplate" must be a string', severity: 'warning' });
        }
      }
    }
  }

  // frameworkHints
  if ('frameworkHints' in obj && obj.frameworkHints !== undefined) {
    if (!Array.isArray(obj.frameworkHints)) {
      issues.push({ path: 'frameworkHints', message: '"frameworkHints" must be an array', severity: 'error' });
    } else {
      for (let i = 0; i < obj.frameworkHints.length; i++) {
        const h = obj.frameworkHints[i] as unknown;
        if (typeof h !== 'object' || h === null || Array.isArray(h)) {
          issues.push({ path: `frameworkHints[${i}]`, message: 'FrameworkHint entry must be an object', severity: 'warning' });
          continue;
        }
        const hint = h as Record<string, unknown>;
        if (typeof hint.pattern !== 'string' || hint.pattern.length === 0) {
          issues.push({ path: `frameworkHints[${i}].pattern`, message: '"pattern" must be a non-empty string', severity: 'error' });
        }
        if (typeof hint.framework !== 'string' || hint.framework.length === 0) {
          issues.push({ path: `frameworkHints[${i}].framework`, message: '"framework" must be a non-empty string', severity: 'error' });
        }
        if (typeof hint.entrypointKind !== 'string' || hint.entrypointKind.length === 0) {
          issues.push({ path: `frameworkHints[${i}].entrypointKind`, message: '"entrypointKind" must be a non-empty string', severity: 'error' });
        }
        if ('excludePaths' in hint && hint.excludePaths !== undefined) {
          if (!Array.isArray(hint.excludePaths) || !hint.excludePaths.every((p: unknown) => typeof p === 'string')) {
            issues.push({ path: `frameworkHints[${i}].excludePaths`, message: '"excludePaths" must be an array of strings', severity: 'warning' });
          }
        }
      }
    }
  }

  // moduleBoundaries
  if ('moduleBoundaries' in obj && obj.moduleBoundaries !== undefined) {
    if (!Array.isArray(obj.moduleBoundaries)) {
      issues.push({ path: 'moduleBoundaries', message: '"moduleBoundaries" must be an array', severity: 'error' });
    } else {
      const seenNames = new Set<string>();
      for (let i = 0; i < obj.moduleBoundaries.length; i++) {
        const b = obj.moduleBoundaries[i] as unknown;
        if (typeof b !== 'object' || b === null || Array.isArray(b)) {
          issues.push({ path: `moduleBoundaries[${i}]`, message: 'Boundary entry must be an object', severity: 'error' });
          continue;
        }
        const bnd = b as Record<string, unknown>;
        if (typeof bnd.name !== 'string' || bnd.name.length === 0) {
          issues.push({ path: `moduleBoundaries[${i}].name`, message: '"name" must be a non-empty string', severity: 'error' });
        } else if ((bnd.name as string).includes(':')) {
          issues.push({ path: `moduleBoundaries[${i}].name`, message: '"name" must not contain colons (reserved for rule pattern syntax)', severity: 'error' });
        } else if (seenNames.has(bnd.name)) {
          issues.push({ path: `moduleBoundaries[${i}].name`, message: `Duplicate boundary name "${bnd.name}"`, severity: 'error' });
        } else {
          seenNames.add(bnd.name);
        }
        if (!Array.isArray(bnd.paths) || bnd.paths.length === 0 || !bnd.paths.every((p: unknown) => typeof p === 'string')) {
          issues.push({ path: `moduleBoundaries[${i}].paths`, message: '"paths" must be a non-empty array of strings', severity: 'error' });
        }
        if (!Array.isArray(bnd.publicInterface) || bnd.publicInterface.length === 0 || !bnd.publicInterface.every((p: unknown) => typeof p === 'string')) {
          issues.push({ path: `moduleBoundaries[${i}].publicInterface`, message: '"publicInterface" must be a non-empty array of strings', severity: 'error' });
        }
        if ('allowedDependencies' in bnd && bnd.allowedDependencies !== undefined) {
          if (!Array.isArray(bnd.allowedDependencies) || !bnd.allowedDependencies.every((d: unknown) => typeof d === 'string')) {
            issues.push({ path: `moduleBoundaries[${i}].allowedDependencies`, message: '"allowedDependencies" must be an array of strings', severity: 'warning' });
          }
        }
      }
    }
  }

  // topologyHints
  if ('topologyHints' in obj && obj.topologyHints !== undefined) {
    const VALID_DIRECTIONS = new Set(['publish', 'subscribe', 'request', 'respond']);
    if (!Array.isArray(obj.topologyHints)) {
      issues.push({ path: 'topologyHints', message: '"topologyHints" must be an array', severity: 'error' });
    } else {
      for (let i = 0; i < obj.topologyHints.length; i++) {
        const t = obj.topologyHints[i] as unknown;
        if (typeof t !== 'object' || t === null || Array.isArray(t)) {
          issues.push({ path: `topologyHints[${i}]`, message: 'TopologyHint entry must be an object', severity: 'error' });
          continue;
        }
        const hint = t as Record<string, unknown>;
        if (typeof hint.source !== 'string' || hint.source.length === 0) {
          issues.push({ path: `topologyHints[${i}].source`, message: '"source" must be a non-empty string', severity: 'error' });
        }
        if (typeof hint.sink !== 'string' || hint.sink.length === 0) {
          issues.push({ path: `topologyHints[${i}].sink`, message: '"sink" must be a non-empty string', severity: 'error' });
        }
        if (typeof hint.channel !== 'string' || hint.channel.length === 0) {
          issues.push({ path: `topologyHints[${i}].channel`, message: '"channel" must be a non-empty string', severity: 'error' });
        }
        if (typeof hint.transport !== 'string' || hint.transport.length === 0) {
          issues.push({ path: `topologyHints[${i}].transport`, message: '"transport" must be a non-empty string', severity: 'error' });
        }
        if (typeof hint.direction !== 'string' || !VALID_DIRECTIONS.has(hint.direction)) {
          issues.push({ path: `topologyHints[${i}].direction`, message: '"direction" must be one of: publish, subscribe, request, respond', severity: 'error' });
        }
      }
    }
  }

  // remote
  if ('remote' in obj && obj.remote !== undefined) {
    if (typeof obj.remote !== 'object' || obj.remote === null || Array.isArray(obj.remote)) {
      issues.push({ path: 'remote', message: '"remote" must be an object', severity: 'error' });
    } else {
      const rem = obj.remote as Record<string, unknown>;
      if ('enabled' in rem && typeof rem.enabled !== 'boolean') {
        issues.push({ path: 'remote.enabled', message: '"remote.enabled" must be a boolean', severity: 'error' });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Config string sanitization (internal)
// ---------------------------------------------------------------------------

function sanitizeConfigString(value: string, maxLen = 256): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// SQLite config merge helper (internal)
// ---------------------------------------------------------------------------

function isValidPageSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 512 && v <= 65536 && (v & (v - 1)) === 0;
}

function mergeSqliteConfig(raw: unknown): SqliteConfig {
  const result: SqliteConfig = {
    pageSize: DEFAULT_SQLITE_PAGE_SIZE,
    cacheSize: DEFAULT_SQLITE_CACHE_SIZE,
    mmapSize: DEFAULT_SQLITE_MMAP_SIZE,
    busyTimeout: DEFAULT_SQLITE_BUSY_TIMEOUT,
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result;
  const obj = raw as Record<string, unknown>;
  if (isValidPageSize(obj.pageSize)) {
    result.pageSize = obj.pageSize;
  }
  if (typeof obj.cacheSize === 'number' && Number.isInteger(obj.cacheSize)) {
    result.cacheSize = obj.cacheSize;
  }
  if (typeof obj.mmapSize === 'number' && Number.isInteger(obj.mmapSize) && obj.mmapSize >= 0) {
    result.mmapSize = obj.mmapSize;
  }
  if (typeof obj.busyTimeout === 'number' && Number.isInteger(obj.busyTimeout) && obj.busyTimeout >= 0) {
    result.busyTimeout = obj.busyTimeout;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Merge raw config onto defaults (internal)
// ---------------------------------------------------------------------------

function mergeDefaults(raw: Record<string, unknown>): ViewerConfig {
  const defaults = defaultConfig();

  // repository
  if (typeof raw.repository === 'object' && raw.repository !== null && !Array.isArray(raw.repository)) {
    const repo = raw.repository as Record<string, unknown>;
    if (typeof repo.name === 'string') defaults.repository.name = repo.name;
    if (Array.isArray(repo.exclude) && repo.exclude.every((e: unknown) => typeof e === 'string')) {
      defaults.repository.exclude = repo.exclude as string[];
    }
  }

  // indexing
  if (typeof raw.indexing === 'object' && raw.indexing !== null && !Array.isArray(raw.indexing)) {
    const idx = raw.indexing as Record<string, unknown>;
    if (typeof idx.gitHistoryDepth === 'number' && Number.isInteger(idx.gitHistoryDepth) && idx.gitHistoryDepth >= 0) {
      defaults.indexing.gitHistoryDepth = idx.gitHistoryDepth;
    }
    if (typeof idx.symbolBackend === 'string' && VALID_SYMBOL_BACKENDS.has(idx.symbolBackend)) {
      defaults.indexing.symbolBackend = idx.symbolBackend as ViewerConfig['indexing']['symbolBackend'];
    }
    if (typeof idx.workspaceDepth === 'number' && Number.isInteger(idx.workspaceDepth) && idx.workspaceDepth >= 1) {
      defaults.indexing.workspaceDepth = idx.workspaceDepth;
    }
    if (typeof idx.workspaceMaxRepos === 'number' && Number.isInteger(idx.workspaceMaxRepos) && idx.workspaceMaxRepos >= 1) {
      defaults.indexing.workspaceMaxRepos = idx.workspaceMaxRepos;
    }
    if (typeof idx.workerCount === 'number' && Number.isInteger(idx.workerCount) && idx.workerCount >= 1 && idx.workerCount <= 16) {
      defaults.indexing.workerCount = idx.workerCount;
    }
    if (typeof idx.workerMinFiles === 'number' && Number.isInteger(idx.workerMinFiles) && idx.workerMinFiles >= 1) {
      defaults.indexing.workerMinFiles = idx.workerMinFiles;
    } else {
      defaults.indexing.workerMinFiles = DEFAULT_WORKER_MIN_FILES;
    }
    defaults.indexing.sqlite = mergeSqliteConfig(idx.sqlite);
  }

  // subsystems
  if (Array.isArray(raw.subsystems)) {
    const valid: Array<{ id: string; name: string; paths: string[] }> = [];
    for (const s of raw.subsystems) {
      if (
        typeof s === 'object' && s !== null && !Array.isArray(s) &&
        typeof (s as Record<string, unknown>).id === 'string' &&
        typeof (s as Record<string, unknown>).name === 'string' &&
        Array.isArray((s as Record<string, unknown>).paths) &&
        ((s as Record<string, unknown>).paths as unknown[]).every((p: unknown) => typeof p === 'string')
      ) {
        valid.push(s as { id: string; name: string; paths: string[] });
      }
    }
    if (valid.length > 0) defaults.subsystems = valid;
  }

  // rules
  if (Array.isArray(raw.rules)) {
    const valid: RuleDef[] = [];
    for (const r of raw.rules) {
      if (
        typeof r === 'object' && r !== null && !Array.isArray(r) &&
        typeof (r as Record<string, unknown>).name === 'string' &&
        typeof (r as Record<string, unknown>).type === 'string'
      ) {
        const rule = r as Record<string, unknown>;
        valid.push({
          name: rule.name as string,
          type: rule.type as string,
          from: typeof rule.from === 'object' && rule.from !== null && typeof (rule.from as Record<string, unknown>).pathGlob === 'string'
            ? { pathGlob: (rule.from as Record<string, unknown>).pathGlob as string }
            : { pathGlob: '**' },
          to: typeof rule.to === 'object' && rule.to !== null && typeof (rule.to as Record<string, unknown>).pathGlob === 'string'
            ? { pathGlob: (rule.to as Record<string, unknown>).pathGlob as string }
            : { pathGlob: '**' },
          severity: typeof rule.severity === 'string' ? rule.severity : 'warning',
          ...(typeof rule.enabled === 'boolean' ? { enabled: rule.enabled } : {}),
        });
      }
    }
    if (valid.length > 0) defaults.rules = valid;
  }

  // claimTypes
  if (Array.isArray(raw.claimTypes)) {
    const valid: ClaimTypeDef[] = [];
    for (const c of raw.claimTypes) {
      if (
        typeof c === 'object' && c !== null && !Array.isArray(c) &&
        typeof (c as Record<string, unknown>).id === 'string' &&
        typeof (c as Record<string, unknown>).displayTemplate === 'string' &&
        !BUILT_IN_CLAIM_TYPES.has((c as Record<string, unknown>).id as string)
      ) {
        const ct = c as Record<string, unknown>;
        const entry: ClaimTypeDef = {
          id: ct.id as string,
          displayTemplate: ct.displayTemplate as string,
        };
        if (Array.isArray(ct.defaultVerificationRecipes)) {
          const recipes: RecipeDef[] = [];
          for (const r of ct.defaultVerificationRecipes) {
            if (
              typeof r === 'object' && r !== null && !Array.isArray(r) &&
              typeof (r as Record<string, unknown>).recipeType === 'string' &&
              typeof (r as Record<string, unknown>).description === 'string'
            ) {
              recipes.push({
                recipeType: (r as Record<string, unknown>).recipeType as string,
                description: (r as Record<string, unknown>).description as string,
              });
            }
          }
          if (recipes.length > 0) entry.defaultVerificationRecipes = recipes;
        }
        if (
          Array.isArray(ct.evidenceRequirements) &&
          (ct.evidenceRequirements as unknown[]).every((e: unknown) => typeof e === 'string')
        ) {
          entry.evidenceRequirements = ct.evidenceRequirements as string[];
        }
        if (ct.severity === 'low' || ct.severity === 'medium' || ct.severity === 'high') {
          entry.severity = ct.severity;
        }
        valid.push(entry);
      }
    }
    if (valid.length > 0) defaults.claimTypes = valid;
  }

  // frameworkHints
  if (Array.isArray(raw.frameworkHints)) {
    const valid: FrameworkHintDef[] = [];
    for (const h of raw.frameworkHints) {
      if (
        typeof h === 'object' && h !== null && !Array.isArray(h) &&
        typeof (h as Record<string, unknown>).pattern === 'string' && (h as Record<string, unknown>).pattern !== '' &&
        typeof (h as Record<string, unknown>).framework === 'string' && (h as Record<string, unknown>).framework !== '' &&
        typeof (h as Record<string, unknown>).entrypointKind === 'string' && (h as Record<string, unknown>).entrypointKind !== ''
      ) {
        const hint = h as Record<string, unknown>;
        const entry: FrameworkHintDef = {
          pattern: sanitizeConfigString(hint.pattern as string),
          framework: sanitizeConfigString(hint.framework as string),
          entrypointKind: sanitizeConfigString(hint.entrypointKind as string),
        };
        if (entry.pattern === '' || entry.framework === '' || entry.entrypointKind === '') continue;
        if (Array.isArray(hint.excludePaths) && hint.excludePaths.every((p: unknown) => typeof p === 'string')) {
          entry.excludePaths = (hint.excludePaths as string[]).map((p) => sanitizeConfigString(p, 512));
        }
        valid.push(entry);
      }
    }
    if (valid.length > 0) defaults.frameworkHints = valid;
  }

  // moduleBoundaries
  if (Array.isArray(raw.moduleBoundaries)) {
    const valid: BoundaryDef[] = [];
    const seenNames = new Set<string>();
    for (const b of raw.moduleBoundaries) {
      if (
        typeof b === 'object' && b !== null && !Array.isArray(b) &&
        typeof (b as Record<string, unknown>).name === 'string' && (b as Record<string, unknown>).name !== '' &&
        Array.isArray((b as Record<string, unknown>).paths) && ((b as Record<string, unknown>).paths as unknown[]).length > 0 &&
        ((b as Record<string, unknown>).paths as unknown[]).every((p: unknown) => typeof p === 'string') &&
        Array.isArray((b as Record<string, unknown>).publicInterface) && ((b as Record<string, unknown>).publicInterface as unknown[]).length > 0 &&
        ((b as Record<string, unknown>).publicInterface as unknown[]).every((p: unknown) => typeof p === 'string')
      ) {
        const bnd = b as Record<string, unknown>;
        const name = sanitizeConfigString(bnd.name as string);
        if (name === '') continue;
        if (seenNames.has(name)) continue;
        seenNames.add(name);
        const entry: BoundaryDef = {
          name,
          paths: (bnd.paths as string[]).map((p) => sanitizeConfigString(p, 512)),
          publicInterface: (bnd.publicInterface as string[]).map((p) => sanitizeConfigString(p, 512)),
        };
        if (Array.isArray(bnd.allowedDependencies) && bnd.allowedDependencies.every((d: unknown) => typeof d === 'string')) {
          entry.allowedDependencies = (bnd.allowedDependencies as string[]).map((d) => sanitizeConfigString(d));
        }
        valid.push(entry);
      }
    }
    if (valid.length > 0) defaults.moduleBoundaries = valid;
  }

  // topologyHints
  if (Array.isArray(raw.topologyHints)) {
    const VALID_DIRECTIONS = new Set(['publish', 'subscribe', 'request', 'respond']);
    const valid: TopologyHintDef[] = [];
    for (const t of raw.topologyHints) {
      if (
        typeof t === 'object' && t !== null && !Array.isArray(t) &&
        typeof (t as Record<string, unknown>).source === 'string' && (t as Record<string, unknown>).source !== '' &&
        typeof (t as Record<string, unknown>).sink === 'string' && (t as Record<string, unknown>).sink !== '' &&
        typeof (t as Record<string, unknown>).channel === 'string' && (t as Record<string, unknown>).channel !== '' &&
        typeof (t as Record<string, unknown>).transport === 'string' && (t as Record<string, unknown>).transport !== '' &&
        typeof (t as Record<string, unknown>).direction === 'string' &&
        VALID_DIRECTIONS.has((t as Record<string, unknown>).direction as string)
      ) {
        const hint = t as Record<string, unknown>;
        const entry = {
          source: sanitizeConfigString(hint.source as string, 512),
          sink: sanitizeConfigString(hint.sink as string, 512),
          channel: sanitizeConfigString(hint.channel as string),
          transport: sanitizeConfigString(hint.transport as string),
          direction: hint.direction as TopologyDirection,
        };
        if (entry.source === '' || entry.sink === '' || entry.channel === '' || entry.transport === '') continue;
        valid.push(entry);
      }
    }
    if (valid.length > 0) defaults.topologyHints = valid;
  }

  // remote -- always default false; only apply if explicitly set to true
  if (typeof raw.remote === 'object' && raw.remote !== null && !Array.isArray(raw.remote)) {
    const rem = raw.remote as Record<string, unknown>;
    if (rem.enabled === true) {
      defaults.remote.enabled = true;
    }
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// Parse JSON (internal, never eval)
// ---------------------------------------------------------------------------

function parseConfig(text: string): { parsed: unknown; error?: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    return { parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { parsed: undefined, error: `Malformed JSON: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lenient config loading. Returns safe defaults on missing, malformed, or
 * invalid config.
 */
export function loadConfig(repoRoot: string): ViewerConfig {
  return loadConfigResult(repoRoot).config;
}

/**
 * Strict config loading. Returns the loaded config AND structured validation
 * issues.
 */
export function loadConfigResult(repoRoot: string): ConfigResult {
  const configPath = path.join(repoRoot, 'viewer.config.json');
  const issues: ConfigIssue[] = [];

  // Try to read the file
  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf-8');
  } catch {
    // Missing file is not an error -- just return defaults
    return { config: defaultConfig(), issues: [] };
  }

  // Parse JSON
  const { parsed, error } = parseConfig(text);
  if (error !== undefined) {
    issues.push({ path: '', message: error, severity: 'error' });
    return { config: defaultConfig(), issues };
  }

  // Validate schema
  const schemaIssues = validateSchema(parsed);
  issues.push(...schemaIssues);

  // If there are errors, return defaults
  const hasErrors = issues.some((i) => i.severity === 'error');
  if (hasErrors) {
    return { config: defaultConfig(), issues };
  }

  // Merge onto defaults
  const config = mergeDefaults(parsed as Record<string, unknown>);

  // Dual-source: module-boundaries.json fallback
  if (!config.moduleBoundaries) {
    const mbPath = path.join(repoRoot, 'module-boundaries.json');
    try {
      const mbText = fs.readFileSync(mbPath, 'utf-8');
      const mbParsed: unknown = JSON.parse(mbText);
      if (Array.isArray(mbParsed)) {
        const mbIssues = validateBoundaryArray(mbParsed);
        issues.push(...mbIssues.map((i) => ({ ...i, path: `module-boundaries.json:${i.path}` })));
        if (!mbIssues.some((i) => i.severity === 'error')) {
          const merged = mergeDefaults({ moduleBoundaries: mbParsed } as Record<string, unknown>);
          config.moduleBoundaries = merged.moduleBoundaries;
        }
      } else {
        issues.push({ path: 'module-boundaries.json', message: 'File must contain a JSON array of boundary definitions', severity: 'warning' });
      }
    } catch {
      // File doesn't exist or is malformed — silently proceed
    }
  } else {
    // Config has moduleBoundaries — check if external file also exists and warn
    const mbPath = path.join(repoRoot, 'module-boundaries.json');
    try {
      fs.accessSync(mbPath, fs.constants.R_OK);
      issues.push({ path: 'module-boundaries.json', message: 'module-boundaries.json found but moduleBoundaries in viewer.config.json takes precedence', severity: 'warning' });
    } catch {
      // No external file — no warning needed
    }
  }

  return { config, issues };
}

function validateBoundaryArray(arr: unknown[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      issues.push({ path: `[${i}]`, message: 'Boundary entry must be an object', severity: 'error' });
      continue;
    }
    const bnd = b as Record<string, unknown>;
    if (typeof bnd.name !== 'string' || bnd.name.length === 0) {
      issues.push({ path: `[${i}].name`, message: '"name" must be a non-empty string', severity: 'error' });
    } else if ((bnd.name as string).includes(':')) {
      issues.push({ path: `[${i}].name`, message: '"name" must not contain colons (reserved for rule pattern syntax)', severity: 'error' });
    } else if (seenNames.has(bnd.name)) {
      issues.push({ path: `[${i}].name`, message: `Duplicate boundary name "${bnd.name}"`, severity: 'error' });
    } else {
      seenNames.add(bnd.name);
    }
    if (!Array.isArray(bnd.paths) || bnd.paths.length === 0 || !bnd.paths.every((p: unknown) => typeof p === 'string')) {
      issues.push({ path: `[${i}].paths`, message: '"paths" must be a non-empty array of strings', severity: 'error' });
    }
    if (!Array.isArray(bnd.publicInterface) || bnd.publicInterface.length === 0 || !bnd.publicInterface.every((p: unknown) => typeof p === 'string')) {
      issues.push({ path: `[${i}].publicInterface`, message: '"publicInterface" must be a non-empty array of strings', severity: 'error' });
    }
    if ('allowedDependencies' in bnd && bnd.allowedDependencies !== undefined) {
      if (!Array.isArray(bnd.allowedDependencies) || !bnd.allowedDependencies.every((d: unknown) => typeof d === 'string')) {
        issues.push({ path: `[${i}].allowedDependencies`, message: '"allowedDependencies" must be an array of strings', severity: 'warning' });
      }
    }
  }
  return issues;
}
