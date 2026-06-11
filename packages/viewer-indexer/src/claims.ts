import { randomUUID } from 'node:crypto';
import {
  computeConfidence,
  computeFreshness,
  isSurfaceable,
  stableKey,
} from '@system2-viewer/viewer-core';
import type {
  ConfidenceBand,
  FreshnessBand,
  EvidenceRef,
  Claim,
} from '@system2-viewer/viewer-core';
import type { ClaimRow, EvidenceRow, NodeRow } from '@system2-viewer/viewer-store';
import type { SubsystemCandidate, ResolvedImport, SymbolInfo } from './types.js';

interface ClaimGenerationInput {
  repositoryId: string;
  revision: string;
  generationId: string;
  timestamp: string;
  fileNodes: NodeRow[];
  symbolsByFile: Map<string, SymbolInfo[]>;
  resolvedImports: ResolvedImport[];
  subsystems: SubsystemCandidate[];
  entryPointFileIds: string[];
}

interface GeneratedClaims {
  claims: ClaimRow[];
  evidence: EvidenceRow[];
}

const DEFAULT_SCORED_STATE = { confidence: 'none' as ConfidenceBand, freshness: 'fresh' as FreshnessBand };

/**
 * Generate typed claims for discovered facts and score them via viewer-core.
 *
 * Claim types generated:
 *   - file-defines-symbol / file-defines-symbols (per-file aggregate)
 *   - package-imports-package
 *   - directory-derived-subsystem-hypothesis
 *   - subsystem-owns-file
 *   - likely-entrypoint
 */
