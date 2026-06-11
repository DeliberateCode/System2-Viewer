/**
 * Status command - show current project status.
 */

import { Logger, createLogger, EntityStatus } from '@sample/core';

export interface StatusInfo {
  projectName: string;
  entityCount: number;
  activeCount: number;
  status: EntityStatus;
  uptime: number;
}

export class StatusCommand {
  private readonly logger: Logger = createLogger('status');

  execute(projectName: string): StatusInfo {
    this.logger.info(`Checking status for: ${projectName}`);

    return {
      projectName,
      entityCount: 0,
      activeCount: 0,
      status: EntityStatus.Active,
      uptime: process.uptime(),
    };
  }

  formatStatus(info: StatusInfo): string {
    return [
      `Project: ${info.projectName}`,
      `Status: ${info.status}`,
      `Entities: ${info.entityCount} (${info.activeCount} active)`,
      `Uptime: ${info.uptime.toFixed(1)}s`,
    ].join('\n');
  }
}
