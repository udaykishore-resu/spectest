/* Proves the generated tests really run: builds them from test/fixtures/shop.yaml in every target language,
   then runs them against a mock API that follows the contract (all must pass) and against one that breaks it
   (the tests that guard the broken rules must fail). Needs go, python3 + pytest + requests, node, bash + curl and javac. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('../extension/lib/js-yaml.min.js');
const Spec = require('../extension/lib/spec.js');
const Plan = require('../extension/lib/plan.js');
const Emit = require('../extension/lib/emit.js');

const ROOT = path.resolve(__dirname, '..');
const model = Spec.read(Spec.parseText(fs.readFileSync(path.join(__dirname, 'fixtures/shop.yaml'), 'utf8'), yaml));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-verify-'));
const have = (cmd) => spawnSync('bash', ['-c', 'command -v ' + cmd], { encoding: 'utf8' }).status === 0;

function startMock(broken) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/mock-server.js')], { env: Object.assign({}, process.env, { BROKEN: broken ? '1' : '0', PORT: '0' }) });
    child.stdout.on('data', (d) => {
      const m = /listening (\d+)/.exec(String(d));
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.on('error', reject);
  });
}

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 300000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const count = (out, re) => (out.match(re) || []).length;

const targets = {
  go: {
    tool: 'go',
    setup(dir, code) {
      fs.writeFileSync(path.join(dir, 'api_contract_test.go'), code);
      fs.writeFileSync(path.join(dir, 'go.mod'), 'module apitest\n\ngo 1.21\n');
      const fmt = run('gofmt', ['-l', '.'], dir, {});
      if (fmt.out.trim()) console.log('  note: gofmt would reformat the Go file');
      const vet = run('go', ['vet', './...'], dir, { GOFLAGS: '-mod=mod' });
      if (vet.code !== 0) throw new Error('go vet failed:\n' + vet.out);
    },
    exec: (dir, env) => run('go', ['test', '-count=1', '-v', './...'], dir, env),
    tally: (o) => ({ pass: count(o, /^\s*--- PASS/gm), fail: count(o, /^\s*--- FAIL/gm), skip: count(o, /^\s*--- SKIP/gm) }),
    failed: (o) => (o.match(/^\s*--- FAIL: (\S+)/gm) || []).map((l) => l.replace(/^\s*--- FAIL: /, '')),
  },
  python: {
    tool: 'python3',
    setup(dir, code) {
      fs.writeFileSync(path.join(dir, 'test_api_contract.py'), code);
    },
    exec: (dir, env) => run('python3', ['-m', 'pytest', '-q', '-rA', '-p', 'no:cacheprovider'], dir, env),
    tally: (o) => ({ pass: count(o, /^PASSED /gm), fail: count(o, /^FAILED /gm), skip: (o.match(/^SKIPPED \[(\d+)\]/gm) || []).reduce((n, l) => n + Number(/\[(\d+)\]/.exec(l)[1]), 0) }),
    failed: (o) => (o.match(/^FAILED \S+::(\w+)/gm) || []).map((l) => l.replace(/^FAILED \S+::/, '')),
  },
  javascript: {
    tool: 'node',
    setup(dir, code) {
      fs.writeFileSync(path.join(dir, 'api-contract.test.mjs'), code);
    },
    exec: (dir, env) => run(process.execPath, ['--test', '--test-reporter=tap', 'api-contract.test.mjs'], dir, env),
    tally: (o) => ({ pass: Number((/^# pass (\d+)/m.exec(o) || [])[1] || 0), fail: Number((/^# fail (\d+)/m.exec(o) || [])[1] || 0), skip: Number((/^# skipped (\d+)/m.exec(o) || [])[1] || 0) }),
    failed: (o) => (o.match(/^not ok \d+ - (.*)$/gm) || []).map((l) => l.replace(/^not ok \d+ - /, '')),
  },
  curl: {
    tool: 'curl',
    setup(dir, code) {
      fs.writeFileSync(path.join(dir, 'api-contract.sh'), code);
    },
    exec: (dir, env) => run('bash', ['api-contract.sh'], dir, env),
    tally: (o) => ({ pass: count(o, /^PASS /gm), fail: count(o, /^FAIL /gm), skip: count(o, /^SKIP /gm) }),
    failed: (o) => (o.match(/^FAIL (.*?): status/gm) || []).map((l) => l.replace(/^FAIL /, '').replace(/: status$/, '')),
  },
  java: {
    tool: 'javac',
    setup(dir, code) {
      fs.writeFileSync(path.join(dir, 'ApiContractTest.java'), code);
      const standin = path.join(__dirname, 'junit-standin');
      const files = ['ApiContractTest.java', path.join(standin, 'Runner.java')].concat(
        ['Test', 'Assertions', 'Assumptions'].map((n) => path.join(standin, 'org/junit/jupiter/api', n + '.java'))
      );
      const c = run('javac', ['-Xlint:all', '-d', 'out'].concat(files), dir, {});
      if (c.code !== 0) throw new Error('javac failed:\n' + c.out);
      if (/warning/.test(c.out)) console.log('  javac warnings:\n' + c.out.split('\n').slice(0, 8).join('\n'));
    },
    exec: (dir, env) => run('java', ['-cp', 'out', 'Runner', 'ApiContractTest'], dir, env),
    tally: (o) => ({ pass: count(o, /^PASS /gm), fail: count(o, /^FAIL /gm), skip: count(o, /^SKIP /gm) }),
    failed: (o) => (o.match(/^FAIL (\w+)/gm) || []).map((l) => l.replace(/^FAIL /, '')),
  },
};

/* Second check: text that is awkward to quote (quotes, backslashes, $, backticks, newlines, non-ASCII, emoji)
   must reach the server byte for byte from every language. A recording server compares what arrived with the plan. */
