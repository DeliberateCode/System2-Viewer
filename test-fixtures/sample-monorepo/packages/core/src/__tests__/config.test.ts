import { describe, it, expect } from 'vitest';
import { loadCoreConfig, DEFAULT_CONFIG, isValidConfig } from '../config.js';

describe('config', () => {
  it('should return defaults when no overrides', () => {
    const config = loadCoreConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should merge overrides', () => {
    const config = loadCoreConfig({ debug: true, maxRetries: 5 });
    expect(config.debug).toBe(true);
    expect(config.maxRetries).toBe(5);
    expect(config.appName).toBe(DEFAULT_CONFIG.appName);
  });

  it('should validate config', () => {
    expect(isValidConfig({ maxRetries: -1 })).toBe(false);
    expect(isValidConfig({ maxRetries: 3 })).toBe(true);
    expect(isValidConfig({ timeoutMs: -100 })).toBe(false);
  });
});
