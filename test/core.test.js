const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('../extension/lib/js-yaml.min.js');
const Spec = require('../extension/lib/spec.js');
const Plan = require('../extension/lib/plan.js');
const Emit = require('../extension/lib/emit.js');

const shopText = fs.readFileSync(path.join(__dirname, 'fixtures/shop.yaml'), 'utf8');
const shop = () => Spec.read(Spec.parseText(shopText, yaml));
const find = (plan, name) => plan.cases.find((c) => c.words.join('_') === name);
const doc3 = (paths, extra) => Object.assign({ openapi: '3.0.3', info: { title: 'T', version: '1' }, paths }, extra || {});

test('YAML and JSON give the same model', () => {
  const a = shop();
  const b = Spec.read(Spec.parseText(JSON.stringify(yaml.load(shopText)), yaml));
  assert.equal(a.operations.length, 10);
  assert.deepEqual(a.operations.map((o) => o.id), b.operations.map((o) => o.id));
  assert.equal(a.kind, 'OpenAPI 3.0.3');
  assert.deepEqual(a.servers, ['http://localhost:8080']);
  assert.deepEqual(Object.keys(a.schemes), ['bearerAuth', 'reportKey']);
});

test('a document inside a fenced block of a markdown page is found', () => {
  const md = '# API\n\nSome words.\n\n```yaml\n' + shopText + '```\n\nMore words.\n';
  assert.equal(Spec.read(Spec.parseText(md, yaml)).operations.length, 10);
});

test('clear errors for things that are not contracts', () => {
  assert.throws(() => Spec.parseText('', yaml), /no text/);
  assert.throws(() => Spec.parseText('{"a": ', yaml), /JSON does not parse/);
  assert.throws(() => Spec.parseText('{"a": 1}', yaml), /no "openapi" or "swagger"/);
  assert.throws(() => Spec.parseText('just: [unclosed', yaml), /YAML does not parse/);
  assert.throws(() => Spec.parseText('openapi: 3.1.0\ninfo: {title: x, version: "1"}\nwebhooks: {}', yaml), /no paths/);
  assert.throws(() => Spec.read(Spec.parseText('openapi: 3.0.0\npaths:\n  /a: {}', yaml)), /no operations/);
});

test('YAML dates and numeric response codes stay as written', () => {
  const m = Spec.read(Spec.parseText('openapi: 3.0.0\ninfo: {title: x, version: 2024-01-15}\npaths:\n  /a:\n    get:\n      responses:\n        200: {description: ok}\n', yaml));
  assert.equal(m.version, '2024-01-15');
  assert.deepEqual(Object.keys(m.operations[0].responses), ['200']);
});

test('Swagger 2: host, body parameter, form fields, security definitions', () => {
  const m = Spec.read({
    swagger: '2.0',
    info: { title: 'Old', version: '1' },
    host: 'api.example.com',
    basePath: '/v2/',
    schemes: ['http', 'https'],
    securityDefinitions: { basic: { type: 'basic' }, key: { type: 'apiKey', in: 'header', name: 'X-Key' }, weird: { type: 'mutualTLS' } },
    security: [{ key: [] }],
    paths: {
      '/pets': {
        post: {
          parameters: [{ in: 'body', name: 'pet', required: true, schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } }],
          responses: { 201: { description: 'made', schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } }, 400: { description: 'bad' } },
        },
        get: { parameters: [{ in: 'query', name: 'limit', type: 'integer', minimum: 1, required: true }], security: [{ basic: [] }], responses: { 200: { description: 'ok' } } },
      },
      '/login': { post: { consumes: ['application/x-www-form-urlencoded'], parameters: [{ in: 'formData', name: 'user', type: 'string', required: true }], security: [], responses: { 200: { description: 'ok' } } } },
      '/upload': { post: { consumes: ['multipart/form-data'], parameters: [{ in: 'formData', name: 'f', type: 'file' }], responses: { 200: { description: 'ok' } } } },
    },
  });
  assert.deepEqual(m.servers, ['https://api.example.com/v2']);
  assert.equal(m.schemes.key.name, 'X-Key');
  assert.equal(m.schemes.basic.prefix, 'Basic ');
  assert.ok(m.warnings.some((w) => /"weird"/.test(w)));
  const plan = Plan.build(m, {});
  assert.equal(find(plan, 'post_pets_ok').body, '{"name":"string"}');
  assert.equal(find(plan, 'post_pets_ok').auth, 'key');
  assert.deepEqual(find(plan, 'post_pets_ok').expect.json, { code: 201, kind: 'object', fields: [{ name: 'id', type: 'integer' }] });
  assert.equal(find(plan, 'get_pets_ok').path, '/pets?limit=1');
  assert.equal(find(plan, 'get_pets_ok').auth, 'basic');
  assert.equal(find(plan, 'get_pets_invalid_query_limit').path, '/pets?limit=0');
  assert.equal(find(plan, 'post_login_ok').body, 'user=string');
  assert.equal(find(plan, 'post_login_ok').contentType, 'application/x-www-form-urlencoded');
  assert.equal(find(plan, 'post_upload_ok').body, null);
  assert.ok(m.warnings.some((w) => /multipart/.test(w)));
});

