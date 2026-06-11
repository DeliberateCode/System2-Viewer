import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

// --- Types ---

interface Violation {
  file: string;
  line: number;
  specifier: string;
  kind: 'static-import' | 'dynamic-import' | 'global-usage';
}

interface AuditResult {
  scannedFiles: number;
  violations: Violation[];
  excludedPaths: string[];
  exitCode: 0 | 1;
}

// --- Constants ---

const NETWORK_MODULES = new Set([
  'http', 'https', 'net', 'dgram', 'tls', 'dns',
  'node:http', 'node:https', 'node:net', 'node:dgram', 'node:tls', 'node:dns',
]);

const NETWORK_GLOBAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfetch\s*\(/, label: 'fetch(' },
  { pattern: /\bWebSocket\b/, label: 'WebSocket' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { pattern: /new\s+URL\s*\(\s*['"]https?:/, label: "new URL('http..." },
];

const PRODUCTION_PACKAGES = [
  'viewer-core', 'viewer-config', 'viewer-store',
  'viewer-indexer', 'viewer-retrieval', 'viewer-verify', 'viewer-surface',
];

const EXCLUDED_PATHS = ['viewer-bench'];

// --- CLI argument parsing ---

function parseArgs(argv: string[]): { root: string } {
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && i + 1 < argv.length) {
      root = argv[++i]!;
    }
  }
  return { root };
}

// --- File discovery ---

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// --- AST scanning ---

function scanFile(filePath: string, relPath: string): Violation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2022, true);
  const violations: Violation[] = [];

  function getLine(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  ts.forEachChild(sourceFile, function visit(node) {
    // Static imports: import X from 'module'
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (NETWORK_MODULES.has(specifier)) {
        violations.push({
          file: relPath,
          line: getLine(node),
          specifier,
          kind: 'static-import',
        });
      }
    }

    // Re-exports: export { X } from 'module'
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (NETWORK_MODULES.has(specifier)) {
        violations.push({
          file: relPath,
          line: getLine(node),
          specifier,
          kind: 'static-import',
        });
      }
    }

    // Dynamic imports: import('module')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg) && NETWORK_MODULES.has(arg.text)) {
        violations.push({
          file: relPath,
          line: getLine(node),
          specifier: arg.text,
          kind: 'dynamic-import',
        });
      }
    }

    ts.forEachChild(node, visit);
  });

  // Line-by-line scan for global patterns
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { pattern, label } of NETWORK_GLOBAL_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: relPath,
          line: i + 1,
          specifier: label,
          kind: 'global-usage',
        });
      }
    }
  }

  return violations;
}

// --- Main ---

export function scanForNetworkImports(root: string): AuditResult {
  const packagesDir = path.join(root, 'packages');
  const allViolations: Violation[] = [];
  let totalFiles = 0;

  for (const pkgName of PRODUCTION_PACKAGES) {
    const srcDir = path.join(packagesDir, pkgName, 'src');
    const tsFiles = findTsFiles(srcDir);
    totalFiles += tsFiles.length;

    for (const filePath of tsFiles) {
      const relPath = path.relative(root, filePath);
      const fileViolations = scanFile(filePath, relPath);
      allViolations.push(...fileViolations);
    }
  }

  return {
    scannedFiles: totalFiles,
    violations: allViolations,
    excludedPaths: EXCLUDED_PATHS,
    exitCode: allViolations.length > 0 ? 1 : 0,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const result = scanForNetworkImports(root);

  // Output structured JSON to stdout
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  // Also print human-readable summary to stderr
  if (result.violations.length > 0) {
    process.stderr.write(`\nVIOLATIONS (${result.violations.length}):\n`);
    for (const v of result.violations) {
      process.stderr.write(`  ${v.file}:${v.line} [${v.kind}] ${v.specifier}\n`);
    }
  }
  process.stderr.write(
    `Egress audit: ${result.scannedFiles} files scanned, ${result.violations.length} network imports found\n`,
  );

  process.exit(result.exitCode);
}

main();
