import { spawnSync } from 'node:child_process';
import type { CoChangeEntry, GitCommitInfo } from './types.js';

/**
 * Mine git history for co-change edges and commit evidence.
 *
 * Uses `spawnSync` with explicit args array -- NEVER shell-interpolates
 * user input. Read-only: runs `git log` only.
 *
 * @param repoRoot - Absolute path to the repository root
 * @param depth - Maximum number of commits to analyze (bounded)
 * @returns Object with commits and co-change entries
 */
export function mineGitHistory(
  repoRoot: string,
  depth: number,
): { commits: GitCommitInfo[]; coChanges: CoChangeEntry[] } {
  const commits: GitCommitInfo[] = [];
  const coChanges: CoChangeEntry[] = [];

  // Validate depth is non-negative
  const boundedDepth = Math.max(0, Math.min(depth, 10000));
  if (boundedDepth === 0) {
    return { commits, coChanges };
  }

  // Check if git is available and this is a git repo
  const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (gitCheck.status !== 0) {
    return { commits, coChanges };
  }

  // Get commit history with changed files
  // Format: hash\tdate\n\nfile1\nfile2\n...
  const result = spawnSync(
    'git',
    [
      'log',
      '--pretty=format:%H\t%aI',
      '--name-only',
      `-n${boundedDepth}`,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    },
  );

  if (result.status !== 0 || !result.stdout) {
    return { commits, coChanges };
  }

  // Parse git log output
  const blocks = result.stdout.split('\n\n');
  const coChangeMap = new Map<string, CoChangeEntry>();

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0 || !lines[0]) continue;

    const headerLine = lines[0]!;
    const tabIndex = headerLine.indexOf('\t');
    if (tabIndex === -1) continue;

    const hash = headerLine.slice(0, tabIndex);
    const date = headerLine.slice(tabIndex + 1);

    if (!hash || !date) continue;

    const filesChanged: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const file = lines[i]!.trim();
      if (file) filesChanged.push(file);
    }

    if (filesChanged.length === 0) continue;

    commits.push({ hash, date, filesChanged });

    // Generate co-change pairs
    // For commits with too many files, skip co-change generation to avoid quadratic blowup
    if (filesChanged.length <= 50) {
      for (let i = 0; i < filesChanged.length; i++) {
        for (let j = i + 1; j < filesChanged.length; j++) {
          const fileA = filesChanged[i]!;
          const fileB = filesChanged[j]!;
          // Canonical key: sorted pair
          const key = fileA < fileB ? `${fileA}||${fileB}` : `${fileB}||${fileA}`;
          const existing = coChangeMap.get(key);
          if (existing) {
            existing.coChangeCount++;
          } else {
            coChangeMap.set(key, {
              fileA: fileA < fileB ? fileA : fileB,
              fileB: fileA < fileB ? fileB : fileA,
              commitHash: hash,
              commitDate: date,
              coChangeCount: 1,
            });
          }
        }
      }
    }
  }

  for (const entry of coChangeMap.values()) {
    coChanges.push(entry);
  }

  return { commits, coChanges };
}
