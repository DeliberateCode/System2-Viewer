// Config types and loading
export type { ViewerConfig, SqliteConfig, RuleDef, ClaimTypeDef, RecipeDef, ConfigResult, ConfigIssue } from './config.js';
export { loadConfig, loadConfigResult, BUILT_IN_CLAIM_TYPES } from './config.js';

// Exclude pattern merging
export type { ExcludeMatcher } from './excludes.js';
export { buildExcludeSet, DEFAULT_SECRET_PATTERNS } from './excludes.js';

// Constants
export {
  DEFAULT_GIT_HISTORY_DEPTH,
  DEFAULT_WORKSPACE_DEPTH,
  DEFAULT_WORKSPACE_MAX_REPOS,
  MAX_WORKSPACE_DEPTH,
  MAX_WORKSPACE_MAX_REPOS,
  DEFAULT_SQLITE_PAGE_SIZE,
  DEFAULT_SQLITE_CACHE_SIZE,
  DEFAULT_SQLITE_MMAP_SIZE,
  DEFAULT_SQLITE_BUSY_TIMEOUT,
  DEFAULT_WORKER_MIN_FILES,
} from './constants.js';
