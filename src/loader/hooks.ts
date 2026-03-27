import type { ImportRecord } from '../types.ts';
import type { RegisterHooksOptions, ResolveHookContext, LoadHookContext } from 'node:module';

interface PendingResolve {
  specifier: string;
  resolvedURL: string;
  parentURL: string | null;
  resolveStartTime: number;
  resolveEndTime: number;
}

export function createHooks(records: ImportRecord[]): RegisterHooksOptions {
  const loadedURLs = new Set<string>();
  // Queue of resolve results awaiting their load call
  const pendingQueue: PendingResolve[] = [];

  return {
    resolve(specifier: string, context: ResolveHookContext, nextResolve) {
      const resolveStartTime = performance.now();
      const result = nextResolve(specifier, context);
      const resolveEndTime = performance.now();

      if (loadedURLs.has(result.url)) {
        // Already loaded (cached import or circular back-edge).
        // Record immediately with near-zero load time.
        records.push({
          specifier,
          resolvedURL: result.url,
          parentURL: context.parentURL ?? null,
          resolveStartTime,
          resolveEndTime,
          loadStartTime: resolveEndTime,
          loadEndTime: resolveEndTime,
        });
      } else {
        pendingQueue.push({
          specifier,
          resolvedURL: result.url,
          parentURL: context.parentURL ?? null,
          resolveStartTime,
          resolveEndTime,
        });
      }

      return result;
    },

    load(url: string, context: LoadHookContext, nextLoad) {
      const loadStartTime = performance.now();
      const result = nextLoad(url, context);
      const loadEndTime = performance.now();

      loadedURLs.add(url);

      // Find the matching pending resolve for this URL
      const idx = pendingQueue.findIndex(p => p.resolvedURL === url);
      if (idx !== -1) {
        const pending = pendingQueue[idx]!;
        pendingQueue.splice(idx, 1);
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
