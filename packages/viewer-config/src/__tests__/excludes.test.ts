/**
 * Tests for viewer-config exclude pattern merging.
 *
 */
import { describe, it, expect } from 'vitest';
import {
  buildExcludeSet,
  DEFAULT_SECRET_PATTERNS,
} from '../excludes.js';
import type { ViewerConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkConfig(overrides: Partial<ViewerConfig> = {}): ViewerConfig {
  return {
    version: 1,
    repository: {},
    indexing: { gitHistoryDepth: 500, symbolBackend: 'treesitter' },
    remote: { enabled: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildExcludeSet
// ---------------------------------------------------------------------------

describe('buildExcludeSet', () => {
  it('merges gitignore + config + secret patterns', () => {
    const config = mkConfig({
      repository: { exclude: ['vendor/**'] },
    });
    const gitignorePatterns = ['node_modules', 'dist'];

    const matcher = buildExcludeSet(config, gitignorePatterns);

    // Gitignore patterns match
    expect(matcher.isExcluded('node_modules')).toBe(true);
    expect(matcher.isExcluded('some/path/node_modules')).toBe(true);
    expect(matcher.isExcluded('dist')).toBe(true);

    // Config exclude patterns match
    expect(matcher.isExcluded('vendor/lib/foo.js')).toBe(true);

    // Secret patterns match (non-negotiable)
    expect(matcher.isExcluded('.env')).toBe(true);
    expect(matcher.isExcluded('.env.local')).toBe(true);

    // Non-excluded file is not excluded
    expect(matcher.isExcluded('src/index.ts')).toBe(false);
  });

  it('makes secret patterns non-negotiable: gitignore negation cannot re-include .env', () => {
    const config = mkConfig();
    // Gitignore negation pattern trying to un-exclude .env
    const gitignorePatterns = ['.env', '!.env'];

    const matcher = buildExcludeSet(config, gitignorePatterns);

    // .env should still be excluded due to non-negotiable secret patterns
    expect(matcher.isExcluded('.env')).toBe(true);
  });

  it('makes secret patterns non-negotiable for nested paths', () => {
    const config = mkConfig();
    const gitignorePatterns = ['!config/.env.production'];

    const matcher = buildExcludeSet(config, gitignorePatterns);

    // Should still be excluded
    expect(matcher.isExcluded('config/.env.production')).toBe(true);
  });

  it('config excludes are additive', () => {
    const config = mkConfig({
      repository: { exclude: ['build/**', '*.log'] },
    });
    const gitignorePatterns: string[] = [];

    const matcher = buildExcludeSet(config, gitignorePatterns);

    expect(matcher.isExcluded('build/output.js')).toBe(true);
    expect(matcher.isExcluded('error.log')).toBe(true);
    expect(matcher.isExcluded('src/main.ts')).toBe(false);
  });

  it('excludes key/pem/pfx files via secret patterns', () => {
    const config = mkConfig();
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('server.key')).toBe(true);
    expect(matcher.isExcluded('cert.pem')).toBe(true);
    expect(matcher.isExcluded('store.pfx')).toBe(true);
    expect(matcher.isExcluded('store.p12')).toBe(true);
  });

  it('excludes SSH key files via secret patterns', () => {
    const config = mkConfig();
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('id_rsa')).toBe(true);
    expect(matcher.isExcluded('id_ed25519')).toBe(true);
    expect(matcher.isExcluded('id_rsa.pub')).toBe(true);
  });

  it('excludes credentials files via secret patterns', () => {
    const config = mkConfig();
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('credentials.json')).toBe(true);
    expect(matcher.isExcluded('.npmrc')).toBe(true);
  });

  it('does not exclude normal source files', () => {
    const config = mkConfig();
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('src/index.ts')).toBe(false);
    expect(matcher.isExcluded('package.json')).toBe(false);
    expect(matcher.isExcluded('README.md')).toBe(false);
    expect(matcher.isExcluded('tsconfig.json')).toBe(false);
  });

  it('handles empty gitignore and config excludes', () => {
    const config = mkConfig();
    const matcher = buildExcludeSet(config, []);

    // Only secret patterns active
    expect(matcher.isExcluded('.env')).toBe(true);
    expect(matcher.isExcluded('src/app.ts')).toBe(false);
  });

  it('DEFAULT_SECRET_PATTERNS includes expected entries', () => {
    expect(DEFAULT_SECRET_PATTERNS).toContain('.env');
    expect(DEFAULT_SECRET_PATTERNS).toContain('.env.*');
    expect(DEFAULT_SECRET_PATTERNS).toContain('*.key');
    expect(DEFAULT_SECRET_PATTERNS).toContain('*.pem');
    expect(DEFAULT_SECRET_PATTERNS).toContain('credentials.*');
    expect(DEFAULT_SECRET_PATTERNS).toContain('.npmrc');
    expect(DEFAULT_SECRET_PATTERNS).toContain('id_rsa');
    expect(DEFAULT_SECRET_PATTERNS).toContain('id_ed25519');
  });
});

