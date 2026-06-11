/**
 * Tests for WorkerPool manager and config resolution.
 *
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { resolveWorkerPoolConfig } from '../worker-pool.js';
import type { WorkerPoolConfig } from '../worker-pool.js';

// ---------------------------------------------------------------------------
// resolveWorkerPoolConfig tests (no mocking needed)
// ---------------------------------------------------------------------------

describe('resolveWorkerPoolConfig', () => {
  it('returns default workerMinFiles of 500 when not specified', () => {
    const config = resolveWorkerPoolConfig({ workerCount: 2 });
    expect(config.workerMinFiles).toBe(500);
  });

  it('clamps workerCount to minimum 1 when 0 is given', () => {
    const config = resolveWorkerPoolConfig({ workerCount: 0 });
    expect(config.workerCount).toBeGreaterThanOrEqual(1);
  });

  it('clamps workerCount to minimum 1 when negative is given', () => {
    const config = resolveWorkerPoolConfig({ workerCount: -5 });
    expect(config.workerCount).toBeGreaterThanOrEqual(1);
  });

  it('clamps workerCount to max 16 when 99 is given', () => {
    const config = resolveWorkerPoolConfig({ workerCount: 99 });
    expect(config.workerCount).toBe(16);
  });

  it('accepts valid workerCount within range', () => {
    const config = resolveWorkerPoolConfig({ workerCount: 4 });
    expect(config.workerCount).toBe(4);
  });

  it('falls back to default for NaN workerCount', () => {
    const config = resolveWorkerPoolConfig({ workerCount: NaN });
    expect(config.workerCount).toBeGreaterThanOrEqual(1);
    expect(config.workerCount).toBeLessThanOrEqual(16);
  });

  it('falls back to default for non-integer workerCount', () => {
    const config = resolveWorkerPoolConfig({ workerCount: 2.5 });
    expect(config.workerCount).toBeGreaterThanOrEqual(1);
    expect(config.workerCount).toBeLessThanOrEqual(16);
  });

  it('falls back to 500 for invalid workerMinFiles', () => {
    const config = resolveWorkerPoolConfig({ workerMinFiles: -1 });
    expect(config.workerMinFiles).toBe(500);
  });

  it('falls back to 500 for NaN workerMinFiles', () => {
    const config = resolveWorkerPoolConfig({ workerMinFiles: NaN });
    expect(config.workerMinFiles).toBe(500);
  });

  it('accepts valid workerMinFiles', () => {
    const config = resolveWorkerPoolConfig({ workerMinFiles: 100 });
    expect(config.workerMinFiles).toBe(100);
  });

  it('returns defaults when no config is provided', () => {
    const config = resolveWorkerPoolConfig();
    expect(config.workerCount).toBeGreaterThanOrEqual(1);
    expect(config.workerCount).toBeLessThanOrEqual(16);
    expect(config.workerMinFiles).toBe(500);
  });

  it('returns defaults when empty config is provided', () => {
    const config = resolveWorkerPoolConfig({});
    expect(config.workerCount).toBeGreaterThanOrEqual(1);
    expect(config.workerMinFiles).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// WorkerPool tests (with mocked Worker)
// ---------------------------------------------------------------------------

class MockWorker extends EventEmitter {
  postMessage: ReturnType<typeof vi.fn>;
  terminate = vi.fn().mockResolvedValue(undefined);
  readonly scriptPath: string;

  constructor(scriptPath: string) {
    super();
    this.scriptPath = scriptPath;
    this.postMessage = vi.fn().mockImplementation((msg: { type: string }) => {
      if (msg.type === 'shutdown') {
        // Simulate worker exiting after receiving shutdown
        queueMicrotask(() => this.emit('exit', 0));
      }
    });
  }
}

// Track mock workers created during tests
let mockWorkers: MockWorker[] = [];

function createMockWorker(scriptPath: string): MockWorker {
  const mock = new MockWorker(scriptPath);
  mockWorkers.push(mock);
  return mock;
}

vi.mock('node:worker_threads', () => ({
  Worker: vi.fn().mockImplementation((scriptPath: string) => createMockWorker(scriptPath)),
}));

// Re-import WorkerPool after mock is set up
const { WorkerPool } = await import('../worker-pool.js');

describe('WorkerPool', () => {
  beforeEach(() => {
    mockWorkers = [];
  });

  it('creates the requested number of workers on start()', async () => {
    const pool = new WorkerPool(3);
    await pool.start();
    expect(mockWorkers).toHaveLength(3);
    await pool.shutdown();
  });

  it('processAll returns empty array for empty task list', async () => {
    const pool = new WorkerPool(1);
    await pool.start();
    const results = await pool.processAll([]);
    expect(results).toEqual([]);
    await pool.shutdown();
  });

  it('dispatches extract messages to workers and collects results', async () => {
    const pool = new WorkerPool(1);
    await pool.start();

    const resultPromise = pool.processAll([
      { filePath: '/src/a.ts', content: 'const x = 1;', language: 'typescript' },
    ]);

    // The worker should have received a postMessage
    const worker = mockWorkers[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'extract',
      filePath: '/src/a.ts',
      content: 'const x = 1;',
      language: 'typescript',
    });

    // Simulate worker responding
    worker.emit('message', {
      type: 'result',
      filePath: '/src/a.ts',
      symbols: [{ name: 'x', kind: 'variable', exported: false, startLine: 1, endLine: 1 }],
      imports: [],
      partial: false,
    });

    const results = await resultPromise;
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      filePath: '/src/a.ts',
      symbols: [{ name: 'x', kind: 'variable', exported: false, startLine: 1, endLine: 1 }],
      imports: [],
      partial: false,
    });

    await pool.shutdown();
  });

  it('processes multiple files with a single worker', async () => {
    const pool = new WorkerPool(1);
    await pool.start();

    const resultPromise = pool.processAll([
      { filePath: '/src/a.ts', content: 'const a = 1;', language: 'typescript' },
      { filePath: '/src/b.ts', content: 'const b = 2;', language: 'typescript' },
    ]);

    const worker = mockWorkers[0]!;

    // First task dispatched immediately
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    // Respond to first task -> second gets dispatched
    worker.emit('message', {
      type: 'result',
      filePath: '/src/a.ts',
      symbols: [],
      imports: [],
      partial: false,
    });

    // Second task now dispatched
    expect(worker.postMessage).toHaveBeenCalledTimes(2);

    // Respond to second task
    worker.emit('message', {
      type: 'result',
      filePath: '/src/b.ts',
      symbols: [],
      imports: [],
      partial: false,
    });

    const results = await resultPromise;
    expect(results).toHaveLength(2);

    await pool.shutdown();
  });

  it('collects error responses from workers', async () => {
    const pool = new WorkerPool(1);
    await pool.start();

    const resultPromise = pool.processAll([
      { filePath: '/src/bad.ts', content: '', language: 'typescript' },
    ]);

    const worker = mockWorkers[0]!;

    // Worker responds with error
    worker.emit('message', {
      type: 'error',
      filePath: '/src/bad.ts',
      error: 'Parse failed',
    });

    const results = await resultPromise;
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      filePath: '/src/bad.ts',
      error: 'Parse failed',
    });

    await pool.shutdown();
  });

  it('handles worker crash without killing the pool', async () => {
    const pool = new WorkerPool(1);
    await pool.start();

    const resultPromise = pool.processAll([
      { filePath: '/src/crash.ts', content: '', language: 'typescript' },
      { filePath: '/src/ok.ts', content: 'const x = 1;', language: 'typescript' },
    ]);

    const originalWorker = mockWorkers[0]!;

    // Simulate worker crash while processing first task
    originalWorker.emit('error', new Error('Worker crashed'));

    // A replacement worker should have been created
    expect(mockWorkers).toHaveLength(2);
    const replacementWorker = mockWorkers[1]!;

    // Second task dispatched to replacement worker
    replacementWorker.emit('message', {
      type: 'result',
      filePath: '/src/ok.ts',
      symbols: [],
      imports: [],
      partial: false,
    });

    const results = await resultPromise;
    expect(results).toHaveLength(2);

    // First result is the crash error
    const crashResult = results.find(r => r.filePath === '/src/crash.ts');
    expect(crashResult).toBeDefined();
    expect('error' in crashResult!).toBe(true);

    // Second result is the successful extraction
    const okResult = results.find(r => r.filePath === '/src/ok.ts');
    expect(okResult).toBeDefined();
    expect('error' in okResult!).toBe(false);

    await pool.shutdown();
  });

  it('distributes tasks across multiple workers', async () => {
    const pool = new WorkerPool(2);
    await pool.start();

    const resultPromise = pool.processAll([
      { filePath: '/src/a.ts', content: 'a', language: 'typescript' },
      { filePath: '/src/b.ts', content: 'b', language: 'typescript' },
    ]);

    // Both workers should have received a task
    const worker0 = mockWorkers[0]!;
    const worker1 = mockWorkers[1]!;
    expect(worker0.postMessage).toHaveBeenCalledTimes(1);
    expect(worker1.postMessage).toHaveBeenCalledTimes(1);

    // Respond from both
    worker0.emit('message', {
      type: 'result',
      filePath: '/src/a.ts',
      symbols: [],
      imports: [],
      partial: false,
    });
    worker1.emit('message', {
      type: 'result',
      filePath: '/src/b.ts',
      symbols: [],
      imports: [],
      partial: false,
    });

    const results = await resultPromise;
    expect(results).toHaveLength(2);

    await pool.shutdown();
  });

  it('sends shutdown messages to all workers', async () => {
    const pool = new WorkerPool(2);
    await pool.start();

    const worker0 = mockWorkers[0]!;
    const worker1 = mockWorkers[1]!;

    // Start shutdown (emit exit after shutdown message)
    const shutdownPromise = pool.shutdown();
    worker0.emit('exit', 0);
    worker1.emit('exit', 0);
    await shutdownPromise;

    expect(worker0.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    expect(worker1.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
  });
});
