export { ModelStore } from './store.js';
export type { SqlitePragmaOpts } from './store.js';
export { SCHEMA_DDL, REVISION_SCOPED_TABLES } from './schema.js';
export { getMigrationStatus } from './migration-runner.js';
export type { MigrationStatus } from './migration-runner.js';
export type { ReadHandle } from './read-handle.js';
export type { SnapshotTxn, RevisionRow, FtsTextRow } from './snapshot-txn.js';
export type {
  RevisionId,
  NeighborEdge,
  ClaimReadRow,
  EvidenceReadRow,
  PartialityRow,
  PartialityWriteRow,
  VerificationHistoryRow,
  FtsHit,
  NodeRow,
  EdgeRow,
  EvidenceRow,
  ClaimRow,
  RuleRow,
  EmbeddingRow,
  SimilarityHit,
  FileHashRow,
} from './types.js';
