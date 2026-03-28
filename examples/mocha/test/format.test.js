import assert from 'node:assert/strict';
import { formatDuration, formatError } from '../src/format.js';

describe('format', () => {
  describe('formatDuration', () => {
    it('formats milliseconds to human-readable string', () => {
      const result = formatDuration(60000);
      assert.ok(result.includes('1m'));
    });

    it('formats small durations', () => {
      const result = formatDuration(500);
      assert.ok(result.includes('500ms'));
    });
  });

  describe('formatError', () => {
    it('wraps error message with color', () => {
      const result = formatError('something went wrong');
      assert.ok(result.includes('something went wrong'));
    });
  });
});
