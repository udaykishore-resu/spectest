/* A small API that follows test/fixtures/shop.yaml. BROKEN=1 makes it break the contract on purpose,
   so the generated tests can be shown to fail when they should. */
const http = require('http');
const BROKEN = process.env.BROKEN === '1';
const TOKEN = 'test-token';
const item = (id) => (BROKEN ? { id: String(id), name: 'Widget' } : { id, name: 'Widget', price: 9.5, tags: ['a'] });

function validItem(b) {
  if (BROKEN) return true;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (typeof b.name !== 'string' || b.name.length < 1 || b.name.length > 50) return false;
  if (typeof b.price !== 'number' || b.price < 0) return false;
  if (b.category !== undefined && !['tools', 'toys'].includes(b.category)) return false;
  if (b.tags !== undefined && !Array.isArray(b.tags)) return false;
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (code, body) => {
      res.writeHead(code, body === undefined ? {} : { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const bad = (m) => send(400, { error: m });
    const p = url.pathname;
    const m = req.method;
    const bearer = BROKEN || req.headers.authorization === 'Bearer ' + TOKEN;
    let json;
    try {
      json = raw ? JSON.parse(raw) : undefined;
    } catch (_) {
      json = undefined;
    }
    if (p === '/health' && m === 'GET') return send(200, { status: 'ok' });
    if (p === '/login' && m === 'POST') {
      const f = new URLSearchParams(raw);
      if (!BROKEN && (!f.get('username') || !f.get('password'))) return bad('username and password are required');
      return send(200, { token: TOKEN });
    }
    if (p === '/reports' && m === 'GET') {
      if (!BROKEN && url.searchParams.get('api_key') !== TOKEN) return send(401, { error: 'bad key' });
      return send(200, { generatedAt: '2024-01-15T10:30:00Z', rows: [] });
    }
    if (!bearer) return send(401, { error: 'no token' });
    if (p === '/tenants/me' && m === 'GET') {
      if (!req.headers['x-tenant']) return bad('X-Tenant is required');
      return send(200, { tenant: req.headers['x-tenant'] });
    }
    if (p === '/search' && m === 'GET') {
      if (!BROKEN && !url.searchParams.get('q')) return bad('q is required');
      return send(200, BROKEN ? { results: [] } : { results: [item(1)], total: 1 });
    }
    if (p === '/items' && m === 'GET') {
      const l = url.searchParams.get('limit');
      if (!BROKEN && l !== null && !(/^\d+$/.test(l) && +l >= 1 && +l <= 100)) return bad('limit must be 1 to 100');
      return send(200, [item(1)]);
    }
    if (p === '/items' && m === 'POST') return validItem(json) ? send(201, item(2)) : bad('invalid item');
    const one = /^\/items\/(\d+)$/.exec(p);
    if (one) {
      const id = Number(one[1]);
      if (id >= 1000) return BROKEN ? send(200, {}) : send(404, { error: 'no such item' });
      if (m === 'GET') return send(200, item(id));
      if (m === 'PUT') return validItem(json) ? send(200, item(id)) : bad('invalid item');
      if (m === 'DELETE') return send(204);
    }
    send(404, { error: 'no route' });
  });
});
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log('listening ' + server.address().port));
