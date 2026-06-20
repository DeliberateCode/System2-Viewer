import type { ReadView } from '../handles.js';
import type { ResultEnvelope, EvidenceRef, UncertaintyItem } from '../types.js';
import { buildEnvelope } from '../envelope.js';
import { assertStructured } from '../envelope.js';

export interface ImportGraphNode {
  id: string;
  displayName: string;
  fanIn: number;
  fanOut: number;
}

export interface ImportGraphMetrics {
  totalNodes: number;
  totalEdges: number;
  cycleCount?: number;
  maxFanIn: number;
  maxFanOut: number;
  avgFanOut: number;
}

export interface ImportGraphResult {
  adjacencyList: Record<string, string[]>;
  nodes: ImportGraphNode[];
  cycles?: string[][];
  cyclesLimitReached?: boolean;
  metrics: ImportGraphMetrics;
}

interface AdjEntry {
  outgoing: Set<string>;
  incoming: Set<string>;
}

export interface ImportGraphParams {
  scope: string;
  detectCycles?: boolean;
  transitiveDeps?: boolean;
  maxCycles?: number;
}

function displayName(nodeId: string): string {
  const i = nodeId.lastIndexOf('::');
  return i >= 0 ? nodeId.slice(i + 2) : nodeId;
}

function buildAdjacencyList(
  edges: Array<{ fromNodeId: string; toNodeId: string }>,
): Map<string, AdjEntry> {
  const adj = new Map<string, AdjEntry>();
  const ensure = (id: string): AdjEntry => {
    let e = adj.get(id);
    if (!e) {
      e = { outgoing: new Set(), incoming: new Set() };
      adj.set(id, e);
    }
    return e;
  };
  for (const edge of edges) {
    ensure(edge.fromNodeId).outgoing.add(edge.toNodeId);
    ensure(edge.toNodeId).incoming.add(edge.fromNodeId);
  }
  return adj;
}

function tarjanSCC(adj: Map<string, AdjEntry>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const callStack: Array<{ node: string; neighbors: string[]; ni: number }> = [];

  for (const node of adj.keys()) {
    if (indices.has(node)) continue;

    callStack.push({ node, neighbors: [...(adj.get(node)?.outgoing ?? [])], ni: 0 });
    indices.set(node, index);
    lowlink.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      if (frame.ni < frame.neighbors.length) {
        const w = frame.neighbors[frame.ni++];
        if (!indices.has(w)) {
          indices.set(w, index);
          lowlink.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          callStack.push({ node: w, neighbors: [...(adj.get(w)?.outgoing ?? [])], ni: 0 });
        } else if (onStack.has(w)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, lowlink.get(w)!));
        }
      } else {
        if (lowlink.get(frame.node) === indices.get(frame.node)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== frame.node);
          sccs.push(scc);
        }
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1];
          lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!));
        }
      }
    }
  }
  return sccs;
}

function extractCyclePath(scc: string[], adj: Map<string, AdjEntry>): string[] {
  if (scc.length === 0) return [];
  const sccSet = new Set(scc);
  const start = scc[0];

  const path: string[] = [start];
  const onPath = new Set<string>([start]);
  const iterStack: Array<{ neighbors: string[]; ni: number }> = [];

  const startNeighbors = [...(adj.get(start)?.outgoing ?? [])];
  iterStack.push({ neighbors: startNeighbors, ni: 0 });

  while (iterStack.length > 0) {
    const frame = iterStack[iterStack.length - 1];
    if (frame.ni >= frame.neighbors.length) {
      iterStack.pop();
      if (path.length > 1) {
        onPath.delete(path[path.length - 1]);
        path.pop();
      }
      continue;
    }
    const n = frame.neighbors[frame.ni++];
    if (n === start && path.length > 1) {
      return [...path, start];
    }
    if (sccSet.has(n) && !onPath.has(n)) {
      path.push(n);
      onPath.add(n);
      iterStack.push({ neighbors: [...(adj.get(n)?.outgoing ?? [])], ni: 0 });
    }
  }

  return scc;
}

function detectCycles(
  adj: Map<string, AdjEntry>,
  maxCycles: number,
): { cycles: string[][]; cyclesLimitReached: boolean } {
  const sccs = tarjanSCC(adj);
  const cycles: string[][] = [];
  let limitReached = false;

  for (const scc of sccs) {
    if (scc.length < 2) {
      const node = scc[0];
      const hasSelfLoop = adj.get(node)?.outgoing.has(node) ?? false;
      if (!hasSelfLoop) continue;
    }
    if (cycles.length >= maxCycles) {
      limitReached = true;
      break;
    }
    cycles.push(scc.length < 2 ? [scc[0], scc[0]] : extractCyclePath(scc, adj));
  }
  return { cycles, cyclesLimitReached: limitReached };
}

