// Mock S3-compatible storage for automated tests only.
import http from 'node:http';
const objects = new Map();
const port = Number(process.env.MOCK_PORT || 4310);
http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const key = decodeURIComponent(url.pathname);
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('AWS4-HMAC-SHA256 Credential=')) { res.writeHead(403); res.end('unsigned'); return; }
  if (req.method === 'PUT') { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { objects.set(key, Buffer.concat(chunks)); res.writeHead(200); res.end(); }); return; }
  if (req.method === 'GET') { const body = objects.get(key); if (!body) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-length': body.length }); res.end(body); return; }
  if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); res.end(); return; }
  res.writeHead(405); res.end();
}).listen(port, '127.0.0.1', () => console.log(`mock storage on ${port}`));
