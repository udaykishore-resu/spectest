const test = require('node:test');
const assert = require('node:assert/strict');

/* Chrome's built-in model cannot run here, so these tests replace globalThis.LanguageModel with a stand-in that
   behaves the way the Prompt API documentation describes. */
function load() {
  delete require.cache[require.resolve('../extension/lib/ondevice.js')];
  return require('../extension/lib/ondevice.js');
}

function fake({ availability = 'available', chunks = ['package pricing', '\n\nfunc TestX'], fail } = {}) {
  const calls = [];
  globalThis.LanguageModel = {
    async availability(opts) {
      calls.push({ availability: opts });
      if (availability instanceof Error) throw availability;
      return availability;
    },
    async create(opts) {
      calls.push({ create: opts });
      if (opts.monitor) {
        const target = new EventTarget();
        opts.monitor(target);
        for (const loaded of [0, 0.5, 1]) {
          const e = new Event('downloadprogress');
          e.loaded = loaded;
          target.dispatchEvent(e);
        }
      }
      return {
        destroyed: false,
        promptStreaming(user) {
          calls.push({ prompt: user });
          return (async function* () {
            for (const c of chunks) yield c;
            if (fail) throw fail;
          })();
        },
        destroy() {
          calls.push({ destroy: true });
        },
      };
    },
  };
  return calls;
}

test('status: missing without the API, otherwise what Chrome says', async () => {
  delete globalThis.LanguageModel;
  assert.equal(await load().status(), 'missing');
  fake({ availability: 'downloadable' });
  assert.equal(await load().status(), 'downloadable');
  fake({ availability: new Error('nope') });
  assert.equal(await load().status(), 'unavailable');
  for (const s of ['available', 'downloadable', 'downloading', 'unavailable', 'missing']) assert.ok(load().explain(s).length > 20);
});

test('generate: system prompt, English in and out, streamed text, download progress, session destroyed', async () => {
  const calls = fake();
  const texts = [];
  const progress = [];
  const out = await load().generate({ system: 'SYS', user: 'USER', onText: (t) => texts.push(t), onProgress: (p) => progress.push(p) });
  assert.equal(out, 'package pricing\n\nfunc TestX');
  assert.deepEqual(texts, ['package pricing', 'package pricing\n\nfunc TestX']);
  assert.deepEqual(progress, [0, 0.5, 1]);
  const create = calls.find((c) => c.create).create;
  assert.deepEqual(create.initialPrompts, [{ role: 'system', content: 'SYS' }]);
  assert.deepEqual(create.expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.deepEqual(create.expectedOutputs, [{ type: 'text', languages: ['en'] }]);
  assert.equal(calls.find((c) => c.prompt).prompt, 'USER');
  assert.ok(calls.some((c) => c.destroy));
});

test('generate: older Chrome sends the whole text so far in every chunk; both forms give the same answer', async () => {
  fake({ chunks: ['package', 'package pricing', 'package pricing\nfunc TestX'] });
  assert.equal(await load().generate({ system: 's', user: 'u' }), 'package pricing\nfunc TestX');
});

test('generate: too much code and other failures become plain messages, and the session is still closed', async () => {
  const quota = new Error('too big');
  quota.name = 'QuotaExceededError';
  let calls = fake({ chunks: [], fail: quota });
  await assert.rejects(load().generate({ system: 's', user: 'u' }), /too long for Chrome’s built-in model/);
  assert.ok(calls.some((c) => c.destroy));
  calls = fake({ chunks: ['x'], fail: new Error('boom') });
  await assert.rejects(load().generate({ system: 's', user: 'u' }), /stopped with an error: boom/);
  delete globalThis.LanguageModel;
  await assert.rejects(load().generate({ system: 's', user: 'u' }), /Chrome 138 or newer/);
});
