/**
 * Core configuration management.
 */

export interface CoreConfig {
  appName: string;
  version: string;
  debug: boolean;
  maxRetries: number;
  timeoutMs: number;
  logLevel: string;
}

export const DEFAULT_CONFIG: CoreConfig = {
  appName: 'sample-app',
  version: '1.0.0',
  debug: false,
  maxRetries: 3,
  timeoutMs: 5000,
  logLevel: 'info',
};

export function loadCoreConfig(overrides?: Partial<CoreConfig>): CoreConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

export function isValidConfig(config: Partial<CoreConfig>): boolean {
  if (config.maxRetries !== undefined && config.maxRetries < 0) {
    return false;
  }
  if (config.timeoutMs !== undefined && config.timeoutMs < 0) {
    return false;
  }
  return true;
}
