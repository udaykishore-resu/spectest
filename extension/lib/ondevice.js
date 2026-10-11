/* SpecTest: Chrome's built-in model (Gemini Nano, through the Prompt API). It runs on this computer: no key, no
   account, and the code never leaves the browser. Chrome decides whether this computer can run it.

   Speed: the model writes a few dozen words a second, so the time a request takes is mostly the length of the
   answer. What can be taken off the clock is everything before the first word:
   - the model is loaded and the instructions read once per page (a base session), not once per request;
   - the code is read into a copy of that session while the user is still looking at it (prime), so pressing
     "Write tests" only sends the short final instruction. */
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

  function friendly(e) {
    if (e && e.name === 'QuotaExceededError') {
      return new Error('The code is too long for Chrome\u2019s built-in model. Copy one function or class at a time.');
    }
    if (e && e.name === 'AbortError') return new Error('Stopped.');
    return new Error('Chrome\u2019s built-in model stopped with an error: ' + ((e && e.message) || e));
  }

  /* One per page. Holds the loaded model with the instructions already read, and at most one primed copy. */
  function createEngine() {
    let base = null; // { system, promise }
    let primed = null; // { system, context, promise }

    function baseFor(system, onProgress) {
      if (base && base.system === system) return base.promise;
      if (base) base.promise.then((s) => s.destroy(), () => {});
      const LM = api();
      if (!LM) return Promise.reject(new Error(explain('missing')));
      const promise = LM.create(
        Object.assign({}, OPTIONS, {
          initialPrompts: [{ role: 'system', content: system }],
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              if (onProgress) onProgress(typeof e.loaded === 'number' ? e.loaded : 0);
            });
          },
        })
      );
      base = { system, promise };
      promise.catch(() => {
        if (base && base.promise === promise) base = null;
      });
      return promise;
    }

    async function freshCopy(system, context, onProgress) {
      const b = await baseFor(system, onProgress);
      const s = await b.clone();
      if (context) await s.append(context);
      return s;
    }

    /* Start reading the code now, before the user asks. Safe to call often: only the latest code is kept. */
    function prime(system, context) {
      if (primed && primed.system === system && primed.context === context) return primed.promise;
      drop();
      const promise = freshCopy(system, context);
      primed = { system, context, promise };
      promise.catch(() => {
        if (primed && primed.promise === promise) primed = null;
      });
      return promise;
    }

    function drop() {
      if (primed) primed.promise.then((s) => s.destroy(), () => {});
      primed = null;
    }

    function take(system, context, onProgress) {
      if (primed && primed.system === system && primed.context === context) {
        const p = primed.promise;
        primed = null; // a primed copy answers one request only
        return p.catch(() => freshCopy(system, context, onProgress));
      }
      drop();
      return freshCopy(system, context, onProgress);
    }

    /* Streams the answer. onText gets the whole text so far; onProgress gets 0..1 while the model downloads;
       times gets { ready, first, done } in milliseconds from the start. */
    async function generate({ system, context, user, signal, onText, onProgress }) {
      const t0 = Date.now();
      const times = { ready: 0, first: 0, done: 0 };
      let session;
      try {
        session = await take(system, context || '', onProgress);
      } catch (e) {
        throw friendly(e);
      }
      times.ready = Date.now() - t0;
      let text = '';
      const stop = () => {
        try {
          session.destroy();
        } catch (_) {
          /* already gone */
        }
      };
      if (signal) signal.addEventListener('abort', stop, { once: true });
      try {
        const stream = session.promptStreaming(user, { signal });
        for await (const chunk of stream) {
          if (signal && signal.aborted) break;
          const c = String(chunk);
          if (!times.first && c) times.first = Date.now() - t0;
          // Older Chrome versions sent the whole answer so far in every chunk, newer ones send only the new part.
          text = c.startsWith(text) && text ? c : text + c;
          if (onText) onText(text);
        }
      } catch (e) {
        throw signal && signal.aborted ? friendly({ name: 'AbortError' }) : friendly(e);
      } finally {
        if (signal) signal.removeEventListener('abort', stop);
        stop();
      }
      if (signal && signal.aborted) throw friendly({ name: 'AbortError' });
      times.done = Date.now() - t0;
      return { text, times };
    }

    return { prime, drop, generate };
  }

  const out = { status, explain, createEngine, OPTIONS };
  root.SpecTestOnDevice = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