test('references: recursive schemas end, missing and external ones are reported', () => {
  const m = Spec.read(
    doc3(
      {
        '/tree': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } }, responses: { 200: { $ref: '#/components/responses/Gone' }, 201: { description: 'x', content: { 'application/json': { schema: { $ref: 'other.yaml#/X' } } } } } } },
      },
      { components: { schemas: { Node: { type: 'object', required: ['name', 'children'], properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } } } } }
    )
  );
  const plan = Plan.build(m, {});
  assert.equal(find(plan, 'post_tree_ok').body, '{"name":"string","children":[]}');
  assert.ok(m.warnings.some((w) => /not found in this document: #\/components\/responses\/Gone/.test(w)));
});

test('sample values respect the limits the schema sets', () => {
  const s = (schema) => Spec.sample({}, schema, { mode: 'request' });
  assert.equal(s({ type: 'integer', minimum: 5 }), 5);
  assert.equal(s({ type: 'integer', minimum: 5, exclusiveMinimum: true }), 6);
  assert.equal(s({ type: 'integer', exclusiveMinimum: 5 }), 6);
  assert.equal(s({ type: 'integer', maximum: -3 }), -3);
  assert.equal(s({ type: 'number', minimum: 0.5, maximum: 0.75 }), 0.5);
  assert.equal(s({ type: 'integer', minimum: 7, multipleOf: 5 }), 10);
  assert.equal(s({ type: 'string', minLength: 10 }).length, 10);
  assert.equal(s({ type: 'string', maxLength: 3 }), 'str');
  assert.equal(s({ type: 'string', format: 'uuid' }), '3fa85f64-5717-4562-b3fc-2c963f66afa6');
  assert.equal(s({ type: ['string', 'null'], format: 'date' }), '2024-01-15');
  assert.equal(s({ enum: ['b', 'a'] }), 'b');
  assert.equal(s({ type: 'string', example: 'given' }), 'given');
  assert.deepEqual(s({ type: 'array', items: { type: 'boolean' } }), [true]);
  assert.deepEqual(s({ allOf: [{ type: 'object', required: ['a'], properties: { a: { type: 'integer' } } }, { required: ['b'], properties: { b: { type: 'string' }, c: { type: 'string' } } }] }), { a: 1, b: 'string' });
  assert.deepEqual(s({ type: 'object', required: ['id', 'n'], properties: { id: { type: 'integer', readOnly: true }, n: { type: 'string' } } }), { n: 'string' });
  assert.deepEqual(s({ type: 'object', properties: { a: { type: 'integer' }, b: { type: 'string' } } }), { a: 1, b: 'string' });
  assert.equal(s({ oneOf: [{ type: 'null' }, { type: 'integer', minimum: 3 }] }), 3);
});

