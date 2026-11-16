import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { transactionDocuments } from '@/lib/document-model';
import { renderPDF, renderWord } from '@/lib/exports';
import { EMPTY_SCHOOL, type Attachment, type SchoolProfile, type Transaction } from '@/lib/domain';

const out = 'artifacts/procurement';
const school: SchoolProfile = {
  ...EMPTY_SCHOOL,
  name: 'SD NEGERI SIDOMULYO II', government: 'PEMERINTAH KABUPATEN PROBOLINGGO', department: 'DINAS PENDIDIKAN DAN KEBUDAYAAN',
  address: 'Dusun Pareng Desa Sidomulyo', district: 'Kotaanyar', regency: 'Probolinggo', postalCode: '67293',
  principal: 'SUSWATI, S.Pd', principalNip: '19711021 199403 2 004', treasurer: 'NURHAYATI, S.Pd', treasurerNip: '19850603 202321 2 030', npsn: '00000000',
};
const transaction: Transaction = {
  id: '00000000-0000-4000-8000-000000000001', number: 'BNU001/SDN.SIDO 2/IX/2026', category: 'barang', title: 'Pembelian Perlengkapan Sekolah', date: '2026-09-22', year: 2026, amount: 657000,
  data: {
    recipient: 'MEKAR', providerAddress: 'Sidomulyo', providerJob: 'Pemilik Toko', handedBy: 'MEKAR', receivedBy: 'SUSWATI, S.Pd', condition: 'Barang diterima lengkap dan baik.',
    inspectionChair: 'YASIR ZAIN', inspectionSecretary: 'SEKRETARIS UJI', inspectionMembers: 'ANGGOTA UJI', inspectedBy: 'YASIR ZAIN', inspectionDecreeNumber: '000.3.1/2026', inspectionDecreeDate: '2026-09-22', inspectionDate: '2026-09-22', inspectionResult: 'Sesuai / Baik',
  },
  finalized: false, createdAt: '', updatedAt: '', files: [] as Attachment[],
};
transaction.data.items = [
  { name: 'Seal Tape', specification: '', quantity: 2, unit: 'buah', price: 6600 },
  { name: 'Pipa PVC AW 4 m', specification: '2 inci', quantity: 1, unit: 'buah', price: 54800 },
  { name: 'Pipa uPVC S12.5', specification: 'Tekanan nominal 8 bar, 6 m', quantity: 10, unit: 'meter', price: 30000 },
];

async function verify(kind: 'order' | 'handover' | 'inspection', required: string[], forbidden: string[] = []) {
  const documents = transactionDocuments(transaction, school, [], [], kind);
  assert.equal(documents.length, 1, `${kind}: satu dokumen`);
  const pdfBytes = await renderPDF(documents, school, [], { orientation: 'portrait', margin: 20 });
  await writeFile(`${out}/${kind}.pdf`, pdfBytes);
  const text = execFileSync('pdftotext', ['-layout', `${out}/${kind}.pdf`, '-'], { encoding: 'utf8' });
  const normalized = text.replace(/\s+/g, ' ');
  for (const phrase of required) assert.ok(normalized.includes(phrase.replace(/\s+/g, ' ')), `${kind}: tidak menemukan "${phrase}"`);
  for (const phrase of forbidden) assert.ok(!normalized.includes(phrase.replace(/\s+/g, ' ')), `${kind}: masih ada "${phrase}"`);
  const wordBytes = await renderWord(documents, school, [], { orientation: 'portrait', margin: 20 });
  assert.ok(wordBytes.length > 1000);
  await writeFile(`${out}/${kind}.docx`, wordBytes);
  const pdf = await PDFDocument.load(pdfBytes);
  for (const page of pdf.getPages()) { assert.ok(Math.abs(page.getWidth() - 215 * 72 / 25.4) < .3); assert.ok(Math.abs(page.getHeight() - 330 * 72 / 25.4) < .3); }
  console.log(`PASS: ${kind} — PDF F4 dan Word editable berisi format baru.`);
}

async function main() {
  await mkdir(out, { recursive: true });
  await verify('order', ['SURAT PESANAN', 'Nomor : B/007/400.3.5/IX/2026', 'Kepada Yth:', 'MEKAR', 'Dengan hormat', 'Bermaksud memesan barang', 'Volume', 'Satuan', 'Keterangan', 'Seal Tape', 'Kepala Sekolah'], ['Nomor kuitansi:', 'Total pesanan:']);
  await verify('handover', ['BERITA ACARA SERAH TERIMA BARANG', 'Nomor : B/008/400.3.5/IX/2026', 'I. Pihak Pertama', 'II. Pihak Kedua', 'BAIK dan CUKUP', 'Harga Satuan', 'Jumlah', 'Mengetahui', 'Bendahara', 'NIP. 19711021 199403 2 004'], ['Nomor kuitansi:']);
  await verify('inspection', ['BERITA ACARA PEMERIKSAAN TEKNIS HASIL PENGADAAN BARANG/JASA', 'Nomor : B/009/400.3.5/IX/2026', 'Tim Teknis Pemeriksa', 'YASIR ZAIN : KETUA', 'SEKRETARIS UJI : SEKRETARIS', 'ANGGOTA UJI : ANGGOTA', 'Kesimpulan', 'Sesuai / Baik', 'PEMERIKSA BARANG', 'PIHAK KEDUA', 'PIHAK KESATUAN'], ['Nomor kuitansi:', 'Hasil pemeriksaan teknis belum diisi']);

  for (const category of ['pramuka', 'tahfidz'] as const) {
    const coach: Transaction = { ...transaction, category, data: { ...transaction.data, coaches: `PEMBINA ${category.toUpperCase()} UJI`, period: '2026-09', meetingDates: '2026-09-03\n2026-09-10' } };
    const docs = transactionDocuments(coach, school, [], [], 'coachAttendance');
    const pdfBytes = await renderPDF(docs, school, [], { orientation: 'portrait', margin: 20 });
    await writeFile(`${out}/coach-attendance-${category}.pdf`, pdfBytes);
    const text = execFileSync('pdftotext', ['-layout', `${out}/coach-attendance-${category}.pdf`, '-'], { encoding: 'utf8' });
    assert.ok(text.includes('Kepala Sekolah'));
    assert.ok(text.includes('SUSWATI, S.Pd'));
    assert.ok(text.includes('NIP. 19711021 199403 2 004'));
    console.log(`PASS: daftar hadir pelatih ${category} ditandatangani kepala sekolah beserta NIP.`);
  }
  console.log('ALL PROCUREMENT AND ATTENDANCE TESTS PASSED');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
