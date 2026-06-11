/**
 * Serve command - start the API server.
 */

import { createLogger } from '@sample/core';
import { ApiServer, createServer, ServerConfig } from '@sample/api';

export interface ServeOptions {
  port: number;
  host: string;
  debug: boolean;
}

export class ServeCommand {
  private readonly logger = createLogger('serve');
  private server: ApiServer | null = null;

  execute(options: ServeOptions): ApiServer {
    this.logger.info(`Starting server on ${options.host}:${options.port}`);

    const config: Partial<ServerConfig> = {
      port: options.port,
      host: options.host,
      debug: options.debug,
    };

    this.server = createServer(config);
    this.server.start();
    return this.server;
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
      this.logger.info('Server stopped');
    }
  }
}
