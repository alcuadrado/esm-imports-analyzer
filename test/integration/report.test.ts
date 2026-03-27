import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { runCli, createTempOutputPath, cleanupFile } from './helpers.ts';

const fixturesDir = resolve(import.meta.dirname!, 'fixtures');
let tempPaths: string[] = [];

afterEach(() => {
  for (const p of tempPaths) cleanupFile(p);
  tempPaths = [];
});

describe('report generation', () => {
  it('generates valid HTML', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const result = runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.reportPath);

    const html = readFileSync(output, 'utf-8');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<html'));
    assert.ok(html.includes('<body>'));
    assert.ok(html.includes('</html>'));
  });

  it('embeds JSON data in script tag', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);

    const html = readFileSync(output, 'utf-8');
    assert.ok(html.includes('<script type="application/json" id="import-data">'));

    // Extract and parse JSON
    const match = html.match(/<script type="application\/json" id="import-data">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(match);
    const data = JSON.parse(match[1]!);
    assert.ok(data.metadata);
    assert.ok(data.modules);
    assert.ok(data.tree);
    assert.ok(data.groups);
    assert.ok(Array.isArray(data.cycles));
  });

  it('includes Cytoscape.js via CDN', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);

    const html = readFileSync(output, 'utf-8');
    assert.ok(html.includes('unpkg.com/cytoscape'), 'Should include cytoscape CDN script');
    assert.ok(html.includes('unpkg.com/cytoscape-cose-bilkent'), 'Should include cose-bilkent CDN script');
  });

  it('inlines CSS', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);

    const html = readFileSync(output, 'utf-8');
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('--bg-primary'));
  });

  it('contains all modules from fixture', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);

    const html = readFileSync(output, 'utf-8');
    const match = html.match(/<script type="application\/json" id="import-data">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(match);
    const data = JSON.parse(match[1]!);
    assert.ok(data.metadata.totalModules >= 3, `Expected at least 3 modules, got ${data.metadata.totalModules}`);
  });

  it('includes cycles for circular fixture', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'circular/a.js')]);

    const html = readFileSync(output, 'utf-8');
    const match = html.match(/<script type="application\/json" id="import-data">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(match);
    const data = JSON.parse(match[1]!);
    assert.ok(data.cycles.length > 0, 'Should detect cycles');
  });

  it('includes groups', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);

    const html = readFileSync(output, 'utf-8');
    const match = html.match(/<script type="application\/json" id="import-data">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(match);
    const data = JSON.parse(match[1]!);
    assert.ok(data.groups.length > 0, 'Should have groups');
  });

  it('writes to specified output path', () => {
    const output = createTempOutputPath();
    tempPaths.push(output);
    const result = runCli(['-o', output, '--', 'node', resolve(fixturesDir, 'simple/a.js')]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.reportPath);
    assert.ok(result.reportPath.includes(output) || output.includes(result.reportPath!));
  });
});
