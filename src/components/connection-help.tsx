'use client';
import { useState } from 'react';
import { Icon, apiUrl } from './ui';

type HealthResult = { ok?: boolean; schema?: string; configured?: boolean; error?: string };
const STEPS = [
  { title: 'Buka pengaturan environment', detail: 'Vercel → pilih project → Settings → Environment Variables.' },
  { title: 'Tambahkan variabel DATABASE_URL', detail: 'Nama harus tepat DATABASE_URL. Nilai: connection string PostgreSQL/Neon berakhiran ?sslmode=require. Untuk Neon gunakan endpoint "Pooled connection".' },
  { title: 'Centang Production dan Preview', detail: 'Variabel harus tersedia pada environment yang sedang dipakai. Jika hanya Development, aplikasi produksi tetap menganggapnya kosong.' },
  { title: 'Simpan, lalu REDEPLOY', detail: 'Environment Variables tidak berlaku pada deployment lama. Buka Deployments → ⋯ pada deployment teratas → Redeploy.' },
  { title: 'Buka /api/health', detail: 'Harus muncul {"ok":true,"schema":"ready"}. Bila masih gagal, buka pesannya untuk mengetahui penyebab persisnya.' },
];
const PITFALLS = [
  ['Nilai diapit tanda kutip', 'Tulis tanpa tanda kutip, mis. postgresql://user:pass@host/db?sslmode=require'],
  ['Masih ada spasi/baris baru', 'Hapus spasi di awal atau akhir nilai. Jangan menekan Enter setelah menempel.'],
  ['Project Neon tertunda (paused)', 'Buka dashboard Neon → Resume project, lalu coba lagi.'],
  ['Host bukan endpoint pooled', 'Pakai host yang mengandung "-pooler" pada Neon, agar koneksi serverless tidak habis.'],
  ['Variabel hanya di Development', 'Centang juga Production dan Preview sebelum menyimpan.'],
  ['Belum redeploy setelah menyimpan', 'Deployment lama memakai env lama. Selalu Redeploy setelah mengubah env.'],
  ['Variabel berbeda nama', 'Contoh salah: DATABASE_URLS, DATABASE_URI, DB_URL. Harus persis DATABASE_URL.'],
];

export function ConnectionHelp({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [showPitfalls, setShowPitfalls] = useState(true);
  async function check() {
    setChecking(true);
    try {
      const response = await fetch(apiUrl('health-check'), { cache: 'no-store' });
      const data = await response.json() as HealthResult;
      setHealth(data);
      if (data.ok) onRetry();
    } catch { setHealth({ ok: false, error: 'Tidak dapat menghubungi server.' }); }
    finally { setChecking(false); }
  }
  return <section className="connection-help">
    <div className="connection-help-head">
      <span className="connection-help-icon"><Icon name="DatabaseBackup" size={22} /></span>
      <div><h2>Database belum terhubung</h2><p>{message}</p></div>
      <button className="btn btn-primary btn-small" onClick={() => { void check(); }} disabled={checking}><Icon name={checking ? 'LoaderCircle' : 'RefreshCw'} size={15} className={checking ? 'spin' : ''} />{checking ? 'Memeriksa…' : 'Periksa Koneksi'}</button>
    </div>
    {health && <div className={`connection-result ${health.ok ? 'ok' : 'bad'}`}><Icon name={health.ok ? 'CheckCircle2' : 'CircleAlert'} size={15} /><span>{health.ok ? 'Koneksi berhasil. Tabel database siap dipakai.' : health.error || 'Database belum dapat diakses.'}</span></div>}
    <ol className="connection-steps">{STEPS.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><b>{step.title}</b><p>{step.detail}</p></div></li>)}</ol>
    <div className="connection-pitfalls-head"><h3><Icon name="CircleHelp" size={16} />Penyebab yang paling sering terjadi</h3><button className="text-button" onClick={() => setShowPitfalls(value => !value)}>{showPitfalls ? 'Sembunyikan' : 'Tampilkan'}</button></div>
    {showPitfalls && <ul className="connection-pitfalls">{PITFALLS.map(([title, detail]) => <li key={title}><b>{title}</b><span>{detail}</span></li>)}</ul>}
    <div className="connection-actions"><button className="btn btn-outline btn-small" onClick={onRetry}><Icon name="RefreshCw" size={15} />Muat Ulang Aplikasi</button><a className="text-button" href="/api/health" target="_blank" rel="noreferrer"><Icon name="ExternalLink" size={14} />Buka status /api/health</a><span className="connection-note"><Icon name="ShieldCheck" size={14} />Data sekolah tidak diubah selama database belum terhubung.</span></div>
  </section>;
}
