import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  StderrProgressReporter,
  JsonProgressReporter,
  NullProgressReporter,
} from '../progress.js';
import type { ProgressReporter } from '../progress.js';
import { Indexer } from '../indexer.js';

describe('StderrProgressReporter', () => {
  it('formats stage output as [N/M] Name... count unit (elapsed_s)', () => {
    const lines: string[] = [];
    const reporter = new StderrProgressReporter((text) => lines.push(text));

    reporter.stage(3, 10, 'Symbol extraction', 100, 'symbols', 1200);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '[3/10] Symbol extraction... 100 symbols (1.2s)\n',
    );
  });

  it('appends extra info in brackets when provided', () => {
    const lines: string[] = [];
    const reporter = new StderrProgressReporter((text) => lines.push(text));

    reporter.stage(3, 10, 'Symbol extraction', 50, 'symbols', 2345, '4 workers');

    expect(lines[0]).toBe(
      '[3/10] Symbol extraction... 50 symbols (2.3s) [4 workers]\n',
    );
  });

  it('formats sub-second elapsed times correctly', () => {
    const lines: string[] = [];
    const reporter = new StderrProgressReporter((text) => lines.push(text));

    reporter.stage(1, 10, 'File discovery', 42, 'files', 87);

    expect(lines[0]).toBe('[1/10] File discovery... 42 files (0.1s)\n');
  });

  it('formats zero elapsed as 0.0s', () => {
    const lines: string[] = [];
    const reporter = new StderrProgressReporter((text) => lines.push(text));

    reporter.stage(1, 5, 'Init', 0, 'items', 0);

    expect(lines[0]).toBe('[1/5] Init... 0 items (0.0s)\n');
  });

  it('accumulates multiple stage calls', () => {
    const lines: string[] = [];
    const reporter = new StderrProgressReporter((text) => lines.push(text));

    reporter.stage(1, 3, 'A', 10, 'files', 100);
    reporter.stage(2, 3, 'B', 20, 'symbols', 200);
    reporter.stage(3, 3, 'C', 5, 'edges', 300);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('[1/3]');
    expect(lines[1]).toContain('[2/3]');
    expect(lines[2]).toContain('[3/3]');
  });

  it('satisfies the ProgressReporter interface', () => {
    const reporter: ProgressReporter = new StderrProgressReporter(() => {});
    expect(reporter.stage).toBeTypeOf('function');
    expect(reporter.done).toBeTypeOf('function');
  });

  it('done formats total elapsed time', () => {
    const lines: string[] = [];
    const reporter = new StderrProgressReporter((text) => lines.push(text));

    reporter.done(3456);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('Done in 3.5s\n');
  });
});

describe('JsonProgressReporter', () => {
  it('emits a JSON line for each stage call', () => {
    const lines: string[] = [];
    const reporter = new JsonProgressReporter((text) => lines.push(text));

    reporter.stage(1, 10, 'File Discovery', 150, 'files', 42);

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed).toEqual({
      type: 'stage',
      stage: 1,
      total: 10,
      name: 'File Discovery',
      count: 150,
      unit: 'files',
      elapsedMs: 42,
    });
  });

  it('emits a JSON line for done', () => {
    const lines: string[] = [];
    const reporter = new JsonProgressReporter((text) => lines.push(text));

    reporter.done(1234);

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed).toEqual({
      type: 'done',
      totalElapsedMs: 1234,
    });
  });

  it('each line is terminated with a newline', () => {
    const lines: string[] = [];
    const reporter = new JsonProgressReporter((text) => lines.push(text));

    reporter.stage(2, 5, 'Symbol Extraction', 80, 'symbols', 500);

    expect(lines[0]).toMatch(/\n$/);
  });

  it('produces valid JSON lines across multiple stages', () => {
    const lines: string[] = [];
    const reporter = new JsonProgressReporter((text) => lines.push(text));

    reporter.stage(1, 3, 'A', 10, 'files', 100);
    reporter.stage(2, 3, 'B', 20, 'symbols', 200);
    reporter.stage(3, 3, 'C', 5, 'edges', 300);
    reporter.done(600);

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(() => JSON.parse(line.trim())).not.toThrow();
    }

    const last = JSON.parse(lines[3]!.trim());
    expect(last.type).toBe('done');
  });

  it('satisfies the ProgressReporter interface', () => {
    const reporter: ProgressReporter = new JsonProgressReporter(() => {});
    expect(reporter.stage).toBeTypeOf('function');
    expect(reporter.done).toBeTypeOf('function');
  });
});

