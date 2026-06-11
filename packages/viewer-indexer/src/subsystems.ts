import type { SubsystemCandidate, CoChangeEntry, PackageMetadata } from './types.js';
import type { NodeRow, EdgeRow } from '@system2-viewer/viewer-store';

/**
 * Infer subsystem candidates from file nodes, edges, and package metadata.
 *
 * Three inference strategies:
 *   1. Directory-structure grouping: top-level directories as subsystem candidates
 *   2. Package boundary analysis: npm workspace packages
 *   3. Co-change clustering: files frequently changed together
 *
 * All inferred subsystems are hypothesis claims, never confirmed facts.
 */
export function inferSubsystems(
  fileNodes: NodeRow[],
  edges: EdgeRow[],
  packageNodes: PackageMetadata[],
  coChanges?: CoChangeEntry[],
): SubsystemCandidate[] {
  const candidates: SubsystemCandidate[] = [];

  // 1. Directory-structure grouping
  for (const c of inferFromDirectories(fileNodes)) {
    candidates.push(c);
  }

  // 2. Package boundary analysis
  for (const c of inferFromPackages(packageNodes)) {
    candidates.push(c);
  }

  // 3. Co-change clustering
  if (coChanges && coChanges.length > 0) {
    for (const c of inferFromCoChanges(coChanges, fileNodes)) {
      candidates.push(c);
    }
  }

  return deduplicateCandidates(candidates);
}

function inferFromDirectories(fileNodes: NodeRow[]): SubsystemCandidate[] {
  const dirGroups = new Map<string, string[]>();

  for (const node of fileNodes) {
    if (!node.path) continue;
    // Stored paths always use POSIX separators (/) for cross-platform consistency
    const parts = node.path.split('/');
    if (parts.length < 2) continue;

    const topDir = parts[0]!;
    // Skip hidden directories and common non-subsystem dirs
    if (topDir.startsWith('.') || topDir === 'node_modules' || topDir === 'dist') continue;

    const existing = dirGroups.get(topDir);
    if (existing) {
      existing.push(node.path);
    } else {
      dirGroups.set(topDir, [node.path]);
    }
  }

  const candidates: SubsystemCandidate[] = [];
  for (const [dir, paths] of dirGroups) {
    // Only create subsystem candidates for directories with multiple files
    if (paths.length < 2) continue;

    candidates.push({
      id: `subsystem::dir::${dir}`,
      name: dir,
      paths: [dir + '/**'],
      source: 'directory',
      confidence: 'low',
    });
  }

  return candidates;
}

function inferFromPackages(packageNodes: PackageMetadata[]): SubsystemCandidate[] {
  return packageNodes.map((pkg) => ({
    id: `subsystem::package::${pkg.name}`,
    name: pkg.name,
    paths: [pkg.path + '/**'],
    source: 'package' as const,
    confidence: 'medium',
  }));
}

function inferFromCoChanges(
  coChanges: CoChangeEntry[],
  fileNodes: NodeRow[],
): SubsystemCandidate[] {
  // Simple clustering: group files that co-change frequently (>= 3 times)
  const filePaths = new Set(fileNodes.map((n) => n.path).filter((p): p is string => p !== null));
  const highCoChange = coChanges.filter(
    (c) => c.coChangeCount >= 3 && filePaths.has(c.fileA) && filePaths.has(c.fileB),
  );

  if (highCoChange.length === 0) return [];

  // Simple union-find to cluster co-changed files
  const parent = new Map<string, string>();

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root && parent.has(root)) {
      root = parent.get(root)!;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr)!;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  }

  for (const co of highCoChange) {
    if (!parent.has(co.fileA)) parent.set(co.fileA, co.fileA);
    if (!parent.has(co.fileB)) parent.set(co.fileB, co.fileB);
    union(co.fileA, co.fileB);
  }

  // Group by root
  const clusters = new Map<string, string[]>();
  for (const file of parent.keys()) {
    const root = find(file);
    const existing = clusters.get(root);
    if (existing) {
      existing.push(file);
    } else {
      clusters.set(root, [file]);
    }
  }

  const candidates: SubsystemCandidate[] = [];
  let idx = 0;
  for (const [, files] of clusters) {
    if (files.length < 3) continue;
    candidates.push({
      id: `subsystem::cochange::cluster-${idx}`,
      name: `co-change-cluster-${idx}`,
      paths: files,
      source: 'co-change',
      confidence: 'low',
    });
    idx++;
  }

  return candidates;
}

/** Confidence bands ordered from lowest to highest for merge comparison. */
const CONFIDENCE_ORDER: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function deduplicateCandidates(candidates: SubsystemCandidate[]): SubsystemCandidate[] {
  const seen = new Map<string, SubsystemCandidate>();
  for (const c of candidates) {
    const existing = seen.get(c.id);
    if (!existing) {
      seen.set(c.id, c);
    } else {
      // Merge: union paths, take higher confidence, keep more descriptive name
      const mergedPaths = [...new Set([...existing.paths, ...c.paths])];
      const existingOrder = CONFIDENCE_ORDER[existing.confidence] ?? 0;
      const incomingOrder = CONFIDENCE_ORDER[c.confidence] ?? 0;
      const mergedConfidence = incomingOrder > existingOrder ? c.confidence : existing.confidence;
      const mergedName = c.name.length > existing.name.length ? c.name : existing.name;
      seen.set(c.id, {
        ...existing,
        paths: mergedPaths,
        confidence: mergedConfidence,
        name: mergedName,
      });
    }
  }
  return [...seen.values()];
}
