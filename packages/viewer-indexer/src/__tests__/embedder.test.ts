/**
 * Tests for the embedder module — ONNX Runtime wrapper for local text embedding.
 *
 *
 * Since onnxruntime-node is an optional dependency that is not installed in
 * the test environment, these tests verify graceful degradation: tryLoadEmbedder
 * returns null, probeEmbedderStatus returns 'not_installed', and the Embedder
 * interface shape is correct.
 */
import { describe, it, expect } from 'vitest';
import {
  tryLoadEmbedder,
  probeEmbedderStatus,
  composeEmbeddingText,
  tokenize,
  DEFAULT_MODEL_NAME,
  DEFAULT_DIMENSION,
  type Embedder,
  type EmbedderStatus,
} from '../embedder.js';

describe('tryLoadEmbedder', () => {
  it('returns null when onnxruntime-node is not installed', async () => {
    const result = await tryLoadEmbedder();
    expect(result).toBeNull();
  });

  it('returns null when given a nonexistent model path', async () => {
    const result = await tryLoadEmbedder('/nonexistent/path/model.onnx');
    expect(result).toBeNull();
  });
});

describe('probeEmbedderStatus', () => {
  it('returns not_installed when onnxruntime-node is unavailable', async () => {
    const status = await probeEmbedderStatus();
    expect(status.status).toBe('not_installed');
  });

  it('returns an object conforming to EmbedderStatus shape', async () => {
    const status: EmbedderStatus = await probeEmbedderStatus();
    expect(status).toHaveProperty('status');
    expect(['available', 'not_installed', 'load_failed']).toContain(status.status);
  });
});

describe('Embedder interface shape', () => {
  it('defines expected properties on a mock Embedder', async () => {
    const mock: Embedder = {
      modelName: 'all-MiniLM-L6-v2',
      dimension: 384,
      async embed(_text: string) {
        return new Float32Array(384);
      },
      async embedBatch(texts: string[]) {
        return texts.map(() => new Float32Array(384));
      },
      close() {
        // no-op
      },
    };

    expect(mock.modelName).toBe('all-MiniLM-L6-v2');
    expect(mock.dimension).toBe(384);
    expect(await mock.embed('hello')).toBeInstanceOf(Float32Array);
    expect(await mock.embed('hello')).toHaveLength(384);
    expect(await mock.embedBatch(['a', 'b'])).toHaveLength(2);
    expect((await mock.embedBatch(['a']))[0]).toBeInstanceOf(Float32Array);
    expect(() => mock.close()).not.toThrow();
  });
});

describe('composeEmbeddingText', () => {
  it('composes text for a file node', () => {
    const text = composeEmbeddingText({
      type: 'file',
      path: 'src/index.ts',
      language: 'typescript',
    });
    expect(text).toBe('file: src/index.ts language: typescript');
  });

  it('composes text for a symbol node', () => {
    const text = composeEmbeddingText({
      type: 'symbol',
      displayName: 'createEngine',
      kind: 'function',
      path: 'src/engine.ts',
    });
    expect(text).toBe('symbol: createEngine kind: function in: src/engine.ts');
  });

  it('composes text for a claim', () => {
    const text = composeEmbeddingText({
      type: 'claim',
      statement: 'Module X depends on Y',
      claimType: 'dependency',
    });
    expect(text).toBe('claim: Module X depends on Y type: dependency');
  });

  it('truncates long text to 512 characters', () => {
    const longStatement = 'A'.repeat(600);
    const text = composeEmbeddingText({
      type: 'claim',
      statement: longStatement,
      claimType: 'dependency',
    });
    expect(text.length).toBeLessThanOrEqual(512);
  });

  it('produces deterministic output for same input', () => {
    const input = { type: 'file' as const, path: 'foo.ts', language: 'typescript' };
    const a = composeEmbeddingText(input);
    const b = composeEmbeddingText(input);
    expect(a).toBe(b);
  });
});

describe('tokenize', () => {
  it('produces deterministic output for same input', () => {
    const a = tokenize('hello world');
    const b = tokenize('hello world');
    expect(a.inputIds).toEqual(b.inputIds);
    expect(a.attentionMask).toEqual(b.attentionMask);
  });

  it('starts with CLS token (101) and ends with SEP token (102)', () => {
    const { inputIds, attentionMask } = tokenize('hello');
    expect(inputIds[0]).toBe(101n);
    expect(attentionMask[0]).toBe(1n);
    // SEP follows the one word token
    expect(inputIds[2]).toBe(102n);
    expect(attentionMask[2]).toBe(1n);
  });

  it('pads to maxLen with zeros', () => {
    const { inputIds, attentionMask } = tokenize('hi', 128);
    expect(inputIds.length).toBe(128);
    expect(attentionMask.length).toBe(128);
    // Positions beyond [CLS, "hi", SEP] should be zero
    expect(inputIds[3]).toBe(0n);
    expect(attentionMask[3]).toBe(0n);
  });

  it('truncates long input to maxLen - 2 tokens (room for CLS + SEP)', () => {
    const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const { inputIds, attentionMask } = tokenize(longText, 128);
    expect(inputIds.length).toBe(128);
    // Last position should be SEP
    expect(inputIds[127]).toBe(102n);
    expect(attentionMask[127]).toBe(1n);
  });

  it('handles empty string', () => {
    const { inputIds, attentionMask } = tokenize('');
    expect(inputIds[0]).toBe(101n);
    // SEP immediately after CLS
    expect(inputIds[1]).toBe(102n);
    expect(attentionMask[0]).toBe(1n);
    expect(attentionMask[1]).toBe(1n);
  });

  it('different inputs produce different token IDs', () => {
    const a = tokenize('authentication');
    const b = tokenize('database');
    // The actual word tokens (at index 1) should differ
    expect(a.inputIds[1]).not.toBe(b.inputIds[1]);
  });
});

describe('constants', () => {
  it('exports the default model name', () => {
    expect(DEFAULT_MODEL_NAME).toBe('all-MiniLM-L6-v2');
  });

  it('exports the default dimension', () => {
    expect(DEFAULT_DIMENSION).toBe(384);
  });
});
