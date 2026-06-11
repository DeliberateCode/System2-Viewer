import type { InferredLayerRuleCandidate, PackageMetadata, ObservedImport } from './types.js';

/**
 * Infer default layer rules from package dependency declarations
 * vs observed imports.
 *
 * Produces InferredLayerRuleCandidate[] -- hypothesis rules, never auto-enforced.
 * The lift from inert data to hypothesis happens only in the composition root.
 */
export function inferDefaultLayerRules(
  packages: PackageMetadata[],
  observedImports: ObservedImport[],
): InferredLayerRuleCandidate[] {
  const candidates: InferredLayerRuleCandidate[] = [];

  // Build a map of declared dependencies per package
  const declaredDeps = new Map<string, Set<string>>();
  for (const pkg of packages) {
    const deps = new Set<string>([
      ...pkg.dependencies,
      ...pkg.devDependencies,
    ]);
    declaredDeps.set(pkg.name, deps);
  }

  // Build a set of all known package names
  const knownPackages = new Set(packages.map((p) => p.name));

  // Find observed imports between known packages that are NOT declared as dependencies
  const undeclaredImports = new Map<string, ObservedImport[]>();

  for (const imp of observedImports) {
    if (!knownPackages.has(imp.fromPackage) || !knownPackages.has(imp.toPackage)) {
      continue;
    }

    const deps = declaredDeps.get(imp.fromPackage);
    if (deps && !deps.has(imp.toPackage)) {
      const key = `${imp.fromPackage}::${imp.toPackage}`;
      const existing = undeclaredImports.get(key);
      if (existing) {
        existing.push(imp);
      } else {
        undeclaredImports.set(key, [imp]);
      }
    }
  }

  // For each declared dependency pair, check if the reverse is NOT declared
  // and create a forbidden_import rule candidate
  for (const pkg of packages) {
    const deps = declaredDeps.get(pkg.name);
    if (!deps) continue;

    for (const dep of deps) {
      if (!knownPackages.has(dep)) continue;

      // Check if the reverse dependency is declared
      const reverseDeps = declaredDeps.get(dep);
      if (reverseDeps && reverseDeps.has(pkg.name)) continue; // Circular -- skip

      // The reverse is not declared: suggest a forbidden_import rule
      // (dep should not import pkg, unless there's a declared dependency)
      const reverseImports = observedImports.filter(
        (i) => i.fromPackage === dep && i.toPackage === pkg.name,
      );

      if (reverseImports.length === 0) {
        // No violations observed -- still a valid rule candidate
        candidates.push({
          name: `no-${dep}-imports-${pkg.name}`,
          type: 'forbidden_import',
          from: { pathGlob: `packages/${dep}/**` },
          to: { pathGlob: `packages/${pkg.name}/**` },
          severity: 'warning',
          evidenceIds: [],
          knownExceptions: [],
        });
      } else {
        // Violations exist -- record as exceptions
        candidates.push({
          name: `no-${dep}-imports-${pkg.name}`,
          type: 'forbidden_import',
          from: { pathGlob: `packages/${dep}/**` },
          to: { pathGlob: `packages/${pkg.name}/**` },
          severity: 'warning',
          evidenceIds: [],
          knownExceptions: reverseImports.map((i) => `${i.fromFile} -> ${i.toFile}`),
        });
      }
    }
  }

  return candidates;
}
