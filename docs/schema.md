# SQLite Schema Reference

System2-viewer stores its code model in a single SQLite database (`model.sqlite`) managed by `viewer-store`. Migrations are applied automatically on first access.

## Tables

### revisions

Tracks each indexing run.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Unique revision identifier (e.g. `rev::1700000000::abcd1234`) |
| repository_id | TEXT | Derived from the repo root path and optional name |
| kind | TEXT | `commit` or `working_tree` |
| parent_id | TEXT | Parent revision id (nullable) |
| committed_at | TEXT | Git commit timestamp (nullable for working tree) |
| indexed_at | TEXT | When this revision was indexed |
| history_bounded | INTEGER | 1 if git history was truncated by depth limit |

### nodes

Structural graph nodes: files, symbols, packages, subsystems, repository.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Deterministic node id (e.g. `node::file::repo::path`) |
| kind | TEXT FK | References `kind_registry`. One of: repository, file, symbol, package, subsystem |
| stable_key | TEXT | Content-addressed key for deduplication across revisions |
| display_name | TEXT | Human-readable label |
| repository_id | TEXT | Owning repository |
| path | TEXT | Relative file path (nullable for non-file nodes) |
| language | TEXT | Detected programming language (nullable) |
| file_class | TEXT | Classification: source, test, config, doc, asset, generated, other |
| provenance_method | TEXT | How this node was created (e.g. `indexer::walk`) |
| extractor | TEXT | Tool that produced this node |
| metadata_json | TEXT | Arbitrary JSON metadata |
| valid_from_revision | TEXT | Revision that introduced this version of the node |
| valid_to_revision | TEXT | Revision that closed this interval (NULL = current) |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp (bumped each indexing run for stale detection) |

### edges

Relationship edges between nodes.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Deterministic edge id |
| kind | TEXT FK | Edge type: contains, defines, imports, changed_with, owns, rename_candidate, etc. |
| epistemic | TEXT | `static`, `inferred`, or `observed` |
| from_node_id | TEXT | Source node |
| to_node_id | TEXT | Target node |
| repository_id | TEXT | Owning repository |
| confidence_band | TEXT | `none`, `low`, `medium`, or `high` |
| provenance_method | TEXT | How this edge was created |
| extractor | TEXT | Tool that produced this edge |
| evidence_ids_json | TEXT | JSON array of evidence ids supporting this edge |
| metadata_json | TEXT | Arbitrary JSON metadata |
| valid_from_revision | TEXT | Interval start |
| valid_to_revision | TEXT | Interval end (NULL = current) |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### evidence

Append-only evidence records. Not interval-scoped. Key columns: `id` (PK), `kind` (FK to kind_registry -- git_commit, source_span, etc.), `epistemic`, `repository_id`, `revision`, `path`, `start_line`/`end_line` (source range), `content_hash`, `extractor`, `derivation_locality` (local/remote), `metadata_json`.

### claims

Typed architectural claims with non-destructive versioning.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Claim id |
| claim_type | TEXT | Claim category (e.g. `entrypoint`, `layer_boundary`) |
| statement | TEXT | Human-readable claim text |
| status | TEXT | `hypothesis`, `confirmed`, `rejected`, `contradicted`, or `stale` |
| confidence_band | TEXT | `none`, `low`, `medium`, or `high` |
| freshness_band | TEXT | `stale`, `aging`, or `fresh` |
| supporting_evidence_ids_json | TEXT | JSON array of supporting evidence ids |
| contradicting_evidence_ids_json | TEXT | JSON array of contradicting evidence ids |
| verification_recipes_json | TEXT | JSON array of verification recipe objects |
| generation_id | TEXT | Batch id for the indexing run that generated this claim |
| surfaced | INTEGER | 1 if this claim has been shown to a user |
| valid_from_revision | TEXT | Interval start |
| valid_to_revision | TEXT | Interval end (NULL = current) |

### kind_registry

Open vocabulary for node, edge, and evidence kinds.

| Column | Type | Description |
|--------|------|-------------|
| kind | TEXT PK | Kind name (e.g. `file`, `imports`, `git_commit`) |
| category | TEXT | `node`, `edge`, or `evidence` |
| mvp_emitted | INTEGER | 1 if emitted by the MVP indexer |

### file_hashes

Stores content hashes and stat fingerprints for incremental re-indexing.

| Column | Type | Description |
|--------|------|-------------|
| path | TEXT | Relative file path (part of composite PK) |
| repository_id | TEXT | Repository id (part of composite PK) |
| hash | TEXT | SHA-256 hex digest of file content |
| revision | TEXT | Revision that last updated this entry |
| updated_at | TEXT | ISO timestamp |
| mtime_ms | REAL | File modification time in ms (for fast dirty check) |
| size | INTEGER | File size in bytes (for fast dirty check) |

### Other tables

**rules** -- architecture rules (interval-versioned). **verification_history** -- append-only claim verification audit trail. **partiality** -- extraction completeness per revision. **fts_text** -- FTS5 virtual table for full-text search. **view_cache** -- cached view results. **embeddings** -- vector embeddings (node_id + model_name PK).

## Interval Versioning

Nodes, edges, claims, and rules use `valid_from_revision` / `valid_to_revision` intervals. `NULL` valid_to means current. To query at a revision: `valid_from_revision <= rev AND (valid_to_revision IS NULL OR valid_to_revision > rev)`. When content changes, the old version is copied to a history row with valid_to set, and the original row is updated.

## Example Queries

```sql
-- All current file nodes for a repository
SELECT id, path, language FROM nodes
WHERE kind = 'file' AND repository_id = ? AND valid_to_revision IS NULL;

-- Import edges from a specific file
SELECT e.to_node_id, n.path FROM edges e
JOIN nodes n ON n.id = e.to_node_id
WHERE e.from_node_id = ? AND e.kind = 'imports' AND e.valid_to_revision IS NULL;

-- Full-text search for symbols
SELECT object_id, text, path FROM fts_text
WHERE fts_text MATCH '"UserService"' ORDER BY rank;

-- Current claims with low confidence
SELECT id, statement, status FROM claims
WHERE confidence_band = 'low' AND valid_to_revision IS NULL;

-- File hash for incremental comparison
SELECT hash, mtime_ms, size FROM file_hashes
WHERE path = ? AND repository_id = ?;
```
