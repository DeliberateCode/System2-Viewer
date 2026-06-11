import { describe, it, expect } from 'vitest';
import { Router, HttpMethod } from '../router.js';

describe('Router', () => {
  it('should add and find routes', () => {
    const router = new Router();
    router.addRoute({ method: HttpMethod.GET, path: '/users', handler: 'listUsers' });
    const found = router.findRoute(HttpMethod.GET, '/users');
    expect(found).toBeDefined();
    expect(found?.handler).toBe('listUsers');
  });

  it('should reject duplicate routes', () => {
    const router = new Router();
    router.addRoute({ method: HttpMethod.GET, path: '/users', handler: 'listUsers' });
    expect(() =>
      router.addRoute({ method: HttpMethod.GET, path: '/users', handler: 'other' }),
    ).toThrow('already registered');
  });

  it('should remove routes', () => {
    const router = new Router();
    router.addRoute({ method: HttpMethod.GET, path: '/users', handler: 'listUsers' });
    expect(router.removeRoute(HttpMethod.GET, '/users')).toBe(true);
    expect(router.findRoute(HttpMethod.GET, '/users')).toBeUndefined();
  });

  it('should filter routes by method', () => {
    const router = new Router();
    router.addRoute({ method: HttpMethod.GET, path: '/a', handler: 'a' });
    router.addRoute({ method: HttpMethod.POST, path: '/b', handler: 'b' });
    router.addRoute({ method: HttpMethod.GET, path: '/c', handler: 'c' });
    expect(router.getRoutesByMethod(HttpMethod.GET)).toHaveLength(2);
  });
});
