import { createHash, createHmac } from 'node:crypto';
import { del as blobSdkDelete, get as blobSdkGet, put as blobSdkPut } from '@vercel/blob';
import { db } from '@/db';
import { attachments } from '@/db/schema';
import { eq } from 'drizzle-orm';

export type StorageProvider = 'db' | 's3' | 'vercel-blob';
export interface StoredObject { provider: StorageProvider; key: string; url?: string; bytes: number }
export interface StorageInfo { provider: StorageProvider; label: string; configured: boolean; hint: string; publicBase?: string; authMode?: 'Vercel OIDC' | 'read-write token'; storeIdVariable?: string; missing: { s3: string[]; blob: string[] } }

const has = (...keys: string[]) => keys.every(key => Boolean(process.env[key]));
/** Respect standard BLOB_STORE_ID as well as a Vercel project's Custom Environment Variable Prefix. */
function blobStoreEnv() {
  if (process.env.BLOB_STORE_ID) return { name: 'BLOB_STORE_ID', value: process.env.BLOB_STORE_ID };
  const alias = Object.keys(process.env).find(key => /^BLOB_.+_STORE_ID$/.test(key) && Boolean(process.env[key]));
  return alias ? { name: alias, value: process.env[alias]! } : undefined;
}
const blobOcidReady = () => Boolean(process.env.VERCEL_OIDC_TOKEN && blobStoreEnv());
const blobReady = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN) || blobOcidReady();

export function storageProvider(): StorageProvider {
  const explicit = (process.env.STORAGE_PROVIDER || '').toLowerCase();
  if (explicit === 's3' || explicit === 'db') return explicit;
  // Vercel Blob's built-in OIDC connection is standard on Vercel. The read-write
  // token checkbox is optional; the SDK refreshes VERCEL_OIDC_TOKEN itself.
  if (explicit === 'vercel-blob' || blobReady()) return 'vercel-blob';
  if (has('S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT')) return 's3';
  return 'db';
}

export function storageInfo(): StorageInfo {
  const provider = storageProvider();
  const store = blobStoreEnv();
  const oidc = blobOcidReady();
  const missing = {
    s3: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(key => !process.env[key]),
    blob: blobReady() ? [] : [
      ...(!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN ? ['BLOB_READ_WRITE_TOKEN atau VERCEL_OIDC_TOKEN'] : []),
      ...(process.env.VERCEL_OIDC_TOKEN && !store ? ['BLOB_STORE_ID'] : []),
    ],
  };
  if (provider === 'vercel-blob') return { provider, label: 'Vercel Blob', configured: true, hint: `Lampiran disimpan di Vercel Blob via ${oidc ? 'Vercel OIDC' : 'read-write token'}; database hanya menyimpan metadata.`, authMode: oidc ? 'Vercel OIDC' : 'read-write token', storeIdVariable: store?.name, missing };
  if (provider === 's3') return { provider, label: 'S3 / Cloudflare R2', configured: true, hint: `Bucket "${process.env.S3_BUCKET}" dipakai untuk foto & PDF.`, publicBase: process.env.S3_PUBLIC_URL, missing };
  return { provider: 'db', label: 'PostgreSQL (bawaan)', configured: false, hint: 'Belum ada object storage. Lampiran disimpan di database dalam bentuk terkompresi.', missing };
}

/** Uji tulis–baca–hapus satu berkas kecil untuk memastikan kredensial storage benar. */
export async function storageSelfTest(): Promise<{ ok: boolean; provider: StorageProvider; message: string }> {
  const provider = storageProvider();
  if (provider === 'db') return { ok: false, provider, message: 'Object storage belum dikonfigurasi. Lampiran masih disimpan di database.' };
  const key = `spj/_uji-koneksi/${Date.now()}.txt`;
  const payload = Buffer.from(`uji koneksi ${new Date().toISOString()}`);
  try {
    await putObject(key, payload, 'text/plain');
    const back = await getObject(provider, key);
    await deleteObject(provider, key);
    if (!back.equals(payload)) return { ok: false, provider, message: 'Berkas uji berhasil ditulis tetapi isinya berbeda saat dibaca. Periksa bucket/endpoint.' };
    return { ok: true, provider, message: `Koneksi ${provider === 's3' ? 'S3/R2' : 'Vercel Blob'} berhasil: tulis, baca, dan hapus berkas uji sukses.` };
  } catch (error) {
    return { ok: false, provider, message: (error as Error).message || 'Koneksi storage gagal.' };
  }
}

const objectKey = (file: { transactionId: string | null; kind: string; name: string }, id: string) => {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80) || 'berkas';
  return `spj/${file.transactionId ? `transaksi/${file.transactionId}` : 'sekolah'}/${file.kind}/${id}-${safeName}`;
};
export function buildObjectKey(file: { transactionId: string | null; kind: string; name: string }, id: string) { return objectKey(file, id); }

