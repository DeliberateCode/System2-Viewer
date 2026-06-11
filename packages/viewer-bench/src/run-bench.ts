/**
 * CLI entry point for `npm run bench`.
 *
 * Parses minimal CLI args, generates a fixture, runs the benchmark,
 * and prints/writes the report.
 *
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateFixture } from './fixture-gen.js';
import { runBenchmark } from './bench-runner.js';
import { formatReport, writeReport } from './report.js';
import type { FixtureConfig, BenchmarkConfig } from './types.js';

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  typescript: 'typescript',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  go: 'go',
};

export interface BenchArgs {
  files: number;
  languages: string[];
  runs: number;
  output?: string;
}

export function parseBenchArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    files: 100,
    languages: ['typescript'],
    runs: 3,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--files' && next != null) {
      args.files = parseInt(next, 10) || 100;
      i++;
    } else if (arg === '--languages' && next != null) {
      args.languages = next.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--runs' && next != null) {
      args.runs = parseInt(next, 10) || 3;
      i++;
    } else if (arg === '--output' && next != null) {
      args.output = next;
      i++;
    }
  }

  return args;
}

function buildFixtureConfig(args: BenchArgs, outputDir: string): FixtureConfig {
  const resolvedLangs = args.languages.map((l) => LANG_ALIASES[l] ?? l);
  const perLang = Math.max(1, Math.floor(args.files / resolvedLangs.length));
  const languages: Record<string, number> = {};
  let remaining = args.files;

  for (let i = 0; i < resolvedLangs.length; i++) {
    const lang = resolvedLangs[i];
    const count = i === resolvedLangs.length - 1 ? remaining : Math.min(perLang, remaining);
    languages[lang] = count;
    remaining -= count;
  }

  return {
    languages,
    locRange: [20, 80],
    nestingDepth: 3,
    outputDir,
  };
}

async function main(): Promise<void> {
  const args = parseBenchArgs(process.argv.slice(2));

  console.log(`Benchmark: ${args.files} files, languages=[${args.languages.join(',')}], runs=${args.runs}`);

  const fixtureDir = mkdtempSync(join(tmpdir(), 'bench-fixture-'));

  try {
    const fixtureConfig = buildFixtureConfig(args, fixtureDir);
    generateFixture(fixtureConfig);

    const benchConfig: BenchmarkConfig = {
      fixtureDir,
      warmupRuns: 1,
      measuredRuns: args.runs,
    };

    const result = await runBenchmark(benchConfig);
    console.log(formatReport(result));

    if (args.output) {
      const reportPath = writeReport(result, args.output);
      console.log(`Report written to: ${reportPath}`);
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

// Run main when executed directly (not imported)
const thisFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? '') === resolve(thisFile)) {
  main().catch((err: unknown) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
}
