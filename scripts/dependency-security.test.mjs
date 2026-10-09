import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const braces = require('braces');

const nested = (open, close, depth) => open.repeat(depth) + 'a' + close.repeat(depth);
const isDepthGuard = error => error instanceof SyntaxError && /nesting exceeds maximum depth 128/.test(error.message);

for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  test(`braces.${method} rejects nested input before stack exhaustion`, () => {
    assert.throws(() => braces[method](nested('{', '}', 4500)), isDepthGuard);
    assert.throws(() => braces[method](nested('(', ')', 4500)), isDepthGuard);
    assert.throws(() => braces[method](nested('{', '}', 129), { maxDepth: Infinity }), isDepthGuard);
    assert.doesNotThrow(() => braces[method](nested('{', '}', 128)));
  });
}

test('braces preserves ordinary compile, expansion and escaped literals', () => {
  assert.equal(braces.compile('src/{a,b}.js'), 'src/(a|b).js');
  assert.deepEqual(braces.expand('{1..3}'), ['1', '2', '3']);
  assert.deepEqual(braces.expand('a/{b,{c,d}}'), ['a/b', 'a/c', 'a/d']);
  assert.equal(braces.stringify(braces.parse('a/{b,c}')), 'a/{b,c}');
  assert.doesNotThrow(() => braces.compile('\\{'.repeat(500)));
  assert.doesNotThrow(() => braces.compile('"' + '{'.repeat(500) + '"'));
});

test('braces walkers also guard caller-supplied deeply nested ASTs', () => {
  function ast() {
    let node = { type: 'text', value: 'a' };
    for (let i = 0; i < 300; i++) node = { type: 'root', nodes: [node] };
    return node;
  }
  for (const method of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method](ast()), isDepthGuard);
  }
});

for (const entry of ['sprintf-js', 'sprintf-js/dist/sprintf.min.js']) {
  const { sprintf, vsprintf } = require(entry);
  test(`${entry} bounds excessive precision without numeric RangeError`, () => {
    for (const type of ['f', 'e', 'g']) {
      for (const precision of ['101', '999999999', '9'.repeat(400)]) {
        assert.equal(sprintf(`%.${precision}${type}`, 1), sprintf(`%.100${type}`, 1));
      }
    }
    assert.equal(sprintf('%.0g', 1.23), sprintf('%.1g', 1.23));
  });
  test(`${entry} preserves valid formats, names, positions and arrays`, () => {
    assert.equal(sprintf('%.2f', 1.234), '1.23');
    assert.equal(sprintf('%.0f', 1.6), '2');
    assert.equal(sprintf('%.2e', 12), '1.20e+1');
    assert.equal(sprintf('%.3g', 12.345), '12.3');
    assert.equal(sprintf('%d %s', 4, 'x'), '4 x');
  });
  test(`${entry} keeps supported named and positional modes separate`, () => {
    assert.equal(sprintf('%(name)s', { name: 'x' }), 'x');
    assert.equal(vsprintf('%s:%d', ['x', 4]), 'x:4');
    assert.equal(sprintf('%2$s:%1$d', 4, 'x'), 'x:4');
    assert.equal(sprintf('%08d', 42), '00000042');
    assert.equal(sprintf('%.3s', 'abcdef'), 'abc');
  });
}
