# WASM SQLite Fallback Research

## Problem

`better-sqlite3` requires a C++ toolchain (node-gyp) to compile native bindings.
If compilation fails (missing build tools, unsupported platform, cross-compilation),
the viewer is completely non-functional.

## Option 1: sql.js (Emscripten-compiled SQLite)

- Ships a pre-compiled WASM binary; works everywhere Node.js runs.
- No native compilation step; install is `npm install sql.js`.
- API is asynchronous (returns Promises), unlike better-sqlite3's synchronous API.
- Write-heavy workloads are 5-10x slower than better-sqlite3 due to WASM overhead
  and the lack of shared-memory WAL mode.
- Read performance is closer to native (2-3x slower for typical SELECT queries).
- Would require an adapter layer in `viewer-store` that wraps sql.js behind the
  same `ReadHandle` / `SnapshotTxn` interfaces.
- Memory usage is higher: the entire database is loaded into a JS ArrayBuffer.
- No concurrent reader support (single-connection model).

## Option 2: Alternative better-sqlite3 builds

### better-sqlite3-multiple-ciphers
- Fork with encryption support and broader prebuilt binary coverage.
- Same synchronous API as better-sqlite3 (drop-in replacement).
- Adds ~1 MB to the binary size for cipher support.

### @aspect-build/better-sqlite3
- Bazel-friendly fork with additional prebuilt binaries for Linux ARM64, Alpine.
- Same API surface; maintained by Aspect Build.

Both alternatives reduce the "missing prebuild" surface but still require
a native binary for the target platform.

## Option 3: better-sqlite3 with prebuild-install (current approach)

- `prebuild-install` downloads prebuilt binaries for common platforms
  (darwin-arm64, darwin-x64, linux-x64, win32-x64).
- Falls back to node-gyp only when no prebuild matches.
- Already configured in the project.

## Recommendation

| Timeframe | Action |
|-----------|--------|
| Short-term | Maintain prebuild coverage (already done via prebuild-install). Verify CI publishes prebuilts for darwin-arm64, linux-x64, win32-x64. |
| Medium-term | Add sql.js as an optional fallback behind a config flag (`indexing.sqliteBackend: 'native' | 'wasm'`). Default remains `native`. |
| Long-term | If sql.js adoption grows, consider making it the default for read-only operations (MCP server) while keeping native for indexing. |

### Adapter design (medium-term)

The adapter would live in `viewer-store` and implement the existing interfaces:

```
viewer-store/
  src/
    backend-native.ts   -- current better-sqlite3 implementation
    backend-wasm.ts     -- sql.js wrapper (new)
    backend.ts          -- shared interface (ReadHandle, SnapshotTxn)
    index.ts            -- factory: picks backend based on config
```

Key constraints for the wasm adapter:
- Must serialize all writes through a single connection (no WAL concurrency).
- Must flush the in-memory database to disk after each commit.
- Read operations return the same shaped rows as the native backend.
- The `ModelStore.open()` factory selects the backend at startup; callers
  never import a backend directly.

### Risk assessment

- sql.js perf regression is acceptable for small-to-medium repos (<10k files).
- Large repos (>50k files) should use the native backend for indexing.
- The config flag makes the choice explicit; no silent degradation.

---

*This is a research document. No code changes are included.*
