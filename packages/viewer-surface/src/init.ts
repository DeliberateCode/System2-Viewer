/**
 * Init: writes a starter viewer.config.json with safe defaults.
 *
 * Without --force: if file exists, writes viewer.config.json.new sidecar.
 * With --force: overwrites existing file.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InitResult } from './types.js';

const GITIGNORE_ENTRY = 'viewer.config.json';

/** Safe defaults for a new viewer.config.json. */
const STARTER_CONFIG = {
  $schema: './node_modules/@system2-viewer/viewer-config/src/config-schema.json',
  version: 1,
  repository: {
    name: '',
    exclude: [],
  },
  indexing: {
    gitHistoryDepth: 500,
    symbolBackend: 'treesitter',
  },
  subsystems: [],
  rules: [],
  remote: {
    enabled: false,
  },
};

/**
 * Ensures viewer.config.json is listed in the repo's .gitignore.
 *
 * - If .gitignore does not exist, creates it with the entry.
 * - If .gitignore exists but lacks the entry, appends it.
 * - Returns the .gitignore path if it was modified, undefined otherwise.
 */
function ensureGitignore(repoRoot: string): string | undefined {
  const giPath = join(repoRoot, '.gitignore');
  if (existsSync(giPath)) {
    const content = readFileSync(giPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.some(line => line.trim() === GITIGNORE_ENTRY)) {
      return undefined; // already present
    }
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    writeFileSync(giPath, content + separator + GITIGNORE_ENTRY + '\n', 'utf-8');
    return giPath;
  }
  writeFileSync(giPath, GITIGNORE_ENTRY + '\n', 'utf-8');
  return giPath;
}

/**
 * Writes a starter viewer.config.json at the given repo root.
 *
 * @param repoRoot - Absolute path to the repository root
 * @param opts.force - If true, overwrite existing file; otherwise write .new sidecar
 * @param opts.noGitignore - If true, skip .gitignore modification
 * @returns InitResult with the path written and whether file was created or already existed
 */
export function runInit(
  repoRoot: string,
  opts?: { force?: boolean; noGitignore?: boolean },
): InitResult {
  const configPath = join(repoRoot, 'viewer.config.json');
  const existed = existsSync(configPath);
  const force = opts?.force ?? false;
  const noGitignore = opts?.noGitignore ?? false;

  const content = JSON.stringify(STARTER_CONFIG, null, 2) + '\n';

  let writtenPath: string;
  if (existed && !force) {
    writtenPath = configPath + '.new';
    writeFileSync(writtenPath, content, 'utf-8');
  } else {
    writtenPath = configPath;
    writeFileSync(writtenPath, content, 'utf-8');
  }

  const gitignorePath = noGitignore ? undefined : ensureGitignore(repoRoot);

  return {
    configPath: writtenPath,
    created: true,
    existed,
    gitignorePath,
  };
}
