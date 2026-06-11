/**
 * Worker pool manager for parallel symbol extraction.
 *
 * Creates and manages a configurable number of worker threads, dispatches
 * extraction tasks, collects results, and handles worker errors/crashes
 * with automatic replacement.
 *
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SymbolInfo, ImportInfo } from './types.js';

export interface WorkerPoolConfig {
  workerCount: number;
  workerMinFiles: number;
}

export interface ExtractionTask {
  filePath: string;
  content: string;
  language?: string;
}

export interface WorkerExtractionResult {
  filePath: string;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  partial: boolean;
  partialReason?: string;
}

export interface WorkerExtractionError {
  filePath: string;
  error: string;
}

export function resolveWorkerPoolConfig(config?: Partial<WorkerPoolConfig>): WorkerPoolConfig {
  const available = availableParallelism();
  let workerCount = config?.workerCount ?? (available - 1);
  if (!Number.isInteger(workerCount) || workerCount < 1) workerCount = Math.max(1, available - 1);
  if (workerCount > 16) workerCount = 16;

  let workerMinFiles = config?.workerMinFiles ?? 500;
  if (!Number.isInteger(workerMinFiles) || workerMinFiles < 1) workerMinFiles = 500;

  return { workerCount, workerMinFiles };
}

export class WorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private pending = new Map<Worker, ExtractionTask>();
  private resolveAll!: (results: Array<WorkerExtractionResult | WorkerExtractionError>) => void;
  private results: Array<WorkerExtractionResult | WorkerExtractionError> = [];
  private taskQueue: ExtractionTask[] = [];
  private totalTasks = 0;
  private completedTasks = 0;
  private workerPath: string;

  constructor(private poolSize: number) {
    // Resolve worker script path. In production (compiled JS), the file
    // is adjacent to this module. In test environments (vitest transforms
    // source TS), the .js file lives in the dist/ directory instead.
    const adjacent = fileURLToPath(new URL('./extraction-worker.js', import.meta.url));
    if (existsSync(adjacent)) {
      this.workerPath = adjacent;
    } else {
      const dir = dirname(fileURLToPath(import.meta.url));
      const distPath = join(dir, '..', 'dist', 'extraction-worker.js');
      this.workerPath = existsSync(distPath) ? distPath : adjacent;
    }
  }

  async start(): Promise<void> {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(this.workerPath);
      this.workers.push(worker);
      this.idleWorkers.push(worker);
      this.setupWorkerHandlers(worker);
    }
  }

  private setupWorkerHandlers(worker: Worker): void {
    worker.on('message', (msg) => {
      if (msg.type === 'result') {
        this.results.push({
          filePath: msg.filePath,
          symbols: msg.symbols,
          imports: msg.imports,
          partial: msg.partial,
          partialReason: msg.partialReason,
        });
      } else if (msg.type === 'error') {
        this.results.push({
          filePath: msg.filePath,
          error: msg.error,
        });
      }
      this.completedTasks++;
      this.pending.delete(worker);
      this.idleWorkers.push(worker);
      this.dispatchNext();
      if (this.completedTasks === this.totalTasks) {
        this.resolveAll(this.results);
      }
    });

    worker.on('error', (err) => {
      const task = this.pending.get(worker);
      if (task) {
        this.results.push({ filePath: task.filePath, error: err.message });
        this.completedTasks++;
        this.pending.delete(worker);
      }
      // Replace crashed worker
      const idx = this.workers.indexOf(worker);
      if (idx >= 0) {
        const replacement = new Worker(this.workerPath);
        this.workers[idx] = replacement;
        this.idleWorkers.push(replacement);
        this.setupWorkerHandlers(replacement);
      }
      this.dispatchNext();
      if (this.completedTasks === this.totalTasks) {
        this.resolveAll(this.results);
      }
    });
  }

  async processAll(tasks: ExtractionTask[]): Promise<Array<WorkerExtractionResult | WorkerExtractionError>> {
    if (tasks.length === 0) return [];
    this.taskQueue = [...tasks];
    this.totalTasks = tasks.length;
    this.completedTasks = 0;
    this.results = [];

    return new Promise((resolve) => {
      this.resolveAll = resolve;
      while (this.idleWorkers.length > 0 && this.taskQueue.length > 0) {
        this.dispatchNext();
      }
    });
  }

  private dispatchNext(): void {
    if (this.taskQueue.length === 0 || this.idleWorkers.length === 0) return;
    const task = this.taskQueue.shift()!;
    const worker = this.idleWorkers.shift()!;
    this.pending.set(worker, task);
    worker.postMessage({
      type: 'extract',
      filePath: task.filePath,
      content: task.content,
      language: task.language,
    });
  }

  async shutdown(): Promise<void> {
    for (const worker of this.workers) {
      worker.postMessage({ type: 'shutdown' });
    }
    await Promise.allSettled(this.workers.map(w =>
      new Promise<void>((resolve) => w.on('exit', () => resolve()))
    ));
    this.workers = [];
    this.idleWorkers = [];
  }
}
