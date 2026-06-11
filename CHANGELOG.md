# Changelog

## 0.1.0 — Initial Release

Evidence-backed codebase model with structured querying, confidence scoring, and System2 overlay integration.

### Core

- 8-package monorepo with enforced dependency DAG (viewer-core, viewer-config, viewer-store, viewer-indexer, viewer-retrieval, viewer-verify, viewer-surface, viewer-bench)
- SQLite-backed persistence in WAL mode with migration runner
- Tree-sitter extraction for TypeScript, Python, Rust, Go, Java, and JSON
- Git history mining for co-change edges
- Subsystem inference from directory structure and co-change clusters
- Claim state machine with confidence/freshness scoring
- Incremental indexing with content-hash diffing

### Querying

- 14 read operations, 6 feedback operations, 1 verify operation, 1 index operation
- Dual interface: MCP tool surface (21 tools) and CLI (18 commands)
- ResultEnvelope format with evidence references, uncertainty items, and suggested next calls
- FTS5 full-text search with retrieval pipeline (symbolic, lexical, graph expansion, claim resolution)

### Indexer Features

- Hierarchical directory nodes with containment edges (repo -> directory -> file)
- pyproject.toml `[project.scripts]` and `[project.gui-scripts]` parsing for Python entrypoint detection
- Entrypoint discovery seeds `likely-entrypoint` claims into `findEntrypoints` results
- Architecture rule authoring (forbidden imports, required imports, glob-based scoping)
- Secret scrubbing for credentials, keys, and env files
- Path traversal validation
- Parallel worker pool for large repositories

### Overlay

- Installable System2 overlay plugin under `plugin/`
- Contributes: evidence-backed reasoning principle, Gate 1 consultation (overview/entrypoints), Gate 3 consultation (blast radius/uncertainties)
- Advisory source with MCP server declaration and CLI fallback permission
- `viewer-scout` auxiliary agent for bulk query delegation

### Tooling

- `boundary-check` — import topology, C2 single-writer, and surface drift enforcement
- `audit-egress` — network egress audit (zero imports allowed)
- Benchmark runner and eval harness (viewer-bench)