async function exactBytes() {
  const nasty = 'He said "hi" \\ back`tick` $HOME ${x} \'single\' é中 😀   end\nnext line \\u0041 %s {{y}}';
  const note = 'it\'s "quoted" $x \\ `b` %d';
  const model2 = Spec.read({
    openapi: '3.0.3',
    info: { title: nasty, version: '1' },
    security: [{ k: [] }],
    components: { securitySchemes: { k: { type: 'apiKey', in: 'header', name: 'X-Key' } } },
    paths: {
      '/echo/{id}': {
        put: {
          operationId: 'echo',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'a b/c\'d"e' } },
            { name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'x&y=z é' } },
            { name: 'X-Note', in: 'header', required: true, schema: { type: 'string', example: note } },
          ],
          requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['text', 'n'], properties: { text: { type: 'string', example: nasty }, n: { type: 'integer' } } } } } },
          responses: { 200: { description: 'ok' }, 404: { description: 'none' } },
        },
      },
      // No newline, backtick or single quote here, so the unescaped literal forms are used where a language has them.
      '/raw': { post: { operationId: 'raw', parameters: [{ name: 'X-Note', in: 'header', required: true, schema: { type: 'string', example: note } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['p'], properties: { p: { type: 'string', example: 'C:\\dir\\file "q" \u00e9 \ud83d\ude00 \\u0041 100% $x' } } } } } }, responses: { 200: { description: 'ok' } } } },
    },
  });
  // The recorder is its own process: the test commands below run synchronously and would block a server in this one.
  const log = path.join(work, 'received.jsonl');
  const rec = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/record-server.js')], { env: Object.assign({}, process.env, { RECORD_FILE: log }) });
    child.stdout.on('data', (d) => {
      const m = /listening (\d+)/.exec(String(d));
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.on('error', reject);
  });
  const port = rec.port;
  const plan = Plan.build(model2, { baseUrl: 'http://127.0.0.1:' + port });
  const want = plan.cases.map((c) => [c.method, c.path, c.body ? c.contentType : '', c.body || '', note, c.auth ? 'tok' : ''].join('\n')).sort();
  let bad = 0;
  console.log('\nawkward text, byte for byte (' + plan.cases.length + ' requests per target):');
  for (const id of Object.keys(targets)) {
    const t = targets[id];
    if (!have(t.tool)) continue;
    const dir = path.join(work, 'exact-' + id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(log, '');
    t.setup(dir, Emit.emit(id, plan).code);
    t.exec(dir, { API_BASE_URL: 'http://127.0.0.1:' + port, API_TOKEN: 'tok' });
    const got = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort();
    const same = got.length === want.length && got.every((g, i) => g === want[i]);
    console.log('  ' + id.padEnd(11) + (same ? 'identical' : 'DIFFERENT'));
    if (!same) {
      bad++;
      for (let i = 0; i < Math.max(got.length, want.length); i++) if (got[i] !== want[i]) console.log('    want ' + JSON.stringify(want[i]) + '\n    got  ' + JSON.stringify(got[i]));
    }
  }
  rec.child.kill();
  return bad;
}

