/**
 * Thin wrapper around ONNX Runtime for local embedding inference.
 *
 * - Loads the all-MiniLM-L6-v2 model (~23 MB, 384-dim)
 * - Runs entirely on CPU (no GPU required)
 * - Zero network calls
 * - Optional: if onnxruntime-node is not installed, tryLoadEmbedder() returns null
 *
 * The model file must be pre-installed at one of the resolved paths.
 * See design.md "Embedding Model Integration" for model file location resolution.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_MODEL_NAME = 'all-MiniLM-L6-v2';
export const DEFAULT_DIMENSION = 384;
const MAX_EMBEDDING_TEXT_LENGTH = 512;

export interface Embedder {
  readonly modelName: string;
  readonly dimension: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  close(): void;
}

export interface EmbedderStatus {
  status: 'available' | 'not_installed' | 'load_failed';
  modelName?: string;
  dimension?: number;
  modelSizeBytes?: number;
  error?: string;
}

export type EmbeddingInput =
  | { type: 'file'; path: string; language: string }
  | { type: 'symbol'; displayName: string; kind: string; path: string }
  | { type: 'claim'; statement: string; claimType: string };

/**
 * Composes the text string used as input to the embedding model for a given entity.
 * Truncates to 512 characters per design spec.
 */
export function composeEmbeddingText(input: EmbeddingInput): string {
  let raw: string;
  switch (input.type) {
    case 'file':
      raw = `file: ${input.path} language: ${input.language}`;
      break;
    case 'symbol':
      raw = `symbol: ${input.displayName} kind: ${input.kind} in: ${input.path}`;
      break;
    case 'claim':
      raw = `claim: ${input.statement} type: ${input.claimType}`;
      break;
  }
  if (raw.length > MAX_EMBEDDING_TEXT_LENGTH) {
    return raw.slice(0, MAX_EMBEDDING_TEXT_LENGTH);
  }
  return raw;
}

/**
 * Resolves the model file path by checking known locations in order:
 * 1. Explicit modelPath argument
 * 2. <dataDir>/models/<modelName>/model.onnx (user-installed)
 *
 * Returns null if no model file is found.
 */
function resolveModelPath(modelName: string, explicitPath?: string): string | null {
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }
  const dataDir = join(homedir(), '.system2-viewer');
  const candidate = join(dataDir, 'models', modelName, 'model.onnx');
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

/**
 * Simple MVP tokenizer: splits text on whitespace/punctuation, maps tokens to
 * deterministic integer IDs via hashing, and pads/truncates to the model's
 * max sequence length (128). Produces [CLS] ... tokens ... [SEP] format.
 *
 * This does not replicate WordPiece tokenization but provides a deterministic
 * mapping that is sufficient for the ONNX model input shape.
 */
export function tokenize(text: string, maxLen = 128): { inputIds: BigInt64Array; attentionMask: BigInt64Array } {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const ids = new BigInt64Array(maxLen);
  const mask = new BigInt64Array(maxLen);

  // CLS token (ID 101 in BERT vocab)
  ids[0] = 101n;
  mask[0] = 1n;

  const limit = Math.min(tokens.length, maxLen - 2);
  for (let i = 0; i < limit; i++) {
    let hash = 0;
    for (let c = 0; c < tokens[i].length; c++) {
      hash = ((hash << 5) - hash + tokens[i].charCodeAt(c)) | 0;
    }
    ids[i + 1] = BigInt(Math.abs(hash) % 30000 + 1000);
    mask[i + 1] = 1n;
  }

  // SEP token (ID 102 in BERT vocab)
  const sepPos = Math.min(limit + 1, maxLen - 1);
  ids[sepPos] = 102n;
  mask[sepPos] = 1n;

  return { inputIds: ids, attentionMask: mask };
}

/**
 * Attempts to dynamically import onnxruntime-node.
 * Returns the module or null if not installed.
 *
 * The module name is held in a variable to prevent TypeScript from
 * attempting static resolution of this optional dependency.
 */
async function tryImportOnnx(): Promise<unknown | null> {
  try {
    const moduleName = 'onnxruntime-node';
    return await import(/* @vite-ignore */ moduleName);
  } catch {
    return null;
  }
}

/**
 * Attempts to load the ONNX Runtime and embedding model.
 * Returns null if onnxruntime-node is not installed or model file is missing.
 *
 * @param modelPath - Explicit path to the .onnx model file. If omitted, resolves
 *   from standard locations.
 * @param modelName - Model identifier (default: 'all-MiniLM-L6-v2')
 */
export async function tryLoadEmbedder(
  modelPath?: string,
  modelName: string = DEFAULT_MODEL_NAME,
): Promise<Embedder | null> {
  const ort = await tryImportOnnx();
  if (ort === null) {
    return null;
  }

  const resolvedPath = resolveModelPath(modelName, modelPath);
  if (resolvedPath === null) {
    return null;
  }

  try {
    const { InferenceSession, Tensor } = ort as {
      InferenceSession: {
        create(path: string): Promise<{
          run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
          release(): Promise<void>;
        }>;
      };
      Tensor: new (type: string, data: BigInt64Array | Float32Array | Int32Array, dims: number[]) => unknown;
    };

    const session = await InferenceSession.create(resolvedPath);
    const dimension = DEFAULT_DIMENSION;

    async function runInference(text: string): Promise<Float32Array> {
      const { inputIds, attentionMask } = tokenize(text);
      const tokenTypeIds = new BigInt64Array(128);
      const feeds = {
        input_ids: new Tensor('int64', inputIds, [1, 128]),
        attention_mask: new Tensor('int64', attentionMask, [1, 128]),
        token_type_ids: new Tensor('int64', tokenTypeIds, [1, 128]),
      };
      const output = await session.run(feeds);
      const key = Object.keys(output)[0];
      return new Float32Array(output[key].data);
    }

    const cache = new Map<string, Float32Array>();

    const embedder: Embedder = {
      modelName,
      dimension,
      async embed(text: string): Promise<Float32Array> {
        const cached = cache.get(text);
        if (cached) return cached;
        const vec = await runInference(text);
        cache.set(text, vec);
        return vec;
      },
      async embedBatch(texts: string[]): Promise<Float32Array[]> {
        const results: Float32Array[] = [];
        for (const t of texts) {
          const cached = cache.get(t);
          if (cached) {
            results.push(cached);
          } else {
            const vec = await runInference(t);
            cache.set(t, vec);
            results.push(vec);
          }
        }
        return results;
      },
      close() {
        cache.clear();
        session.release().catch(() => {/* best-effort cleanup */});
      },
    };

    return embedder;
  } catch {
    return null;
  }
}

/**
 * Probes embedding model availability without fully loading the model.
 * Used by viewer.doctor to report status.
 */
export async function probeEmbedderStatus(
  modelName: string = DEFAULT_MODEL_NAME,
): Promise<EmbedderStatus> {
  const ort = await tryImportOnnx();
  if (ort === null) {
    return { status: 'not_installed' };
  }

  const resolvedPath = resolveModelPath(modelName);
  if (resolvedPath === null) {
    return {
      status: 'not_installed',
      modelName,
    };
  }

  try {
    const stats = statSync(resolvedPath);
    return {
      status: 'available',
      modelName,
      dimension: DEFAULT_DIMENSION,
      modelSizeBytes: stats.size,
    };
  } catch (err: unknown) {
    return {
      status: 'load_failed',
      modelName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
