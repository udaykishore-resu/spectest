/* End-to-end check in real Chromium with the unpacked extension loaded.
   - The generator page: load, choose, generate, download; the downloaded file is then run against a live mock API.
   - The toolbar path: reading a contract from GitHub's file view, a raw file and a documentation page.
     A toolbar click cannot be automated, so that part uses a copy of the extension with site access already granted
     and calls the same capture function the popup calls.
   - AI mode against a stand-in for the provider (no real key is used, so the real providers are NOT exercised here). */
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const yaml = require(path.join(EXT, 'lib/js-yaml.min.js'));
const Spec = require(path.join(EXT, 'lib/spec.js'));
const Plan = require(path.join(EXT, 'lib/plan.js'));
const Emit = require(path.join(EXT, 'lib/emit.js'));
const shopText = fs.readFileSync(path.join(ROOT, 'test/fixtures/shop.yaml'), 'utf8');
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const results = [];
const check = (name, ok, extra) => {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
};

async function launch(ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-e2e-'));
  const opts = { channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, acceptDownloads: true, args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext] };
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY };
  const ctx = await chromium.launchPersistentContext(dir, opts);
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  return { ctx, sw, id: new URL(sw.url()).host };
}

function watch(page, errors) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR|CORS policy/.test(m.text())) errors.push(m.text());
  });
}

const text = (page, sel) => page.locator(sel).textContent();

