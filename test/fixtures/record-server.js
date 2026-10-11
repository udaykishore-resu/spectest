/* Answers 200 {} to everything and appends what it received to the file named by RECORD_FILE, one JSON line per request. */
const http = require('http');
const fs = require('fs');
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const line = [req.method, req.url, req.headers['content-type'] || '', Buffer.concat(chunks).toString('utf8'), req.headers['x-note'] || '', req.headers['x-key'] || ''].join('\n');
    fs.appendFileSync(process.env.RECORD_FILE, JSON.stringify(line) + '\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});
server.listen(0, '127.0.0.1', () => console.log('listening ' + server.address().port));
