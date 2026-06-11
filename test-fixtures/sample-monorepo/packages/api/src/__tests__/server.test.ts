import { describe, it, expect } from 'vitest';
import { ApiServer, createServer } from '../server.js';
import { HttpMethod } from '../router.js';

describe('ApiServer', () => {
  it('should create a server with defaults', () => {
    const server = createServer();
    expect(server.isRunning()).toBe(false);
  });

  it('should start and stop', () => {
    const server = createServer();
    server.start();
    expect(server.isRunning()).toBe(true);
    server.stop();
    expect(server.isRunning()).toBe(false);
  });

  it('should throw on double start', () => {
    const server = createServer();
    server.start();
    expect(() => server.start()).toThrow('already running');
    server.stop();
  });

  it('should register routes', () => {
    const server = createServer();
    server.addRoute({ method: HttpMethod.GET, path: '/test', handler: 'test' });
    expect(server.getRoutes()).toHaveLength(1);
  });
});
