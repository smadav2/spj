import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { Client } from 'pg';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
const app = process.env.TEST_BASE_URL || 'http://127.0.0.1:3108';
const dbUrl = process.env.DATABASE_URL;
assert.ok(dbUrl, 'DATABASE_URL required');
const objects = new Map();
let signed = 0;
const port = 4310;
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const key = decodeURIComponent(url.pathname);
  const auth = req.headers.authorization || '';
  if (!String(auth).startsWith('AWS4-HMAC-SHA256 Credential=')) { res.writeHead(403); res.end('unsigned'); return; }
  if (!req.headers['x-amz-date'] || !req.headers['x-amz-content-sha256']) { res.writeHead(400); res.end('missing amz headers'); return; }
  signed += 1;
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { objects.set(key, Buffer.concat(chunks)); res.writeHead(200, { etag: '"mock"' }); res.end(); });
    return;
  }
  if (req.method === 'GET') { const body = objects.get(key); if (!body) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }); res.end(body); return; }
  if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); res.end(); return; }
  res.writeHead(405); res.end();
});
await new Promise(resolve => mock.listen(port, '127.0.0.1', resolve));
let cookie = '';
async function api(route, method = 'GET', body) {
  const response = await fetch(`${app}/api/spj?${new URLSearchParams({ route })}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
  const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, response };
}
async function upload(transactionId, kind, buffer, mime, name) {
  const form = new FormData(); form.set('kind', kind); if (transactionId) form.set('transactionId', transactionId);
  form.append('files', new Blob([buffer], { type: mime }), name);
  return api('upload', 'POST', form);
}
const client = new Client({ connectionString: dbUrl });
await client.connect();
try {
  // --- setup admin & school on a clean database ---
  const boot = await api('state');
  if (boot.data.needsSetup) await api('auth/register', 'POST', { name: 'UJI STORAGE', username: `qa_st_${Date.now()}`, password: randomBytes(10).toString('hex') });
  const state = (await api('state')).data;
  await api('school', 'PUT', { ...state.school, name: 'SD UJI STORAGE', npsn: '00000000', address: 'ALAMAT UJI', principal: 'KEPALA UJI', treasurer: 'BENDAHARA UJI' });
  const transaction = (await api('transactions', 'POST', { category: 'tahfidz', title: 'Uji simpan lampiran', date: '2026-09-29', amount: 200000, data: { recipient: 'PEMBINA UJI', coaches: 'PEMBINA UJI', period: '2026-09', meetingDates: '2026-09-05' } })).data;
  console.log('PASS: transaksi uji dibuat untuk pengujian penyimpanan.');

  // --- large photo is optimized and stored outside the database ---
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#7ba0bd' } }).jpeg({ quality: 98 }).toBuffer();
  const uploaded = await upload(transaction.id, 'documentation', big, 'image/jpeg', 'dokumentasi-besar.jpg');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.equal(uploaded.data.storage, 's3');
  const fileId = uploaded.data.files[0].id;
  const row = (await client.query('select size, content, storage_provider, storage_key from spj_attachments where id=$1', [fileId])).rows[0];
  assert.equal(row.storage_provider, 's3');
  assert.equal(row.content, '', 'isi berkas tidak boleh tersimpan di database');
  assert.ok(row.storage_key && row.storage_key.startsWith('spj/transaksi/'));
  assert.ok(row.size < big.length, `foto harus dikompres: ${row.size} < ${big.length}`);
  assert.ok(objects.has('/testbucket/' + row.storage_key), 'objek harus tersimpan di object storage');
  console.log(`PASS: foto 3000×2000 (${Math.round(big.length / 1024)} KB) dioptimasi menjadi ${Math.round(row.size / 1024)} KB dan disimpan di object storage; kolom content kosong.`);

  // --- serving through the app still works ---
  const served = await fetch(`${app}/api/spj?route=files/${fileId}`, { headers: { cookie } });
  assert.equal(served.status, 200);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  assert.equal(servedBytes.length, row.size);
  assert.equal(served.headers.get('content-type'), 'image/jpeg');
  console.log('PASS: berkas dilayani aplikasi lewat proxy object storage (tidak terekspos publik).');

  // --- exports hydrate from object storage ---
  const pdf = await fetch(`${app}/api/spj?route=export/${transaction.id}&format=pdf&scope=all`, { headers: { cookie } });
  assert.equal(pdf.status, 200);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  const parsed = await PDFDocument.load(pdfBytes);
  assert.ok(parsed.getPageCount() >= 1);
  const word = await fetch(`${app}/api/spj?route=export/${transaction.id}&format=docx&scope=all`, { headers: { cookie } });
  assert.equal(word.status, 200);
  assert.ok(Buffer.from(await word.arrayBuffer()).length > 1000);
  console.log(`PASS: PDF (${parsed.getPageCount()} halaman) & Word tetap dibuat walau berkas di object storage.`);

  // --- statistics ---
  const stats = (await api('storage/stats')).data;
  assert.equal(stats.storage.provider, 's3');
  assert.ok(stats.inObjectStorage >= 1);
  assert.equal(stats.dbBytes, 0, 'database tidak menyimpan base64');
  console.log(`PASS: statistik penyimpanan — ${stats.files} berkas, ${Math.round(stats.bytes / 1024)} KB di object storage, 0 byte base64 di database.`);

  // --- migrate legacy base64 attachment out of the database ---
  const legacy = await sharp({ create: { width: 2200, height: 1500, channels: 3, background: '#b98d6b' } }).jpeg({ quality: 95 }).toBuffer();
  const legacyId = randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  await client.query('insert into spj_attachments (id, transaction_id, kind, name, mime, size, content, storage_provider, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8, now())', [legacyId, transaction.id, 'evidence', 'nota-lama.jpg', 'image/jpeg', legacy.length, legacy.toString('base64'), 'db']);
  const before = Number((await client.query('select coalesce(sum(length(content)),0) as bytes from spj_attachments')).rows[0].bytes);
  assert.ok(before > 0);
  const migrated = (await api('storage/migrate', 'POST')).data;
  assert.ok(migrated.moved >= 1);
  const after = Number((await client.query('select coalesce(sum(length(content)),0) as bytes from spj_attachments')).rows[0].bytes);
  assert.equal(after, 0, 'setelah migrasi tidak ada base64 tersisa');
  const legacyRow = (await client.query('select storage_provider, storage_key, size from spj_attachments where id=$1', [legacyId])).rows[0];
  assert.equal(legacyRow.storage_provider, 's3'); assert.ok(legacyRow.storage_key);
  assert.ok(legacyRow.size < legacy.length, 'berkas lama juga dikompres');
  const legacyServed = await fetch(`${app}/api/spj?route=files/${legacyId}`, { headers: { cookie } });
  assert.equal(legacyServed.status, 200);
  console.log(`PASS: migrasi lampiran lama — ${Math.round(before / 1024)} KB base64 dihapus dari Neon, berkas dipindah & dikompres.`);

  // --- delete removes the object too ---
  const countBefore = objects.size;
  assert.equal((await api(`files/${fileId}`, 'DELETE')).status, 200);
  assert.equal(objects.size, countBefore - 1, 'objek harus terhapus dari storage');
  console.log('PASS: menghapus lampiran juga menghapus objek di storage (tidak ada sisa kuota).');
  assert.ok(signed > 5);
  console.log('ALL STORAGE TESTS PASSED');
} finally {
  await client.end();
  await new Promise(resolve => mock.close(resolve));
}
