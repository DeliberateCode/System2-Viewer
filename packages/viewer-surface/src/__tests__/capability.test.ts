/**
 * Tests for capability classification, tool descriptors,
 * and the SOURCE_WRITE_IS_UNREPRESENTABLE compile-time proof.
 *
 */
import { describe, it, expect } from 'vitest';
import {
  capabilityClassOf,
  allToolDescriptors,
  CAPABILITY_CLASSES,
} from '../capability.js';
import { SOURCE_WRITE_IS_UNREPRESENTABLE } from '@system2-viewer/viewer-core';

// ---------------------------------------------------------------------------
// allToolDescriptors count
// ---------------------------------------------------------------------------

describe('allToolDescriptors', () => {
  it('returns exactly 22 tool descriptors', () => {
    const descriptors = allToolDescriptors();
    expect(descriptors).toHaveLength(22);
  });

  it('all descriptors have required fields', () => {
    const descriptors = allToolDescriptors();
    for (const d of descriptors) {
      expect(d).toHaveProperty('name');
      expect(d).toHaveProperty('capability');
      expect(d).toHaveProperty('mutatesModel');
      expect(typeof d.name).toBe('string');
      expect(typeof d.capability).toBe('string');
      expect(typeof d.mutatesModel).toBe('boolean');
    }
  });

  it('tool names match stable contract', () => {
    const descriptors = allToolDescriptors();
    const names = descriptors.map(d => d.name);

    // 13 read tools
    expect(names).toContain('viewer.doctor');
    expect(names).toContain('viewer.status');
    expect(names).toContain('viewer.getRepositoryOverview');
    expect(names).toContain('viewer.findEntrypoints');
    expect(names).toContain('viewer.traceFlow');
    expect(names).toContain('viewer.explainSubsystem');
    expect(names).toContain('viewer.estimateBlastRadius');
    expect(names).toContain('viewer.listClaims');
    expect(names).toContain('viewer.listUncertainties');
    expect(names).toContain('viewer.checkInvariants');
    expect(names).toContain('viewer.resolveReference');
    expect(names).toContain('viewer.getClaimHistory');
    expect(names).toContain('viewer.compareRevisions');

    // 1 verify tool
    expect(names).toContain('viewer.verifyClaim');

    // 6 feedback tools
    expect(names).toContain('viewer.confirmClaim');
    expect(names).toContain('viewer.rejectClaim');
    expect(names).toContain('viewer.annotateClaim');
    expect(names).toContain('viewer.confirmSubsystem');
    expect(names).toContain('viewer.rejectSubsystem');
    expect(names).toContain('viewer.annotateSubsystem');

    // 1 index tool
    expect(names).toContain('viewer.index');
  });

  it('has 14 read, 1 verify, 6 feedback, and 1 index tool', () => {
    const descriptors = allToolDescriptors();
    const read = descriptors.filter(d => d.capability === 'read');
    const verify = descriptors.filter(d => d.capability === 'verify');
    const feedback = descriptors.filter(d => d.capability === 'feedback');
    const index = descriptors.filter(d => d.capability === 'index');

    expect(read).toHaveLength(14);
    expect(verify).toHaveLength(1);
    expect(feedback).toHaveLength(6);
    expect(index).toHaveLength(1);
  });

  it('read tools have mutatesModel === false', () => {
    const descriptors = allToolDescriptors();
    const read = descriptors.filter(d => d.capability === 'read');
    for (const d of read) {
      expect(d.mutatesModel).toBe(false);
    }
  });

  it('feedback and index tools have mutatesModel === true', () => {
    const descriptors = allToolDescriptors();
    const mutating = descriptors.filter(d => d.capability !== 'read');
    for (const d of mutating) {
      expect(d.mutatesModel).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// capabilityClassOf
// ---------------------------------------------------------------------------

describe('capabilityClassOf', () => {
  it('returns "read" for viewer.doctor', () => {
    expect(capabilityClassOf('viewer.doctor')).toBe('read');
  });

  it('returns "feedback" for viewer.confirmClaim', () => {
    expect(capabilityClassOf('viewer.confirmClaim')).toBe('feedback');
  });

  it('returns "index" for viewer.index', () => {
    expect(capabilityClassOf('viewer.index')).toBe('index');
  });

  it('returns "read" for viewer.status', () => {
    expect(capabilityClassOf('viewer.status')).toBe('read');
  });

  it('returns "read" for viewer.getRepositoryOverview', () => {
    expect(capabilityClassOf('viewer.getRepositoryOverview')).toBe('read');
  });

  it('returns "feedback" for viewer.rejectClaim', () => {
    expect(capabilityClassOf('viewer.rejectClaim')).toBe('feedback');
  });

  it('returns "feedback" for viewer.annotateClaim', () => {
    expect(capabilityClassOf('viewer.annotateClaim')).toBe('feedback');
  });

  it('throws for unknown tool name', () => {
    expect(() => capabilityClassOf('viewer.nonexistent')).toThrow('Unknown tool');
  });
});

// ---------------------------------------------------------------------------
// SOURCE_WRITE_IS_UNREPRESENTABLE
// ---------------------------------------------------------------------------

describe('SOURCE_WRITE_IS_UNREPRESENTABLE', () => {
  it('is true at runtime', () => {
    expect(SOURCE_WRITE_IS_UNREPRESENTABLE).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CAPABILITY_CLASSES
// ---------------------------------------------------------------------------

describe('CAPABILITY_CLASSES', () => {
  it('has exactly 4 members', () => {
    expect(CAPABILITY_CLASSES).toHaveLength(4);
  });

  it('contains read, feedback, verify, and index', () => {
    expect(CAPABILITY_CLASSES).toContain('read');
    expect(CAPABILITY_CLASSES).toContain('feedback');
    expect(CAPABILITY_CLASSES).toContain('verify');
    expect(CAPABILITY_CLASSES).toContain('index');
  });

  it('does not contain source-write', () => {
    expect(CAPABILITY_CLASSES).not.toContain('source-write');
  });
});
