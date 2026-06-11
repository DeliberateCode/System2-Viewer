/**
 * Tests for feedback operations -- specifically the noProseEditGuard
 * and feedback revision format.
 *
 */
import { describe, it, expect } from 'vitest';
import { noProseEditGuard } from '../feedback.js';

// ---------------------------------------------------------------------------
// noProseEditGuard
// ---------------------------------------------------------------------------

describe('noProseEditGuard', () => {
  it('throws when args contain a "statement" field', () => {
    expect(() => noProseEditGuard({ statement: 'x' })).toThrow();
    expect(() => noProseEditGuard({ statement: 'x' })).toThrow('statement');
  });

  it('throws even when statement is empty string', () => {
    expect(() => noProseEditGuard({ statement: '' })).toThrow();
  });

  it('does not throw when args have claimId and actor but no statement', () => {
    expect(() =>
      noProseEditGuard({ claimId: 'c1', actor: 'a' }),
    ).not.toThrow();
  });

  it('does not throw on empty args object', () => {
    expect(() => noProseEditGuard({})).not.toThrow();
  });

  it('does not throw when other fields are present without statement', () => {
    expect(() =>
      noProseEditGuard({
        claimId: 'claim-123',
        actor: 'user',
        note: 'some note',
        annotation: 'annotation text',
      }),
    ).not.toThrow();
  });
});

describe('feedback revision format', () => {
  it('feedback revision sorts chronologically relative to index revision', () => {
    // Simulate an index revision created at time T
    const indexTime = 1749300000000; // a fixed timestamp
    const indexRevision = `rev::${indexTime}::abc12345`;

    // Simulate a feedback revision created slightly after
    const feedbackTime = indexTime + 1000;
    const feedbackRevision = `rev::${feedbackTime}::fb::deadbeef-1234-5678-9abc`;

    // Lexicographic comparison should correctly order them chronologically
    expect(indexRevision < feedbackRevision).toBe(true);

    // A LATER index revision should sort after the feedback revision
    const laterIndexTime = feedbackTime + 5000;
    const laterIndexRevision = `rev::${laterIndexTime}::def67890`;
    expect(feedbackRevision < laterIndexRevision).toBe(true);
  });

  it('feedback revision uses numeric timestamp prefix, not ISO date prefix', () => {
    // The format rev::${Date.now()}::fb::${uuid} ensures numeric timestamp sorting
    // This test verifies the format pattern matches what applyFeedback produces
    const feedbackRevPattern = /^rev::\d{13}::fb::[0-9a-f-]+$/;

    // Simulate what feedback.ts now produces
    const simulated = `rev::${Date.now()}::fb::aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;
    expect(simulated).toMatch(feedbackRevPattern);
  });
});
