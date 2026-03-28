import assert from 'node:assert/strict';
import { average, clampValue } from '../src/math.js';

describe('math', () => {
  describe('average', () => {
    it('computes average of numbers', () => {
      assert.equal(average([1, 2, 3, 4, 5]), 3);
    });

    it('returns 0 for empty array', () => {
      assert.equal(average([]), 0);
    });

    it('rounds to 2 decimal places', () => {
      assert.equal(average([1, 2]), 1.5);
    });
  });

  describe('clampValue', () => {
    it('clamps within range', () => {
      assert.equal(clampValue(15, 0, 10), 10);
    });

    it('returns value if within range', () => {
      assert.equal(clampValue(5, 0, 10), 5);
    });
  });
});
