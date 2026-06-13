export const SCHEMA_DDL = `
-- Revision tracking
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('commit','working_tree')),
  parent_id TEXT,
  committed_at TEXT,
  indexed_at TEXT NOT NULL,
  history_bounded INTEGER NOT NULL DEFAULT 0
);

-- Open vocabulary for node/edge/evidence kinds
CREATE TABLE IF NOT EXISTS kind_registry (
  kind TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  mvp_emitted INTEGER NOT NULL
);

-- Structural nodes (files, directories, symbols, packages, subsystems, repository)
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL REFERENCES kind_registry(kind),
  stable_key TEXT NOT NULL,
  display_name TEXT,
  repository_id TEXT NOT NULL,
  path TEXT,
  language TEXT,
  file_class TEXT,
  provenance_method TEXT NOT NULL,
  extractor TEXT NOT NULL,
  metadata_json TEXT,
  valid_from_revision TEXT NOT NULL,
  valid_to_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_stable ON nodes(repository_id, stable_key, valid_to_revision);
CREATE INDEX IF NOT EXISTS idx_nodes_repo_kind ON nodes(repository_id, kind, valid_to_revision);

-- Relationship edges
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL REFERENCES kind_registry(kind),
  epistemic TEXT NOT NULL CHECK(epistemic IN ('static','inferred','observed','declared')),
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  confidence_band TEXT NOT NULL CHECK(confidence_band IN ('none','low','medium','high')),
  provenance_method TEXT NOT NULL,
  extractor TEXT NOT NULL,
  evidence_ids_json TEXT,
  metadata_json TEXT,
  valid_from_revision TEXT NOT NULL,
  valid_to_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id, kind, valid_to_revision);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id, kind, valid_to_revision);

-- Evidence records (append-only, not interval-scoped)
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL REFERENCES kind_registry(kind),
  epistemic TEXT NOT NULL CHECK(epistemic IN ('static','inferred','observed')),
  repository_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  content_hash TEXT,
  extractor TEXT NOT NULL,
  derivation_locality TEXT NOT NULL CHECK(derivation_locality IN ('local','remote')),
  actor TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_kind_repo ON evidence(kind, repository_id);

-- Typed claims with non-destructive successor pattern
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  claim_type TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('hypothesis','confirmed','rejected','contradicted','stale')),
  repository_id TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  confidence_band TEXT NOT NULL CHECK(confidence_band IN ('none','low','medium','high')),
  freshness_band TEXT NOT NULL CHECK(freshness_band IN ('stale','aging','fresh')),
  supporting_evidence_ids_json TEXT NOT NULL,
  contradicting_evidence_ids_json TEXT,
  verification_recipes_json TEXT NOT NULL,
  derivation_method TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  surfaced INTEGER NOT NULL DEFAULT 0,
  valid_from_revision TEXT NOT NULL,
  valid_to_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_type_status ON claims(claim_type, status, valid_to_revision);

-- Architecture rules (explicit and inferred)
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('inferred_candidate','human_confirmed_explicit','rejected')),
  source TEXT NOT NULL CHECK(source IN ('explicit','inferred')),
  repository_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  valid_from_revision TEXT NOT NULL,
  valid_to_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Verification audit trail (append-only)
CREATE TABLE IF NOT EXISTS verification_history (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  recipes_json TEXT NOT NULL,
  prior_confidence TEXT,
  new_confidence TEXT,
  prior_freshness TEXT,
  new_freshness TEXT,
  prior_status TEXT,
  new_status TEXT,
  unresolved_reason TEXT,
  ran_at TEXT NOT NULL
);

-- Extraction partiality tracking
CREATE TABLE IF NOT EXISTS partiality (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  scope TEXT NOT NULL,
  extracted_json TEXT,
  failed_json TEXT,
  skipped_json TEXT,
  created_at TEXT NOT NULL
);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS fts_text USING fts5(
  object_id UNINDEXED, object_type UNINDEXED, text, path,
  tokenize='unicode61'
);

-- Cached view results
CREATE TABLE IF NOT EXISTS view_cache (
  id TEXT PRIMARY KEY,
  view_type TEXT NOT NULL,
  revision TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Vector embeddings for semantic search
CREATE TABLE IF NOT EXISTS embeddings (
  node_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, model_name)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model_name);
`;

export const KIND_REGISTRY_SEED_SQL = `
INSERT OR IGNORE INTO kind_registry (kind, category, mvp_emitted) VALUES
  ('repository', 'node', 1),
  ('workspace', 'node', 1),
  ('directory', 'node', 1),
  ('file', 'node', 1),
  ('symbol', 'node', 1),
  ('package', 'node', 1),
  ('subsystem', 'node', 1),
  ('contains', 'edge', 1),
  ('defines', 'edge', 1),
  ('references', 'edge', 1),
  ('imports', 'edge', 1),
  ('tested_by', 'edge', 1),
  ('changed_with', 'edge', 1),
  ('owns', 'edge', 1),
  ('violates', 'edge', 1),
  ('depends_on', 'edge', 1),
  ('rename_candidate', 'edge', 1),
  ('human_annotation', 'evidence', 1),
  ('test_result', 'evidence', 1),
  ('symbol_index_hit', 'evidence', 1),
  ('static_analysis_result', 'evidence', 1),
  ('tree_sitter_query', 'evidence', 1),
  ('grep_hit', 'evidence', 1),
  ('source_span', 'evidence', 1),
  ('git_commit', 'evidence', 1),
  ('llm_derivation', 'evidence', 1),
  ('runtime_trace', 'evidence', 0),
  ('embedding_similarity', 'evidence', 0),
  -- System-generated kinds (required at insert time, unlike reserved-name-only claim types)
  ('event-flow', 'edge', 0),
  ('boundary-violation', 'claim_type', 0);
`;

export const REVISION_SCOPED_TABLES: readonly string[] = [
  'nodes',
  'edges',
  'claims',
  'rules',
] as const;
