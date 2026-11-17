import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { EMPTY_SCHOOL, type Attachment, type SchoolProfile, type TransferRow } from '@/lib/domain';
import { transferDocuments } from '@/lib/transfer';
import { renderPDF, renderTransferExcel, renderWord } from '@/lib/exports';

const out = 'artifacts/transfer';

async function main() {
  await mkdir(out, { recursive: true });
  const ktpImg = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="860" height="540"><rect width="860" height="540" rx="22" fill="#bfe3f4" stroke="#4c7a96" stroke-width="6"/><text x="60" y="95" font-size="34" font-family="Arial" font-weight="bold" fill="#17384c">KARTU TANDA PENDUDUK (UJI)</text><rect x="610" y="130" width="190" height="240" fill="#9c2c3c"/><text x="60" y="185" font-size="26" fill="#17384c">NIK : 0000000000000000</text><text x="60" y="240" font-size="24" fill="#17384c">DATA UJI PERANGKAT LUNAK</text></svg>')).png().toBuffer();
  const logoImg = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><circle cx="80" cy="80" r="70" fill="#e1f0f7" stroke="#18384e" stroke-width="6"/><text x="38" y="95" font-size="40" fill="#18384e">LOGO</text></svg>')).png().toBuffer();

  const assets: Attachment[] = [
    { id: '00000000-0000-4000-8000-0000000000a1', transactionId: null, kind: 'logo', name: 'logo1.png', mime: 'image/png', size: logoImg.length, content: logoImg.toString('base64'), createdAt: '' },
    { id: '00000000-0000-4000-8000-0000000000a2', transactionId: null, kind: 'logo', name: 'logo2.png', mime: 'image/png', size: logoImg.length, content: logoImg.toString('base64'), createdAt: '' },
    { id: '00000000-0000-4000-8000-0000000000a3', transactionId: null, kind: 'principalIdCard', name: 'ktp-ks.png', mime: 'image/png', size: ktpImg.length, content: ktpImg.toString('base64'), createdAt: '' },
    { id: '00000000-0000-4000-8000-0000000000a4', transactionId: null, kind: 'treasurerIdCard', name: 'ktp-bend.png', mime: 'image/png', size: ktpImg.length, content: ktpImg.toString('base64'), createdAt: '' },
  ];

  const school: SchoolProfile = {
    ...EMPTY_SCHOOL,
    name: 'SD NEGERI SIDOMULYO II KOTAANYAR',
    government: 'PEMERINTAH KABUPATEN PROBOLINGGO',
    department: 'DINAS PENDIDIKAN DAN KEBUDAYAAN',
    address: 'Dusun Poreng Desa Sidomulyo',
    village: 'Sidomulyo',
    district: 'Kotaanyar',
    regency: 'Probolinggo',
    postalCode: '67293',
    website: 'sdvilla.eu.org',
    email: 'sdn.uji@example.org',
    principal: 'SUSWATI, S.Pd',
    principalNip: '19711021 199403 2 004',
    principalAddress: 'Dusun Pande RT/RW 02/010 Desa Triwungan Kec. Kotaanyar',
    treasurer: 'NURHAYATI, S.Pd',
    treasurerNip: '19850603 202321 2 030',
    treasurerAddress: 'Dusun Asem Jajar RT/RW 005/002 Desa Sidomulyo Kec. Kotaanyar',
    bankName: 'PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk.',
    bankBranch: 'CABANG KRAKSAAN',
    bankAddress: 'Jalan Raya Panglima Sudirman no. 144 Kraksaan, Kab. Probolinggo',
    bankAccountNumber: '0131084692',
    bankAccountName: 'SD Negeri Sidomulyo II',
    logoId: assets[0].id,
    rightLogoId: assets[1].id,
    principalIdCardId: assets[2].id,
    treasurerIdCardId: assets[3].id,
  };

  const rows: TransferRow[] = [
    { name: 'RISTU LAILI SAFARI', accountNumber: '0132774196', bank: 'BPD-JATIM', amount: 150000, description: 'Pembayaran wifi Bulan November 2026' },
    { name: 'NURHAYATI', accountNumber: '0132980390', bank: 'BPD-JATIM', amount: 53000, description: 'Bayar Token Listrik November' },
    { name: 'NURHAYATI', accountNumber: '0132980390', bank: 'BPD-JATIM', amount: 135000, description: 'Membayar Konsumsi rapat Guru' },
    { name: 'DUA PUTRI', accountNumber: '', bank: 'BPD-JATIM', amount: 150000, description: 'Membayar Siplah Pemeliharaan' },
    { name: 'DUA PUTRI', accountNumber: '', bank: 'BPD-JATIM', amount: 2906000, description: 'Membayar Siplah ATK' },
    { name: 'DUA PUTRI', accountNumber: '', bank: 'BPD-JATIM', amount: 1085000, description: 'Membayar Siplah Kebersihan' },
  ];

  const docs = transferDocuments(school, assets, { letterNumber: '900/39/426.101.411.2.4/2026', date: '2026-11-17', month: 11, year: 2026, rows, scope: 'all' });
  assert.equal(docs.length, 4);
  assert.equal(docs[0].orientation, 'portrait');
  assert.equal(docs[0].letterhead, true);
  assert.equal(docs[1].orientation, 'landscape');
  assert.equal(docs[1].letterhead, true);
  assert.equal(docs[2].orientation, 'landscape');
  assert.equal(docs[2].letterhead, false);
  assert.equal(docs[3].orientation, 'portrait');

  const pdfBytes = await renderPDF(docs, school, assets, { orientation: 'portrait', margin: 20 });
  await writeFile(`${out}/transfer-all.pdf`, pdfBytes);
  const pdf = await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getPageCount(), 4, 'paket harus 4 halaman');
  assert.ok(pdf.getPage(0).getWidth() < pdf.getPage(0).getHeight(), 'halaman 1 (Surat Perintah) harus portrait');
  assert.ok(pdf.getPage(1).getWidth() > pdf.getPage(1).getHeight(), 'halaman 2 (Payroll Word berkop) harus landscape');
  assert.ok(pdf.getPage(2).getWidth() > pdf.getPage(2).getHeight(), 'halaman 3 (Rekap Non-Tunai tanpa kop) harus landscape');
  assert.ok(pdf.getPage(3).getWidth() < pdf.getPage(3).getHeight(), 'halaman 4 (KTP) harus portrait');

  const p1 = execFileSync('pdftotext', ['-f', '1', '-l', '1', '-layout', `${out}/transfer-all.pdf`, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  for (const phrase of ['PEMERINTAH KABUPATEN PROBOLINGGO', 'SURAT PERINTAH PEMINDAH BUKUAN', '900/39/426.101.411.2.4/2026', 'PT. BANK PEMBANGUNAN DAERAH JAWA TIMUR, Tbk.', 'CABANG KRAKSAAN', 'KHUSUS', '0131084692', '6 Rekening', 'Rp 4.479.000', 'Empat Juta Empat Ratus Tujuh Puluh Sembilan Ribu Rupiah', 'Kepala,', 'Bendahara Pengeluaran,', 'SUSWATI, S.Pd', 'NURHAYATI, S.Pd']) {
    assert.ok(p1.includes(phrase), `Halaman 1 kehilangan: ${phrase}`);
  }
  console.log('PASS: Halaman 1 — Surat Perintah Pemindah Bukuan lengkap dengan KOP, bank, nominal terbilang, dan TTD.');

  const p2 = execFileSync('pdftotext', ['-f', '2', '-l', '2', '-layout', `${out}/transfer-all.pdf`, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  for (const phrase of ['PEMERINTAH KABUPATEN PROBOLINGGO', 'NO', 'NAMA', 'NO. REKENING', 'NOMINAL', 'KETERANGAN', 'RISTU LAILI SAFARI', '0132774196', '150.000,00', 'TOTAL', 'Rp 4.479.000']) {
    assert.ok(p2.includes(phrase), `Halaman 2 kehilangan: ${phrase}`);
  }
  console.log('PASS: Halaman 2 — Payroll Word Landscape berkop dengan kolom NO, NAMA, NO. REKENING, NOMINAL, KETERANGAN, TOTAL.');

  const p3 = execFileSync('pdftotext', ['-f', '3', '-l', '3', '-layout', `${out}/transfer-all.pdf`, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  assert.ok(!p3.includes('DINAS PENDIDIKAN DAN KEBUDAYAAN'), 'Halaman 3 tidak boleh memakai KOP');
  for (const phrase of ['DATA REKAP PEMBAYARAN NON TUNAI BULAN NOVEMBER 2026', 'BANTUAN OPERASIONAL SATUAN PENDIDIKAN (BOSP) 2026', 'URAIAN', 'NO REKENING', 'NAMA REKENING', 'BANK', 'JUMLAH', 'BPD-JATIM', '4.479.000,00', 'Mengetahui,', 'Kepala Sekolah', 'Bendahara']) {
    assert.ok(p3.includes(phrase), `Halaman 3 kehilangan: ${phrase}`);
  }
  console.log('PASS: Halaman 3 — Data Rekap Non-Tunai Landscape tanpa KOP dengan kolom URAIAN, NO REKENING, NAMA REKENING, BANK, JUMLAH.');

  const wordBytes = await renderWord(docs, school, assets, { orientation: 'portrait', margin: 20 });
  await writeFile(`${out}/transfer-all.docx`, wordBytes);
  const zip = await JSZip.loadAsync(wordBytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.ok(xml.includes('w:orient="landscape"'), 'Word harus memiliki section landscape');
  assert.ok(xml.includes('SURAT PERINTAH PEMINDAH BUKUAN'));
  assert.ok(xml.includes('DATA REKAP PEMBAYARAN NON TUNAI'));
  console.log('PASS: Word (.docx) dapat diedit dan memuat section portrait + landscape.');

  const xlsxBytes = await renderTransferExcel(rows, school, 11, 2026, '17 November 2026');
  await writeFile(`${out}/transfer-recap.xlsx`, Buffer.from(xlsxBytes));
  assert.ok(xlsxBytes.byteLength > 2000);
  console.log('PASS: Ekspor Excel Rekap Non-Tunai berhasil dibuat.');
  console.log('ALL TRANSFER DOCUMENT TESTS PASSED');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
