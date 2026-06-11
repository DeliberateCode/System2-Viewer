/**
 * Tests for viewer-retrieval envelope construction and validation.
 *
 */
import { describe, it, expect } from 'vitest';
import { buildEnvelope, assertStructured } from '../envelope.js';

// ---------------------------------------------------------------------------
// assertStructured - rejection cases
// ---------------------------------------------------------------------------

describe('assertStructured', () => {
  it('rejects strings', () => {
    expect(() => assertStructured('hello')).toThrow(TypeError);
    expect(() => assertStructured('hello')).toThrow('got string');
  });

  it('rejects null', () => {
    expect(() => assertStructured(null)).toThrow(TypeError);
    expect(() => assertStructured(null)).toThrow('null or undefined');
  });

  it('rejects undefined', () => {
    expect(() => assertStructured(undefined)).toThrow(TypeError);
    expect(() => assertStructured(undefined)).toThrow('null or undefined');
  });

  it('rejects non-object primitives', () => {
    expect(() => assertStructured(42)).toThrow(TypeError);
    expect(() => assertStructured(true)).toThrow(TypeError);
  });

  it('rejects object missing data', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test', args: {} },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('data is required');
  });

  it('rejects object with null data', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test', args: {} },
        data: null,
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('data must not be null');
  });

  it('rejects object missing query', () => {
    expect(() =>
      assertStructured({
        data: { result: 'ok' },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('query');
  });

  it('rejects query without op', () => {
    expect(() =>
      assertStructured({
        query: { args: {} },
        data: { result: 'ok' },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('query.op');
  });

  it('rejects query with empty op', () => {
    expect(() =>
      assertStructured({
        query: { op: '', args: {} },
        data: { result: 'ok' },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('query.op');
  });

  it('rejects query without args', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test' },
        data: { result: 'ok' },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('query.args');
  });

  it('rejects empty modelRevision', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test', args: {} },
        data: { result: 'ok' },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: '',
      }),
    ).toThrow('modelRevision');
  });

  it('rejects missing modelRevision', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test', args: {} },
        data: { result: 'ok' },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: [],
      }),
    ).toThrow('modelRevision');
  });

  it('rejects non-array evidence', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test', args: {} },
        data: { result: 'ok' },
        evidence: 'not-array',
        uncertainties: [],
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('evidence must be an array');
  });

  it('rejects non-array uncertainties', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test', args: {} },
        data: { result: 'ok' },
        evidence: [],
        uncertainties: 'not-array',
        suggestedNextCalls: [],
        modelRevision: 'rev-1',
      }),
    ).toThrow('uncertainties must be an array');
  });

  it('rejects non-array suggestedNextCalls', () => {
    expect(() =>
      assertStructured({
        query: { op: 'test', args: {} },
        data: { result: 'ok' },
        evidence: [],
        uncertainties: [],
        suggestedNextCalls: 'not-array',
        modelRevision: 'rev-1',
      }),
    ).toThrow('suggestedNextCalls must be an array');
  });

  it('accepts a valid envelope', () => {
    const valid = {
      query: { op: 'getOverview', args: { repo: 'r1' } },
      data: { files: 42 },
      evidence: [
        {
          evidenceId: 'e1',
          kind: 'test_result',
          path: null,
          revision: 'r1',
          extractor: 'vitest',
        },
      ],
      uncertainties: [],
      suggestedNextCalls: [],
      modelRevision: 'rev-abc',
    };
    expect(() => assertStructured(valid)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope
// ---------------------------------------------------------------------------

describe('buildEnvelope', () => {
  it('constructs a correct envelope shape', () => {
    const envelope = buildEnvelope({
      op: 'getRepositoryOverview',
      args: { repoId: 'repo-1' },
      data: { files: 100 },
      modelRevision: 'rev-abc',
    });

    expect(envelope.query.op).toBe('getRepositoryOverview');
    expect(envelope.query.args).toEqual({ repoId: 'repo-1' });
    expect(envelope.data).toEqual({ files: 100 });
    expect(envelope.evidence).toEqual([]);
    expect(envelope.uncertainties).toEqual([]);
    expect(envelope.suggestedNextCalls).toEqual([]);
    expect(envelope.modelRevision).toBe('rev-abc');
    expect(envelope.partiality).toBeUndefined();
  });

  it('fills optional arrays with empty arrays when not provided', () => {
    const envelope = buildEnvelope({
      op: 'test',
      args: {},
      data: { ok: true },
      modelRevision: 'rev-1',
    });

    expect(Array.isArray(envelope.evidence)).toBe(true);
    expect(Array.isArray(envelope.uncertainties)).toBe(true);
    expect(Array.isArray(envelope.suggestedNextCalls)).toBe(true);
  });

  it('includes partiality when provided', () => {
    const envelope = buildEnvelope({
      op: 'test',
      args: {},
      data: { ok: true },
      modelRevision: 'rev-1',
      partiality: {
        ref: 'partiality-1',
        scopes: [{ id: 's1', scope: 'python' }],
      },
    });

    expect(envelope.partiality).toBeDefined();
    expect(envelope.partiality!.ref).toBe('partiality-1');
  });

  it('includes extractionQuality when provided', () => {
    const envelope = buildEnvelope({
      op: 'test',
      args: {},
      data: { ok: true },
      modelRevision: 'rev-1',
      extractionQuality: {
        backend: 'treesitter',
        grammarsUsed: ['typescript', 'json'],
        partialityLevel: 'partial',
      },
    });

    expect(envelope.extractionQuality).toBeDefined();
    expect(envelope.extractionQuality!.backend).toBe('treesitter');
    expect(envelope.extractionQuality!.grammarsUsed).toEqual(['typescript', 'json']);
    expect(envelope.extractionQuality!.partialityLevel).toBe('partial');
  });

  it('omits extractionQuality when not provided', () => {
    const envelope = buildEnvelope({
      op: 'test',
      args: {},
      data: { ok: true },
      modelRevision: 'rev-1',
    });

    expect(envelope.extractionQuality).toBeUndefined();
  });

  it('includes extractionQuality alongside partiality', () => {
    const envelope = buildEnvelope({
      op: 'test',
      args: {},
      data: { ok: true },
      modelRevision: 'rev-1',
      partiality: {
        ref: 'partiality-1',
        scopes: [{ id: 's1', scope: 'typescript' }],
      },
      extractionQuality: {
        backend: 'lsp',
        grammarsUsed: ['typescript'],
        partialityLevel: 'none',
      },
    });

    expect(envelope.partiality).toBeDefined();
    expect(envelope.extractionQuality).toBeDefined();
    expect(envelope.extractionQuality!.backend).toBe('lsp');
  });

  it('produces an envelope that passes assertStructured', () => {
    const envelope = buildEnvelope({
      op: 'findEntrypoints',
      args: { intent: 'main entry' },
      data: { candidates: [] },
      evidence: [
        {
          evidenceId: 'e1',
          kind: 'test_result',
          path: null,
          revision: 'r1',
          extractor: 'indexer',
        },
      ],
      modelRevision: 'rev-123',
    });

    expect(() => assertStructured(envelope)).not.toThrow();
  });
});
