/**
 * Logging middleware.
 */

import { createLogger } from '@sample/core';

const logger = createLogger('http');

export interface RequestInfo {
  method: string;
  path: string;
  timestamp: Date;
  duration?: number;
}

export function loggingMiddleware(info: RequestInfo): void {
  const durationStr = info.duration !== undefined ? ` (${info.duration}ms)` : '';
  logger.info(`${info.method} ${info.path}${durationStr}`);
}
