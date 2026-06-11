/**
 * Per-kind renderer functions.
 *
 * Each function appends ViewLine[] for a specific ViewKind.
 * Renderers add ZERO model semantics -- they only format what the operation returned.
 */

import type { ViewLine } from '../types.js';
import type { ResultEnvelope } from '@system2-viewer/viewer-retrieval';
import {
  trivialLine,
  claimLine,
  evidenceLine,
  hypothesisLine,
  appendPartialityNotice,
} from './line-builders.js';

export function renderDoctor(lines: ViewLine[], data: Record<string, unknown>): void {
  lines.push(trivialLine(`Node.js: ${data['nodeVersion'] ?? 'unknown'}`));
  lines.push(trivialLine(`SQLite binding: ${data['sqliteBinding'] ? 'ok' : 'MISSING'}`));

  const detailed = data['grammars'] as Record<string, string> | undefined;
  if (detailed) {
    for (const [lang, status] of Object.entries(detailed)) {
      lines.push(trivialLine(`Grammar ${lang}: ${status}`));
    }
  } else {
    const legacy = data['grammarAvailability'] as Record<string, boolean> | undefined;
    if (legacy) {
      for (const [lang, ok] of Object.entries(legacy)) {
        lines.push(trivialLine(`Grammar ${lang}: ${ok ? 'ok' : 'MISSING'}`));
      }
    }
  }

  lines.push(trivialLine(`TS backend: ${data['tsBackendAvailable'] ? 'available' : 'not available'}`));
  lines.push(trivialLine(`Git: ${data['gitAvailable'] ? 'available' : 'not available'}`));
  lines.push(trivialLine(`Model: ${data['modelStatus'] ?? 'unknown'}`));
  lines.push(trivialLine(`Backend: ${data['effectiveBackend'] ?? 'unknown'}`));
  if (data['degradationReason']) {
    lines.push(hypothesisLine(`Degradation: ${data['degradationReason']}`));
  }

  const embedding = data['embeddingModel'] as { status: string; modelName?: string; dimension?: number } | undefined;
  if (embedding) {
    const parts = [`Embedding model: ${embedding.status}`];
    if (embedding.modelName) parts.push(`(${embedding.modelName})`);
    if (embedding.dimension) parts.push(`dim=${embedding.dimension}`);
    lines.push(trivialLine(parts.join(' ')));
  }

  const migration = data['schemaMigration'] as {
    currentVersion: number;
    latestVersion: number;
    pendingMigrations: number;
  } | undefined;
  if (migration) {
    lines.push(trivialLine(
      `Schema migration: v${migration.currentVersion}/${migration.latestVersion}` +
      (migration.pendingMigrations > 0 ? ` (${migration.pendingMigrations} pending)` : ''),
    ));
  }

  const suggestions = data['suggestions'] as Array<{
    issue: string;
    command: string;
    severity: string;
  }> | undefined;
  if (suggestions && suggestions.length > 0) {
    lines.push(trivialLine(''));
    lines.push(trivialLine('Suggestions:'));
    for (const s of suggestions) {
      const prefix = s.severity === 'error' ? 'ERROR' : s.severity === 'warning' ? 'WARN' : 'INFO';
      lines.push(hypothesisLine(`  [${prefix}] ${s.issue}: ${s.command}`));
    }
  }
}

export function renderStatus(lines: ViewLine[], data: Record<string, unknown>): void {
  lines.push(trivialLine(`Model revision: ${data['modelRevision'] ?? 'none'}`));
  lines.push(trivialLine(`Readiness: ${data['readinessState'] ?? 'unknown'}`));
  if (data['hasPartiality'] === true) {
    lines.push(hypothesisLine('WARNING: Model has partial extraction'));
  }
}

export function renderInit(lines: ViewLine[], data: Record<string, unknown>): void {
  if (data['created']) {
    lines.push(trivialLine(`Created: ${data['configPath']}`));
  } else if (data['existed']) {
    lines.push(trivialLine(`Config already exists: ${data['configPath']}`));
  } else {
    lines.push(trivialLine(`Init result: ${JSON.stringify(data)}`));
  }
}

