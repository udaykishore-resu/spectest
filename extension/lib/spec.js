/* SpecTest: reads an OpenAPI 3.x or Swagger 2.0 document into one plain model, and builds sample values from schemas.
   Loads in the extension page and in Node (tests). */
(function (root) {
  'use strict';

  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'query'];
  const JSON_TYPE = /^application\/([\w.-]+\+)?json\b|^\*\/\*$|^application\/\*$/i;
  const FORM_TYPE = /^application\/x-www-form-urlencoded\b/i;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

  function parseOne(s, yaml) {
    let doc;
    if (s[0] === '{') {
      try {
        doc = JSON.parse(s);
      } catch (e) {
        throw new Error('The JSON does not parse: ' + e.message);
      }
    } else {
      if (!yaml) throw new Error('The YAML reader is not loaded.');
      try {
        let schema = yaml.CORE_SCHEMA;
        try {
          schema = yaml.CORE_SCHEMA.extend([yaml.types.merge]);
        } catch (_) {
          /* merge keys are optional */
        }
        doc = yaml.load(s, { schema });
      } catch (e) {
        throw new Error('The YAML does not parse: ' + (e.reason || e.message));
      }
    }
    if (!isObj(doc)) throw new Error('This is not an OpenAPI or Swagger document.');
    if (typeof doc.openapi !== 'string' && doc.swagger === undefined) {
      throw new Error('This is not an OpenAPI or Swagger document: it has no "openapi" or "swagger" version field.');
    }
    if (!isObj(doc.paths) || !Object.keys(doc.paths).length) {
      throw new Error('The document describes no paths, so there is nothing to test.');
    }
    return doc;
  }

  /* Accepts JSON or YAML. If the text is prose with the document inside a fenced code block, the block is used. */
  function parseText(text, yaml) {
    const s = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!s) throw new Error('There is no text to read.');
    try {
      return parseOne(s, yaml);
    } catch (first) {
      const blocks = [];
      const fence = /^```[^\n]*\n([\s\S]*?)^```/gm;
      for (let m = fence.exec(s); m; m = fence.exec(s)) blocks.push(m[1].trim());
      blocks.sort((a, b) => b.length - a.length);
      for (const b of blocks.slice(0, 5)) {
        try {
          if (b) return parseOne(b, yaml);
        } catch (_) {
          /* try the next block */
        }
      }
      throw first;
    }
  }

  function pointer(doc, ref) {
    if (typeof ref !== 'string' || ref[0] !== '#') return undefined;
    let cur = doc;
    for (const raw of ref.slice(1).split('/').slice(1)) {
      let key = raw;
      try {
        key = decodeURIComponent(raw);
      } catch (_) {
        /* keep raw */
      }
      key = key.replace(/~1/g, '/').replace(/~0/g, '~');
      if (cur === null || typeof cur !== 'object' || !has(cur, key)) return undefined;
      cur = cur[key];
    }
    return cur;
  }

  function deref(doc, node, warn) {
    let hops = 0;
    while (isObj(node) && typeof node.$ref === 'string') {
      const next = pointer(doc, node.$ref);
      if (next === undefined || ++hops > 20) {
        if (warn) {
          warn(
            node.$ref[0] === '#'
              ? 'Reference not found in this document: ' + node.$ref
              : 'Reference to another file is not followed: ' + node.$ref
          );
        }
        return null;
      }
      node = next;
    }
    return node;
  }

  /* One flat look at a schema: references followed, allOf merged, first usable oneOf/anyOf branch taken. */
  function view(doc, schema, depth) {
    schema = deref(doc, schema);
    if (!isObj(schema)) return {};
    depth = depth || 0;
    if (Array.isArray(schema.allOf) && depth < 8) {
      const out = Object.assign({}, schema);
      delete out.allOf;
      out.properties = Object.assign({}, isObj(schema.properties) ? schema.properties : {});
      out.required = Array.isArray(schema.required) ? schema.required.slice() : [];
      for (const part of schema.allOf) {
        const v = view(doc, part, depth + 1);
        for (const k of Object.keys(v)) {
          if (k === 'properties') {
            if (isObj(v.properties)) Object.assign(out.properties, v.properties);
          } else if (k === 'required') {
            for (const r of Array.isArray(v.required) ? v.required : []) if (!out.required.includes(r)) out.required.push(r);
          } else if (out[k] === undefined) out[k] = v[k];
        }
      }
      if (!Object.keys(out.properties).length) delete out.properties;
      if (!out.required.length) delete out.required;
      return out;
    }
    const alt = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null;
    if (alt && alt.length && !schema.type && !schema.properties && depth < 8) {
      for (const a of alt) {
        const v = view(doc, a, depth + 1);
        if (typeOf(v) !== 'null') return Object.assign({}, v, { _alternatives: alt.length });
      }
    }
    return schema;
  }

  function typeOf(v) {
    let t = v.type;
    if (Array.isArray(t)) t = t.find((x) => x !== 'null') || 'null';
    if (!t) {
      if (isObj(v.properties) || v.additionalProperties) t = 'object';
      else if (v.items) t = 'array';
      else if (Array.isArray(v.enum) && v.enum.length) {
        const e = v.enum.find((x) => x !== null);
        t = typeof e === 'number' ? 'number' : typeof e === 'boolean' ? 'boolean' : typeof e === 'string' ? 'string' : '';
      }
    }
    return typeof t === 'string' ? t : '';
  }

  const nullable = (v) => v.nullable === true || v['x-nullable'] === true || (Array.isArray(v.type) && v.type.includes('null'));

  const STRING_FORMATS = {
    'date-time': '2024-01-15T10:30:00Z',
    date: '2024-01-15',
    time: '10:30:00Z',
    uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    email: 'user@example.com',
    'idn-email': 'user@example.com',
    uri: 'https://example.com/resource',
    url: 'https://example.com/resource',
    'uri-reference': '/resource',
    hostname: 'example.com',
    ipv4: '192.0.2.1',
    ipv6: '2001:db8::1',
    byte: 'c3BlY3Rlc3Q=',
    binary: 'spectest',
    password: 'S3cure-pass!',
  };

  function sampleString(v) {
    const f = str(v.format).toLowerCase();
    if (has(STRING_FORMATS, f)) return STRING_FORMATS[f];
    let s = 'string';
    const min = typeof v.minLength === 'number' ? v.minLength : 0;
    const max = typeof v.maxLength === 'number' ? v.maxLength : Infinity;
    if (min > s.length) s += 'x'.repeat(Math.min(min, 4096) - s.length);
    if (s.length > max) s = s.slice(0, Math.max(0, max));
    return s;
  }

  function sampleNumber(v, integer) {
    const step = integer ? 1 : 0.5;
    let lo = typeof v.minimum === 'number' ? v.minimum : null;
    let hi = typeof v.maximum === 'number' ? v.maximum : null;
    if (typeof v.exclusiveMinimum === 'number') lo = v.exclusiveMinimum + step;
    else if (v.exclusiveMinimum === true && lo !== null) lo += step;
    if (typeof v.exclusiveMaximum === 'number') hi = v.exclusiveMaximum - step;
    else if (v.exclusiveMaximum === true && hi !== null) hi -= step;
    let n = lo !== null ? lo : 1;
    if (hi !== null && n > hi) n = hi;
    if (integer) n = lo !== null ? Math.ceil(n) : Math.floor(n);
    if (typeof v.multipleOf === 'number' && v.multipleOf > 0) {
      const m = Math.ceil(n / v.multipleOf) * v.multipleOf;
      if (hi === null || m <= hi) n = Number(m.toFixed(10));
    }
    return n;
  }

  /* opts.mode: 'request' leaves out readOnly properties. opts.all: include optional properties too. */
  function sample(doc, schema, opts, stack) {
    opts = opts || {};
    stack = stack || [];
    if (isObj(schema) && typeof schema.$ref === 'string') {
      if (stack.includes(schema.$ref) || stack.length > 12) return undefined; // recursive schema: stop here
      stack = stack.concat(schema.$ref);
    }
    const v = view(doc, schema);
    if (v.example !== undefined) return v.example;
    if (Array.isArray(v.examples) && v.examples.length) return v.examples[0];
    if (v.const !== undefined) return v.const;
    if (v.default !== undefined && v.default !== null) return v.default;
    if (Array.isArray(v.enum) && v.enum.length) {
      const e = v.enum.find((x) => x !== null);
      return e === undefined ? v.enum[0] : e;
    }
    switch (typeOf(v)) {
      case 'object': {
        const out = {};
        const props = isObj(v.properties) ? v.properties : {};
        const req = Array.isArray(v.required) ? v.required : [];
        const names = Object.keys(props);
        const pick = opts.all || !req.length ? names : names.filter((n) => req.includes(n));
        for (const n of pick) {
          const pv = view(doc, props[n]);
          if (opts.mode === 'request' && pv.readOnly === true) continue;
          const val = sample(doc, props[n], opts, stack);
          if (val !== undefined) out[n] = val;
        }
        return out;
      }
      case 'array': {
        const item = v.items ? sample(doc, v.items, opts, stack) : 'string';
        return item === undefined ? [] : [item];
      }
      case 'integer':
        return sampleNumber(v, true);
      case 'number':
        return sampleNumber(v, false);
      case 'boolean':
        return true;
      case 'null':
        return null;
      case 'string':
        return sampleString(v);
      default:
        return opts.fallback !== undefined ? opts.fallback : 'string';
    }
  }

  function serverUrl(s) {
    if (!isObj(s) || typeof s.url !== 'string') return '';
    return s.url.replace(/\{([^}]+)\}/g, (m, name) => {
      const variable = isObj(s.variables) ? s.variables[name] : null;
      return isObj(variable) && variable.default !== undefined ? String(variable.default) : m;
    });
  }

  function readScheme(name, raw) {
    if (!isObj(raw)) return null;
    const type = str(raw.type).toLowerCase();
    if (type === 'http') {
      const scheme = str(raw.scheme).toLowerCase();
      if (scheme === 'basic') return { key: name, in: 'header', name: 'Authorization', prefix: 'Basic ', hint: 'base64 of user:password' };
      return { key: name, in: 'header', name: 'Authorization', prefix: 'Bearer ', hint: 'bearer token' };
    }
    if (type === 'basic') return { key: name, in: 'header', name: 'Authorization', prefix: 'Basic ', hint: 'base64 of user:password' };
    if (type === 'oauth2' || type === 'openidconnect') {
      return { key: name, in: 'header', name: 'Authorization', prefix: 'Bearer ', hint: 'access token' };
    }
    if (type === 'apikey' && typeof raw.name === 'string' && raw.name) {
      const where = str(raw.in).toLowerCase();
      if (where === 'header') return { key: name, in: 'header', name: raw.name, prefix: '', hint: 'API key' };
      if (where === 'query') return { key: name, in: 'query', name: raw.name, prefix: '', hint: 'API key' };
      if (where === 'cookie') return { key: name, in: 'header', name: 'Cookie', prefix: raw.name + '=', hint: 'cookie value' };
    }
    return null;
  }

  function mediaExample(doc, media) {
    if (!isObj(media)) return undefined;
    if (media.example !== undefined) return media.example;
    if (isObj(media.examples)) {
      for (const k of Object.keys(media.examples)) {
        const ex = deref(doc, media.examples[k]);
        if (isObj(ex) && ex.value !== undefined) return ex.value;
      }
    }
    return undefined;
  }

  function pickContent(doc, content) {
    if (!isObj(content)) return null;
    const types = Object.keys(content);
    const json = types.find((t) => JSON_TYPE.test(t));
    if (json) {
      const media = isObj(content[json]) ? content[json] : {};
      return { contentType: /^\*|^application\/\*/.test(json) ? 'application/json' : json, kind: 'json', schema: media.schema, example: mediaExample(doc, media) };
    }
    const form = types.find((t) => FORM_TYPE.test(t));
    if (form) return { contentType: 'application/x-www-form-urlencoded', kind: 'form', schema: isObj(content[form]) ? content[form].schema : null };
    return types.length ? { contentType: types[0], kind: 'other', schema: null } : null;
  }

  function read(doc) {
    const warnings = [];
    const warn = (m) => {
      if (warnings.length < 40 && !warnings.includes(m)) warnings.push(m);
    };
    const v2 = typeof doc.openapi !== 'string';
    const info = isObj(doc.info) ? doc.info : {};
    const model = {
      kind: v2 ? 'Swagger ' + str(doc.swagger) : 'OpenAPI ' + doc.openapi,
      title: str(info.title) || 'API',
      version: str(info.version),
      servers: [],
      schemes: {},
      operations: [],
      warnings,
      doc,
    };

    if (v2) {
      if (typeof doc.host === 'string' && doc.host) {
        const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? (doc.schemes.includes('https') ? 'https' : doc.schemes[0]) : 'https';
        model.servers.push(scheme + '://' + doc.host + str(doc.basePath).replace(/\/$/, ''));
      } else if (typeof doc.basePath === 'string' && doc.basePath !== '/') {
        model.servers.push(doc.basePath.replace(/\/$/, ''));
      }
    } else if (Array.isArray(doc.servers)) {
      for (const s of doc.servers) {
        const u = serverUrl(s);
        if (u) model.servers.push(u.replace(/\/$/, ''));
      }
    }

    const rawSchemes = v2 ? doc.securityDefinitions : isObj(doc.components) ? doc.components.securitySchemes : null;
    if (isObj(rawSchemes)) {
      for (const name of Object.keys(rawSchemes)) {
        const s = readScheme(name, deref(doc, rawSchemes[name]));
        if (s) model.schemes[name] = s;
        else warn('Security scheme "' + name + '" is a kind SpecTest cannot send; operations that need it get no credential.');
      }
    }

    const seenIds = new Set();
    for (const path of Object.keys(doc.paths)) {
      if (path[0] !== '/') continue;
      const item = deref(doc, doc.paths[path], warn);
      if (!isObj(item)) continue;
      for (const method of METHODS) {
        const raw = item[method];
        if (!isObj(raw)) continue;
        const op = readOperation(doc, v2, path, method, item, raw, model, warn);
        let id = op.id;
        for (let n = 2; seenIds.has(id); n++) id = op.id + '_' + n;
        op.id = id;
        seenIds.add(id);
        model.operations.push(op);
      }
    }
    if (!model.operations.length) throw new Error('The document has paths but no operations under them.');
    return model;
  }

  function readOperation(doc, v2, path, method, item, raw, model, warn) {
    const op = {
      id: typeof raw.operationId === 'string' && raw.operationId.trim() ? raw.operationId.trim() : method + ' ' + path,
      named: typeof raw.operationId === 'string' && !!raw.operationId.trim(),
      method: method.toUpperCase(),
      path,
      summary: str(raw.summary || raw.description).split('\n')[0].slice(0, 140),
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
      deprecated: raw.deprecated === true,
      params: [],
      body: null,
      responses: {},
      auth: '',
    };

    const merged = new Map();
    const formFields = [];
    let bodyParam = null;
    for (const list of [item.parameters, raw.parameters]) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const p = deref(doc, entry, warn);
        if (!isObj(p) || typeof p.name !== 'string') continue;
        const where = str(p.in).toLowerCase();
        if (v2 && where === 'body') {
          bodyParam = p;
          continue;
        }
        if (v2 && where === 'formdata') {
          formFields.push(p);
          continue;
        }
        if (where !== 'path' && where !== 'query' && where !== 'header') continue;
        let schema = p.schema;
        if (!schema && isObj(p.content)) {
          const first = Object.keys(p.content)[0];
          schema = first && isObj(p.content[first]) ? p.content[first].schema : null;
        }
        if (!schema && v2) schema = p; // Swagger 2 puts type/enum/minimum on the parameter itself
        merged.set(where + ':' + p.name, {
          name: p.name,
          in: where,
          required: where === 'path' ? true : p.required === true,
          schema: schema || {},
          example: p.example !== undefined ? p.example : v2 && p['x-example'] !== undefined ? p['x-example'] : undefined,
        });
      }
    }
    op.params = Array.from(merged.values());

    if (v2) {
      const consumes = Array.isArray(raw.consumes) ? raw.consumes : Array.isArray(doc.consumes) ? doc.consumes : [];
      if (bodyParam) {
        const other = consumes.length && !consumes.some((c) => JSON_TYPE.test(c));
        op.body = other
          ? { required: bodyParam.required === true, contentType: consumes[0], kind: 'other', schema: null }
          : { required: bodyParam.required === true, contentType: 'application/json', kind: 'json', schema: bodyParam.schema || {} };
      } else if (formFields.length) {
        if (formFields.some((f) => f.type === 'file') || (consumes.length && consumes.every((c) => /multipart/i.test(c)))) {
          op.body = { required: true, contentType: 'multipart/form-data', kind: 'other', schema: null };
        } else {
          const props = {};
          const required = [];
          for (const f of formFields) {
            props[f.name] = f;
            if (f.required === true) required.push(f.name);
          }
          op.body = { required: required.length > 0, contentType: 'application/x-www-form-urlencoded', kind: 'form', schema: { type: 'object', properties: props, required } };
        }
      }
    } else {
      const rb = deref(doc, raw.requestBody, warn);
      if (isObj(rb)) {
        const c = pickContent(doc, rb.content);
        if (c) op.body = { required: rb.required === true, contentType: c.contentType, kind: c.kind, schema: c.schema || {}, example: c.example };
      }
    }
    if (op.body && op.body.kind === 'other') {
      warn(op.method + ' ' + path + ' takes ' + op.body.contentType + ', which SpecTest does not build; its tests send no body.');
    }

    const produces = v2 ? (Array.isArray(raw.produces) ? raw.produces : Array.isArray(doc.produces) ? doc.produces : []) : [];
    if (isObj(raw.responses)) {
      for (const code of Object.keys(raw.responses)) {
        const r = deref(doc, raw.responses[code], warn);
        if (!isObj(r)) continue;
        let schema = null;
        if (v2) {
          if (r.schema && (!produces.length || produces.some((p) => JSON_TYPE.test(p)))) schema = r.schema;
        } else {
          const c = pickContent(doc, r.content);
          if (c && c.kind === 'json') schema = c.schema || null;
        }
        op.responses[String(code).toUpperCase()] = { schema };
      }
    }

    const reqs = Array.isArray(raw.security) ? raw.security : Array.isArray(doc.security) ? doc.security : [];
    const optional = reqs.some((r) => isObj(r) && !Object.keys(r).length);
    if (reqs.length && !optional) {
      const usable = reqs.find((r) => isObj(r) && Object.keys(r).length && Object.keys(r).every((k) => has(model.schemes, k)));
      if (usable) {
        const keys = Object.keys(usable);
        op.auth = keys[0];
        if (keys.length > 1) warn(op.method + ' ' + path + ' needs ' + keys.length + ' credentials together; only "' + keys[0] + '" is sent.');
      }
    }
    return op;
  }

  const api = { parseText, read, view, typeOf, nullable, sample, deref, pointer, METHODS, isObj };
  root.SpecTestSpec = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
