# Contributing to System2-viewer

## Package DAG

```
viewer-core          viewer-config          (leaf packages, zero workspace imports)
    |                    |
    v                    v
viewer-store         (imports viewer-core)
    |
    v
viewer-indexer       (imports viewer-core, viewer-store)
    |
    v
viewer-retrieval     (imports viewer-core ONLY, never viewer-store)
    |
    v
viewer-verify        (imports viewer-core, viewer-retrieval)
    |
    v
viewer-surface       (imports all except viewer-bench; composition root)
    |
viewer-bench         (imports viewer-core, viewer-indexer, viewer-store, viewer-retrieval; dev-only)
```

Arrows mean "depends on". No package may import a package above it in the DAG.
`viewer-retrieval` never imports `viewer-store` -- it receives structural handles at the composition root.

## Development setup

Prerequisites: Node.js >= 22, npm.

```sh
npm install
npm run build        # tsc -b (incremental project references)
npm test             # vitest run
npm run typecheck    # tsc -b --noEmit
```

## Optional runtime dependencies

### Semantic embeddings

Semantic search requires the `all-MiniLM-L6-v2` ONNX model. When absent, `viewer doctor` reports `Embedding model: not_installed` and semantic search is unavailable. All other operations work without it.

To enable, download `model.onnx` and `tokenizer.json` for `all-MiniLM-L6-v2` into `~/.cache/system2-viewer/models/`.

### Eval suite

`npm run bench:evals` and `npm run bench:prompt-evals` require:

```sh
export EVAL_LLM_API_KEY=sk-ant-...
```

Unit tests for the eval harness mock the API key and run offline.

## Native Dependencies

`better-sqlite3` includes a prebuilt native binary for most platforms. When the prebuilt binary is unavailable, npm falls back to compiling from source, which requires a C++ toolchain.

### Prerequisites

| Platform | Requirement |
|----------|-------------|
| All | Node.js >= 22, npm |
| macOS | Xcode Command Line Tools |
| Ubuntu/Debian | `build-essential`, `python3` |
| Windows | Visual Studio Build Tools or `windows-build-tools` |

### macOS

```sh
xcode-select --install
```

### Ubuntu / Debian

```sh
sudo apt install build-essential python3
```

### Windows

Install Visual Studio Build Tools (recommended), or:

```sh
npm install --global windows-build-tools
```

### Troubleshooting

If `npm install` fails with native compilation errors:

```sh
# Force rebuild of the native module
npm rebuild better-sqlite3

# Run the built-in doctor command to diagnose and fix common issues
npx viewer doctor --fix
```

If the rebuild still fails, verify that your C++ compiler is on PATH (`cc --version` or `cl.exe`) and that Python 3 is available (`python3 --version`).

## How to add a new retrieval operation

1. **Define the operation** in `packages/viewer-retrieval/src/`. Export a function that takes a structural `ReadHandle` interface and returns a typed result. Export the handle interface and result type from `index.ts`.
2. **Wire the handle** in `packages/viewer-surface/src/bind-handle.ts`. Add the new handle fields to the `UnionHandle` intersection type. Implement them as SELECT-only queries on the readonly db connection.
3. **Register in the engine** in `packages/viewer-surface/src/engine.ts`. Import the operation, call it inside `withRead`, and expose it on the engine object.
4. **Add to MCP tool table** in `packages/viewer-surface/src/tool-table.ts`. Define a Zod input schema, add a `ToolEntry` with name, description, capabilityClass, and handlerKey.
5. **Add a CLI command** in `packages/viewer-surface/src/cli-commands.ts`. Define the command's args builder, opKey, and viewKind.
6. **Write tests** at each layer: unit test for the operation, integration test for bind-handle, end-to-end test via the engine.

## How to add a new language visitor

1. **Create the visitor** in `packages/viewer-indexer/src/visitors/<lang>-visitor.ts`. Implement the `LanguageVisitor` interface: accept a `TreeSitterNode` and content string, return `{ symbols, imports }`.
2. **Register in grammar-registry** in `packages/viewer-indexer/src/grammar-registry.ts`. Import the visitor and add a `GrammarEntry` with language name, file extensions, WASM package/filename, and visitor function.
3. **Add import resolution** if the language has an import system. Update `packages/viewer-indexer/src/resolve-imports.ts` to handle the new language's import specifier format.
4. **Add test fixtures** in the visitor test file (`packages/viewer-indexer/src/__tests__/<lang>-visitor.test.ts`). Include inline fixture strings covering functions, classes, imports, and edge cases. Add a fixture file in `test-fixtures/sample-monorepo/` if integration tests need it.
5. **Install the tree-sitter grammar** package as a dependency of `viewer-indexer`.

## How to add a new migration

1. **Create the migration file** in `packages/viewer-store/src/migrations/`. Follow the naming convention: `NNN-<description>.ts` (e.g., `004-my-feature.ts`). Export a `Migration` object with `version`, `name`, `up(db)`, and optional `down(db)`.
2. **Register in the runner** in `packages/viewer-store/src/migration-runner.ts`. Import the migration and append it to the `MIGRATIONS` array.
3. **Update schema types** if the migration adds columns/tables. Update `packages/viewer-store/src/schema.ts` and any affected `ReadHandle` methods.

## Boundary rules

Enforced by `npm run boundary-check` (see `tools/boundary-check/module-boundaries.json`):

| Package | May import from | Must not import |
|---------|----------------|-----------------|
| viewer-core | (nothing) | all other packages |
| viewer-config | (nothing) | all other packages |
| viewer-store | viewer-core | viewer-config, indexer, retrieval, verify, surface, bench |
| viewer-indexer | viewer-core, viewer-store | viewer-config, retrieval, verify, surface, bench |
| viewer-retrieval | viewer-core | viewer-config, store, indexer, verify, surface, bench |
| viewer-verify | viewer-core, viewer-retrieval | viewer-config, store, indexer, surface, bench |
| viewer-surface | all except viewer-bench | viewer-bench |
| viewer-bench | viewer-core, indexer, store, retrieval | viewer-config, verify, surface |

**C2 single-writer rule**: only packages in the writer set (`viewer-indexer`, `viewer-verify`, `viewer-surface`, `viewer-bench`) may import `viewer-store`. All other packages must consume data through structural handle interfaces.

## Testing

```sh
npm test                  # full suite (vitest run)
npm run boundary-check    # import topology + C2 writer enforcement
npm run audit:egress      # network egress audit
npm run bench:evals       # retrieval accuracy evals
npm run typecheck:tests   # typecheck test files
npm run ci                # build + typecheck:tests + test
```

Run a subset: `npx vitest run packages/viewer-retrieval` or `npx vitest run -t "test name"`.

## CI Integration

Add these commands to your CI pipeline:

```yaml
- npm ci
- npm run build
- npm run typecheck:tests
- npm test
- npm run boundary-check
- npm run audit:egress
```

`boundary-check` prevents architectural erosion. `audit:egress` enforces the no-network invariant. Both should gate PRs.

## Code review checklist

- [ ] No boundary violations: `npm run boundary-check` passes
- [ ] `viewer-retrieval` does not import `viewer-store` (structural handles only)
- [ ] New retrieval ops accept a handle interface, not a concrete db
- [ ] Migrations are append-only; never modify existing migration files
- [ ] All new MCP tools have matching CLI commands and vice versa
- [ ] No secrets or credentials in committed files; `npm run audit:egress` passes
- [ ] Tests cover the happy path and at least one error case
- [ ] `npm run ci` passes (build + typecheck + all tests)
