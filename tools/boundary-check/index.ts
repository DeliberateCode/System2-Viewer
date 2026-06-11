import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

// --- Types ---

interface Violation {
  kind: 'import-topology' | 'c2-single-writer' | 'surface-extra' | 'surface-missing';
  pkg: string;
  file: string;
  line: number;
  message: string;
  blocking: boolean;
}

interface BoundaryEntry {
  module: string;
  description: string;
  allowed_imports_from: string[];
  forbidden_imports_from: string[];
}

interface ModuleBoundaries {
  version: string;
  boundaries: BoundaryEntry[];
}

interface ExportEntry {
  name: string;
  kind: string;
  signature?: string;
}

interface ModuleSpec {
  description: string;
  public_exports: ExportEntry[];
  internal_only: string[];
}

interface InterfacesSpec {
  version: string;
  modules: Record<string, ModuleSpec>;
}

// --- Constants ---

const C2_WRITER_SET = new Set(['viewer-indexer', 'viewer-verify', 'viewer-surface', 'viewer-bench']);
const WORKSPACE_PREFIX = '@system2-viewer/';

// --- CLI argument parsing ---

function parseArgs(argv: string[]): { strictSurface: boolean; root: string } {
  let strictSurface = false;
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strict-surface') {
      strictSurface = true;
    } else if (argv[i] === '--root' && i + 1 < argv.length) {
      root = argv[++i]!;
    }
  }
  return { strictSurface, root };
}

// --- File discovery ---

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// --- Import extraction via TS compiler API ---

interface ImportInfo {
  specifier: string;
  line: number;
}

function extractImports(filePath: string, content: string): ImportInfo[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2022, true);
  const imports: ImportInfo[] = [];

  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      imports.push({ specifier: node.moduleSpecifier.text, line });
    }
    // Also catch re-exports: export { X } from 'Y'
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      imports.push({ specifier: node.moduleSpecifier.text, line });
    }
  });

  return imports;
}

function resolveWorkspacePackage(specifier: string): string | null {
  if (specifier.startsWith(WORKSPACE_PREFIX)) {
    return specifier.slice(WORKSPACE_PREFIX.length);
  }
  return null;
}

// --- Export extraction from barrel files ---

function extractExportedNames(filePath: string, content: string): string[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2022, true);
  const names: string[] = [];

  ts.forEachChild(sourceFile, function visit(node) {
    // export { A, B } from '...' or export { A, B }
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          names.push(el.name.text);
        }
      }
      // export * from '...' -- skip for now, would need to resolve the module
      return;
    }

    // export default ...
    if (ts.isExportAssignment(node)) {
      names.push('default');
      return;
    }

    // Check for export modifiers on declarations
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) return;

    // export function foo() {}
    if (ts.isFunctionDeclaration(node) && node.name) {
      names.push(node.name.text);
    }
    // export class Foo {}
    else if (ts.isClassDeclaration(node) && node.name) {
      names.push(node.name.text);
    }
    // export interface Foo {}
    else if (ts.isInterfaceDeclaration(node)) {
      names.push(node.name.text);
    }
    // export type Foo = ...
    else if (ts.isTypeAliasDeclaration(node)) {
      names.push(node.name.text);
    }
    // export enum Foo {}
    else if (ts.isEnumDeclaration(node)) {
      names.push(node.name.text);
    }
    // export const/let/var
    else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          names.push(decl.name.text);
        }
      }
    }
  });

  return names;
}

// --- Signal 1: Import Topology ---

function checkImportTopology(
  packagesDir: string,
  packageNames: string[],
  boundaryMap: Map<string, BoundaryEntry>,
): Violation[] {
  const violations: Violation[] = [];

  for (const pkgName of packageNames) {
    const srcDir = path.join(packagesDir, pkgName, 'src');
    const tsFiles = findTsFiles(srcDir);
    const boundary = boundaryMap.get(pkgName);
    if (!boundary) continue;

    const allowedSet = new Set(boundary.allowed_imports_from);
    const forbiddenSet = new Set(boundary.forbidden_imports_from);

    for (const filePath of tsFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const imports = extractImports(filePath, content);
      const relFile = path.relative(packagesDir, filePath);

      for (const imp of imports) {
        const target = resolveWorkspacePackage(imp.specifier);
        if (target === null) continue; // not a workspace import
        if (target === pkgName) continue; // self-import is fine

        if (forbiddenSet.has(target)) {
          violations.push({
            kind: 'import-topology',
            pkg: pkgName,
            file: relFile,
            line: imp.line,
            message: `Forbidden import: ${pkgName} -> ${target} (via "${imp.specifier}")`,
            blocking: true,
          });
        } else if (!allowedSet.has(target)) {
          violations.push({
            kind: 'import-topology',
            pkg: pkgName,
            file: relFile,
            line: imp.line,
            message: `Undeclared import: ${pkgName} -> ${target} (via "${imp.specifier}"). Not in allowed_imports_from.`,
            blocking: true,
          });
        }
      }
    }
  }

  return violations;
}

// --- Signal 2: C2 Single-Writer ---

