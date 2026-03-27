import type { ImportRecord } from '../types.ts';
import type { RegisterHooksOptions, ResolveHookContext, LoadHookContext } from 'node:module';

interface PartialRecord {
  specifier: string;
  parentURL: string | null;
  resolveStartTime: number;
  resolveEndTime: number;
}

export function createHooks(records: ImportRecord[]): RegisterHooksOptions {
  const pendingResolves = new Map<string, PartialRecord>();

  return {
    resolve(specifier: string, context: ResolveHookContext, nextResolve) {
      const resolveStartTime = performance.now();
      const result = nextResolve(specifier, context);
      const resolveEndTime = performance.now();

      pendingResolves.set(result.url, {
        specifier,
        parentURL: context.parentURL ?? null,
        resolveStartTime,
        resolveEndTime,
      });

      return result;
    },

    load(url: string, context: LoadHookContext, nextLoad) {
      const loadStartTime = performance.now();
      const result = nextLoad(url, context);
      const loadEndTime = performance.now();

      const pending = pendingResolves.get(url);
      if (pending) {
        pendingResolves.delete(url);
        records.push({
          specifier: pending.specifier,
          resolvedURL: url,
          parentURL: pending.parentURL,
          resolveStartTime: pending.resolveStartTime,
          resolveEndTime: pending.resolveEndTime,
          loadStartTime,
          loadEndTime,
        });
      }

      return result;
    },
  };
}
