/* SpecTest popup. Opening it reads what was copied last and says what it is; one click writes the tests.
   The clipboard is read only here, only when the popup is opened, and is not stored anywhere but the hand-over. */
(function () {
  'use strict';
  const Detect = globalThis.SpecTestDetect;
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const MAX = 2 * 1024 * 1024;
  let copied = '';

  function say(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  async function openGenerator(capture) {
    if (capture) await chrome.storage.session.set({ capture });
    await chrome.tabs.create({ url: chrome.runtime.getURL('generator.html' + (capture ? '#capture' : '')) });
    window.close();
  }

  async function readClipboard() {
    try {
      return await navigator.clipboard.readText();
    } catch (_) {
      return '';
    }
  }

  async function init() {
    const text = await readClipboard();
    if (text && text.length <= MAX) {
      const c = Detect.classify(text);
      if (c.kind === 'contract' || c.kind === 'code') {
        copied = text;
        const what = c.kind === 'contract' ? 'An API contract (OpenAPI or Swagger)' : (c.language ? c.language.label + ' code' : 'Code') + ', ' + c.lines + (c.lines === 1 ? ' line' : ' lines');
        $('copied-what').textContent = what;
        $('copied-preview').textContent = text.trim().split('\n').slice(0, 6).join('\n');
        $('copied').hidden = false;
        $('lead').hidden = true;
        const go = $('use-copied');
        go.textContent = c.kind === 'contract' ? 'Write API tests' : 'Write unit tests';
        go.hidden = false;
        go.focus();
        $('use-page').classList.remove('primary');
      }
    }
  }

  $('use-copied').addEventListener('click', () => openGenerator({ mode: 'text', text: copied, name: 'what you copied' }));
  $('open').addEventListener('click', () => openGenerator(null));
  $('use-page').addEventListener('click', async () => {
    say('');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== 'number') throw new Error('There is no page to read.');
      const res = await chrome.runtime.sendMessage({ type: 'spectest:capture', tabId: tab.id });
      if (!res || !res.ok) throw new Error((res && res.error) || 'This page could not be read.');
      window.close();
    } catch (e) {
      say(String((e && e.message) || e));
    }
  });

  init();
})();
