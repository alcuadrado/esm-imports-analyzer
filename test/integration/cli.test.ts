import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
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
});
