/**
 * Logging infrastructure.
 */

export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  getEntries(): LogEntry[];
}

export function createLogger(name: string): Logger {
  const entries: LogEntry[] = [];

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    entries.push({
      level,
      message: `[${name}] ${message}`,
      timestamp: new Date(),
      context,
    });
  }

  return {
    debug: (msg, ctx) => log(LogLevel.Debug, msg, ctx),
    info: (msg, ctx) => log(LogLevel.Info, msg, ctx),
    warn: (msg, ctx) => log(LogLevel.Warn, msg, ctx),
    error: (msg, ctx) => log(LogLevel.Error, msg, ctx),
    getEntries: () => [...entries],
  };
}
