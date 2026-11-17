import type { Block } from './blocks';
import type { DocumentPage } from './document-model';
import { FULL_MONTHS, dateLabel, money, number, romanMonth, terbilang, text, transferRowsOf, type Attachment, type SchoolProfile, type Transaction, type TransferRow } from './domain';

export interface TransferBatchInput {
  letterNumber?: string;
  date?: string;
  month?: number;
  year?: number;
  rows: TransferRow[];
  scope?: 'all' | 'letter' | 'payroll' | 'recap' | 'ktp';
}

const p = (value: string, bold = false, center = false, size?: number): Block => ({ type: 'text', value, bold, center, size });
const cents = (value: number) => `${number(Math.round(value))},00`;
const schoolName = (school: SchoolProfile) => school.name || '[Nama sekolah]';
const titleCaseWords = (value: number) => terbilang(value).split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

export function rowsFromTransactions(list: Transaction[], defaultBank = ''): TransferRow[] {
  const result: TransferRow[] = [];
  for (const t of list) {
    const subRows = transferRowsOf(t);
    if (subRows.length) {
      for (const r of subRows) result.push({ name: r.name, accountNumber: r.accountNumber, bank: r.bank || defaultBank, amount: r.amount, description: r.description || t.title });
      continue;
    }
    result.push({
      name: text(t.data, 'accountHolder') || text(t.data, 'recipient') || '[Nama penerima]',
      accountNumber: text(t.data, 'accountNumber') || '',
      bank: text(t.data, 'recipientBank') || defaultBank,
      amount: t.amount,
      description: t.title,
    });
  }
  return result;
}

