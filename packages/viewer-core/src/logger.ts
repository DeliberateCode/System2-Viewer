/**
 * Lightweight centralized logger.
 *
 * The default export is NULL_LOGGER (no output) so the library stays
 * quiet unless the caller explicitly opts in via createLogger().
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  error(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  debug(msg: string, context?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function noop(): void {
  // intentionally empty
}

/** No-op logger -- the default. Produces zero output. */
export const NULL_LOGGER: Logger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
};

/**
 * Creates a logger that filters by level and writes to a sink function.
 *
 * @param opts.level  Minimum level to emit (default: 'info').
 * @param opts.sink   Where to write formatted lines (default: stderr).
 */
export function createLogger(opts?: {
  level?: LogLevel;
  sink?: (line: string) => void;
}): Logger {
  const threshold = LEVEL_ORDER[opts?.level ?? 'info'];
  const sink = opts?.sink ?? ((line: string) => process.stderr.write(line + '\n'));

  function emit(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] > threshold) return;
    const prefix = `[${level.toUpperCase()}]`;
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    sink(`${prefix} ${msg}${contextStr}`);
  }

  return {
    error: (msg, ctx) => emit('error', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    debug: (msg, ctx) => emit('debug', msg, ctx),
  };
}
