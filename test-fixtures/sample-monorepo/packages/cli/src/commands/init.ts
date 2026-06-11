/**
 * Init command - initialize a new project.
 */

import { createLogger, CoreConfig, loadCoreConfig } from '@sample/core';

export interface InitOptions {
  name: string;
  force: boolean;
  template?: string;
}

export class InitCommand {
  private readonly logger = createLogger('init');

  execute(options: InitOptions): { success: boolean; config: CoreConfig } {
    this.logger.info(`Initializing project: ${options.name}`);

    if (!options.name || options.name.trim().length === 0) {
      throw new Error('Project name is required');
    }

    const config = loadCoreConfig({
      appName: options.name,
      debug: false,
    });

    this.logger.info('Project initialized successfully');
    return { success: true, config };
  }
}
