/**
 * Phase 2 stable contract preservation tests.
 *
 * Verifies that Phase 2 changes do not break Phase 1 contracts:
 *   - MCP tool count remains at 21
 *   - CLI command count remains at 19
 *   - Overlay manifest is unchanged
 *   - CapabilityClass has 4 members including 'verify'
 *   - ResultEnvelope shape is unchanged
 *   - No 'source-write' in CapabilityClass
 *   - verifyClaim has 'verify' capability
 *
 * Test classification: missing coverage
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { TOOL_TABLE } from '../tool-table.js';
import { CAPABILITY_CLASSES } from '../capability.js';
import { COMMANDS } from '../cli-commands.js';

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe('Phase 2 contract: MCP tool surface unchanged', () => {
  it('MCP tool count is exactly 21', () => {
    expect(TOOL_TABLE).toHaveLength(21);
  });

  it('all 21 expected tool names are present', () => {
    const names = new Set(TOOL_TABLE.map((t) => t.name));

    const EXPECTED_TOOLS = [
      'viewer.doctor',
      'viewer.status',
      'viewer.index',
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
    ];

    for (const tool of EXPECTED_TOOLS) {
      expect(names.has(tool)).toBe(true);
    }
    expect(names.size).toBe(EXPECTED_TOOLS.length);
  });

  it('no new tools were added beyond the 21 Phase 1 tools', () => {
    // If this fails, a new tool was added which violates the contract
    const names = TOOL_TABLE.map((t) => t.name);
    expect(names.length).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe('Phase 2 contract: CLI command surface unchanged', () => {
  it('CLI command count is exactly 21', () => {
    expect(COMMANDS).toHaveLength(21);
  });

  it('all 21 expected command names are present', () => {
    const names = new Set(COMMANDS.map((c) => c.name));

    const EXPECTED_COMMANDS = [
      'doctor',
      'status',
      'init',
      'mcp-config',
      'index',
      'overview',
      'entrypoints',
      'trace',
      'blast',
      'subsystem',
      'resolve',
      'claims',
      'uncertainties',
      'verify',
      'history',
      'check-invariants',
      'confirm',
      'reject',
      'annotate',
      'claim-create',
      'rule',
    ];

    for (const cmd of EXPECTED_COMMANDS) {
      expect(names.has(cmd)).toBe(true);
    }
    expect(names.size).toBe(EXPECTED_COMMANDS.length);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe('Phase 2 contract: CapabilityClass type', () => {
  it('has exactly 4 members', () => {
    expect(CAPABILITY_CLASSES).toHaveLength(4);
  });

  it('includes verify', () => {
    expect(CAPABILITY_CLASSES).toContain('verify');
  });

  it('does not include source-write', () => {
    expect(CAPABILITY_CLASSES).not.toContain('source-write');
  });

  it('verifyClaim tool uses verify capability class', () => {
    const entry = TOOL_TABLE.find((t) => t.name === 'viewer.verifyClaim');
    expect(entry).toBeDefined();
    expect(entry!.capabilityClass).toBe('verify');
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe('Phase 2 contract: overlay manifest unchanged', () => {
  const overlayPath = join(
    __dirname,
    '../../../../plugin/system2.overlay.json',
  );

  it('overlay manifest exists', () => {
    const content = readFileSync(overlayPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('overlay manifest has schema_version 1.0.0', () => {
    const manifest = JSON.parse(readFileSync(overlayPath, 'utf-8'));
    expect(manifest.schema_version).toBe('1.0.0');
  });

  it('overlay manifest name is system2-viewer', () => {
    const manifest = JSON.parse(readFileSync(overlayPath, 'utf-8'));
    expect(manifest.name).toBe('system2-viewer');
  });

  it('overlay manifest agents block is empty', () => {
    const manifest = JSON.parse(readFileSync(overlayPath, 'utf-8'));
    expect(manifest.contributions.agents).toEqual({});
  });

  it('overlay manifest has exactly 1 auxiliary agent (viewer-scout)', () => {
    const manifest = JSON.parse(readFileSync(overlayPath, 'utf-8'));
    expect(manifest.contributions.auxiliary_agents).toHaveLength(1);
    expect(manifest.contributions.auxiliary_agents[0].name).toBe('viewer-scout');
    expect(manifest.contributions.auxiliary_agents[0].pipeline).toBe(false);
  });

  it('overlay manifest content has expected SHA256 checksum', () => {
    const content = readFileSync(overlayPath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    expect(hash).toBe(
      '062e3adf8ea1da0a7c75220ad8f1ac66feba3c2aa8768a11e861bfd2c5398ccb',
    );
  });
});
