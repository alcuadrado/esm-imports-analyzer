// ESM module — uses lodash-es
import { clamp, round, sum } from 'lodash-es';

export function average(numbers) {
  if (numbers.length === 0) return 0;
  return round(sum(numbers) / numbers.length, 2);
}

export function clampValue(value, lower, upper) {
  return clamp(value, lower, upper);
}
