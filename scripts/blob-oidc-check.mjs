import assert from 'node:assert/strict';
import { storageInfo, storageProvider } from '../src/lib/object-storage.ts';
const cases = [
  { env: { VERCEL_OIDC_TOKEN: 'oidc-test', BLOB_STORE_ID: 'store_standard' }, mode: 'Vercel OIDC', variable: 'BLOB_STORE_ID' },
  { env: { VERCEL_OIDC_TOKEN: 'oidc-test', BLOB_READ_WRITE_TOKEN_STORE_ID: 'store_custom' }, mode: 'Vercel OIDC', variable: 'BLOB_READ_WRITE_TOKEN_STORE_ID' },
  { env: { BLOB_READ_WRITE_TOKEN: 'rw-test' }, mode: 'read-write token', variable: undefined },
];
for (const { env, mode, variable } of cases) {
  for (const key of ['VERCEL_OIDC_TOKEN', 'BLOB_STORE_ID', 'BLOB_READ_WRITE_TOKEN_STORE_ID', 'BLOB_READ_WRITE_TOKEN', 'STORAGE_PROVIDER']) delete process.env[key];
  Object.assign(process.env, env);
  assert.equal(storageProvider(), 'vercel-blob');
  const info = storageInfo(); assert.equal(info.configured, true); assert.equal(info.authMode, mode); assert.equal(info.storeIdVariable, variable); assert.deepEqual(info.missing.blob, []);
}
console.log('PASS: Vercel Blob auto-detects OIDC, custom environment prefixes, and static read-write tokens.');
