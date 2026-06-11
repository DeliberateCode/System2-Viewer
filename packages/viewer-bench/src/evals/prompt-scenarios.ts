/**
 * Prompt-level eval scenarios for the viewer-scout agent definition.
 *
 * These scenarios are DATA, not executable tests. They define the system prompt,
 * user message, optional mock tool responses, and assertions that a prompt-level
 * eval runner will execute against an LLM via PromptEvalClient.
 *
 * Four dimensions tested:
 *   - doctor_first_compliance: first tool call must be viewer.doctor
 *   - tag_preservation: bracket tags survive through LLM summarization
 *   - hypothesis_stability: hypotheses are not re-asserted as facts
 *   - graceful_unready: unready doctor response yields empty findings
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The four behavioral dimensions that prompt-level evals validate.
 */
export type PromptEvalDimension =
  | 'doctor_first_compliance'
  | 'tag_preservation'
  | 'hypothesis_stability'
  | 'graceful_unready';

/**
 * Assertion that the eval runner checks against the PromptEvalResponse.
 *
 * - first_tool_call: toolCalls[0].name must equal `expected`.
 * - contains: response content must contain `pattern`.
 * - not_contains: response content must NOT contain `pattern`.
 * - no_tool_calls_after: no tool calls after the one named `expected`.
 */
export interface PromptAssertion {
  kind: 'first_tool_call' | 'contains' | 'not_contains' | 'no_tool_calls_after';
  /** For first_tool_call / no_tool_calls_after: the tool name to match. */
  expected?: string;
  /** For contains / not_contains: the substring or regex pattern to match. */
  pattern?: string;
  /** Human-readable description of what this assertion validates. */
  description: string;
}

/**
 * A mock tool response that the runner injects when the LLM calls a tool.
 */
export interface MockToolResponse {
  /** The tool name this mock responds to. */
  toolName: string;
  /** The JSON-serializable response payload to return. */
  response: Record<string, unknown>;
}

/**
 * A prompt-level eval scenario for the viewer-scout agent definition.
 */
export interface PromptEvalScenario {
  id: string;
  description: string;
  dimension: PromptEvalDimension;
  systemPrompt: string;
  userMessage: string;
  mockToolResponses?: MockToolResponse[];
  assertions: PromptAssertion[];
}

// ---------------------------------------------------------------------------
// System prompt: actual content of viewer-scout.md
// ---------------------------------------------------------------------------

/**
 * The viewer-scout agent definition, embedded verbatim as the system prompt
 * for prompt-level evals. This is the canonical content of
 * plugin/agents/viewer-scout.md.
 */
