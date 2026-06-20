/**
 * Anthropic Claude API adapter for prompt-level behavioral evals.
 *
 * Uses @anthropic-ai/sdk (optional dependency). If the SDK is not installed,
 * createAnthropicClient returns null rather than throwing.
 *
 * The API key is read from process.env.EVAL_LLM_API_KEY or passed directly.
 * The key is NEVER logged, stored in files, or included in reports.
 */

import type {
  PromptEvalClient,
  PromptEvalResponse,
  ToolCall,
  ToolDefinition,
} from './prompt-eval-client.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_TEMPERATURE = 0;

/**
 * Cached SDK availability: undefined = not checked, null = unavailable,
 * otherwise the loaded module.
 */
let _sdkCache: AnthropicSdkShape | null | undefined;

async function defaultImportSdk(): Promise<AnthropicSdkShape | null> {
  try {
    return await import('@anthropic-ai/sdk' as string) as unknown as AnthropicSdkShape;
  } catch {
    return null;
  }
}

/** @internal Exposed for testing — allows mocking SDK import and resetting cache. */
export const _internals = {
  importSdk: defaultImportSdk,
  resetSdkCache(): void { _sdkCache = undefined; },
};

/**
 * Eagerly probes whether @anthropic-ai/sdk can be resolved.
 * Caches the result so the dynamic import only runs once.
 */
async function probeSdk(): Promise<AnthropicSdkShape | null> {
  if (_sdkCache !== undefined) return _sdkCache;
  _sdkCache = await _internals.importSdk();
  return _sdkCache;
}

/**
 * Creates a PromptEvalClient backed by the Anthropic Claude Messages API.
 *
 * @param apiKey - Optional API key. Falls back to process.env.EVAL_LLM_API_KEY.
 * @returns A PromptEvalClient, or null if no API key is available or if
 *          @anthropic-ai/sdk is not installed.
 */
export async function createAnthropicClient(
  apiKey?: string,
): Promise<PromptEvalClient | null> {
  const key = apiKey ?? process.env.EVAL_LLM_API_KEY;
  if (!key) return null;

  // Eagerly validate SDK availability at creation time so callers get null
  // instead of a deferred runtime crash in sendMessage.
  const sdk = await probeSdk();
  if (!sdk) return null;

  const resolvedKey = key;

  return {
    async sendMessage(opts: {
      systemPrompt: string;
      userMessage: string;
      tools?: ToolDefinition[];
      temperature?: number;
    }): Promise<PromptEvalResponse> {
      const client = new sdk.default({ apiKey: resolvedKey });

      const toolDefs = opts.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Record<string, unknown>,
      }));

      const response = await client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        system: opts.systemPrompt,
        messages: [{ role: 'user' as const, content: opts.userMessage }],
        ...(toolDefs && toolDefs.length > 0 ? { tools: toolDefs } : {}),
      });

      return mapResponse(response);
    },
  };
}

/**
 * Minimal interface for the subset of @anthropic-ai/sdk we use.
 * Defined inline to avoid a compile-time dependency on the optional package.
 */
interface AnthropicSdkShape {
  default: new (opts: { apiKey: string }) => {
    messages: {
      create(params: Record<string, unknown>): Promise<{
        content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
        stop_reason: string | null;
      }>;
    };
  };
}


/** Maps an Anthropic Messages API response to our PromptEvalResponse shape. */
function mapResponse(response: {
  content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  stop_reason: string | null;
}): PromptEvalResponse {
  let content = '';
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      content += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        name: block.name ?? '',
        arguments: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }

  return {
    content,
    toolCalls,
    stopReason: response.stop_reason ?? 'unknown',
  };
}
