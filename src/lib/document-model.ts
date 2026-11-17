import { makeReceipt, type ReceiptContent } from './receipt-layout';
import type { Block, Signer } from './blocks';
import { decreeDocument, invitationDocument } from './decree';
import { handoverDocument, inspectionDocument, orderDocument } from './procurement';
import { CATEGORIES, FULL_MONTHS, categoryOf, dateLabel, documentChecks, documentTitle, itemsOf, lines, money, monthLabel, number, pembinaOf, terbilang, text, transactionStatus, STATUS_LABELS, workersOf, type Attachment, type DocTemplate, type DocumentKind, type SchoolProfile, type Transaction } from './domain';
const prettyDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateLabel(value) : value;
export type { Block, Signer } from './blocks';
export interface DocumentPage { title: string; letterhead: boolean; blocks: Block[]; receipt?: ReceiptContent; showTitle?: boolean; orientation?: 'portrait' | 'landscape' }
const p = (value: string, bold = false): Block => ({ type: 'text', value, bold });
const table = (headers: string[], rows: string[][], widths?: number[]): Block => ({ type: 'table', headers, rows, widths });
export function transactionDocuments(t: Transaction, school: SchoolProfile, templates: DocTemplate[], assets: Attachment[], scope = 'all'): DocumentPage[] {
  const d = (key: string) => { const value = text(t.data, key); if (key === 'period' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return `${FULL_MONTHS[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}`; return value || '—'; };
  const schoolSigners: Signer[] = [
    { role: 'Mengetahui,\nKepala Sekolah', name: school.principal || '—', nip: school.principalNip, image: assets.find(f => f.id === school.principalSignatureId) },
    { role: 'Bendahara BOSP', name: school.treasurer || '—', nip: school.treasurerNip, image: assets.find(f => f.id === school.treasurerSignatureId) },
    { role: 'Penerima', name: d('recipient') },
  ];
  const sign = (signers = schoolSigners, date = t.date): Block => ({ type: 'signatures', signers, date: `${text(t.data, 'paymentPlace') || school.regency || school.village || '—'}, ${dateLabel(date)}` });
  const itemTable = () => table(['No.', 'Nama barang / spesifikasi', 'Jumlah', 'Satuan', 'Harga satuan', 'Total'], itemsOf(t).map((i, n) => [String(n + 1), `${i.name}${i.specification ? '\n' + i.specification : ''}`, String(i.quantity), i.unit || '—', money(i.price), money(i.quantity * i.price)]), [0.06, 0.32, 0.12, 0.1, 0.2, 0.2]);
  const workers = workersOf(t);
  const pages: DocumentPage[] = [];
  const checks = documentChecks(t, school);
  const requested = scope === 'attachments' ? [] : scope === 'all' || scope === 'documents' ? checks.filter(c => c.key === 'receipt' || (c.ready && (scope !== 'documents' || !c.uploaded || ['minutes', 'attendance'].includes(c.key)))).map(c => c.key) : [scope as DocumentKind];
  const appendAttachment = (file: Attachment, title?: string) => {
    const heading = title || documentTitle(file.kind as DocumentKind, t.category) || 'Lampiran dokumen';
    // Notulen/daftar hadir rapat hanya berupa foto dengan kop dan judul—tanpa label data otomatis.
    if (['minutes', 'attendance'].includes(file.kind)) {
      pages.push({ title: heading.toUpperCase(), letterhead: true, blocks: [{ type: 'image', file, size: 'large' }] });
      return;
    }
    // Dokumentasi disusun 2 kolom x 4 baris per halaman seperti album kegiatan.
    if (file.kind === 'documentation' && file.mime.startsWith('image/')) {
      pages.push({ title: heading.toUpperCase(), letterhead: false, blocks: [{ type: 'gallery', files: [file], columns: 2, rows: 4 }] });
      return;
    }
    const printable = file.mime === 'application/pdf' ? undefined : ('size' as const);
    pages.push({ title: heading.toUpperCase(), letterhead: false, blocks: printable ? [{ type: 'image', file, size: 'medium' }] : [p(file.name), { type: 'image', file }] });
  };
  const appendDocumentation = (files: Attachment[], title: string) => {
    const images = files.filter(f => f.mime.startsWith('image/'));
    const others = files.filter(f => !f.mime.startsWith('image/'));
    for (let i = 0; i < images.length; i += 8) pages.push({ title: title.toUpperCase(), letterhead: false, blocks: [{ type: 'gallery', files: images.slice(i, i + 8), columns: 2, rows: 4, startNumber: i + 1 }] });
    others.forEach(f => appendAttachment(f, title));
  };
  for (const kind of requested) {
    if (!categoryOf(t.category).documents.some(key => key === kind)) continue;
    const uploaded = t.files.filter(f => f.kind === kind);
    if (['minutes', 'attendance'].includes(kind)) {
      uploaded.forEach(file => appendAttachment(file, documentTitle(kind, t.category)));
      continue;
    }
    if (scope !== 'documents' && uploaded.length && kind !== 'receipt') {
      // Bukti pembayaran tetap satu gambar per halaman agar terbaca; dokumentasi dikelompokkan.
      if (kind === 'documentation') appendDocumentation(uploaded, documentTitle(kind, t.category));
      else uploaded.forEach(f => appendAttachment(f, documentTitle(kind, t.category)));
      continue;
    }
    if (kind === 'evidence' || kind === 'documentation') continue;
    const blocks: Block[] = [];
    const custom = templates.find(temp => temp.key === `${t.category}:${kind}` || temp.key === kind)?.content;
    const customText = custom?.replaceAll('{nama_sekolah}', school.name || '—').replaceAll('{nama_kegiatan}', t.title).replaceAll('{tanggal}', dateLabel(t.date)).replaceAll('{nama_penerima}', d('recipient')).replaceAll('{nomor_kuitansi}', t.number);
    if (kind === 'receipt') {
      pages.push({ title: 'KUITANSI PEMBAYARAN', letterhead: false, receipt: makeReceipt(t, school), blocks: customText ? [p(customText)] : [] });
      continue;
    }
    if (kind === 'invitation') {
      const doc = invitationDocument(t, school, assets);
      if (customText) doc.blocks.unshift(p(customText));
      pages.push({ title: doc.title, letterhead: true, blocks: doc.blocks });
      continue;
    }
    if (kind === 'decree') {
      const doc = decreeDocument(t, school, assets);
      // Template tidak ditempel setelah Tembusan agar SK tetap sesuai tata naskah dinas.
      pages.push({ title: doc.title, letterhead: true, showTitle: false, blocks: doc.blocks });
      continue;
    }
    const withReceiptNumber = !['transport', 'coachAttendance', 'participantsAttendance', 'order', 'handover', 'inspection'].includes(kind);
    if (withReceiptNumber) blocks.push(p(`Nomor kuitansi: ${t.number}`));
    if (customText) blocks.push(p(customText));
    switch (kind) {
      case 'transport': {
        const coaches = pembinaOf(t);
        const names = coaches.length ? coaches : [d('recipient')];
        const meetings = Math.max(1, lines(d('meetingDates')).filter(value => value !== '—').length);
        const perUnit = Number(text(t.data, 'honorPerUnit')) || Math.max(1, Math.round(t.amount / names.length / meetings));
        const pphPercent = text(t.data, 'pphPercent') === '' ? 5 : Math.max(0, Math.min(50, Number(text(t.data, 'pphPercent')) || 0));
        const golongan = text(t.data, 'golongan').trim() || '-';
        let totalGross = 0, totalPph = 0, totalNet = 0;
        const rows = names.map((name, index) => {
          const gross = perUnit * meetings;
          const pph = Math.round(gross * pphPercent / 100);
          const net = gross - pph;
          totalGross += gross; totalPph += pph; totalNet += net;
          return [String(index + 1), name, golongan, `${meetings} X`, number(perUnit), number(gross), number(pph), number(net), String(index + 1)];
        });
        rows.push(['', 'JUMLAH', '', '', '', number(totalGross), number(totalPph), number(totalNet), '']);
        const pelatih = t.category === 'pramuka' ? 'PRAMUKA' : "TAHFIDZ QUR'AN";
        blocks.push(
          { type: 'text', value: `DAFTAR PENERIMAAN TRANSPORT PELATIH ${pelatih}`, center: true, bold: true },
          { type: 'text', value: 'BANTUAN OPERASIONAL SEKOLAH (B O S)', center: true, bold: true },
          { type: 'kv', rows: [['NAMA SEKOLAH', school.name || '[Nama sekolah]'], ['KECAMATAN', school.district || '[Kecamatan]'], ['KABUPATEN', school.regency || '[Kabupaten]'], ['BULAN', monthLabel(t)]], labelWidth: 36 },
          { type: 'table', size: 9.5, boldLastRow: true, headers: ['NO', 'NAMA', 'GOL', 'WAKTU', 'SATUAN (Rp)', 'JUMLAH (Rp)', 'PPh Ps.21', 'DI TERIMAKAN', 'TTD'], rows, widths: [0.05, 0.26, 0.06, 0.09, 0.12, 0.115, 0.10, 0.145, 0.06] },
          { type: 'signatures', date: `${text(t.data, 'paymentPlace') || school.regency || school.village || '[Tempat]'}, ${dateLabel(t.date)}`, signers: [
            { role: 'Setuju dibayar\nKepala sekolah', name: school.principal || '[Nama kepala sekolah]', nip: school.principalNip, image: assets.find(f => f.id === school.principalSignatureId) },
            { role: 'Bendahara', name: school.treasurer || '[Nama bendahara]', nip: school.treasurerNip, image: assets.find(f => f.id === school.treasurerSignatureId) },
          ] },
        );
        break;
      }
      case 'coachAttendance': {
        const coaches = pembinaOf(t);
        const dates = lines(d('meetingDates')).filter(value => value !== '—');
        blocks.push(p(`BULAN: ${monthLabel(t)}`, true), table(['No.', 'Tanggal Kegiatan', 'Nama Pembina / Pelatih', 'Tanda Tangan'], (dates.length ? dates : ['—']).map((date, i) => [String(i + 1), prettyDate(date), coaches.length ? coaches.join(', ') : d('recipient'), '']), [0.07, 0.22, 0.42, 0.29]), sign([schoolSigners[0]]));
        break;
      }
      case 'participantsAttendance': {
        const dates = lines(d('meetingDates')).filter(v => v !== '—');
        const names = lines(d('participants')).filter(v => v !== '—');
        blocks.push(p(`BULAN: ${monthLabel(t)}`, true));
        for (let i = 0; i < Math.max(1, dates.length); i += 4) {
          const chunk = dates.slice(i, i + 4);
          blocks.push(table(['No.', 'Nama Peserta / Anggota', ...chunk.map(prettyDate)], names.map((name, n) => [String(n + 1), name, ...chunk.map(() => '')]), [0.08, 0.32, ...chunk.map(() => 0.6 / chunk.length)]));
        }
        blocks.push(sign([{ role: 'Pembina / pelatih', name: d('recipient') }]));
        break;
      }
      case 'order':
        blocks.push(...orderDocument(t, school, assets));
        break;
      case 'handover':
        blocks.push(...handoverDocument(t, school, assets));
        break;
      case 'inspection':
        blocks.push(...inspectionDocument(t, school, assets));
        break;
      case 'wages':
        blocks.push(p(`Pekerjaan: ${t.title}`), p(`Lokasi: ${d('place')} | Periode: ${d('period')}`), table(['No.', 'Nama pekerja / pekerjaan', 'Hari', 'Upah / hari', 'Total', 'Tanda tangan'], workers.map((w, i) => [String(i + 1), `${w.name}\n${w.job}`, String(w.days), money(w.wage), money(w.days * w.wage), '']), [0.06, 0.28, 0.08, 0.2, 0.2, 0.18]), p(`Total upah: ${money(t.amount)}`, true), sign(schoolSigners.slice(0, 2)));
        break;
      case 'workersAttendance': {
        const dates = lines(d('workDates')).filter(v => v !== '—');
        blocks.push(p(`Pekerjaan: ${t.title}`), p(`Lokasi: ${d('place')} | Periode: ${d('period')}`));
        for (let i = 0; i < Math.max(1, dates.length); i += 4) { const chunk = dates.slice(i, i + 4); blocks.push(table(['No.', 'Nama pekerja', ...chunk], workers.map((w, n) => [String(n + 1), w.name, ...chunk.map(() => '')]), [0.08, 0.32, ...chunk.map(() => 0.6 / chunk.length)])); }
        blocks.push(sign(schoolSigners.slice(0, 2)));
        break;
      }
    }
    pages.push({ title: documentTitle(kind, t.category).toUpperCase(), letterhead: true, blocks, showTitle: kind !== 'transport' });
  }
  if (scope === 'attachments') {
    const rest = [...t.files];
    const docs = rest.filter(f => f.kind === 'documentation');
    if (docs.length) appendDocumentation(docs, documentTitle('documentation', t.category));
    rest.filter(f => f.kind !== 'documentation').forEach(f => appendAttachment(f));
  }
  if (scope === 'all') {
    const extra = t.files.filter(f => !requested.includes(f.kind as DocumentKind));
    const docs = extra.filter(f => f.kind === 'documentation');
    if (docs.length) appendDocumentation(docs, documentTitle('documentation', t.category));
    extra.filter(f => f.kind !== 'documentation').forEach(f => appendAttachment(f));
  }
  if (!pages.length) pages.push({ title: 'LAMPIRAN SPJ', letterhead: false, blocks: [p(`Nomor kuitansi: ${t.number}`), p('Belum ada lampiran yang tersedia.')] });
  return pages;
}
export function reportDocuments(list: Transaction[], school: SchoolProfile, year: number): DocumentPage[] {
  const total = list.reduce((sum, t) => sum + t.amount, 0);
  const head: Block[] = [p(`Tahun anggaran: ${year}`), p(`Total pengeluaran: ${money(total)}`, true), p(`Jumlah transaksi: ${list.length}`)];
  const sign: Block = { type: 'signatures', signers: [{ role: 'Kepala Sekolah', name: school.principal || '—', nip: school.principalNip }, { role: 'Bendahara BOSP', name: school.treasurer || '—', nip: school.treasurerNip }], date: school.regency || '' };
  const txRows = (txs: Transaction[]) => txs.map((t, i) => [String(i + 1), `${t.number}\n${dateLabel(t.date, true)}`, t.title, categoryOf(t.category).short, money(t.amount), STATUS_LABELS[transactionStatus(t, school)]]);
  return [
    { title: 'REKAPITULASI BELANJA BULANAN BOSP', letterhead: true, blocks: [...head, table(['Bulan', 'Jumlah transaksi', 'Total belanja'], FULL_MONTHS.map((month, i) => { const rows = list.filter(t => Number(t.date.slice(5, 7)) === i + 1); return [month, String(rows.length), money(rows.reduce((s, t) => s + t.amount, 0))]; }), [0.4, 0.25, 0.35]), sign] },
    { title: 'REKAPITULASI BELANJA PER KATEGORI', letterhead: true, blocks: [...head, table(['Kategori', 'Jumlah transaksi', 'Total belanja'], CATEGORIES.map(c => { const rows = list.filter(t => t.category === c.id); return [c.label, String(rows.length), money(rows.reduce((s, t) => s + t.amount, 0))]; }), [0.5, 0.2, 0.3]), sign] },
    { title: 'DAFTAR SELURUH TRANSAKSI BOSP', letterhead: true, blocks: [...head, table(['No.', 'Kuitansi / tanggal', 'Kegiatan', 'Kategori', 'Jumlah', 'Status'], txRows(list), [0.05, 0.2, 0.25, 0.17, 0.18, 0.15]), sign] },
    { title: 'REKAPITULASI DOKUMEN BELUM LENGKAP', letterhead: true, blocks: [p(`Tahun anggaran: ${year}`), table(['No.', 'Kuitansi / tanggal', 'Kegiatan', 'Kategori', 'Jumlah', 'Status'], txRows(list.filter(t => transactionStatus(t, school) !== 'complete')), [0.05, 0.2, 0.25, 0.17, 0.18, 0.15]), sign] },
    { title: 'REKAPITULASI BERDASARKAN JENIS BELANJA', letterhead: true, blocks: [...head, table(['Jenis belanja', 'Jumlah transaksi', 'Total belanja'], [...new Set(list.map(t => String(t.data.purchaseType || categoryOf(t.category).short)))].map(type => { const rows = list.filter(t => String(t.data.purchaseType || categoryOf(t.category).short) === type); return [type, String(rows.length), money(rows.reduce((s, t) => s + t.amount, 0))]; }), [0.5, 0.2, 0.3]), sign] },
  ];
}