describe('NullProgressReporter', () => {
  it('stage is a no-op that does not throw', () => {
    const reporter = new NullProgressReporter();

    expect(() => {
      reporter.stage(1, 10, 'File discovery', 42, 'files', 100);
    }).not.toThrow();
  });

  it('satisfies the ProgressReporter interface', () => {
    const reporter: ProgressReporter = new NullProgressReporter();
    expect(reporter.stage).toBeTypeOf('function');
    expect(reporter.done).toBeTypeOf('function');
  });

  it('accepts extra parameter without error', () => {
    const reporter = new NullProgressReporter();

    expect(() => {
      reporter.stage(1, 10, 'Test', 0, 'items', 0, 'extra info');
    }).not.toThrow();
  });

  it('done is a no-op that does not throw', () => {
    const reporter = new NullProgressReporter();

    expect(() => {
      reporter.done(1000);
    }).not.toThrow();
  });
});

describe('Indexer progress integration', () => {
  it('reports all 10 stages and done when progress reporter is provided', async () => {
    const stages: Array<{ number: number; total: number; name: string }> = [];
    let doneCalled = false;
    let doneElapsed = 0;

    const captureReporter: ProgressReporter = {
      stage(number, total, name) {
        stages.push({ number, total, name });
      },
      done(totalElapsedMs) {
        doneCalled = true;
        doneElapsed = totalElapsedMs;
      },
    };

    const mockStore = {
      beginSnapshot: () => ({
        insertRevision: vi.fn(),
        clearFtsForRepository: vi.fn(),
        deleteFtsForFile: vi.fn(),
        upsertNode: vi.fn(),
        upsertEdge: vi.fn(),
        appendEvidence: vi.fn(),
        versionClaim: vi.fn(),
        insertFtsText: vi.fn(),
        upsertEmbedding: vi.fn(),
        upsertPartiality: vi.fn(),
        upsertFileHash: vi.fn(),
        closeStaleIntervals: vi.fn(),
        closeInterval: vi.fn(),
        commit: vi.fn(),
        abort: vi.fn(),
      }),
    };

    const tempDir = mkdtempSync(join(tmpdir(), 'viewer-progress-test-'));
    writeFileSync(join(tempDir, 'index.ts'), 'export const x = 1;');

    try {
      const indexer = new Indexer(mockStore as any);
      await indexer.index({ repoRoot: tempDir, progress: captureReporter });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    // Verify all 10 stages were reported
    expect(stages).toHaveLength(10);

    const expectedNames = [
      'File Discovery',
      'Symbol Extraction',
      'Import Resolution',
      'Git History Mining',
      'Subsystem Inference',
      'Claim Generation',
      'Embedding Generation',
      'FTS Population',
      'Secret Scrubbing',
      'Store Commit',
    ];

    for (let i = 0; i < 10; i++) {
      expect(stages[i]!.number).toBe(i + 1);
      expect(stages[i]!.total).toBe(10);
      expect(stages[i]!.name).toBe(expectedNames[i]);
    }

    // Verify done was called with a positive elapsed time
    expect(doneCalled).toBe(true);
    expect(doneElapsed).toBeGreaterThanOrEqual(0);
  });

  it('uses NullProgressReporter by default (no progress option)', async () => {
    const mockStore = {
      beginSnapshot: () => ({
        insertRevision: vi.fn(),
        clearFtsForRepository: vi.fn(),
        deleteFtsForFile: vi.fn(),
        upsertNode: vi.fn(),
        upsertEdge: vi.fn(),
        appendEvidence: vi.fn(),
        versionClaim: vi.fn(),
        insertFtsText: vi.fn(),
        upsertEmbedding: vi.fn(),
        upsertPartiality: vi.fn(),
        upsertFileHash: vi.fn(),
        closeStaleIntervals: vi.fn(),
        closeInterval: vi.fn(),
        commit: vi.fn(),
        abort: vi.fn(),
      }),
    };

    const tempDir = mkdtempSync(join(tmpdir(), 'viewer-progress-null-'));
    writeFileSync(join(tempDir, 'index.ts'), 'export const x = 1;');

    try {
      const indexer = new Indexer(mockStore as any);
      // Should not throw - NullProgressReporter is used by default
      const result = await indexer.index({ repoRoot: tempDir });
      expect(result.revision).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
