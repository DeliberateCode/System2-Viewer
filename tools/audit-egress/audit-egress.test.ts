import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'audit-egress.ts');

describe('audit-egress', () => {
  it('exits 0 on current codebase with no network imports', () => {
    const result = execFileSync('npx', ['tsx', SCRIPT, '--root', ROOT], {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    const json = JSON.parse(result);
    expect(json.exitCode).toBe(0);
    expect(json.violations).toEqual([]);
    expect(json.scannedFiles).toBeGreaterThan(0);
    expect(json.excludedPaths).toContain('viewer-bench');
  });

  it('exits 1 when a network import is planted', () => {
    const fixtureDir = path.join(ROOT, 'packages', 'viewer-core', 'src');
    const fixturePath = path.join(fixtureDir, '__egress_test_fixture__.ts');
    try {
      fs.writeFileSync(fixturePath, "import http from 'node:http';\n");
      const result = execFileSync('npx', ['tsx', SCRIPT, '--root', ROOT], {
        encoding: 'utf-8',
        cwd: ROOT,
        // Script exits 1, which throws -- catch it
      });
      // Should not reach here
      expect.unreachable('Script should have exited with code 1');
    } catch (err: unknown) {
      const e = err as { status: number; stdout: string };
      expect(e.status).toBe(1);
      const json = JSON.parse(e.stdout);
      expect(json.exitCode).toBe(1);
      expect(json.violations.length).toBeGreaterThan(0);
      expect(json.violations[0].specifier).toBe('node:http');
    } finally {
      if (fs.existsSync(fixturePath)) {
        fs.unlinkSync(fixturePath);
      }
    }
  });

  it('completes in under 30 seconds', () => {
    const start = Date.now();
    execFileSync('npx', ['tsx', SCRIPT, '--root', ROOT], {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000);
  });
});
