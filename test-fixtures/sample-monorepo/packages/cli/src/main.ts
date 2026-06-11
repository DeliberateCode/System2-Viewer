/**
 * CLI entry point.
 */

import { runCli } from './runner.js';

const result = runCli(process.argv.slice(2));
process.stdout.write(result.output + '\n');
process.exit(result.exitCode);
