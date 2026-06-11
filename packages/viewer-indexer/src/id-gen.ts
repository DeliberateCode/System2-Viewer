/**
 * Centralized ID generation for indexer nodes, edges, evidence, and partiality.
 *
 * All ID patterns used by the indexing pipeline are defined here so that
 * format changes only need to happen in one place.
 */

export function fileNodeId(repositoryId: string, path: string): string {
  return `node::file::${repositoryId}::${path}`;
}

export function symbolNodeId(repositoryId: string, filePath: string, name: string): string {
  return `node::symbol::${repositoryId}::${filePath}::${name}`;
}

export function subsystemNodeId(repositoryId: string, name: string): string {
  return `node::subsystem::${repositoryId}::${name}`;
}

export function directoryNodeId(repositoryId: string, dirPath: string): string {
  return `node::directory::${repositoryId}::${dirPath}`;
}

export function packageNodeId(repositoryId: string, name: string): string {
  return `node::package::${repositoryId}::${name}`;
}

export function edgeId(kind: string, ...segments: string[]): string {
  return `edge::${kind}::${segments.join('::')}`;
}

export function gitEvidenceId(commitHash: string): string {
  return `ev::git::${commitHash}`;
}

export function partialityRowId(revision: string, scope: string): string {
  return `partiality::${revision}::${scope}`;
}