// ---------------------------------------------------------------------------
// picomatch behavioral equivalence + brace expansion tests
// ---------------------------------------------------------------------------

describe('picomatch behavioral equivalence', () => {
  it('basic glob *.ts matches foo.ts', () => {
    const config = mkConfig({
      repository: { exclude: ['*.ts'] },
    });
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('foo.ts')).toBe(true);
    expect(matcher.isExcluded('bar.ts')).toBe(true);
    expect(matcher.isExcluded('foo.js')).toBe(false);
  });

  it('recursive glob **/*.ts matches src/foo.ts and nested paths', () => {
    const config = mkConfig({
      repository: { exclude: ['**/*.ts'] },
    });
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('src/foo.ts')).toBe(true);
    expect(matcher.isExcluded('packages/viewer-core/src/index.ts')).toBe(true);
    expect(matcher.isExcluded('foo.ts')).toBe(true);
    expect(matcher.isExcluded('src/foo.js')).toBe(false);
  });

  it('brace expansion {*.ts,*.js} matches both extensions', () => {
    const config = mkConfig({
      repository: { exclude: ['{*.ts,*.js}'] },
    });
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('foo.ts')).toBe(true);
    expect(matcher.isExcluded('bar.js')).toBe(true);
    expect(matcher.isExcluded('baz.json')).toBe(false);
    expect(matcher.isExcluded('qux.css')).toBe(false);
  });

  it('brace expansion **/*.{ts,js} matches nested files of both extensions', () => {
    const config = mkConfig({
      repository: { exclude: ['**/*.{ts,js}'] },
    });
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('src/index.ts')).toBe(true);
    expect(matcher.isExcluded('lib/utils.js')).toBe(true);
    expect(matcher.isExcluded('src/styles.css')).toBe(false);
  });

  it('brace expansion src/{api,db}/**/*.ts matches specific subdirectories', () => {
    const config = mkConfig({
      repository: { exclude: ['src/{api,db}/**/*.ts'] },
    });
    const matcher = buildExcludeSet(config, []);

    expect(matcher.isExcluded('src/api/handler.ts')).toBe(true);
    expect(matcher.isExcluded('src/db/connection.ts')).toBe(true);
    expect(matcher.isExcluded('src/api/nested/deep.ts')).toBe(true);
    expect(matcher.isExcluded('src/cli/index.ts')).toBe(false);
    expect(matcher.isExcluded('src/api/handler.js')).toBe(false);
  });

  it('secret patterns remain non-negotiable after picomatch migration', () => {
    // secret patterns are always non-negotiable
    const config = mkConfig();
    const matcher = buildExcludeSet(config, []);

    // Every secret pattern must still match
    expect(matcher.isExcluded('.env')).toBe(true);
    expect(matcher.isExcluded('.env.local')).toBe(true);
    expect(matcher.isExcluded('.env.production')).toBe(true);
    expect(matcher.isExcluded('server.key')).toBe(true);
    expect(matcher.isExcluded('cert.pem')).toBe(true);
    expect(matcher.isExcluded('store.p12')).toBe(true);
    expect(matcher.isExcluded('store.pfx')).toBe(true);
    expect(matcher.isExcluded('id_rsa')).toBe(true);
    expect(matcher.isExcluded('id_ed25519')).toBe(true);
    expect(matcher.isExcluded('credentials.json')).toBe(true);
    expect(matcher.isExcluded('.npmrc')).toBe(true);
    expect(matcher.isExcluded('app.secrets')).toBe(true);
  });

  it('gitignore negation still cannot override secret patterns after picomatch migration', () => {
    // .gitignore negation shall not re-include secret files
    const config = mkConfig();
    const gitignorePatterns = ['!.env', '!*.key', '!id_rsa', '!credentials.json'];
    const matcher = buildExcludeSet(config, gitignorePatterns);

    expect(matcher.isExcluded('.env')).toBe(true);
    expect(matcher.isExcluded('server.key')).toBe(true);
    expect(matcher.isExcluded('id_rsa')).toBe(true);
    expect(matcher.isExcluded('credentials.json')).toBe(true);
  });
});
