import module from 'node:module';
import { writeFileSync } from 'node:fs';
import type { ImportRecord } from '../types.ts';
import { createHooks } from './hooks.ts';

const records: ImportRecord[] = [];
const evalStarts = new Map<string, number>();
const evalTimes = new Map<string, number>();

(globalThis as any).__esm_analyzer_import_done__ = (url: string) => {
  const start = evalStarts.get(url);
  if (start !== undefined) {
    evalTimes.set(url, performance.now() - start);
    evalStarts.delete(url);
  }
};

const hooks = createHooks(records, evalStarts);
module.registerHooks(hooks);

const tempFile = process.env['ESM_ANALYZER_TEMP_FILE'];

function flushData(): void {
  if (tempFile && records.length > 0) {
    for (const record of records) {
      const t = evalTimes.get(record.resolvedURL);
      if (t !== undefined) {
        record.totalImportTime = t;
      }
    }
    try {
      writeFileSync(tempFile, JSON.stringify(records));
    } catch {
      // Best effort — if we can't write, data is lost
    }
  }
}

process.on('beforeExit', flushData);
process.on('exit', flushData);
