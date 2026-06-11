/**
 * Integration tests for the eval runner with real engine adapter.
 *
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEvalEngine } from '../evals/engine-adapter.js';
import { runEvalScenario, runEvalSuite } from '../evals/eval-runner.js';
import { EVAL_SCENARIOS } from '../evals/scenarios.js';
import { generateFixture } from '../fixture-gen.js';
import type { EvalScenario, EvalEngine } from '../evals/types.js';

function makeTempDir(label: string): string {
  return join(
    tmpdir(),
    `eval-int-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

describe('createEvalEngine', () => {
  const tempDirs: string[] = [];

  function trackDir(dir: string): string {
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('creates an engine that dispatches getRepositoryOverview', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const dataDir = trackDir(makeTempDir('data'));

    generateFixture({
      languages: { typescript: 5, python: 0, rust: 0, go: 0 },
      locRange: [10, 20],
      nestingDepth: 1,
      outputDir: fixtureDir,
    });

    const engine = await createEvalEngine({ dataDir, fixtureDir });
    try {
      const result = engine.dispatch('getRepositoryOverview', { repo: '.' });
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');

      const envelope = result as Record<string, unknown>;
      expect(envelope).toHaveProperty('data');
      expect(envelope).toHaveProperty('evidence');
      expect(envelope).toHaveProperty('uncertainties');
      expect(envelope).toHaveProperty('modelRevision');
    } finally {
      engine.close();
    }
  });

  it('creates an engine that dispatches doctor', async () => {
    const dataDir = trackDir(makeTempDir('data'));
    const fixtureDir = trackDir(makeTempDir('fixture'));

    generateFixture({
      languages: { typescript: 3, python: 0, rust: 0, go: 0 },
      locRange: [10, 20],
      nestingDepth: 1,
      outputDir: fixtureDir,
    });

    const engine = await createEvalEngine({ dataDir, fixtureDir });
    try {
      const result = engine.dispatch('doctor', {}) as Record<string, unknown>;
      expect(result).toHaveProperty('data');
      const data = result['data'] as Record<string, unknown>;
      expect(data).toHaveProperty('grammarAvailability');
      expect(data).toHaveProperty('modelStatus');
      expect(data).toHaveProperty('effectiveBackend');
    } finally {
      engine.close();
    }
  });

  it('handles buildClaimPayload for nonexistent claim', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const dataDir = trackDir(makeTempDir('data'));

    generateFixture({
      languages: { typescript: 3, python: 0, rust: 0, go: 0 },
      locRange: [10, 20],
      nestingDepth: 1,
      outputDir: fixtureDir,
    });

    const engine = await createEvalEngine({ dataDir, fixtureDir });
    try {
      const result = engine.dispatch('buildClaimPayload', {
        claimId: 'nonexistent-claim-xyz',
      }) as Record<string, unknown>;

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('uncertainties');
      const uncertainties = result['uncertainties'] as Array<Record<string, unknown>>;
      expect(uncertainties.length).toBeGreaterThanOrEqual(1);
      expect(uncertainties[0]['kind']).toBe('claim_not_found');
    } finally {
      engine.close();
    }
  });

  it('close is idempotent', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const dataDir = trackDir(makeTempDir('data'));

    generateFixture({
      languages: { typescript: 3, python: 0, rust: 0, go: 0 },
      locRange: [10, 20],
      nestingDepth: 1,
      outputDir: fixtureDir,
    });

    const engine = await createEvalEngine({ dataDir, fixtureDir });
    engine.close();
    expect(() => engine.close()).not.toThrow();
  });
});

describe('eval scenario integration', () => {
  const tempDirs: string[] = [];

  function trackDir(dir: string): string {
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('runs doctor-reports-model-status scenario against real engine', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const dataDir = trackDir(makeTempDir('data'));

    generateFixture({
      languages: { typescript: 5, python: 0, rust: 0, go: 0 },
      locRange: [10, 20],
      nestingDepth: 1,
      outputDir: fixtureDir,
    });

    const engine = await createEvalEngine({ dataDir, fixtureDir });
    try {
      const scenario = EVAL_SCENARIOS.find(
        (s) => s.id === 'doctor-reports-model-status',
      );
      expect(scenario).toBeDefined();

      const result = await runEvalScenario(scenario!, engine);
      expect(result.scenarioId).toBe('doctor-reports-model-status');
      expect(result.passed).toBe(true);
    } finally {
      engine.close();
    }
  });

  it('runs doctor-reports-grammar-status scenario against real engine', async () => {
    const fixtureDir = trackDir(makeTempDir('fixture'));
    const dataDir = trackDir(makeTempDir('data'));

    generateFixture({
      languages: { typescript: 5, python: 0, rust: 0, go: 0 },
      locRange: [10, 20],
      nestingDepth: 1,
      outputDir: fixtureDir,
    });

    const engine = await createEvalEngine({ dataDir, fixtureDir });
    try {
      const scenario = EVAL_SCENARIOS.find(
        (s) => s.id === 'doctor-reports-grammar-status',
      );
      expect(scenario).toBeDefined();

      const result = await runEvalScenario(scenario!, engine);
      expect(result.scenarioId).toBe('doctor-reports-grammar-status');
      expect(result.passed).toBe(true);
    } finally {
      engine.close();
    }
  });
});

describe('eval result formatting', () => {
  it('EvalReport has correct summary structure', async () => {
    const mockEngine: EvalEngine = {
      dispatch(op: string): unknown {
        return {
          data: { test: true, hypothesis: 'yes' },
          evidence: [],
          uncertainties: [],
          suggestedNextCalls: [],
          modelRevision: 'test-rev',
        };
      },
      close(): void { /* noop */ },
    };

    const scenarios: EvalScenario[] = [
      {
        id: 'fmt-test',
        name: 'Format test',
        category: 'tag_fidelity',
        description: 'Tests report format',
        operations: [{ op: 'test', args: {} }],
        assertions: [
          {
            target: 'data',
            matcher: 'contains',
            pattern: 'test',
            description: 'data contains test',
          },
        ],
      },
    ];

    const report = await runEvalSuite(scenarios, mockEngine);
    expect(report.timestamp).toBeTruthy();
    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0].scenarioId).toBe('fmt-test');
    expect(report.scenarios[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(report.scenarios[0].assertions).toHaveLength(1);
    expect(report.scenarios[0].assertions[0].description).toBe('data contains test');
  });
});
