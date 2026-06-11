# System2-viewer

System2-viewer builds a local, evidence-backed codebase model stored in SQLite. It indexes a repository's file structure, symbol definitions, import edges, and co-change relationships, then exposes that model through 14 structured query operations, 6 feedback operations, and 1 index operation -- available via both an MCP tool surface (for AI agents) and a CLI (for humans). The viewer is strictly advisory, source-read-only, local-only (no network egress), and integrates with [System2](https://github.com/DeliberateCode/System2) as a first-class overlay.

## Prerequisites

- Node.js >= 22.0.0
- npm (ships with Node.js)

Pre-built binaries are provided for common platforms via `prebuild-install`. If your platform isn't supported, a C++ compiler is needed to build the native `better-sqlite3` module from source.

## Quickstart

```bash
cd /path/to/system2-viewer
npm install
npm run build

# Point VIEWER_PATH at this checkout
export VIEWER_PATH=/path/to/system2-viewer

# Check that native dependencies are working
node packages/viewer-surface/bin/viewer.mjs doctor

# Index a target repository
node packages/viewer-surface/bin/viewer.mjs index /path/to/target-repo

# Get a structural overview
node packages/viewer-surface/bin/viewer.mjs overview /path/to/target-repo
```

## System2 Overlay Integration

This is the primary integration path. Set `VIEWER_PATH` and run the compose skill:

```bash
export VIEWER_PATH=/path/to/system2-viewer
/system2:compose /path/to/system2-viewer/plugin
```

Composition adds to your project's CLAUDE.md: an evidence-backed reasoning principle, Gate 1 (overview/entrypoints) and Gate 3 (blast radius/uncertainties) consultations, the viewer advisory source, a `viewer-scout` auxiliary agent for heavy query delegation, an MCP server suggestion, and a Bash permission suggestion for CLI fallback. All contributions are advisory-only -- if the viewer is unready or stale, the orchestrator proceeds without it.

## MCP Server Setup

Generate the `.mcp.json` entry automatically:

```bash
node packages/viewer-surface/bin/viewer.mjs mcp-config --package /path/to/system2-viewer
```

Or add it manually to `.mcp.json`:

```json
{
  "mcpServers": {
    "system2-viewer": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/system2-viewer/packages/viewer-surface/bin/viewer.mjs", "serve"]
    }
  }
}
```

Or use the Claude Code CLI:

```bash
claude mcp add system2-viewer -- node /path/to/system2-viewer/packages/viewer-surface/bin/viewer.mjs serve
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `doctor` | Check native modules, grammars, backend, and model status |
| `status` | Show model revision and server readiness |
| `init [--force]` | Create `viewer.config.json` with defaults |
| `mcp-config --package <abs>` | Write MCP server entry to `.mcp.json` |
| `index [path]` | Build or rebuild the codebase model |
| `overview [repo]` | Structural overview of the indexed repository |
| `entrypoints <query>` | Find likely entrypoints for a feature or intent |
| `trace <start> <target>` | Trace dependency flow between two references |
| `blast <ref>` | Estimate change impact radius for a file or symbol |
| `subsystem <ref>` | Explain an inferred or configured subsystem |
| `resolve <input>` | Resolve a path, symbol, or intent to a model entity |
| `claims [--type T] [--status S]` | List surfaced claims matching filters |
| `uncertainties [--min-severity S]` | List sub-threshold claims and weak-provenance edges |
| `verify <claimId>` | Re-verify a claim against current source |
| `history <claimId>` | Show claim audit trail and successor chain |
| `check-invariants` | Detect architecture rule violations |
| `confirm <claimId>` | Append human confirmation to a claim |
| `reject <claimId>` | Append human rejection to a claim |
| `annotate <claimId>` | Append a human annotation to a claim |

Global option: `--data-dir <dir>` overrides the default data directory. Exit codes: 0 success, 1 runtime error, 2 usage error.

## MCP Tools

21 tools partitioned by capability class (13 read, 1 verify, 6 feedback, 1 index). All return a `ResultEnvelope` with evidence references, uncertainty items, and suggested next calls.

| Class | Tool | Description |
|-------|------|-------------|
| read | `viewer.doctor` | Capability and readiness probe |
| read | `viewer.status` | Model revision and server status |
| read | `viewer.getRepositoryOverview` | Structural overview with subsystems and hotspots |
| read | `viewer.findEntrypoints` | Ranked entrypoint candidates for a free-text query |
| read | `viewer.traceFlow` | Dependency flow trace between two references |
| read | `viewer.explainSubsystem` | Subsystem explanation with owned files and dependencies |
| read | `viewer.estimateBlastRadius` | Recall-prioritized change impact estimation |
| read | `viewer.listClaims` | Surfaced claims filtered by type and status |
| read | `viewer.listUncertainties` | Sub-threshold claims and weak-provenance edges |
| read | `viewer.checkInvariants` | Architecture rule violation detection |
| read | `viewer.resolveReference` | Resolve a reference to a stored model entity |
| read | `viewer.getClaimHistory` | Claim audit trail with successor chain |
| read | `viewer.compareRevisions` | Diff two already-indexed revisions |
| verify | `viewer.verifyClaim` | Re-verify a claim against source and update confidence |
| feedback | `viewer.confirmClaim` | Append human confirmation evidence |
| feedback | `viewer.rejectClaim` | Append human rejection evidence |
| feedback | `viewer.annotateClaim` | Append supplementary annotation |
| feedback | `viewer.confirmSubsystem` | Confirm a subsystem hypothesis |
| feedback | `viewer.rejectSubsystem` | Reject a subsystem hypothesis |
| feedback | `viewer.annotateSubsystem` | Annotate a subsystem |
| index | `viewer.index` | Build or rebuild the codebase model |

## Configuration

Run `viewer init` to create `viewer.config.json`. Key fields:

- `repository.exclude` -- glob patterns merged with `.gitignore` and built-in secret patterns
- `indexing.gitHistoryDepth` -- commits to mine for co-change edges (default: 500)
- `indexing.symbolBackend` -- `"treesitter"` (default) or `"lsp"` for type-aware extraction via TypeScript's compiler API (distinguishes types, interfaces, and overloads more accurately than tree-sitter; cross-file import resolution is handled by the GlobalSymbolMap for all backends)
- `rules` -- explicit architecture rules (e.g., forbidden imports)
- `remote.enabled` -- reserved, defaults to `false`, no remote behavior implemented

Missing or malformed config falls back to safe defaults.

## Data Directory

The viewer stores its SQLite model in `.system2-viewer/` by default (relative to the indexed repository root). Override with `--data-dir`:

```bash
node packages/viewer-surface/bin/viewer.mjs index /path/to/target-repo --data-dir /tmp/viewer-data
```

The data directory contains `model.sqlite` (WAL mode). Re-indexing is idempotent and rebuilds from source.

## Overlay Plugin

The `plugin/` directory is the installable System2 overlay unit:

```
plugin/
├── .claude-plugin/plugin.json   # Plugin identity
├── system2.overlay.json         # Overlay manifest (contribution declarations)
├── contributions/               # Content injected into orchestrator gates
│   ├── principle.md             # Evidence-backed reasoning principle
│   ├── gate1.md                 # Gate 1 consultation (overview/entrypoints)
│   └── gate3.md                 # Gate 3 consultation (blast radius/uncertainties)
└── agents/
    └── viewer-scout.md          # Auxiliary agent for bulk viewer queries
