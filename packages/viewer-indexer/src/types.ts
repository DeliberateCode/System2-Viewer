import type { ConfidenceBand, Epistemic } from '@system2-viewer/viewer-core';

/** File entry discovered during walk. */
export interface WalkEntry {
  relativePath: string;
  absolutePath: string;
  /** Modification time in milliseconds (from lstat). */
  mtimeMs: number;
  /** File size in bytes (from lstat). */
  size: number;
}

/** Symbol extracted from a source file. */
export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'method' | 'lambda' | 'other';
  exported: boolean;
  startLine: number;
  endLine: number;
  metadata?: Record<string, unknown>;
}

/** Import declaration extracted from a source file. */
export interface ImportInfo {
  specifier: string;
  names: string[];
  isTypeOnly: boolean;
  line: number;
}

/** Result of symbol extraction for a single file. */
export interface ExtractionResult {
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  language: string;
  partial: boolean;
  partialReason?: string;
}

/** Resolved import edge between files. */
export interface ResolvedImport {
  fromFileId: string;
  toFileId: string;
  specifier: string;
  names: string[];
  confidence: ConfidenceBand;
  epistemic: Epistemic;
}

/** Git co-change entry. */
export interface CoChangeEntry {
  fileA: string;
  fileB: string;
  commitHash: string;
  commitDate: string;
  coChangeCount: number;
}

/** Git commit info. */
export interface GitCommitInfo {
  hash: string;
  date: string;
  filesChanged: string[];
}

/** Subsystem candidate produced by inference. */
export interface SubsystemCandidate {
  id: string;
  name: string;
  paths: string[];
  source: 'directory' | 'package' | 'co-change' | 'config';
  confidence: ConfidenceBand;
}

/** Package metadata for rule inference. */
export interface PackageMetadata {
  name: string;
  path: string;
  dependencies: string[];
  devDependencies: string[];
}

/** Observed import between packages. */
export interface ObservedImport {
  fromPackage: string;
  toPackage: string;
  fromFile: string;
  toFile: string;
}

/** Inferred layer rule candidate (public export). */
export interface InferredLayerRuleCandidate {
  name: string;
  type: string;
  from: { pathGlob: string };
  to: { pathGlob: string };
  severity: string;
  evidenceIds: string[];
  knownExceptions: string[];
}

/** Partiality entry for a single scope. */
export interface PartialityEntry {
  scope: string;
  extracted: string[];
  failed: string[];
  skipped: string[];
}

/** File classification result. */
export type FileClass =
  | 'source'
  | 'test'
  | 'config'
  | 'doc'
  | 'asset'
  | 'generated'
  | 'other';

/** Root marker detection result. */
export interface RootMarker {
  marker: string;
  kind: 'package' | 'tsconfig' | 'git' | 'config' | 'other';
}

/** Backend selection result. */
export interface BackendSelection {
  backend: string;
  degraded: boolean;
  reason?: string;
}

/** Workspace discovery result. */
export interface WorkspaceDiscoveryResult {
  mode: 'auto' | 'force' | 'off';
  repositories: Array<{
    root: string;
    name: string;
  }>;
  bounded: boolean;
  boundReason?: string;
}
