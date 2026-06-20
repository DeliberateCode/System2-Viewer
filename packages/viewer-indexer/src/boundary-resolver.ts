import picomatch from 'picomatch';

/** Structural type — mirrors viewer-config's BoundaryDef by shape, not import. */
export interface BoundaryDef {
  name: string;
  paths: string[];
  publicInterface: string[];
  allowedDependencies?: string[];
}

export interface BoundaryMembership {
  boundaryName: string;
  isPublic: boolean;
}

export interface ResolvedBoundaryInfo {
  def: BoundaryDef;
  files: Set<string>;
  publicFiles: Set<string>;
}

export interface ResolvedBoundaries {
  fileToBoundary: Map<string, BoundaryMembership>;
  boundaries: Map<string, ResolvedBoundaryInfo>;
  warnings: string[];
}

const PICO_OPTS: picomatch.PicomatchOptions = { dot: true };

export function resolveBoundaryMembership(
  boundaries: BoundaryDef[],
  filePaths: string[],
): ResolvedBoundaries {
  const fileToBoundary = new Map<string, BoundaryMembership>();
  const boundaryMap = new Map<string, ResolvedBoundaryInfo>();
  const warnings: string[] = [];
  const seenNames = new Set<string>();

  const compiled: Array<{
    def: BoundaryDef;
    pathMatcher: picomatch.Matcher;
    publicMatcher: picomatch.Matcher;
  }> = [];

  for (const def of boundaries) {
    if (seenNames.has(def.name)) {
      warnings.push(`Duplicate boundary name "${def.name}" — skipping`);
      continue;
    }
    seenNames.add(def.name);

    try {
      const pathMatcher = picomatch(def.paths, PICO_OPTS);
      const publicMatcher = picomatch(def.publicInterface, PICO_OPTS);
      compiled.push({ def, pathMatcher, publicMatcher });
      boundaryMap.set(def.name, { def, files: new Set(), publicFiles: new Set() });
    } catch (e) {
      warnings.push(`Invalid glob in boundary "${def.name}" — skipping: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const filePath of filePaths) {
    for (const { def, pathMatcher, publicMatcher } of compiled) {
      if (pathMatcher(filePath)) {
        if (fileToBoundary.has(filePath)) {
          warnings.push(`File "${filePath}" matches multiple boundaries: "${fileToBoundary.get(filePath)!.boundaryName}" and "${def.name}" — using first match`);
          break;
        }
        const isPublic = publicMatcher(filePath);
        fileToBoundary.set(filePath, { boundaryName: def.name, isPublic });
        const info = boundaryMap.get(def.name)!;
        info.files.add(filePath);
        if (isPublic) info.publicFiles.add(filePath);
      }
    }
  }

  return { fileToBoundary, boundaries: boundaryMap, warnings };
}
