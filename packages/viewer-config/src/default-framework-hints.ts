import type { FrameworkHintDef } from './config.js';

const TEST_EXCLUDE: string[] = ['test/**', 'tests/**', '__tests__/**', '*_test.*', '*_spec.*'];

export const DEFAULT_FRAMEWORK_HINTS: readonly FrameworkHintDef[] = [
  // Flask
  { pattern: 'app.route', framework: 'flask', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'app.get', framework: 'flask', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'app.post', framework: 'flask', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  // FastAPI
  { pattern: 'router.get', framework: 'fastapi', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'router.post', framework: 'fastapi', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'router.put', framework: 'fastapi', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'router.delete', framework: 'fastapi', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  // Django
  { pattern: 'login_required', framework: 'django', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'permission_required', framework: 'django', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  // Spring
  { pattern: 'RequestMapping', framework: 'spring', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'GetMapping', framework: 'spring', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'PostMapping', framework: 'spring', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'PutMapping', framework: 'spring', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
  { pattern: 'DeleteMapping', framework: 'spring', entrypointKind: 'http-handler', excludePaths: TEST_EXCLUDE },
];

/**
 * Extracts matchable decorator/annotation names from symbol metadata.
 * Reads from per-language metadata fields:
 *   Python  -> metadataJson.decorators[]
 *   Rust    -> metadataJson.attributes[]
 *   Java    -> metadataJson.annotations[]
 */
export function extractDecoratorNames(metadataJson: string | null): string[] {
  if (!metadataJson) return [];
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    const names: string[] = [];
    if (Array.isArray(meta.decorators)) {
      for (const d of meta.decorators) {
        if (typeof d === 'string') names.push(d);
      }
    }
    if (Array.isArray(meta.attributes)) {
      for (const a of meta.attributes) {
        if (typeof a === 'string') names.push(a);
      }
    }
    if (Array.isArray(meta.annotations)) {
      for (const a of meta.annotations) {
        if (typeof a === 'string') names.push(a);
      }
    }
    return names;
  } catch {
    return [];
  }
}
