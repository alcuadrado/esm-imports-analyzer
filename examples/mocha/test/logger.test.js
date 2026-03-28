import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { log, logTiming, warn } from '../src/logger.js';

describe('logger (debug CJS + format ESM)', () => {
  it('log does not throw', () => {
    assert.doesNotThrow(() => log('test message'));
  });

  it('logTiming does not throw', () => {
    assert.doesNotThrow(() => logTiming('operation', 1500));
  });

  it('warn writes to stderr', () => {
    assert.doesNotThrow(() => warn('test warning'));
  });
});
