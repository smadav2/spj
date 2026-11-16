import assert from 'node:assert/strict';
import { BlobAccessError, BlobStoreNotFoundError } from '@vercel/blob';
import { describeStorageError, storageInfo, storageProvider } from '../src/lib/object-storage';
const keys = ['BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'BLOB_READ_WRITE_TOKEN_STORE_ID', 'VERCEL_OIDC_TOKEN', 'STORAGE_PROVIDER'];
for (const key of keys) delete process.env[key];

// 1) Connected store that only ships OIDC/store-id variables (no read-write token).
process.env.VERCEL_OIDC_TOKEN = 'oidc-runtime-token';
process.env.BLOB_READ_WRITE_TOKEN_STORE_ID = 'store_spj2026';
assert.equal(storageProvider(), 'vercel-blob');
const info = storageInfo();
assert.equal(info.configured, true);
assert.equal(info.authMode, 'Vercel OIDC');
assert.equal(info.storeIdVariable, 'BLOB_READ_WRITE_TOKEN_STORE_ID');
assert.deepEqual(info.missing.blob, []);
console.log('PASS: koneksi dengan prefix khusus (tanpa token statis) dianggap siap pakai.');

// 2) Project forces Vercel Blob but no credentials reach runtime (the 400 case).
delete process.env.VERCEL_OIDC_TOKEN; delete process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;
process.env.STORAGE_PROVIDER = 'vercel-blob';
const forced = storageInfo();
assert.equal(forced.provider, 'vercel-blob');
assert.equal(forced.configured, false);
assert.ok(forced.missing.blob.length > 0, 'harus melaporkan variabel kredensial yang kurang');
console.log('PASS: STORAGE_PROVIDER=vercel-blob tanpa kredensial dilaporkan belum terbaca (bukan diam-diam gagal).');

// 3) SDK error classes map to actionable Indonesian guidance.
const access = describeStorageError(new BlobAccessError());
assert.ok(access.includes('Blob store → Projects'), 'pesan BlobAccessError harus mengarah ke Update Project Connection');
const store = describeStorageError(new BlobStoreNotFoundError());
assert.ok(store.includes('Store Vercel Blob tidak ditemukan'));
assert.ok(describeStorageError(new Error('sesuatu lain')).includes('sesuatu lain'));
console.log('PASS: error SDK dipetakan menjadi pesan perbaikan yang spesifik.');

// 4) S3 still takes precedence over Blob detection when configured.
for (const key of keys) delete process.env[key];
process.env.S3_ENDPOINT = 'http://127.0.0.1:4310';
process.env.S3_BUCKET = 'bucket';
process.env.S3_ACCESS_KEY_ID = 'key';
process.env.S3_SECRET_ACCESS_KEY = 'secret';
assert.equal(storageProvider(), 's3');
console.log('PASS: konfigurasi S3/R2 tetap didahulukan bila dipasang.');
for (const key of keys) delete process.env[key];
