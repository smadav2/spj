import type { Block } from './blocks';
import { FULL_MONTHS, dateLabel, itemsOf, money, number, romanMonth, terbilang, text, type Attachment, type SchoolProfile, type Transaction } from './domain';

const p = (value: string, bold = false, center = false, size?: number): Block => ({ type: 'text', value, bold, center, size });
const table = (headers: string[], rows: string[][], widths?: number[], size = 10): Block => ({ type: 'table', headers, rows, widths, size });
const place = (t: Transaction, school: SchoolProfile) => text(t.data, 'paymentPlace') || school.regency || school.village || '[Tempat]';
const schoolName = (school: SchoolProfile) => school.name || '[Nama sekolah]';
function documentNumber(t: Transaction, key: string, code: string) { return text(t.data, key).trim() || `B/${code}/400.3.5/${romanMonth(t.date)}/${t.year}`; }
function words(n: number) { return terbilang(n).replace(' rupiah', ''); }
function formalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '[Hari dan tanggal pemeriksaan]';
  const date = new Date(`${value}T12:00:00`);
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return `${days[date.getDay()]} tanggal ${words(date.getDate())} bulan ${FULL_MONTHS[date.getMonth()]} tahun ${words(date.getFullYear())}`;
}
function principal(school: SchoolProfile, assets: Attachment[]) { return { role: 'Kepala Sekolah', name: school.principal || '[Nama kepala sekolah]', nip: school.principalNip, image: assets.find(f => f.id === school.principalSignatureId) }; }
function items(t: Transaction) { return itemsOf(t).map((item, i) => ({ ...item, no: String(i + 1), total: item.quantity * item.price })); }
function grandTotal(t: Transaction) { return items(t).reduce((sum, item) => sum + item.total, 0); }
function itemRows(t: Transaction, withPrices: boolean) {
  return items(t).map(item => [
    item.no,
    `${item.name}${item.specification ? `\n${item.specification}` : ''}`,
    number(item.quantity),
    item.unit || '—',
    ...(withPrices ? [money(item.price), money(item.total)] : ['']),
  ]);
}
export function orderDocument(t: Transaction, school: SchoolProfile, assets: Attachment[]): Block[] {
  const provider = text(t.data, 'recipient') || '[Nama toko / penyedia]';
  const blocks: Block[] = [
    p(`Nomor : ${documentNumber(t, 'orderNumber', '007')}`, false, true),
    p('Kepada Yth:'),
    p(provider.toUpperCase(), true),
    p(text(t.data, 'providerAddress') || '[Alamat penyedia]', true),
    p(`Dengan hormat,\nUntuk memperlancar kegiatan belajar mengajar di ${schoolName(school)} Tahun Anggaran ${t.year}, maka yang bertanda tangan di bawah ini:`),
    { type: 'kv', rows: [['Nama', school.principal || '[Nama kepala sekolah]'], ['Jabatan', 'Kepala Sekolah'], ['Nama Sekolah', schoolName(school)], ['Alamat Sekolah', school.address || '[Alamat sekolah]'], ['Kab/Kota', school.regency || '[Kabupaten/Kota]']] },
    p('Bermaksud memesan barang sebagai berikut:'),
    table(['No', 'Uraian', 'Volume', 'Satuan', 'Keterangan'], itemRows(t, false), [0.07, 0.49, 0.15, 0.14, 0.15]),
    { type: 'signatures', date: `${place(t, school)}, ${dateLabel(t.date)}`, signers: [principal(school, assets)] },
  ];
  return blocks;
}
export function handoverDocument(t: Transaction, school: SchoolProfile, assets: Attachment[]): Block[] {
  const provider = text(t.data, 'handedBy') || text(t.data, 'recipient') || '[Pihak yang menyerahkan]';
  const recipientName = text(t.data, 'receivedBy') || school.principal || '[Pihak yang menerima]';
  const rows = itemRows(t, true);
  rows.push(['', 'Jumlah', '', '', '', money(grandTotal(t))]);
  return [
    p(`Nomor : ${documentNumber(t, 'handoverNumber', '008')}`, false, true),
    p(`Pada hari ini ${formalDate(t.date)}, kami yang bertanda tangan di bawah ini.`),
    { type: 'kv', rows: [['I. Pihak Pertama', ''], ['Nama', provider], ['Jabatan', text(t.data, 'providerJob') || '-'], ['Alamat', text(t.data, 'providerAddress') || '[Alamat penyedia]'], ['II. Pihak Kedua', ''], ['Nama', recipientName], ['Jabatan', 'Kepala Sekolah'], ['Alamat', school.address || '[Alamat sekolah]']] },
    p('Pihak pertama telah menyerahkan barang seperti tersebut di bawah ini kepada Pihak Kedua dengan keadaan BAIK dan CUKUP.'),
    { type: 'table', headers: ['No', 'Uraian', 'Vol', 'Satuan', 'Harga Satuan', 'Jumlah'], rows, widths: [0.07, 0.37, 0.10, 0.14, 0.16, 0.16], size: 9.5, boldLastRow: true },
    p(`Catatan kondisi serah terima: ${text(t.data, 'condition') || '[Kondisi / hasil serah terima]'}`),
    { type: 'signatures', date: `${place(t, school)}, ${dateLabel(t.date)}`, signers: [
      { role: 'Mengetahui\nKepala Sekolah', name: school.principal || '[Nama kepala sekolah]', nip: school.principalNip, image: assets.find(f => f.id === school.principalSignatureId) },
      { role: 'Bendahara', name: school.treasurer || '[Nama bendahara]', nip: school.treasurerNip, image: assets.find(f => f.id === school.treasurerSignatureId) },
    ] },
    p(`Penyedia Barang\n${text(t.data, 'recipient') || '[Nama penyedia]'}`, true, true),
  ];
}
export function inspectionDocument(t: Transaction, school: SchoolProfile, assets: Attachment[]): Block[] {
  const provider = text(t.data, 'recipient') || '[Toko / penyedia]';
  const inspector = text(t.data, 'inspectionChair') || text(t.data, 'inspectedBy') || '[Nama ketua pemeriksa]';
  const secretary = text(t.data, 'inspectionSecretary') || '[Nama sekretaris pemeriksa]';
  const members = text(t.data, 'inspectionMembers') || '[Nama anggota pemeriksa]';
  const inspectedDate = text(t.data, 'inspectionDate') || t.date;
  const decisionNumber = text(t.data, 'inspectionDecreeNumber') || '[Nomor penetapan tim pemeriksa]';
  const decisionDate = text(t.data, 'inspectionDecreeDate') || t.date;
  return [
    p(`Nomor : ${documentNumber(t, 'inspectionNumber', '009')}`, false, true),
    p(`Pada hari ini ${formalDate(inspectedDate)}, kami yang bertanda tangan di bawah ini Tim Teknis Pemeriksa Hasil Pekerjaan Pengadaan Barang/Jasa Pemerintah untuk Pengadaan Barang Jasa/Umum di ${schoolName(school)} yang dibentuk berdasarkan Keputusan Kepala Sekolah ${schoolName(school)} Nomor: ${decisionNumber} Tanggal ${dateLabel(decisionDate)} tentang Penetapan Tim Teknis Pemeriksa Hasil Pekerjaan Pengadaan Barang/Jasa Pemerintah untuk Pengadaan Barang Jasa/Umum di ${schoolName(school)} Tahun Anggaran ${t.year}, terdiri dari:`),
    p(`${inspector} : KETUA\n${secretary} : SEKRETARIS\n${members} : ANGGOTA`),
    p(`Telah memeriksa dengan teliti hasil pekerjaan belanja pemeliharaan peralatan dan jasa sekolah pada ${schoolName(school)} Tahun Anggaran ${t.year} dari Toko/CV. ${provider}, berdasarkan Surat Pesanan (SP) Nomor: ${documentNumber(t, 'orderNumber', '007')} Tanggal ${dateLabel(t.date)} yang dilaksanakan dari mulai ${dateLabel(t.date)} sampai dengan tanggal ${dateLabel(inspectedDate)}, dengan hasil sebagai berikut:`),
    table(['No', 'Nama Barang / Jasa', 'Vol', 'Satuan', 'Harga Satuan', 'Jumlah (Rp)'], itemRows(t, true), [0.07, 0.37, 0.10, 0.14, 0.16, 0.16], 9.5),
    { type: 'kv', rows: [['Kesimpulan', text(t.data, 'inspectionResult') || '[Hasil pemeriksaan teknis belum diisi]']], labelWidth: 30 },
    p('Demikian Berita Acara Pemeriksaan Teknis Hasil Pengadaan Barang/Jasa ini kami buat dengan sesungguhnya untuk dipergunakan sebagaimana mestinya.'),
    { type: 'signatures', date: '', signers: [
      { role: 'PIHAK KEDUA\nPenyedia Barang/Jasa', name: provider },
      { role: 'PEMERIKSA BARANG', name: text(t.data, 'inspectedBy') || inspector },
      { role: 'PIHAK KESATUAN\nKepala Sekolah', name: school.principal || '[Nama kepala sekolah]', nip: school.principalNip, image: assets.find(f => f.id === school.principalSignatureId) },
    ] },
  ];
}
