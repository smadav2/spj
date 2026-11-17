'use client';
import { useEffect, useRef, useState } from 'react';
import { FULL_MONTHS, money, text, type SchoolProfile, type TransferRow } from '@/lib/domain';
import { Field, Icon, Notice, PageHeading, api, apiUrl, downloadFile, useApp } from './ui';

const SCOPES = [
  ['all', 'Paket Pemindahbukuan Lengkap'],
  ['letter', '1. Surat Perintah Pemindah Bukuan (KOP · Portrait)'],
  ['payroll', '2. Payroll Word (KOP · Landscape)'],
  ['recap', '3. Data Rekap Non Tunai (Tanpa KOP · Landscape)'],
  ['ktp', '4. Lampiran KTP Kepala Sekolah & Bendahara'],
] as const;

export default function TransferView() {
  const { state, year, refresh, notify, ensureAuth, navigate } = useApp();
  const [school, setSchool] = useState<SchoolProfile>(state.school);
  const [month, setMonth] = useState<number>(() => {
    const first = state.transactions.find(t => t.year === year);
    return first ? Number(first.date.slice(5, 7)) : new Date().getMonth() + 1;
  });
  const [date, setDate] = useState(`${year}-${String(month).padStart(2, '0')}-17`);
  const [letterNumber, setLetterNumber] = useState(state.school.transferNumberFormat || `900/39/426.101.411.2.4/${year}`);
  const [scope, setScope] = useState<typeof SCOPES[number][0]>('all');
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingSchool, setSavingSchool] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const ktpKsRef = useRef<HTMLInputElement>(null);
  const ktpBendRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSchool(state.school); }, [state.school]);

  const monthTransactions = state.transactions.filter(t => t.year === year && Number(t.date.slice(5, 7)) === month);
  const defaultShortBank = school.bankName ? (school.bankName.toUpperCase().includes('JAWA TIMUR') ? 'BPD-JATIM' : school.bankName.slice(0, 18)) : 'BPD-JATIM';

  function loadFromTransactions() {
    const built: TransferRow[] = monthTransactions.map(t => ({
      name: text(t.data, 'accountHolder') || text(t.data, 'recipient') || '',
      accountNumber: text(t.data, 'accountNumber') || '',
      bank: text(t.data, 'recipientBank') || defaultShortBank,
      amount: t.amount,
      description: t.title,
    }));
    setRows(built.length ? built : [{ name: '', accountNumber: '', bank: defaultShortBank, amount: 0, description: '' }]);
  }

  useEffect(() => {
    setDate(`${year}-${String(month).padStart(2, '0')}-17`);
    const built: TransferRow[] = state.transactions
      .filter(t => t.year === year && Number(t.date.slice(5, 7)) === month)
      .map(t => ({
        name: text(t.data, 'accountHolder') || text(t.data, 'recipient') || '',
        accountNumber: text(t.data, 'accountNumber') || '',
        bank: text(t.data, 'recipientBank') || defaultShortBank,
        amount: t.amount,
        description: t.title,
      }));
    setRows(built.length ? built : [{ name: '', accountNumber: '', bank: defaultShortBank, amount: 0, description: '' }]);
  }, [month, year, state.transactions, defaultShortBank]);

  const validRows = rows.filter(r => r.name.trim() && r.amount > 0);
  const total = validRows.reduce((s, r) => s + Number(r.amount || 0), 0);

  async function saveBankAndKtp() {
    setSavingSchool(true);
    try {
      await api('school', 'PUT', school);
      await refresh();
      notify('Data bank, alamat penanda tangan, dan KTP berhasil disimpan.');
    } catch (e) { notify((e as Error).message, true); }
    finally { setSavingSchool(false); }
  }

  async function uploadIdCard(file: File | undefined, kind: 'principalIdCard' | 'treasurerIdCard', key: 'principalIdCardId' | 'treasurerIdCardId') {
    if (!file) return;
    if (!/\.(jpe?g|png)$/i.test(file.name) || file.size > 8 * 1024 * 1024) {
      notify('Gunakan foto JPG atau PNG, maksimal 8 MB.', true);
      return;
    }
    setSavingSchool(true);
    try {
      const form = new FormData(); form.set('kind', kind); form.append('files', file);
      const res = await api<{ files: { id: string }[] }>('upload', 'POST', form);
      const next = { ...school, [key]: res.files[0].id };
      setSchool(next);
      await api('school', 'PUT', next);
      await refresh();
      notify('Foto KTP berhasil diunggah dan disimpan.');
    } catch (e) { notify((e as Error).message, true); }
    finally { setSavingSchool(false); }
  }

  async function refreshPreview() {
    setPreviewLoading(true);
    try {
      const res = await fetch(apiUrl('transfer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'pdf', scope, year, month, date, letterNumber, rows: validRows }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Gagal memuat pratinjau.'); }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return nextUrl; });
    } catch (e) { notify((e as Error).message, true); }
    finally { setPreviewLoading(false); }
  }

  async function exportDoc(format: 'pdf' | 'docx' | 'xlsx', targetScope = scope) {
    setBusy(true);
    try {
      const res = await fetch(apiUrl('transfer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, scope: targetScope, year, month, date, letterNumber, rows: validRows }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Ekspor gagal.'); }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `Pemindahbukuan-${year}-${String(month).padStart(2, '0')}-${targetScope}.${format}`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      notify(`Dokumen ${format.toUpperCase()} berhasil diunduh.`);
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeading title="Pemindahbukuan & Payroll Non-Tunai" description="Susun Surat Perintah Pemindah Bukuan, Payroll Word Landscape berkop, Rekap Non-Tunai tanpa kop, dan lampiran KTP.">
      <button className="btn btn-outline" disabled={busy} onClick={() => ensureAuth(() => { void exportDoc('xlsx', 'recap'); })}><Icon name="FileSpreadsheet" size={17}/>Excel Rekap</button>
      <button className="btn btn-outline" disabled={busy} onClick={() => ensureAuth(() => { void exportDoc('docx', scope); })}><Icon name="FileDown" size={17}/>Download Word</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => ensureAuth(() => { void exportDoc('pdf', scope); })}><Icon name="Printer" size={17}/>Download / Cetak PDF</button>
    </PageHeading>

    <Notice>Data rekening diambil dari transaksi bulan yang dipilih dan dapat Anda lengkapi langsung pada tabel di bawah. Aplikasi tidak mengarang nomor rekening, nama bank, atau foto KTP.</Notice>

    <section className="card" style={{ padding: 22, marginBottom: 20 }}>
      <div className="form-section-title first"><Icon name="Building2"/><div><h3>Pengaturan Surat, Bank &amp; KTP Penanda Tangan</h3><p>Disimpan ke Identitas Sekolah agar tidak perlu diinput berulang setiap bulan.</p></div></div>
      <div className="form-grid">
        <Field label="Nomor Surat Perintah Pemindah Bukuan"><input value={letterNumber} onChange={e => setLetterNumber(e.target.value)} placeholder="900/39/426.101.411.2.4/2026"/></Field>
        <Field label="Tanggal surat / pelimpahan"><input type="date" value={date} onChange={e => setDate(e.target.value)}/></Field>
        <Field label="Bulan rekap non-tunai"><select value={month} onChange={e => setMonth(Number(e.target.value))}>{FULL_MONTHS.map((m, idx) => <option key={m} value={idx + 1}>{m} ({state.transactions.filter(t => t.year === year && Number(t.date.slice(5, 7)) === idx + 1).length} transaksi)</option>)}</select></Field>
        <Field label="Nama bank tujuan kuasa"><input value={school.bankName} onChange={e => setSchool(prev => ({ ...prev, bankName: e.target.value }))} placeholder="PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk."/></Field>
        <Field label="Cabang bank"><input value={school.bankBranch} onChange={e => setSchool(prev => ({ ...prev, bankBranch: e.target.value }))} placeholder="CABANG KRAKSAAN"/></Field>
        <Field label="Alamat cabang bank"><input value={school.bankAddress} onChange={e => setSchool(prev => ({ ...prev, bankAddress: e.target.value }))} placeholder="Jalan Raya Panglima Sudirman no. 144 Kraksaan"/></Field>
        <Field label="Nomor rekening Giro sekolah"><input value={school.bankAccountNumber} onChange={e => setSchool(prev => ({ ...prev, bankAccountNumber: e.target.value }))} placeholder="Nomor rekening giro BOSP sekolah"/></Field>
        <Field label="Atas nama rekening Giro"><input value={school.bankAccountName} onChange={e => setSchool(prev => ({ ...prev, bankAccountName: e.target.value }))} placeholder={school.name || 'Nama sekolah pada rekening giro'}/></Field>
        <Field label="Alamat Kepala Sekolah (pada surat kuasa)"><input value={school.principalAddress} onChange={e => setSchool(prev => ({ ...prev, principalAddress: e.target.value }))} placeholder="Dusun / RT/RW / Desa / Kecamatan"/></Field>
        <Field label="Alamat Bendahara BOS (pada surat kuasa)"><input value={school.treasurerAddress} onChange={e => setSchool(prev => ({ ...prev, treasurerAddress: e.target.value }))} placeholder="Dusun / RT/RW / Desa / Kecamatan"/></Field>
      </div>

      <div className="form-grid" style={{ marginTop: 10 }}>
        <div className="school-asset">
          <div className="school-asset-preview">{school.principalIdCardId ? <img src={apiUrl(`files/${school.principalIdCardId}`)} alt="KTP Kepala Sekolah"/> : <Icon name="UserRound" size={34}/>}</div>
          <div><h4>KTP Kepala Sekolah</h4><p>Dicetak berdampingan pada halaman lampiran KTP.</p><div className="asset-actions"><button type="button" className="btn btn-outline btn-small" disabled={savingSchool} onClick={() => ensureAuth(() => ktpKsRef.current?.click())}><Icon name="UploadCloud" size={14}/>{school.principalIdCardId ? 'Ganti KTP' : 'Unggah KTP'}</button>{school.principalIdCardId && <button type="button" className="icon-button danger-text" onClick={() => setSchool(prev => ({ ...prev, principalIdCardId: '' }))}><Icon name="Trash2" size={15}/></button>}</div><input ref={ktpKsRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={e => { void uploadIdCard(e.target.files?.[0], 'principalIdCard', 'principalIdCardId'); e.target.value = ''; }}/></div>
        </div>
        <div className="school-asset">
          <div className="school-asset-preview">{school.treasurerIdCardId ? <img src={apiUrl(`files/${school.treasurerIdCardId}`)} alt="KTP Bendahara"/> : <Icon name="UserRound" size={34}/>}</div>
          <div><h4>KTP Bendahara BOSP</h4><p>Dicetak berdampingan dengan KTP Kepala Sekolah.</p><div className="asset-actions"><button type="button" className="btn btn-outline btn-small" disabled={savingSchool} onClick={() => ensureAuth(() => ktpBendRef.current?.click())}><Icon name="UploadCloud" size={14}/>{school.treasurerIdCardId ? 'Ganti KTP' : 'Unggah KTP'}</button>{school.treasurerIdCardId && <button type="button" className="icon-button danger-text" onClick={() => setSchool(prev => ({ ...prev, treasurerIdCardId: '' }))}><Icon name="Trash2" size={15}/></button>}</div><input ref={ktpBendRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={e => { void uploadIdCard(e.target.files?.[0], 'treasurerIdCard', 'treasurerIdCardId'); e.target.value = ''; }}/></div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <span className="field-hint">Kepala Sekolah: <b>{school.principal || 'belum diisi'}</b> · Bendahara: <b>{school.treasurer || 'belum diisi'}</b> (<button type="button" className="inline-link" onClick={() => navigate('school')}>ubah di Identitas Sekolah</button>)</span>
        <button type="button" className="btn btn-primary btn-small" disabled={savingSchool} onClick={() => ensureAuth(() => { void saveBankAndKtp(); })}><Icon name={savingSchool ? 'LoaderCircle' : 'Save'} className={savingSchool ? 'spin' : ''} size={15}/>Simpan Pengaturan Bank &amp; KTP</button>
      </div>
    </section>

    <section className="card" style={{ padding: 22, marginBottom: 20 }}>
      <div className="card-header" style={{ padding: '0 0 16px' }}>
        <div><h2>Daftar Rekening Penerima ({validRows.length} rekening · Total {money(total)})</h2><p>Digunakan bersama untuk Surat Perintah Pemindah Bukuan, Payroll Word berkop, dan Rekap Non-Tunai tanpa kop.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-small" onClick={loadFromTransactions}><Icon name="RefreshCw" size={14}/>Muat dari Transaksi {FULL_MONTHS[month - 1]}</button>
          <button type="button" className="btn btn-outline btn-small" onClick={() => setRows(prev => [...prev, { name: '', accountNumber: '', bank: defaultShortBank, amount: 0, description: '' }])}><Icon name="Plus" size={14}/>Tambah Baris</button>
        </div>
      </div>
      <div className="editable-table transfer-table table-wrap">
        <table>
          <thead><tr><th>No</th><th>Nama Rekening / Penerima</th><th>No. Rekening</th><th>Bank</th><th>Nominal (Rp)</th><th>Uraian / Keterangan</th><th/></tr></thead>
          <tbody>
            {rows.map((row, idx) => <tr key={idx}>
              <td className="muted-text">{idx + 1}</td>
              <td><input aria-label={`Nama rekening ${idx + 1}`} value={row.name} placeholder="Nama pemilik rekening" onChange={e => setRows(prev => prev.map((v, n) => n === idx ? { ...v, name: e.target.value } : v))}/></td>
              <td><input aria-label={`Nomor rekening ${idx + 1}`} value={row.accountNumber} placeholder="Nomor rekening" onChange={e => setRows(prev => prev.map((v, n) => n === idx ? { ...v, accountNumber: e.target.value } : v))}/></td>
              <td><input aria-label={`Bank ${idx + 1}`} value={row.bank} placeholder="BPD-JATIM" onChange={e => setRows(prev => prev.map((v, n) => n === idx ? { ...v, bank: e.target.value } : v))}/></td>
              <td><input aria-label={`Nominal ${idx + 1}`} type="number" min="0" step="1" value={row.amount || ''} placeholder="0" onChange={e => setRows(prev => prev.map((v, n) => n === idx ? { ...v, amount: Number(e.target.value) } : v))}/></td>
              <td><input aria-label={`Uraian ${idx + 1}`} value={row.description} placeholder="Uraian pembayaran" onChange={e => setRows(prev => prev.map((v, n) => n === idx ? { ...v, description: e.target.value } : v))}/></td>
              <td><button type="button" className="icon-button danger-text" disabled={rows.length === 1} onClick={() => setRows(prev => prev.filter((_, n) => n !== idx))} aria-label="Hapus baris"><Icon name="Trash2" size={15}/></button></td>
            </tr>)}
          </tbody>
          <tfoot><tr><td colSpan={4}>TOTAL ({validRows.length} Rekening)</td><td className="table-money">{money(total)}</td><td colSpan={2}/></tr></tfoot>
        </table>
      </div>
    </section>

    <section className="card" style={{ padding: 22 }}>
      <div className="card-header" style={{ padding: '0 0 16px', flexWrap: 'wrap' }}>
        <div><h2>Pratinjau &amp; Cetak Dokumen Pemindahbukuan</h2><p>Pilih salah satu dokumen atau cetak sekaligus dalam satu paket F4.</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="Pilih dokumen pemindahbukuan" value={scope} onChange={e => setScope(e.target.value as typeof scope)} style={{ width: 'auto', maxWidth: '100%' }}>
            {SCOPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" className="btn btn-outline btn-small" disabled={previewLoading} onClick={() => ensureAuth(() => { void refreshPreview(); })}><Icon name={previewLoading ? 'LoaderCircle' : 'Eye'} className={previewLoading ? 'spin' : ''} size={15}/>Tampilkan Pratinjau PDF</button>
          <button type="button" className="btn btn-outline btn-small" disabled={busy} onClick={() => ensureAuth(() => { void exportDoc('docx', scope); })}><Icon name="FileDown" size={15}/>Word (.docx)</button>
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => ensureAuth(() => { void exportDoc('pdf', scope); })}><Icon name="Download" size={15}/>PDF F4</button>
        </div>
      </div>
      {previewUrl ? <iframe title="Pratinjau Pemindahbukuan PDF" src={`${previewUrl}#toolbar=1&view=FitH`} style={{ width: '100%', height: 680, border: '1px solid #e3e9ef', borderRadius: 8 }}/> : <div className="empty-state compact"><div className="empty-art"><span/><Icon name="Printer" size={28}/></div><h3>Siap membuat dokumen pemindahbukuan</h3><p>Klik &ldquo;Tampilkan Pratinjau PDF&rdquo; untuk memeriksa Surat Perintah Pemindah Bukuan, Payroll Landscape berkop, Rekap Non-Tunai tanpa kop, dan KTP.</p><button type="button" className="btn btn-outline btn-small" onClick={() => ensureAuth(() => { void refreshPreview(); })}><Icon name="Eye" size={14}/>Tampilkan Pratinjau PDF</button></div>}
    </section>
  </>;
}
