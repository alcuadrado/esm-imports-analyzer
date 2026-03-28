// ESM module — wraps chalk for colorized output
import chalk from 'chalk';

const colors = {
  green: chalk.green,
  red: chalk.red,
  yellow: chalk.yellow,
  blue: chalk.blue,
};

export function colorize(text, color) {
  const fn = colors[color];
  return fn ? fn(text) : text;
}