export function renderMcpConfig(lines: ViewLine[], data: Record<string, unknown>): void {
  if (data['created']) {
    lines.push(trivialLine(`Created MCP config: ${data['targetPath']}`));
  } else {
    lines.push(trivialLine(`MCP config: ${JSON.stringify(data)}`));
  }
}

export function renderIndex(lines: ViewLine[], data: Record<string, unknown>): void {
  lines.push(trivialLine(`Indexed revision: ${data['revision'] ?? 'unknown'}`));
  if (data['sourceModified'] !== undefined) {
    lines.push(trivialLine(`Source modified: ${data['sourceModified']}`));
  }
}

export function renderOverview(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  const langs = data['mainLanguages'] as string[] | undefined;
  if (langs) lines.push(trivialLine(`Languages: ${langs.join(', ')}`));

  const structure = data['structure'] as { directories?: number; totalFiles?: number } | undefined;
  if (structure) {
    lines.push(trivialLine(`Files: ${structure.totalFiles ?? 0}, Directories: ${structure.directories ?? 0}`));
  }

  const subsystems = data['candidateSubsystems'] as Array<{ id: string; name: string }> | undefined;
  if (subsystems && subsystems.length > 0) {
    lines.push(trivialLine(`Candidate subsystems: ${subsystems.length}`));
    for (const s of subsystems) {
      lines.push(hypothesisLine(`  ${s.name} (${s.id})`));
    }
  }

  const entrypoints = data['candidateEntrypoints'] as string[] | undefined;
  if (entrypoints && entrypoints.length > 0) {
    lines.push(trivialLine(`Candidate entrypoints: ${entrypoints.length}`));
  }

  const claims = data['topClaims'] as Array<{ claimId: string; statement: string }> | undefined;
  if (claims && claims.length > 0) {
    lines.push(trivialLine(`Top claims: ${claims.length}`));
    if (verbose) {
      for (const c of claims) {
        lines.push(claimLine(`  ${c.statement}`, c.claimId));
      }
    }
  }

  appendPartialityNotice(lines, envelope);
}

export function renderEntrypoints(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  const candidates = data['candidates'] as Array<{
    nodeId: string;
    displayName: string;
    score: number;
    evidence: Array<{ evidenceId: string }>;
  }> | undefined;

  if (!candidates || candidates.length === 0) {
    lines.push(trivialLine('No entrypoints found.'));
    return;
  }

  lines.push(trivialLine(`Found ${candidates.length} entrypoint(s):`));
  for (const c of candidates) {
    const evId = c.evidence?.[0]?.evidenceId;
    if (evId) {
      lines.push(evidenceLine(`  ${c.displayName} (score: ${c.score})`, evId));
    } else {
      lines.push(hypothesisLine(`  ${c.displayName} (score: ${c.score})`));
    }
  }
  appendPartialityNotice(lines, envelope);
}

export function renderTrace(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  const segments = data['segments'] as Array<{
    fromNodeId: string;
    toNodeId: string;
    edgeKind: string;
    epistemic: string;
    confidence: string;
    evidence: Array<{ evidenceId: string }>;
    unknown?: boolean;
    ambiguity?: string;
  }> | undefined;

  if (!segments || segments.length === 0) {
    lines.push(trivialLine('No trace segments found.'));
    return;
  }

  for (const seg of segments) {
    const evId = seg.evidence?.[0]?.evidenceId;
    const tag = seg.unknown ? ' [UNDECIDABLE]' : '';
    const text = `${seg.fromNodeId} -[${seg.edgeKind}]-> ${seg.toNodeId} (${seg.epistemic}, ${seg.confidence})${tag}`;

    if (seg.unknown || seg.ambiguity) {
      lines.push(hypothesisLine(text));
    } else if (evId) {
      lines.push(evidenceLine(text, evId));
    } else {
      lines.push(hypothesisLine(text));
    }

    if (verbose && seg.ambiguity) {
      lines.push(hypothesisLine(`  Ambiguity: ${seg.ambiguity}`));
    }
  }
  appendPartialityNotice(lines, envelope);
}