export function transferDocuments(school: SchoolProfile, assets: Attachment[], input: TransferBatchInput): DocumentPage[] {
  const year = input.year || school.year;
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : `${year}-${String(input.month || new Date().getMonth() + 1).padStart(2, '0')}-17`;
  const monthIdx = Math.max(0, Math.min(11, (input.month || Number(date.slice(5, 7)) || 1) - 1));
  const monthUpper = FULL_MONTHS[monthIdx].toUpperCase();
  const rows = input.rows.filter(r => r.name.trim() && r.amount > 0);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const accountCount = rows.length;
  const letterNo = (input.letterNumber || school.transferNumberFormat || `900/39/426.101.411.2.4/${year}`)
    .replaceAll('{tahun}', String(year))
    .replaceAll('{bulan_romawi}', romanMonth(date));
  const bankFull = school.bankName || 'PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk.';
  const bankBranch = school.bankBranch || '[Cabang bank]';
  const bankAddress = school.bankAddress || '[Alamat cabang bank]';
  const giroNumber = school.bankAccountNumber || '[Nomor rekening giro sekolah]';
  const giroHolder = school.bankAccountName || schoolName(school);
  const signPlace = school.village || school.regency || '[Tempat]';
  const principalSign = assets.find(f => f.id === school.principalSignatureId);
  const treasurerSign = assets.find(f => f.id === school.treasurerSignatureId);

  const letterPage: DocumentPage = {
    title: 'SURAT PERINTAH PEMINDAH BUKUAN',
    letterhead: true,
    orientation: 'portrait',
    blocks: [
      p(`Nomor : ${letterNo}`, false, true, 11),
      p('Yang bertanda tangan di bawah ini:', false, false, 11),
      {
        type: 'kv',
        labelWidth: 36,
        rows: [
          ['1. Nama', school.principal || '[Nama kepala sekolah]'],
          ['   NIP', school.principalNip || '-'],
          ['   Jabatan', `Kepala ${schoolName(school)}`],
          ['   Alamat', school.principalAddress || school.address || '[Alamat kepala sekolah]'],
          ['2. Nama', school.treasurer || '[Nama bendahara]'],
          ['   NIP', school.treasurerNip || '-'],
          ['   Jabatan', 'Bendahara BOS'],
          ['   Alamat', school.treasurerAddress || school.address || '[Alamat bendahara]'],
        ],
      },
      p(`Bertindak untuk dan atas nama Kepala Sekolah ${schoolName(school)}, dengan ini memberikan kuasa penuh yang tidak dapat dicabut kembali dengan Hak Substitusi kepada :`, false, false, 11),
      p(`${bankFull}\n${bankBranch}\nBerkedudukan di\n${bankAddress}`, true, true, 11),
      p('KHUSUS', true, true, 11.5),
      p(`Untuk memindahbukukan dari rekening Giro kami yang ada di ${bankFull} ${bankBranch} dengan nomor rekening : ${giroNumber} atas nama ${giroHolder} untuk dilimpahkan kepada rekening (terlampir) yang tidak terpisahkan dari surat perintah pemindahbukuan ini dengan jumlah : ${accountCount} Rekening dengan total nominal ${money(total)},- (${titleCaseWords(total)}) pada tanggal ${dateLabel(date)}.`, false, false, 11),
      p(`Demikian Surat Perintah Pemindah Bukuan ini dibuat untuk dipergunakan sebagaimana mestinya. Segala akibat yang timbul atas pemberian surat perintah pemindahbukuan ini menjadi tanggung jawab kami sepenuhnya dengan membebaskan ${bankFull} ${bankBranch} dari segala akibat tuntutan atau gugatan yang timbul dari transaksi rekening tersebut di atas.`, false, false, 11),
      p(`${signPlace}, ${dateLabel(date)}\nHormat kami,\n${schoolName(school).toUpperCase()}\n${school.regency ? `Kabupaten ${school.regency}` : ''}`.trim(), true, true, 11),
      {
        type: 'signatures',
        date: '',
        signers: [
          { role: 'Kepala,', name: school.principal || '[Nama kepala sekolah]', nip: school.principalNip, image: principalSign },
          { role: 'Bendahara Pengeluaran,', name: school.treasurer || '[Nama bendahara]', nip: school.treasurerNip, image: treasurerSign },
        ],
      },
    ],
  };

  const minPayrollRows = Math.max(8, rows.length);
  const payrollRows: string[][] = Array.from({ length: minPayrollRows }, (_, idx) => {
    const r = rows[idx];
    return r ? [String(idx + 1), r.name, r.accountNumber || '', cents(r.amount), r.description] : [String(idx + 1), '', '', '', ''];
  });
  payrollRows.push(['', 'TOTAL', '', money(total), '']);

  const payrollWordPage: DocumentPage = {
    title: 'LAMPIRAN DAFTAR PEMINDAHBUKUAN',
    letterhead: true,
    showTitle: false,
    orientation: 'landscape',
    blocks: [
      {
        type: 'table',
        size: 10.5,
        boldLastRow: true,
        headers: ['NO', 'NAMA', 'NO. REKENING', 'NOMINAL', 'KETERANGAN'],
        rows: payrollRows,
        widths: [0.06, 0.25, 0.19, 0.17, 0.33],
      },
    ],
  };

  const minRecapRows = Math.max(8, rows.length);
  const defaultShortBank = school.bankName ? (school.bankName.toUpperCase().includes('JAWA TIMUR') ? 'BPD-JATIM' : school.bankName.slice(0, 18)) : 'BPD-JATIM';
  const recapRows: string[][] = Array.from({ length: minRecapRows }, (_, idx) => {
    const r = rows[idx];
    return r ? [String(idx + 1), r.description, r.accountNumber || '', r.name, r.bank || defaultShortBank, cents(r.amount)] : [String(idx + 1), '', '', '', '', ''];
  });
  recapRows.push(['', 'JUMLAH', '', '', '', cents(total)]);

  const recapPage: DocumentPage = {
    title: `DATA REKAP PEMBAYARAN NON TUNAI BULAN ${monthUpper} ${year}`,
    letterhead: false,
    showTitle: false,
    orientation: 'landscape',
    blocks: [
      p(`DATA REKAP PEMBAYARAN NON TUNAI BULAN ${monthUpper} ${year}`, true, true, 13),
      p(`BANTUAN OPERASIONAL SATUAN PENDIDIKAN (BOSP) ${year}`, true, true, 12),
      p(schoolName(school).toUpperCase(), true, true, 12),
      {
        type: 'table',
        size: 9.5,
        boldLastRow: true,
        headers: ['NO', 'URAIAN', 'NO REKENING', 'NAMA REKENING', 'BANK', 'JUMLAH'],
        rows: recapRows,
        widths: [0.05, 0.32, 0.16, 0.22, 0.11, 0.14],
      },
      {
        type: 'signatures',
        date: `${school.district || school.regency || signPlace}, ${dateLabel(date)}`,
        signers: [
          { role: 'Mengetahui,\nKepala Sekolah', name: school.principal || '[Nama kepala sekolah]', nip: school.principalNip, image: principalSign },
          { role: 'Bendahara', name: school.treasurer || '[Nama bendahara]', nip: school.treasurerNip, image: treasurerSign },
        ],
      },
    ],
  };

  const ktpFiles = [assets.find(f => f.id === school.principalIdCardId), assets.find(f => f.id === school.treasurerIdCardId)].filter((f): f is Attachment => Boolean(f));
  const ktpPage: DocumentPage = {
    title: 'LAMPIRAN KTP KEPALA SEKOLAH DAN BENDAHARA',
    letterhead: false,
    showTitle: false,
    orientation: 'portrait',
    blocks: ktpFiles.length
      ? [{ type: 'gallery', files: ktpFiles, columns: 2, rows: 2 }]
      : [p('LAMPIRAN KTP KEPALA SEKOLAH DAN BENDAHARA', true, true), p('Foto KTP Kepala Sekolah dan Bendahara belum diunggah. Unggah melalui menu Identitas Sekolah (Kop & tanda tangan) atau halaman Pemindahbukuan.', false, true)],
  };

  const scope = input.scope || 'all';
  if (scope === 'letter') return [letterPage];
  if (scope === 'payroll') return [payrollWordPage];
  if (scope === 'recap') return [recapPage];
  if (scope === 'ktp') return [ktpPage];
  return [letterPage, payrollWordPage, recapPage, ktpPage];
}
