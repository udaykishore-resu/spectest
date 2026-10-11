/* SpecTest service worker. One job: when the popup asks, read the API contract from the tab the user is looking
   at and hand it to the generator tab. It runs only after a click on the toolbar button. */

/* Runs inside the page. Must stay self-contained: it is serialised and injected. */
function capturePage() {
  const LIMIT = 6000000;
  const out = { url: location.href, title: document.title, text: '', specUrl: '' };
  const looks = (t) => /(^|\n)\s*["']?(openapi|swagger)["']?\s*:/.test(String(t).slice(0, 20000));
  const take = (t) => {
    if (t.length > LIMIT) return false;
    out.text = t;
    return true;
  };

  // GitHub's file view keeps the whole file in a read-only textarea.
  const ta = document.querySelector('textarea#read-only-cursor-text-area, textarea[aria-readonly="true"]');
  if (ta && looks(ta.value) && take(ta.value)) return out;

  // A raw JSON / YAML / text document.
  const type = String(document.contentType || '');
  if (/json|yaml|text\/plain/.test(type) && document.body) {
    out.specUrl = location.href;
    const t = document.body.innerText || '';
    if (looks(t) && take(t)) return out;
    return out;
  }

  // The biggest code block on the page that looks like a contract.
  let best = '';
  for (const el of document.querySelectorAll('pre, code, textarea')) {
    const t = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
    if (t && t.length > best.length && looks(t)) best = t;
  }
  if (best && take(best)) return out;

  // Documentation pages usually link to the document they were built from.
  const link = document.querySelector(
    '.swagger-ui .info a.link[href], .swagger-ui .info hgroup a[href], a[download][href$=".json"], a[download][href$=".yaml"], a[download][href$=".yml"], a[href$="openapi.json"], a[href$="swagger.json"], a[href$="openapi.yaml"], a[href$="openapi.yml"]'
  );
  if (link) {
    try {
      out.specUrl = new URL(link.getAttribute('href'), location.href).href;
    } catch (_) {
      /* not a usable link */
    }
  }
  return out;
}

async function capture(tabId) {
  let page;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: capturePage });
    page = r && r.result;
  } catch (_) {
    return { ok: false, error: 'Chrome does not let extensions read this page. Copy the contract and click the SpecTest button again.' };
  }
  if (!page) return { ok: false, error: 'This page could not be read.' };
  if (!page.text && !page.specUrl) {
    return { ok: false, error: 'No OpenAPI or Swagger contract was found on this page. To test code, copy it and click the SpecTest button again.' };
  }
  await chrome.storage.session.set({ capture: { mode: 'contract', text: page.text, specUrl: page.specUrl, url: page.url } });
  await chrome.tabs.create({ url: chrome.runtime.getURL('generator.html#capture'), index: tab.index + 1, openerTabId: tabId });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'spectest:capture' || typeof msg.tabId !== 'number') return false;
  capture(msg.tabId).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
