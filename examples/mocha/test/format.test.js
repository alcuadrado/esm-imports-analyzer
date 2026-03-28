import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatError, formatWarning } from '../src/format.js';

describe('format', () => {
  it('formats milliseconds to human-readable string', () => {
    const result = formatDuration(60000);
    assert.ok(result.includes('1m'));
  });

  it('formats small durations', () => {
    const result = formatDuration(500);
    assert.ok(result.includes('500ms'));
  });

  it('wraps error messages in red', () => {
    const result = formatError('fail');
    assert.ok(result.includes('fail'));
  });

  it('wraps warnings in yellow', () => {
    const result = formatWarning('careful');
    assert.ok(result.includes('careful'));
  });
});
