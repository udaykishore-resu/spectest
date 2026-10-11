/* End-to-end check in real Chromium with the unpacked extension loaded.
   - The generator page: load, choose, generate, download; the downloaded file is then run against a live mock API.
   - The toolbar path: reading a contract from GitHub's file view, a raw file and a documentation page.
     A toolbar click cannot be automated, so that part uses a copy of the extension with site access already granted
     and calls the same capture function the popup calls.
   - Unit tests from code with Chrome's built-in model replaced by a stand-in (the real model is NOT exercised here),
     including the popup reading the clipboard, uploads, the model download and the provider fallback. */
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
    check('text that is neither code nor a contract gets a plain error', /does not look like source code or an OpenAPI contract/.test(await text(page, '#load-error')), await text(page, '#load-error'));

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

    await page.locator('#loaded .reset').click();
    await page.locator('details.more summary').click();
    await page.fill('#url', 'https://specs.example.test/cors/openapi.yaml');
    await page.click('#load-url');
    await page.waitForSelector('#loaded:not([hidden])');
    check('loads a contract from an address that allows reading', /specs\.example\.test\/cors\/openapi\.yaml/.test(await text(page, '#summary')));
    await page.locator('#loaded .reset').click();
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

    await page.evaluate(() => navigator.clipboard.writeText('see you at 5'));
    const popup = await ctx.newPage();
    watch(popup, errors);
    await popup.goto('chrome-extension://' + id + '/popup.html');
    check('popup with nothing usable copied offers the page contract and the generator', (await popup.locator('button:visible').count()) === 2 && /Copy a function/.test(await text(popup, '#lead')), { what: await text(popup, '#copied-what'), clip: await popup.evaluate(() => navigator.clipboard.readText().catch((e) => String(e))) });
    check('no errors on any page', errors.length === 0, errors);
  } finally {
    await ctx.close();
  }
}

/* Chrome's built-in model is not present in this test browser. A stand-in with the documented Prompt API shape
   replaces it in the extension's pages. Its status is set per test through the extension's localStorage, and it
   records each prompt so the test can check what would have been sent to the model. */
function installModelStandIn() {
  if (!location.protocol.startsWith('chrome-extension')) return;
  const get = (k, d) => {
    try {
      return localStorage.getItem(k) || d;
    } catch (_) {
      return d;
    }
  };
  const bump = (k) => localStorage.setItem(k, String(Number(get(k, '0')) + 1));
  function session(history, opts) {
    return {
      async clone() {
        return session(history.slice(), opts);
      },
      async append(text) {
        bump('lm-appends');
        history.push(text);
      },
      promptStreaming(user) {
        const list = JSON.parse(get('lm-prompts', '[]'));
        list.push({ system: history[0], context: history[1], user, inputs: opts.expectedInputs, outputs: opts.expectedOutputs, appendsBefore: Number(get('lm-appends', '0')) });
        localStorage.setItem('lm-prompts', JSON.stringify(list));
        const file = (/The test file is named (\S+)\./.exec(user) || [])[1] || 'unknown';
        return (async function* () {
          yield '```\n// ' + file + ' written by the stand-in model\n';
          await new Promise((r) => setTimeout(r, 30));
          yield 'test("works", () => {});\n```';
        })();
      },
      destroy() {},
    };
  }
  globalThis.LanguageModel = {
    async availability() {
      return get('lm-status', 'available');
    },
    async create(opts) {
      bump('lm-creates');
      const status = get('lm-status', 'available');
      if (status === 'unavailable') throw new Error('not supported');
      if (opts.monitor && status !== 'available') {
        const t = new EventTarget();
        opts.monitor(t);
        for (const loaded of [0, 0.4, 1]) {
          const e = new Event('downloadprogress');
          e.loaded = loaded;
          t.dispatchEvent(e);
        }
        localStorage.setItem('lm-status', 'available');
      }
      return session([(opts.initialPrompts || [])[0].content], opts);
    },
  };
}

