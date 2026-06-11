import { createRequire } from 'node:module';
import type { SymbolInfo, ImportInfo } from './types.js';

/**
 * TypeScript compiler API adapter for type-aware symbol extraction.
 *
 * This adapter uses the TypeScript compiler API for single-file AST parsing
 * with type-aware symbol extraction. It does NOT implement a full Language
 * Service for cross-file binding resolution. Cross-file resolution is
 * handled by the GlobalSymbolMap.
 *
 * Degrades gracefully if the `typescript` package is not resolvable.
 */
export class TsLanguageServiceAdapter {
  private ts: typeof import('typescript') | null = null;
  private initialized = false;
  private initError: string | null = null;

  /**
   * Attempt to initialize the TypeScript compiler API.
   * Returns true if successful, false with degradation info otherwise.
   */
  initialize(): { ok: boolean; reason?: string } {
    if (this.initialized) {
      return this.ts !== null
        ? { ok: true }
        : { ok: false, reason: this.initError ?? 'TypeScript not available' };
    }
    this.initialized = true;

    try {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.ts = require('typescript') as typeof import('typescript');
      return { ok: true };
    } catch {
      this.initError = 'TypeScript package not resolvable';
      return { ok: false, reason: this.initError };
    }
  }

  /**
   * Extract symbols from a TypeScript/JavaScript file using the TypeScript
   * compiler API. Distinguishes types, interfaces, enums, and overloads more
   * accurately than tree-sitter but operates on a single file at a time.
   */
  extractSymbols(
    filePath: string,
    content: string,
  ): { symbols: SymbolInfo[]; imports: ImportInfo[] } | null {
    if (!this.ts) return null;

    const ts = this.ts;
    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS,
      );

      function visit(node: import('typescript').Node): void {
        // Export declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
          const isExported = hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'function',
            exported: isExported,
            startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          });
        } else if (ts.isClassDeclaration(node) && node.name) {
          const isExported = hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'class',
            exported: isExported,
            startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          });
        } else if (ts.isInterfaceDeclaration(node)) {
          const isExported = hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'interface',
            exported: isExported,
            startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          });
        } else if (ts.isTypeAliasDeclaration(node)) {
          const isExported = hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'type',
            exported: isExported,
            startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          });
        } else if (ts.isEnumDeclaration(node)) {
          const isExported = hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'enum',
            exported: isExported,
            startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          });
        } else if (ts.isVariableStatement(node)) {
          const isExported = hasExportModifier(node);
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              symbols.push({
                name: decl.name.text,
                kind: 'variable',
                exported: isExported,
                startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
              });
            }
          }
        } else if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const specifier = moduleSpecifier.text;
            const names: string[] = [];
            const isTypeOnly = node.importClause?.isTypeOnly ?? false;

            const clause = node.importClause;
            if (clause) {
              if (clause.name) {
                names.push(clause.name.text);
              }
              if (clause.namedBindings) {
                if (ts.isNamedImports(clause.namedBindings)) {
                  for (const el of clause.namedBindings.elements) {
                    names.push(el.name.text);
                  }
                } else if (ts.isNamespaceImport(clause.namedBindings)) {
                  names.push(`* as ${clause.namedBindings.name.text}`);
                }
              }
            }

            imports.push({
              specifier,
              names,
              isTypeOnly,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          }
        } else if (ts.isExportDeclaration(node)) {
          // Handle re-exports: export { X } from './module'
          // Symbols handled via the underlying declaration
        }

        ts.forEachChild(node, visit);
      }

      function hasExportModifier(node: import('typescript').Node): boolean {
        if (!ts.canHaveModifiers(node)) return false;
        const modifiers = ts.getModifiers(node);
        return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      }

      visit(sourceFile);
    } catch {
      return null;
    }

    return { symbols, imports };
  }
}
