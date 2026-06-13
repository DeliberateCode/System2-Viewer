import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import picomatch from 'picomatch';
import {
  stableKey,
  deriveRepositoryId,
  NULL_LOGGER,
  DEFAULT_GIT_HISTORY_DEPTH,
} from '@system2-viewer/viewer-core';
import type { Logger } from '@system2-viewer/viewer-core';
import { detectLanguage } from './grammar-registry.js';
import type {
  ModelStore,
  SnapshotTxn,
  NodeRow,
  EdgeRow,
  EvidenceRow,
} from '@system2-viewer/viewer-store';
import { walkFiles } from './walk.js';
import { extractSymbols } from './extract.js';
import { resolveImports } from './resolve-imports.js';
import { mineGitHistory } from './git.js';
import { inferSubsystems } from './subsystems.js';
import { generateClaims } from './claims.js';
import { classifyFile } from './classify.js';
import { scrubSecrets } from './secret-scrub.js';
import { GlobalSymbolMap } from './global-symbol-map.js';
import { selectSymbolBackend } from './backend-select.js';
import { TsLanguageServiceAdapter } from './ts-backend.js';
import { discoverWorkspace } from './workspace.js';
import { composeEmbeddingText } from './embedder.js';
import type { Embedder } from './embedder.js';
import { hashFileContent, computeStatDiff } from './incremental.js';
import type { IncrementalDiff, StatFingerprint } from './incremental.js';
import { detectRenames } from './rename-detect.js';
import { WorkerPool, resolveWorkerPoolConfig } from './worker-pool.js';
import type { ExtractionTask, WorkerPoolConfig } from './worker-pool.js';
import type {
  PartialityEntry,
  SymbolInfo,
  ImportInfo,
  PackageMetadata,
  WalkEntry,
  BackendSelection,
  CoChangeEntry,
  ResolvedImport,
  SubsystemCandidate,
} from './types.js';
import { NullProgressReporter } from './progress.js';
import type { ProgressReporter } from './progress.js';
import {
  fileNodeId,
  symbolNodeId,
  directoryNodeId,
  edgeId,
  gitEvidenceId,
  subsystemNodeId,
  packageNodeId,
  partialityRowId,
} from './id-gen.js';

/**
 * Scrub secrets from a nullable JSON string field.
 * Passes null through unchanged. Accumulates secret counts into the
 * provided mutable counter so callers don't need per-site bookkeeping.
 */
function scrubJsonField(json: string | null, counter: { total: number }): string | null {
  if (json === null) return null;
  const result = scrubSecrets(json);
  counter.total += result.secretsFound;
  return result.scrubbed;
}

/** Parameters for the shared per-file symbol processing helper. */
interface FileSymbolProcessingParams {
  relativePath: string;
  fileId: string;
  language: string | null;
  symbols: SymbolInfo[];
  provenanceMethod: string;
  repositoryId: string;
  revision: string;
  now: string;
  txn: SnapshotTxn;
  scrubCounter: { total: number };
}

/**
 * Shared helper that creates symbol nodes, defines edges, and FTS entries
 * for a single file's extraction results.
 *
 * Used by both the sequential and parallel extraction paths to eliminate
 * duplicated node/edge/FTS creation logic.
 *
 * @returns The number of content-level secrets scrubbed during FTS insertion.
 */
function processFileSymbols(params: FileSymbolProcessingParams): number {
  const {
    relativePath, fileId, language, symbols, provenanceMethod,
    repositoryId, revision, now, txn, scrubCounter,
  } = params;
  let secretsScrubbed = 0;

  // Insert FTS text for the file node (scrub secrets from text)
  {
    const ftsRaw = `${basename(relativePath)} ${relativePath}`;
    const ftsScrub = scrubSecrets(ftsRaw);
    secretsScrubbed += ftsScrub.secretsFound;
    txn.insertFtsText({
      objectId: fileId,
      objectType: 'file',
      text: ftsScrub.scrubbed,
      path: relativePath,
    });
  }

  // Create symbol nodes and defines edges
  for (const sym of symbols) {
    const symId = symbolNodeId(repositoryId, relativePath, sym.name);
    const symbolNode: NodeRow = {
      id: symId,
      kind: 'symbol',
      stableKey: stableKey('symbol', repositoryId, relativePath, sym.name),
      displayName: scrubJsonField(sym.name, scrubCounter),
      repositoryId,
      path: relativePath,
      language,
      fileClass: null,
      provenanceMethod,
      extractor: 'viewer-indexer',
      metadataJson: scrubJsonField(JSON.stringify({
        kind: sym.kind,
        exported: sym.exported,
        startLine: sym.startLine,
        endLine: sym.endLine,
        ...sym.metadata,
      }), scrubCounter),
      validFromRevision: revision,
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    };
    txn.upsertNode(symbolNode);

    const definesEdge: EdgeRow = {
      id: edgeId('defines', fileId, sym.name),
      kind: 'defines',
      epistemic: 'static',
      fromNodeId: fileId,
      toNodeId: symId,
      repositoryId,
      confidenceBand: 'high',
      provenanceMethod,
      extractor: 'viewer-indexer',
      evidenceIdsJson: null,
      metadataJson: scrubJsonField(JSON.stringify({ exported: sym.exported }), scrubCounter),
      validFromRevision: revision,
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    };
    txn.upsertEdge(definesEdge);

    // Insert FTS text for the symbol node (scrub secrets from text)
    {
      const symScrub = scrubSecrets(sym.name);
      secretsScrubbed += symScrub.secretsFound;
      txn.insertFtsText({
        objectId: symId,
        objectType: 'symbol',
        text: symScrub.scrubbed,
        path: relativePath,
      });
    }
  }

  return secretsScrubbed;
}

/** Config shape the Indexer needs. The caller provides this (e.g. from viewer-config). */
interface TopologyHintInput {
  source: string;
  sink: string;
  channel: string;
  transport: string;
  direction: string;
}

interface IndexerConfig {
  gitHistoryDepth: number;
  symbolBackend: string;
  excludes: string[];
  topologyHints?: TopologyHintInput[];
}

/** Structural type for exclude matchers. Provided by the caller. */
interface ExcludeMatcher {
  isExcluded(path: string): boolean;
}

/** Mutable pipeline state threaded through stage methods. */
interface PipelineCtx {
  readonly repoRoot: string;
  readonly revision: string;
  readonly generationId: string;
  readonly repositoryId: string;
  readonly now: string;
  readonly pipelineStart: number;
  readonly reporter: ProgressReporter;
  readonly TOTAL_STAGES: number;
  readonly txn: SnapshotTxn;
  readonly partiality: PartialityEntry[];
  readonly scrubCounter: { total: number };
  totalSecretsScrubbed: number;
  readonly files: WalkEntry[];
  readonly fileNodes: NodeRow[];
  readonly fileMap: Map<string, string>;
  readonly entryPointFileIds: string[];
  readonly symbolsByFile: Map<string, SymbolInfo[]>;
  readonly importsByFile: Map<string, { relativePath: string; imports: ImportInfo[] }>;
  readonly fileContentHashes: Map<string, string>;
  readonly skipExtraction: Set<string>;
  readonly storedHashesForRename: Map<string, string>;
  readonly tsBackendEnrichedFiles: Set<string>;
  incrementalDiff?: IncrementalDiff;
  coChanges: CoChangeEntry[];
  resolvedImports: ResolvedImport[];
  subsystems: SubsystemCandidate[];
}