function transitiveClosureMulti(seeds: Set<string>, adj: Map<string, AdjEntry>): Set<string> {
  const visited = new Set<string>(seeds);
  const queue = [...seeds];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const neighbor of adj.get(current)?.outgoing ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

export function getImportGraph(
  handle: ReadView,
  params: ImportGraphParams,
): ResultEnvelope<ImportGraphResult> {
  const { scope, detectCycles: doCycles = false, transitiveDeps = false, maxCycles = 100 } = params;

  let edges: Array<{ fromNodeId: string; toNodeId: string; kind: string }> = [];
  const evidence: EvidenceRef[] = [];
  const uncertainties: UncertaintyItem[] = [];

  if (!scope || scope === '*') {
    edges = handle.allEdges?.('imports') ?? [];
  } else {
    const node = handle.getNode(scope);
    if (node) {
      const allImports = handle.allEdges?.('imports') ?? [];
      edges = allImports.filter((e) => e.fromNodeId === scope || e.toNodeId === scope);
    } else {
      const allImports = handle.allEdges?.('imports') ?? [];
      const scopeSegment = `::${scope}`;
      edges = allImports.filter(
        (e) => e.fromNodeId.includes(scopeSegment) || e.toNodeId.includes(scopeSegment),
      );
    }
  }

  if (edges.length === 0) {
    uncertainties.push({
      id: `import-graph-empty-scope-${scope}`,
      kind: 'empty-scope',
      severity: 'low',
      description: `Import graph scope "${scope}" matched zero edges`,
      relatedClaimIds: [],
      relatedNodeIds: [],
      recommendedAction: 'Verify the scope matches indexed file paths or subsystem names',
    });
  }

  let adj = buildAdjacencyList(edges);

  if (transitiveDeps && scope && scope !== '*') {
    const allEdges = handle.allEdges?.('imports') ?? [];
    const fullAdj = buildAdjacencyList(allEdges);
    // Collect seed nodes: when scope is a substring match (not an exact node),
    // use all nodes from the initial edge set as seeds for transitive closure.
    const seedNodes = new Set<string>();
    if (fullAdj.has(scope)) {
      seedNodes.add(scope);
    } else {
      for (const e of edges) {
        seedNodes.add(e.fromNodeId);
        seedNodes.add(e.toNodeId);
      }
    }
    const reachable = transitiveClosureMulti(seedNodes, fullAdj);
    const filteredEdges = allEdges.filter(
      (e) => reachable.has(e.fromNodeId) && reachable.has(e.toNodeId),
    );
    adj = buildAdjacencyList(filteredEdges);
  }

  let cycles: string[][] | undefined;
  let cyclesLimitReached: boolean | undefined;
  if (doCycles) {
    const result = detectCycles(adj, maxCycles);
    cycles = result.cycles;
    cyclesLimitReached = result.cyclesLimitReached;
  }

  const adjacencyList: Record<string, string[]> = {};
  const nodes: ImportGraphNode[] = [];
  let maxFanIn = 0;
  let maxFanOut = 0;
  let totalFanOut = 0;

  for (const [id, entry] of adj) {
    adjacencyList[id] = [...entry.outgoing];
    const fanIn = entry.incoming.size;
    const fanOut = entry.outgoing.size;
    nodes.push({ id, displayName: displayName(id), fanIn, fanOut });
    if (fanIn > maxFanIn) maxFanIn = fanIn;
    if (fanOut > maxFanOut) maxFanOut = fanOut;
    totalFanOut += fanOut;
  }

  nodes.sort((a, b) => b.fanIn - a.fanIn);

  const metrics: ImportGraphMetrics = {
    totalNodes: nodes.length,
    totalEdges: totalFanOut,
    maxFanIn,
    maxFanOut,
    avgFanOut: nodes.length > 0 ? Math.round((totalFanOut / nodes.length) * 100) / 100 : 0,
    ...(doCycles ? { cycleCount: cycles?.length ?? 0 } : {}),
  };

  const data: ImportGraphResult = {
    adjacencyList,
    nodes,
    metrics,
    ...(cycles !== undefined ? { cycles } : {}),
    ...(cyclesLimitReached !== undefined ? { cyclesLimitReached } : {}),
  };

  const suggestedNextCalls: Array<{ op: string; args: Record<string, unknown>; reason: string }> = [];
  if (nodes.length > 0 && !doCycles) {
    suggestedNextCalls.push({
      op: 'viewer.getImportGraph',
      args: { scope, detectCycles: true },
      reason: 'Detect import cycles in this scope',
    });
  }
  if (nodes.length > 0) {
    const topNode = nodes[0];
    suggestedNextCalls.push({
      op: 'viewer.traceFlow',
      args: { start: topNode.id },
      reason: `Trace flow from most-imported node: ${topNode.displayName}`,
    });
  }

  const envelope = buildEnvelope<ImportGraphResult>({
    op: 'getImportGraph',
    args: { ...params } as Record<string, unknown>,
    data,
    modelRevision: 'latest',
    evidence,
    uncertainties,
    suggestedNextCalls,
  });
  assertStructured<ImportGraphResult>(envelope);
  return envelope;
}