test('the plan for the sample contract', () => {
  const plan = Plan.build(shop(), {});
  assert.equal(plan.cases.length, 33);
  assert.equal(plan.operations, 10);
  assert.equal(new Set(plan.cases.map((c) => c.words.join('_'))).size, 33, 'test names are unique');
  const count = (k) => plan.cases.filter((c) => c.kind === k).length;
  assert.deepEqual([count('ok'), count('missing'), count('type'), count('invalid'), count('auth'), count('notfound')], [10, 7, 2, 3, 8, 3]);

  const ok = find(plan, 'create_item_ok');
  assert.deepEqual(JSON.parse(ok.body), { name: 'Blue widget', price: 9.5 });
  assert.deepEqual(ok.expect.status, [201]);
  assert.deepEqual(ok.expect.json, { code: 201, kind: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'price', type: 'number' }, { name: 'id', type: 'integer' }] });
  assert.equal(ok.auth, 'bearerAuth');

  assert.deepEqual(JSON.parse(find(plan, 'create_item_missing_name').body), { price: 9.5 });
  assert.deepEqual(find(plan, 'create_item_missing_name').expect, { status: [400], assumed: false, json: null });
  assert.equal(JSON.parse(find(plan, 'create_item_wrong_type_price').body).price, 'not-a-number');
  assert.equal(JSON.parse(find(plan, 'create_item_invalid_name').body).name.length, 51);
  assert.equal(find(plan, 'list_items_ok').path, '/items');
  assert.equal(find(plan, 'list_items_ok').expect.json.kind, 'array');
  assert.equal(find(plan, 'list_items_invalid_query_limit').path, '/items?limit=0');
  assert.equal(find(plan, 'get_item_ok').path, '/items/1');
  assert.equal(find(plan, 'get_item_not_found').path, '/items/999999999');
  assert.deepEqual(find(plan, 'get_item_not_found').expect.status, [404]);
  assert.equal(find(plan, 'get_item_no_credentials').auth, '');
  assert.deepEqual(find(plan, 'get_item_no_credentials').expect.status, [401]);
  assert.deepEqual(find(plan, 'delete_item_ok').expect, { status: [204], assumed: false, json: null });
  assert.equal(find(plan, 'delete_item_no_credentials').expect.assumed, true);
  assert.deepEqual(find(plan, 'delete_item_no_credentials').expect.status, [401, 403]);
  assert.equal(find(plan, 'search_items_ok').path, '/search?q=widget');
  assert.equal(find(plan, 'search_items_missing_query_q').path, '/search');
  assert.equal(find(plan, 'get_report_ok').auth, 'reportKey');
  assert.deepEqual(find(plan, 'get_tenant_ok').headers, [['X-Tenant', 'acme']]);
  assert.equal(find(plan, 'get_health_ok').auth, '');
  assert.equal(find(plan, 'login_ok').body, "username=sam%20o'neil&password=S3cure-pass!");
  assert.equal(find(plan, 'login_missing_username').body, 'password=S3cure-pass!');
  assert.deepEqual(Object.keys(plan.auth), ['bearerAuth', 'reportKey']);
  assert.ok(plan.notes.some((n) => /assumption/.test(n)));
});

test('choosing kinds, operations and the base address', () => {
  const m = shop();
  const only = Plan.build(m, { kinds: { missing: false, type: false, invalid: false, auth: false, notfound: false }, only: new Set(['getItem', 'getHealth']), baseUrl: 'https://staging.example.com/api///' });
  assert.deepEqual(only.cases.map((c) => c.words.join('_')), ['get_health_ok', 'get_item_ok']);
  assert.equal(only.baseUrl, 'https://staging.example.com/api');
  const sub = Plan.subset(Plan.build(m, {}), (c) => c.op === 'getReport');
  assert.deepEqual(Object.keys(sub.auth), ['reportKey']);
  assert.equal(sub.operations, 1);
});