// Vercel Blob SDK uses automatically refreshed OIDC (recommended) or a static
// BLOB_READ_WRITE_TOKEN. A custom variable prefix such as BLOB_READ_WRITE_TOKEN
// renames BLOB_STORE_ID to BLOB_READ_WRITE_TOKEN_STORE_ID; pass that alias as storeId.
const blobAccess = (): 'private' | 'public' => process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
function blobSdkOptions() {
  const store = blobStoreEnv();
  const hasOcid = Boolean(process.env.VERCEL_OIDC_TOKEN && store);
  return { access: blobAccess(), ...(hasOcid && store ? { storeId: store.value } : {}) } as const;
}
async function blobPut(key: string, bytes: Buffer, contentType: string): Promise<{ url?: string }> {
  const blob = await blobSdkPut(key, bytes, { ...blobSdkOptions(), contentType, addRandomSuffix: false, allowOverwrite: true });
  return { url: blob.downloadUrl || blob.url };
}
async function blobGet(key: string): Promise<Response> {
  const result = await blobSdkGet(key, { ...blobSdkOptions(), useCache: false });
  if (!result) return new Response('not found', { status: 404 });
  if (result.statusCode !== 200 || !result.stream) return new Response('not found', { status: 404 });
  return new Response(result.stream, { headers: new Headers(result.headers as unknown as HeadersInit) });
}
async function blobDelete(key: string) {
  await blobSdkDelete(key, blobSdkOptions());
}

// ---------------- S3 / R2 (SigV4) ----------------
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

async function s3Request(method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const endpoint = process.env.S3_ENDPOINT!.replace(/\/$/, '');
  const bucket = process.env.S3_BUCKET!;
  const region = process.env.S3_REGION || 'auto';
  const accessKey = process.env.S3_ACCESS_KEY_ID!;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY!;
  const url = new URL(`${endpoint}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256(payload);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).filter(name => name !== 'content-type').sort();
  const canonicalHeaders = signedHeaders.map(name => `${name}:${headers[name].trim()}`).join('\n') + '\n';
  const canonicalRequest = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return fetch(url, {
    method,
    body: method === 'PUT' ? new Uint8Array(payload) : undefined,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}` },
    cache: 'no-store',
    redirect: 'follow',
  });
}

// ---------------- API publik modul ----------------
export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
  const provider = storageProvider();
  if (provider === 'db') return { provider, key, bytes: bytes.length };
  if (provider === 'vercel-blob') { const { url } = await blobPut(key, bytes, contentType); return { provider, key, url, bytes: bytes.length }; }
  const response = await s3Request('PUT', key, bytes, contentType);
  if (!response.ok) throw new Error(`Object storage menolak unggahan (${response.status}). Periksa S3_ENDPOINT, S3_BUCKET, dan kredensial.`);
  const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
  return { provider, key, url: base ? `${base}/${key}` : undefined, bytes: bytes.length };
}

export async function getObject(provider: StorageProvider, key: string): Promise<Buffer> {
  if (provider === 'vercel-blob') {
    const response = await blobGet(key);
    if (!response.ok) throw new Error(`Berkas tidak dapat diambil dari Vercel Blob (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (provider === 's3') {
    const response = await s3Request('GET', key);
    if (!response.ok) throw new Error(`Berkas tidak dapat diambil dari object storage (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('Provider penyimpanan tidak mendukung pengambilan objek.');
}

export async function deleteObject(provider: StorageProvider, key: string) {
  try {
    if (provider === 'vercel-blob') await blobDelete(key);
    else if (provider === 's3') await s3Request('DELETE', key);
  } catch (error) {
    console.error('Gagal menghapus objek lampiran', error);
  }
}

export type AttachmentRow = typeof attachments.$inferSelect;
/** Mengisi `content` (base64) untuk baris yang fisiknya ada di object storage. */
export async function hydrateFiles<T extends { id: string; mime: string; content?: string; storageProvider?: string | null; storageKey?: string | null }>(files: T[]): Promise<T[]> {
  return Promise.all(files.map(async file => {
    if (file.content || !file.storageKey || !file.storageProvider || file.storageProvider === 'db') return file;
    try {
      const bytes = await getObject(file.storageProvider as StorageProvider, file.storageKey);
      return { ...file, content: bytes.toString('base64'), mime: file.mime };
    } catch (error) {
      console.error('Gagal memuat lampiran dari object storage', file.id, error);
      return file;
    }
  }));
}

export async function dbFile(file: AttachmentRow) { const [row] = await db.select().from(attachments).where(eq(attachments.id, file.id)); return row; }
