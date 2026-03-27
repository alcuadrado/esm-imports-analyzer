import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runCli, createTempOutputPath, cleanupFile } from './helpers.ts';

const fixturesDir = resolve(import.meta.dirname!, 'fixtures');
let tempPaths: string[] = [];

afterEach(() => {
  for (const p of tempPaths) cleanupFile(p);
  tempPaths = [];
});

describe('CLI', () => {
  it('basic invocation succeeds and produces HTML', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const result = runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);
    assert.equal(result.exitCode, 0);
    assert.ok(existsSync(output));
  });

  it('missing -- separator prints usage and exits 1', () => {
    const result = runCli(['node', 'app.js']);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('--') || result.stdout.includes('--'));
  });

  it('--help flag prints help and exits 0', () => {
    const result = runCli(['--help']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Usage'));
  });

  it('--version flag prints version and exits 0', () => {
    const result = runCli(['--version']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.trim().match(/^\d+\.\d+\.\d+$/));
  });

  it('--output flag sets custom output path', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const result = runCli(['--output', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);
    assert.equal(result.exitCode, 0);
    assert.ok(existsSync(output));
  });

  it('-o shorthand works', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const result = runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);
    assert.equal(result.exitCode, 0);
    assert.ok(existsSync(output));
  });

  it('prints report path to stdout', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const result = runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);
    assert.ok(result.stdout.includes('Report generated:'));
  });

  it('handles command with flags after --', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const result = runCli(['-o', output, '--', 'node', '--experimental-vm-modules', resolve(fixturesDir, 'simple/a.js')]);
    assert.equal(result.exitCode, 0);
    assert.ok(existsSync(output));
  });

  it('uses default output path when --output not specified', () => {
    const defaultPath = resolve('esm-imports-report.html');
    tempPaths.push(defaultPath);
    const result = runCli(['--', 'node', resolve(fixturesDir, 'simple/a.js')]);
    assert.equal(result.exitCode, 0);
    assert.ok(existsSync(defaultPath), 'Should write to default path ./esm-imports-report.html');
  });

  it('still generates report on non-zero child exit code', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const crashFixture = resolve(fixturesDir, 'simple/a.js');
    const result = runCli(['-o', output, '--', 'node', '-e', `import('${crashFixture}').then(() => process.exit(1))`]);
    // Report should still be generated since imports were collected before exit
    assert.ok(existsSync(output), 'Report should be generated even with non-zero exit');
    assert.ok(result.stdout.includes('Report generated'), 'Should print report path');
  });

  it('preserves existing NODE_OPTIONS', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const cliPath = resolve('src/cli.ts');
    try {
      execFileSync('node', [cliPath, '-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')], {
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // may throw, but we only care about the report being generated
    }
    assert.ok(existsSync(output), 'Report should be generated with pre-existing NODE_OPTIONS');
    const html = readFileSync(output, 'utf-8');
    assert.ok(html.includes('<!DOCTYPE html>'), 'Should produce valid HTML');
  });

  it('child stdout passthrough is visible', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    // CLI uses stdio: 'inherit' for the child, so child output merges with CLI output
    // In our test helper, we capture the combined stdout
    const result = runCli(['-o', output, '--', 'node', '-e', `console.log('CHILD_OUTPUT_MARKER'); import('node:path');`]);
    assert.ok(result.stdout.includes('CHILD_OUTPUT_MARKER'), 'Child stdout should be visible in output');
  });
});
