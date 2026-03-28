// ESM module — formats durations and messages using ms + chalk
import ms from 'ms';
import chalk from 'chalk';

export function formatDuration(milliseconds) {
  return chalk.green(ms(milliseconds));
}

export function formatError(message) {
  return chalk.red(message);
}

export function formatWarning(message) {
  return chalk.yellow(message);
}
