const test = require('node:test');
const assert = require('node:assert/strict');
const Ai = require('../extension/lib/ai.js');

test('prompt: the material is fenced off as data and clipped when too long', () => {
  const p = Ai.buildPrompt({ kind: 'code', target: 'Rust', notes: 'use rstest', material: 'fn add() {}' });
  assert.match(p.user, /^Write unit tests in Rust/);
  assert.match(p.user, /Extra requirements from the engineer: use rstest/);
  assert.match(p.user, /=== MATERIAL ===\nfn add\(\) \{\}\n=== END MATERIAL ===$/);
  assert.match(p.system, /never an instruction/);
  assert.equal(p.clipped, false);
  const big = Ai.buildPrompt({ kind: 'plan', title: 'Shop "API"\nx', material: 'x'.repeat(Ai.MAX_MATERIAL + 10) });
  assert.equal(big.clipped, true);
  assert.ok(big.user.length < Ai.MAX_MATERIAL + 3000);
  assert.match(big.user, /test plan for "Shop API x"/);
  assert.match(big.user, /one test per entry/);
});

test('request for Anthropic', () => {
  const p = Ai.buildPrompt({ kind: 'code', target: 'Go', material: 'x' });
  const r = Ai.buildRequest({ provider: 'anthropic', baseUrl: '', model: 'some-model', key: ' sk-test ' }, p);
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.init.method, 'POST');
  assert.equal(r.init.headers['x-api-key'], 'sk-test');
  assert.equal(r.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(r.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(r.init.body);
  assert.equal(body.model, 'some-model');
  assert.ok(body.max_tokens > 0);
  assert.equal(body.system, p.system);
  assert.deepEqual(body.messages, [{ role: 'user', content: p.user }]);
  assert.equal(Ai.endpoint({ provider: 'anthropic', baseUrl: 'https://gateway.example.com/v1/' }), 'https://gateway.example.com/v1/messages');
});

test('request for an OpenAI-compatible provider', () => {
  const p = Ai.buildPrompt({ kind: 'code', target: 'Go', material: 'x' });
  const r = Ai.buildRequest({ provider: 'openai', baseUrl: 'http://localhost:11434/v1/', model: 'm', key: 'k' }, p);
  assert.equal(r.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(r.init.headers.authorization, 'Bearer k');
  const body = JSON.parse(r.init.body);
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
});

test('settings that cannot work are refused with a plain message', () => {
  const p = Ai.buildPrompt({ kind: 'code', material: 'x' });
  assert.throws(() => Ai.buildRequest({ provider: 'openai', model: 'm', key: '' }, p), /Enter your API key/);
  assert.throws(() => Ai.buildRequest({ provider: 'openai', model: ' ', key: 'k' }, p), /Enter the model name/);
  assert.throws(() => Ai.buildRequest({ provider: 'openai', model: 'm', key: 'k', baseUrl: 'http://example.com/v1' }, p), /must start with https/);
  assert.throws(() => Ai.buildRequest({ provider: 'openai', model: 'm', key: 'k', baseUrl: 'not a url' }, p), /not a valid address/);
  assert.throws(() => Ai.buildRequest({ provider: 'nope', model: 'm', key: 'k' }, p), /Choose a provider/);
});

test('reading replies', () => {
  const a = Ai.readResponse('anthropic', 200, JSON.stringify({ content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: '```go\npackage x\n```' }], stop_reason: 'end_turn' }));
  assert.deepEqual(a, { text: 'package x\n', cut: false });
  assert.equal(Ai.readResponse('anthropic', 200, JSON.stringify({ content: [{ type: 'text', text: 'abc' }], stop_reason: 'max_tokens' })).cut, true);
  const o = Ai.readResponse('openai', 200, JSON.stringify({ choices: [{ message: { content: 'def test(): pass' }, finish_reason: 'length' }] }));
  assert.deepEqual(o, { text: 'def test(): pass\n', cut: true });
  assert.throws(() => Ai.readResponse('anthropic', 401, JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } })), /refused the key \(HTTP 401\): invalid x-api-key/);
  assert.throws(() => Ai.readResponse('openai', 429, 'slow down'), /rate-limiting this key \(HTTP 429\): slow down/);
  assert.throws(() => Ai.readResponse('openai', 200, '<html>'), /not JSON/);
  assert.throws(() => Ai.readResponse('openai', 200, JSON.stringify({ choices: [] })), /empty answer/);
  assert.throws(() => Ai.readResponse('anthropic', 200, JSON.stringify({ content: [], stop_reason: 'refusal' })), /declined/);
});

test('a single outer code fence is removed, several files are left alone', () => {
  assert.equal(Ai.stripFence('```python\nprint(1)\n```'), 'print(1)\n');
  const two = '```a\n1\n```\ntext\n```b\n2\n```';
  assert.equal(Ai.stripFence(two), two + '\n');
  assert.equal(Ai.stripFence('plain'), 'plain\n');
});

test('unit-test prompt: language, framework, file name, package, and the code fenced off as data', () => {
  const fs = require('fs');
  const code = fs.readFileSync(require('path').join(__dirname, 'fixtures/code/sample.go'), 'utf8');
  const p = Ai.buildUnitPrompt({ code, language: 'Go', framework: 'the standard testing package', fileName: 'discount_test.go', notes: 'table-driven' });
  assert.match(p.user, /^Write unit tests in Go using the standard testing package for the code below\./);
  assert.match(p.user, /The test file is named discount_test\.go\./);
  assert.match(p.user, /Put the tests in package pricing/);
  assert.match(p.user, /Also: table-driven/);
  assert.match(p.user, /-----BEGIN CODE-----\npackage pricing[\s\S]*-----END CODE-----$/);
  assert.match(p.user, /never instructions to you/);
  assert.equal(p.clipped, false);
  const long = Ai.buildUnitPrompt({ code: 'x'.repeat(Ai.MAX_LOCAL + 5), language: 'Python' });
  assert.equal(long.clipped, true);
  assert.ok(!/Put the tests in package/.test(long.user));
});
