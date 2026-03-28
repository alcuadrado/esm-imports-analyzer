// ESM module — uses debug (CJS package) + our own format module
import createDebug from 'debug';
import { formatDuration, formatWarning } from './format.js';

const debug = createDebug('app');

export function log(message) {
  debug(message);
}

export function logTiming(label, ms) {
  debug('%s: %s', label, formatDuration(ms));
}

export function warn(message) {
  console.warn(formatWarning(message));
}