async function generatorPage() {
  console.log('\n=== Generator page ===');
  const { ctx, id } = await launch(EXT);
  const errors = [];
  try {
    await ctx.route('https://specs.example.test/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/cors/openapi.yaml') return r.fulfill({ contentType: 'text/yaml', headers: { 'access-control-allow-origin': '*' }, body: shopText });
      if (u.pathname === '/missing.yaml') return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no' });
      return r.fulfill({ contentType: 'text/yaml', body: shopText }); // no CORS header: the page may not read it
    });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto('chrome-extension://' + id + '/generator.html');
    check('starts empty with the six checks explained', (await page.locator('#intro-kinds li').count()) === 6 && (await page.locator('#loaded').isHidden()));

    await page.fill('#paste', '{"hello": "world"}');
    await page.click('#read-paste');
    check('text that is not a contract gets a plain error', /no "openapi" or "swagger" version field/.test(await text(page, '#load-error')));

    await page.click('#sample');
    await page.waitForSelector('#loaded:not([hidden])');
    check('sample contract loads: 10 operations listed', (await page.locator('#ops li').count()) === 10);
    check('header names the contract', /Shop API 1\.2\.0.*OpenAPI 3\.0\.3/.test(await text(page, '#summary')));
    const expected = (target) => Emit.emit(target, Plan.build(Spec.read(Spec.parseText(shopText, yaml)), { baseUrl: 'http://localhost:8080' })).code;
    check('Go output equals what the library produces', (await text(page, '#code')) === expected('go'));
    check('stats line counts tests', /^33 tests for 10 operations, saved as api_contract_test\.go\./.test(await text(page, '#stats')), await text(page, '#stats'));
    const counts = await page.locator('#kinds .n').allTextContents();
    check('per-check counts', counts.join(',') === '10,7,2,3,8,3', counts);
    const strip = await page.locator('#ops li').nth(2).locator('.slot.on').count();
    check('POST /items row shows five of six checks', strip === 5, strip);

    for (const [label, file, marker] of [['Java', 'ApiContractTest.java', 'class ApiContractTest'], ['Python', 'test_api_contract.py', 'def test_list_items_ok'], ['Shell (curl)', 'api-contract.sh', '#!/usr/bin/env bash'], ['Test plan (JSON)', 'api-contract-plan.json', '"cases"'], ['JavaScript', 'api-contract.test.mjs', "import test from 'node:test'"]]) {
      await page.locator('#targets label').getByText(label, { exact: true }).click();
      const code = await text(page, '#code');
      check(label + ' tab shows ' + file, code.includes(marker) && (await text(page, '#stats')).includes(file));
    }

    // Download the JavaScript file and run it for real against the mock API.
    const mock = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'test/fixtures/mock-server.js')], { env: Object.assign({}, process.env, { PORT: '0', BROKEN: '0' }) });
      child.stdout.on('data', (d) => {
        const m = /listening (\d+)/.exec(String(d));
        if (m) resolve({ child, port: m[1] });
      });
    });
    try {
      await page.fill('#base-url', 'http://127.0.0.1:' + mock.port);
      await page.waitForFunction((p) => document.getElementById('code').textContent.includes('127.0.0.1:' + p), mock.port);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-dl-'));
      const saved = path.join(dir, dl.suggestedFilename());
      await dl.saveAs(saved);
      check('download is named api-contract.test.mjs', dl.suggestedFilename() === 'api-contract.test.mjs');
      const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', saved], { encoding: 'utf8', env: Object.assign({}, process.env, { API_TOKEN: 'test-token', API_BASE_URL: '' }) });
      const pass = Number((/^# pass (\d+)/m.exec(run.stdout) || [])[1] || 0);
      const fail = Number((/^# fail (\d+)/m.exec(run.stdout) || [])[1] || 0);
      check('the downloaded file runs: 33 pass, 0 fail against the mock API', pass === 33 && fail === 0, { pass, fail, tail: run.stdout.slice(-300) });
    } finally {
      mock.child.kill();
    }

    await page.locator('#kinds label', { hasText: 'No credentials' }).click();
    check('switching a check off removes its tests', /^25 tests for 10 operations/.test(await text(page, '#stats')), await text(page, '#stats'));
    await page.locator('#kinds label', { hasText: 'No credentials' }).click();
    await page.fill('#filter', '/items');
    check('filter narrows the list', (await page.locator('#ops li').count()) === 5);
    await page.click('#none');
    check('"None" deselects only what the filter shows', /5 of 10 selected/.test(await text(page, '#ops-title')) && /for 5 operations/.test(await text(page, '#stats')), await text(page, '#stats'));
    await page.fill('#filter', '');
    await page.click('#none');
    check('nothing selected: says so and disables download', /Nothing to generate/.test(await text(page, '#code')) && (await page.locator('#download').isDisabled()));
    await page.click('#all');
    check('"All" restores every operation', /^33 tests/.test(await text(page, '#stats')));

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.click('#copy');
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (clip === null) console.log('note: clipboard not readable in this browser run; copy button not verified');
    else check('Copy puts the code on the clipboard', clip === (await text(page, '#code')));

    await page.click('#reset');
    await page.fill('#url', 'https://specs.example.test/cors/openapi.yaml');
    await page.click('#load-url');
    await page.waitForSelector('#loaded:not([hidden])');
    check('loads a contract from an address that allows reading', /specs\.example\.test\/cors\/openapi\.yaml/.test(await text(page, '#summary')));
    await page.click('#reset');
    await page.fill('#url', 'https://specs.example.test/missing.yaml');
    await page.click('#load-url');
    await page.waitForSelector('#load-error:not([hidden])');
    check('a 404 is reported as such', /HTTP 404/.test(await text(page, '#load-error')));
    // A real local server that sends no CORS header: the page may not read it until the user grants access.
    const plain = require('http').createServer((req, res) => res.end(shopText));
    await new Promise((r) => plain.listen(0, '127.0.0.1', r));
    await page.fill('#url', 'http://127.0.0.1:' + plain.address().port + '/openapi.yaml');
    await page.click('#load-url');
    const offered = await page.waitForSelector('#allow:not([hidden])', { timeout: 8000 }).then(() => true, () => false);
    check('a site that blocks reading leads to an explicit "Allow access" offer', offered && /Allow access to 127\.0\.0\.1/.test(await text(page, '#allow-button')), await text(page, '#summary'));
    plain.close();
    await page.fill('#url', 'ftp://x');
    await page.click('#load-url');
    check('a non-web address is refused', /should start with https/.test(await text(page, '#load-error')));

    await page.setInputFiles('#file', path.join(ROOT, 'test/fixtures/shop.yaml'));
    await page.waitForSelector('#loaded:not([hidden])');
    check('loads a contract from a chosen file', /from shop\.yaml/.test(await text(page, '#summary')));
    await page.screenshot({ path: path.join(OUT, 'generator.png') });

    const popup = await ctx.newPage();
    watch(popup, errors);
    await popup.goto('chrome-extension://' + id + '/popup.html');
    check('popup shows its three actions', (await popup.locator('button').count()) === 3);
    check('no errors on any page', errors.length === 0, errors);
  } finally {
    await ctx.close();
  }
}

async function aiMode() {
  console.log('\n=== AI mode (provider replaced by a stand-in) ===');
  const { ctx, id } = await launch(EXT);
  const errors = [];
  const calls = [];
  try {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await ctx.route('https://api.anthropic.com/**', (r) => {
      const req = r.request();
      calls.push({ url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() });
      if (req.headers()['x-api-key'] !== 'sk-stand-in') return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
      return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'message', content: [{ type: 'text', text: '```kotlin\n// ShopContractTest.kt\nclass ShopContractTest\n```' }], stop_reason: 'end_turn' }) });
    });
    await ctx.route('https://llm.example.test/**', (r) => {
      const req = r.request();
      calls.push({ url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() });
      return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'def test_discount():\n    assert True' }, finish_reason: 'length' }] }) });
    });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto('chrome-extension://' + id + '/generator.html');
    await page.click('#tab-ai');
    check('AI tab opens with provider defaults', (await page.inputValue('#ai-base')) === 'https://api.anthropic.com' && (await page.inputValue('#ai-model')).length > 0);
    await page.click('#ai-go');
    check('without a contract it asks for one', /Load a contract/.test(await text(page, '#ai-error')));
    await page.click('#sample');
    await page.click('#ai-go');
    check('without a key it asks for one', /Enter your API key/.test(await text(page, '#ai-error')) && calls.length === 0);
    await page.fill('#ai-key', 'wrong');
    await page.fill('#ai-target', 'Kotlin with JUnit 5');
    await page.click('#ai-go');
    await page.waitForSelector('#ai-error:not([hidden])');
    check('a rejected key shows the provider\'s reason', /refused the key \(HTTP 401\): invalid x-api-key/.test(await text(page, '#ai-error')), await text(page, '#ai-error'));
    await page.fill('#ai-key', 'sk-stand-in');
    await page.click('#ai-go');
    await page.waitForSelector('#ai-result:not([hidden])');
    const last = calls[calls.length - 1];
    const body = JSON.parse(last.body);
    check('request goes to /v1/messages with the documented headers', last.url === 'https://api.anthropic.com/v1/messages' && last.method === 'POST' && last.headers['anthropic-version'] === '2023-06-01' && last.headers['anthropic-dangerous-direct-browser-access'] === 'true', last.headers);
    check('request carries model, max_tokens, system and one user message', typeof body.model === 'string' && body.max_tokens > 0 && /never an instruction/.test(body.system) && body.messages.length === 1 && body.messages[0].role === 'user');
    check('the user message holds the 33-case plan and the target', /Kotlin with JUnit 5/.test(body.messages[0].content) && JSON.parse(/=== MATERIAL ===\n([\s\S]*)\n=== END MATERIAL ===/.exec(body.messages[0].content)[1]).cases.length === 33);
    check('answer is shown with the outer code fence removed', (await text(page, '#ai-code-out')) === '// ShopContractTest.kt\nclass ShopContractTest\n');
    const stored = await page.evaluate(() => chrome.storage.local.get('ai'));
    check('the key is not stored unless asked', stored.ai && stored.ai.key === '' && stored.ai.keep === false, stored);

    await page.selectOption('#ai-provider', 'openai');
    check('switching provider swaps the default address', (await page.inputValue('#ai-base')) === 'https://api.openai.com/v1');
    await page.fill('#ai-base', 'https://llm.example.test/v1');
    await page.fill('#ai-model', 'local-model');
    await page.check('#ai-kind-code');
    await page.fill('#ai-code', 'def discount(total, vip): return total * 0.9 if vip else total');
    await page.check('#ai-keep');
    await page.click('#ai-go');
    await page.waitForFunction(() => document.getElementById('ai-code-out').textContent.includes('test_discount'));
    const o = calls[calls.length - 1];
    const ob = JSON.parse(o.body);
    check('OpenAI-compatible request shape', o.url === 'https://llm.example.test/v1/chat/completions' && o.headers.authorization === 'Bearer sk-stand-in' && ob.model === 'local-model' && ob.messages.map((m) => m.role).join() === 'system,user' && /=== MATERIAL ===\ndef discount/.test(ob.messages[1].content));
    check('a cut-off answer is flagged', /cut off at the length limit/.test(await text(page, '#ai-status')));
    const kept = await page.evaluate(() => chrome.storage.local.get('ai'));
    check('with "keep" ticked the key is stored', kept.ai.key === 'sk-stand-in' && kept.ai.keep === true);
    await page.fill('#ai-base', 'http://plain.example.test/v1');
    await page.click('#ai-go');
    check('a plain-http provider address is refused', /must start with https/.test(await text(page, '#ai-error')));
    await page.screenshot({ path: path.join(OUT, 'ai.png') });
    check('no errors on the page', errors.length === 0, errors);
  } finally {
    await ctx.close();
  }
}