async function unitTests() {
  console.log("\n=== Unit tests from code (Chrome's built-in model replaced by a stand-in) ===");
  const { ctx, id } = await launch(EXT);
  await ctx.addInitScript(installModelStandIn);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const errors = [];
  const calls = [];
  const base = 'chrome-extension://' + id + '/';
  const prompts = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lm-prompts') || '[]'));
  try {
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(base + 'generator.html');
    await page.evaluate(() => localStorage.clear());

    // 1. Sample code: recognised, nothing asked, tests written on a click.
    await page.click('#sample-code');
    await page.waitForSelector('#code-setup:not([hidden])');
    check('sample code opens the unit-test view with Go recognised', (await page.inputValue('#code-lang')) === 'go' && /Recognised as Go/.test(await text(page, '#code-detected')));
    check('framework and file name are filled in, nothing else is asked', (await page.inputValue('#code-framework')) === 'the standard testing package' && /discount_test\.go/.test(await text(page, '#unit-file')) && (await page.locator('#fallback').isHidden()));
    await page.waitForFunction(() => /Ready\./.test(document.getElementById('engine').textContent));
    check('the built-in model is reported ready', /on this computer/.test(await text(page, '#engine')));
    await page.waitForFunction(() => Number(localStorage.getItem('lm-appends') || 0) >= 1, null, { timeout: 5000 }).catch(() => {});
    check('the code is read into the model before the button is pressed', (await page.evaluate(() => Number(localStorage.getItem('lm-appends') || 0))) === 1);
    await page.click('#unit-go');
    await page.waitForFunction(() => !document.getElementById('unit-copy').disabled);
    const out = await text(page, '#unit-out');
    check('streamed answer shown, outer code fence removed', out === '// discount_test.go written by the stand-in model\ntest("works", () => {});\n', out);
    let p = (await prompts(page)).pop();
    check('the instruction names Go, the framework, the file and the package; the code was read beforehand', /Write unit tests in Go using the standard testing package/.test(p.user) && /package pricing, the same package/.test(p.user) && !/func Discount/.test(p.user) && /-----BEGIN CODE-----\npackage pricing/.test(p.context) && /one complete test file/.test(p.system) && p.appendsBefore === 1);
    check('pressing the button did not read the code again', (await page.evaluate(() => Number(localStorage.getItem('lm-appends')))) === 1);
    check('the result line reports time, length and time to the first line', /^Done in [\d.]+ s, 2 lines \(first line after [\d.]+ s\)\.$/.test(await text(page, '#engine')), await text(page, '#engine'));
    await page.click('#unit-go');
    check('the same request again is answered at once from memory', /earlier tests are shown at once/.test(await text(page, '#engine')) && (await prompts(page)).length === 1);
    await page.selectOption('#code-depth', 'quick');
    await page.click('#unit-go');
    await page.waitForFunction(() => !document.getElementById('unit-copy').disabled && /Done in/.test(document.getElementById('engine').textContent));
    p = (await prompts(page)).pop();
    check('"Quick" asks for one normal and one error case per function', /one test of a normal input and one of an error case/.test(p.user));
    check('the model was loaded once for all of this', (await page.evaluate(() => Number(localStorage.getItem('lm-creates')))) === 1);
    check('the model is asked for English text in and out', JSON.stringify(p.inputs) === '[{"type":"text","languages":["en"]}]' && JSON.stringify(p.outputs) === '[{"type":"text","languages":["en"]}]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#unit-download')]);
    check('download is named discount_test.go', dl.suggestedFilename() === 'discount_test.go');
    await page.selectOption('#code-lang', 'python');
    check('changing the language changes framework and file name', (await page.inputValue('#code-framework')) === 'pytest' && /test_discount\.py/.test(await text(page, '#unit-file')));

    // 2. Copied code through the page button: read, recognised and written without another click.
    await page.locator('#code-setup .reset').click();
    const java = fs.readFileSync(path.join(ROOT, 'test/fixtures/code/Sample.java'), 'utf8');
    await page.evaluate((t) => navigator.clipboard.writeText(t), java);
    await page.click('#paste-clipboard');
    await page.waitForFunction(() => document.getElementById('unit-out').textContent.includes('PriceCalculatorTest.java') && !document.getElementById('unit-copy').disabled);
    check('"Use what I copied": Java recognised and tests written straight away', (await page.inputValue('#code-lang')) === 'java' && /PriceCalculatorTest\.java written/.test(await text(page, '#unit-out')));

    // 3. Uploaded source file: language taken from the file name.
    await page.locator('#code-setup .reset').click();
    await page.setInputFiles('#file', path.join(ROOT, 'test/fixtures/code/sample.rs'));
    await page.waitForSelector('#code-setup:not([hidden])');
    check('uploaded .rs file: Rust, named discount_tests.rs', (await page.inputValue('#code-lang')) === 'rust' && /discount_tests\.rs/.test(await text(page, '#unit-file')) && /from sample\.rs/.test(await text(page, '#code-detected')));
    await page.locator('#code-setup .reset').click();
    await page.setInputFiles('#file', path.join(ROOT, 'test/fixtures/shop.yaml'));
    await page.waitForSelector('#loaded:not([hidden])');
    check('uploaded contract file goes to contract tests instead', /Shop API/.test(await text(page, '#summary')) && (await page.locator('#unit').isHidden()));

    // 4. The popup reads what was copied when it opens.
    const py = fs.readFileSync(path.join(ROOT, 'test/fixtures/code/sample.py'), 'utf8');
    await page.evaluate((t) => navigator.clipboard.writeText(t), py);
    const popup = await ctx.newPage();
    watch(popup, errors);
    await popup.goto(base + 'popup.html');
    await popup.waitForSelector('#use-copied:not([hidden])', { timeout: 5000 }).catch(() => {});
    check('popup shows what was copied: Python code with a preview', /^Python code, 9 lines$/.test(await text(popup, '#copied-what')) && /def discount/.test(await text(popup, '#copied-preview')) && (await text(popup, '#use-copied')) === 'Write unit tests', await text(popup, '#copied-what'));
    const opened = ctx.waitForEvent('page');
    await popup.click('#use-copied');
    const gen = await opened;
    watch(gen, errors);
    await gen.waitForFunction(() => document.getElementById('unit-out').textContent.includes('stand-in'), null, { timeout: 8000 }).catch(() => {});
    check('one click: a generator tab opens with Python tests already written', (await gen.inputValue('#code-lang')) === 'python' && /test_discount\.py written/.test(await text(gen, '#unit-out')));
    check('the copied text is removed from session storage once read', (await gen.evaluate(async () => Object.keys(await chrome.storage.session.get('capture')).length)) === 0);
    await page.bringToFront();
    await page.evaluate((t) => navigator.clipboard.writeText(t), shopText);
    const popup2 = await ctx.newPage();
    await popup2.goto(base + 'popup.html');
    await popup2.waitForSelector('#use-copied:not([hidden])', { timeout: 5000 }).catch(() => {});
    check('popup recognises a copied contract and offers API tests', /API contract/.test(await text(popup2, '#copied-what')) && (await text(popup2, '#use-copied')) === 'Write API tests');
    await page.bringToFront();
    await page.evaluate(() => navigator.clipboard.writeText('see you at 5, thanks!'));
    const popup3 = await ctx.newPage();
    await popup3.goto(base + 'popup.html');
    await popup3.waitForTimeout(400);
    check('popup ignores copied prose', (await popup3.locator('#use-copied').isHidden()) && (await popup3.locator('#copied').isHidden()), { what: await text(popup3, '#copied-what'), clip: await popup3.evaluate(() => navigator.clipboard.readText().catch((e) => String(e))) });

    // 5. Model not downloaded yet: the button says so, the download shows progress, then tests are written.
    await page.bringToFront();
    await page.evaluate(() => localStorage.setItem('lm-status', 'downloadable'));
    await page.reload();
    await page.click('#sample-code');
    await page.waitForFunction(() => /Download the model/.test(document.getElementById('unit-go').textContent));
    check('model not on this computer: button offers to download it', /not on this computer yet/.test(await text(page, '#engine')));
    await page.click('#unit-go');
    await page.waitForFunction(() => !document.getElementById('unit-copy').disabled);
    check('after the download the tests are written', true);

    // 6. This computer cannot run the model: say why, and only then offer a provider key.
    await page.evaluate(() => localStorage.setItem('lm-status', 'unavailable'));
    await page.reload();
    await page.click('#sample-code');
    await page.waitForSelector('#fallback:not([hidden])');
    check('model unavailable: reason shown, write button disabled, key settings offered', /cannot run its built-in model/.test(await text(page, '#engine')) && (await page.locator('#unit-go').isDisabled()) && (await page.locator('#fallback').getAttribute('open')) !== null);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await ctx.route('https://llm.example.test/**', (r) => {
      const req = r.request();
      calls.push({ url: req.url(), headers: req.headers(), body: req.postData() });
      return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '```go\nfunc TestDiscount(t *testing.T) {}\n```' }, finish_reason: 'stop' }] }) });
    });
    await page.selectOption('#ai-provider', 'openai');
    await page.fill('#ai-base', 'https://llm.example.test/v1');
    await page.fill('#ai-model', 'm');
    await page.fill('#ai-key', 'sk-stand-in');
    await page.check('#use-remote');
    check('with a provider chosen the button works again', !(await page.locator('#unit-go').isDisabled()));
    await page.click('#unit-go');
    await page.waitForFunction(() => document.getElementById('unit-out').textContent.includes('TestDiscount'));
    const last = calls[calls.length - 1];
    check('fallback provider gets code and instruction in one message, with the key', last && last.url === 'https://llm.example.test/v1/chat/completions' && last.headers.authorization === 'Bearer sk-stand-in' && /-----BEGIN CODE-----[\s\S]*Write unit tests in Go/.test(JSON.parse(last.body).messages[1].content));
    const stored = await page.evaluate(() => chrome.storage.local.get('ai'));
    check('the key is not stored unless asked', stored.ai && stored.ai.key === '');
    await page.screenshot({ path: path.join(OUT, 'unit-fallback.png') });
    check('no errors on the pages', errors.length === 0, errors);
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
        return capture(tab.id);
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
    check('page with no contract: says so and opens nothing', !c.res.ok && /No OpenAPI or Swagger contract was found/.test(c.res.error) && c.gen === null, c.res);

    check('no errors on the generator pages', errors.length === 0, errors);
  } finally {
    await ctx.close();
  }
}

(async () => {
  await generatorPage();
  await unitTests();
  await toolbarPath();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
