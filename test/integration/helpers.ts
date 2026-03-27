import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ImportRecord } from '../../src/types.ts';

const projectRoot = resolve(import.meta.dirname!, '../..');
const registerPath = join(projectRoot, 'src', 'loader', 'register.ts');

export interface RunResult {
  records: ImportRecord[];
  exitCode: number;
}

export function runWithLoader(fixtureEntry: string): RunResult {
  const tempFile = join(tmpdir(), `esm-analyzer-test-${randomUUID()}.json`);

  try {
    execFileSync('node', [fixtureEntry], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${registerPath}`,
        ESM_ANALYZER_TEMP_FILE: tempFile,
      },
      timeout: 15000,
      stdio: 'pipe',
    });
  } catch (err: unknown) {
    // Child may exit non-zero, that's fine
    const error = err as { status?: number };
    if (!existsSync(tempFile)) {
      return { records: [], exitCode: error.status ?? 1 };
    }
  }

  if (!existsSync(tempFile)) {
    return { records: [], exitCode: 0 };
  }

  const raw = readFileSync(tempFile, 'utf-8');
  unlinkSync(tempFile);

  if (!raw.trim()) {
    return { records: [], exitCode: 0 };
  }

  return { records: JSON.parse(raw) as ImportRecord[], exitCode: 0 };
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  reportPath: string | null;
}

export function runCli(args: string[]): CliResult {
  const cliPath = join(projectRoot, 'src', 'cli.ts');

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    const result = execFileSync('node', [cliPath, ...args], {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    stdout = result;
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
    exitCode = error.status ?? 1;
  }

  const reportMatch = stdout.match(/Report generated: (.+)/);
  const reportPath = reportMatch ? reportMatch[1]!.trim() : null;

  return { stdout, stderr, exitCode, reportPath };
}

export function createTempOutputPath(): string {
  return join(tmpdir(), `esm-analyzer-test-${randomUUID()}.html`);
}

export function cleanupFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // best effort
  }
}
