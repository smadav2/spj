import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { transactionDocuments } from '@/lib/document-model';
import { renderPDF, renderWord } from '@/lib/exports';
import { EMPTY_SCHOOL, documentChecks, type Attachment, type SchoolProfile, type Transaction } from '@/lib/domain';
const out = 'artifacts/layout';
const mm = (value: number) => value * 72 / 25.4;
const school: SchoolProfile = { ...EMPTY_SCHOOL, name: 'SD UJI TATA LETAK', government: 'PEMERINTAH KABUPATEN UJI', department: 'DINAS PENDIDIKAN UJI', address: 'JALAN UJI', regency: 'KABUPATEN UJI', district: 'KECAMATAN UJI', principal: 'KEPALA UJI', principalNip: '19711021 199403 2 004', treasurer: 'BENDAHARA UJI', npsn: '00000000' };
const baseDoc = { id: '00000000-0000-4000-8000-000000000001', number: 'BNU001/SDN.SIDO 2/IX/2026', date: '2026-09-29', year: 2026, amount: 200000, finalized: false, createdAt: '', updatedAt: '', files: [] as Attachment[] };
let photo = Buffer.alloc(0);
const files = (kind: string, count: number): Attachment[] => Array.from({ length: count }, (_, index) => ({ id: `10000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}-${kind}`.slice(0, 36), transactionId: baseDoc.id, kind, name: `${kind}-${index + 1}.png`, mime: 'image/png', size: photo.length, content: photo.toString('base64'), createdAt: '' }));
async function pageImages(file: string, page: number) {
  const listing = execFileSync('pdfimages', ['-list', '-f', String(page), '-l', String(page), file], { encoding: 'utf8' });
  return listing.split('\n').slice(2).filter(line => /\d/.test(line)).length;
}
async function trimmedRatio(file: string) {
  // Foto uji berwarna #6f97b8; ukur hanya area foto agar footer/teks tidak ikut terhitung.
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-r', '110', '-png', file, `${out}/shot`]);
  const { data, info } = await sharp(`${out}/shot.png`).raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * info.channels;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    if (Math.abs(r - 111) < 26 && Math.abs(g - 151) < 26 && Math.abs(b - 184) < 26) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return { contentWidthPt: 0, contentHeightPt: 0, pageHeightPt: 0 };
  const pxToPt = 72 / 110;
  return { contentWidthPt: (maxX - minX) * pxToPt, contentHeightPt: (maxY - minY) * pxToPt, pageHeightPt: info.height * pxToPt };
}
async function run() {
  await mkdir(out, { recursive: true });
  photo = await sharp({ create: { width: 900, height: 620, channels: 3, background: '#6f97b8' } }).png().toBuffer();

  // 1) SK completeness uses the fields that really exist in the form.
  const skTransaction: Transaction = { ...baseDoc, category: 'pramuka', title: 'Honor Pramuka', data: { recipient: 'TRIYUNI', participants: 'TRIYUNI', period: '2026-09', meetingDates: '2026-09-05', decreeNumber: '800/07426/2026', decreeDate: '2026-07-02', recipient2: '' } };
  const pramukaChecks = documentChecks(skTransaction, school);
  const decreeCheck = pramukaChecks.find(check => check.key === 'decree');
  assert.ok(decreeCheck, 'decree check missing');
  assert.equal(decreeCheck.ready, true, 'SK harus dianggap lengkap setelah nomor dan tanggal diisi');
  const withoutDecree = documentChecks({ ...skTransaction, data: { ...skTransaction.data, decreeNumber: '', decreeDate: '' } }, school).find(check => check.key === 'decree');
  assert.equal(withoutDecree?.ready, false, 'SK tanpa nomor/tanggal harus tetap belum lengkap');
  const tahfidzChecks = documentChecks({ ...skTransaction, category: 'tahfidz' }, school);
  assert.equal(tahfidzChecks.find(check => check.key === 'decree')?.ready, true);
  console.log('PASS: SK Pramuka & Tahfidz lengkap bila nomor + tanggal keputusan terisi (tanpa field lama decreeText).');

  // 2) Documentation gallery: 2 columns x 4 rows.
  const eight = { ...skTransaction, files: files('documentation', 8) };
  const eightPages = transactionDocuments(eight, school, [], [], 'documentation');
  assert.equal(eightPages.length, 1, 'delapan foto harus muat dalam satu halaman galeri');
  assert.equal(eightPages[0].blocks[0].type, 'gallery');
  const galleryBlock = eightPages[0].blocks[0] as { files: Attachment[]; columns: number; rows: number };
  assert.equal(galleryBlock.columns, 2); assert.equal(galleryBlock.rows, 4); assert.equal(galleryBlock.files.length, 8);
  await writeFile(`${out}/dokumentasi-8.pdf`, await renderPDF(eightPages, school, [], { orientation: 'portrait', margin: 20 }));
  const eightPdf = await PDFDocument.load(await readFile(`${out}/dokumentasi-8.pdf`));
  assert.equal(eightPdf.getPageCount(), 1);
  assert.equal(await pageImages(`${out}/dokumentasi-8.pdf`, 1), 8, 'delapan foto harus tertanam pada satu halaman');
  const ten = { ...skTransaction, files: files('documentation', 10) };
  const tenPages = transactionDocuments(ten, school, [], [], 'documentation');
  assert.equal(tenPages.length, 2, 'sepuluh foto menjadi 2 halaman (8 + 2)');
  await writeFile(`${out}/dokumentasi-10.pdf`, await renderPDF(tenPages, school, [], { orientation: 'portrait', margin: 20 }));
  assert.equal((await PDFDocument.load(await readFile(`${out}/dokumentasi-10.pdf`))).getPageCount(), 2);
  console.log('PASS: dokumentasi tersusun 2 kolom × 4 baris; 8 foto = 1 halaman, 10 foto = 2 halaman.');
  const wordBytes = await renderWord(tenPages, school, [], { orientation: 'portrait', margin: 20 });
  await writeFile(`${out}/dokumentasi-10.docx`, wordBytes);
  const zip = await JSZip.loadAsync(wordBytes); const xml = await zip.file('word/document.xml')!.async('string');
  assert.ok((xml.match(/<w:tbl>/g) || []).length >= 2, 'galeri Word memakai tabel');
  execFileSync('libreoffice', ['-env:UserInstallation=file:///tmp/spj_layout_lo', '--headless', '--convert-to', 'pdf', '--outdir', out, `${out}/dokumentasi-10.docx`], { timeout: 90000, stdio: 'pipe' });
  assert.equal((await PDFDocument.load(await readFile(`${out}/dokumentasi-10.pdf`))).getPageCount(), 2);
  console.log('PASS: Word dokumentasi juga dapat dibuka & dikonversi tanpa kehilangan halaman.');

  // 3) Nota / bukti pembayaran: sedang, tidak memenuhi halaman.
  for (const category of ['internet', 'listrik'] as const) {
    const nota = { ...baseDoc, category, title: `Pembayaran ${category}`, data: { recipient: 'PENYEDIA UJI', period: '2026-09', customerId: 'ID-UJI' }, files: files('evidence', 1) };
    const pages = transactionDocuments(nota, school, [], [], 'evidence');
    const path = `${out}/nota-${category}.pdf`;
    await writeFile(path, await renderPDF(pages, school, [], { orientation: 'portrait', margin: 20 }));
    const ratio = await trimmedRatio(path);
    assert.ok(ratio.contentWidthPt <= mm(150), `lebar nota ${category} terlalu besar: ${(ratio.contentWidthPt / 72 * 25.4).toFixed(0)}mm`);
    assert.ok(ratio.contentHeightPt <= mm(115), `tinggi nota ${category} terlalu besar: ${(ratio.contentHeightPt / 72 * 25.4).toFixed(0)}mm`);
    console.log(`PASS: foto nota ${category} sedang (${(ratio.contentWidthPt / 72 * 25.4).toFixed(0)}×${(ratio.contentHeightPt / 72 * 25.4).toFixed(0)} mm) dan tidak memenuhi halaman.`);
  }
  console.log('ALL LAYOUT TESTS PASSED');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
