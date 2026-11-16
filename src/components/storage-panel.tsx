'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon, Notice, api } from './ui';

interface Stats { storage: { provider: string; label: string; configured: boolean; hint: string; authMode?: string; storeIdVariable?: string; missing?: { s3: string[]; blob: string[] } }; files: number; bytes: number; dbBytes: number; inDatabase: number; inObjectStorage: number; kinds: { kind: string; files: number; bytes: number }[] }
interface SelfTest { ok: boolean; provider: string; message: string }
interface MigrateResult { moved: number; optimized: number; savedBytes: number; remaining: boolean; storage: string }
const LABEL: Record<string, string> = { documentation: 'Dokumentasi', evidence: 'Nota / bukti', receiptBackground: 'Latar kuitansi', logo: 'Logo', rightLogo: 'Logo kanan', principalSignature: 'Tanda tangan kepala sekolah', treasurerSignature: 'Tanda tangan bendahara' };
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function StoragePanel({ notify, ensureAuth }: { notify: (message: string, error?: boolean) => void; ensureAuth: (action: () => void) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MigrateResult | null>(null);
  const [guide, setGuide] = useState<'r2' | 'blob'>('r2');
  const [test, setTest] = useState<SelfTest | null>(null);
  const [testing, setTesting] = useState(false);
  async function runTest() {
    setTesting(true);
    try { const outcome = await api<SelfTest>('storage/test', 'POST'); setTest(outcome); notify(outcome.message, !outcome.ok); }
    catch (error) { notify((error as Error).message, true); }
    finally { setTesting(false); }
  }

  const load = useCallback(async () => {
    try { setStats(await api<Stats>('storage/stats')); } catch (error) { console.error(error); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run() {
    setBusy(true);
    try {
      let total = { moved: 0, optimized: 0, savedBytes: 0, remaining: false };
      for (let round = 0; round < 25; round += 1) {
        const step = await api<MigrateResult>('storage/migrate', 'POST');
        total = { moved: total.moved + step.moved, optimized: total.optimized + step.optimized, savedBytes: total.savedBytes + step.savedBytes, remaining: step.remaining };
        setResult({ ...step, ...total });
        if (!step.remaining || (!step.moved && !step.optimized)) break;
      }
      await load();
      notify(total.moved || total.optimized ? `Pemeliharaan selesai: ${total.moved} lampiran dipindah ke object storage, ${total.optimized} dikompres ulang, hemat ${size(total.savedBytes)}.` : 'Semua lampiran sudah optimal.');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  }

  const objectActive = stats ? stats.storage.provider !== 'db' : false;
  return <section className="card storage-panel">
    <div className="storage-head">
      <span className={`storage-badge ${objectActive ? 'ok' : 'warn'}`}><Icon name={objectActive ? 'Cloud' : 'DatabaseBackup'} size={20} /></span>
      <div className="storage-head-copy">
        <h2>Penyimpanan Lampiran</h2>
        <p>{stats ? `${stats.storage.hint}${stats.storage.authMode ? ` · autentikasi ${stats.storage.authMode}${stats.storage.storeIdVariable ? ` (${stats.storage.storeIdVariable})` : ''}` : ''}` : 'Memuat status penyimpanan…'}</p>
      </div>
      <span className={`tag ${objectActive ? 'tag-ok' : ''}`}>{stats?.storage.label || '—'}</span>
    </div>
    <div className="storage-numbers">
      <div><small>Total lampiran</small><strong>{stats ? stats.files : '—'} berkas</strong><span>{stats ? size(stats.bytes) : '—'}</span></div>
      <div><small>Isi berkas di database (Neon)</small><strong>{stats ? (stats.dbBytes ? size(stats.dbBytes) : '0 KB') : '—'}</strong><span>{stats ? (stats.inDatabase ? `${stats.inDatabase} berkas base64` : 'Tidak menyimpan isi berkas') : ''}</span></div>
      <div><small>Di object storage</small><strong>{stats ? `${stats.inObjectStorage} berkas` : '—'}</strong><span>Tidak memakai kuota tabel</span></div>
    </div>
    {!objectActive && <div className="storage-guide">
      <div className="storage-guide-head"><Icon name="CircleHelp" size={16} /><div><b>Object storage belum aktif — ini bukan error.</b><p>Aplikasi tetap berjalan; foto masih disimpan di database Neon sehingga kuota lebih cepat terpakai. Aktifkan “gudang berkas” gratis berikut agar foto/PDF dipindahkan otomatis.</p></div></div>
      <div className="storage-guide-tabs"><button type="button" className={guide === 'r2' ? 'active' : ''} onClick={() => setGuide('r2')}>Cloudflare R2 (gratis 10 GB, direkomendasikan)</button><button type="button" className={guide === 'blob' ? 'active' : ''} onClick={() => setGuide('blob')}>Vercel Blob (paling mudah)</button></div>
      {guide === 'r2' ? <ol className="storage-steps">
        <li><b>Buat akun Cloudflare</b> di dash.cloudflare.com (gratis), lalu buka menu <b>R2 Object Storage</b> → <b>Create bucket</b>. Nama bucket misalnya <code>spj-bosp</code>. Biarkan bucket <b>private</b>.</li>
        <li>Di halaman R2 klik <b>Manage R2 API Tokens</b> → <b>Create API token</b> → izin <b>Object Read & Write</b> → pilih bucket tadi → <b>Create</b>. Salin <b>Access Key ID</b> dan <b>Secret Access Key</b> (hanya tampil sekali).</li>
        <li>Salin juga <b>S3 endpoint</b> yang tampil di halaman yang sama, bentuknya <code>https://&lt;accountid&gt;.r2.cloudflarestorage.com</code>.</li>
        <li>Buka <b>Vercel → project → Settings → Environment Variables</b>, tambahkan 5 variabel (centang Production &amp; Preview):<div className="storage-vars"><code>S3_ENDPOINT</code><code>S3_BUCKET</code><code>S3_ACCESS_KEY_ID</code><code>S3_SECRET_ACCESS_KEY</code><code>S3_REGION = auto</code></div></li>
        <li><b>Deployments → ⋯ → Redeploy</b>. Setelah selesai, kembali ke halaman ini lalu klik <b>Uji Koneksi Storage</b>, kemudian <b>Optimalkan &amp; Pindahkan Lampiran Lama</b>.</li>
      </ol> : <ol className="storage-steps">
        <li><b>Pesan pada gambar Anda berarti project sudah terhubung.</b> Jangan klik Connect Project lagi. Klik Cancel pada dialog tersebut. Tombol sudah terhubung bukan error aplikasi.</li>
        <li>Buka <b>Blob store → Projects → ⋯ di samping project spj2026 → Update Project Connection</b>. Pastikan Production &amp; Preview dipilih, lalu simpan koneksi.</li>
        <li>Di <b>Custom Environment Variable Prefix</b>, kosongkan atau gunakan <code>BLOB</code> (jangan tulis <code>BLOB_READ_WRITE_TOKEN</code>). Mode default Vercel memakai <b>OIDC</b>: <code>VERCEL_OIDC_TOKEN</code> + <code>BLOB_STORE_ID</code>. Aplikasi juga mengenali prefix khusus <code>BLOB_READ_WRITE_TOKEN_STORE_ID</code> seperti di tangkapan layar.</li>
        <li><b>Read-write token opsional.</b> Tidak wajib mencentang <b>Add a read-write token env var</b> jika koneksi OIDC aktif. Jika ingin static token, centang kotak itu dan pilih prefix default <code>BLOB</code> agar nama variabel menjadi <code>BLOB_READ_WRITE_TOKEN</code>.</li>
        <li><b>Deployments → ⋯ → Redeploy</b>. Setelah deployment baru Ready, kembali ke halaman ini, klik <b>Muat Ulang Status</b> → <b>Uji Koneksi Storage</b> → <b>Optimalkan &amp; Pindahkan Lampiran Lama</b>.</li>
        <li>Jika ingin memakai static token, buka Projects → ⋯ → Update Project Connection, centang <b>Add a read-write token env var</b>, dan pilih prefix default <code>BLOB</code>. Token static tidak wajib untuk OIDC.</li><li>Catatan: Blob gratis 1 GB; bila foto sangat banyak, R2 (10 GB) lebih lega.</li>
      </ol>}
      {stats?.storage.missing && <p className="storage-missing"><Icon name="CircleAlert" size={13} />Variabel yang belum terbaca saat ini — R2/S3: <b>{stats.storage.missing.s3.length ? stats.storage.missing.s3.join(', ') : 'lengkap'}</b> · Vercel Blob: <b>{stats.storage.missing.blob.length ? stats.storage.missing.blob.join(', ') : 'lengkap'}</b>. Jika sudah ditambahkan tetapi masih tertulis di sini, berarti belum <b>Redeploy</b>.</p>}
    </div>}
    <ul className="storage-kinds">{(stats?.kinds || []).slice(0, 8).map(kind => <li key={kind.kind}><span>{LABEL[kind.kind] || kind.kind}</span><b>{kind.files}</b><small>{size(kind.bytes)}</small></li>)}</ul>
    <div className="storage-actions">
      <button className="btn btn-primary btn-small" disabled={busy} onClick={() => ensureAuth(() => { void run(); })}><Icon name={busy ? 'LoaderCircle' : 'RefreshCw'} size={15} className={busy ? 'spin' : ''} />{busy ? 'Memproses…' : objectActive ? 'Optimalkan & Pindahkan Lampiran Lama' : 'Optimalkan Lampiran Lama'}</button>
      <button className="btn btn-outline btn-small" disabled={busy || testing} onClick={() => ensureAuth(() => { void runTest(); })}><Icon name={testing ? 'LoaderCircle' : 'ShieldCheck'} size={15} className={testing ? 'spin' : ''} />{testing ? 'Menguji…' : 'Uji Koneksi Storage'}</button>
      <button className="btn btn-outline btn-small" disabled={busy} onClick={() => { void load(); }}><Icon name="RefreshCw" size={15} />Muat Ulang Status</button>
      {test && <span className={`storage-test ${test.ok ? 'ok' : 'bad'}`}><Icon name={test.ok ? 'CheckCircle2' : 'CircleAlert'} size={13} />{test.message}</span>}
      {result && <span className="storage-result">Terakhir: {result.moved} dipindah · {result.optimized} dikompres · hemat {size(result.savedBytes)}</span>}
    </div>
    <p className="storage-note"><Icon name="ShieldCheck" size={14} />PDF/Word dibuat saat diminta dan tidak disimpan, sehingga tidak menambah kuota. Foto dikompres otomatis saat diunggah (maks. 1400 px, JPEG kualitas 76); lampiran lama dapat dipindahkan bertahap tanpa mengubah data transaksi.</p>
  </section>;
}