/** Actionable hints for known pipeline stage failures. */
const STAGE_HINTS: Record<string, string> = {
  'File Discovery': 'Check that the repository path exists and is readable.',
  'Symbol Extraction': 'Try running `viewer doctor` to check grammar availability.',
  'TS Backend Enrichment': 'The TypeScript compiler API may have encountered an issue. Try `symbolBackend: "treesitter"` in viewer.config.json.',
  'Import Resolution': 'Import resolution depends on file discovery. Ensure all source files are accessible.',
  'Git History Mining': 'Ensure `git` is installed and the directory is a git repository.',
  'Subsystem Inference': 'Subsystem inference requires file and edge data. If earlier stages failed, this stage may also fail.',
  'Claim Generation': 'Claim generation depends on extracted symbols and edges. Check earlier stage results.',
  'Embedding Generation': 'Check that `onnxruntime-node` is installed and the embedding model is available. Run `viewer doctor` for details.',
  'Secret Scrubbing': 'Secret scrubbing encountered an unexpected error. The model may contain unscrubbed data.',
  'Store Commit': 'Check disk space and write permissions for the data directory. The database may be locked by another process.',
};

/**
 * Wraps an error thrown during a pipeline stage with the stage name,
 * preserving the original error as `cause`.  Appends an actionable
 * hint when one is available for the stage.
 */
function wrapStageError(stageName: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const hint = STAGE_HINTS[stageName];
  const suffix = hint ? ` ${hint}` : '';
  return new Error(`Indexing failed at stage "${stageName}": ${message}${suffix}`, { cause: err });
}

/**
 * Indexer class that orchestrates all indexing pipeline stages.
 *
 * Pipeline stages:
 *   1. File discovery (walk)
 *   2. Workspace discovery
 *   3. Tree-sitter extraction
 *   4. Optional TS language service
 *   5. Import resolution
 *   6. Git history mining
 *   7. Subsystem inference
 *   8. Claim generation
 *   9. Rule inference
 *  10. Partiality tracking
 */
export class Indexer {
  private store: ModelStore;
  private config: IndexerConfig;
  private excludeMatcher: ExcludeMatcher;
  private embedder: Embedder | null = null;
  private logger: Logger;

  constructor(
    store: ModelStore,
    config?: IndexerConfig,
    excludeMatcher?: ExcludeMatcher,
    logger?: Logger,
  ) {
    this.store = store;
    this.config = config ?? {
      gitHistoryDepth: DEFAULT_GIT_HISTORY_DEPTH,
      symbolBackend: 'treesitter',
      excludes: [],
    };
    this.excludeMatcher = excludeMatcher ?? { isExcluded: () => false };
    this.logger = logger ?? NULL_LOGGER;
  }

  setEmbedder(embedder: Embedder | null): void {
    this.embedder = embedder;
  }

  setConfig(config: Partial<IndexerConfig>): void {
    if (config.gitHistoryDepth !== undefined) {
      this.config.gitHistoryDepth = config.gitHistoryDepth;
    }
    if (config.symbolBackend !== undefined) {
      this.config.symbolBackend = config.symbolBackend;
    }
    if (config.excludes !== undefined) {
      this.config.excludes = config.excludes;
    }
  }

  setExcludeMatcher(matcher: ExcludeMatcher): void {
    this.excludeMatcher = matcher;
  }