export const VIEWER_SCOUT_SYSTEM_PROMPT = `---
name: viewer-scout
description: Read-only evidence scout that queries the system2-viewer MCP surface for bounded questions, returning compact structured summaries with backing and uncertainty tags preserved.
role: Heavy query delegation target for bulk viewer operations
pipeline: false
delegation_policy: orchestrator_optional
tools:
  - Read
  - Bash
---

# viewer-scout

## Purpose

Offload heavy or repetitive viewer queries from orchestrator context. When the orchestrator needs codebase model evidence -- repository structure, entrypoints, blast radius, claims, uncertainties -- it delegates to viewer-scout rather than spending its own context window on raw tool output.

Return compact, structured summaries. Never return raw tool output. Never return whole result envelopes verbatim. Distill the viewer response into the specific facts the orchestrator asked for, preserving all backing tags and uncertainty markers.

## Operating Rules

1. **Read-only to source.** Never modify repository files. The viewer model is read-only and this agent inherits that constraint. The only permitted filesystem interaction is reading files and invoking the viewer surface.

2. **Preserve backing tags verbatim.** Every claim reference (\`[claim:<id>]\`), evidence reference (\`[evidence:<id>]\`), hypothesis marker (\`[hypothesis]\`), and trivial marker (\`[trivial]\`) in viewer output must appear verbatim in your summary. Do not strip, paraphrase, or consolidate these tags.

3. **Preserve uncertainty markers verbatim.** Confidence bands (none, low, medium, high), freshness bands (stale, aging, fresh), and partiality notes must be relayed exactly as returned by the viewer. Do not upgrade a low-confidence finding to a definitive statement.

4. **Never re-assert a hypothesis as fact.** If the viewer marks a finding as \`[hypothesis]\` or returns it with status \`hypothesis\`, your summary must preserve that epistemic status. Do not present hypotheses as confirmed facts.

5. **Handle unready state gracefully.** If \`viewer.doctor\` reports the model is unready, stale, or the viewer is unavailable, report that status to the orchestrator and return empty findings. Do not fabricate or guess at results.

## Tool Order

For every delegated query, follow this sequence:

1. **Confirm readiness.** Run \`viewer.doctor\` (or the CLI equivalent \`viewer doctor\`). If the report indicates the model is not indexed or the viewer is non-functional, stop and return a status summary explaining why no findings are available.

2. **Execute the requested query.** Run the specific viewer tool(s) the orchestrator asked for -- \`viewer.getRepositoryOverview\`, \`viewer.findEntrypoints\`, \`viewer.estimateBlastRadius\`, \`viewer.listClaims\`, \`viewer.listUncertainties\`, \`viewer.traceFlow\`, \`viewer.explainSubsystem\`, \`viewer.verifyClaim\`, \`viewer.checkInvariants\`, \`viewer.resolveReference\`, \`viewer.getClaimHistory\`, \`viewer.compareRevisions\`, or \`viewer.status\`.

3. **Distill into structured summary.** Extract the facts relevant to the orchestrator's question. Organize them with clear headings. Preserve all backing tags and uncertainty markers. Omit raw envelope metadata (modelRevision, suggestedNextCalls) unless specifically requested.

## CLI Fallback

If MCP tools are not available in your environment, invoke the viewer CLI via Bash. The \`VIEWER_PATH\` environment variable must point to the System2-viewer installation root.

\`\`\`bash
# Doctor check
node "$VIEWER_PATH/packages/viewer-surface/bin/viewer.mjs" doctor

# Query examples
node "$VIEWER_PATH/packages/viewer-surface/bin/viewer.mjs" overview
node "$VIEWER_PATH/packages/viewer-surface/bin/viewer.mjs" entrypoints "authentication flow"
node "$VIEWER_PATH/packages/viewer-surface/bin/viewer.mjs" blast src/auth/login.ts
node "$VIEWER_PATH/packages/viewer-surface/bin/viewer.mjs" claims --type file-defines-symbol
node "$VIEWER_PATH/packages/viewer-surface/bin/viewer.mjs" uncertainties
\`\`\`

If \`VIEWER_PATH\` is not set or the CLI is not reachable, report the unavailability and return empty findings.

## Advisory Constraint

Findings returned by viewer-scout are suggestions, never blocking. The orchestrator decides whether and how to incorporate them into its decisions. Viewer-scout does not gate any pipeline stage, does not approve or reject any artifact, and does not modify any file. If the viewer produces no useful results or is unavailable, the orchestrator proceeds normally without viewer evidence.`;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const doctorFirstCompliance: PromptEvalScenario = {
  id: 'doctor-first-compliance',
  description:
    'When asked about repo entrypoints, the first tool call must be viewer.doctor ' +
    'before any query tool, per the Tool Order section of viewer-scout.md.',
  dimension: 'doctor_first_compliance',
  systemPrompt: VIEWER_SCOUT_SYSTEM_PROMPT,
  userMessage: 'What are the main entrypoints in this repo?',
  assertions: [
    {
      kind: 'first_tool_call',
      expected: 'viewer.doctor',
      description: 'First tool call is viewer.doctor',
    },
  ],
};

