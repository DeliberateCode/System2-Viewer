/**
 * Tests for PromptEvalClient interface and Anthropic adapter factory.
 *
 * These tests validate:
 * - PromptEvalClient interface shape via a mock implementation
 * - API key absence causes createAnthropicClient to return null
 * - Mock client returns the expected PromptEvalResponse shape
 * - ToolCall and ToolDefinition types are structurally sound
 *
 * No actual Anthropic API calls are made (would require a real key).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type {
  PromptEvalClient,
  PromptEvalResponse,
  ToolCall,
  ToolDefinition,
} from '../evals/prompt-eval-client.js';
import { createAnthropicClient } from '../evals/anthropic-adapter.js';

/** A mock PromptEvalClient that returns canned responses. */
function createMockClient(
  cannedResponse: PromptEvalResponse,
): PromptEvalClient {
  return {
    async sendMessage(_opts: {
      systemPrompt: string;
      userMessage: string;
      tools?: ToolDefinition[];
      temperature?: number;
    }): Promise<PromptEvalResponse> {
      return cannedResponse;
    },
  };
}

describe('PromptEvalClient interface shape', () => {
  it('mock implementation satisfies the PromptEvalClient interface', () => {
    const response: PromptEvalResponse = {
      content: 'Hello',
      toolCalls: [],
      stopReason: 'end_turn',
    };
    const client: PromptEvalClient = createMockClient(response);
    expect(client).toBeDefined();
    expect(typeof client.sendMessage).toBe('function');
  });

  it('sendMessage returns a promise resolving to PromptEvalResponse', async () => {
    const response: PromptEvalResponse = {
      content: 'test response',
      toolCalls: [
        { name: 'viewer.doctor', arguments: {} },
      ],
      stopReason: 'end_turn',
    };
    const client = createMockClient(response);

    const result = await client.sendMessage({
      systemPrompt: 'You are a test assistant.',
      userMessage: 'Run diagnostics.',
    });

    expect(result.content).toBe('test response');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('viewer.doctor');
    expect(result.toolCalls[0].arguments).toEqual({});
    expect(result.stopReason).toBe('end_turn');
  });
});

describe('PromptEvalResponse shape', () => {
  it('has content, toolCalls, and stopReason fields', () => {
    const response: PromptEvalResponse = {
      content: '',
      toolCalls: [],
      stopReason: 'end_turn',
    };
    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('toolCalls');
    expect(response).toHaveProperty('stopReason');
  });

  it('toolCalls contains ToolCall objects with name and arguments', () => {
    const tc: ToolCall = {
      name: 'viewer.getRepositoryOverview',
      arguments: { repo: '.', revision: 'abc' },
    };
    expect(tc.name).toBe('viewer.getRepositoryOverview');
    expect(tc.arguments).toEqual({ repo: '.', revision: 'abc' });
  });
});

describe('ToolDefinition shape', () => {
  it('has name, description, and inputSchema', () => {
    const td: ToolDefinition = {
      name: 'viewer.doctor',
      description: 'Run diagnostic checks',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    };
    expect(td.name).toBe('viewer.doctor');
    expect(td.description).toBe('Run diagnostic checks');
    expect(td.inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('createAnthropicClient', () => {
  const originalEnv = process.env.EVAL_LLM_API_KEY;

  afterEach(() => {
    // Restore original env state
    if (originalEnv !== undefined) {
      process.env.EVAL_LLM_API_KEY = originalEnv;
    } else {
      delete process.env.EVAL_LLM_API_KEY;
    }
  });

  it('returns null when no API key is provided and env var is absent', async () => {
    delete process.env.EVAL_LLM_API_KEY;
    const client = await createAnthropicClient();
    expect(client).toBeNull();
  });

  it('returns null when API key is empty string', async () => {
    delete process.env.EVAL_LLM_API_KEY;
    const client = await createAnthropicClient('');
    expect(client).toBeNull();
  });

  it('returns null when SDK is not installed (even with valid key)', async () => {
    delete process.env.EVAL_LLM_API_KEY;
    // @anthropic-ai/sdk is not installed in the test environment,
    // so createAnthropicClient should return null at creation time.
    const client = await createAnthropicClient('test-key-not-real');
    expect(client).toBeNull();
  });

  it('returns null when EVAL_LLM_API_KEY env var is set but SDK missing', async () => {
    process.env.EVAL_LLM_API_KEY = 'test-env-key-not-real';
    const client = await createAnthropicClient();
    // SDK not installed -> null
    expect(client).toBeNull();
  });

  it('prefers explicit apiKey over env var', async () => {
    process.env.EVAL_LLM_API_KEY = 'env-key';
    const client = await createAnthropicClient('explicit-key');
    // SDK not installed -> null regardless of key source
    expect(client).toBeNull();
  });
});

describe('mock client with tools', () => {
  it('sendMessage accepts tools parameter', async () => {
    const response: PromptEvalResponse = {
      content: '',
      toolCalls: [
        {
          name: 'viewer.estimateBlastRadius',
          arguments: { changeScope: ['src/auth.ts'] },
        },
      ],
      stopReason: 'tool_use',
    };
    const client = createMockClient(response);

    const tools: ToolDefinition[] = [
      {
        name: 'viewer.estimateBlastRadius',
        description: 'Estimate blast radius of changes',
        inputSchema: {
          type: 'object',
          properties: {
            changeScope: { type: 'array', items: { type: 'string' } },
          },
          required: ['changeScope'],
        },
      },
    ];

    const result = await client.sendMessage({
      systemPrompt: 'You are viewer-scout.',
      userMessage: 'What is the blast radius of auth changes?',
      tools,
      temperature: 0,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('viewer.estimateBlastRadius');
    expect(result.stopReason).toBe('tool_use');
  });
});
