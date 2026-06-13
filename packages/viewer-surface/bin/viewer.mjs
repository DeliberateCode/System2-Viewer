#!/usr/bin/env node

/**
 * CLI entry point for System2-viewer.
 *
 * When argv includes `serve`: starts MCP server.
 * Otherwise: runs CLI command dispatch.
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createViewerEngine } from '../dist/engine.js';
import { McpToolServer } from '../dist/mcp-server.js';
import { runCli } from '../dist/cli.js';

const argv = process.argv.slice(2);

/**
 * When --perf-log is present, creates a Logger that appends to
 * .system2-viewer/perf.log so withTiming output is persisted.
 */
function buildPerfLogger(dataDir) {
  const dir = dataDir ?? '.system2-viewer';
  mkdirSync(dir, { recursive: true });
  const stream = createWriteStream(join(dir, 'perf.log'), { flags: 'a' });
  const sink = (line) => { stream.write(line + '\n'); };
  return {
    error: (msg, ctx) => sink(`[ERROR] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`),
    warn:  (msg, ctx) => sink(`[WARN] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`),
    info:  (msg, ctx) => sink(`[INFO] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`),
    debug: (msg, ctx) => sink(`[DEBUG] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}`),
  };
}

// Detect `serve` mode for MCP server
if (argv.includes('serve')) {
  // Extract --data-dir if provided
  let serveDataDir;
  const serveDirIdx = argv.indexOf('--data-dir');
  if (serveDirIdx !== -1 && argv[serveDirIdx + 1]) {
    serveDataDir = argv[serveDirIdx + 1];
  }

  const servePerfLog = argv.includes('--perf-log');

  try {
    const engine = createViewerEngine({
      dataDir: serveDataDir,
      logger: servePerfLog ? buildPerfLogger(serveDataDir) : undefined,
    });
    const server = new McpToolServer();

    process.once('exit', () => engine.close());

    server.register(engine, engine.feedback, engine.indexer);
    await server.start();
  } catch (err) {
    console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else {
  // CLI mode
  // Extract --data-dir before engine creation
  let dataDir;
  const dataDirIdx = argv.indexOf('--data-dir');
  if (dataDirIdx !== -1 && argv[dataDirIdx + 1]) {
    dataDir = argv[dataDirIdx + 1];
  }

  // Detect index command to extract repoRoot for config resolution
  let cliRepoRoot;
  const cmdIdx = argv.findIndex(a => !a.startsWith('-') && a !== '--data-dir');
  const cmd = cmdIdx !== -1 ? argv[cmdIdx] : null;
  if (cmd === 'index') {
    // Next non-flag arg after 'index' is repoRoot
    const rest = argv.slice(cmdIdx + 1).filter(a => !a.startsWith('-'));
    if (rest.length > 0 && rest[0] !== '.') {
      cliRepoRoot = rest[0];
    }
  }

  // Parse --perf-log flag
  const perfLog = argv.includes('--perf-log');

  // Pure diagnostic commands should not create state
  const readonlyCommands = new Set(['doctor', 'status']);
  const isReadonly = readonlyCommands.has(cmd);

  try {
    const engine = createViewerEngine({
      dataDir,
      repoRoot: cliRepoRoot,
      readonly: isReadonly,
      logger: perfLog ? buildPerfLogger(dataDir) : undefined,
    });

    // Build CliOps adapter from engine
    const ops = {
      // ViewerOperations
      getRepositoryOverview: (a) => engine.getRepositoryOverview(a),
      findEntrypoints: (a) => engine.findEntrypoints(a),
      traceFlow: (a) => engine.traceFlow(a),
      explainSubsystem: (a) => engine.explainSubsystem(a),
      estimateBlastRadius: (a) => engine.estimateBlastRadius(a),
      listClaims: (a) => engine.listClaims(a),
      listUncertainties: (a) => engine.listUncertainties(a),
      checkInvariants: (a) => engine.checkInvariants(a),
      verifyClaim: (a) => engine.verifyClaim(a),
      buildClaimPayload: (a) => engine.buildClaimPayload(a),
      sampleEvidenceAgreement: (a) => engine.sampleEvidenceAgreement(a),
      getImportGraph: (a) => engine.getImportGraph(a),

      // Special operations
      feedback: engine.feedback,
      index: async (a) => {
        const result = await engine.indexer.index({
          repoRoot: a.repoRoot || '.',
          depth: a.depth,
          full: a.full,
          workspace: a.workspace,
          skipEmbed: a.skipEmbed,
          workspaceDepth: a.workspaceDepth,
          workspaceMaxRepos: a.workspaceMaxRepos,
          progress: a.progress,
        });
        return {
          query: { op: 'index', args: a },
          data: { revision: result.revision, sourceModified: false },
          evidence: [],
          uncertainties: [],
          suggestedNextCalls: [],
          modelRevision: result.revision,
        };
      },
      resolveRef: (a) => engine.resolveRef(a),
      getClaimHistory: (a) => engine.getClaimHistory(a),
      compareRevisions: (a) => engine.compareRevisions(a),
      doctor: () => engine.doctor(),
      status: () => engine.status(),
      initConfig: (a) => engine.initConfig(a),
      mcpConfig: (a) => engine.mcpConfig(a),
    };

    const exitCode = await runCli(argv, ops);
    engine.close();
    process.exit(exitCode);
  } catch (err) {
    console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
