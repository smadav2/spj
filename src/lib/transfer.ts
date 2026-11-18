import type { Block } from './blocks';
import type { DocumentPage } from './document-model';
import { FULL_MONTHS, dateLabel, money, number, terbilang, type Attachment, type SchoolProfile, type TransferRow } from './domain';

export interface TransferBatchLike {
  title: string;
  letterNumber: string;
  letterDate: string;
  month: number;
  year: number;
  bankName: string;
  bankBranch: string;
  bankAddress: string;
  giroNumber: string;
  giroName: string;
  rows: TransferRow[];
}
export type TransferScope = 'all' | 'letter' | 'payroll' | 'ktp' | 'recap';

const p = (value: string, bold = false, center = false, size?: number): Block => ({ type: 'text', value, bold, center, size });
const titleCaseWords = (value: number) => terbilang(value).split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const schoolName = (school: SchoolProfile) => school.name || '[Nama sekolah]';

export function transferTotal(rows: TransferRow[]) { return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0); }

export function transferDocuments(school: SchoolProfile, assets: Attachment[], batch: TransferBatchLike, scope: TransferScope = 'all'): DocumentPage[] {
  const date = batch.letterDate && /^\d{4}-\d{2}-\d{2}$/.test(batch.letterDate) ? batch.letterDate : `${batch.year}-${String(batch.month || 1).padStart(2, '0')}-17`;
  const monthIdx = Math.max(0, Math.min(11, (batch.month || Number(date.slice(5, 7)) || 1) - 1));
  const monthUpper = FULL_MONTHS[monthIdx].toUpperCase();
  const rows = batch.rows.filter(row => row.name.trim() && row.amount > 0);
  const total = transferTotal(rows);
  const bankName = batch.bankName || school.bankName || 'PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk.';
  const bankBranch = batch.bankBranch || school.bankBranch || '[Cabang bank]';
  const bankAddress = batch.bankAddress || school.bankAddress || '[Alamat cabang bank]';
  const giroNumber = batch.giroNumber || school.bankAccountNumber || '[Nomor rekening giro sekolah]';
  const giroName = batch.giroName || school.bankAccountName || schoolName(school);
  const signPlace = school.village || school.regency || '[Tempat]';
  const principalSign = assets.find(f => f.id === school.principalSignatureId);
  const treasurerSign = assets.find(f => f.id === school.treasurerSignatureId);
  const letterNo = batch.letterNumber || (school.transferNumberFormat || `900/39/426.101.411.2.4/${batch.year}`).replaceAll('{tahun}', String(batch.year));

  const letterPage: DocumentPage = {
    title: 'SURAT PERINTAH PEMINDAH BUKUAN',
    letterhead: true,
    orientation: 'portrait',
    blocks: [
      p(`Nomor : ${letterNo}`, false, true, 11),
      p('Yang **bertanda tangan** di bawah ini:', false, false, 10.5),
      {
        type: 'kv',
        labelWidth: 30,
        size: 10,
        rows: [
          ['1. Nama', `**${school.principal || '[Nama kepala sekolah]'}**`],
          ['   NIP', school.principalNip || '-'],
          ['   Jabatan', `Kepala ${schoolName(school)}`],
          ['   Alamat', school.principalAddress || school.address || '[Alamat kepala sekolah]'],
          ['2. Nama', `**${school.treasurer || '[Nama bendahara]'}**`],
          ['   NIP', school.treasurerNip || '-'],
          ['   Jabatan', 'Bendahara BOS'],
          ['   Alamat', school.treasurerAddress || school.address || '[Alamat bendahara]'],
        ],
      },
      p(`Bertindak untuk dan atas nama Kepala Sekolah ${schoolName(school)}, dengan ini memberikan kuasa penuh yang tidak dapat dicabut kembali dengan Hak Substitusi kepada :`, false, false, 10.5),
      p(`**${bankName}**\n**${bankBranch}**\nBerkedudukan di\n**${bankAddress}**`, false, true, 10.5),
      p('**KHUSUS**', false, true, 11),
      p(`Untuk memindahbukukan dari rekening Giro kami yang ada di ${bankName} ${bankBranch} dengan nomor rekening : **${giroNumber}** atas nama ${giroName} untuk dilimpahkan kepada rekening (terlampir) yang tidak terpisahkan dari surat perintah pemindahbukuan ini dengan jumlah : **${rows.length} Rekening** dengan total nominal **${money(total)},- (${titleCaseWords(total)})** pada tanggal ${dateLabel(date)}.`, false, false, 10.5),
      p(`Demikian Surat Perintah Pemindah Bukuan ini dibuat untuk dipergunakan sebagaimana mestinya. Segala akibat yang timbul atas pemberian surat perintah pemindahbukuan ini menjadi tanggung jawab kami sepenuhnya dengan membebaskan ${bankName} ${bankBranch} dari segala akibat tuntutan atau gugatan yang timbul dari transaksi rekening tersebut di atas.`, false, false, 10.5),
      p(`**${signPlace}, ${dateLabel(date)}**\n**Hormat kami,**\n**${schoolName(school).toUpperCase()}**\n${school.regency ? `**Kabupaten ${school.regency}**` : ''}`.trim(), false, true, 10.5),
      {
        type: 'signatures',
        date: '',
        widthFraction: 0.62,
        signers: [
          { role: 'Kepala,', name: school.principal || '[Nama kepala sekolah]', nip: school.principalNip, image: principalSign },
          { role: 'Bendahara Pengeluaran,', name: school.treasurer || '[Nama bendahara]', nip: school.treasurerNip, image: treasurerSign },
        ],
      },
    ],
  };

  const fillRows = Math.max(8, rows.length);
  const payrollRows: string[][] = Array.from({ length: fillRows }, (_, idx) => {
    const row = rows[idx];
    return row ? [String(idx + 1), row.name, row.accountNumber || '', `${number(row.amount)},00`, row.description] : [String(idx + 1), '', '', '', ''];
  });
  const payrollPage: DocumentPage = {
    title: 'LAMPIRAN DAFTAR PEMINDAHBUKUAN',
    letterhead: true,
    showTitle: false,
    orientation: 'landscape',
    blocks: [
      { type: 'payroll', headers: ['NO', 'NAMA', 'NO. REKENING', 'NOMINAL', 'KETERANGAN'], rows: payrollRows, totalRow: ['', 'TOTAL', '', money(total), ''], widths: [0.06, 0.26, 0.18, 0.17, 0.33], underlineCols: [4] },
    ],
  };

  const ktpFiles = [assets.find(f => f.id === school.principalIdCardId), assets.find(f => f.id === school.treasurerIdCardId)].filter((f): f is Attachment => Boolean(f));
  const ktpPage: DocumentPage = {
    title: 'LAMPIRAN KTP KEPALA SEKOLAH DAN BENDAHARA',
    letterhead: false,
    showTitle: false,
    orientation: 'portrait',
    blocks: ktpFiles.length ? [{ type: 'gallery', files: ktpFiles, columns: 2, rows: 2 }] : [p('LAMPIRAN KTP KEPALA SEKOLAH DAN BENDAHARA', true, true), p('Foto KTP Kepala Sekolah dan Bendahara belum diunggah. Unggah melalui menu Pemindahbukuan atau Identitas Sekolah (Kop & tanda tangan).', false, true)],
  };

  if (scope === 'letter') return [letterPage];
  if (scope === 'payroll') return [payrollPage];
  if (scope === 'ktp') return [ktpPage];
  if (scope === 'recap') return [];
  return [letterPage, payrollPage, ktpPage];
}

export function recapRows(rows: TransferRow[], school: SchoolProfile, month: number, year: number) {
  const monthUpper = FULL_MONTHS[Math.max(0, Math.min(11, (month || 1) - 1))].toUpperCase();
  const defaultBank = school.bankName ? (school.bankName.toUpperCase().includes('JAWA TIMUR') ? 'BPD-JATIM' : school.bankName.slice(0, 18)) : 'BPD-JATIM';
  return {
    title: [`DATA REKAP PEMBAYARAN NON TUNAI BULAN ${monthUpper} ${year}`, `BANTUAN OPERASIONAL SATUAN PENDIDIKAN (BOSP) ${year}`, (school.name || 'NAMA SEKOLAH BELUM DIISI').toUpperCase()],
    headers: ['NO', 'URAIAN', 'NO REKENING', 'NAMA REKENING', 'BANK', 'JUMLAH'],
    rows: rows.map((row, idx) => [String(idx + 1), row.description, row.accountNumber || '', row.name, row.bank || defaultBank, row.amount]),
  };
}
