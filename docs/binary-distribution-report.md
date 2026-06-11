# Binary Distribution Feasibility Report

## Context

System2-viewer depends on three native/WASM modules that complicate single-binary distribution:
- **better-sqlite3** -- native N-API addon (C++ compiled per platform)
- **web-tree-sitter** -- loads `.wasm` files at runtime via `fetch` or `fs.readFileSync`
- **onnxruntime-node** -- native N-API addon with platform-specific shared libraries (~50 MB)

## Approach 1: Node.js Single Executable Application (SEA)

Built into Node.js since v20 (stable in v22). Embeds a single JS blob into a copy of the `node` binary.

**Pros:**
- No third-party tooling; uses `node --experimental-sea-config`
- Produces a real Node.js binary with full API compatibility
- Supports `node:` built-ins and `worker_threads`

**Cons:**
- Native addons (`.node` files) cannot be embedded -- they must be shipped alongside the binary and loaded at runtime via filesystem paths
- better-sqlite3 and onnxruntime-node both require their `.node` files adjacent to the binary
- WASM files (web-tree-sitter grammars) must also be shipped as separate files
- The result is a binary + a directory of native assets, not a true single file
- No cross-compilation; must build on each target platform

**Native module compatibility:**
- better-sqlite3: requires sidecar `.node` file per platform
- web-tree-sitter: requires sidecar `.wasm` files
- onnxruntime-node: requires sidecar `.node` + shared libraries (~50 MB per platform)

## Approach 2: pkg (Vercel)

Community tool that bundles Node.js app + runtime into a single binary. Note: pkg is in maintenance mode (deprecated by Vercel in late 2023).

**Pros:**
- Mature tooling with cross-compilation support (build linux/mac/win from one machine)
- Can snapshot JS files into the binary's virtual filesystem
- Large existing user base and documentation

**Cons:**
- Officially deprecated; no active development
- Native addons must be declared in `pkg.assets` and extracted to a temp directory at runtime
- ESM support is incomplete; System2-viewer uses `"type": "module"` throughout
- better-sqlite3 requires a prebuilt binary per platform, complicating the pkg config
- onnxruntime-node's multi-file native payload is difficult to package correctly
- Node.js version lags behind upstream (pkg bundles its own Node runtime)

**Native module compatibility:**
- better-sqlite3: works with manual asset config, but fragile across Node versions
- web-tree-sitter: WASM files can be included as assets
- onnxruntime-node: impractical due to large multi-file native payload

## Approach 3: Bun compile

`bun build --compile` produces a single binary from a Bun-compatible project.

**Pros:**
- Single command; fast compilation
- Can embed static assets (including `.wasm` files) via `Bun.file` or import
- Active development; improving Node.js compatibility

**Cons:**
- N-API addon support is incomplete; better-sqlite3 works on some platforms but has known edge cases
- onnxruntime-node is untested/unsupported on Bun as of mid-2025
- `node:worker_threads` compatibility is partial (viewer-indexer uses worker threads)
- Bun's `node:` compatibility, while good, has gaps that surface at runtime
- Switching runtime introduces a new failure surface for the entire project

**Native module compatibility:**
- better-sqlite3: partially works; platform-dependent issues reported
- web-tree-sitter: WASM loading works if using Bun-compatible APIs
- onnxruntime-node: not supported

## Recommendation

**None of the three approaches currently produce a clean single-binary for this project.** The native module dependencies (better-sqlite3, onnxruntime-node) prevent true single-file distribution in all cases.

**Recommended path forward:**

1. **Short term**: distribute as an npm package (`npx system2-viewer`) or a tarball with `node_modules` pre-installed per platform. This is the simplest approach that works today.
2. **Medium term**: evaluate Node.js SEA + a platform-specific archive (binary + sidecar native files in a `.tar.gz`). Automate builds in CI for linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64.
3. **Long term**: watch Bun's N-API maturity. If better-sqlite3 and onnxruntime-node both stabilize on Bun, `bun build --compile` becomes the strongest option.
4. **Alternative**: consider replacing better-sqlite3 with Bun's built-in SQLite (if migrating to Bun) or with a WASM-based SQLite (sql.js) to eliminate the native addon. This trades ~2x read performance for full embeddability.

## Next steps

- [ ] Prototype Node.js SEA with sidecar directory; measure binary + assets size
- [ ] Test better-sqlite3 on Bun compile across darwin-arm64 and linux-x64
- [ ] Benchmark sql.js vs better-sqlite3 on the viewer workload to evaluate the WASM SQLite path
