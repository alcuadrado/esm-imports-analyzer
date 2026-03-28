// ESM module — math utilities using lodash-es (tree-shakeable ESM)
import { clamp, round, sum, mean, sortBy } from 'lodash-es';

export function average(numbers) {
  if (numbers.length === 0) return 0;
  return round(mean(numbers), 2);
}

export function clampValue(value, lower, upper) {
  return clamp(value, lower, upper);
}

export function total(numbers) {
  return sum(numbers);
}

export function ranked(items, key) {
  return sortBy(items, key);
}
