/**
 * Worker thread entry point for parallel symbol extraction.
 *
 * Receives file content via parentPort messages, loads grammars lazily
 * (cached per worker), runs extraction, and returns results.
 *
 * Each worker is a standalone thread with its own grammar cache.
 * No shared mutable state with the main thread or other workers.
 *
 */
import { parentPort } from 'node:worker_threads';
import { extractSymbols } from './extract.js';

interface WorkerMessage {
  type: 'extract' | 'shutdown';
  filePath: string;
  content: string;
  language?: string;
}

parentPort!.on('message', async (msg: WorkerMessage) => {
  if (msg.type === 'extract') {
    try {
      const result = await extractSymbols(msg.filePath, msg.content, msg.language);
      parentPort!.postMessage({
        type: 'result',
        filePath: msg.filePath,
        symbols: result.symbols,
        imports: result.imports,
        partial: result.partial,
        partialReason: result.partialReason,
      });
    } catch (err) {
      parentPort!.postMessage({
        type: 'error',
        filePath: msg.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (msg.type === 'shutdown') {
    process.exit(0);
  }
});