```

## Package Architecture

Eight packages under `packages/` with a strict dependency DAG:

```
                   viewer-surface
                  /   |   |   \   \
       viewer-indexer  |   |  viewer-verify
         /    \        |   |    /      \
 viewer-store  |  viewer-retrieval     |
      |        |       |               |
 viewer-core   |  viewer-core     viewer-core
               |
         viewer-config

 viewer-bench (dev-only: imports viewer-core, viewer-indexer, viewer-store, viewer-retrieval)
```

| Package | Role |
|---------|------|
| `viewer-core` | Pure types, confidence/freshness scoring, claim state machine |
| `viewer-config` | Configuration loading, exclude pattern merging, defaults |
| `viewer-store` | SQLite persistence, schema, migrations, ModelStore, ReadHandle |
| `viewer-indexer` | Tree-sitter extraction, import resolution, git history, subsystem inference |
| `viewer-retrieval` | 9 structured query operations, ResultEnvelope construction (never imports viewer-store) |
| `viewer-verify` | Verification engine, rules engine, invariant checking |
| `viewer-surface` | Composition root, MCP server, CLI, feedback operations |
| `viewer-bench` | Performance benchmarks and eval harness (dev-only) |

Boundaries are enforced by `npm run boundary-check`.

## Development Scripts

```bash
npm run build            # tsc -b (project references)
npm test                 # vitest run
npm run typecheck        # tsc -b --noEmit
npm run typecheck:tests  # typecheck test files
npm run boundary-check   # validate package dependency DAG
npm run bench            # run performance benchmarks
npm run bench:evals      # run eval suite
npm run ci               # build + typecheck:tests + test
npm run clean            # remove dist/ and tsbuildinfo
```

## Rename Handling in Incremental Indexing

When a file is renamed, the incremental indexer treats it as a **delete of the old path plus an add of the new path**. The old file node is marked as removed and a new node is created at the new path. Relationships (edges) attached to the old node are not automatically transferred.

To preserve continuity across renames, the indexer may infer `rename_candidate` edges based on content-hash similarity between removed and added files. These edges are low-confidence and marked `epistemic: inferred`, so they appear in `listUncertainties` output. Agents and humans can confirm or reject rename candidates via the feedback operations (`confirmClaim` / `rejectClaim`).

If rename detection produces incorrect results or you need a clean rebuild of all relationships, run a full re-index:

```bash
node packages/viewer-surface/bin/viewer.mjs index /path/to/target-repo --full
```

The `--full` flag drops the incremental delta and rebuilds the entire model from source, re-establishing all node identities and edges.

## Troubleshooting

Run `viewer doctor` first. It checks every prerequisite and reports status.

**"Cannot find module better-sqlite3"** -- The native SQLite binding failed to compile for your architecture. Run `npm rebuild better-sqlite3` or reinstall with `npm install`.

**"Grammar not found" or empty symbol extraction** -- tree-sitter WASM grammars failed to load. Check that the relevant grammar packages are installed: `tree-sitter-typescript`, `tree-sitter-json`, `tree-sitter-python`, `tree-sitter-rust`, `tree-sitter-go`. Run `viewer doctor` to see per-language grammar status. The indexer still produces file-level results without grammars.

**"No model indexed"** -- Run `viewer index /path/to/target-repo` before querying. All read operations require an indexed model.

**TypeScript backend degradation** -- If `symbolBackend` is set to `lsp` but the `typescript` package is not resolvable, the indexer falls back to tree-sitter with reduced type-awareness for symbol extraction. Check `viewer doctor` for the effective backend.
