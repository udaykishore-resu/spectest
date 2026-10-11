/* SpecTest: turns the API model into a language-neutral list of test cases (the "plan").
   Every case is one HTTP request plus what the contract says must come back. */
(function (root) {
  'use strict';
  const Spec = root.SpecTestSpec || (typeof require === 'function' ? require('./spec.js') : null);
  const { view, typeOf, nullable, sample, isObj } = Spec;

  const KINDS = [
    { id: 'ok', label: 'Documented success response' },
    { id: 'missing', label: 'Missing required field or parameter' },
    { id: 'type', label: 'Wrong type in the body' },
    { id: 'invalid', label: 'Value outside enum or limits' },
    { id: 'auth', label: 'No credentials' },
    { id: 'notfound', label: 'Record that does not exist' },
  ];
  const CHECKED = ['string', 'integer', 'number', 'boolean', 'array', 'object'];

  function words(text) {
    return String(text)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function opWords(op) {
    let parts;
    if (op.named) parts = words(op.id).slice(0, 8);
    else {
      parts = [op.method.toLowerCase()];
      for (const seg of op.path.split('/')) {
        if (!seg) continue;
        const m = /^\{(.+)\}$/.exec(seg);
        if (m) parts.push('by', ...words(m[1]));
        else parts.push(...words(seg));
      }
      parts = parts.slice(0, 9);
    }
    return parts.length ? parts : [op.method.toLowerCase()];
  }

  function documented(op, lo, hi) {
    return Object.keys(op.responses)
      .filter((c) => /^\d{3}$/.test(c))
      .map(Number)
      .filter((c) => c >= lo && c <= hi)
      .sort((a, b) => a - b);
  }

  function expectOf(op, wanted) {
    const have = documented(op, 100, 599).filter((c) => wanted.includes(c));
    return have.length ? { status: have, assumed: false } : { status: wanted.slice(), assumed: true };
  }

  function paramValue(doc, p) {
    let v = p.example !== undefined ? p.example : sample(doc, p.schema, { mode: 'request' });
    if (Array.isArray(v)) v = v.length ? v[0] : 'string';
    if (isObj(v) || v === undefined || v === null) v = 'string';
    const s = String(v);
    return s === '' ? 'x' : s;
  }

  function missingValue(doc, p) {
    const v = view(doc, p.schema);
    const t = typeOf(v);
    if (t === 'integer' || t === 'number') {
      const max = typeof v.maximum === 'number' ? v.maximum : null;
      return String(max !== null && max < 999999999 ? max : 999999999);
    }
    if (String(v.format).toLowerCase() === 'uuid') return '00000000-0000-4000-8000-000000000000';
    return 'spectest-missing-0000';
  }

  function buildPath(op, values, query) {
    let path = op.path.replace(/\{([^}]+)\}/g, (m, name) => (name in values ? encodeURIComponent(values[name]) : m));
    if (query.length) path += '?' + query.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    return path;
  }

  function encodeBody(body, kind) {
    if (body === undefined) return null;
    if (kind === 'form') {
      if (!isObj(body)) return '';
      return Object.keys(body)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(isObj(body[k]) || Array.isArray(body[k]) ? JSON.stringify(body[k]) : String(body[k])))
        .join('&');
    }
    return JSON.stringify(body);
  }

  function wrongTypeValue(t) {
    if (t === 'string') return { spectest: 'wrong type' };
    if (t === 'integer' || t === 'number') return 'not-a-number';
    if (t === 'boolean') return 'not-a-boolean';
    if (t === 'array') return 'not-an-array';
    return 'not-an-object';
  }

  /* A value the schema forbids, or undefined when the schema sets no limit that can be broken safely. */
  function invalidValue(v) {
    const t = typeOf(v);
    if (Array.isArray(v.enum) && v.enum.length && (t === 'string' || !t)) return { value: 'spectest-invalid-value', why: 'not in the enum' };
    if (t === 'integer' || t === 'number') {
      if (typeof v.minimum === 'number') return { value: v.minimum - 1, why: 'below the minimum of ' + v.minimum };
      if (typeof v.exclusiveMinimum === 'number') return { value: v.exclusiveMinimum, why: 'not above ' + v.exclusiveMinimum };
      if (typeof v.maximum === 'number') return { value: v.maximum + 1, why: 'above the maximum of ' + v.maximum };
      if (typeof v.exclusiveMaximum === 'number') return { value: v.exclusiveMaximum, why: 'not below ' + v.exclusiveMaximum };
    }
    if (t === 'string') {
      if (typeof v.maxLength === 'number' && v.maxLength >= 0 && v.maxLength <= 2000) {
        return { value: 'x'.repeat(v.maxLength + 1), why: 'longer than ' + v.maxLength + ' characters' };
      }
      if (typeof v.minLength === 'number' && v.minLength >= 1) return { value: '', why: 'shorter than ' + v.minLength + ' character' + (v.minLength === 1 ? '' : 's') };
    }
    return undefined;
  }

  function fieldsOf(doc, v) {
    const out = [];
    const props = isObj(v.properties) ? v.properties : {};
    for (const name of Array.isArray(v.required) ? v.required : []) {
      if (typeof name !== 'string') continue;
      if (!(name in props)) {
        out.push({ name, type: '' });
      } else {
        const pv = view(doc, props[name]);
        if (pv.writeOnly === true) continue;
        const t = typeOf(pv);
        out.push({ name, type: CHECKED.includes(t) && !nullable(pv) && !pv._alternatives ? t : '' });
      }
      if (out.length >= 12) break;
    }
    return out;
  }

  function jsonExpectation(doc, op, statuses) {
    for (const code of statuses) {
      const r = op.responses[String(code)];
      if (!r || !r.schema) continue;
      const v = view(doc, r.schema);
      if (v._alternatives) continue; // several shapes are allowed; a field check would be a guess
      const t = typeOf(v);
      if (t === 'object') return { code, kind: 'object', fields: fieldsOf(doc, v) };
      if (t === 'array') {
        const iv = v.items ? view(doc, v.items) : {};
        return { code, kind: 'array', fields: iv._alternatives ? [] : fieldsOf(doc, iv) };
      }
    }
    return null;
  }

  function build(model, opts) {
    opts = opts || {};
    const doc = model.doc;
    const on = (k) => !opts.kinds || opts.kinds[k] !== false;
    const cases = [];
    const used = new Set();
    const notes = [];

    for (const op of model.operations) {
      if (opts.only && !opts.only.has(op.id)) continue;
      const base = opWords(op);
      const label = op.method + ' ' + op.path;
      const pathParams = op.params.filter((p) => p.in === 'path');
      const values = {};
      for (const p of pathParams) values[p.name] = paramValue(doc, p);
      const reqQuery = op.params.filter((p) => p.in === 'query' && p.required).map((p) => [p.name, paramValue(doc, p)]);
      const headers = op.params
        .filter((p) => p.in === 'header' && p.required && !/^(accept|content-type|authorization)$/i.test(p.name))
        .map((p) => [p.name, paramValue(doc, p)]);

      let bodyObj;
      let bodyKind = '';
      let contentType = '';
      let bodyView = null;
      if (op.body && op.body.kind !== 'other' && !['GET', 'HEAD', 'OPTIONS'].includes(op.method)) {
        bodyKind = op.body.kind;
        contentType = op.body.contentType;
        bodyView = view(doc, op.body.schema);
        bodyObj = op.body.example !== undefined ? op.body.example : sample(doc, op.body.schema, { mode: 'request', fallback: {} });
        if (bodyObj === undefined) bodyObj = {};
      }

      const add = (kind, suffix, title, change, expect) => {
        const c = {
          op: op.id,
          kind,
          words: base.concat(suffix),
          opLen: base.length,
          title: label + ': ' + title,
          method: op.method,
          path: buildPath(op, values, reqQuery),
          headers: headers.map((h) => h.slice()),
          body: encodeBody(bodyObj, bodyKind),
          contentType,
          auth: op.auth,
          expect: { status: expect.status, assumed: expect.assumed, json: null },
        };
        if (change) change(c);
        const key = c.words.join('_');
        if (used.has(key)) {
          let n = 2;
          while (used.has(key + '_' + n)) n++;
          c.words = c.words.concat(String(n));
        }
        used.add(c.words.join('_'));
        cases.push(c);
        return c;
      };

      // 1. The documented success response.
      if (on('ok')) {
        let ok = documented(op, 200, 299);
        let assumed = false;
        if (!ok.length) {
          ok = [200, 201, 202, 204];
          assumed = true;
        }
        const c = add('ok', ['ok'], 'returns the documented success response', null, { status: ok, assumed });
        if (op.method !== 'HEAD') c.expect.json = jsonExpectation(doc, op, ok);
      }

      const validation = () => expectOf(op, [400, 422]);
      const bodyIsObject = !!bodyKind && isObj(bodyObj) && !!bodyView && typeOf(bodyView) === 'object' && !bodyView._alternatives;
      const props = bodyIsObject && isObj(bodyView.properties) ? bodyView.properties : {};
      const required = bodyIsObject && Array.isArray(bodyView.required) ? bodyView.required.filter((n) => typeof n === 'string') : [];

      // 2. Missing required body fields (first two) and a missing required query parameter.
      if (on('missing')) {
        for (const name of required.filter((n) => n in bodyObj).slice(0, 2)) {
          add('missing', ['missing', ...words(name)], 'rejects a body without required "' + name + '"', (c) => {
            const copy = Object.assign({}, bodyObj);
            delete copy[name];
            c.body = encodeBody(copy, bodyKind);
          }, validation());
        }
        if (reqQuery.length) {
          const name = reqQuery[0][0];
          add('missing', ['missing', 'query', ...words(name)], 'rejects a request without required query parameter "' + name + '"', (c) => {
            c.path = buildPath(op, values, reqQuery.slice(1));
          }, validation());
        }
      }

      // 3. One body field with the wrong JSON type.
      if (on('type') && bodyIsObject && bodyKind === 'json') {
        const names = Object.keys(props).filter((n) => {
          const pv = view(doc, props[n]);
          return !pv.readOnly && !pv._alternatives && CHECKED.includes(typeOf(pv));
        });
        const rank = (n) => (typeOf(view(doc, props[n])) === 'string' ? 2 : 0) + (required.includes(n) ? 0 : 1);
        names.sort((a, b) => rank(a) - rank(b));
        if (names.length) {
          const name = names[0];
          const t = typeOf(view(doc, props[name]));
          add('type', ['wrong', 'type', ...words(name)], 'rejects "' + name + '" sent as the wrong type (contract says ' + t + ')', (c) => {
            c.body = encodeBody(Object.assign({}, bodyObj, { [name]: wrongTypeValue(t) }), bodyKind);
          }, validation());
        }
      }

      // 4. One value the schema forbids: in the body, else in a query parameter.
      if (on('invalid')) {
        let done = false;
        if (bodyIsObject) {
          for (const name of Object.keys(props)) {
            const pv = view(doc, props[name]);
            if (pv.readOnly || pv._alternatives) continue;
            const bad = invalidValue(pv);
            if (!bad) continue;
            add('invalid', ['invalid', ...words(name)], 'rejects "' + name + '" ' + bad.why, (c) => {
              c.body = encodeBody(Object.assign({}, bodyObj, { [name]: bad.value }), bodyKind);
            }, validation());
            done = true;
            break;
          }
        }
        if (!done) {
          for (const p of op.params.filter((x) => x.in === 'query')) {
            const bad = invalidValue(view(doc, p.schema));
            if (!bad || bad.value === '') continue;
            add('invalid', ['invalid', 'query', ...words(p.name)], 'rejects query parameter "' + p.name + '" ' + bad.why, (c) => {
              c.path = buildPath(op, values, reqQuery.filter((x) => x[0] !== p.name).concat([[p.name, String(bad.value)]]));
            }, validation());
            break;
          }
        }
      }

      // 5. No credentials.
      if (on('auth') && op.auth) {
        add('auth', ['no', 'credentials'], 'refuses a request without credentials', (c) => {
          c.auth = '';
        }, expectOf(op, [401, 403]));
      }

      // 6. A record that does not exist, only where the contract documents 404.
      if (on('notfound') && pathParams.length && documented(op, 404, 404).length && ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(op.method)) {
        const last = pathParams[pathParams.length - 1];
        add('notfound', ['not', 'found'], 'returns 404 for a "' + last.name + '" that does not exist', (c) => {
          c.path = buildPath(op, Object.assign({}, values, { [last.name]: missingValue(doc, last) }), reqQuery);
        }, { status: [404], assumed: false });
      }
    }

    if (cases.some((c) => c.expect.assumed)) {
      notes.push('Where the contract documents no response for a case, the expected status is an assumption and is marked "assumed" in the code.');
    }
    const auth = {};
    for (const c of cases) if (c.auth && model.schemes[c.auth]) auth[c.auth] = model.schemes[c.auth];
    return {
      title: model.title,
      version: model.version,
      baseUrl: String(opts.baseUrl || model.servers[0] || 'http://localhost:8080').replace(/\/+$/, ''),
      auth,
      cases,
      notes,
      operations: new Set(cases.map((c) => c.op)).size,
    };
  }

  /* The same plan with only the cases that pass the filter, and only the credentials those cases use. */
  function subset(plan, keep) {
    const cases = plan.cases.filter(keep);
    const auth = {};
    for (const c of cases) if (c.auth && plan.auth[c.auth]) auth[c.auth] = plan.auth[c.auth];
    return Object.assign({}, plan, { cases, auth, operations: new Set(cases.map((c) => c.op)).size });
  }

  const api = { build, subset, words, opWords, KINDS };
  root.SpecTestPlan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
