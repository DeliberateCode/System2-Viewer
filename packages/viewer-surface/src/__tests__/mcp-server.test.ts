/**
 * Tests for MCP server tool table and capability classification.
 *
 * These tests verify the tool registration contract without starting
 * the stdio transport -- they exercise the tool table and capability
 * module directly.
 *
 */
import { describe, it, expect } from 'vitest';
import { TOOL_TABLE } from '../tool-table.js';
import { allToolDescriptors, capabilityClassOf } from '../capability.js';
import { McpToolServer } from '../mcp-server.js';
import type { ViewerOperations, FeedbackOperations, IndexerLike } from '../types.js';

// ---------------------------------------------------------------------------
// Tool count verification
// ---------------------------------------------------------------------------

describe('TOOL_TABLE', () => {
  it('has exactly 21 entries', () => {
    expect(TOOL_TABLE).toHaveLength(21);
  });

  it('has no duplicate tool names', () => {
    const names = TOOL_TABLE.map(t => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every entry has all required fields', () => {
    for (const entry of TOOL_TABLE) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.inputSchema).toBeDefined();
      expect(['read', 'feedback', 'verify', 'index']).toContain(entry.capabilityClass);
      expect(typeof entry.handlerKey).toBe('string');
    }
  });

  it('all tool names are prefixed with "viewer."', () => {
    for (const entry of TOOL_TABLE) {
      expect(entry.name.startsWith('viewer.')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool name enumeration matches stable contract
// ---------------------------------------------------------------------------

describe('tool name enumeration', () => {
  const expectedNames = [
    'viewer.doctor',
    'viewer.status',
    'viewer.getRepositoryOverview',
    'viewer.findEntrypoints',
    'viewer.traceFlow',
    'viewer.explainSubsystem',
    'viewer.estimateBlastRadius',
    'viewer.verifyClaim',
    'viewer.listClaims',
    'viewer.listUncertainties',
    'viewer.checkInvariants',
    'viewer.resolveReference',
    'viewer.getClaimHistory',
    'viewer.compareRevisions',
    'viewer.confirmClaim',
    'viewer.rejectClaim',
    'viewer.annotateClaim',
    'viewer.confirmSubsystem',
    'viewer.rejectSubsystem',
    'viewer.annotateSubsystem',
    'viewer.index',
  ];

  it('allToolDescriptors returns names matching the stable contract', () => {
    const descriptors = allToolDescriptors();
    const actualNames = descriptors.map(d => d.name).sort();
    const expected = [...expectedNames].sort();
    expect(actualNames).toEqual(expected);
  });

  it('TOOL_TABLE names match the stable contract', () => {
    const actualNames = TOOL_TABLE.map(t => t.name).sort();
    const expected = [...expectedNames].sort();
    expect(actualNames).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Capability classification via capabilityClassOf
// ---------------------------------------------------------------------------

describe('capabilityClassOf via MCP context', () => {
  it('classifies all read tools as "read"', () => {
    const readTools = [
      'viewer.doctor',
      'viewer.status',
      'viewer.getRepositoryOverview',
      'viewer.findEntrypoints',
      'viewer.traceFlow',
      'viewer.explainSubsystem',
      'viewer.estimateBlastRadius',
      'viewer.listClaims',
      'viewer.listUncertainties',
      'viewer.checkInvariants',
      'viewer.resolveReference',
      'viewer.getClaimHistory',
      'viewer.compareRevisions',
    ];
    for (const name of readTools) {
      expect(capabilityClassOf(name)).toBe('read');
    }
  });

  it('classifies viewer.verifyClaim as "verify"', () => {
    expect(capabilityClassOf('viewer.verifyClaim')).toBe('verify');
  });

  it('classifies all feedback tools as "feedback"', () => {
    const feedbackTools = [
      'viewer.confirmClaim',
      'viewer.rejectClaim',
      'viewer.annotateClaim',
      'viewer.confirmSubsystem',
      'viewer.rejectSubsystem',
      'viewer.annotateSubsystem',
    ];
    for (const name of feedbackTools) {
      expect(capabilityClassOf(name)).toBe('feedback');
    }
  });

  it('classifies viewer.index as "index"', () => {
    expect(capabilityClassOf('viewer.index')).toBe('index');
  });
});

// ---------------------------------------------------------------------------
// Pre-dispatch configuration
// ---------------------------------------------------------------------------

describe('tool pre-dispatch configuration', () => {
  it('tools with pre-dispatch have valid argName and hint', () => {
    const withPreDispatch = TOOL_TABLE.filter(t => t.preDispatch != null);
    expect(withPreDispatch.length).toBeGreaterThan(0);
    for (const entry of withPreDispatch) {
      expect(typeof entry.preDispatch!.argName).toBe('string');
      expect(typeof entry.preDispatch!.hint).toBe('string');
    }
  });

  it('viewer.traceFlow has pre-dispatch on "start" with hint "path"', () => {
    const traceEntry = TOOL_TABLE.find(t => t.name === 'viewer.traceFlow');
    expect(traceEntry).toBeDefined();
    expect(traceEntry!.preDispatch).toEqual({ argName: 'start', hint: 'path' });
  });

  it('viewer.confirmClaim has pre-dispatch on "claimId" with hint "claim"', () => {
    const entry = TOOL_TABLE.find(t => t.name === 'viewer.confirmClaim');
    expect(entry).toBeDefined();
    expect(entry!.preDispatch).toEqual({ argName: 'claimId', hint: 'claim' });
  });
});

// ---------------------------------------------------------------------------
// Path traversal rejection in dispatchIndex (F-4 defense-in-depth)
// ---------------------------------------------------------------------------

describe('McpToolServer repoRoot path traversal rejection', () => {
  function buildServer(): McpToolServer {
    const server = new McpToolServer();

    // Minimal stubs -- the path validation fires before dispatch reaches them
    const ops = {
      getRepositoryOverview: () => ({ data: null }),
      findEntrypoints: () => ({ data: null }),
      traceFlow: () => ({ data: null }),
      explainSubsystem: () => ({ data: null }),
      estimateBlastRadius: () => ({ data: null }),
      listClaims: () => ({ data: null }),
      listUncertainties: () => ({ data: null }),
      checkInvariants: () => ({ data: null }),
      verifyClaim: () => ({ data: null }),
      buildClaimPayload: () => ({ data: null }),
      sampleEvidenceAgreement: () => ({ data: null }),
    } as unknown as ViewerOperations;

    const feedback = {
      confirmClaim: () => ({}),
      rejectClaim: () => ({}),
      annotateClaim: () => ({}),
      confirmSubsystem: () => ({}),
      rejectSubsystem: () => ({}),
      annotateSubsystem: () => ({}),
    } as unknown as FeedbackOperations;

    const indexer = {
      index: async () => ({ revision: 'test' }),
    } as IndexerLike;

    server.register(ops, feedback, indexer);
    return server;
  }

  it('rejects viewer.index with ".." in repoRoot', async () => {
    const server = buildServer();
    await expect(
      server.invoke('viewer.index', { repoRoot: '../../etc' }),
    ).rejects.toThrow('must not contain ".."');
  });

  it('rejects viewer.index with embedded ".." in repoRoot', async () => {
    const server = buildServer();
    await expect(
      server.invoke('viewer.index', { repoRoot: '/foo/../bar' }),
    ).rejects.toThrow('must not contain ".."');
  });
});

// ---------------------------------------------------------------------------
// viewer.index skipEmbed schema
// ---------------------------------------------------------------------------

describe('viewer.index schema accepts skipEmbed', () => {
  it('index tool schema accepts skipEmbed boolean', () => {
    const indexEntry = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexEntry).toBeDefined();

    // Validate that skipEmbed: true parses successfully
    const parsed = indexEntry!.inputSchema.safeParse({
      repoRoot: '/tmp/repo',
      skipEmbed: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('index tool schema accepts skipEmbed: false', () => {
    const indexEntry = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexEntry).toBeDefined();

    const parsed = indexEntry!.inputSchema.safeParse({
      repoRoot: '/tmp/repo',
      skipEmbed: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('index tool schema accepts omitted skipEmbed', () => {
    const indexEntry = TOOL_TABLE.find(t => t.name === 'viewer.index');
    expect(indexEntry).toBeDefined();

    const parsed = indexEntry!.inputSchema.safeParse({
      repoRoot: '/tmp/repo',
    });
    expect(parsed.success).toBe(true);
  });
});
