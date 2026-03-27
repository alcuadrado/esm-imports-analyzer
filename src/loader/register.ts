import module from 'node:module';
import { writeFileSync } from 'node:fs';
import type { ImportRecord } from '../types.ts';
import { createHooks } from './hooks.ts';

const records: ImportRecord[] = [];
const hooks = createHooks(records);

module.registerHooks(hooks);

const tempFile = process.env['ESM_ANALYZER_TEMP_FILE'];

function flushData(): void {
  if (tempFile && records.length > 0) {
    try {
      writeFileSync(tempFile, JSON.stringify(records));
    } catch {
      // Best effort — if we can't write, data is lost
    }
  }
}

process.on('beforeExit', flushData);
process.on('exit', flushData);
