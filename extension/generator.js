/* SpecTest generator page. Three ways in (copied code, an API contract, an uploaded file); code gets unit tests
   written by Chrome's built-in model, a contract gets contract tests built from its rules. */
(function () {
  'use strict';
  const Spec = globalThis.SpecTestSpec;
  const Plan = globalThis.SpecTestPlan;
  const Emit = globalThis.SpecTestEmit;
  const Ai = globalThis.SpecTestAi;
  const Detect = globalThis.SpecTestDetect;
  const OnDevice = globalThis.SpecTestOnDevice;
  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k of Object.keys(props || {})) {
      const v = props[k];
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (typeof v === 'boolean') el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) el.append(kid);
    return el;
  }

  const KIND_HELP = {
    ok: 'The documented success status, and every required response field with its type.',
    missing: 'A request without a required body field or query parameter is rejected.',
    type: 'A body field sent as the wrong JSON type is rejected.',
    invalid: 'A value outside the enum, minimum, maximum or length the contract sets is rejected.',
    auth: 'A request without credentials is refused.',
    notfound: 'An identifier that does not exist returns 404, where the contract documents it.',
  };
  const FALLBACK_BASE = 'http://localhost:8080';

  const state = { model: null, name: '', kinds: {}, off: new Set(), target: 'go', baseUrl: '', filter: '', full: null, plan: null, out: null, aiText: '', code: null, abort: null };
  for (const k of Plan.KINDS) state.kinds[k.id] = true;

  const local = {
    async get(key) {
      try {
        return (await chrome.storage.local.get(key))[key];
      } catch (_) {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        await chrome.storage.local.set({ [key]: value });
      } catch (_) {
        /* storage is a convenience only */
      }
    },
  };

  /* ------------------------------------------------------------ loading */
  function showError(text) {
    $('load-error').textContent = text;
    $('load-error').hidden = !text;
  }

  function hideAllow(id) {
    $(id).hidden = true;
  }

  /* When a site does not let other pages read it, offer to ask Chrome for access to that one site. */
  async function offerAccess(prefix, url, retry, fail) {
    const box = $(prefix);
    const pattern = url.protocol + '//' + url.hostname + '/*';
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !localHost) return fail('Only https addresses, or http on localhost, can be reached.');
    let already = false;
    try {
      already = await chrome.permissions.contains({ origins: [pattern] });
    } catch (_) {
      /* treat as not granted */
    }
    if (already) return fail('Could not reach ' + url.host + '. Check the address and your connection.');
    $(prefix + '-text').textContent = 'Could not read from ' + url.host + '. If the address is right, the site does not let other pages read it. SpecTest can ask Chrome for access to that one site.';
    const button = $(prefix + '-button');
    button.textContent = 'Allow access to ' + url.host;
    button.onclick = async () => {
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [pattern] });
      } catch (_) {
        granted = false;
      }
      box.hidden = true;
      if (granted) retry();
      else fail('Access to ' + url.host + ' was not granted.');
    };
    box.hidden = false;
  }

  function load(text, name) {
    showError('');
    hideAllow('allow');
    let model;
    try {
      model = Spec.read(Spec.parseText(text, globalThis.jsyaml));
    } catch (e) {
      showError(String((e && e.message) || e));
      return false;
    }
    state.model = model;
    state.name = name || '';
    state.off = new Set();
    state.filter = '';
    let base = model.servers[0] || '';
    if (!/^https?:\/\//i.test(base) || /[{}]/.test(base)) base = FALLBACK_BASE + (base[0] === '/' && !/[{}]/.test(base) ? base : '');
    state.baseUrl = base;
    renderLoaded();
    return true;
  }

  async function fetchSpec(raw) {
    showError('');
    hideAllow('allow');
    let url;
    try {
      url = new URL(String(raw).trim());
    } catch (_) {
      return showError('That is not a full address. It should start with https://');
    }
    if (!/^https?:$/.test(url.protocol)) return showError('The address should start with https://');
    $('load-url').disabled = true;
    try {
      const res = await fetch(url.href, { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return showError('The server answered HTTP ' + res.status + ' for that address.');
      takeText(await res.text(), url.hostname + url.pathname);
    } catch (_) {
      await offerAccess('allow', url, () => fetchSpec(raw), showError);
    } finally {
      $('load-url').disabled = false;
    }
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) return showError('That file is larger than 30 MB.');
    const reader = new FileReader();
    reader.onload = () => takeText(String(reader.result || ''), file.name);
    reader.onerror = () => showError('The file could not be read.');
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------ rendering */
  function renderLoaded() {
    const m = state.model;
    show('contract');
    $('contract-name').textContent = m.title + (m.version ? ' ' + m.version : '');
    const s = $('summary');
    s.textContent = '';
    s.append(h('strong', { text: m.title + (m.version ? ' ' + m.version : '') }), ' from ' + (state.name || 'pasted text') + ', ' + m.kind);
    $('base-url').value = state.baseUrl;
    $('filter').value = '';
    const list = $('warning-list');
    list.textContent = '';
    for (const w of m.warnings) list.append(h('li', { text: w }));
    $('warnings').hidden = !m.warnings.length;
    $('warnings-title').textContent = m.warnings.length === 1 ? '1 note about this contract' : m.warnings.length + ' notes about this contract';
    rebuild();
  }

  function rebuild() {
    state.full = Plan.build(state.model, { baseUrl: state.baseUrl || FALLBACK_BASE, kinds: state.kinds });
    renderOps();
    emit();
  }

  function visibleOps() {
    const f = state.filter.trim().toLowerCase();
    if (!f) return state.model.operations;
    return state.model.operations.filter((op) => (op.method + ' ' + op.path + ' ' + op.id + ' ' + op.tags.join(' ')).toLowerCase().includes(f));
  }

  function renderOps() {
    const kindsOf = new Map();
    for (const c of state.full.cases) {
      if (!kindsOf.has(c.op)) kindsOf.set(c.op, new Set());
      kindsOf.get(c.op).add(c.kind);
    }
    const ul = $('ops');
    ul.textContent = '';
    const ops = visibleOps();
    for (const op of ops) {
      const has = kindsOf.get(op.id) || new Set();
      const strip = h('span', { class: 'strip', 'aria-hidden': 'true' });
      const names = [];
      for (const k of Plan.KINDS) {
        strip.append(h('span', { class: 'slot' + (has.has(k.id) ? ' on' : ''), title: k.label + (has.has(k.id) ? '' : ': not applicable') }));
        if (has.has(k.id)) names.push(k.label.toLowerCase());
      }
      const box = h('input', { type: 'checkbox', checked: !state.off.has(op.id) });
      box.dataset.op = op.id;
      const label = h(
        'label',
        { title: (op.summary || op.id) + (names.length ? '\nChecks: ' + names.join(', ') : '\nNo checks apply with the current choices') },
        box,
        h('span', { class: 'method ' + op.method.toLowerCase(), text: op.method }),
        h('span', { class: 'path', text: op.path }),
        strip
      );
      ul.append(h('li', { class: state.off.has(op.id) ? 'off' : '' }, label));
    }
    if (!ops.length) ul.append(h('li', { class: 'empty', text: 'No operation matches the filter.' }));
    refreshCounts();
  }

  function refreshCounts() {
    const total = state.model.operations.length;
    const picked = state.model.operations.filter((op) => !state.off.has(op.id)).length;
    $('ops-title').textContent = 'Operations (' + picked + ' of ' + total + ' selected)';
  }

  function emit() {
    const plan = Plan.subset(state.full, (c) => !state.off.has(c.op));
    state.plan = plan;
    const perKind = {};
    for (const c of plan.cases) perKind[c.kind] = (perKind[c.kind] || 0) + 1;
    for (const k of Plan.KINDS) $('count-' + k.id).textContent = String(perKind[k.id] || 0);
    const empty = !plan.cases.length;
    $('copy').disabled = empty;
    $('download').disabled = empty;
    if (empty) {
      state.out = null;
      $('code').textContent = 'Nothing to generate. Select at least one operation and one kind of check.';
      $('needs').textContent = '';
      $('run').hidden = true;
      $('stats').textContent = '';
      return;
    }
    state.out = Emit.emit(state.target, plan);
    $('code').textContent = state.out.code;
    $('code').scrollTop = 0;
    $('needs').textContent = state.out.needs;
    $('run').textContent = state.out.run;
    $('run').hidden = !state.out.run;
    const assumed = plan.cases.filter((c) => c.expect.assumed).length;
    $('stats').textContent =
      plan.cases.length + ' tests for ' + plan.operations + (plan.operations === 1 ? ' operation' : ' operations') + ', saved as ' + state.out.file + '.' +
      (assumed ? ' ' + assumed + (assumed === 1 ? ' test expects' : ' tests expect') + ' a status the contract does not document; each is marked "assumed" in the code.' : '');
  }

  function flash(button, text) {
    const old = button.textContent;
    button.textContent = text;
    setTimeout(() => (button.textContent = old), 1400);
  }

  async function copyText(button, text) {
    try {
      await navigator.clipboard.writeText(text);
      flash(button, 'Copied');
    } catch (_) {
      flash(button, 'Copy failed');
    }
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }


  /* ------------------------------------------------------------ routing: what was given, and which view shows */
  function show(view) {
    const code = view === 'code';
    const contract = view === 'contract';
    $('loader').hidden = code || contract;
    $('intro').hidden = code || contract;
    $('code-setup').hidden = !code;
    $('unit').hidden = !code;
    $('loaded').hidden = !contract;
    $('result').hidden = !contract;
    if (!code && !contract) $('summary').textContent = 'Copy code or an API contract, paste it, or upload a file';
  }

  /* The single entry point for every input: clipboard, paste, upload, page capture and address. */
  function takeText(text, name, opts) {
    showError('');
    hideAllow('allow');
    const c = Detect.classify(text, name);
    if (c.kind === 'empty') return showError('There is nothing to read. Copy some code or a contract first.'), false;
    if (c.kind === 'contract') return load(text, name);
    if (c.kind === 'code') return showCode(text, name, c, opts || {}), true;
    showError('This does not look like source code or an OpenAPI contract. Copy a function, a class or a whole file, or a contract that starts with "openapi:" or "swagger:".');
    return false;
  }

  /* ------------------------------------------------------------ unit tests from code */
  function unitError(text) {
    $('unit-error').textContent = text;
    $('unit-error').hidden = !text;
  }

  function codeFileName() {
    return Detect.testFileName($('code-lang').value, $('code-text').value);
  }

  function showCode(text, name, c, opts) {
    show('code');
    unitError('');
    state.code = { name: name || '' };
    const lang = c.language ? c.language.id : 'go';
    $('code-lang').value = lang;
    $('code-framework').value = Detect.byId(lang).framework;
    $('code-text').value = text.replace(/\r\n/g, '\n');
    $('code-detected').textContent = c.language
      ? 'Recognised as ' + c.language.label + (c.language.confidence === 'low' ? ' (not sure: change it below if that is wrong)' : '') + ', ' + c.lines + (c.lines === 1 ? ' line' : ' lines') + (name ? ' from ' + name : '') + '.'
      : 'The language could not be recognised. Choose it below.';
    $('code-title').textContent = /\.[A-Za-z0-9]+$/.test(name || '') ? name : 'Code';
    const s = $('summary');
    s.textContent = '';
    s.append(h('strong', { text: 'Unit tests' }), ' for ' + (c.language ? c.language.label + ' code' : 'code') + (name ? ' from ' + name : ''));
    $('unit-out').textContent = '';
    $('unit-copy').disabled = true;
    $('unit-download').disabled = true;
    state.aiText = '';
    updateFileLine();
    refreshEngine().then((status) => {
      if (opts.auto && status === 'available') writeTests();
    });
  }

  function updateFileLine() {
    $('unit-file').textContent = 'Saved as ' + codeFileName();
  }

  let engineStatus = 'missing';
  async function refreshEngine() {
    engineStatus = await OnDevice.status();
    const ok = engineStatus === 'available' || engineStatus === 'downloadable' || engineStatus === 'downloading';
    const remote = $('use-remote').checked;
    $('engine').textContent = remote ? 'Tests will be written by the AI provider you set below.' : OnDevice.explain(engineStatus);
    $('engine').className = 'engine' + (ok || remote ? '' : ' bad');
    $('fallback').hidden = ok && !remote;
    if (!ok && !remote) $('fallback').open = true;
    $('unit-go').disabled = !ok && !remote;
    $('unit-go').textContent = remote || engineStatus === 'available' ? 'Write tests' : engineStatus === 'downloadable' ? 'Download the model and write tests' : 'Write tests';
    return engineStatus;
  }

  function setBusy(busy) {
    $('unit-go').hidden = busy;
    $('unit-stop').hidden = !busy;
    for (const id of ['code-lang', 'code-framework', 'code-notes', 'code-text']) $(id).disabled = busy;
  }

  async function writeTests() {
    unitError('');
    hideAllow('ai-allow');
    const code = $('code-text').value;
    if (!code.trim()) return unitError('There is no code to test.');
    const lang = Detect.byId($('code-lang').value);
    const remote = $('use-remote').checked;
    const prompt = Ai.buildUnitPrompt({
      code,
      language: lang.label,
      framework: $('code-framework').value,
      fileName: codeFileName(),
      notes: $('code-notes').value,
      limit: remote ? Ai.MAX_MATERIAL : Ai.MAX_LOCAL,
    });
    const out = $('unit-out');
    out.textContent = '';
    $('unit-copy').disabled = true;
    $('unit-download').disabled = true;
    state.aiText = '';
    state.abort = new AbortController();
    setBusy(true);
    const started = Date.now();
    const progress = $('unit-progress');
    $('engine').textContent = 'Writing tests\u2026';
    try {
      let text;
      if (remote) {
        text = await writeRemote(prompt, state.abort.signal);
        if (text === null) return;
      } else {
        text = await OnDevice.generate({
          system: prompt.system,
          user: prompt.user,
          signal: state.abort.signal,
          onProgress(p) {
            progress.hidden = p >= 1;
            progress.value = p;
            $('engine').textContent = 'Downloading Chrome\u2019s built-in model: ' + Math.round(p * 100) + '%. This happens once.';
          },
          onText(t) {
            progress.hidden = true;
            out.textContent = t;
          },
        });
        text = Ai.stripFence(text);
      }
      if (!text.trim()) throw new Error('The model returned nothing. Try again, or copy a smaller piece of code.');
      state.aiText = text;
      out.textContent = text;
      $('unit-copy').disabled = false;
      $('unit-download').disabled = false;
      const notes = ['Done in ' + Math.round((Date.now() - started) / 1000) + ' s.'];
      if (prompt.clipped) notes.push('Only the first ' + (remote ? Ai.MAX_MATERIAL : Ai.MAX_LOCAL).toLocaleString('en-US') + ' characters of the code were used.');
      $('engine').textContent = notes.join(' ');
    } catch (e) {
      unitError(String((e && e.message) || e));
      await refreshEngine();
    } finally {
      progress.hidden = true;
      setBusy(false);
      state.abort = null;
    }
  }

  async function writeRemote(prompt, signal) {
    const cfg = aiConfig();
    const req = Ai.buildRequest(cfg, prompt);
    saveAi();
    let res;
    let raw;
    try {
      res = await fetch(req.url, Object.assign({ credentials: 'omit', cache: 'no-store', signal }, req.init));
      raw = await res.text();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Stopped.');
      await offerAccess('ai-allow', new URL(req.url), writeTests, unitError);
      return null;
    }
    return Ai.readResponse(cfg.provider, res.status, raw).text;
  }

  function aiConfig() {
    return { provider: $('ai-provider').value, baseUrl: $('ai-base').value, model: $('ai-model').value, key: $('ai-key').value };
  }

  function saveAi() {
    const cfg = aiConfig();
    const keep = $('ai-keep').checked;
    local.set('ai', { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, keep, key: keep ? cfg.key : '' });
  }

  function applyProvider(previous) {
    const p = Ai.PROVIDERS[$('ai-provider').value];
    const before = previous ? Ai.PROVIDERS[previous] : null;
    if (!$('ai-base').value || (before && $('ai-base').value === before.baseUrl)) $('ai-base').value = p.baseUrl;
    if (!$('ai-model').value || (before && $('ai-model').value === before.model)) $('ai-model').value = p.model;
    $('ai-model').placeholder = p.model || 'The model name your provider uses';
  }

  async function readClipboard() {
    try {
      return await navigator.clipboard.readText();
    } catch (_) {
      return null;
    }
  }

  /* ------------------------------------------------------------ start */
  async function init() {
    const intro = $('intro-kinds');
    const kinds = $('kinds');
    for (const k of Plan.KINDS) {
      intro.append(h('li', {}, h('span', { class: 'slot on' }), h('span', {}, h('strong', { text: k.label + '. ' }), KIND_HELP[k.id])));
      const box = h('input', { type: 'checkbox', checked: true, id: 'kind-' + k.id });
      box.addEventListener('change', () => {
        state.kinds[k.id] = box.checked;
        local.set('prefs', { target: state.target, kinds: state.kinds });
        if (state.model) rebuild();
      });
      kinds.append(h('label', { class: 'kind', title: KIND_HELP[k.id] }, box, h('span', { class: 'slot on' }), h('span', { text: k.label }), h('span', { class: 'n', id: 'count-' + k.id, text: '0' })));
    }

    const prefs = (await local.get('prefs')) || {};
    if (Emit.TARGETS.some((t) => t.id === prefs.target)) state.target = prefs.target;
    if (prefs.kinds && typeof prefs.kinds === 'object') {
      for (const k of Plan.KINDS) {
        if (prefs.kinds[k.id] === false) {
          state.kinds[k.id] = false;
          $('kind-' + k.id).checked = false;
        }
      }
    }

    const targets = $('targets');
    for (const t of Emit.TARGETS) {
      const radio = h('input', { type: 'radio', name: 'target', value: t.id, checked: t.id === state.target });
      radio.addEventListener('change', () => {
        state.target = t.id;
        local.set('prefs', { target: state.target, kinds: state.kinds });
        if (state.model) emit();
      });
      targets.append(h('label', {}, radio, t.label));
    }

    // The three ways in.
    $('paste-clipboard').addEventListener('click', async () => {
      const text = await readClipboard();
      if (text === null) return showError('Chrome did not let SpecTest read the clipboard. Paste into the box below instead (Ctrl+V or \u2318V).');
      takeText(text, 'what you copied', { auto: true });
    });
    $('read-paste').addEventListener('click', () => takeText($('paste').value, 'pasted text', { auto: true }));
    $('pick-file').addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', () => {
      readFile($('file').files[0]);
      $('file').value = '';
    });
    const paste = $('paste');
    paste.addEventListener('dragover', (e) => {
      e.preventDefault();
      paste.classList.add('drop');
    });
    paste.addEventListener('dragleave', () => paste.classList.remove('drop'));
    paste.addEventListener('drop', (e) => {
      paste.classList.remove('drop');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        e.preventDefault();
        readFile(file);
      }
    });
    $('load-url').addEventListener('click', () => fetchSpec($('url').value));
    $('url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fetchSpec($('url').value);
    });
    $('sample').addEventListener('click', () => takeText(globalThis.SpecTestSample, 'the sample contract'));
    $('sample-code').addEventListener('click', () => takeText(globalThis.SpecTestSampleCode, 'the sample code'));
    for (const b of document.querySelectorAll('.reset')) {
      b.addEventListener('click', () => {
        if (state.abort) state.abort.abort();
        state.model = null;
        state.plan = null;
        state.code = null;
        show('start');
      });
    }

    // Contract view.
    let timer = 0;
    $('base-url').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.baseUrl = $('base-url').value.trim();
        if (state.model) rebuild();
      }, 250);
    });
    $('filter').addEventListener('input', () => {
      state.filter = $('filter').value;
      renderOps();
    });
    $('ops').addEventListener('change', (e) => {
      const box = e.target;
      if (!box || !box.dataset || !box.dataset.op) return;
      if (box.checked) state.off.delete(box.dataset.op);
      else state.off.add(box.dataset.op);
      box.closest('li').className = box.checked ? '' : 'off';
      refreshCounts();
      emit();
    });
    const setVisible = (on) => {
      for (const op of visibleOps()) {
        if (on) state.off.delete(op.id);
        else state.off.add(op.id);
      }
      renderOps();
      emit();
    };
    $('all').addEventListener('click', () => setVisible(true));
    $('none').addEventListener('click', () => setVisible(false));
    $('copy').addEventListener('click', () => state.out && copyText($('copy'), state.out.code));
    $('download').addEventListener('click', () => state.out && download(state.out.file, state.out.code));

    // Code view.
    const langSelect = $('code-lang');
    for (const l of Detect.LANGS) langSelect.append(h('option', { value: l.id, text: l.label }));
    langSelect.addEventListener('change', () => {
      $('code-framework').value = Detect.byId(langSelect.value).framework;
      updateFileLine();
    });
    $('unit-go').addEventListener('click', writeTests);
    $('unit-stop').addEventListener('click', () => state.abort && state.abort.abort());
    $('unit-copy').addEventListener('click', () => copyText($('unit-copy'), state.aiText));
    $('unit-download').addEventListener('click', () => download(codeFileName(), state.aiText));

    // Fallback provider settings, used only when the built-in model cannot run here.
    const provider = $('ai-provider');
    for (const id of Object.keys(Ai.PROVIDERS)) provider.append(h('option', { value: id, text: Ai.PROVIDERS[id].label }));
    const saved = (await local.get('ai')) || {};
    if (Ai.PROVIDERS[saved.provider]) provider.value = saved.provider;
    $('ai-base').value = typeof saved.baseUrl === 'string' ? saved.baseUrl : '';
    $('ai-model').value = typeof saved.model === 'string' ? saved.model : '';
    $('ai-keep').checked = saved.keep === true;
    if (saved.keep === true && typeof saved.key === 'string') $('ai-key').value = saved.key;
    applyProvider('');
    let lastProvider = provider.value;
    provider.addEventListener('change', () => {
      applyProvider(lastProvider);
      lastProvider = provider.value;
      saveAi();
    });
    for (const id of ['ai-base', 'ai-model', 'ai-keep', 'ai-key']) $(id).addEventListener('change', saveAi);
    $('use-remote').addEventListener('change', refreshEngine);

    // Text handed over by the toolbar button: what was copied, or the contract on the page.
    if (location.hash === '#capture') {
      let cap = null;
      try {
        cap = (await chrome.storage.session.get('capture')).capture || null;
        await chrome.storage.session.remove('capture');
      } catch (_) {
        cap = null;
      }
      history.replaceState(null, '', location.pathname);
      if (cap) {
        let name = cap.name || '';
        if (!name && cap.url) {
          try {
            const u = new URL(cap.url);
            name = u.hostname + u.pathname;
          } catch (_) {
            name = 'the page';
          }
        }
        if (cap.text) takeText(cap.text, name, { auto: true });
        else if (cap.specUrl) {
          $('url').value = cap.specUrl;
          await fetchSpec(cap.specUrl);
        }
      }
    }
  }

  init();
})();
