/**
 * getRepositoryOverview operation.
 *
 * Anchors on the repository node, graph-expands the contains tree,
 * and returns a structured overview of the repository.
 */

import type { ReadView, ClaimReadRow } from '../handles.js';
import type {
  ResultEnvelope,
  RepositoryOverview,
  EvidenceRef,
  UncertaintyItem,
  ClaimSummaryRef,
  SubsystemRef,
} from '../types.js';
import { buildEnvelope, type EnvelopeInput } from '../envelope.js';
import { assertStructured } from '../envelope.js';
import { runRetrievalPipeline } from '../pipeline.js';

export function getRepositoryOverview(
  handle: ReadView,
  repoNodeId: string,
  opts?: { revision?: string; maxDepth?: number },
): ResultEnvelope<RepositoryOverview> {
  const revision = opts?.revision ?? 'latest';
  const maxDepth = opts?.maxDepth ?? 3;

  const repoNode = handle.getNode(repoNodeId);
  if (!repoNode) {
    const empty: RepositoryOverview = {
      mainLanguages: [],
      structure: { directories: 0, totalFiles: 0 },
      candidateSubsystems: [],
      candidateEntrypoints: [],
      topClaims: [],
      topUncertainties: [],
      backendCoverage: {},
    };

    const envelope = buildEnvelope<RepositoryOverview>({
      op: 'getRepositoryOverview',
      args: { repo: repoNodeId, revision },
      data: empty,
      modelRevision: revision,
      suggestedNextCalls: [
        { op: 'viewer.index', args: {}, reason: 'No repository node found; indexing may be needed' },
      ],
    });
    assertStructured<RepositoryOverview>(envelope);
    return envelope;
  }

  // Gather contained nodes via widened accessor or graph traversal
  let containedNodes: Array<Record<string, unknown>> = [];
  if (handle.enumerateContainedNodes) {
    containedNodes = handle.enumerateContainedNodes(repoNodeId);
  } else {
    const neighbors = handle.neighbors(repoNodeId, 'contains', maxDepth);
    for (const edge of neighbors) {
      const targetId = edge.toNodeId === repoNodeId ? edge.fromNodeId : edge.toNodeId;
      const node = handle.getNode(targetId);
      if (node) {
        containedNodes.push(node);
      }
    }
  }

  // Classify nodes
  const languages = new Set<string>();
  let directories = 0;
  let totalFiles = 0;
  const subsystems: SubsystemRef[] = [];
  const entrypoints: string[] = [];

  for (const node of containedNodes) {
    const kind = node['kind'] as string | undefined;
    const lang = node['language'] as string | undefined;
    const displayName = (node['display_name'] as string) ?? (node['id'] as string) ?? '';
    const fileClass = node['file_class'] as string | undefined;

    if (lang) languages.add(lang);

    if (kind === 'directory') {
      directories++;
    } else if (kind === 'file') {
      totalFiles++;
      if (fileClass === 'entrypoint') {
        entrypoints.push(node['id'] as string ?? displayName);
      }
    } else if (kind === 'subsystem') {
      subsystems.push({
        id: (node['id'] as string) ?? '',
        name: displayName,
      });
    }
  }

  // Use pipeline to gather claims
  const pipelineResult = runRetrievalPipeline(handle, {
    nodeIds: [repoNodeId],
    revision,
    maxDepth,
  });

  // Gather top claims from pipeline anchors
  const topClaims: ClaimSummaryRef[] = [];
  const topUncertainties: UncertaintyItem[] = [];
  const evidence: EvidenceRef[] = [];

  for (const anchor of pipelineResult.anchors) {
    if (anchor.source === 'claim' && anchor.data['claimType']) {
      topClaims.push({
        claimId: anchor.id,
        claimType: anchor.data['claimType'] as string,
        statement: (anchor.data['statement'] as string) ?? '',
      });
    }
  }

  // Build partiality if available
  const partialityRows = handle.partiality(revision);
  const partiality = partialityRows.length > 0
    ? {
        ref: 'partiality',
        scopes: partialityRows.map((p) => ({ id: p.id, scope: p.scope })),
      }
    : undefined;

  const data: RepositoryOverview = {
    mainLanguages: Array.from(languages).sort(),
    structure: { directories, totalFiles },
    candidateSubsystems: subsystems,
    candidateEntrypoints: entrypoints,
    topClaims,
    topUncertainties,
    backendCoverage: repoNode['metadata_json']
      ? safeParseJson(repoNode['metadata_json'] as string)
      : {},
  };

  // Build dynamic suggestions based on result
  const suggestions: Array<{ op: string; args: Record<string, unknown>; reason: string }> = [
    { op: 'viewer.findEntrypoints', args: { query: 'main' }, reason: 'Explore entrypoints' },
    { op: 'viewer.listClaims', args: {}, reason: 'Browse all surfaced claims' },
  ];

  if (partiality) {
    suggestions.push({
      op: 'viewer.listUncertainties',
      args: {},
      reason: 'Model has partial coverage; review uncertainties from incomplete extraction',
    });
  }

  const envelope = buildEnvelope<RepositoryOverview>({
    op: 'getRepositoryOverview',
    args: { repo: repoNodeId, revision },
    data,
    evidence,
    uncertainties: topUncertainties,
    partiality,
    modelRevision: revision,
    suggestedNextCalls: suggestions,
  });

  assertStructured<RepositoryOverview>(envelope);
  return envelope;
}

function safeParseJson(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
