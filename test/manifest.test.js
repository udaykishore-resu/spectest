const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

test('Chrome Web Store limits', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.description.length <= 132, 'description is ' + manifest.description.length + ' characters, limit 132');
  assert.ok(manifest.name.length <= 75, 'name is ' + manifest.name.length + ' characters, limit 75');
  assert.ok(manifest.short_name.length <= 12);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
});

test('permissions are exactly the ones the listing justifies', () => {
  assert.deepEqual(manifest.permissions.slice().sort(), ['activeTab', 'clipboardRead', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined, 'no site access is granted at install');
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  assert.equal(manifest.content_scripts, undefined);
});

test('every file the manifest and pages name exists', () => {
  const files = [manifest.background.service_worker, manifest.action.default_popup, 'generator.html', ...Object.values(manifest.icons)];
  for (const html of ['generator.html', 'popup.html']) {
    const text = fs.readFileSync(path.join(EXT, html), 'utf8');
    for (const m of text.matchAll(/(?:src|href)="([^"#:]+)"/g)) files.push(m[1]);
    assert.ok(!/<script(?![^>]*\bsrc=)/.test(text), html + ' has no inline script');
    assert.ok(!/\son[a-z]+="/.test(text), html + ' has no inline event handlers');
  }
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), f + ' is missing');
});

test('own code never builds HTML from strings or evaluates text', () => {
  const own = ['background.js', 'popup.js', 'generator.js', 'lib/spec.js', 'lib/plan.js', 'lib/emit.js', 'lib/ai.js', 'lib/detect.js', 'lib/ondevice.js'];
  for (const f of own) {
    const text = fs.readFileSync(path.join(EXT, f), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(text), f);
    assert.ok(!/[^\x09\x0a\x20-\x7e]/.test(text), f + ' is plain ASCII');
  }
});

test('the bundled samples are the same text as the test fixtures', () => {
  const sample = require('../extension/lib/sample.js');
  assert.equal(sample.contract, fs.readFileSync(path.join(__dirname, 'fixtures/shop.yaml'), 'utf8'));
  assert.equal(sample.code, fs.readFileSync(path.join(__dirname, 'fixtures/code/sample.go'), 'utf8'));
});

test('the clipboard is read only by the popup and the generator page, never by code injected into websites', () => {
  for (const f of ['background.js', 'lib/detect.js', 'lib/ondevice.js', 'lib/ai.js']) {
    assert.ok(!/clipboard/.test(fs.readFileSync(path.join(EXT, f), 'utf8')), f);
  }
});
