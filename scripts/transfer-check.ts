import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { EMPTY_SCHOOL, type Attachment, type SchoolProfile, type TransferRow } from '@/lib/domain';
import { transferDocuments } from '@/lib/transfer';
import { renderPDF, renderTransferExcel } from '@/lib/exports';

const out = 'artifacts/transfer';

async function main() {
  await mkdir(out, { recursive: true });
  const img = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="860" height="540"><rect width="860" height="540" rx="20" fill="#cfe7f4" stroke="#4c7a96" stroke-width="6"/><text x="50" y="90" font-size="30" font-family="Arial" fill="#17384c">KTP UJI</text></svg>')).png().toBuffer();
  const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><circle cx="80" cy="80" r="70" fill="#dff0f7" stroke="#18384e" stroke-width="6"/></svg>')).png().toBuffer();
  const asset = (id: string, kind: string, name: string, bytes: Buffer): Attachment => ({ id, transactionId: null, kind, name, mime: 'image/png', size: bytes.length, content: bytes.toString('base64'), createdAt: '' });
  const assets: Attachment[] = [
    asset('00000000-0000-4000-8000-0000000000b1', 'logo', 'logo-l.png', logo),
    asset('00000000-0000-4000-8000-0000000000b2', 'logo', 'logo-r.png', logo),
    asset('00000000-0000-4000-8000-0000000000b3', 'principalIdCard', 'ktp-ks.png', img),
    asset('00000000-0000-4000-8000-0000000000b4', 'treasurerIdCard', 'ktp-bend.png', img),
  ];
  const school: SchoolProfile = {
    ...EMPTY_SCHOOL,
    name: 'SD NEGERI SIDOMULYO II KOTAANYAR', government: 'PEMERINTAH KABUPATEN PROBOLINGGO', department: 'DINAS PENDIDIKAN DAN KEBUDAYAAN',
    address: 'Dusun Poreng Desa Sidomulyo', village: 'Sidomulyo', district: 'Kotaanyar', regency: 'Probolinggo', postalCode: '67293',
    website: 'sdvilla.eu.org', email: 'sdn.uji@example.org',
    principal: 'SUSWATI, S.Pd', principalNip: '19711021 199403 2 004', principalAddress: 'Dusun Pande RT/RW 02/010 Desa Triwungan Kec. Kotaanyar',
    treasurer: 'NURHAYATI, S.Pd', treasurerNip: '19850603 202321 2 030', treasurerAddress: 'Dusun Asem Jajar RT/RW 005/002 Desa Sidomulyo Kec. Kotaanyar',
    bankName: 'PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk.', bankBranch: 'CABANG KRAKSAAN', bankAddress: 'Jalan Raya Panglima Sudirman no. 144 Kraksaan, Kab. Probolinggo',
    bankAccountNumber: '0131084692', bankAccountName: 'SD Negeri Sidomulyo II',
    logoId: assets[0].id, rightLogoId: assets[1].id, principalIdCardId: assets[2].id, treasurerIdCardId: assets[3].id,
  };
  const rows: TransferRow[] = [
    { name: 'RISTU LAILI SAFARI', accountNumber: '0132774196', bank: 'BPD-JATIM', amount: 150000, description: 'Pembayaran wifi Bulan November 2026' },
    { name: 'NURHAYATI', accountNumber: '0132980390', bank: 'BPD-JATIM', amount: 53000, description: 'Bayar Token Listrik November' },
    { name: 'NURHAYATI', accountNumber: '0132980390', bank: 'BPD-JATIM', amount: 135000, description: 'Membayar Konsumsi rapat Guru' },
    { name: 'DUA PUTRI', accountNumber: '', bank: 'BPD-JATIM', amount: 150000, description: 'Membayar Siplah Pemeliharaan' },
    { name: 'DUA PUTRI', accountNumber: '', bank: 'BPD-JATIM', amount: 2906000, description: 'Membayar Siplah ATK' },
    { name: 'DUA PUTRI', accountNumber: '', bank: 'BPD-JATIM', amount: 1085000, description: 'Membayar Siplah Kebersihan' },
  ];
  const batch = { title: 'Pemindahbukuan November 2026 (1)', letterNumber: '900/39/426.101.411.2.4/2026', letterDate: '2026-11-17', month: 11, year: 2026, bankName: school.bankName, bankBranch: school.bankBranch, bankAddress: school.bankAddress, giroNumber: school.bankAccountNumber, giroName: school.bankAccountName, rows };

  const docs = transferDocuments(school, assets, batch, 'all');
  assert.equal(docs.length, 3, 'paket = Surat + Payroll + KTP (Rekap dipisah ke Excel)');
  assert.equal(docs[0].orientation, 'portrait');
  assert.equal(docs[1].orientation, 'landscape');
  assert.equal(docs[2].orientation, 'portrait');
  const pdfBytes = await renderPDF(docs, school, assets, { orientation: 'portrait', margin: 20 });
  await writeFile(`${out}/transfer-all.pdf`, pdfBytes);
  const pdf = await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getPageCount(), 3);
  assert.ok(pdf.getPage(0).getWidth() < pdf.getPage(0).getHeight());
  assert.ok(pdf.getPage(1).getWidth() > pdf.getPage(1).getHeight());
  const page = (n: number) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', `${out}/transfer-all.pdf`, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  const p1 = page(1);
  for (const phrase of ['SURAT PERINTAH PEMINDAH BUKUAN', '900/39/426.101.411.2.4/2026', 'PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk.', 'CABANG KRAKSAAN', 'KHUSUS', '0131084692', '6 Rekening', 'Rp 4.479.000', 'Empat Juta Empat Ratus Tujuh Puluh Sembilan Ribu Rupiah', 'Kepala,', 'Bendahara Pengeluaran,', 'SUSWATI, S.Pd', 'NURHAYATI, S.Pd']) assert.ok(p1.includes(phrase), `halaman 1 hilang: ${phrase}`);
  const p2 = page(2);
  for (const phrase of ['NO', 'NAMA', 'NO. REKENING', 'NOMINAL', 'KETERANGAN', 'RISTU LAILI SAFARI', '150.000,00', 'TOTAL', 'Rp 4.479.000']) assert.ok(p2.includes(phrase), `halaman 2 hilang: ${phrase}`);
  assert.ok(!page(1).includes('DATA REKAP PEMBAYARAN NON TUNAI'), 'Rekap tidak boleh digabung dalam PDF surat');
  console.log('PASS: PDF = Surat Perintah (portrait berkop) + Payroll (landscape berkop) + Lampiran KTP; Rekap dipisah.');

  const xlsx = await renderTransferExcel(rows, school, 11, 2026, '17 November 2026');
  await writeFile(`${out}/rekap.xlsx`, Buffer.from(xlsx));
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(Buffer.from(xlsx));
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const shared = await zip.file('xl/sharedStrings.xml')?.async('string') || '';
  const content = sheetXml + shared;
  assert.ok(content.includes('Pembayaran wifi Bulan November 2026'));
  assert.ok(content.includes('BPD-JATIM'));
  assert.ok(content.includes('DATA REKAP PEMBAYARAN NON TUNAI BULAN NOVEMBER 2026'));
  assert.ok(/<pageSetup[^>]*orientation="landscape"/.test(sheetXml), 'rekap Excel harus landscape');
  const styles = await zip.file('xl/styles.xml')!.async('string');
  assert.ok(styles.includes('FFBDD7EE') || styles.includes('BDD7EE'), 'baris TOTAL biru pada Excel');
  console.log('PASS: Rekap Non-Tunai tersedia sebagai Excel landscape dengan baris TOTAL berwarna.');
  console.log('ALL TRANSFER DOCUMENT TESTS PASSED');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
