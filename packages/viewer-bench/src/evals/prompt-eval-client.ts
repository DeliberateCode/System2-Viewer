/**
 * PromptEvalClient interface and associated types for prompt-level behavioral evals.
 *
 * This is test infrastructure only. The PromptEvalClient abstraction allows
 * prompt-level evals to invoke an LLM and validate behavioral properties of
 * the response (tool call ordering, tag preservation, hypothesis stability).
 */

/** A tool definition passed to the LLM for tool-use scenarios. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A tool call extracted from the LLM response. */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** The structured response from a prompt eval invocation. */
export interface PromptEvalResponse {
  content: string;
  toolCalls: ToolCall[];
  stopReason: string;
}

/**
 * Thin adapter interface for LLM API invocation in prompt-level evals.
 *
 * Primary implementation: Anthropic Claude API (Messages API).
 * The interface is intentionally narrow to keep adapter implementations simple.
 */
export interface PromptEvalClient {
  sendMessage(opts: {
    systemPrompt: string;
    userMessage: string;
    tools?: ToolDefinition[];
    temperature?: number;
  }): Promise<PromptEvalResponse>;
}