export function renderBlast(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  const affected = data['affectedNodes'] as Array<{
    nodeId: string;
    distance: number;
    viaUncertainEdge: boolean;
  }> | undefined;

  const risky = data['riskyEdges'] as Array<{
    edgeId: string;
    fromNodeId: string;
    toNodeId: string;
  }> | undefined;

  lines.push(trivialLine(`Affected nodes: ${affected?.length ?? 0}`));
  if (risky && risky.length > 0) {
    lines.push(trivialLine(`Risky edges: ${risky.length}`));
  }

  if (affected) {
    for (const n of affected) {
      const marker = n.viaUncertainEdge ? ' [uncertain]' : '';
      if (n.viaUncertainEdge) {
        lines.push(hypothesisLine(`  ${n.nodeId} (distance: ${n.distance})${marker}`));
      } else {
        lines.push(trivialLine(`  ${n.nodeId} (distance: ${n.distance})`));
      }
    }
  }

  if (verbose && risky) {
    for (const e of risky) {
      lines.push(hypothesisLine(`  risky: ${e.fromNodeId} -> ${e.toNodeId}`));
    }
  }
  appendPartialityNotice(lines, envelope);
}

export function renderSubsystem(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  lines.push(trivialLine(`Subsystem: ${data['subsystemId'] ?? 'unknown'}`));

  const files = data['ownedFiles'] as string[] | undefined;
  if (files) lines.push(trivialLine(`Owned files: ${files.length}`));

  const deps = data['dependencies'] as { inbound?: string[]; outbound?: string[] } | undefined;
  if (deps) {
    lines.push(trivialLine(`Inbound deps: ${deps.inbound?.length ?? 0}`));
    lines.push(trivialLine(`Outbound deps: ${deps.outbound?.length ?? 0}`));
  }

  const hypotheses = data['purposeHypotheses'] as string[] | undefined;
  if (hypotheses) {
    for (const h of hypotheses) {
      lines.push(hypothesisLine(`Purpose: ${h}`));
    }
  }

  const claims = data['relatedClaims'] as Array<{ claimId: string; statement: string }> | undefined;
  if (verbose && claims) {
    for (const c of claims) {
      lines.push(claimLine(`  ${c.statement}`, c.claimId));
    }
  }
  appendPartialityNotice(lines, envelope);
}

export function renderResolve(lines: ViewLine[], data: Record<string, unknown>): void {
  const status = data['status'] as string;
  if (status === 'resolved') {
    lines.push(trivialLine(`Resolved: ${data['id']} (${data['kind']}) "${data['displayName']}"`));
  } else if (status === 'ambiguous') {
    const candidates = data['candidates'] as Array<{ id: string; displayName: string }>;
    lines.push(trivialLine(`Ambiguous: ${candidates.length} candidates`));
    for (const c of candidates) {
      lines.push(trivialLine(`  ${c.id}: ${c.displayName}`));
    }
  } else {
    lines.push(trivialLine(`Not found: ${data['input'] ?? 'unknown'}`));
  }
}

export function renderClaims(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  const claims = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  if (claims.length === 0) {
    lines.push(trivialLine('No claims found.'));
    return;
  }

  lines.push(trivialLine(`Claims: ${claims.length}`));
  for (const c of claims) {
    const id = c['id'] as string;
    const text = `[${c['status']}/${c['confidence']}] ${c['statement']}`;
    lines.push(claimLine(text, id));
  }
  appendPartialityNotice(lines, envelope);
}

export function renderUncertainties(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  const items = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  if (items.length === 0) {
    lines.push(trivialLine('No uncertainties found.'));
    return;
  }

  lines.push(trivialLine(`Uncertainties: ${items.length}`));
  for (const u of items) {
    lines.push(hypothesisLine(`[${u['severity']}] ${u['description']}`));
  }
  appendPartialityNotice(lines, envelope);
}

