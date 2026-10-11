const test = require('node:test');
const assert = require('node:assert/strict');

/* Chrome's built-in model cannot run here, so these tests replace globalThis.LanguageModel with a stand-in that
   behaves the way the Prompt API documentation describes: create() loads the model with the system prompt,
   clone() copies a session with what it has read, append() reads a message without answering it. */
function load() {
  delete require.cache[require.resolve('../extension/lib/ondevice.js')];
  return require('../extension/lib/ondevice.js');
}

function fake({ availability = 'available', chunks = ['package pricing', '\n\nfunc TestX'], fail, appendFail } = {}) {
  const log = [];
  function session(history) {
    return {
      history,
      async clone() {
        log.push('clone');
        return session(history.slice());
      },
      async append(text) {
        log.push('append');
        if (appendFail) throw appendFail;
        history.push(text);
      },
      promptStreaming(user) {
        log.push({ prompt: user, history: history.slice() });
        return (async function* () {
          for (const c of chunks) yield c;
          if (fail) throw fail;
        })();
      },
      destroy() {
        log.push('destroy');
      },
    };
  }
  globalThis.LanguageModel = {
    async availability() {
      if (availability instanceof Error) throw availability;
      return availability;
    },
    async create(opts) {
      log.push({ create: opts });
      if (opts.monitor) {
        const target = new EventTarget();
        opts.monitor(target);
        for (const loaded of [0, 0.5, 1]) {
          const e = new Event('downloadprogress');
          e.loaded = loaded;
          target.dispatchEvent(e);
        }
      }
      return session([opts.initialPrompts[0].content]);
    },
  };
  return log;
}

const creates = (log) => log.filter((x) => x && x.create).length;
const prompts = (log) => log.filter((x) => x && x.prompt);

test('status: missing without the API, otherwise what Chrome says', async () => {
  delete globalThis.LanguageModel;
  assert.equal(await load().status(), 'missing');
  fake({ availability: 'downloadable' });
  assert.equal(await load().status(), 'downloadable');
  fake({ availability: new Error('nope') });
  assert.equal(await load().status(), 'unavailable');
  for (const s of ['available', 'downloadable', 'downloading', 'unavailable', 'missing']) assert.ok(load().explain(s).length > 20);
});

test('generate: system prompt once, code read before the instruction, streamed text, timings, download progress', async () => {
  const log = fake();
  const engine = load().createEngine();
  const texts = [];
  const progress = [];
  const r = await engine.generate({ system: 'SYS', context: 'CODE', user: 'DO IT', onText: (t) => texts.push(t), onProgress: (p) => progress.push(p) });
  assert.equal(r.text, 'package pricing\n\nfunc TestX');
  assert.deepEqual(texts, ['package pricing', 'package pricing\n\nfunc TestX']);
  assert.deepEqual(progress, [0, 0.5, 1]);
  assert.ok(r.times.done >= r.times.first && r.times.first >= r.times.ready);
  const create = log.find((x) => x.create).create;
  assert.deepEqual(create.initialPrompts, [{ role: 'system', content: 'SYS' }]);
  assert.deepEqual(create.expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.deepEqual(create.expectedOutputs, [{ type: 'text', languages: ['en'] }]);
  const p = prompts(log)[0];
  assert.equal(p.prompt, 'DO IT');
  assert.deepEqual(p.history, ['SYS', 'CODE'], 'the code was read into the session before the instruction');
});

test('the model is loaded once per page, not once per request', async () => {
  const log = fake();
  const engine = load().createEngine();
  await engine.generate({ system: 'SYS', context: 'A', user: 'u' });
  await engine.generate({ system: 'SYS', context: 'B', user: 'u' });
  await engine.generate({ system: 'SYS', context: 'C', user: 'u' });
  assert.equal(creates(log), 1);
  assert.deepEqual(prompts(log).map((p) => p.history), [['SYS', 'A'], ['SYS', 'B'], ['SYS', 'C']], 'every request starts from a clean copy');
});

test('prime: the code is read before the button is pressed, and that copy answers the request', async () => {
  const log = fake();
  const engine = load().createEngine();
  await engine.prime('SYS', 'CODE');
  const appendsBefore = log.filter((x) => x === 'append').length;
  assert.equal(appendsBefore, 1);
  await engine.generate({ system: 'SYS', context: 'CODE', user: 'u' });
  assert.equal(log.filter((x) => x === 'append').length, 1, 'nothing read again when the button is pressed');
  // A primed copy answers once; a second request reads the code again.
  await engine.generate({ system: 'SYS', context: 'CODE', user: 'u' });
  assert.equal(log.filter((x) => x === 'append').length, 2);
});

test('prime: edited code replaces the primed copy; a stale copy is never used', async () => {
  const log = fake();
  const engine = load().createEngine();
  await engine.prime('SYS', 'OLD');
  await engine.prime('SYS', 'NEW');
  await engine.generate({ system: 'SYS', context: 'NEWER', user: 'u' });
  assert.deepEqual(prompts(log)[0].history, ['SYS', 'NEWER']);
  assert.ok(log.filter((x) => x === 'destroy').length >= 2, 'replaced copies are released');
});

test('older Chrome sends the whole text so far in every chunk; both forms give the same answer', async () => {
  fake({ chunks: ['package', 'package pricing', 'package pricing\nfunc TestX'] });
  assert.equal((await load().createEngine().generate({ system: 's', context: 'c', user: 'u' })).text, 'package pricing\nfunc TestX');
});

test('too much code and other failures become plain messages, and the session is closed', async () => {
  const quota = new Error('too big');
  quota.name = 'QuotaExceededError';
  let log = fake({ appendFail: quota });
  await assert.rejects(load().createEngine().generate({ system: 's', context: 'c', user: 'u' }), /too long for Chrome’s built-in model/);
  log = fake({ chunks: [], fail: quota });
  await assert.rejects(load().createEngine().generate({ system: 's', context: 'c', user: 'u' }), /too long/);
  assert.ok(log.includes('destroy'));
  fake({ chunks: ['x'], fail: new Error('boom') });
  await assert.rejects(load().createEngine().generate({ system: 's', context: 'c', user: 'u' }), /stopped with an error: boom/);
  delete globalThis.LanguageModel;
  await assert.rejects(load().createEngine().generate({ system: 's', context: 'c', user: 'u' }), /Chrome 138 or newer/);
});

test('stopping aborts the stream and reports it plainly', async () => {
  fake({ chunks: ['a', 'b'] });
  const ac = new AbortController();
  const engine = load().createEngine();
  const p = engine.generate({ system: 's', context: 'c', user: 'u', signal: ac.signal, onText: () => ac.abort() });
  await assert.rejects(p, /Stopped/);
});
