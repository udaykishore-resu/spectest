/* SpecTest generator page: load a contract, choose what to check, read and download the tests. */
(function () {
  'use strict';
  const Spec = globalThis.SpecTestSpec;
  const Plan = globalThis.SpecTestPlan;
  const Emit = globalThis.SpecTestEmit;
  const Ai = globalThis.SpecTestAi;
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

  const state = { model: null, name: '', kinds: {}, off: new Set(), target: 'go', baseUrl: '', filter: '', full: null, plan: null, out: null, aiText: '' };
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
      load(await res.text(), url.hostname + url.pathname);
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
    reader.onload = () => load(String(reader.result || ''), file.name);
    reader.onerror = () => showError('The file could not be read.');
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------ rendering */
  function renderLoaded() {
    const m = state.model;
    $('loader').hidden = true;
    $('loaded').hidden = false;
    $('intro').hidden = true;
    $('result').hidden = false;
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
    $('ai-plan-label').textContent = 'The loaded contract (' + plan.cases.length + ' test cases from ' + plan.operations + ' operations)';
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

  /* ------------------------------------------------------------ AI mode */
  function aiError(text) {
    $('ai-error').textContent = text;
    $('ai-error').hidden = !text;
  }

  function aiConfig() {
    return { provider: $('ai-provider').value, baseUrl: $('ai-base').value, model: $('ai-model').value, key: $('ai-key').value };
  }

  function saveAi() {
    const cfg = aiConfig();
    const keep = $('ai-keep').checked;
    local.set('ai', { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, target: $('ai-target').value, keep, key: keep ? cfg.key : '' });
  }

  function applyProvider(previous) {
    const p = Ai.PROVIDERS[$('ai-provider').value];
    const before = previous ? Ai.PROVIDERS[previous] : null;
    if (!$('ai-base').value || (before && $('ai-base').value === before.baseUrl)) $('ai-base').value = p.baseUrl;
    if (!$('ai-model').value || (before && $('ai-model').value === before.model)) $('ai-model').value = p.model;
    $('ai-model').placeholder = p.model || 'The model name your provider uses';
  }

  async function generateAi() {
    aiError('');
    hideAllow('ai-allow');
    $('ai-status').textContent = '';
    const kind = $('ai-kind-code').checked ? 'code' : 'plan';
    let material;
    let title = '';
    if (kind === 'plan') {
      if (!state.plan || !state.plan.cases.length) return aiError('Load a contract and select at least one operation first, or choose "Code I paste below".');
      material = Emit.emit('plan', state.plan).code;
      title = state.plan.title;
    } else {
      material = $('ai-code').value;
      if (!material.trim()) return aiError('Paste the code you want tests for.');
    }
    const cfg = aiConfig();
    let prompt;
    let req;
    try {
      prompt = Ai.buildPrompt({ kind, target: $('ai-target').value, notes: $('ai-notes').value, material, title });
      req = Ai.buildRequest(cfg, prompt);
    } catch (e) {
      return aiError(String((e && e.message) || e));
    }
    saveAi();
    const button = $('ai-go');
    button.disabled = true;
    const started = Date.now();
    const tick = setInterval(() => ($('ai-status').textContent = 'Waiting for the model, ' + Math.round((Date.now() - started) / 1000) + ' s'), 1000);
    $('ai-status').textContent = 'Waiting for the model';
    try {
      let res;
      let raw;
      try {
        res = await fetch(req.url, Object.assign({ credentials: 'omit', cache: 'no-store' }, req.init));
        raw = await res.text();
      } catch (_) {
        $('ai-status').textContent = '';
        return await offerAccess('ai-allow', new URL(req.url), generateAi, aiError);
      }
      const out = Ai.readResponse(cfg.provider, res.status, raw);
      state.aiText = out.text;
      $('ai-code-out').textContent = out.text;
      $('ai-result').hidden = false;
      const notes = [];
      if (out.cut) notes.push('The answer was cut off at the length limit. Select fewer operations or paste less code.');
      if (prompt.clipped) notes.push('Only the first ' + Ai.MAX_MATERIAL.toLocaleString('en-US') + ' characters were sent.');
      $('ai-status').textContent = notes.length ? notes.join(' ') : 'Done in ' + Math.round((Date.now() - started) / 1000) + ' s.';
    } catch (e) {
      $('ai-status').textContent = '';
      aiError(String((e && e.message) || e));
    } finally {
      clearInterval(tick);
      button.disabled = false;
    }
  }

  function showTab(name) {
    const ai = name === 'ai';
    $('tab-contract').setAttribute('aria-selected', String(!ai));
    $('tab-ai').setAttribute('aria-selected', String(ai));
    $('contract').hidden = ai;
    $('ai').hidden = !ai;
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

    $('read-paste').addEventListener('click', () => load($('paste').value, 'pasted text'));
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
    $('sample').addEventListener('click', () => load(globalThis.SpecTestSample, 'the sample contract'));
    $('reset').addEventListener('click', () => {
      state.model = null;
      state.plan = null;
      $('loaded').hidden = true;
      $('loader').hidden = false;
      $('result').hidden = true;
      $('intro').hidden = false;
      $('summary').textContent = 'No contract loaded yet';
      $('ai-plan-label').textContent = 'The loaded contract';
    });

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

    $('tab-contract').addEventListener('click', () => showTab('contract'));
    $('tab-ai').addEventListener('click', () => showTab('ai'));

    const provider = $('ai-provider');
    for (const id of Object.keys(Ai.PROVIDERS)) provider.append(h('option', { value: id, text: Ai.PROVIDERS[id].label }));
    const saved = (await local.get('ai')) || {};
    if (Ai.PROVIDERS[saved.provider]) provider.value = saved.provider;
    $('ai-base').value = typeof saved.baseUrl === 'string' ? saved.baseUrl : '';
    $('ai-model').value = typeof saved.model === 'string' ? saved.model : '';
    $('ai-target').value = typeof saved.target === 'string' ? saved.target : '';
    $('ai-keep').checked = saved.keep === true;
    if (saved.keep === true && typeof saved.key === 'string') $('ai-key').value = saved.key;
    applyProvider('');
    let lastProvider = provider.value;
    provider.addEventListener('change', () => {
      applyProvider(lastProvider);
      lastProvider = provider.value;
      saveAi();
    });
    for (const id of ['ai-base', 'ai-model', 'ai-target', 'ai-keep', 'ai-key']) $(id).addEventListener('change', saveAi);
    const kindChanged = () => ($('ai-code').hidden = !$('ai-kind-code').checked);
    $('ai-kind-plan').addEventListener('change', kindChanged);
    $('ai-kind-code').addEventListener('change', kindChanged);
    $('ai-go').addEventListener('click', generateAi);
    $('ai-copy').addEventListener('click', () => copyText($('ai-copy'), state.aiText));
    $('ai-download').addEventListener('click', () => download('generated-tests.txt', state.aiText));

    // Text handed over by the toolbar button.
    if (location.hash === '#capture' || location.hash === '#ai') {
      let cap = null;
      try {
        cap = (await chrome.storage.session.get('capture')).capture || null;
        await chrome.storage.session.remove('capture');
      } catch (_) {
        cap = null;
      }
      history.replaceState(null, '', location.pathname);
      if (cap && cap.mode === 'ai') {
        showTab('ai');
        $('ai-kind-code').checked = true;
        kindChanged();
        $('ai-code').value = String(cap.selection || '');
      } else if (cap) {
        let name = '';
        try {
          const u = new URL(cap.url);
          name = u.hostname + u.pathname;
        } catch (_) {
          name = 'the page';
        }
        if (cap.text && load(cap.text, name)) return;
        if (cap.specUrl) {
          $('url').value = cap.specUrl;
          await fetchSpec(cap.specUrl);
        }
      }
    }
  }

  init();
})();
