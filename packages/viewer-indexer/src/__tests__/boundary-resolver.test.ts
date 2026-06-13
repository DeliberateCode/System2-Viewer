import { describe, it, expect } from 'vitest';
import { resolveBoundaryMembership } from '../boundary-resolver.js';

describe('resolveBoundaryMembership', () => {
  it('assigns files to matching boundaries', () => {
    const boundaries = [
      { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
      { name: 'payments', paths: ['src/payments/**'], publicInterface: ['src/payments/api.ts'] },
    ];
    const files = ['src/auth/login.ts', 'src/auth/index.ts', 'src/payments/charge.ts', 'src/utils.ts'];
    const result = resolveBoundaryMembership(boundaries, files);

    expect(result.fileToBoundary.get('src/auth/login.ts')?.boundaryName).toBe('auth');
    expect(result.fileToBoundary.get('src/auth/index.ts')?.boundaryName).toBe('auth');
    expect(result.fileToBoundary.get('src/payments/charge.ts')?.boundaryName).toBe('payments');
    expect(result.fileToBoundary.has('src/utils.ts')).toBe(false);
  });

  it('marks public interface files correctly', () => {
    const boundaries = [
      { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
    ];
    const files = ['src/auth/login.ts', 'src/auth/index.ts'];
    const result = resolveBoundaryMembership(boundaries, files);

    expect(result.fileToBoundary.get('src/auth/index.ts')?.isPublic).toBe(true);
    expect(result.fileToBoundary.get('src/auth/login.ts')?.isPublic).toBe(false);
  });

  it('first match wins for overlapping boundaries', () => {
    const boundaries = [
      { name: 'first', paths: ['src/**'], publicInterface: ['src/index.ts'] },
      { name: 'second', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
    ];
    const files = ['src/auth/login.ts'];
    const result = resolveBoundaryMembership(boundaries, files);

    expect(result.fileToBoundary.get('src/auth/login.ts')?.boundaryName).toBe('first');
    expect(result.warnings.some(w => w.includes('multiple boundaries'))).toBe(true);
  });

  it('warns on duplicate boundary names', () => {
    const boundaries = [
      { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
      { name: 'auth', paths: ['src/auth2/**'], publicInterface: ['src/auth2/index.ts'] },
    ];
    const result = resolveBoundaryMembership(boundaries, ['src/auth/a.ts']);

    expect(result.warnings.some(w => w.includes('Duplicate'))).toBe(true);
  });

  it('tracks boundary file counts', () => {
    const boundaries = [
      { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
    ];
    const files = ['src/auth/login.ts', 'src/auth/index.ts', 'src/auth/utils.ts'];
    const result = resolveBoundaryMembership(boundaries, files);

    const authBoundary = result.boundaries.get('auth');
    expect(authBoundary).toBeDefined();
    expect(authBoundary!.files.size).toBe(3);
    expect(authBoundary!.publicFiles.size).toBe(1);
  });

  it('handles empty boundaries array', () => {
    const result = resolveBoundaryMembership([], ['src/a.ts']);
    expect(result.fileToBoundary.size).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles empty files array', () => {
    const boundaries = [
      { name: 'auth', paths: ['src/auth/**'], publicInterface: ['src/auth/index.ts'] },
    ];
    const result = resolveBoundaryMembership(boundaries, []);
    expect(result.fileToBoundary.size).toBe(0);
    expect(result.boundaries.get('auth')!.files.size).toBe(0);
  });
});