  /**
   * Run the full indexing pipeline on a repository.
   *
   * Opens a SnapshotTxn, writes all discovered data to the store,
   * and commits. Tracks partiality for every stage that can fail or skip.
   */
  async index(input: {
    repoRoot: string;
    depth?: number;
    full?: boolean;
    workspace?: 'auto' | 'force' | 'off';
    workspaceDepth?: number;
    workspaceMaxRepos?: number;
    skipEmbed?: boolean;
    repositoryName?: string;
    progress?: ProgressReporter;
    workerCount?: number;
    workerMinFiles?: number;
  }): Promise<{ revision: string; incremental?: IncrementalDiff }> {
    const { repoRoot } = input;
    if (hasTraversalSegment(repoRoot)) {
      throw new Error(
        `repoRoot must not contain ".." path segments: ${repoRoot}`,
      );
    }

    this.logger.info('Indexing started', { repoRoot });

    const reporter: ProgressReporter = input.progress ?? new NullProgressReporter();
    const TOTAL_STAGES = 10;
    const pipelineStart = Date.now();
    const revision = `rev::${Date.now()}::${randomUUID().slice(0, 8)}`;
    const generationId = `gen::${randomUUID()}`;
    const repositoryId = deriveRepositoryId(repoRoot, input.repositoryName);
    const now = new Date().toISOString();

    // Stage 1: File discovery
    let files: WalkEntry[];
    try {
      files = this.executeFileDiscovery(repoRoot, reporter, pipelineStart, TOTAL_STAGES);
    } catch (err) {
      throw wrapStageError('File Discovery', err);
    }

    // Stage 2: Incremental diff
    const ctx: PipelineCtx = {
      repoRoot, revision, generationId, repositoryId, now,
      pipelineStart, reporter, TOTAL_STAGES,
      txn: null!,  // set after beginSnapshot
      partiality: [],
      scrubCounter: { total: 0 },
      totalSecretsScrubbed: 0,
      files,
      fileNodes: [],
      fileMap: new Map(),
      entryPointFileIds: [],
      symbolsByFile: new Map(),
      importsByFile: new Map(),
      fileContentHashes: new Map(),
      skipExtraction: new Set(),
      storedHashesForRename: new Map(),
      tsBackendEnrichedFiles: new Set(),
      coChanges: [],
      resolvedImports: [],
      subsystems: [],
    };
    try {
      this.executeIncrementalDiff(ctx, !!input.full);
    } catch (err) {
      throw wrapStageError('Incremental Diff', err);
    }

    // Workspace discovery
    const workspaceResult = discoverWorkspace(
      repoRoot,
      input.workspace ?? 'auto',
      { maxDepth: input.workspaceDepth, maxRepos: input.workspaceMaxRepos },
    );

    // Backend selection
    const backendResult = selectSymbolBackend(this.config.symbolBackend);
    if (backendResult.degraded) {
      ctx.partiality.push({
        scope: 'backend',
        extracted: [backendResult.backend],
        failed: [],
        skipped: [this.config.symbolBackend],
      });
    }

    let tsBackend: TsLanguageServiceAdapter | null = null;
    if (backendResult.backend === 'lsp') {
      tsBackend = new TsLanguageServiceAdapter();
      if (!tsBackend.initialize().ok) {
        tsBackend = null;
        ctx.partiality.push({
          scope: 'ts-backend', extracted: [], failed: [],
          skipped: ['typescript-language-service'],
        });
      }
    }

    // Open transaction
    const txn = this.store.beginSnapshot(revision);
    (ctx as { txn: SnapshotTxn }).txn = txn;

    try {
      // Insert revision and repository node, set up FTS strategy
      try {
        this.initializeTransaction(ctx, workspaceResult, backendResult);
      } catch (err) {
        throw wrapStageError('Transaction Init', err);
      }

      // Create file nodes and contains edges
      try {
        this.createFileNodes(ctx);
      } catch (err) {
        throw wrapStageError('File Node Creation', err);
      }

      // Detect entrypoints declared in project manifests (pyproject.toml, etc.)
      this.detectProjectEntrypoints(ctx);

      // Stage 3+4: Symbol extraction (parallel or sequential)
      const poolConfig = resolveWorkerPoolConfig({
        workerCount: input.workerCount,
        workerMinFiles: input.workerMinFiles,
      });
      const useWorkerPool = files.length >= poolConfig.workerMinFiles && poolConfig.workerCount > 1;

      try {
        if (useWorkerPool) {
          await this.executeParallelExtraction(ctx, tsBackend, backendResult, poolConfig);
        } else {
          await this.executeSymbolExtraction(ctx, tsBackend);
        }
        this.reportSymbolExtraction(ctx);
      } catch (err) {
        throw wrapStageError('Symbol Extraction', err);
      }

      // Stage 5: Import resolution
      try {
        this.executeImportResolution(ctx);
      } catch (err) {
        throw wrapStageError('Import Resolution', err);
      }

      // Stage 6: Git history mining
      const gitDepth = input.depth ?? this.config.gitHistoryDepth ?? DEFAULT_GIT_HISTORY_DEPTH;
      try {
        this.executeGitHistoryMining(ctx, gitDepth);
      } catch (err) {
        throw wrapStageError('Git History Mining', err);
      }

      // Stage 7: Subsystem inference
      try {
        this.executeSubsystemInference(ctx);
      } catch (err) {
        throw wrapStageError('Subsystem Inference', err);
      }

      // Stage 7.5: Topology hint edge creation
      if (this.config.topologyHints && this.config.topologyHints.length > 0) {
        try {
          this.executeTopologyHints(ctx);
        } catch (err) {
          throw wrapStageError('Topology Hint Resolution', err);
        }
      }

      // Stage 8: Claim generation
      try {
        this.executeClaimGeneration(ctx);
      } catch (err) {
        throw wrapStageError('Claim Generation', err);
      }

      // Stage 9: Embedding generation
      try {
        await this.executeEmbeddingGeneration(ctx, !!input.skipEmbed);
      } catch (err) {
        throw wrapStageError('Embedding Generation', err);
      }

      // Stage 10: Store commit (file hashes, partiality, intervals, commit)
      try {
        this.executeStoreCommit(ctx);
      } catch (err) {
        throw wrapStageError('Store Commit', err);
      }

      this.logger.info('Indexing completed', { revision, repoRoot });
      return { revision, incremental: ctx.incrementalDiff };
    } catch (err) {
      this.logger.error('Indexing failed', { repoRoot, error: err instanceof Error ? err.message : String(err) });
      txn.abort();
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Private stage methods
  // ---------------------------------------------------------------------------

  private executeFileDiscovery(
    repoRoot: string,
    reporter: ProgressReporter,
    pipelineStart: number,
    totalStages: number,
  ): WalkEntry[] {
    const files = walkFiles(repoRoot, this.excludeMatcher);
    reporter.stage(1, totalStages, 'File Discovery', files.length, 'files', Date.now() - pipelineStart);
    return files;
  }

  private executeIncrementalDiff(ctx: PipelineCtx, full: boolean): void {
    if (full) return;

    const currentStats = new Map<string, StatFingerprint>();
    for (const file of ctx.files) {
      currentStats.set(file.relativePath, { mtimeMs: file.mtimeMs, size: file.size });
    }

    const storedStats = new Map<string, StatFingerprint | null>();
    const storedPaths = new Set<string>();
    if (typeof this.store.read === 'function') {
      const readHandle = this.store.read();
      try {
        for (const file of ctx.files) {
          const stored = readHandle.getFileHash(file.relativePath, ctx.repositoryId);
          if (stored) {
            storedPaths.add(stored.path);
            ctx.storedHashesForRename.set(stored.path, stored.hash);
            if (stored.mtimeMs != null && stored.size != null) {
              storedStats.set(stored.path, { mtimeMs: stored.mtimeMs, size: stored.size });
            } else {
              storedStats.set(stored.path, null);
            }
          }
        }
      } finally {
        readHandle.close();
      }
    }

    if (storedStats.size > 0) {
      ctx.incrementalDiff = computeStatDiff(currentStats, storedStats, storedPaths);
      for (const path of ctx.incrementalDiff.unchanged) {
        ctx.skipExtraction.add(path);
      }
    }
  }

  private initializeTransaction(
    ctx: PipelineCtx,
    workspaceResult: { mode: string },
    backendResult: BackendSelection,
  ): void {
    const { txn, revision, repositoryId, now, repoRoot, scrubCounter } = ctx;

    txn.insertRevision({
      id: revision,
      repositoryId,
      kind: 'working_tree',
      parentId: null,
      committedAt: null,
      indexedAt: now,
      historyBounded: 0,
    });

    // FTS strategy: in full mode, clear all FTS rows and rebuild.
    // In incremental mode, delete FTS only for changed/removed files.
    if (!ctx.incrementalDiff) {
      txn.clearFtsForRepository(repositoryId);
    } else {
      for (const filePath of ctx.incrementalDiff.changed) {
        txn.deleteFtsForFile(filePath);
      }
      for (const filePath of ctx.incrementalDiff.removed) {
        txn.deleteFtsForFile(filePath);
      }
    }

    txn.upsertNode({
      id: revision,
      kind: 'repository',
      stableKey: stableKey('repository', repositoryId),
      displayName: scrubJsonField(basename(repoRoot), scrubCounter),
      repositoryId,
      path: null,
      language: null,
      fileClass: null,
      provenanceMethod: 'indexer::init',
      extractor: 'viewer-indexer',
      metadataJson: scrubJsonField(JSON.stringify({
        repoName: basename(repoRoot),
        workspace: workspaceResult.mode,
        backend: backendResult.backend,
      }), scrubCounter),
      validFromRevision: revision,
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private createFileNodes(ctx: PipelineCtx): void {
    const { files, repositoryId, revision, now, txn, scrubCounter } = ctx;

    // Collect unique directory paths from the file list.
    const dirPaths = new Set<string>();
    for (const file of files) {
      let dir = dirname(file.relativePath);
      while (dir !== '.') {
        if (dirPaths.has(dir)) break;
        dirPaths.add(dir);
        dir = dirname(dir);
      }
    }

    // Emit directory nodes and hierarchical containment edges.
    for (const dir of dirPaths) {
      const dId = directoryNodeId(repositoryId, dir);
      const parent = dirname(dir);
      const parentId = parent === '.' ? revision : directoryNodeId(repositoryId, parent);

      txn.upsertNode({
        id: dId,
        kind: 'directory',
        stableKey: stableKey('directory', repositoryId, dir),
        displayName: scrubJsonField(basename(dir), scrubCounter),
        repositoryId,
        path: dir,
        language: null,
        fileClass: null,
        provenanceMethod: 'indexer::walk',
        extractor: 'viewer-indexer',
        metadataJson: null,
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });

      txn.upsertEdge({
        id: edgeId('contains', repositoryId, dir),
        kind: 'contains',
        epistemic: 'static',
        fromNodeId: parentId,
        toNodeId: dId,
        repositoryId,
        confidenceBand: 'high',
        provenanceMethod: 'indexer::walk',
        extractor: 'viewer-indexer',
        evidenceIdsJson: null,
        metadataJson: null,
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Emit file nodes with containment under their parent directory.
    for (const file of files) {
      const fId = fileNodeId(repositoryId, file.relativePath);
      const fileClass = classifyFile(file.relativePath);
      const detectedLang = detectLanguage(file.relativePath);
      const language = detectedLang === 'unknown' ? null : detectedLang;
      const parentDir = dirname(file.relativePath);
      const parentId = parentDir === '.' ? revision : directoryNodeId(repositoryId, parentDir);

      ctx.fileMap.set(file.relativePath, fId);

      const fileNode: NodeRow = {
        id: fId,
        kind: 'file',
        stableKey: stableKey('file', repositoryId, file.relativePath),
        displayName: scrubJsonField(basename(file.relativePath), scrubCounter),
        repositoryId,
        path: file.relativePath,
        language,
        fileClass,
        provenanceMethod: 'indexer::walk',
        extractor: 'viewer-indexer',
        metadataJson: null,
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      };
      ctx.fileNodes.push(fileNode);
      txn.upsertNode(fileNode);

      txn.upsertEdge({
        id: edgeId('contains', repositoryId, file.relativePath),
        kind: 'contains',
        epistemic: 'static',
        fromNodeId: parentId,
        toNodeId: fId,
        repositoryId,
        confidenceBand: 'high',
        provenanceMethod: 'indexer::walk',
        extractor: 'viewer-indexer',
        evidenceIdsJson: null,
        metadataJson: null,
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      });

      if (isLikelyEntrypoint(file.relativePath)) {
        ctx.entryPointFileIds.push(fId);
      }
    }
  }

  /**
   * Parse project manifests (pyproject.toml) for declared entrypoints and
   * resolve them to already-indexed files.
   */
  private detectProjectEntrypoints(ctx: PipelineCtx): void {
    const pyprojectPath = join(ctx.repoRoot, 'pyproject.toml');
    let content: string;
    try {
      content = readFileSync(pyprojectPath, 'utf-8');
    } catch {
      return;
    }

    const entrypoints = parsePyprojectScripts(content);
    if (entrypoints.length === 0) return;

    // Resolve "package.module:func" to a relative file path.
    // Check both flat layout (package/module.py) and src layout (src/package/module.py).
    for (const ep of entrypoints) {
      const moduleParts = ep.module.split('.');
      moduleParts[moduleParts.length - 1] += '.py';
      const candidates = [
        moduleParts.join('/'),
        'src/' + moduleParts.join('/'),
      ];

      for (const candidate of candidates) {
        const fId = ctx.fileMap.get(candidate);
        if (fId && !ctx.entryPointFileIds.includes(fId)) {
          ctx.entryPointFileIds.push(fId);
          break;
        }
      }
    }
  }

  private async executeSymbolExtraction(
    ctx: PipelineCtx,
    tsBackend: TsLanguageServiceAdapter | null,
  ): Promise<void> {
    const {
      files, fileMap, skipExtraction, fileContentHashes,
      repositoryId, revision, now, txn, scrubCounter, partiality,
      symbolsByFile, importsByFile,
    } = ctx;

    for (const file of files) {
      const fId = fileMap.get(file.relativePath)!;
      const detectedLang = detectLanguage(file.relativePath);
      const language = detectedLang === 'unknown' ? null : detectedLang;

      if (skipExtraction.has(file.relativePath)) continue;

      let content: string;
      try {
        content = readFileSync(file.absolutePath, 'utf-8');
      } catch {
        partiality.push({
          scope: file.relativePath,
          extracted: ['file-node'],
          failed: ['content-read'],
          skipped: [],
        });
        continue;
      }

      if (!fileContentHashes.has(file.relativePath)) {
        fileContentHashes.set(file.relativePath, hashFileContent(content));
      }

      let symbols: SymbolInfo[] = [];
      let fileImports: ImportInfo[] = [];
      let usedTsBackend = false;

      if (tsBackend && (language === 'typescript' || language === 'javascript')) {
        const tsResult = tsBackend.extractSymbols(file.absolutePath, content);
        if (tsResult) {
          symbols = tsResult.symbols;
          fileImports = tsResult.imports;
          usedTsBackend = true;
        }
      }

      if (!usedTsBackend) {
        const result = await extractSymbols(file.absolutePath, content, language ?? undefined);
        symbols = result.symbols;
        fileImports = result.imports;

        if (result.partial) {
          partiality.push({
            scope: file.relativePath,
            extracted: ['file-node'],
            failed: [],
            skipped: ['symbol-extraction'],
          });
        }
      }

      symbolsByFile.set(fId, symbols);
      importsByFile.set(fId, { relativePath: file.relativePath, imports: fileImports });

      ctx.totalSecretsScrubbed += processFileSymbols({
        relativePath: file.relativePath, fileId: fId, language, symbols,
        provenanceMethod: usedTsBackend ? 'indexer::ts-backend' : 'indexer::extract',
        repositoryId, revision, now, txn, scrubCounter,
      });
    }
  }

  private async executeParallelExtraction(
    ctx: PipelineCtx,
    tsBackend: TsLanguageServiceAdapter | null,
    backendResult: BackendSelection,
    poolConfig: WorkerPoolConfig,
  ): Promise<void> {
    const {
      files, fileMap, skipExtraction, fileContentHashes, repoRoot,
      repositoryId, revision, now, txn, scrubCounter, partiality,
      symbolsByFile, importsByFile,
    } = ctx;

    const tasks: ExtractionTask[] = [];
    const absoluteToRelative = new Map<string, string>();
    const tsFileContents = new Map<string, string>();

    for (const file of files) {
      if (skipExtraction.has(file.relativePath)) continue;

      let content: string;
      try {
        content = readFileSync(file.absolutePath, 'utf-8');
      } catch {
        partiality.push({
          scope: file.relativePath,
          extracted: ['file-node'],
          failed: ['content-read'],
          skipped: [],
        });
        continue;
      }

      if (!fileContentHashes.has(file.relativePath)) {
        fileContentHashes.set(file.relativePath, hashFileContent(content));
      }

      const detectedLang = detectLanguage(file.relativePath);
      const language = detectedLang === 'unknown' ? undefined : detectedLang;
      tasks.push({ filePath: file.absolutePath, content, language });
      absoluteToRelative.set(file.absolutePath, file.relativePath);

      if (tsBackend && (language === 'typescript' || language === 'javascript')) {
        tsFileContents.set(file.relativePath, content);
      }
    }

    // Dispatch all tasks to worker pool
    const pool = new WorkerPool(poolConfig.workerCount);
    await pool.start();
    const rawResults = await pool.processAll(tasks).finally(() => pool.shutdown());

    // Sort by filePath for deterministic ordering
    rawResults.sort((a, b) => a.filePath.localeCompare(b.filePath));

    // Process sorted results into nodes, edges, FTS
    for (const result of rawResults) {
      const relativePath = absoluteToRelative.get(result.filePath);
      if (!relativePath) continue;
      const fId = fileMap.get(relativePath);
      if (!fId) continue;
      const detectedLang = detectLanguage(relativePath);
      const language = detectedLang === 'unknown' ? null : detectedLang;

      if ('error' in result) {
        partiality.push({
          scope: relativePath,
          extracted: ['file-node'],
          failed: ['extraction'],
          skipped: [],
        });
        continue;
      }

      const symbols = result.symbols;
      const fileImports = result.imports;

      if (result.partial) {
        partiality.push({
          scope: relativePath,
          extracted: ['file-node'],
          failed: [],
          skipped: ['symbol-extraction'],
        });
      }

      symbolsByFile.set(fId, symbols);
      importsByFile.set(fId, { relativePath, imports: fileImports });

      ctx.totalSecretsScrubbed += processFileSymbols({
        relativePath, fileId: fId, language, symbols,
        provenanceMethod: 'indexer::extract',
        repositoryId, revision, now, txn, scrubCounter,
      });
    }

    // TSBackend enrichment pass
    this.executeTsBackendEnrichment(ctx, tsBackend, tsFileContents, backendResult);
  }

  private executeTsBackendEnrichment(
    ctx: PipelineCtx,
    tsBackend: TsLanguageServiceAdapter | null,
    tsFileContents: Map<string, string>,
    backendResult: BackendSelection,
  ): void {
    const { importsByFile, tsBackendEnrichedFiles, repoRoot, partiality } = ctx;

    if (tsBackend) {
      for (const [fId, entry] of importsByFile) {
        const lang = detectLanguage(entry.relativePath);
        if (lang !== 'typescript' && lang !== 'javascript') continue;
        const content = tsFileContents.get(entry.relativePath);
        if (!content) continue;
        const absolutePath = join(repoRoot, entry.relativePath);
        const tsResult = tsBackend.extractSymbols(absolutePath, content);
        if (tsResult && tsResult.imports.length > 0) {
          importsByFile.set(fId, { relativePath: entry.relativePath, imports: tsResult.imports });
          tsBackendEnrichedFiles.add(fId);
        }
      }
    } else if (backendResult.backend === 'lsp') {
      partiality.push({
        scope: 'parallel-ts-enrichment',
        extracted: [],
        failed: [],
        skipped: ['ts-backend-unavailable'],
      });
    }
  }

  private reportSymbolExtraction(ctx: PipelineCtx): void {
    let totalSymbols = 0;
    for (const syms of ctx.symbolsByFile.values()) totalSymbols += syms.length;
    ctx.reporter.stage(2, ctx.TOTAL_STAGES, 'Symbol Extraction', totalSymbols, 'symbols', Date.now() - ctx.pipelineStart);
  }

  private executeImportResolution(ctx: PipelineCtx): void {
    const {
      symbolsByFile, fileNodes, importsByFile, fileMap,
      tsBackendEnrichedFiles, repositoryId, revision, now, txn,
      scrubCounter, reporter, TOTAL_STAGES, pipelineStart,
    } = ctx;

    // Populate GlobalSymbolMap from extracted symbols
    const globalSymbolMap = new GlobalSymbolMap();
    for (const [fId, symbols] of symbolsByFile) {
      const fileNode = fileNodes.find(n => n.id === fId);
      const filePath = fileNode?.path;
      if (!filePath) continue;
      const lang = fileNode.language ?? 'unknown';
      for (const sym of symbols) {
        globalSymbolMap.register(sym.name, {
          nodeId: symbolNodeId(repositoryId, filePath, sym.name),
          filePath,
          exported: sym.exported,
          language: lang,
          kind: sym.kind,
        });
      }
    }

    const resolvedImports = resolveImports(importsByFile, fileMap, globalSymbolMap);
    ctx.resolvedImports = resolvedImports;
    reporter.stage(3, TOTAL_STAGES, 'Import Resolution', resolvedImports.length, 'imports', Date.now() - pipelineStart);

    for (const imp of resolvedImports) {
      let edgeEpistemic = imp.epistemic;
      let edgeConfidence = imp.confidence;
      if (tsBackendEnrichedFiles.has(imp.fromFileId)) {
        if (edgeEpistemic === 'inferred') edgeEpistemic = 'static';
        if (edgeConfidence === 'medium') edgeConfidence = 'high';
      }

      const importEdge: EdgeRow = {
        id: edgeId('imports', imp.fromFileId, imp.toFileId, imp.specifier),
        kind: 'imports',
        epistemic: edgeEpistemic,
        fromNodeId: imp.fromFileId,
        toNodeId: imp.toFileId,
        repositoryId,
        confidenceBand: edgeConfidence,
        provenanceMethod: 'indexer::resolve-imports',
        extractor: 'viewer-indexer',
        evidenceIdsJson: null,
        metadataJson: scrubJsonField(JSON.stringify({ specifier: imp.specifier, names: imp.names }), scrubCounter),
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      };
      txn.upsertEdge(importEdge);
    }
  }

  private executeGitHistoryMining(ctx: PipelineCtx, depth: number): void {
    const {
      repoRoot, fileMap, repositoryId, revision, now, txn,
      scrubCounter, reporter, TOTAL_STAGES, pipelineStart,
    } = ctx;

    const gitResult = mineGitHistory(repoRoot, depth);
    ctx.coChanges = gitResult.coChanges;
    reporter.stage(4, TOTAL_STAGES, 'Git History Mining', gitResult.commits.length, 'commits', Date.now() - pipelineStart);

    for (const commit of gitResult.commits) {
      const evRow: EvidenceRow = {
        id: gitEvidenceId(commit.hash),
        kind: 'git_commit',
        epistemic: 'observed',
        repositoryId,
        revision,
        path: null,
        startLine: null,
        endLine: null,
        contentHash: commit.hash,
        extractor: 'viewer-indexer::git',
        derivationLocality: 'local',
        actor: null,
        metadataJson: scrubJsonField(JSON.stringify({
          commitHash: commit.hash,
          date: commit.date,
          filesChanged: commit.filesChanged.length,
        }), scrubCounter),
        createdAt: now,
      };
      txn.appendEvidence(evRow);
    }

    for (const coChange of gitResult.coChanges) {
      const fileAId = fileMap.get(coChange.fileA);
      const fileBId = fileMap.get(coChange.fileB);
      if (!fileAId || !fileBId) continue;

      const coChangeEdge: EdgeRow = {
        id: edgeId('changed_with', fileAId, fileBId),
        kind: 'changed_with',
        epistemic: 'observed',
        fromNodeId: fileAId,
        toNodeId: fileBId,
        repositoryId,
        confidenceBand: coChange.coChangeCount >= 5 ? 'medium' : 'low',
        provenanceMethod: 'indexer::git',
        extractor: 'viewer-indexer',
        evidenceIdsJson: scrubJsonField(JSON.stringify([gitEvidenceId(coChange.commitHash)]), scrubCounter),
        metadataJson: scrubJsonField(JSON.stringify({ coChangeCount: coChange.coChangeCount }), scrubCounter),
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      };
      txn.upsertEdge(coChangeEdge);
    }
  }

  private executeSubsystemInference(ctx: PipelineCtx): void {
    const {
      repoRoot, files, fileNodes, repositoryId, revision, now, txn,
      scrubCounter, reporter, TOTAL_STAGES, pipelineStart,
    } = ctx;

    const packageMeta = discoverPackages(repoRoot, files.map((f) => f.relativePath));
    const subsystems = inferSubsystems(
      fileNodes,
      [],
      packageMeta,
      ctx.coChanges,
    );
    ctx.subsystems = subsystems;
    reporter.stage(5, TOTAL_STAGES, 'Subsystem Inference', subsystems.length, 'subsystems', Date.now() - pipelineStart);

    for (const sub of subsystems) {
      const subNodeId = subsystemNodeId(repositoryId, sub.id);
      const subNode: NodeRow = {
        id: subNodeId,
        kind: 'subsystem',
        stableKey: stableKey('subsystem', repositoryId, sub.id),
        displayName: scrubJsonField(sub.name, scrubCounter),
        repositoryId,
        path: null,
        language: null,
        fileClass: null,
        provenanceMethod: `indexer::subsystems::${sub.source}`,
        extractor: 'viewer-indexer',
        metadataJson: scrubJsonField(JSON.stringify({ paths: sub.paths, source: sub.source }), scrubCounter),
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      };
      txn.upsertNode(subNode);

      {
        const subFtsScrub = scrubSecrets(`${sub.name} ${sub.id}`);
        ctx.totalSecretsScrubbed += subFtsScrub.secretsFound;
        txn.insertFtsText({
          objectId: subNodeId,
          objectType: 'node',
          text: subFtsScrub.scrubbed,
          path: null,
        });
      }

      for (const fileNode of fileNodes) {
        if (!fileNode.path) continue;
        if (subsystemOwnsFile(sub.paths, fileNode.path)) {
          const ownsEdge: EdgeRow = {
            id: stableKey('edge', repositoryId, 'owns', subNodeId, fileNode.id),
            kind: 'owns',
            epistemic: 'inferred',
            fromNodeId: subNodeId,
            toNodeId: fileNode.id,
            repositoryId,
            confidenceBand: 'medium',
            provenanceMethod: 'subsystem-inference',
            extractor: 'viewer-indexer',
            evidenceIdsJson: null,
            metadataJson: null,
            validFromRevision: revision,
            validToRevision: null,
            createdAt: now,
            updatedAt: now,
          };
          txn.upsertEdge(ownsEdge);
        }
      }
    }

    // Package nodes
    for (const pkg of packageMeta) {
      const pkgNode: NodeRow = {
        id: packageNodeId(repositoryId, pkg.name),
        kind: 'package',
        stableKey: stableKey('package', repositoryId, pkg.name),
        displayName: scrubJsonField(pkg.name, scrubCounter),
        repositoryId,
        path: pkg.path,
        language: null,
        fileClass: null,
        provenanceMethod: 'indexer::package-discovery',
        extractor: 'viewer-indexer',
        metadataJson: scrubJsonField(JSON.stringify({
          dependencies: pkg.dependencies,
          devDependencies: pkg.devDependencies,
        }), scrubCounter),
        validFromRevision: revision,
        validToRevision: null,
        createdAt: now,
        updatedAt: now,
      };
      txn.upsertNode(pkgNode);
    }
  }

  private executeTopologyHints(ctx: PipelineCtx): void {
    const hints = this.config.topologyHints;
    if (!hints || hints.length === 0) return;

    const { txn, repositoryId, revision, now, fileMap, partiality } = ctx;
    let createdEdges = 0;
    let unresolvedCount = 0;

    for (const hint of hints) {
      const sourceMatcher = picomatch(hint.source, { dot: true });
      const sinkMatcher = picomatch(hint.sink, { dot: true });

      const sourceFiles: string[] = [];
      const sinkFiles: string[] = [];

      for (const [relPath, nodeId] of fileMap) {
        if (sourceMatcher(relPath)) sourceFiles.push(nodeId);
        if (sinkMatcher(relPath)) sinkFiles.push(nodeId);
      }

      if (sourceFiles.length === 0 || sinkFiles.length === 0) {
        unresolvedCount++;
        partiality.push({
          scope: `topology_hint:${hint.channel}`,
          extracted: [],
          failed: [`topology_hint_unresolved: source=${hint.source} (${sourceFiles.length} matches), sink=${hint.sink} (${sinkFiles.length} matches)`],
          skipped: [],
        });
        continue;
      }

      const MAX_EDGES_PER_HINT = 1000;
      const pairCount = sourceFiles.length * sinkFiles.length;
      if (pairCount > MAX_EDGES_PER_HINT) {
        this.logger.warn('Topology hint edge cap reached', {
          channel: hint.channel, sourceFiles: sourceFiles.length, sinkFiles: sinkFiles.length,
          would: pairCount, cap: MAX_EDGES_PER_HINT,
        });
        partiality.push({
          scope: `topology_hint:${hint.channel}`,
          extracted: [`${MAX_EDGES_PER_HINT} edges (capped)`],
          failed: [`cartesian product ${pairCount} exceeds cap ${MAX_EDGES_PER_HINT}`],
          skipped: [],
        });
      }

      let hintEdges = 0;
      for (const srcId of sourceFiles) {
        if (hintEdges >= MAX_EDGES_PER_HINT) break;
        for (const snkId of sinkFiles) {
          if (hintEdges >= MAX_EDGES_PER_HINT) break;
          const edgeId = `edge::${repositoryId}::event-flow::${srcId}::${snkId}::${hint.channel}`;
          txn.upsertEdge({
            id: edgeId,
            kind: 'event-flow',
            epistemic: 'declared',
            fromNodeId: srcId,
            toNodeId: snkId,
            repositoryId,
            confidenceBand: 'low',
            provenanceMethod: 'topology-hint',
            extractor: 'indexer::topology-hint',
            evidenceIdsJson: null,
            metadataJson: scrubSecrets(JSON.stringify({
              channel: hint.channel,
              transport: hint.transport,
              direction: hint.direction,
            })).scrubbed,
            validFromRevision: revision,
            validToRevision: null,
            createdAt: now,
            updatedAt: now,
          });
          hintEdges++;
          createdEdges++;
        }
      }
    }

    this.logger.info('Topology hints resolved', { total: hints.length, edges: createdEdges, unresolved: unresolvedCount });
  }

  private executeClaimGeneration(ctx: PipelineCtx): void {
    const {
      repositoryId, revision, generationId, now,
      fileNodes, symbolsByFile, entryPointFileIds,
      txn, scrubCounter, reporter, TOTAL_STAGES, pipelineStart,
    } = ctx;

    const claimResult = generateClaims({
      repositoryId,
      revision,
      generationId,
      timestamp: now,
      fileNodes,
      symbolsByFile,
      resolvedImports: ctx.resolvedImports,
      subsystems: ctx.subsystems,
      entryPointFileIds,
    });
    reporter.stage(6, TOTAL_STAGES, 'Claim Generation', claimResult.claims.length, 'claims', Date.now() - pipelineStart);

    for (const ev of claimResult.evidence) {
      if (ev.metadataJson) {
        const metaScrub = scrubSecrets(ev.metadataJson);
        ctx.totalSecretsScrubbed += metaScrub.secretsFound;
        ev.metadataJson = metaScrub.scrubbed;
      }
      txn.appendEvidence(ev);
    }

    for (const claim of claimResult.claims) {
      const stmtScrub = scrubSecrets(claim.statement);
      ctx.totalSecretsScrubbed += stmtScrub.secretsFound;
      claim.statement = stmtScrub.scrubbed;
      claim.scopeJson = scrubJsonField(claim.scopeJson, scrubCounter) ?? claim.scopeJson;
      claim.verificationRecipesJson = scrubJsonField(claim.verificationRecipesJson, scrubCounter) ?? claim.verificationRecipesJson;
      txn.versionClaim(claim);
    }
  }

  private async executeEmbeddingGeneration(ctx: PipelineCtx, skipEmbed: boolean): Promise<void> {
    const {
      fileNodes, symbolsByFile, repositoryId, now, txn,
      reporter, TOTAL_STAGES, pipelineStart, partiality,
    } = ctx;

    let embeddingCount = 0;
    if (this.embedder && !skipEmbed) {
      const embedder = this.embedder;
      let embeddingsFailed = false;
      try {
        const embeddingTasks: { nodeId: string; text: string }[] = [];

        for (const fileNode of fileNodes) {
          embeddingTasks.push({
            nodeId: fileNode.id,
            text: composeEmbeddingText({
              type: 'file',
              path: fileNode.path ?? fileNode.displayName ?? '',
              language: fileNode.language ?? 'unknown',
            }),
          });
        }

        for (const [fId, symbols] of symbolsByFile) {
          const fileNode = fileNodes.find(n => n.id === fId);
          const filePath = fileNode?.path ?? '';
          for (const sym of symbols) {
            embeddingTasks.push({
              nodeId: symbolNodeId(repositoryId, filePath, sym.name),
              text: composeEmbeddingText({
                type: 'symbol',
                displayName: sym.name,
                kind: sym.kind,
                path: filePath,
              }),
            });
          }
        }

        const BATCH_SIZE = 256;
        for (let offset = 0; offset < embeddingTasks.length; offset += BATCH_SIZE) {
          const batch = embeddingTasks.slice(offset, offset + BATCH_SIZE);
          const vectors = await embedder.embedBatch(batch.map(t => t.text));
          for (let i = 0; i < batch.length; i++) {
            const vector = vectors[i];
            if (!isZeroVector(vector)) {
              txn.upsertEmbedding({
                nodeId: batch[i].nodeId,
                modelName: embedder.modelName,
                dimension: embedder.dimension,
                vector: Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
                createdAt: now,
              });
              embeddingCount++;
            }
          }
        }
      } catch {
        embeddingsFailed = true;
      }
      if (embeddingsFailed) {
        partiality.push({
          scope: 'embeddings',
          extracted: [],
          failed: ['embedding-generation'],
          skipped: [],
        });
      }
    }
    reporter.stage(7, TOTAL_STAGES, 'Embedding Generation', embeddingCount, 'embeddings', Date.now() - pipelineStart);
  }

  private executeStoreCommit(ctx: PipelineCtx): void {
    const {
      files, fileMap, fileContentHashes, skipExtraction, storedHashesForRename,
      symbolsByFile, repositoryId, revision, now, txn, scrubCounter,
      partiality, reporter, TOTAL_STAGES, pipelineStart,
    } = ctx;

    // FTS count
    {
      let ftsCount = 0;
      for (const file of files) {
        if (!skipExtraction.has(file.relativePath)) ftsCount++;
      }
      for (const syms of symbolsByFile.values()) ftsCount += syms.length;
      reporter.stage(8, TOTAL_STAGES, 'FTS Population', ftsCount, 'entries', Date.now() - pipelineStart);
    }

    // Secret scrub accounting
    ctx.totalSecretsScrubbed += scrubCounter.total;
    if (ctx.totalSecretsScrubbed > 0) {
      partiality.push({
        scope: 'secret-scrubbing',
        extracted: [`${ctx.totalSecretsScrubbed} secrets scrubbed`],
        failed: [],
        skipped: [],
      });
    }
    reporter.stage(9, TOTAL_STAGES, 'Secret Scrubbing', ctx.totalSecretsScrubbed, 'secrets', Date.now() - pipelineStart);

    // Persist file hashes
    if (typeof txn.upsertFileHash === 'function') {
      for (const file of files) {
        const hash = fileContentHashes.get(file.relativePath);
        if (hash) {
          txn.upsertFileHash({
            path: file.relativePath,
            repositoryId,
            hash,
            revision,
            updatedAt: now,
            mtimeMs: file.mtimeMs,
            size: file.size,
          });
        } else if (skipExtraction.has(file.relativePath)) {
          const storedHash = storedHashesForRename.get(file.relativePath);
          if (storedHash) {
            txn.upsertFileHash({
              path: file.relativePath,
              repositoryId,
              hash: storedHash,
              revision,
              updatedAt: now,
              mtimeMs: file.mtimeMs,
              size: file.size,
            });
          }
        }
      }
    }

    // Incremental summary and rename detection
    if (ctx.incrementalDiff) {
      partiality.push({
        scope: 'incremental',
        extracted: [
          `${ctx.incrementalDiff.changed.length} changed`,
          `${ctx.incrementalDiff.added.length} added`,
        ],
        failed: [],
        skipped: [`${ctx.incrementalDiff.unchanged.length} unchanged`],
      });

      if (ctx.incrementalDiff.removed.length > 0 && ctx.incrementalDiff.added.length > 0) {
        const allHashes = new Map<string, string>();
        for (const [p, h] of fileContentHashes) allHashes.set(p, h);
        for (const [p, h] of storedHashesForRename) allHashes.set(p, h);

        const renames = detectRenames(
          ctx.incrementalDiff.removed,
          ctx.incrementalDiff.added,
          allHashes,
        );
        for (const rename of renames) {
          const oldFileId = fileNodeId(repositoryId, rename.oldPath);
          const newFileId = fileMap.get(rename.newPath);
          if (!newFileId) continue;
          const renameEdge: EdgeRow = {
            id: edgeId('rename_candidate', repositoryId, rename.oldPath, rename.newPath),
            kind: 'rename_candidate',
            epistemic: 'inferred',
            fromNodeId: oldFileId,
            toNodeId: newFileId,
            repositoryId,
            confidenceBand: rename.confidence >= 0.9 ? 'high' : 'medium',
            provenanceMethod: 'indexer::rename-detect',
            extractor: 'viewer-indexer',
            evidenceIdsJson: null,
            metadataJson: scrubJsonField(JSON.stringify({
              confidence: rename.confidence,
              oldPath: rename.oldPath,
              newPath: rename.newPath,
            }), scrubCounter),
            validFromRevision: revision,
            validToRevision: null,
            createdAt: now,
            updatedAt: now,
          };
          txn.upsertEdge(renameEdge);
        }
      }
    }

    // Partiality tracking
    for (const entry of partiality) {
      txn.upsertPartiality({
        id: partialityRowId(revision, entry.scope),
        revision,
        scope: entry.scope,
        extractedJson: entry.extracted.length > 0 ? JSON.stringify(entry.extracted) : null,
        failedJson: entry.failed.length > 0 ? JSON.stringify(entry.failed) : null,
        skippedJson: entry.skipped.length > 0 ? JSON.stringify(entry.skipped) : null,
        createdAt: now,
      });
    }

    // Close intervals
    if (ctx.incrementalDiff && ctx.incrementalDiff.removed.length > 0) {
      for (const removedPath of ctx.incrementalDiff.removed) {
        txn.closeInterval(fileNodeId(repositoryId, removedPath), revision);
        txn.closeInterval(edgeId('contains', repositoryId, removedPath), revision);
      }
    }

    if (!ctx.incrementalDiff) {
      txn.closeStaleIntervals(revision, repositoryId, now);
    }

    // Commit
    reporter.stage(10, TOTAL_STAGES, 'Store Commit', 1, 'transaction', Date.now() - pipelineStart);
    txn.commit();
    reporter.done(Date.now() - pipelineStart);
  }
}

/**
 * Returns true if a Float32Array contains only zeros.
 * Used to skip persisting placeholder embeddings when the model
 * returned a zero vector (cache miss without real inference).
 */
export function isZeroVector(vec: Float32Array): boolean {
  for (let i = 0; i < vec.length; i++) {
    if (vec[i] !== 0) return false;
  }
  return true;
}

/**
 * Returns true if any path segment is exactly '..'.
 * Unlike `path.includes('..')`, this allows paths containing
 * '..' as a substring (e.g. '/tmp/my..repo').
 */
export function hasTraversalSegment(p: string): boolean {
  // Security check: split on both separators for cross-platform safety
  return p.split(/[/\\]/).some((seg) => seg === '..');
}

interface PyprojectScript {
  name: string;
  module: string;
  func: string;
}

/**
 * Extract [project.scripts] and [project.gui-scripts] entries from pyproject.toml.
 * Parses the minimal TOML subset needed: section headers and key = "value" pairs.
 */
export function parsePyprojectScripts(content: string): PyprojectScript[] {
  const results: PyprojectScript[] = [];
  const lines = content.split('\n');
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[/.test(trimmed)) {
      inSection = /^\[project\.(?:scripts|gui-scripts)\]$/.test(trimmed);
      continue;
    }
    if (!inSection) continue;
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const m = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (!m) continue;

    const [, name, ref] = m;
    const colonIdx = ref!.indexOf(':');
    if (colonIdx === -1) continue;

    results.push({
      name: name!,
      module: ref!.slice(0, colonIdx),
      func: ref!.slice(colonIdx + 1),
    });
  }

  return results;
}

function isLikelyEntrypoint(relativePath: string): boolean {
  const name = basename(relativePath);
  const patterns = [
    /^index\.[tj]sx?$/,
    /^main\.[tj]sx?$/,
    /^app\.[tj]sx?$/,
    /^server\.[tj]sx?$/,
    /^cli\.[tj]sx?$/,
    /^bin\//,
  ];
  return patterns.some((p) => p.test(name) || p.test(relativePath));
}

/**
 * Determines if a subsystem owns a file based on path glob patterns.
 * Supports '**' (matches any path segments) and '*' (matches within one segment).
 * Also supports literal file paths (from co-change clusters).
 */
function subsystemOwnsFile(subsystemPaths: string[], filePath: string): boolean {
  for (const pattern of subsystemPaths) {
    if (pattern === filePath) return true;
    if (picomatch.isMatch(filePath, pattern, { dot: true })) return true;
  }
  return false;
}

function discoverPackages(repoRoot: string, filePaths: string[]): PackageMetadata[] {
  const packages: PackageMetadata[] = [];
  const seen = new Set<string>();

  for (const filePath of filePaths) {
    if (!filePath.endsWith('package.json')) continue;

    // Stored paths always use POSIX separators (/) for cross-platform consistency
    const parts = filePath.split('/');
    if (parts.length > 3) continue;

    if (seen.has(filePath)) continue;
    seen.add(filePath);

    try {
      const content = readFileSync(join(repoRoot, filePath), 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

      const pkg = parsed as Record<string, unknown>;
      const name = typeof pkg.name === 'string' ? pkg.name : basename(filePath.replace('/package.json', ''));
      const dir = filePath.replace('/package.json', '');

      const deps = typeof pkg.dependencies === 'object' && pkg.dependencies !== null
        ? Object.keys(pkg.dependencies as Record<string, unknown>)
        : [];
      const devDeps = typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null
        ? Object.keys(pkg.devDependencies as Record<string, unknown>)
        : [];

      packages.push({
        name,
        path: dir,
        dependencies: deps,
        devDependencies: devDeps,
      });
    } catch {
      continue;
    }
  }

  return packages;
}
