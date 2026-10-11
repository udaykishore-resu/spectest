const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../extension/lib/detect.js');

const dir = path.join(__dirname, 'fixtures/code');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('each sample is recognised as its language, with confidence', () => {
  const want = {
    'sample.go': 'go', 'Sample.java': 'java', 'sample.kt': 'kotlin', 'sample.scala': 'scala', 'sample.py': 'python',
    'sample.ts': 'typescript', 'sample.js': 'javascript', 'sample.cs': 'csharp', 'sample.rs': 'rust', 'sample.rb': 'ruby',
    'sample.php': 'php', 'sample.swift': 'swift', 'sample.cpp': 'cpp', 'sample.c': 'c',
  };
  assert.equal(fs.readdirSync(dir).length, Object.keys(want).length, 'every fixture is listed here');
  for (const [file, id] of Object.entries(want)) {
    const c = D.classify(read(file));
    assert.equal(c.kind, 'code', file);
    assert.equal(c.language && c.language.id, id, file + ' was taken for ' + (c.language && c.language.id));
    assert.equal(c.language.confidence, 'high', file);
  }
});

test('test files are named after the main class or function, the way each ecosystem names them', () => {
  const want = {
    'sample.go': 'discount_test.go', 'Sample.java': 'PriceCalculatorTest.java', 'sample.kt': 'DiscountTest.kt',
    'sample.scala': 'PricingSpec.scala', 'sample.py': 'test_discount.py', 'sample.ts': 'total.test.ts', 'sample.js': 'total.test.js',
    'sample.cs': 'PriceCalculatorTests.cs', 'sample.rs': 'discount_tests.rs', 'sample.rb': 'price_calculator_spec.rb',
    'sample.php': 'PriceCalculatorTest.php', 'sample.swift': 'PriceCalculatorTests.swift', 'sample.cpp': 'discount_test.cpp', 'sample.c': 'test_discount.c',
  };
  for (const [file, name] of Object.entries(want)) {
    const t = read(file);
    assert.equal(D.testFileName(D.classify(t).language.id, t), name, file);
  }
});

test('contracts, prose and empty text are told apart from code', () => {
  assert.equal(D.classify(fs.readFileSync(path.join(__dirname, 'fixtures/shop.yaml'), 'utf8')).kind, 'contract');
  assert.equal(D.classify('{"openapi":"3.1.0","info":{"title":"x","version":"1"},"paths":{}}').kind, 'contract');
  assert.equal(D.classify('  \n ').kind, 'empty');
  assert.equal(D.classify('Hello there, can you meet tomorrow at 5? Thanks.').kind, 'text');
  assert.equal(D.classify('https://github.com/acme/shop').kind, 'text');
  assert.equal(D.classify('openapi is a nice spec format and the paths are clear.').kind, 'text');
});

test('a file name decides the language when there is one', () => {
  assert.equal(D.classify('x = compute(1)\nprint(x)\n', 'calc.py').language.id, 'python');
  assert.equal(D.classify('val x = 1\n', 'Build.kts').language.id, 'kotlin');
  assert.equal(D.classify('int add(int a, int b) { return a + b; }', 'add.h').language.id, 'c');
  assert.equal(D.languageFromFileName('notes.txt'), null);
});

test('short or unclear snippets still count as code when they look like code', () => {
  const c = D.classify('if (a > b) {\n  return a;\n}\nreturn b;');
  assert.equal(c.kind, 'code');
  assert.equal(D.classify('x').kind, 'text');
});
