/* SpecTest: Chrome's built-in model (Gemini Nano, through the Prompt API). It runs on this computer: no key, no
   account, and the code never leaves the browser. Chrome decides whether this computer can run it. */
(function (root) {
  'use strict';

  const OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };

  const api = () => root.LanguageModel;

  /* 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'missing' (this Chrome has no Prompt API). */
  async function status() {
    const LM = api();
    if (!LM || typeof LM.availability !== 'function') return 'missing';
    try {
      return String(await LM.availability(OPTIONS));
    } catch (_) {
      return 'unavailable';
    }
  }

  /* Plain-language reason for a status, shown when the built-in model cannot be used yet. */
  function explain(s) {
    switch (s) {
      case 'available':
        return 'Ready. Runs on this computer with Chrome\u2019s built-in model; your code is not sent anywhere.';
      case 'downloadable':
        return 'Chrome\u2019s built-in model is not on this computer yet. It downloads once (a few GB), then works offline.';
      case 'downloading':
        return 'Chrome is downloading its built-in model. Tests can be written as soon as it finishes.';
      case 'missing':
        return 'This version of Chrome has no built-in model. Chrome 138 or newer on Windows, macOS 13+, Linux or a Chromebook Plus is needed.';
      default:
        return 'Chrome says this computer cannot run its built-in model (it needs 22 GB of free disk and more than 4 GB of GPU memory, or 16 GB of RAM).';
    }
  }

  /* Streams the answer. onText gets the whole text so far after every chunk; onProgress gets 0..1 while downloading. */
  async function generate({ system, user, signal, onText, onProgress }) {
    const LM = api();
    if (!LM) throw new Error(explain('missing'));
    const session = await LM.create(
      Object.assign({}, OPTIONS, {
        signal,
        initialPrompts: [{ role: 'system', content: system }],
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            if (onProgress) onProgress(typeof e.loaded === 'number' ? e.loaded : 0);
          });
        },
      })
    );
    let text = '';
    try {
      const stream = session.promptStreaming(user, { signal });
      for await (const chunk of stream) {
        const c = String(chunk);
        // Older Chrome versions sent the whole answer so far in every chunk, newer ones send only the new part.
        text = c.startsWith(text) && text ? c : text + c;
        if (onText) onText(text);
      }
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        throw new Error('The code is too long for Chrome\u2019s built-in model. Copy one function or class at a time.');
      }
      if (e && e.name === 'AbortError') throw new Error('Stopped.');
      throw new Error('Chrome\u2019s built-in model stopped with an error: ' + ((e && e.message) || e));
    } finally {
      try {
        session.destroy();
      } catch (_) {
        /* already gone */
      }
    }
    return text;
  }

  const out = { status, explain, generate, OPTIONS };
  root.SpecTestOnDevice = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
