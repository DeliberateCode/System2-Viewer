/**
 * API server setup.
 */

import { createLogger, Logger } from '@sample/core';
import { Router, Route } from './router.js';

export interface ServerConfig {
  port: number;
  host: string;
  basePath: string;
  debug: boolean;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 3000,
  host: 'localhost',
  basePath: '/api',
  debug: false,
};

export class ApiServer {
  private readonly config: ServerConfig;
  private readonly logger: Logger;
  private readonly router: Router;
  private running = false;

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
    this.logger = createLogger('ApiServer');
    this.router = new Router();
  }

  addRoute(route: Route): void {
    this.router.addRoute(route);
  }

  start(): void {
    if (this.running) {
      throw new Error('Server is already running');
    }
    this.logger.info(`Server starting on ${this.config.host}:${this.config.port}`);
    this.running = true;
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.logger.info('Server stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getRoutes(): Route[] {
    return this.router.getRoutes();
  }
}

export function createServer(config?: Partial<ServerConfig>): ApiServer {
  return new ApiServer(config);
}
