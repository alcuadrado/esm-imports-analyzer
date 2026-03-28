// ESM module with top-level await — simulates async config loading
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let config;
try {
  const raw = await readFile(join(__dirname, '..', 'package.json'), 'utf-8');
  const pkg = JSON.parse(raw);
  config = { name: pkg.name, version: pkg.version };
} catch {
  config = { name: 'unknown', version: '0.0.0' };
}

export function getConfig() {
  return config;
}
