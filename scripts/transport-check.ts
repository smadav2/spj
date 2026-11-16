import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { transactionDocuments } from '@/lib/document-model';
import { renderPDF, renderWord } from '@/lib/exports';
import { EMPTY_SCHOOL, pembinaOf, monthLabel, type Attachment, type SchoolProfile, type Transaction } from '@/lib/domain';
const out = 'artifacts/transport';
const school: SchoolProfile = { ...EMPTY_SCHOOL, name: 'SD NEGERI SIDOMULYO II', government: 'PEMERINTAH KABUPATEN PROBOLINGGO', department: 'DINAS PENDIDIKAN DAN KEBUDAYAAN', address: 'Dusun Pareng Desa Sidomulyo', district: 'Kotaanyar', regency: 'Probolinggo', principal: 'SUSWATI, S.Pd', principalNip: '19711021 199403 2 004', treasurer: 'NURHAYATI, S.Pd', treasurerNip: '19850603 202321 2 030', npsn: '00000000' };
const COACHES = 'FATIMATUS ZAHRO\nFAUZAN ALI MASHURI';
const PARTICIPANTS = 'PESERTA SATU\nPESERTA DUA';
const base = { id: '00000000-0000-4000-8000-000000000001', number: 'BNU001/SDN.SIDO 2/IX/2026', date: '2026-09-30', year: 2026, amount: 400000, finalized: false, createdAt: '', updatedAt: '', files: [] as Attachment[] };
const tahfidz: Transaction = { ...base, category: 'tahfidz', title: 'Honor Ekstra Tahfidz September', data: { recipient: 'FATIMATUS ZAHRO', coaches: COACHES, participants: PARTICIPANTS, period: '2026-09', meetingDates: '2026-09-03\n2026-09-10\n2026-09-17\n2026-09-24', honorUnit: '4 X pertemuan', honorPerUnit: '50000', pphPercent: '5', golongan: '-', decreeNumber: '800/07426.101.411.2.4/2026', decreeDate: '2026-07-02' } };
const pramuka: Transaction = { ...tahfidz, category: 'pramuka', title: 'Honor Ekstra Pramuka September', data: { ...tahfidz.data, recipient: 'TRIYUNI PURNAMASARI', coaches: 'TRIYUNI PURNAMASARI\nPEMBINA KEDUA', pphPercent: '0' } };
const text = (file: string) => execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
async function pagesOf(documents: ReturnType<typeof transactionDocuments>, name: string) {
  const pdfPath = `${out}/${name}.pdf`;
  await writeFile(pdfPath, await renderPDF(documents, school, [], { orientation: 'portrait', margin: 20 }));
  const bytes = await readFile(pdfPath); const pdf = await PDFDocument.load(bytes);
  for (const page of pdf.getPages()) { assert.ok(Math.abs(page.getWidth() - 215 * 72 / 25.4) < .3); assert.ok(Math.abs(page.getHeight() - 330 * 72 / 25.4) < .3); }
  const word = await renderWord(documents, school, [], { orientation: 'portrait', margin: 20 });
  await writeFile(`${out}/${name}.docx`, word);
  const zip = await JSZip.loadAsync(word); const xml = await zip.file('word/document.xml')!.async('string');
  assert.ok(xml.includes('12189'));
  return { pdfPath, count: pdf.getPageCount(), content: text(pdfPath), xml };
}
async function run() {
  await mkdir(out, { recursive: true });
  // pembina vs peserta
  assert.deepEqual(pembinaOf(tahfidz), ['FATIMATUS ZAHRO', 'FAUZAN ALI MASHURI']);
  assert.equal(monthLabel(tahfidz), 'September 2026');
  console.log('PASS: daftar pembina terpisah dari peserta; label bulan dari periode.');

  // 1) Daftar Penerimaan Transport (gambar 1)
  for (const [label, tx, expectedPph, expectedNet] of [['tahfidz', tahfidz, '20.000', '380.000'], ['pramuka', pramuka, '0', '400.000']] as const) {
    const docs = transactionDocuments(tx, school, [], [], 'transport');
    assert.equal(docs.length, 1);
    const page = await pagesOf(docs, `transport-${label}`);
    for (const phrase of ['DAFTAR PENERIMAAN TRANSPORT PELATIH', 'BANTUAN OPERASIONAL SEKOLAH (B O S)', 'NAMA SEKOLAH', 'KECAMATAN', 'KABUPATEN', 'BULAN', 'September 2026', 'SATUAN', 'JUMLAH', 'PPh Ps.21', 'TERIMAKAN', 'TTD', 'JUMLAH', 'Setuju dibayar', 'Kepala sekolah', 'Bendahara', 'SUSWATI, S.Pd', 'NURHAYATI, S.Pd', 'NIP. 19711021 199403 2 004']) assert.ok(page.content.includes(phrase), `${label}: missing "${phrase}"`);
    assert.ok(page.content.includes(expectedPph), `${label}: PPh ${expectedPph} tidak muncul`);
    assert.ok(page.content.includes(expectedNet), `${label}: penerimaan bersih (net) ${expectedNet} tidak muncul`);
    assert.ok(!page.content.includes('Nomor kuitansi'), `${label}: nomor kuitansi tidak boleh tampil di daftar transport`);
    assert.equal(page.count, 1, `${label}: daftar transport harus satu halaman`);
    console.log(`PASS: Daftar Penerimaan Transport ${label} sesuai gambar 1 (PPh ${expectedPph}, net ${expectedNet}, satu halaman).`);
  }

  // 2) SK memakai pembina, bukan peserta
  for (const [label, tx] of [['tahfidz', tahfidz], ['pramuka', pramuka]] as const) {
    const docs = transactionDocuments(tx, school, [{ key: 'decree', title: 'SK', content: 'BARIS TEMPLATE YANG TIDAK BOLEH MUNCUL' }], [], 'decree');
    const page = await pagesOf(docs, `sk-${label}`);
    assert.ok(page.content.includes('FATIMATUS ZAHRO') || page.content.includes('TRIYUNI PURNAMASARI'));
    assert.ok(!page.content.includes('PESERTA SATU'), `${label}: nama peserta tidak boleh masuk SK`);
    assert.ok(!page.content.includes('BARIS TEMPLATE'), `${label}: teks template tidak boleh menempel setelah Tembusan`);
    assert.ok(!/Tembusan[\s\S]*BARIS TEMPLATE/.test(page.content));
    assert.ok(page.content.includes('Tembusan:'));
    assert.ok(page.content.includes('Jumlah seluruh honor'));
    console.log(`PASS: SK ${label} memakai daftar pembina, tanpa nama peserta, tanpa baris liar setelah Tembusan.`);
  }

  // 3) Daftar hadir: hanya BULAN
  for (const [kind, label] of [['coachAttendance', 'hadir-pembina'], ['participantsAttendance', 'hadir-anggota']] as const) {
    const docs = transactionDocuments(tahfidz, school, [], [], kind);
    const page = await pagesOf(docs, label);
    assert.ok(page.content.includes('BULAN: September 2026'), `${label}: label BULAN tidak ada`);
    assert.ok(!/\b20\d{2}-\d{2}-\d{2}\b/.test(page.content), `${label}: tanggal ISO belum diformat`);
    assert.ok(!page.content.includes('Nomor kuitansi'), `${label}: nomor kuitansi harus dihilangkan`);
    assert.ok(!page.content.includes('Kegiatan:'), `${label}: baris Kegiatan harus dihilangkan`);
    assert.ok(page.content.includes('PESERTA SATU') === (kind === 'participantsAttendance'), `${label}: daftar nama tidak sesuai`);
    console.log(`PASS: ${label} hanya menampilkan BULAN tanpa nomor kuitansi/kegiatan.`);
  }
  console.log('ALL TRANSPORT/SK/ATTENDANCE TESTS PASSED');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
