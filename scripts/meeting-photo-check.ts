import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { transactionDocuments } from '@/lib/document-model';
import { renderPDF, renderWord } from '@/lib/exports';
import { EMPTY_SCHOOL, documentChecks, type Attachment, type SchoolProfile, type Transaction } from '@/lib/domain';
const out='artifacts/meeting-photo';
async function main(){
 await mkdir(out,{recursive:true});
 const school:SchoolProfile={...EMPTY_SCHOOL,name:'SD SEKOLAH UJI',government:'PEMERINTAH KABUPATEN UJI',department:'DINAS PENDIDIKAN UJI',address:'JALAN PENDIDIKAN',regency:'KABUPATEN UJI',principal:'KEPALA SEKOLAH',treasurer:'BENDAHARA',npsn:'00000000'};
 const photo=await sharp({create:{width:1600,height:1200,channels:3,background:'#6a99c0'}}).png().toBuffer();
 const attachment=(id:string,kind:string):Attachment=>({id,transactionId:'00000000-0000-4000-8000-000000000001',kind,name:`${kind}.png`,mime:'image/png',size:photo.length,content:photo.toString('base64'),createdAt:''});
 const transaction:Transaction={id:'00000000-0000-4000-8000-000000000001',number:'BNU001/SDN.SIDO 2/IX/2026',category:'konsumsi',title:'Rapat Pengujian',date:'2026-09-29',year:2026,amount:200000,finalized:false,createdAt:'',updatedAt:'',data:{recipient:'PEMBAYAR UJI',period:'2026-09',quantity:'10',unitPrice:'20000',minutes:'TEKS UJI YANG TIDAK BOLEH TAMPIL',participants:'PESERTA UJI',activityDate:'2026-09-29',place:'TEMPAT UJI'},files:[]};
 for(const kind of ['minutes','attendance'] as const){
  const empty={...transaction,files:[]};assert.equal(documentChecks(empty,school).find(v=>v.key===kind)?.ready,false);
  const file=attachment(`10000000-0000-4000-8000-00000000000${kind==='minutes'?'1':'2'}`,kind);
  const withPhoto={...transaction,files:[file]};assert.equal(documentChecks(withPhoto,school).find(v=>v.key===kind)?.ready,true);
  const page=transactionDocuments(withPhoto,school,[],[],kind)[0];assert.equal(page.letterhead,true);assert.equal(page.blocks.length,1);assert.equal(page.blocks[0].type,'image');assert.equal(page.blocks[0].size,'large');
  const buffer=await renderPDF([page],school,[],{orientation:'portrait',margin:20});const path=`${out}/${kind}.pdf`;await writeFile(path,buffer);const pdf=await PDFDocument.load(buffer);assert.equal(pdf.getPageCount(),1);
  const extracted=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});
  assert.ok(extracted.includes('SD SEKOLAH UJI'));assert.ok(extracted.includes(kind==='minutes'?'NOTULEN RAPAT':'DAFTAR HADIR RAPAT'));
  for(const metadata of ['Nomor kuitansi:', 'Kegiatan:', 'Hari / tanggal:', 'Tempat:','TEKS UJI YANG TIDAK BOLEH TAMPIL'])assert.ok(!extracted.includes(metadata),`${kind}: metadata ${metadata} tidak boleh dicetak`);
  const word=await renderWord([page],school,[],{orientation:'portrait',margin:20});await writeFile(`${out}/${kind}.docx`,word);assert.ok(word.length>1000);
  console.log(`PASS: ${kind} hanya foto besar + kop + judul; metadata otomatis tidak ikut dicetak.`);
 }
 console.log('ALL MEETING PHOTO TESTS PASSED');
}
main().catch(error=>{console.error(error);process.exitCode=1});