export function generateClaims(input: ClaimGenerationInput): GeneratedClaims {
  const claims: ClaimRow[] = [];
  const evidence: EvidenceRow[] = [];
  const now = input.timestamp;

  // file-defines-symbols claims
  for (const [fileId, symbols] of input.symbolsByFile) {
    if (symbols.length === 0) continue;

    const fileNode = input.fileNodes.find((n) => n.id === fileId);
    if (!fileNode) continue;

    const exportedSymbols = symbols.filter((s) => s.exported);
    const allSymbolNames = symbols.map((s) => s.name);

    // Create evidence for each symbol
    const symbolEvidenceRefs: EvidenceRef[] = [];
    for (const sym of symbols) {
      const evId = `ev::${randomUUID()}`;
      evidence.push({
        id: evId,
        kind: 'tree_sitter_query',
        epistemic: 'static',
        repositoryId: input.repositoryId,
        revision: input.revision,
        path: fileNode.path,
        startLine: sym.startLine,
        endLine: sym.endLine,
        contentHash: null,
        extractor: 'viewer-indexer::extract',
        derivationLocality: 'local',
        actor: null,
        metadataJson: JSON.stringify({ symbolName: sym.name, symbolKind: sym.kind }),
        createdAt: now,
      });
      symbolEvidenceRefs.push({ evidenceId: evId, kind: 'tree_sitter_query' });
    }

    const confidence = computeConfidence(symbolEvidenceRefs, [], DEFAULT_SCORED_STATE);

    const claimId = `claim::${stableKey('file', input.repositoryId, fileNode.path ?? fileId)}::defines`;
    const hasExported = exportedSymbols.length > 0;

    const claim: Claim = {
      id: claimId,
      status: 'hypothesis',
      confidence,
      supportingEvidence: symbolEvidenceRefs,
      contradictingEvidence: [],
      verificationRecipeCount: 1,
      claimType: 'file-defines-symbols',
      scope: { exported: hasExported, path: fileNode.path },
    };

    const surfaced = isSurfaceable(claim) ? 1 : 0;

    claims.push({
      id: claimId,
      claimType: 'file-defines-symbols',
      statement: `File ${fileNode.path ?? fileId} defines symbols: ${allSymbolNames.join(', ')}`,
      status: 'hypothesis',
      repositoryId: input.repositoryId,
      scopeJson: JSON.stringify({ exported: hasExported, path: fileNode.path }),
      confidenceBand: confidence,
      freshnessBand: 'fresh',
      supportingEvidenceIdsJson: JSON.stringify(symbolEvidenceRefs.map((e) => e.evidenceId)),
      contradictingEvidenceIdsJson: null,
      verificationRecipesJson: JSON.stringify([{ recipeType: 'symbol_exists_check', description: 'Verify symbols still exist in file' }]),
      derivationMethod: 'indexer::extract',
      generationId: input.generationId,
      surfaced,
      validFromRevision: input.revision,
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // package-imports-package claims from resolved imports
  const packageImportPairs = new Set<string>();
  for (const imp of input.resolvedImports) {
    // Derive package from file path
    const fromPkg = extractPackageName(imp.fromFileId);
    const toPkg = extractPackageName(imp.toFileId);
    if (fromPkg && toPkg && fromPkg !== toPkg) {
      const key = `${fromPkg}::${toPkg}`;
      if (!packageImportPairs.has(key)) {
        packageImportPairs.add(key);

        const evId = `ev::${randomUUID()}`;
        evidence.push({
          id: evId,
          kind: 'static_analysis_result',
          epistemic: 'static',
          repositoryId: input.repositoryId,
          revision: input.revision,
          path: null,
          startLine: null,
          endLine: null,
          contentHash: null,
          extractor: 'viewer-indexer::resolve-imports',
          derivationLocality: 'local',
          actor: null,
          metadataJson: JSON.stringify({ fromPackage: fromPkg, toPackage: toPkg }),
          createdAt: now,
        });

        const evRefs: EvidenceRef[] = [{ evidenceId: evId, kind: 'static_analysis_result' }];
        const confidence = computeConfidence(evRefs, [], DEFAULT_SCORED_STATE);

        const claimId = `claim::${stableKey('package', input.repositoryId, fromPkg)}::imports::${toPkg}`;

        const claim: Claim = {
          id: claimId,
          status: 'hypothesis',
          confidence,
          supportingEvidence: evRefs,
          contradictingEvidence: [],
          verificationRecipeCount: 1,
          claimType: 'package-imports-package',
          scope: { fromPackage: fromPkg, toPackage: toPkg },
        };

        const surfaced = isSurfaceable(claim) ? 1 : 0;

        claims.push({
          id: claimId,
          claimType: 'package-imports-package',
          statement: `Package ${fromPkg} imports package ${toPkg}`,
          status: 'hypothesis',
          repositoryId: input.repositoryId,
          scopeJson: JSON.stringify({ fromPackage: fromPkg, toPackage: toPkg }),
          confidenceBand: confidence,
          freshnessBand: 'fresh',
          supportingEvidenceIdsJson: JSON.stringify([evId]),
          contradictingEvidenceIdsJson: null,
          verificationRecipesJson: JSON.stringify([{ recipeType: 'import_edge_check', description: 'Verify import relationship exists' }]),
          derivationMethod: 'indexer::resolve-imports',
          generationId: input.generationId,
          surfaced,
          validFromRevision: input.revision,
          validToRevision: null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // subsystem hypothesis claims
  for (const sub of input.subsystems) {
    const evId = `ev::${randomUUID()}`;
    evidence.push({
      id: evId,
      kind: 'static_analysis_result',
      epistemic: 'inferred',
      repositoryId: input.repositoryId,
      revision: input.revision,
      path: null,
      startLine: null,
      endLine: null,
      contentHash: null,
      extractor: `viewer-indexer::subsystems::${sub.source}`,
      derivationLocality: 'local',
      actor: null,
      metadataJson: JSON.stringify({ subsystemId: sub.id, source: sub.source }),
      createdAt: now,
    });

    const evRefs: EvidenceRef[] = [{ evidenceId: evId, kind: 'static_analysis_result' }];
    const confidence = computeConfidence(evRefs, [], DEFAULT_SCORED_STATE);

    const claimId = `claim::${sub.id}::hypothesis`;

    const claim: Claim = {
      id: claimId,
      status: 'hypothesis',
      confidence,
      supportingEvidence: evRefs,
      contradictingEvidence: [],
      verificationRecipeCount: 1,
      claimType: 'directory-derived-subsystem-hypothesis',
      scope: { subsystemId: sub.id, paths: sub.paths },
    };

    const surfaced = isSurfaceable(claim) ? 1 : 0;

    claims.push({
      id: claimId,
      claimType: 'directory-derived-subsystem-hypothesis',
      statement: `Subsystem "${sub.name}" inferred from ${sub.source} grouping`,
      status: 'hypothesis',
      repositoryId: input.repositoryId,
      scopeJson: JSON.stringify({ subsystemId: sub.id, paths: sub.paths }),
      confidenceBand: confidence,
      freshnessBand: 'fresh',
      supportingEvidenceIdsJson: JSON.stringify([evId]),
      contradictingEvidenceIdsJson: null,
      verificationRecipesJson: JSON.stringify([{ recipeType: 'grep_check', description: 'Verify directory structure still exists' }]),
      derivationMethod: `indexer::subsystems::${sub.source}`,
      generationId: input.generationId,
      surfaced,
      validFromRevision: input.revision,
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // likely-entrypoint claims
  for (const fileId of input.entryPointFileIds) {
    const fileNode = input.fileNodes.find((n) => n.id === fileId);
    if (!fileNode) continue;

    const evId = `ev::${randomUUID()}`;
    evidence.push({
      id: evId,
      kind: 'static_analysis_result',
      epistemic: 'inferred',
      repositoryId: input.repositoryId,
      revision: input.revision,
      path: fileNode.path,
      startLine: null,
      endLine: null,
      contentHash: null,
      extractor: 'viewer-indexer::classify',
      derivationLocality: 'local',
      actor: null,
      metadataJson: JSON.stringify({ reason: 'entry-point-pattern' }),
      createdAt: now,
    });

    const evRefs: EvidenceRef[] = [{ evidenceId: evId, kind: 'static_analysis_result' }];
    const confidence = computeConfidence(evRefs, [], DEFAULT_SCORED_STATE);

    const claimId = `claim::${stableKey('file', input.repositoryId, fileNode.path ?? fileId)}::entrypoint`;

    const claim: Claim = {
      id: claimId,
      status: 'hypothesis',
      confidence,
      supportingEvidence: evRefs,
      contradictingEvidence: [],
      verificationRecipeCount: 1,
      claimType: 'likely-entrypoint',
      scope: { path: fileNode.path },
    };

    const surfaced = isSurfaceable(claim) ? 1 : 0;

    claims.push({
      id: claimId,
      claimType: 'likely-entrypoint',
      statement: `File ${fileNode.path ?? fileId} is a likely entry point`,
      status: 'hypothesis',
      repositoryId: input.repositoryId,
      scopeJson: JSON.stringify({ path: fileNode.path }),
      confidenceBand: confidence,
      freshnessBand: 'fresh',
      supportingEvidenceIdsJson: JSON.stringify([evId]),
      contradictingEvidenceIdsJson: null,
      verificationRecipesJson: JSON.stringify([{ recipeType: 'source_span_check', description: 'Verify entry point file still exists' }]),
      derivationMethod: 'indexer::classify',
      generationId: input.generationId,
      surfaced,
      validFromRevision: input.revision,
      validToRevision: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { claims, evidence };
}

function extractPackageName(fileIdOrPath: string): string | null {
  // Try to extract package name from path like packages/viewer-core/src/...
  const match = fileIdOrPath.match(/(?:^|::)packages\/([^/]+)\//);
  if (match) return match[1]!;

  // Try node id format: node::file::<repoId>::packages/<pkg>/...
  const nodeMatch = fileIdOrPath.match(/packages\/([^/]+)\//);
  if (nodeMatch) return nodeMatch[1]!;

  return null;
}