function checkC2SingleWriter(
  packagesDir: string,
  packageNames: string[],
): Violation[] {
  const violations: Violation[] = [];

  for (const pkgName of packageNames) {
    if (C2_WRITER_SET.has(pkgName)) continue; // allowed to import viewer-store

    const srcDir = path.join(packagesDir, pkgName, 'src');
    const tsFiles = findTsFiles(srcDir);

    for (const filePath of tsFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const imports = extractImports(filePath, content);
      const relFile = path.relative(packagesDir, filePath);

      for (const imp of imports) {
        const target = resolveWorkspacePackage(imp.specifier);
        if (target === 'viewer-store') {
          violations.push({
            kind: 'c2-single-writer',
            pkg: pkgName,
            file: relFile,
            line: imp.line,
            message: `C2 single-writer violation: ${pkgName} imports viewer-store but is not in the C2 writer set [${[...C2_WRITER_SET].join(', ')}]`,
            blocking: true,
          });
        }
      }
    }
  }

  return violations;
}

// --- Signal 3: Surface Drift ---

function checkSurfaceDrift(
  packagesDir: string,
  packageNames: string[],
  interfacesSpec: InterfacesSpec,
  strictSurface: boolean,
): Violation[] {
  const violations: Violation[] = [];

  for (const pkgName of packageNames) {
    const moduleSpec = interfacesSpec.modules[pkgName];
    if (!moduleSpec) continue; // no interface spec for this package

    const indexPath = path.join(packagesDir, pkgName, 'src', 'index.ts');
    if (!fs.existsSync(indexPath)) {
      // If index.ts doesn't exist but we have declared exports, report all as missing
      for (const exp of moduleSpec.public_exports) {
        violations.push({
          kind: 'surface-missing',
          pkg: pkgName,
          file: `${pkgName}/src/index.ts`,
          line: 0,
          message: `Missing export: "${exp.name}" declared in interfaces.json but index.ts not found`,
          blocking: strictSurface,
        });
      }
      continue;
    }

    const content = fs.readFileSync(indexPath, 'utf-8');
    const actualExports = new Set(extractExportedNames(indexPath, content));
    const declaredExports = new Set(moduleSpec.public_exports.map(e => e.name));

    // Extra: exported but not declared
    for (const name of actualExports) {
      if (!declaredExports.has(name)) {
        violations.push({
          kind: 'surface-extra',
          pkg: pkgName,
          file: `${pkgName}/src/index.ts`,
          line: 0,
          message: `Extra export: "${name}" exported from index.ts but not declared in interfaces.json`,
          blocking: true,
        });
      }
    }

    // Missing: declared but not exported
    for (const name of declaredExports) {
      if (!actualExports.has(name)) {
        violations.push({
          kind: 'surface-missing',
          pkg: pkgName,
          file: `${pkgName}/src/index.ts`,
          line: 0,
          message: `Missing export: "${name}" declared in interfaces.json but not exported from index.ts`,
          blocking: strictSurface,
        });
      }
    }
  }

  return violations;
}

// --- Main ---

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);

  const boundariesPath = path.join(root, 'tools', 'boundary-check', 'module-boundaries.json');
  const interfacesPath = path.join(root, 'tools', 'boundary-check', 'interfaces.json');

  if (!fs.existsSync(boundariesPath)) {
    console.error(`Error: ${boundariesPath} not found`);
    process.exit(1);
  }
  if (!fs.existsSync(interfacesPath)) {
    console.error(`Error: ${interfacesPath} not found`);
    process.exit(1);
  }

  const boundaries: ModuleBoundaries = JSON.parse(fs.readFileSync(boundariesPath, 'utf-8'));
  const interfaces: InterfacesSpec = JSON.parse(fs.readFileSync(interfacesPath, 'utf-8'));

  const boundaryMap = new Map<string, BoundaryEntry>();
  for (const entry of boundaries.boundaries) {
    boundaryMap.set(entry.module, entry);
  }

  // Discover packages
  const packagesDir = path.join(root, 'packages');
  if (!fs.existsSync(packagesDir)) {
    console.error(`Error: ${packagesDir} not found`);
    process.exit(1);
  }

  const packageNames = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();

  console.log(`Boundary check: scanning ${packageNames.length} packages...\n`);

  // Run all checks
  const allViolations: Violation[] = [
    ...checkImportTopology(packagesDir, packageNames, boundaryMap),
    ...checkC2SingleWriter(packagesDir, packageNames),
    ...checkSurfaceDrift(packagesDir, packageNames, interfaces, args.strictSurface),
  ];

  // Partition into blocking and advisory
  const blocking = allViolations.filter(v => v.blocking);
  const advisory = allViolations.filter(v => !v.blocking);

  // Report
  if (blocking.length > 0) {
    console.log(`BLOCKING VIOLATIONS (${blocking.length}):\n`);
    for (const v of blocking) {
      console.log(`  [${v.kind}] ${v.file}:${v.line}`);
      console.log(`    ${v.message}\n`);
    }
  }

  if (advisory.length > 0) {
    console.log(`ADVISORY (${advisory.length}):\n`);
    for (const v of advisory) {
      console.log(`  [${v.kind}] ${v.file}:${v.line}`);
      console.log(`    ${v.message}\n`);
    }
  }

  const total = allViolations.length;
  if (total === 0) {
    console.log('All checks passed. Zero violations.');
  } else {
    console.log(`Summary: ${blocking.length} blocking, ${advisory.length} advisory.`);
  }

  process.exit(blocking.length > 0 ? 1 : 0);
}

main();
