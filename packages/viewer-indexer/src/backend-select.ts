import { createRequire } from 'node:module';
import type { BackendSelection } from './types.js';

/**
 * Select the effective symbol extraction backend.
 *
 * Checks if the configured backend is available and returns the effective
 * backend with degradation info if needed.
 */
export function selectSymbolBackend(configured: string): BackendSelection {
  if (configured === 'treesitter') {
    return { backend: 'treesitter', degraded: false };
  }

  if (configured === 'lsp') {
    // Check if typescript package is resolvable
    if (isTypeScriptAvailable()) {
      return { backend: 'lsp', degraded: false };
    }
    return {
      backend: 'treesitter',
      degraded: true,
      reason: 'TypeScript package not resolvable; falling back to tree-sitter',
    };
  }

  if (configured === 'scip') {
    return {
      backend: 'treesitter',
      degraded: true,
      reason: 'SCIP backend not implemented; falling back to tree-sitter',
    };
  }

  return {
    backend: 'treesitter',
    degraded: true,
    reason: `Unknown backend "${configured}"; falling back to tree-sitter`,
  };
}

function isTypeScriptAvailable(): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve('typescript');
    return true;
  } catch {
    return false;
  }
}
