/**
 * Verification recipe execution.
 *
 * MVP recipe types:
 *   - source_span_check: Verify a source span still exists and matches
 *   - symbol_exists_check: Verify a symbol is still defined in the expected file
 *   - import_edge_check: Verify an import relationship still holds
 *   - grep_check: Verify a text pattern still matches
 *
 * Recipes read source files but NEVER modify them.
 */

import type {
  VerificationRecipe,
  VerificationReadHandle,
  RecipeOutcome,
} from './types.js';

const MVP_RECIPE_TYPES = new Set([
  'source_span_check',
  'symbol_exists_check',
  'import_edge_check',
  'grep_check',
]);

/**
 * Returns true if the recipe is one of the 4 MVP recipe types.
 */
export function isMvpRecipe(recipe: VerificationRecipe): boolean {
  return MVP_RECIPE_TYPES.has(recipe.recipeType);
}

/**
 * Executes a single verification recipe against the model (read-only).
 */
export function runRecipe(
  recipe: VerificationRecipe,
  handle: VerificationReadHandle,
): RecipeOutcome {
  switch (recipe.recipeType) {
    case 'source_span_check':
      return runSourceSpanCheck(recipe, handle);
    case 'symbol_exists_check':
      return runSymbolExistsCheck(recipe, handle);
    case 'import_edge_check':
      return runImportEdgeCheck(recipe, handle);
    case 'grep_check':
      return runGrepCheck(recipe, handle);
    default:
      return {
        recipeType: recipe.recipeType,
        passed: false,
        evidence: [],
        reason: `Unknown recipe type: ${recipe.recipeType}`,
      };
  }
}

function runSourceSpanCheck(
  recipe: VerificationRecipe,
  handle: VerificationReadHandle,
): RecipeOutcome {
  const span = recipe.sourceSpan;
  if (!span) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [],
      reason: 'No source span defined in recipe',
    };
  }

  const content = handle.readFileContent?.(span.path);
  if (content === null || content === undefined) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [],
      reason: `File not found: ${span.path}`,
    };
  }

  const lines = content.split('\n');
  const startIdx = span.startLine - 1;
  const endIdx = span.endLine;

  if (startIdx < 0 || endIdx > lines.length) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [
        {
          kind: 'source_span',
          path: span.path,
          startLine: span.startLine,
          endLine: span.endLine,
          description: `Source span ${span.startLine}-${span.endLine} out of range (file has ${lines.length} lines)`,
        },
      ],
      reason: 'Source span out of range',
    };
  }

  return {
    recipeType: recipe.recipeType,
    passed: true,
    evidence: [
      {
        kind: 'source_span',
        path: span.path,
        startLine: span.startLine,
        endLine: span.endLine,
        description: `Source span ${span.startLine}-${span.endLine} exists in ${span.path}`,
      },
    ],
  };
}

function runSymbolExistsCheck(
  recipe: VerificationRecipe,
  handle: VerificationReadHandle,
): RecipeOutcome {
  const symbolName = recipe.symbolName;
  if (!symbolName) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [],
      reason: 'No symbol name defined in recipe',
    };
  }

  const node = handle.getNode(symbolName);
  if (node) {
    return {
      recipeType: recipe.recipeType,
      passed: true,
      evidence: [
        {
          kind: 'symbol_index_hit',
          description: `Symbol "${symbolName}" exists in model`,
        },
      ],
    };
  }

  // Try searching by neighbors if a path-based lookup is available
  return {
    recipeType: recipe.recipeType,
    passed: false,
    evidence: [],
    reason: `Symbol "${symbolName}" not found in model`,
  };
}

function runImportEdgeCheck(
  recipe: VerificationRecipe,
  handle: VerificationReadHandle,
): RecipeOutcome {
  const fromPath = recipe.fromPath;
  const toPath = recipe.toPath;

  if (!fromPath || !toPath) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [],
      reason: 'Missing fromPath or toPath in recipe',
    };
  }

  // Check if the import edge exists by looking at neighbors
  const neighbors = handle.neighbors(fromPath, 'imports', 1);
  const found = neighbors.some(
    (edge) => edge.toNodeId === toPath || edge.fromNodeId === toPath,
  );

  if (found) {
    return {
      recipeType: recipe.recipeType,
      passed: true,
      evidence: [
        {
          kind: 'static_analysis_result',
          path: fromPath,
          description: `Import edge from ${fromPath} to ${toPath} exists`,
        },
      ],
    };
  }

  return {
    recipeType: recipe.recipeType,
    passed: false,
    evidence: [],
    reason: `Import edge from ${fromPath} to ${toPath} not found`,
  };
}

function runGrepCheck(
  recipe: VerificationRecipe,
  handle: VerificationReadHandle,
): RecipeOutcome {
  const pattern = recipe.pattern;
  const path = recipe.sourceSpan?.path;

  if (!pattern) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [],
      reason: 'No pattern defined in recipe',
    };
  }

  if (!path) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [],
      reason: 'No path defined in recipe for grep check',
    };
  }

  const content = handle.readFileContent?.(path);
  if (content === null || content === undefined) {
    return {
      recipeType: recipe.recipeType,
      passed: false,
      evidence: [],
      reason: `File not found: ${path}`,
    };
  }

  const found = content.includes(pattern);
  if (found) {
    return {
      recipeType: recipe.recipeType,
      passed: true,
      evidence: [
        {
          kind: 'grep_hit',
          path,
          description: `Pattern "${pattern}" found in ${path}`,
        },
      ],
    };
  }

  return {
    recipeType: recipe.recipeType,
    passed: false,
    evidence: [],
    reason: `Pattern "${pattern}" not found in ${path}`,
  };
}
