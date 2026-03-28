// ESM module — formats durations and messages
import ms from 'ms';
import { colorize } from './colorize.js';

export function formatDuration(milliseconds) {
  return colorize(ms(milliseconds), 'green');
}

export function formatError(message) {
  return colorize(message, 'red');
}
