import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the template substitution logic used in generator.ts.
 *
 * The report generator uses split/join instead of String.replace to avoid
 * $-substitution issues. This is critical because the JS source files
 * being inlined may contain $1, $&, $`, $' etc. which String.replace
 * would interpret as special replacement patterns.
 */

// Reproduce the templateReplace logic from generator.ts
function templateReplace(html: string, placeholder: string, value: string): string {
  return html.split(placeholder).join(value);
}

describe('templateReplace (split/join substitution)', () => {
  it('replaces a placeholder with a value', () => {
    const result = templateReplace('Hello {{NAME}}!', '{{NAME}}', 'World');
    assert.equal(result, 'Hello World!');
  });

  it('replaces multiple occurrences of the same placeholder', () => {
    const result = templateReplace('{{X}} and {{X}}', '{{X}}', 'A');
    assert.equal(result, 'A and A');
  });

  it('preserves $1, $2 etc. in replacement value (unlike String.replace)', () => {
    // This is the whole reason split/join is used instead of String.replace
    const jsCode = 'var x = str.replace(/(a)(b)/, "$1-$2");';
    const result = templateReplace('{{CODE}}', '{{CODE}}', jsCode);
    assert.equal(result, jsCode, '$1 and $2 should not be interpreted');
  });

  it('preserves $& in replacement value', () => {
    const jsCode = 'var x = "$&";';
    const result = templateReplace('{{CODE}}', '{{CODE}}', jsCode);
    assert.equal(result, jsCode);
  });

  it('preserves $` and $\' in replacement value', () => {
    const jsCode = "var x = \"$`$'\";";
    const result = templateReplace('{{CODE}}', '{{CODE}}', jsCode);
    assert.equal(result, jsCode);
  });

  it('handles empty replacement value', () => {
    const result = templateReplace('before{{X}}after', '{{X}}', '');
    assert.equal(result, 'beforeafter');
  });

  it('no-op when placeholder not found', () => {
    const result = templateReplace('Hello World', '{{MISSING}}', 'value');
    assert.equal(result, 'Hello World');
  });

  it('handles JSON data with special characters', () => {
    const data = JSON.stringify({ path: 'file:///a.js', name: '<script>alert("xss")</script>' });
    const result = templateReplace('<div>{{DATA}}</div>', '{{DATA}}', data);
    assert.ok(result.includes(data));
  });

  it('handles large replacement values (CSS + JS inlining)', () => {
    const largeCSS = '.a { color: red; }\n'.repeat(1000);
    const result = templateReplace('<style>{{STYLES}}</style>', '{{STYLES}}', largeCSS);
    assert.ok(result.length > largeCSS.length);
    assert.ok(result.startsWith('<style>'));
    assert.ok(result.endsWith('</style>'));
  });
});
