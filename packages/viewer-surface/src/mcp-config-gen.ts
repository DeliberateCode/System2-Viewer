/**
 * MCP config generator: produces .mcp.json for stdio MCP server entry.
 *
 * Non-destructive: writes .mcp.json.new if file exists (unless --force).
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpConfigResult } from './types.js';

export interface McpConfigOpts {
  /** Required absolute path to the viewer package. */
  package: string;
  /** Target directory for the .mcp.json file. Defaults to cwd. */
  target?: string;
  /** Server name in the mcpServers map. Defaults to 'system2-viewer'. */
  name?: string;
  /** If true, overwrite existing .mcp.json. */
  force?: boolean;
}

/**
 * Generates a .mcp.json configuration file for the System2-viewer MCP server.
 *
 * @param opts.package - Required absolute path to the viewer package root
 * @param opts.target - Directory to write the .mcp.json file (defaults to cwd)
 * @param opts.name - Server name in mcpServers map (defaults to 'system2-viewer')
 * @param opts.force - Overwrite existing .mcp.json if true
 */
export function generateMcpConfig(opts: McpConfigOpts): McpConfigResult {
  const serverName = opts.name ?? 'system2-viewer';
  const targetDir = opts.target ?? process.cwd();
  const force = opts.force ?? false;

  const mcpConfig = {
    mcpServers: {
      [serverName]: {
        type: 'stdio',
        command: 'node',
        args: [opts.package + '/mcp-server.mjs'],
      },
    },
  };

  const content = JSON.stringify(mcpConfig, null, 2) + '\n';
  const targetPath = join(targetDir, '.mcp.json');
  const existed = existsSync(targetPath);

  if (existed && !force) {
    const sidecarPath = targetPath + '.new';
    writeFileSync(sidecarPath, content, 'utf-8');
    return {
      targetPath: sidecarPath,
      created: true,
    };
  }

  writeFileSync(targetPath, content, 'utf-8');
  return {
    targetPath,
    created: true,
  };
}
