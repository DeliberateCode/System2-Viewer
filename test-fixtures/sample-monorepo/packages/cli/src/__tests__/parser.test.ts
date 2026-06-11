import { describe, it, expect } from 'vitest';
import { parseArgs, formatUsage } from '../parser.js';

describe('parseArgs', () => {
  it('should parse command name', () => {
    const result = parseArgs(['init']);
    expect(result.command).toBe('init');
    expect(result.positional).toHaveLength(0);
  });

  it('should parse flags', () => {
    const result = parseArgs(['init', '--name', 'myproject', '--force']);
    expect(result.command).toBe('init');
    expect(result.flags['name']).toBe('myproject');
    expect(result.flags['force']).toBe('true');
  });

  it('should parse positional arguments', () => {
    const result = parseArgs(['deploy', 'staging', 'us-east-1']);
    expect(result.command).toBe('deploy');
    expect(result.positional).toEqual(['staging', 'us-east-1']);
  });

  it('should handle empty args', () => {
    const result = parseArgs([]);
    expect(result.command).toBeUndefined();
  });
});

describe('formatUsage', () => {
  it('should format usage line', () => {
    const usage = formatUsage('init', 'Initialize a new project');
    expect(usage).toContain('init');
    expect(usage).toContain('Initialize');
  });
});
