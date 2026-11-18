'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FULL_MONTHS, dateLabel, money, number, type TransferRow } from '@/lib/domain';
import { Field, Icon, Modal, Notice, PageHeading, api, apiUrl, downloadFile, useApp } from './ui';

interface Batch {
  id: string; title: string; letterNumber: string; letterDate: string; month: number; year: number;
  bankName: string; bankBranch: string; bankAddress: string; giroNumber: string; giroName: string; rows: TransferRow[];
  createdAt: string; updatedAt: string;
}
const emptyRow = (bank = ''): TransferRow => ({ name: '', accountNumber: '', bank, amount: 0, description: '' });
const totalOf = (rows: TransferRow[]) => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

export default function TransferView() {
  const { state, notify, ensureAuth, refresh } = useApp();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Batch | null>(null);
  const [previewId, setPreviewId] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<'all' | 'letter' | 'payroll' | 'ktp'>('all');
  const ktpKsRef = useRef<HTMLInputElement>(null);
  const ktpBendRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setBatches(await api<Batch[]>('transfer/batches')); }
    catch (e) { notify((e as Error).message, true); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const previewBatch = batches.find(b => b.id === previewId);

  async function showPreview(batch: Batch, target: 'all' | 'letter' | 'payroll' | 'ktp' = scope) {
    setPreviewLoading(true); setPreviewId(batch.id); setScope(target);
    try {
      const res = await fetch(apiUrl('transfer'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'pdf', scope: target, batchId: batch.id }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Gagal memuat pratinjau.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) { notify((e as Error).message, true); }
    finally { setPreviewLoading(false); }
  }

  async function exportFile(batch: Batch, format: 'pdf' | 'docx' | 'xlsx', target: 'all' | 'letter' | 'payroll' | 'ktp' | 'recap' = scope) {
    setBusy(true);
    try {
      const res = await fetch(apiUrl('transfer'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, scope: target, batchId: batch.id }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Ekspor gagal.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${target === 'recap' ? 'Rekap-Non-Tunai' : 'Pemindahbukuan'}-${batch.year}-${String(batch.month).padStart(2, '0')}.${format}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify(`Dokumen ${format.toUpperCase()} berhasil diunduh.`);
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  }

  async function remove(batch: Batch) {
    if (!confirm(`Hapus pemindahbukuan "${batch.title}"? Transaksi terkait tidak terhapus.`)) return;
    try { await api(`transfer/batches/${batch.id}`, 'DELETE'); if (previewId === batch.id) { setPreviewId(''); setPreviewUrl(''); } await load(); notify('Pemindahbukuan dihapus.'); }
    catch (e) { notify((e as Error).message, true); }
  }

  async function uploadCard(file: File | undefined, key: 'principalIdCardId' | 'treasurerIdCardId', kind: string) {
    if (!file) return;
    if (!/\.(jpe?g|png)$/i.test(file.name) || file.size > 8 * 1024 * 1024) { notify('Gunakan foto JPG atau PNG maksimal 8 MB.', true); return; }
    setBusy(true);
    try {
      const form = new FormData(); form.set('kind', kind); form.append('files', file);
      const res = await api<{ files: { id: string }[] }>('upload', 'POST', form);
      await api('school', 'PUT', { ...state.school, [key]: res.files[0].id });
      await refresh(); notify('Foto KTP tersimpan.');
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  }

  const byMonth = batches.reduce<Record<string, Batch[]>>((acc, batch) => { const key = `${batch.year}-${String(batch.month).padStart(2, '0')}`; (acc[key] ||= []).push(batch); return acc; }, {});
  const grouped = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));

  return <>
    <PageHeading title="Pemindahbukuan & Payroll Non-Tunai" description="Pemindahbukuan berdiri sendiri — tidak mengambil data transaksi. Bisa dibuat beberapa kali dalam satu bulan.">
      <button className="btn btn-outline" onClick={() => ensureAuth(() => { void downloadFile(apiUrl('transfer/template'), 'Template-Rekap-Non-Tunai.xlsx').catch(e => notify(e.message, true)); })}><Icon name="FileSpreadsheet" size={16}/>Unduh Template Excel</button>
      <button className="btn btn-primary" onClick={() => ensureAuth(() => setEditor({ id: '', title: '', letterNumber: (state.school.transferNumberFormat || `900/39/426.101.411.2.4/${state.school.year}`).replace('{tahun}', String(state.school.year)), letterDate: `${state.school.year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`, month: new Date().getMonth() + 1, year: state.school.year, bankName: state.school.bankName, bankBranch: state.school.bankBranch, bankAddress: state.school.bankAddress, giroNumber: state.school.bankAccountNumber, giroName: state.school.bankAccountName, rows: [emptyRow()], createdAt: '', updatedAt: '' }))}><Icon name="Plus" size={17}/>Buat Pemindahbukuan</button>
    </PageHeading>

    <Notice>Alur: isi/unggah <b>Excel Rekap Non-Tunai</b> pada editor, lalu Surat Perintah Pemindah Bukuan dan Payroll Landscape otomatis mengikuti data yang sama. Rekap Non-Tunai diunduh sebagai Excel, terpisah dari PDF Surat Perintah &amp; Payroll.</Notice>

    <section className="card" style={{ padding: 22, marginBottom: 20 }}>
      <div className="card-header" style={{ padding: '0 0 14px' }}><div><h2>Lampiran KTP Penanda Tangan</h2><p>Dicetak berdampingan pada lampiran Surat Perintah Pemindah Bukuan.</p></div></div>
      <div className="form-grid">
        <div className="school-asset"><div className="school-asset-preview">{state.school.principalIdCardId ? <img src={apiUrl(`files/${state.school.principalIdCardId}`)} alt="KTP Kepala Sekolah"/> : <Icon name="UserRound" size={32}/>}</div><div><h4>KTP Kepala Sekolah</h4><p>{state.school.principal || 'Nama kepala sekolah belum diisi'}</p><div className="asset-actions"><button type="button" className="btn btn-outline btn-small" disabled={busy} onClick={() => ensureAuth(() => ktpKsRef.current?.click())}><Icon name="UploadCloud" size={14}/>{state.school.principalIdCardId ? 'Ganti KTP' : 'Unggah KTP'}</button></div><input ref={ktpKsRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={e => { void uploadCard(e.target.files?.[0], 'principalIdCardId', 'principalIdCard'); e.target.value = ''; }}/></div></div>
        <div className="school-asset"><div className="school-asset-preview">{state.school.treasurerIdCardId ? <img src={apiUrl(`files/${state.school.treasurerIdCardId}`)} alt="KTP Bendahara"/> : <Icon name="UserRound" size={32}/>}</div><div><h4>KTP Bendahara BOSP</h4><p>{state.school.treasurer || 'Nama bendahara belum diisi'}</p><div className="asset-actions"><button type="button" className="btn btn-outline btn-small" disabled={busy} onClick={() => ensureAuth(() => ktpBendRef.current?.click())}><Icon name="UploadCloud" size={14}/>{state.school.treasurerIdCardId ? 'Ganti KTP' : 'Unggah KTP'}</button></div><input ref={ktpBendRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={e => { void uploadCard(e.target.files?.[0], 'treasurerIdCardId', 'treasurerIdCard'); e.target.value = ''; }}/></div></div>
      </div>
    </section>

    <section className="card" style={{ padding: 22, marginBottom: 20 }}>
      <div className="card-header" style={{ padding: '0 0 14px' }}><div><h2>Daftar Pemindahbukuan ({batches.length})</h2><p>Beberapa pemindahbukuan dalam satu bulan diperbolehkan.</p></div><button className="text-button" onClick={() => { void load(); }}><Icon name="RefreshCw" size={14}/>Muat ulang</button></div>
      {loading ? <p className="field-hint">Memuat data pemindahbukuan…</p> : !batches.length ? <div className="empty-state compact"><div className="empty-art"><span/><Icon name="Wallet" size={26}/></div><h3>Belum ada pemindahbukuan</h3><p>Klik “Buat Pemindahbukuan”, lalu isi manual atau unggah Excel Rekap Non-Tunai.</p></div> : grouped.map(([key, list]) => <div key={key} style={{ marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{FULL_MONTHS[Number(key.slice(5, 7)) - 1].toUpperCase()} {key.slice(0, 4)}</div>
        <div className="table-wrap"><table><thead><tr><th>Judul</th><th>Nomor Surat</th><th>Tanggal</th><th>Rekening</th><th>Total</th><th>Aksi</th></tr></thead><tbody>
          {list.map(batch => <tr key={batch.id}>
            <td className="table-strong">{batch.title}</td>
            <td>{batch.letterNumber || '—'}</td>
            <td>{dateLabel(batch.letterDate, true)}</td>
            <td>{batch.rows.length}</td>
            <td className="table-money">{money(totalOf(batch.rows))}</td>
            <td><div className="row-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button className="btn btn-outline btn-small" title="Pratinjau Surat Perintah" onClick={() => ensureAuth(() => { void showPreview(batch, 'letter'); })}><Icon name="Eye" size={13}/>Surat</button>
              <button className="btn btn-outline btn-small" title="Pratinjau Payroll" onClick={() => ensureAuth(() => { void showPreview(batch, 'payroll'); })}><Icon name="Eye" size={13}/>Payroll</button>
              <button className="btn btn-outline btn-small" disabled={busy} onClick={() => ensureAuth(() => { void exportFile(batch, 'docx', 'letter'); })}><Icon name="FileDown" size={13}/>Word</button>
              <button className="btn btn-outline btn-small" disabled={busy} onClick={() => ensureAuth(() => { void exportFile(batch, 'pdf', 'letter'); })}><Icon name="Download" size={13}/>PDF</button>
              <button className="btn btn-outline btn-small" disabled={busy} title="Unduh Rekap Non-Tunai (Excel)" onClick={() => ensureAuth(() => { void exportFile(batch, 'xlsx', 'recap'); })}><Icon name="FileSpreadsheet" size={13}/>Excel</button>
              <button className="icon-button" title="Edit" onClick={() => ensureAuth(() => setEditor(batch))}><Icon name="Pencil" size={15}/></button>
              <button className="icon-button danger-text" title="Hapus" onClick={() => ensureAuth(() => { void remove(batch); })}><Icon name="Trash2" size={15}/></button>
            </div></td>
          </tr>)}
        </tbody></table></div>
      </div>)}
    </section>

    <section className="card" style={{ padding: 22 }}>
      <div className="card-header" style={{ padding: '0 0 14px', flexWrap: 'wrap' }}>
        <div><h2>Pratinjau Dokumen</h2><p>{previewBatch ? `${previewBatch.title} · ${previewBatch.rows.length} rekening · ${money(totalOf(previewBatch.rows))}` : 'Pilih Surat atau Payroll pada daftar di atas.'}</p></div>
        {previewBatch && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Pilih dokumen" value={scope} onChange={e => { const next = e.target.value as typeof scope; setScope(next); void showPreview(previewBatch, next); }}><option value="all">Surat + Payroll + KTP</option><option value="letter">Surat Perintah Pemindah Bukuan</option><option value="payroll">Payroll Landscape</option><option value="ktp">Lampiran KTP</option></select>
          <button className="btn btn-outline btn-small" disabled={busy} onClick={() => ensureAuth(() => { void exportFile(previewBatch, 'docx'); })}><Icon name="FileDown" size={14}/>Word</button>
          <button className="btn btn-primary btn-small" disabled={busy} onClick={() => ensureAuth(() => { void exportFile(previewBatch, 'pdf'); })}><Icon name="Download" size={14}/>PDF F4</button>
        </div>}
      </div>
      {previewLoading ? <p className="field-hint">Menyiapkan pratinjau…</p> : previewUrl ? <iframe title="Pratinjau Pemindahbukuan PDF" src={`${previewUrl}#toolbar=1&view=FitH`} style={{ width: '100%', height: 660, border: '1px solid #e3e9ef', borderRadius: 8 }}/> : <div className="empty-state compact"><div className="empty-art"><span/><Icon name="Printer" size={26}/></div><h3>Belum ada dokumen dipilih</h3><p>Gunakan tombol Surat atau Payroll untuk menampilkan pratinjau PDF.</p></div>}
    </section>

    {editor && <BatchEditor batch={editor} onClose={() => setEditor(null)} onSaved={async saved => { setEditor(null); await load(); if (saved) await showPreview(saved, 'letter'); }} />}
  </>;
}

function BatchEditor({ batch, onClose, onSaved }: { batch: Batch; onClose: () => void; onSaved: (saved?: Batch) => Promise<void> }) {
  const { state, notify, ensureAuth } = useApp();
  const [form, setForm] = useState<Batch>(batch);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [detected, setDetected] = useState('');
  const excelRef = useRef<HTMLInputElement>(null);
  const defaultBank = state.school.bankName ? (state.school.bankName.toUpperCase().includes('JAWA TIMUR') ? 'BPD-JATIM' : state.school.bankName.slice(0, 18)) : 'BPD-JATIM';
  const rows = form.rows;
  const setRow = (index: number, key: keyof TransferRow, value: string | number) => setForm(prev => ({ ...prev, rows: prev.rows.map((row, i) => i === index ? { ...row, [key]: value } : row) }));
  const total = totalOf(rows);

  async function uploadExcel(file?: File) {
    if (!file) return;
    setParsing(true);
    try {
      const body = new FormData(); body.append('file', file);
      const res = await api<{ rows: TransferRow[]; detected: { month?: number; year?: number; headerRow: number }; title: string }>('transfer/parse', 'POST', body);
      if (!res.rows.length) throw new Error('Tidak ada baris rekening yang terdeteksi pada berkas Excel.');
      setForm(prev => ({ ...prev, title: prev.title || res.title || prev.title, rows: res.rows.map(row => ({ ...row, bank: row.bank || defaultBank })), month: res.detected.month || prev.month, year: res.detected.year || prev.year }));
      setDetected(`${res.rows.length} baris terdeteksi otomatis (header pada baris ${res.detected.headerRow}${res.detected.month ? `, bulan ${FULL_MONTHS[res.detected.month - 1]} ${res.detected.year}` : ''}).`);
      notify('Excel berhasil dibaca dan tabel langsung terisi.');
    } catch (e) { notify((e as Error).message, true); }
    finally { setParsing(false); if (excelRef.current) excelRef.current.value = ''; }
  }

  async function save() {
    setSaving(true);
    try {
      const payload = { ...form, rows: rows.filter(row => row.name.trim() && row.amount > 0) };
      if (!payload.rows.length) throw new Error('Isi minimal satu rekening dengan nama dan nominal.');
      const saved = await api<Batch>(form.id ? `transfer/batches/${form.id}` : 'transfer/batches', form.id ? 'PUT' : 'POST', payload);
      notify('Pemindahbukuan berhasil disimpan.');
      await onSaved(saved);
    } catch (e) { notify((e as Error).message, true); }
    finally { setSaving(false); }
  }

  return <Modal title={form.id ? 'Edit Pemindahbukuan' : 'Pemindahbukuan Baru'} subtitle="Isi manual atau unggah Excel Rekap Non-Tunai — data otomatis terdeteksi." onClose={saving ? undefined : onClose} wide footer={<><div className="form-total"><span>Total pemindahbukuan</span><strong>{money(total)}</strong></div><div className="form-footer-actions"><button className="btn btn-outline" disabled={saving} onClick={onClose}>Batal</button><button className="btn btn-primary" disabled={saving} onClick={() => ensureAuth(() => { void save(); })}><Icon name={saving ? 'LoaderCircle' : 'Save'} className={saving ? 'spin' : ''} size={16}/>{saving ? 'Menyimpan…' : 'Simpan Pemindahbukuan'}</button></div></>}>
    <div className="form-grid">
      <Field label="Judul pemindahbukuan" wide><input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Contoh: Pemindahbukuan BOSP November 2026 (1)"/></Field>
      <Field label="Nomor Surat Perintah Pemindah Bukuan"><input value={form.letterNumber} onChange={e => setForm(prev => ({ ...prev, letterNumber: e.target.value }))} placeholder="900/39/426.101.411.2.4/2026"/></Field>
      <Field label="Tanggal surat / pelimpahan"><input type="date" value={form.letterDate} onChange={e => setForm(prev => ({ ...prev, letterDate: e.target.value, month: Number(e.target.value.slice(5, 7)) || prev.month, year: Number(e.target.value.slice(0, 4)) || prev.year }))}/></Field>
      <Field label="Bank tujuan kuasa"><input value={form.bankName} onChange={e => setForm(prev => ({ ...prev, bankName: e.target.value }))} placeholder="PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk."/></Field>
      <Field label="Cabang"><input value={form.bankBranch} onChange={e => setForm(prev => ({ ...prev, bankBranch: e.target.value }))} placeholder="CABANG KRAKSAAN"/></Field>
      <Field label="Alamat bank"><input value={form.bankAddress} onChange={e => setForm(prev => ({ ...prev, bankAddress: e.target.value }))} placeholder="Jalan Raya Panglima Sudirman no. 144 Kraksaan"/></Field>
      <Field label="Nomor rekening Giro sekolah"><input value={form.giroNumber} onChange={e => setForm(prev => ({ ...prev, giroNumber: e.target.value }))} placeholder="0131084692"/></Field>
      <Field label="Atas nama rekening Giro"><input value={form.giroName} onChange={e => setForm(prev => ({ ...prev, giroName: e.target.value }))} placeholder={state.school.name || 'Nama sekolah'}/></Field>
    </div>

    <Notice tone="info"><b>Unggah Excel Rekap Non-Tunai.</b> Kolom yang dikenali: URAIAN, NO REKENING, NAMA REKENING, BANK, JUMLAH. Bulan dan tahun pada judul ikut terdeteksi otomatis. Belum punya template? <button type="button" className="inline-link" onClick={() => ensureAuth(() => { void downloadFile(apiUrl('transfer/template'), 'Template-Rekap-Non-Tunai.xlsx').catch(e => notify(e.message, true)); })}>unduh template di sini</button>.</Notice>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      <button type="button" className="btn btn-primary btn-small" disabled={parsing} onClick={() => ensureAuth(() => excelRef.current?.click())}><Icon name={parsing ? 'LoaderCircle' : 'UploadCloud'} className={parsing ? 'spin' : ''} size={15}/>{parsing ? 'Membaca Excel…' : 'Unggah Excel Rekap'}</button>
      <input ref={excelRef} type="file" hidden accept=".xlsx" onChange={e => { void uploadExcel(e.target.files?.[0]); }}/>
      <button type="button" className="btn btn-outline btn-small" onClick={() => setForm(prev => ({ ...prev, rows: [...prev.rows, emptyRow(defaultBank)] }))}><Icon name="Plus" size={14}/>Tambah Baris</button>
      {detected && <span className="field-hint" style={{ alignSelf: 'center' }}><Icon name="CheckCircle2" size={13}/> {detected}</span>}
    </div>

    <div className="editable-table transfer-table table-wrap">
      <table><thead><tr><th>No</th><th>Nama Rekening / Penerima</th><th>No. Rekening</th><th>Bank</th><th>Nominal (Rp)</th><th>Uraian / Keterangan</th><th/></tr></thead>
        <tbody>{rows.map((row, idx) => <tr key={idx}>
          <td className="muted-text">{idx + 1}</td>
          <td><input aria-label={`Nama rekening ${idx + 1}`} value={row.name} placeholder="Nama pemilik rekening" onChange={e => setRow(idx, 'name', e.target.value)}/></td>
          <td><input aria-label={`Nomor rekening ${idx + 1}`} value={row.accountNumber} placeholder="Nomor rekening" onChange={e => setRow(idx, 'accountNumber', e.target.value)}/></td>
          <td><input aria-label={`Bank ${idx + 1}`} value={row.bank} placeholder="BPD-JATIM" onChange={e => setRow(idx, 'bank', e.target.value)}/></td>
          <td><input aria-label={`Nominal ${idx + 1}`} type="number" min="0" step="1" value={row.amount || ''} placeholder="0" onChange={e => setRow(idx, 'amount', Number(e.target.value))}/></td>
          <td><input aria-label={`Uraian ${idx + 1}`} value={row.description} placeholder="Uraian pembayaran" onChange={e => setRow(idx, 'description', e.target.value)}/></td>
          <td><button type="button" className="icon-button danger-text" disabled={rows.length === 1} aria-label="Hapus baris" onClick={() => setForm(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== idx) }))}><Icon name="Trash2" size={15}/></button></td>
        </tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>TOTAL ({rows.filter(r => r.name.trim() && r.amount > 0).length} Rekening)</td><td className="table-money">{number(total)}</td><td colSpan={2}/></tr></tfoot>
      </table>
    </div>
  </Modal>;
}
