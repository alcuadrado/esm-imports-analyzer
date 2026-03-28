import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the source injection logic used by the load hook in hooks.ts.
 *
 * How import time measurement works:
 * 1. The load hook appends a callback invocation to each JS module's source
 * 2. When the module finishes evaluating, the callback fires
 * 3. The elapsed time from resolve-hook-start to callback-fire is recorded as totalImportTime
 *
 * The injection must:
 * - Append the callback AFTER the module's code
 * - Preserve source map URLs (insert BEFORE them)
 * - Safely quote the module URL in the injected code
 * - Not corrupt source containing special characters ($, etc.)
 */

// Reproduce the injection logic from hooks.ts
const SOURCE_MAP_RE = /(\n\/\/[#@] sourceMappingURL=[^\n]*\s*)$/;

function injectCallback(source: string, url: string): string {
  const injection = `\n;globalThis.__esm_analyzer_import_done__(${JSON.stringify(url)});\n`;
  if (SOURCE_MAP_RE.test(source)) {
    return source.replace(SOURCE_MAP_RE, injection + '$1');
  }
  return source + injection;
}

describe('source injection', () => {
  describe('basic injection', () => {
    it('appends callback to plain JS source', () => {
      const result = injectCallback('const x = 1;', 'file:///a.js');
      assert.ok(result.startsWith('const x = 1;'));
      assert.ok(result.includes('globalThis.__esm_analyzer_import_done__("file:///a.js")'));
    });

    it('appends callback to source ending with newline', () => {
      const result = injectCallback('const x = 1;\n', 'file:///a.js');
      assert.ok(result.includes('__esm_analyzer_import_done__'));
    });

    it('appends callback to source ending with comment', () => {
      const result = injectCallback('const x = 1; // end', 'file:///a.js');
      assert.ok(result.includes('__esm_analyzer_import_done__'));
      // The \n before ; ensures the callback is on a new line after the comment
      assert.ok(result.includes('\n;globalThis'));
    });

    it('appends callback to empty source', () => {
      const result = injectCallback('', 'file:///a.js');
      assert.ok(result.includes('__esm_analyzer_import_done__("file:///a.js")'));
    });

    it('prepends semicolon to avoid ASI issues', () => {
      const result = injectCallback('export default 42', 'file:///a.js');
      assert.ok(result.includes('\n;globalThis.__esm_analyzer_import_done__'));
    });
  });

  describe('URL escaping', () => {
    it('JSON-escapes the URL (handles special characters)', () => {
      const url = 'file:///path/with "quotes" and \\backslashes';
      const result = injectCallback('', url);
      // JSON.stringify handles the escaping
      assert.ok(result.includes(JSON.stringify(url)));
    });

    it('handles URLs with single quotes', () => {
      const url = "file:///it's/a/path.js";
      const result = injectCallback('', url);
      assert.ok(result.includes('__esm_analyzer_import_done__'));
      // JSON.stringify wraps in double quotes, single quotes pass through safely
      assert.ok(result.includes(JSON.stringify(url)));
    });

    it('handles URLs with newlines (shouldn\'t happen but be safe)', () => {
      const url = 'file:///path\nwith\nnewlines';
      const result = injectCallback('', url);
      // JSON.stringify escapes newlines as \n
      assert.ok(result.includes('\\n'));
    });
  });

  describe('source map preservation', () => {
    it('injects BEFORE //# sourceMappingURL comment', () => {
      const source = 'const x = 1;\n//# sourceMappingURL=a.js.map\n';
      const result = injectCallback(source, 'file:///a.js');
      const callbackPos = result.indexOf('__esm_analyzer_import_done__');
      const sourceMapPos = result.indexOf('//# sourceMappingURL');
      assert.ok(callbackPos < sourceMapPos, 'Callback should be before source map URL');
    });

    it('injects BEFORE //@ sourceMappingURL (legacy form)', () => {
      const source = 'const x = 1;\n//@ sourceMappingURL=a.js.map\n';
      const result = injectCallback(source, 'file:///a.js');
      const callbackPos = result.indexOf('__esm_analyzer_import_done__');
      const sourceMapPos = result.indexOf('//@ sourceMappingURL');
      assert.ok(callbackPos < sourceMapPos);
    });

    it('preserves source map URL content exactly', () => {
      const sourceMapLine = '//# sourceMappingURL=data:application/json;base64,abc123';
      const source = 'const x = 1;\n' + sourceMapLine + '\n';
      const result = injectCallback(source, 'file:///a.js');
      assert.ok(result.includes(sourceMapLine));
    });

    it('handles source map URL with no trailing newline', () => {
      const source = 'const x = 1;\n//# sourceMappingURL=a.js.map';
      const result = injectCallback(source, 'file:///a.js');
      // Should still inject before (the regex requires \n before //)
      // If no \n before the sourceMappingURL, it won't match — callback goes at end
      assert.ok(result.includes('__esm_analyzer_import_done__'));
    });

    it('appends at end when no source map comment present', () => {
      const source = 'const x = 1;';
      const result = injectCallback(source, 'file:///a.js');
      assert.ok(result.endsWith('__esm_analyzer_import_done__("file:///a.js");\n'));
    });
  });

  describe('special source content', () => {
    it('source with $ characters not corrupted', () => {
      // String.replace with $1, $2 etc. interprets them as capture groups
      // Using split/join avoids this, but injectCallback uses replace for source maps
      const source = 'const price = "$100"; const re = /\\$[0-9]+/;\n//# sourceMappingURL=a.js.map\n';
      const result = injectCallback(source, 'file:///a.js');
      assert.ok(result.includes('const price = "$100"'), 'Dollar sign in source should be preserved');
      assert.ok(result.includes('/\\$[0-9]+/'), 'Dollar in regex should be preserved');
    });

    it('source with backtick template literals preserved', () => {
      const source = 'const msg = `hello ${name}`;';
      const result = injectCallback(source, 'file:///a.js');
      assert.ok(result.includes('`hello ${name}`'));
    });

    it('source with unicode characters preserved', () => {
      const source = 'const emoji = "🎉"; const kanji = "漢字";';
      const result = injectCallback(source, 'file:///a.js');
      assert.ok(result.includes('🎉'));
      assert.ok(result.includes('漢字'));
    });
  });
});

describe('format-based injection decision', () => {
  /**
   * The load hook decides whether to inject based on format and source:
   * - format 'json' → skip (JSON modules can't run JS)
   * - format 'wasm' → skip (WASM modules can't run JS)
   * - format 'module' + source → inject (ESM)
   * - format 'commonjs' + source → inject (CJS via import())
   * - format undefined + source → inject (CJS via require())
   * - source null + file:// URL → read from disk, then inject (CJS via import() with null source)
   * - source null + non-file URL (node:, data:) → skip (builtins, inline)
   */

  function shouldInject(format: string | undefined, sourceIsNull: boolean, url: string): boolean {
    if (format === 'json' || format === 'wasm') return false;
    if (!sourceIsNull) return true;
    if (url.startsWith('file://')) return true;  // will read from disk
    return false;
  }

  it('injects for ESM modules (format: module)', () => {
    assert.ok(shouldInject('module', false, 'file:///a.js'));
  });

  it('injects for CJS via import() (format: commonjs)', () => {
    assert.ok(shouldInject('commonjs', false, 'file:///a.js'));
  });

  it('injects for CJS via require() (format: undefined)', () => {
    assert.ok(shouldInject(undefined, false, 'file:///a.js'));
  });

  it('injects for CJS with null source by reading from disk (format: commonjs, file:// URL)', () => {
    assert.ok(shouldInject('commonjs', true, 'file:///a.js'));
  });

  it('skips JSON modules', () => {
    assert.ok(!shouldInject('json', false, 'file:///a.json'));
  });

  it('skips WASM modules', () => {
    assert.ok(!shouldInject('wasm', false, 'file:///a.wasm'));
  });

  it('skips builtins (null source, node: URL)', () => {
    assert.ok(!shouldInject('builtin', true, 'node:fs'));
  });

  it('skips data: URLs with null source', () => {
    assert.ok(!shouldInject('module', true, 'data:text/javascript,export default 1'));
  });
});
