#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { ImportRecord, ReportData } from './types.ts';
import { buildTree } from './analysis/tree-builder.ts';
import { detectCycles } from './analysis/cycle-detector.ts';
import { groupModules } from './analysis/grouper.ts';
import { computeRankedList, computeTotalTime } from './analysis/timing.ts';
import { generateReport } from './report/generator.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findProjectRoot(): string {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return __dirname;
}

function printUsage(): void {
  console.log(`
ESM Imports Analyzer

Usage:
  esm-imports-analyzer [options] -- <command> [command-args...]

Options:
  --output, -o <path>   Output HTML report path (default: ./esm-imports-report.html)
  --help, -h            Show help
  --version, -v         Show version

Example:
  npx esm-imports-analyzer -- node app.js
  npx esm-imports-analyzer -o report.html -- node server.js
`);
}

function getVersion(): string {
  try {
    const projectRoot = findProjectRoot();
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;
    return (pkg['version'] as string) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

interface ParsedArgs {
  outputPath: string;
  command: string[];
}

function parseArgs(args: string[]): ParsedArgs | null {
  // Check for help/version before separator check
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      console.log(getVersion());
      process.exit(0);
    }
  }

  const separatorIndex = args.indexOf('--');
  if (separatorIndex === -1) {
    return null;
  }

  const ourArgs = args.slice(0, separatorIndex);
  const command = args.slice(separatorIndex + 1);

  if (command.length === 0) {
    return null;
  }

  let outputPath = resolve('esm-imports-report.html');

  for (let i = 0; i < ourArgs.length; i++) {
    if (ourArgs[i] === '--output' || ourArgs[i] === '-o') {
      const nextArg = ourArgs[i + 1];
      if (nextArg) {
        outputPath = resolve(nextArg);
        i++;
      }
    }
  }

  return { outputPath, command };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed) {
    console.error('Error: Missing -- separator. Usage: esm-imports-analyzer [options] -- <command>');
    printUsage();
    return fail('');
  }

  const { outputPath, command } = parsed;
  const tempFile = join(tmpdir(), `esm-analyzer-${randomUUID()}.json`);

  // Determine the register script path
  const projectRoot = findProjectRoot();
  const registerPath = __dirname.includes('dist')
    ? join(projectRoot, 'dist', 'loader', 'register.js')
    : join(projectRoot, 'src', 'loader', 'register.ts');

  // Prepare NODE_OPTIONS
  const existingNodeOptions = process.env['NODE_OPTIONS'] ?? '';
  const nodeOptions = `--import=${registerPath} ${existingNodeOptions}`.trim();

  const cmd = command[0];
  const cmdArgs = command.slice(1);
  if (!cmd) {
    return fail('Error: No command specified after --');
  }

  const child = spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      ESM_ANALYZER_TEMP_FILE: tempFile,
    },
  });

  const exitCode = await new Promise<number>((resolvePromise) => {
    child.on('close', (code: number | null) => {
      resolvePromise(code ?? 0);
    });
    child.on('error', (err: Error) => {
      console.error(`Error spawning command: ${err.message}`);
      resolvePromise(1);
    });
  });

  if (exitCode !== 0) {
    console.warn(`\nWarning: Command exited with code ${exitCode}. Generating report from collected data.`);
  }

  // Read collected data
  if (!existsSync(tempFile)) {
    return fail('Error: No import data collected. Is the project using ESM?');
  }

  let rawData: string;
  try {
    rawData = readFileSync(tempFile, 'utf-8');
  } catch {
    return fail('Error: Could not read import data file.');
  }

  if (!rawData.trim()) {
    return fail('Error: No imports were captured. Is the project using ESM?');
  }

  let records: ImportRecord[];
  try {
    records = JSON.parse(rawData) as ImportRecord[];
  } catch {
    return fail('Error: Import data file contains invalid JSON.');
  }

  // Clean up temp file
  try {
    unlinkSync(tempFile);
  } catch {
    // Best effort cleanup
  }

  // Run analysis
  const tree = buildTree(records);
  const cycles = detectCycles(records);
  const groups = groupModules(records);
  const rankedList = computeRankedList(records);
  const totalTime = computeTotalTime(records);

  const reportData: ReportData = {
    metadata: {
      command: command.join(' '),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      totalModules: rankedList.length,
      totalTime,
    },
    modules: records,
    tree,
    groups,
    cycles,
  };

  generateReport(reportData, outputPath);

  console.log(`\nReport generated: ${outputPath}`);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