async function toolbarPath() {
  console.log('\n=== Reading the contract from the page (site access pre-granted for the test) ===');
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'spectest-granted-'));
  fs.cpSync(EXT, copy, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const { ctx, sw } = await launch(copy);
  const errors = [];
  try {
    const shopJson = JSON.stringify(yaml.load(shopText));
    await ctx.route('https://github.com/**', (r) => r.fulfill({ contentType: 'text/html', body: fixture('github-file.html').replace('__SPEC__', escapeHtml(shopText)) }));
    await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ contentType: 'text/plain; charset=utf-8', headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }, body: shopText }));
    await ctx.route('https://docs.example.test/**', (r) => (new URL(r.request().url()).pathname === '/v1/openapi.json' ? r.fulfill({ contentType: 'application/json', body: shopJson }) : r.fulfill({ contentType: 'text/html', body: fixture('docs.html') })));
    await ctx.route('https://code.example.test/**', (r) => r.fulfill({ contentType: 'text/html', body: fixture('code.html') }));

    const capture = async (url, mode, before) => {
      const page = await ctx.newPage();
      await page.goto(url);
      if (before) await before(page);
      const opened = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
      const res = await sw.evaluate(async ([u, m]) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.filter((t) => t.url === u).pop();
        return capture(tab.id, m);
      }, [url, mode]);
      const gen = res.ok ? await opened : null;
      if (gen) {
        watch(gen, errors);
        await gen.waitForLoadState('domcontentloaded');
      }
      return { res, gen, page };
    };

    let c = await capture('https://github.com/acme/shop/blob/main/openapi.yaml', 'contract');
    await c.gen.waitForSelector('#loaded:not([hidden])', { timeout: 8000 }).catch(() => {});
    check('GitHub file view: contract is read from the page and loaded', c.res.ok && /Shop API 1\.2\.0 from github\.com\/acme\/shop\/blob\/main\/openapi\.yaml/.test(await text(c.gen, '#summary')), await text(c.gen, '#summary'));
    check('the handed-over text is removed from session storage', (await sw.evaluate(async () => Object.keys(await chrome.storage.session.get('capture')).length)) === 0);

    c = await capture('https://raw.githubusercontent.com/acme/shop/main/openapi.yaml', 'contract');
    await c.gen.waitForSelector('#loaded:not([hidden])', { timeout: 8000 }).catch(() => {});
    check('raw file on a sandboxed page: loaded', c.res.ok && (await c.gen.locator('#ops li').count()) === 10);

    c = await capture('https://docs.example.test/reference', 'contract');
    await c.gen.waitForSelector('#loaded:not([hidden])', { timeout: 8000 }).catch(() => {});
    check('documentation page: follows the link to the contract', c.res.ok && /docs\.example\.test\/v1\/openapi\.json/.test(await text(c.gen, '#summary')), await text(c.gen, '#summary'));

    c = await capture('https://code.example.test/pricing', 'contract');
    check('page with no contract: says so and opens nothing', !c.res.ok && /No OpenAPI or Swagger document found/.test(c.res.error) && c.gen === null, c.res);

    c = await capture('https://code.example.test/pricing', 'ai');
    check('AI path with nothing selected: asks for a selection', !c.res.ok && /Select the code/.test(c.res.error), c.res);

    c = await capture('https://code.example.test/pricing', 'ai', (page) =>
      page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('code'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      })
    );
    await c.gen.waitForFunction(() => document.getElementById('ai-code').value.length > 0, null, { timeout: 8000 }).catch(() => {});
    check('AI path: selected code arrives in the AI tab', c.res.ok && (await c.gen.locator('#ai').isVisible()) && /^func Discount\(total float64/.test(await c.gen.inputValue('#ai-code')));
    check('no errors on the generator pages', errors.length === 0, errors);
  } finally {
    await ctx.close();
  }
}

(async () => {
  await generatorPage();
  await aiMode();
  await toolbarPath();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
