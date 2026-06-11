/**
 * CLI command runner.
 */

import { createLogger, Logger } from '@sample/core';
import { parseArgs, ParsedArgs } from './parser.js';
import { formatOutput, OutputFormat } from './formatter.js';

export interface CliOptions {
  verbose: boolean;
  format: OutputFormat;
  dataDir: string;
}

export interface CommandResult {
  exitCode: number;
  output: string;
}

const COMMANDS = ['init', 'status', 'serve', 'help', 'version'] as const;
type CommandName = (typeof COMMANDS)[number];

export function runCli(argv: string[]): CommandResult {
  const logger = createLogger('cli');
  const parsed = parseArgs(argv);

  if (!parsed.command || !COMMANDS.includes(parsed.command as CommandName)) {
    return {
      exitCode: 2,
      output: formatOutput(
        { error: `Unknown command: ${parsed.command ?? '(none)'}` },
        OutputFormat.Text,
      ),
    };
  }

  logger.info(`Running command: ${parsed.command}`, { flags: parsed.flags });

  // Dispatch to command handler
  switch (parsed.command as CommandName) {
    case 'help':
      return {
        exitCode: 0,
        output: formatOutput({ commands: COMMANDS }, OutputFormat.Text),
      };
    case 'version':
      return {
        exitCode: 0,
        output: formatOutput({ version: '1.0.0' }, OutputFormat.Text),
      };
    default:
      return {
        exitCode: 0,
        output: formatOutput(
          { message: `Command '${parsed.command}' executed` },
          parsed.flags['format'] === 'json' ? OutputFormat.Json : OutputFormat.Text,
        ),
      };
  }
}