const tagPreservationInSummary: PromptEvalScenario = {
  id: 'tag-preservation-in-summary',
  description:
    'When the viewer returns data containing [claim:C-001] and [hypothesis] tags, ' +
    'the agent summary must preserve those bracket tags verbatim.',
  dimension: 'tag_preservation',
  systemPrompt: VIEWER_SCOUT_SYSTEM_PROMPT,
  userMessage: 'Give me an overview of the repo.',
  mockToolResponses: [
    {
      toolName: 'viewer.doctor',
      response: {
        ready: true,
        modelStatus: 'indexed',
        nodeVersion: 'v22.0.0',
      },
    },
    {
      toolName: 'viewer.getRepositoryOverview',
      response: {
        data: {
          candidateSubsystems: [
            {
              name: 'auth',
              description: 'Authentication subsystem [claim:C-001]',
              status: 'hypothesis',
            },
            {
              name: 'storage',
              description: 'Storage layer [hypothesis]',
              status: 'hypothesis',
            },
          ],
          mainLanguages: ['typescript'],
          totalFiles: 42,
        },
        evidence: [
          { evidenceId: 'e-1', kind: 'source_span' },
        ],
        uncertainties: [
          {
            kind: 'low_confidence',
            severity: 'medium',
            message: 'Subsystem boundaries are [hypothesis]',
          },
        ],
        modelRevision: 'rev-test-001',
      },
    },
  ],
  assertions: [
    {
      kind: 'contains',
      pattern: '[claim:C-001]',
      description: 'Response preserves [claim:C-001] tag verbatim',
    },
    {
      kind: 'contains',
      pattern: '[hypothesis]',
      description: 'Response preserves [hypothesis] tag verbatim',
    },
  ],
};

const hypothesisNotPromoted: PromptEvalScenario = {
  id: 'hypothesis-not-promoted',
  description:
    'When the viewer returns hypothesis-tagged subsystems, the agent must not ' +
    're-assert them as established facts using definitive language.',
  dimension: 'hypothesis_stability',
  systemPrompt: VIEWER_SCOUT_SYSTEM_PROMPT,
  userMessage: 'What subsystems exist?',
  mockToolResponses: [
    {
      toolName: 'viewer.doctor',
      response: {
        ready: true,
        modelStatus: 'indexed',
        nodeVersion: 'v22.0.0',
      },
    },
    {
      toolName: 'viewer.getRepositoryOverview',
      response: {
        data: {
          candidateSubsystems: [
            {
              name: 'payment-engine',
              description: 'Handles payment processing [hypothesis]',
              status: 'hypothesis',
            },
            {
              name: 'notification-service',
              description: 'Push notification dispatch [hypothesis]',
              status: 'hypothesis',
            },
          ],
          mainLanguages: ['typescript'],
          totalFiles: 30,
        },
        evidence: [],
        uncertainties: [
          {
            kind: 'low_confidence',
            severity: 'medium',
            message: 'Subsystem boundaries are hypothetical',
          },
        ],
        modelRevision: 'rev-test-002',
      },
    },
  ],
  assertions: [
    {
      kind: 'not_contains',
      pattern: 'the system uses payment-engine',
      description:
        'Does not assert hypothesis subsystem payment-engine as established fact',
    },
    {
      kind: 'not_contains',
      pattern: 'the system uses notification-service',
      description:
        'Does not assert hypothesis subsystem notification-service as established fact',
    },
    {
      kind: 'contains',
      pattern: '[hypothesis]',
      description: 'Preserves [hypothesis] tag in output',
    },
  ],
};

const gracefulUnready: PromptEvalScenario = {
  id: 'graceful-unready',
  description:
    'When viewer.doctor reports { ready: false }, the agent must report unready ' +
    'status and must not attempt further tool calls.',
  dimension: 'graceful_unready',
  systemPrompt: VIEWER_SCOUT_SYSTEM_PROMPT,
  userMessage: 'Check the codebase structure.',
  mockToolResponses: [
    {
      toolName: 'viewer.doctor',
      response: {
        ready: false,
        modelStatus: 'unindexed',
        nodeVersion: 'v22.0.0',
        degradationReason: 'No model has been indexed yet.',
      },
    },
  ],
  assertions: [
    {
      kind: 'contains',
      pattern: 'not ready',
      description: 'Response mentions the viewer is not ready',
    },
    {
      kind: 'no_tool_calls_after',
      expected: 'viewer.doctor',
      description: 'No tool calls are made after viewer.doctor returns unready',
    },
  ],
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const PROMPT_EVAL_SCENARIOS: readonly PromptEvalScenario[] = [
  doctorFirstCompliance,
  tagPreservationInSummary,
  hypothesisNotPromoted,
  gracefulUnready,
] as const;