test('operations without an operationId get readable, unique names', () => {
  const m = Spec.read(doc3({ '/users/{user-id}/keys': { get: { responses: { 200: { description: 'ok' } } }, post: { responses: { 200: { description: 'ok' } } } }, '/users/{user_id}/keys': { get: { responses: { 200: { description: 'ok' } } } } }));
  const names = Plan.build(m, {}).cases.map((c) => c.words.join('_'));
  assert.deepEqual(names, ['get_users_by_user_id_keys_ok', 'post_users_by_user_id_keys_ok', 'get_users_by_user_id_keys_ok_2']);
});

test('a response that may take several shapes gets no field checks', () => {
  const m = Spec.read(doc3({ '/x': { get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { oneOf: [{ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }, { type: 'object', required: ['b'], properties: { b: { type: 'string' } } }] } } } } } } } }));
  assert.equal(Plan.build(m, {}).cases[0].expect.json, null);
});

test('every target lists every case, and awkward text stays valid code', (t) => {
  const nasty = 'He said "hi" \\ back`tick` $HOME ${x} \'single\' \u00e9\u4e2d \u2028 end\nnext line \\u0041 %s';
  const m = Spec.read(
    doc3(
      {
        '/echo/{id}': {
          put: {
            operationId: 'echo',
            summary: nasty,
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: "a b/c'd\"e" } }, { name: 'X-Note', in: 'header', required: true, schema: { type: 'string', example: nasty } }],
            requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', example: nasty } } } } } },
            responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['te"xt'], properties: { 'te"xt': { type: 'string' } } } } } }, 404: { description: 'none' } },
          },
        },
      },
      { info: { title: nasty, version: '1' }, security: [{ k: [] }], components: { securitySchemes: { k: { type: 'apiKey', in: 'query', name: "api key'" } } } }
    )
  );
  const plan = Plan.build(m, {});
  assert.ok(plan.cases.length >= 4);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-emit-'));
  const checks = { javascript: ['node', ['--check']], python: ['python3', ['-m', 'py_compile']], curl: ['bash', ['-n']] };
  for (const target of Emit.TARGETS) {
    const out = Emit.emit(target.id, plan);
    assert.ok(out.file && out.code.endsWith('\n'), target.id);
    if (target.id === 'plan') {
      assert.equal(JSON.parse(out.code).cases.length, plan.cases.length);
      continue;
    }
    if (target.id !== 'curl') assert.ok(!/[\u2028\u2029]/.test(out.code), target.id + ': no raw line separators');
    const file = path.join(dir, out.file);
    fs.writeFileSync(file, out.code);
    const c = checks[target.id];
    if (c && spawnSync('bash', ['-c', 'command -v ' + c[0]]).status === 0) {
      const r = spawnSync(c[0], c[1].concat(file), { encoding: 'utf8' });
      assert.equal(r.status, 0, target.id + ' does not parse:\n' + r.stdout + r.stderr);
    } else if (c) t.diagnostic(target.id + ': ' + c[0] + ' not installed, syntax not checked');
  }
  const go = Emit.emit('go', plan).code;
  assert.equal((go.match(/^func Test/gm) || []).length, plan.cases.length);
  assert.equal((Emit.emit('python', plan).code.match(/^def test_/gm) || []).length, plan.cases.length);
  assert.equal((Emit.emit('java', plan).code.match(/^ {2}@Test$/gm) || []).length, plan.cases.length);
  assert.equal((Emit.emit('javascript', plan).code.match(/^test\(/gm) || []).length, plan.cases.length);
  assert.equal((Emit.emit('curl', plan).code.match(/^check /gm) || []).length, plan.cases.length);
});

test('a contract with no credentials still produces code for every target', () => {
  const plan = Plan.build(Spec.read(doc3({ '/ping': { get: { responses: { 204: { description: 'ok' } } } } })), {});
  assert.deepEqual(plan.auth, {});
  for (const target of Emit.TARGETS) assert.ok(Emit.emit(target.id, plan).code.length > 100, target.id);
  assert.throws(() => Emit.emit('cobol', plan), /Unknown target/);
});
