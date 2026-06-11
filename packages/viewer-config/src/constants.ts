export const DEFAULT_GIT_HISTORY_DEPTH = 500;
export const DEFAULT_WORKSPACE_DEPTH = 8;
export const DEFAULT_WORKSPACE_MAX_REPOS = 256;
export const MAX_WORKSPACE_DEPTH = 64;
export const MAX_WORKSPACE_MAX_REPOS = 4096;
export const DEFAULT_SYMBOL_BACKEND = 'treesitter' as const;

// SQLite PRAGMA defaults
export const DEFAULT_SQLITE_PAGE_SIZE = 4096;
export const DEFAULT_SQLITE_CACHE_SIZE = -64000;    // negative = KB; 64 MB
export const DEFAULT_SQLITE_MMAP_SIZE = 268435456;  // 256 MB

// SQLite busy_timeout default
export const DEFAULT_SQLITE_BUSY_TIMEOUT = 5000;  // 5 seconds

// Worker pool defaults
export const DEFAULT_WORKER_MIN_FILES = 500;
