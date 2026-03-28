import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { average, clampValue, total, ranked } from '../src/math.js';

describe('math', () => {
  it('computes average', () => {
    assert.equal(average([1, 2, 3, 4, 5]), 3);
  });

  it('returns 0 for empty array', () => {
    assert.equal(average([]), 0);
  });

  it('rounds to 2 decimal places', () => {
    assert.equal(average([1, 2]), 1.5);
  });

  it('clamps above upper bound', () => {
    assert.equal(clampValue(15, 0, 10), 10);
  });

  it('clamps below lower bound', () => {
    assert.equal(clampValue(-5, 0, 10), 0);
  });

  it('sums numbers', () => {
    assert.equal(total([10, 20, 30]), 60);
  });

  it('ranks objects by key', () => {
    const items = [{ n: 'c', v: 3 }, { n: 'a', v: 1 }, { n: 'b', v: 2 }];
    const result = ranked(items, 'v');
    assert.deepEqual(result.map(i => i.n), ['a', 'b', 'c']);
  });
});
