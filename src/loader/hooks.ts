import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ImportRecord } from '../types.ts';
import type { RegisterHooksOptions, ResolveHookContext, LoadHookContext } from 'node:module';

interface PendingResolve {
  specifier: string;
  resolvedURL: string;
  parentURL: string | null;
  importStartTime: number;
}

const SOURCE_MAP_RE = /(\n\/\/[#@] sourceMappingURL=[^\n]*\s*)$/;

function injectCallback(source: string, url: string): string {
  const injection = `\n;globalThis.__esm_analyzer_import_done__(${JSON.stringify(url)});\n`;
  if (SOURCE_MAP_RE.test(source)) {
    return source.replace(SOURCE_MAP_RE, injection + '$1');
  }
  return source + injection;
}

export function createHooks(records: ImportRecord[], evalStarts: Map<string, number>): RegisterHooksOptions {
  const loadedURLs = new Set<string>();
  const pendingQueue: PendingResolve[] = [];

  return {
    resolve(specifier: string, context: ResolveHookContext, nextResolve) {
      const importStartTime = performance.now();
      const result = nextResolve(specifier, context);

      if (loadedURLs.has(result.url)) {
        // Already loaded (cached import or circular back-edge).
        records.push({
          specifier,
          resolvedURL: result.url,
          parentURL: context.parentURL ?? null,
          importStartTime,
        });
      } else {
        pendingQueue.push({
          specifier,
          resolvedURL: result.url,
          parentURL: context.parentURL ?? null,
          importStartTime,
        });
      }

      return result;
    },

    load(url: string, context: LoadHookContext, nextLoad) {
      const result = nextLoad(url, context);

      loadedURLs.add(url);

      // Find the matching pending resolve for this URL
      const idx = pendingQueue.findIndex(p => p.resolvedURL === url);
      if (idx !== -1) {
        const pending = pendingQueue[idx]!;
        pendingQueue.splice(idx, 1);

        evalStarts.set(url, pending.importStartTime);

        records.push({
          specifier: pending.specifier,
          resolvedURL: url,
          parentURL: pending.parentURL,
          importStartTime: pending.importStartTime,
        });
      }

      // Inject eval callback into JS module sources
      // format is 'module' for ESM, 'commonjs' for CJS via import(), undefined for CJS via require()
      if (result.format !== 'json' && result.format !== 'wasm') {
        let source: string | null = null;
        if (result.source != null) {
          source = typeof result.source === 'string'
            ? result.source
            : new TextDecoder().decode(result.source);
        } else if (url.startsWith('file://')) {
          // CJS modules loaded via import() may have null source — read from disk
          try { source = readFileSync(fileURLToPath(url), 'utf-8'); } catch {}
        }

        if (source !== null) {
          return { ...result, source: injectCallback(source, url) };
        }
      }

      // Non-JS module (JSON, WASM, builtin) — can't measure eval time
      evalStarts.delete(url);
      return result;
    },
  };
}