(async () => {
  const good = await startMock(false);
  const bad = await startMock(true);
  let problems = 0;
  const rows = [];
  try {
    for (const id of Object.keys(targets)) {
      const t = targets[id];
      if (!have(t.tool)) {
        console.log(id + ': skipped, ' + t.tool + ' is not installed');
        continue;
      }
      const dir = path.join(work, id);
      fs.mkdirSync(dir, { recursive: true });
      const plan = Plan.build(model, { baseUrl: 'http://127.0.0.1:' + good.port });
      const out = Emit.emit(id, plan);
      console.log(id + ': ' + plan.cases.length + ' cases -> ' + out.file);
      t.setup(dir, out.code);
      const env = (port, token) => ({ API_BASE_URL: 'http://127.0.0.1:' + port, API_TOKEN: token });
      const a = t.exec(dir, env(good.port, 'test-token'));
      const ta = t.tally(a.out);
      const b = t.exec(dir, env(bad.port, 'test-token'));
      const tb = t.tally(b.out);
      const c = t.exec(dir, env(good.port, ''));
      const tc = t.tally(c.out);
      rows.push({ id, cases: plan.cases.length, good: ta, broken: tb, noToken: tc });
      if (process.env.VERBOSE) console.log(a.out, '\n-----\n', b.out);
      if (a.code !== 0 || ta.fail !== 0 || ta.pass !== plan.cases.length) {
        problems++;
        console.log('  PROBLEM: against the correct API expected ' + plan.cases.length + ' passes, got', ta, '\n' + a.out.slice(-3000));
      }
      if (b.code === 0 || tb.fail === 0) {
        problems++;
        console.log('  PROBLEM: against the broken API nothing failed\n' + b.out.slice(-2000));
      } else console.log('  broken API: failed -> ' + t.failed(b.out).join(', '));
      if (tc.fail !== 0 || tc.skip === 0) {
        problems++;
        console.log('  PROBLEM: without a token expected skips and no failures, got', tc, '\n' + c.out.slice(-2000));
      }
    }
  } finally {
    good.child.kill();
    bad.child.kill();
  }
  problems += await exactBytes();
  console.log('\ntarget      cases  correct API (pass/fail/skip)  broken API (pass/fail/skip)  no token (pass/fail/skip)');
  for (const r of rows) {
    const f = (t) => (t.pass + '/' + t.fail + '/' + t.skip).padEnd(28);
    console.log(r.id.padEnd(12) + String(r.cases).padEnd(7) + f(r.good) + '  ' + f(r.broken) + ' ' + f(r.noToken));
  }
  console.log(problems ? '\n' + problems + ' problem(s)' : '\nAll targets behave as expected.');
  process.exit(problems ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
