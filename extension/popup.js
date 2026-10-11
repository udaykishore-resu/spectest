/* SpecTest popup: three buttons. Reading the page is done by the service worker so it survives the popup closing. */
(function () {
  'use strict';
  const status = document.getElementById('status');
  const buttons = Array.from(document.querySelectorAll('button'));

  function say(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  async function capture(mode) {
    say('');
    buttons.forEach((b) => (b.disabled = true));
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== 'number') throw new Error('There is no page to read.');
      const res = await chrome.runtime.sendMessage({ type: 'spectest:capture', tabId: tab.id, mode });
      if (!res || !res.ok) throw new Error((res && res.error) || 'This page could not be read.');
      window.close();
    } catch (e) {
      say(String((e && e.message) || e));
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  document.getElementById('use-page').addEventListener('click', () => capture('contract'));
  document.getElementById('use-selection').addEventListener('click', () => capture('ai'));
  document.getElementById('open').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('generator.html') });
    window.close();
  });
})();
