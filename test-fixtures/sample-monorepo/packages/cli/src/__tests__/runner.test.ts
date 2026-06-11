import { describe, it, expect } from 'vitest';
import { runCli } from '../runner.js';

describe('runCli', () => {
  it('should return exit code 0 for help', () => {
    const result = runCli(['help']);
    expect(result.exitCode).toBe(0);
  });

  it('should return exit code 0 for version', () => {
    const result = runCli(['version']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('1.0.0');
  });

  it('should return exit code 2 for unknown command', () => {
    const result = runCli(['nonexistent']);
    expect(result.exitCode).toBe(2);
  });

  it('should return exit code 2 for no command', () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(2);
  });
});
