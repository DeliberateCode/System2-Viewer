// Public exports per interfaces.json

// Class
export { Indexer, hasTraversalSegment } from './indexer.js';

// Functions
export { inferDefaultLayerRules } from './rules.js';
export { selectSymbolBackend } from './backend-select.js';
export { probeEmbedderStatus, tryLoadEmbedder } from './embedder.js';

// Secret scrubbing
export { scrubSecrets, shannonEntropy, getPatternCount } from './secret-scrub.js';

// Incremental indexing
export { hashFileContent, computeIncrementalDiff, computeStatDiff } from './incremental.js';
export type { StatFingerprint } from './incremental.js';

// Rename detection
export { detectRenames, pathSimilarity } from './rename-detect.js';
export type { RenameCandidate } from './rename-detect.js';

// Global symbol map
export { GlobalSymbolMap } from './global-symbol-map.js';
export type { GlobalSymbolEntry } from './global-symbol-map.js';

// Progress reporting
export { StderrProgressReporter, JsonProgressReporter, NullProgressReporter } from './progress.js';
export type { ProgressReporter } from './progress.js';

// Worker pool (parallel indexing)
export { WorkerPool, resolveWorkerPoolConfig } from './worker-pool.js';
export type { WorkerPoolConfig, ExtractionTask, WorkerExtractionResult, WorkerExtractionError } from './worker-pool.js';

// Grammar checksums
export { GRAMMAR_CHECKSUMS, verifyGrammarChecksum, grammarPackageForWasm } from './grammar-checksums.js';
export type { GrammarChecksumResult } from './grammar-checksums.js';

// Types
export type { InferredLayerRuleCandidate } from './types.js';
export type { IncrementalDiff } from './incremental.js';
export type { EmbedderStatus, Embedder } from './embedder.js';
export type { ScrubResult } from './secret-scrub.js';