export function renderVerify(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  lines.push(trivialLine(`Claim: ${data['claimId'] ?? envelope.query.args['claimId'] ?? 'unknown'}`));
  if (data['priorStatus'] !== undefined) {
    lines.push(trivialLine(`Prior status: ${data['priorStatus']}`));
  }
  if (data['newStatus'] !== undefined) {
    lines.push(trivialLine(`New status: ${data['newStatus']}`));
  }
  if (data['priorConfidence'] !== undefined) {
    lines.push(trivialLine(`Prior confidence: ${data['priorConfidence']}`));
  }
  if (data['newConfidence'] !== undefined) {
    lines.push(trivialLine(`New confidence: ${data['newConfidence']}`));
  }
  appendPartialityNotice(lines, envelope);
}

export function renderHistory(lines: ViewLine[], data: Record<string, unknown>): void {
  lines.push(trivialLine(`Claim: ${data['claimId'] ?? 'unknown'}`));

  const history = data['verificationHistory'] as Array<Record<string, unknown>> | undefined;
  if (history && history.length > 0) {
    lines.push(trivialLine(`Verification history: ${history.length}`));
    for (const h of history) {
      lines.push(trivialLine(`  ${h['ranAt']}: ${h['priorStatus']} -> ${h['newStatus']}`));
    }
  } else {
    lines.push(trivialLine('No verification history.'));
  }

  const annotations = data['annotations'] as Array<Record<string, unknown>> | undefined;
  if (annotations && annotations.length > 0) {
    lines.push(trivialLine(`Annotations: ${annotations.length}`));
    for (const a of annotations) {
      lines.push(trivialLine(`  ${a['createdAt']}: ${a['actor'] ?? 'unknown actor'}`));
    }
  }

  const successors = data['successorChain'] as Array<Record<string, unknown>> | undefined;
  if (successors && successors.length > 0) {
    lines.push(trivialLine(`Successor chain: ${successors.length}`));
    for (const s of successors) {
      lines.push(trivialLine(`  ${s['id']}: ${s['status']} (${s['confidenceBand']})`));
    }
  }
}

export function renderCompare(lines: ViewLine[], data: Record<string, unknown>): void {
  lines.push(trivialLine(`Comparing ${data['revA']} .. ${data['revB']}`));
  const files = data['changedFiles'] as string[] | undefined;
  const symbols = data['changedSymbols'] as string[] | undefined;
  const claims = data['changedClaims'] as string[] | undefined;
  lines.push(trivialLine(`Changed files: ${files?.length ?? 0}`));
  lines.push(trivialLine(`Changed symbols: ${symbols?.length ?? 0}`));
  lines.push(trivialLine(`Changed claims: ${claims?.length ?? 0}`));
}

export function renderInvariants(
  lines: ViewLine[],
  data: Record<string, unknown>,
  envelope: ResultEnvelope<unknown>,
  verbose?: boolean,
): void {
  const violations = data['violations'] as Array<{
    ruleId: string;
    description: string;
    evidence: Array<{ evidenceId: string }>;
  }> | undefined;

  if (!violations || violations.length === 0) {
    lines.push(trivialLine('No invariant violations found.'));
    return;
  }

  lines.push(trivialLine(`Violations: ${violations.length}`));
  for (const v of violations) {
    const evId = v.evidence?.[0]?.evidenceId;
    if (evId) {
      lines.push(evidenceLine(`  ${v.description}`, evId));
    } else {
      lines.push(hypothesisLine(`  ${v.description}`));
    }
  }
  appendPartialityNotice(lines, envelope);
}

export function renderFeedback(lines: ViewLine[], data: Record<string, unknown>): void {
  if (data['error']) {
    lines.push(trivialLine(`Error: ${data['error']}`));
    return;
  }
  lines.push(trivialLine(`Claim: ${data['claimId']}`));
  lines.push(trivialLine(`${data['priorStatus']} -> ${data['newStatus']}`));
  if (data['successorId']) {
    lines.push(trivialLine(`Successor: ${data['successorId']}`));
  }
}

export function renderGeneric(lines: ViewLine[], data: Record<string, unknown>): void {
  lines.push(trivialLine(JSON.stringify(data, null, 2)));
}
