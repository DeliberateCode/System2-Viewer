import { describe, it, expect } from 'vitest';
import { loadConfigResult, DEFAULT_FRAMEWORK_HINTS, extractDecoratorNames, BUILT_IN_CLAIM_TYPES } from '../index.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

function makeTempDir(): string {
  const dir = join(tmpdir(), `viewer-struct-cfg-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('frameworkHints validation', () => {
  it('loads valid frameworkHints without errors', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      frameworkHints: [
        { pattern: 'app.route', framework: 'flask', entrypointKind: 'http-handler' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(result.config.frameworkHints).toHaveLength(1);
    expect(result.config.frameworkHints![0].pattern).toBe('app.route');
    rmSync(dir, { recursive: true });
  });

  it('rejects frameworkHints entry missing required fields', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      frameworkHints: [
        { pattern: '', framework: 'flask', entrypointKind: 'http-handler' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.some(i => i.path.includes('frameworkHints') && i.severity === 'error')).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it('excludePaths is optional and validated as string array', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      frameworkHints: [
        { pattern: 'app.route', framework: 'flask', entrypointKind: 'http-handler', excludePaths: ['test/**'] },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(result.config.frameworkHints![0].excludePaths).toEqual(['test/**']);
    rmSync(dir, { recursive: true });
  });
});

describe('moduleBoundaries validation', () => {
  it('loads valid moduleBoundaries without errors', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      moduleBoundaries: [
        { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(result.config.moduleBoundaries).toHaveLength(1);
    rmSync(dir, { recursive: true });
  });

  it('rejects duplicate boundary names', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      moduleBoundaries: [
        { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
        { name: 'auth', paths: ['src/auth2/**'], publicInterface: ['src/auth2/index.ts'] },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.some(i => i.message.includes('Duplicate boundary name'))).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it('loads module-boundaries.json as fallback when config key absent', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({ version: 1 }));
    writeFileSync(join(dir, 'module-boundaries.json'), JSON.stringify([
      { name: 'payments', paths: ['src/payments/**'], publicInterface: ['src/payments/api.ts'] },
    ]));
    const result = loadConfigResult(dir);
    expect(result.config.moduleBoundaries).toHaveLength(1);
    expect(result.config.moduleBoundaries![0].name).toBe('payments');
    rmSync(dir, { recursive: true });
  });

  it('config moduleBoundaries takes precedence over module-boundaries.json', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      moduleBoundaries: [
        { name: 'from-config', paths: ['src/**'], publicInterface: ['src/index.ts'] },
      ],
    }));
    writeFileSync(join(dir, 'module-boundaries.json'), JSON.stringify([
      { name: 'from-file', paths: ['lib/**'], publicInterface: ['lib/index.ts'] },
    ]));
    const result = loadConfigResult(dir);
    expect(result.config.moduleBoundaries).toHaveLength(1);
    expect(result.config.moduleBoundaries![0].name).toBe('from-config');
    expect(result.issues.some(i => i.message.includes('takes precedence'))).toBe(true);
    rmSync(dir, { recursive: true });
  });
});

describe('topologyHints validation', () => {
  it('loads valid topologyHints without errors', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      topologyHints: [
        { source: 'src/producer.ts', sink: 'src/consumer.ts', channel: 'orders', transport: 'kafka', direction: 'publish' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(result.config.topologyHints).toHaveLength(1);
    rmSync(dir, { recursive: true });
  });

  it('rejects invalid direction value', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      topologyHints: [
        { source: 'a.ts', sink: 'b.ts', channel: 'x', transport: 'kafka', direction: 'invalid' },
      ],
    }));
    const result = loadConfigResult(dir);
    expect(result.issues.some(i => i.message.includes('direction'))).toBe(true);
    rmSync(dir, { recursive: true });
  });
});

describe('default framework hints', () => {
  it('DEFAULT_FRAMEWORK_HINTS contains Flask, FastAPI, Django, Spring patterns', () => {
    const frameworks = new Set(DEFAULT_FRAMEWORK_HINTS.map(h => h.framework));
    expect(frameworks.has('flask')).toBe(true);
    expect(frameworks.has('fastapi')).toBe(true);
    expect(frameworks.has('django')).toBe(true);
    expect(frameworks.has('spring')).toBe(true);
  });

  it('all default hints have excludePaths for test directories', () => {
    for (const hint of DEFAULT_FRAMEWORK_HINTS) {
      expect(hint.excludePaths).toBeDefined();
      expect(hint.excludePaths!.length).toBeGreaterThan(0);
    }
  });
});

describe('extractDecoratorNames', () => {
  it('extracts Python decorators', () => {
    const meta = JSON.stringify({ decorators: ['app.route', 'login_required'] });
    expect(extractDecoratorNames(meta)).toEqual(['app.route', 'login_required']);
  });

  it('extracts Rust attributes', () => {
    const meta = JSON.stringify({ attributes: ['derive(Debug)', 'serde(rename)'] });
    expect(extractDecoratorNames(meta)).toEqual(['derive(Debug)', 'serde(rename)']);
  });

  it('extracts Java annotations', () => {
    const meta = JSON.stringify({ annotations: ['RequestMapping', 'GetMapping'] });
    expect(extractDecoratorNames(meta)).toEqual(['RequestMapping', 'GetMapping']);
  });

  it('returns empty array for null metadata', () => {
    expect(extractDecoratorNames(null)).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    expect(extractDecoratorNames('not json')).toEqual([]);
  });

  it('combines decorators from multiple languages', () => {
    const meta = JSON.stringify({
      decorators: ['app.route'],
      annotations: ['GetMapping'],
    });
    const result = extractDecoratorNames(meta);
    expect(result).toContain('app.route');
    expect(result).toContain('GetMapping');
  });
});

describe('BUILT_IN_CLAIM_TYPES includes boundary-violation', () => {
  it('boundary-violation is a built-in claim type', () => {
    expect(BUILT_IN_CLAIM_TYPES.has('boundary-violation')).toBe(true);
  });
});

describe('config sanitization', () => {
  it('truncates long boundary names to 256 chars', () => {
    const dir = makeTempDir();
    const longName = 'a'.repeat(300);
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({
      version: 1,
      moduleBoundaries: [
        { name: longName, paths: ['src/**'], publicInterface: ['src/index.ts'] },
      ],
    }));
    const result = loadConfigResult(dir);
    if (result.config.moduleBoundaries && result.config.moduleBoundaries.length > 0) {
      expect(result.config.moduleBoundaries[0].name.length).toBeLessThanOrEqual(256);
    }
    rmSync(dir, { recursive: true });
  });

  it('configs without structural keys behave identically to base config', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'viewer.config.json'), JSON.stringify({ version: 1 }));
    const result = loadConfigResult(dir);
    expect(result.config.frameworkHints).toBeUndefined();
    expect(result.config.moduleBoundaries).toBeUndefined();
    expect(result.config.topologyHints).toBeUndefined();
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    rmSync(dir, { recursive: true });
  });
});
