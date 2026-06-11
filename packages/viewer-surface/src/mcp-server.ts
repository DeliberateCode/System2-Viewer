/**
 * McpToolServer: registers all 21 MCP tools, validates untrusted input,
 * handles pre-dispatch reference resolution, and serves via stdio transport.
 *
 * No network imports. No port binding. No URL. No token.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { assertStructured, buildEnvelope } from '@system2-viewer/viewer-retrieval';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
const VERSION: string = pkg.version;

import { TOOL_TABLE } from './tool-table.js';
import type { ToolEntry } from './tool-table.js';
import { validateUntrustedInput } from './validate-input.js';
import { resolvePreDispatch } from './resolve-pre-dispatch.js';
import type { ResolveRefFn } from './resolve-pre-dispatch.js';
import type {
  ViewerOperations,
  FeedbackOperations,
  IndexerLike,
  ToolDescriptor,
} from './types.js';

/**
 * McpToolServer registers all 21 tools and serves via stdio transport.
 */
export class McpToolServer {
  private readonly server: McpServer;
  private ops: ViewerOperations | null = null;
  private feedback: FeedbackOperations | null = null;
  private indexer: IndexerLike | null = null;
  private resolveRef: ResolveRefFn | null = null;

  constructor() {
    this.server = new McpServer(
      {
        name: 'system2-viewer',
        version: VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );
  }

  /**
   * Binds all 21 tools to the provided operations, feedback, and indexer.
   */
  register(
    ops: ViewerOperations & {
      resolveRef?: ResolveRefFn;
      doctor?: () => Promise<ResultEnvelope<unknown>>;
      status?: () => ResultEnvelope<unknown>;
      getClaimHistory?: (input: { claimId: string }) => ResultEnvelope<unknown>;
      compareRevisions?: (input: { revA: string; revB: string }) => ResultEnvelope<unknown>;
    },
    feedback: FeedbackOperations,
    indexer: IndexerLike,
  ): void {
    this.ops = ops;
    this.feedback = feedback;
    this.indexer = indexer;
    this.resolveRef = ops.resolveRef ?? null;

    for (const entry of TOOL_TABLE) {
      this.registerTool(entry, ops, feedback, indexer);
    }
  }

  /**
   * Connects stdio transport and starts listening.
   * No port binding, no URL, no network.
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Returns tool descriptors for all 21 tools.
   */
  toolPartition(): ToolDescriptor[] {
    return TOOL_TABLE.map(entry => ({
      name: entry.name,
      capability: entry.capabilityClass,
      mutatesModel: entry.capabilityClass !== 'read',
    }));
  }

  /**
   * Direct invocation for testing -- calls the tool handler
   * without going through the MCP transport layer.
   */
  async invoke(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ResultEnvelope<unknown>> {
    if (!this.ops || !this.feedback || !this.indexer) {
      throw new Error('McpToolServer.register() must be called before invoke()');
    }

    const entry = TOOL_TABLE.find(t => t.name === name);
    if (!entry) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return this.executeHandler(
      entry,
      args,
      this.ops,
      this.feedback,
      this.indexer,
    );
  }

  // -- Private helpers --

  private registerTool(
    entry: ToolEntry,
    ops: ViewerOperations & {
      resolveRef?: ResolveRefFn;
      doctor?: () => Promise<ResultEnvelope<unknown>>;
      status?: () => ResultEnvelope<unknown>;
      getClaimHistory?: (input: { claimId: string }) => ResultEnvelope<unknown>;
      compareRevisions?: (input: { revA: string; revB: string }) => ResultEnvelope<unknown>;
    },
    feedback: FeedbackOperations,
    indexer: IndexerLike,
  ): void {
    // Use the MCP SDK's registerTool with Zod schema
    this.server.registerTool(
      entry.name,
      {
        description: entry.description,
        inputSchema: entry.inputSchema,
      },
      async (args: Record<string, unknown>) => {
        const envelope = await this.executeHandler(
          entry,
          args ?? {},
          ops,
          feedback,
          indexer,
        );

        const text = JSON.stringify(envelope);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: envelope as unknown as Record<string, unknown>,
        };
      },
    );
  }

  private async executeHandler(
    entry: ToolEntry,
    rawArgs: Record<string, unknown>,
    ops: ViewerOperations & {
      resolveRef?: ResolveRefFn;
      doctor?: () => Promise<ResultEnvelope<unknown>>;
      status?: () => ResultEnvelope<unknown>;
      getClaimHistory?: (input: { claimId: string }) => ResultEnvelope<unknown>;
      compareRevisions?: (input: { revA: string; revB: string }) => ResultEnvelope<unknown>;
    },
    feedback: FeedbackOperations,
    indexer: IndexerLike,
  ): Promise<ResultEnvelope<unknown>> {
    // (a) Validate untrusted input
    validateUntrustedInput(rawArgs);

    // (b) Pre-dispatch reference resolution for applicable tools
    let args = rawArgs;
    if (entry.preDispatch && this.resolveRef) {
      // For blast radius, changeScope is an array -- resolve each element
      if (entry.handlerKey === 'estimateBlastRadius' && Array.isArray(rawArgs['changeScope'])) {
        const resolvedScope: string[] = [];
        for (const item of rawArgs['changeScope'] as unknown[]) {
          if (typeof item === 'string') {
            const outcome = resolvePreDispatch(
              { ref: item },
              this.resolveRef,
              { argName: 'ref', hint: entry.preDispatch.hint },
            );
            if (outcome.status === 'early-return') {
              return outcome.envelope as ResultEnvelope<unknown>;
            }
            resolvedScope.push(
              (outcome.args['ref'] as string) ?? item,
            );
          } else {
            resolvedScope.push(String(item));
          }
        }
        args = { ...rawArgs, changeScope: resolvedScope };
      } else {
        const outcome = resolvePreDispatch(
          rawArgs,
          this.resolveRef,
          entry.preDispatch,
        );
        if (outcome.status === 'early-return') {
          return outcome.envelope as ResultEnvelope<unknown>;
        }
        args = outcome.args;
      }
    }

    // (c) Call the underlying operation
    let result: ResultEnvelope<unknown>;

    try {
      switch (entry.capabilityClass) {
        case 'read':
          result = await this.dispatchRead(entry.handlerKey, args, ops);
          break;
        case 'verify':
          result = await this.dispatchRead(entry.handlerKey, args, ops);
          break;
        case 'feedback':
          result = this.dispatchFeedback(entry.handlerKey, args, feedback);
          break;
        case 'index':
          result = await this.dispatchIndex(args, indexer);
          break;
        default:
          throw new Error(`Unknown capability class: ${entry.capabilityClass as string}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Tool "${entry.name}" failed: ${msg}. Check the arguments and ensure the model is indexed.`,
        { cause: err },
      );
    }

    // (d) Assert structured envelope
    assertStructured(result);

    return result;
  }

  private async dispatchRead(
    handlerKey: string,
    args: Record<string, unknown>,
    ops: ViewerOperations & {
      resolveRef?: ResolveRefFn;
      doctor?: () => Promise<ResultEnvelope<unknown>>;
      status?: () => ResultEnvelope<unknown>;
      getClaimHistory?: (input: { claimId: string }) => ResultEnvelope<unknown>;
      compareRevisions?: (input: { revA: string; revB: string }) => ResultEnvelope<unknown>;
    },
  ): Promise<ResultEnvelope<unknown>> {
    switch (handlerKey) {
      case 'doctor':
        if (ops.doctor) return await ops.doctor();
        throw new Error('doctor operation not available');
      case 'status':
        if (ops.status) return ops.status();
        return buildEnvelope({
          op: 'status',
          args: {},
          data: { modelRevision: 'unknown', readinessState: 'unknown' },
          evidence: [],
          uncertainties: [],
          suggestedNextCalls: [],
          modelRevision: 'unknown',
        });
      case 'getRepositoryOverview':
        return ops.getRepositoryOverview(args);
      case 'findEntrypoints':
        return ops.findEntrypoints(args);
      case 'traceFlow':
        return ops.traceFlow(args);
      case 'explainSubsystem':
        return ops.explainSubsystem(args);
      case 'estimateBlastRadius':
        return ops.estimateBlastRadius(args);
      case 'verifyClaim':
        return ops.verifyClaim(args);
      case 'listClaims':
        return ops.listClaims(args);
      case 'listUncertainties':
        return ops.listUncertainties(args);
      case 'checkInvariants':
        return ops.checkInvariants(args);
      case 'resolveReference':
        if (ops.resolveRef) {
          return ops.resolveRef({
            input: args['input'] as string,
            hint: args['hint'] as 'path' | 'symbol' | 'claim' | 'subsystem' | 'intent' | 'raw-id' | undefined,
          });
        }
        throw new Error('resolveReference operation not available');
      case 'getClaimHistory':
        if (ops.getClaimHistory) {
          return ops.getClaimHistory({ claimId: args['claimId'] as string });
        }
        throw new Error('getClaimHistory operation not available');
      case 'compareRevisions':
        if (ops.compareRevisions) {
          return ops.compareRevisions({
            revA: args['revA'] as string,
            revB: args['revB'] as string,
          });
        }
        throw new Error('compareRevisions operation not available');
      default:
        throw new Error(`Unknown read handler: ${handlerKey}`);
    }
  }

  private dispatchFeedback(
    handlerKey: string,
    args: Record<string, unknown>,
    feedback: FeedbackOperations,
  ): ResultEnvelope<unknown> {
    let summary;
    switch (handlerKey) {
      case 'confirmClaim':
        summary = feedback.confirmClaim({
          claimId: args['claimId'] as string,
          actor: args['actor'] as string,
          note: args['note'] as string | undefined,
        });
        break;
      case 'rejectClaim':
        summary = feedback.rejectClaim({
          claimId: args['claimId'] as string,
          actor: args['actor'] as string,
          note: args['note'] as string | undefined,
        });
        break;
      case 'annotateClaim':
        summary = feedback.annotateClaim({
          claimId: args['claimId'] as string,
          actor: args['actor'] as string,
          annotation: args['annotation'] as string,
        });
        break;
      case 'confirmSubsystem':
        summary = feedback.confirmSubsystem({
          targetId: args['targetId'] as string,
          actor: args['actor'] as string,
          note: args['note'] as string | undefined,
        });
        break;
      case 'rejectSubsystem':
        summary = feedback.rejectSubsystem({
          targetId: args['targetId'] as string,
          actor: args['actor'] as string,
          note: args['note'] as string | undefined,
        });
        break;
      case 'annotateSubsystem':
        summary = feedback.annotateSubsystem({
          targetId: args['targetId'] as string,
          actor: args['actor'] as string,
          annotation: args['annotation'] as string,
        });
        break;
      default:
        throw new Error(`Unknown feedback handler: ${handlerKey}`);
    }

    return buildEnvelope({
      op: handlerKey,
      args,
      data: summary,
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'latest',
    });
  }

  private async dispatchIndex(
    args: Record<string, unknown>,
    indexer: IndexerLike,
  ): Promise<ResultEnvelope<unknown>> {
    // Defense-in-depth: reject path-traversal before reaching the indexer.
    // Check each path SEGMENT for '..' (not substring match) so paths
    // like "/tmp/my..repo" are allowed.
    const repoRoot = args['repoRoot'] as string;
    // Security check: split on both separators for cross-platform safety
    if (typeof repoRoot === 'string' && repoRoot.split(/[/\\]/).some((seg) => seg === '..')) {
      throw new Error(
        `repoRoot must not contain ".." path segments: ${repoRoot}`,
      );
    }

    const result = await indexer.index({
      repoRoot,
      depth: args['depth'] as number | undefined,
      full: args['full'] as boolean | undefined,
      workspace: args['workspace'] as 'auto' | 'force' | 'off' | undefined,
      workspaceDepth: args['workspaceDepth'] as number | undefined,
      workspaceMaxRepos: args['workspaceMaxRepos'] as number | undefined,
      skipEmbed: args['skipEmbed'] as boolean | undefined,
    });

    return buildEnvelope({
      op: 'index',
      args,
      data: { revision: result.revision, sourceModified: false },
      evidence: [],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: result.revision,
    });
  }
}
