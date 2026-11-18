import { drawReceiptPDF, receiptWordParagraphs } from './receipt-renderers';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, ImageRun, Packer, PageNumber, PageOrientation, Paragraph, SectionType, Table, TableCell, TableRow, TextRun, VerticalAlignTable, WidthType } from 'docx';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import type { Block, DocumentPage } from './document-model';
import { CATEGORIES, FULL_MONTHS, STATUS_LABELS, categoryOf, letterheadLines, transactionStatus, type Attachment, type SchoolProfile, type Transaction } from './domain';
export interface PrintOptions { orientation: 'portrait' | 'landscape'; margin: number; origin?: string }
const mm = (n: number) => n * 72 / 25.4;
const twips = (n: number) => Math.round(n * 1440 / 25.4);
const content = (f: Attachment) => Buffer.from(f.content || '', 'base64');
function widthsOf(count: number, widths?: number[]) { const usable = widths?.length === count ? widths : Array(count).fill(1 / count) as number[]; const total = usable.reduce((a, b) => a + b, 0); return usable.map(v => v / total); }
const safePdfText = (value: string) => value.replace(/→/g, '->').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\t\n\r\x20-\x7E\xA0-\xFF–—•…]/g, ' ');
function wrap(value: string, font: PDFFont, size: number, width: number) {
  const result: string[] = [];
  for (const paragraph of safePdfText(value).replace(/\r/g, '').replace(/\t/g, '    ').split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) { result.push(line); line = ''; }
      for (const char of word) { if (font.widthOfTextAtSize(line + char, size) > width && line) { result.push(line); line = ''; } line += char; }
    }
    result.push(line);
  }
  return result;
}
export async function renderPDF(documents: DocumentPage[], school: SchoolProfile, assets: Attachment[], options: PrintOptions) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Dokumen SPJ BOSP'); pdf.setCreator('Aplikasi Administrasi & Cetak SPJ BOSP Sekolah');
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const galleryQueue: Promise<unknown>[] = [];
  const margin = mm(options.margin);
  let w = options.orientation === 'landscape' ? mm(330) : mm(215);
  let h = options.orientation === 'landscape' ? mm(215) : mm(330);
  let usable = w - margin * 2;
  let page: PDFPage; let y = h - margin;
  const newPage = (pageOrientation?: 'portrait' | 'landscape') => {
    const orient = pageOrientation || (w > h ? 'landscape' : 'portrait');
    [w, h] = orient === 'landscape' ? [mm(330), mm(215)] : [mm(215), mm(330)];
    usable = w - margin * 2;
    page = pdf.addPage([w, h]); y = h - margin;
  };
  const ensure = (height: number) => { if (y - height < margin + 12) newPage(); };
  // Dukungan **tebal** di tengah kalimat agar penebalan sama dengan naskah dinas.
  const richTokens = (value: string) => {
    const tokens: { text: string; isBold: boolean; space: boolean }[] = [];
    for (const paragraph of value.split('\n')) {
      const parts = paragraph.split('**');
      parts.forEach((part, index) => part.split(' ').forEach((word, wordIndex) => {
        if (wordIndex > 0) { const last = tokens[tokens.length - 1]; if (last) last.space = true; }
        if (word !== '') tokens.push({ text: word, isBold: index % 2 === 1, space: false });
      }));
      if (paragraph !== value.split('\n').slice(-1)[0]) tokens.push({ text: '', isBold: false, space: false, break: true } as never);
    }
    return tokens;
  };
  const tokenWidth = (token: { text: string; isBold: boolean; space: boolean }, size: number) => {
    const font = token.isBold ? bold : regular;
    return font.widthOfTextAtSize(token.text, size) + (token.space ? font.widthOfTextAtSize(' ', size) : 0);
  };
  const wrapRich = (value: string, size: number, width: number, forceBold = false) => {
    const rows: { text: string; isBold: boolean }[][] = [];
    for (const paragraph of value.split('\n')) {
      let current: { text: string; isBold: boolean }[] = []; let currentWidth = 0;
      const parts = paragraph.split('**');
      const words: { text: string; isBold: boolean; space: boolean }[] = [];
      parts.forEach((part, index) => {
        const pieces = part.split(' ');
        pieces.forEach((word, wordIndex) => {
          if (wordIndex > 0) { const last = words[words.length - 1]; if (last) last.space = true; }
          if (word.trim() !== '' || (wordIndex > 0 && wordIndex < pieces.length - 1)) words.push({ text: word, isBold: forceBold || index % 2 === 1, space: wordIndex > 0 });
        });
      });
      for (const word of words) {
        const token = { text: word.text, isBold: word.isBold, space: current.length > 0 && word.space };
        const w = tokenWidth(token, size);
        if (current.length && currentWidth + w > width) { rows.push(current); current = []; currentWidth = 0; }
        const withSpace = { text: (current.length && word.space ? ' ' : '') + word.text, isBold: token.isBold };
        const last = current[current.length - 1];
        if (last && last.isBold === withSpace.isBold) last.text += withSpace.text; else current.push(withSpace);
        currentWidth += w;
      }
      rows.push(current.length ? current : [{ text: '', isBold: false }]);
    }
    return rows;
  };
  const write = (value: string, size = 12, isBold = false, center = false) => {
    const step = size * (size < 12 ? 1.33 : 1.45);
    const plainLines = wrap(value, isBold && !value.includes('**') ? bold : regular, size, usable);
    const lineRows = value.includes('**') ? wrapRich(value, size, usable, isBold) : plainLines.map(line => [{ text: line, isBold }]);
    for (const runs of lineRows) {
      ensure(step);
      const totalWidth = runs.reduce((sum, r) => sum + (r.isBold ? bold : regular).widthOfTextAtSize(r.text, size), 0);
      let x = center ? (w - totalWidth) / 2 : margin;
      for (const run of runs) { const font = run.isBold ? bold : regular; page.drawText(run.text, { x, y: y - size, size, font }); x += font.widthOfTextAtSize(run.text, size); }
      y -= step;
    }
    y -= size < 12 ? 3 : 8;
  };
  const imageEmbed = async (f: Attachment) => f.mime === 'image/png' ? pdf.embedPng(content(f)) : pdf.embedJpg(content(f));
  const drawTable = (block: Extract<Block, { type: 'table' }>) => {
    if (!block.rows.length && !block.headers.length) return;
    const count = block.headers.length || block.rows[0].length;
    const colWidths = widthsOf(count, block.widths).map(v => v * usable);
    const fontSize = block.size || 12, lineH = fontSize * 1.35, padX = fontSize > 10.5 ? 6 : 4;
    const drawRow = (cells: string[], isHeader: boolean) => {
      const font = isHeader ? bold : regular;
      const cellLines = cells.map((value, i) => wrap(value || '', font, fontSize, Math.max(8, colWidths[i] - padX * 2)));
      const totalLines = Math.max(1, ...cellLines.map(c => c.length));
      let start = 0;
      while (start < totalLines) {
        let availableLines = Math.floor((y - margin - 24) / lineH);
        if (availableLines < 2) { newPage(); if (!isHeader && block.headers.length) drawRow(block.headers, true); availableLines = Math.floor((y - margin - 24) / 16); }
        if (totalLines - start <= Math.floor((h - 2 * margin - 60) / lineH) && totalLines - start > availableLines) { newPage(); if (!isHeader && block.headers.length) drawRow(block.headers, true); availableLines = Math.floor((y - margin - 24) / 16); }
        const take = Math.min(totalLines - start, Math.max(1, availableLines));
        const rowHeight = Math.max(fontSize > 10.5 ? fontSize + 16 : fontSize + 9, take * lineH + (fontSize > 10.5 ? fontSize : 6));
        let x = margin;
        for (let i = 0; i < count; i++) {
          page.drawRectangle({ x, y: y - rowHeight, width: colWidths[i], height: rowHeight, borderColor: rgb(0.25, 0.25, 0.25), borderWidth: 0.5, ...(isHeader ? { color: rgb(0.95, 0.95, 0.95) } : {}) });
          cellLines[i]?.slice(start, start + take).forEach((row, n) => page.drawText(row, { x: x + padX, y: y - fontSize - 4 - n * lineH, size: fontSize, font }));
          x += colWidths[i];
        }
        y -= rowHeight; start += take;
      }
    };
    if (block.headers.length) { ensure(64); drawRow(block.headers, true); }
    for (const row of block.rows) drawRow(row, false);
    y -= 16;
  };
  for (const document of documents) {
    newPage(document.orientation || options.orientation);
    if (document.receipt) {
      const receiptHeight = await drawReceiptPDF(pdf, page!, document.receipt, school, assets, margin, y, usable, regular, bold);
      y -= receiptHeight + 18;
    }
    if (document.letterhead) {
      const leftLogo = assets.find(f => f.id === school.logoId);
      const rightLogo = assets.find(f => f.id === school.rightLogoId);
      const head = letterheadLines(school);
      const logoSize = mm(21), gap = mm(5);
      const topY = y;
      const centerX = margin + (leftLogo ? logoSize + gap : 0);
      const centerW = usable - (leftLogo ? logoSize + gap : 0) - (rightLogo ? logoSize + gap : 0);
      if (leftLogo) { const image = await imageEmbed(leftLogo); const dim = image.scaleToFit(logoSize, logoSize); page!.drawImage(image, { x: margin + (logoSize - dim.width) / 2, y: topY - logoSize + (logoSize - dim.height) / 2, ...dim }); }
      if (rightLogo) { const image = await imageEmbed(rightLogo); const dim = image.scaleToFit(logoSize, logoSize); page!.drawImage(image, { x: w - margin - logoSize + (logoSize - dim.width) / 2, y: topY - logoSize + (logoSize - dim.height) / 2, ...dim }); }
      let hy = topY;
      const headLine = (value: string, size: number, isBold = false, underline = false) => { if (!value) return; const font = isBold ? bold : regular; for (const row of wrap(value, font, size, centerW)) { const x = centerX + (centerW - font.widthOfTextAtSize(row, size)) / 2; page!.drawText(row, { x, y: hy - size, size, font }); if (underline) page!.drawLine({ start: { x, y: hy - size - 1.5 }, end: { x: x + font.widthOfTextAtSize(row, size), y: hy - size - 1.5 }, thickness: .6 }); hy -= size * 1.25; } };
      headLine(head.government, 12);
      headLine(head.department, 15);
      headLine(head.school || '—', 17, true);
      if (school.letterhead) headLine(school.letterhead, 11, true);
      headLine(head.address, 10.5);
      headLine(head.contacts, 10, false, true);
      if (!head.contacts && head.npsn) headLine(head.npsn, 9.5);
      y = Math.min(hy, topY - logoSize) - 7;
      page!.drawLine({ start: { x: margin, y }, end: { x: w - margin, y }, thickness: .8 });
      page!.drawLine({ start: { x: margin, y: y - 2.2 }, end: { x: w - margin, y: y - 2.2 }, thickness: 2.1 });
      y -= 20;
    }
    if (!document.receipt && document.showTitle !== false) { write(document.title, 14, true, true); y -= 8; }
    for (const block of document.blocks) {
      if (block.type === 'text') { if (block.value.trim() === 'MEMUTUSKAN' && y - mm(62) < margin) newPage(); write(block.value, block.size || 12, block.bold, block.center); }
      if (block.type === 'table') drawTable(block);
      if (block.type === 'kv') {
        const kvSize = block.size || 12, kvStep = kvSize * 1.28;
        const labelW = mm(block.labelWidth ?? 34), valueX = margin + labelW + mm(2), valueW = usable - labelW - mm(2) - (block.right ? mm(62) : 0);
        block.rows.forEach(([label, value], _index) => {
          const rows = wrapRich(value || '', kvSize, valueW);
          ensure(rows.length * (kvStep + 2) + 8);
          const base = y;
          wrap(label, regular, kvSize, labelW - mm(2)).forEach((row, i) => page!.drawText(row, { x: margin, y: base - kvSize - i * kvStep, size: kvSize, font: regular }));
          page!.drawText(':', { x: margin + labelW - mm(1), y: base - kvSize, size: kvSize, font: regular });
          rows.forEach((richRuns, i) => { let rx = valueX; for (const run of richRuns) { const font = run.isBold ? bold : regular; page!.drawText(run.text, { x: rx, y: base - kvSize - i * kvStep, size: kvSize, font }); rx += font.widthOfTextAtSize(run.text, kvSize); } });
          y = base - Math.max(kvStep + 1, rows.length * kvStep) - 1;
        });
        y -= 6;
      }
      if (block.type === 'diktum') {
        const labelW = mm(30), gap = mm(2), valueX = margin + labelW + gap, valueW = usable - labelW - gap;
        for (const row of block.rows) {
          const wrapped: { text: string; indent: number }[] = [];
          for (const paragraph of (row.value || '').split('\n')) wrap(paragraph, regular, 12, valueW - mm(7)).forEach((line, i) => wrapped.push({ text: line, indent: i ? mm(7) : 0 }));
          if (!wrapped.length) wrapped.push({ text: '-', indent: 0 });
          ensure(wrapped.length * 15 + 12);
          const base = y;
          wrap(row.label, regular, 12, labelW - mm(3)).forEach((line, i) => page!.drawText(line, { x: margin, y: base - 12 - i * 16, size: 12, font: regular }));
          page!.drawText(':', { x: margin + labelW - mm(1), y: base - 12, size: 12, font: regular });
          wrapped.forEach((line, i) => page!.drawText(line.text, { x: valueX + line.indent, y: base - 12 - i * 15, size: 12, font: regular }));
          y = base - wrapped.length * 15 - 8;
        }
        y -= 4;
      }
      if (block.type === 'tembusan') {
        ensure(24 + block.items.length * 13); y -= 4;
        write('Tembusan:', 11, false);
        block.items.forEach((item, i) => write(`${i + 1}. ${item}`, 10));
      }
      if (block.type === 'decree-sign') {
        const width = usable * .52, x0 = margin + usable - width, center = x0 + width / 2;
        const followUp = Math.max(0, documents.indexOf(document)); void followUp;
        ensure(146);
        page!.drawText(block.placeLine, { x: x0, y: y - 12, size: 12, font: regular }); y -= 17;
        page!.drawText(block.dateLine, { x: x0, y: y - 12, size: 12, font: regular }); y -= 16;
        const centered = (value: string, size = 12, isBold = false, underline = false) => { const font = isBold ? bold : regular; const x = center - font.widthOfTextAtSize(value, size) / 2; page!.drawText(value, { x, y: y - size, size, font }); if (underline) page!.drawLine({ start: { x, y: y - size - 1.7 }, end: { x: x + font.widthOfTextAtSize(value, size), y: y - size - 1.7 }, thickness: .7 }); y -= size * 1.3; };
        centered(block.role, 12);
        centered(block.schoolLine, 12);
        if (block.image) { const image = await imageEmbed(block.image); const dim = image.scaleToFit(width * .42, 40); page!.drawImage(image, { x: center - dim.width / 2, y: y - dim.height, ...dim }); y -= dim.height + 2; }
        else y -= 42;
        centered(block.name, 12, true, true);
        if (block.nip) centered(`NIP. ${block.nip}`, 11);
      }
      if (block.type === 'payroll') {
        const count = block.headers.length || block.totalRow.length;
        const cols = widthsOf(count, block.widths).map(v => v * usable);
        const fontSize = 11, lineH = fontSize * 1.35, padX = 5;
        const drawLineRow = (cells: string[], fill: 'header' | 'total' | 'body') => {
          const font = fill === 'body' ? regular : bold;
          const isUnderlined = (i: number) => fill === 'body' && Boolean(block.underlineCols?.includes(i));
          const cellText = cells.map((value, i) => {
            const textWidth = Math.max(8, cols[i] - padX * 2);
            return wrap(value || '', isUnderlined(i) ? regular : font, fontSize, textWidth);
          });
          const lines = Math.max(1, ...cellText.map(c => c.length));
          const height = Math.max(26, lines * lineH + 10);
          ensure(height);
          let x = margin;
          for (let i = 0; i < count; i++) {
            const fillColor = fill === 'header' ? rgb(0.85, 0.85, 0.85) : fill === 'total' ? rgb(0.72, 0.83, 0.94) : undefined;
            page.drawRectangle({ x, y: y - height, width: cols[i], height, borderColor: rgb(.2, .2, .2), borderWidth: .7, ...(fillColor ? { color: fillColor } : {}) });
            cellText[i].forEach((line, n) => {
              const fontUsed = isUnderlined(i) ? regular : font;
              const offset = n === 0 ? (height - fontSize) / 2 : (height - fontSize) / 2 + (n * lineH) - (lines - 1) * lineH / 2;
              const textWidth = fontUsed.widthOfTextAtSize(line, fontSize);
              const centered = fill !== 'body';
              const tx = centered ? x + (cols[i] - textWidth) / 2 : x + padX;
              page.drawText(line, { x: tx, y: y - height + offset, size: fontSize, font: fontUsed });
              if (isUnderlined(i)) page.drawLine({ start: { x: tx, y: y - height + offset - 2 }, end: { x: tx + textWidth, y: y - height + offset - 2 }, thickness: .6, color: rgb(.15, .15, .15) });
            });
            x += cols[i];
          }
          y -= height;
        };
        ensure(120);
        drawLineRow(block.headers, 'header');
        block.rows.forEach(cells => drawLineRow(cells, 'body'));
        drawLineRow(block.totalRow, 'total');
        y -= 18;
      }
      if (block.type === 'signatures') {
        const blockWidth = usable * (block.widthFraction || 1);
        const blockLeft = margin + usable - blockWidth;
        const cellWidth = blockWidth / block.signers.length;
        const nameLines = block.signers.map(s => wrap(s.name, bold, 12, cellWidth - 16));
        const maxNames = Math.max(...nameLines.map(n => n.length));
        const compact = w > h || !block.date;
        const nameYOffset = compact ? 68 : 100;
        const required = (compact ? 92 : 142) + maxNames * 12;
        ensure(required);
        if (y - required < margin + 4) newPage(document.orientation || options.orientation);
        if (block.date) { const dateRows = wrap(block.date, regular, 12, blockWidth); for (const row of dateRows) { page!.drawText(row, { x: w - margin - regular.widthOfTextAtSize(row, 12), y: y - 12, size: 12, font: regular }); y -= 16; } }
        y -= compact ? 4 : 10;
        for (let i = 0; i < block.signers.length; i++) {
          const signer = block.signers[i]; const center = blockLeft + cellWidth * (i + 0.5);
          wrap(signer.role, regular, 12, cellWidth - 14).forEach((row, n) => page!.drawText(row, { x: center - regular.widthOfTextAtSize(row, 12) / 2, y: y - 12 - n * 15, size: 12, font: regular }));
          if (signer.image) { const image = await imageEmbed(signer.image); const dim = image.scaleToFit(cellWidth - 35, compact ? 34 : 48); page!.drawImage(image, { x: center - dim.width / 2, y: y - (compact ? 62 : 92), ...dim }); }
          nameLines[i].forEach((row, n) => page!.drawText(row, { x: center - bold.widthOfTextAtSize(row, 12) / 2, y: y - nameYOffset - n * 15, size: 12, font: bold }));
          if (signer.nip) { const nip = `NIP. ${signer.nip}`; page!.drawText(nip, { x: center - regular.widthOfTextAtSize(nip, 10) / 2, y: y - (nameYOffset + 4) - nameLines[i].length * 15, size: 10, font: regular }); }
        }
        y -= required;
      }
      if (block.type === 'gallery') {
        const columns = Math.max(1, Math.min(3, block.columns || 2)), rows = Math.max(1, Math.min(4, block.rows || 4));
        const gap = mm(4), footer = mm(12);
        const cellW = (usable - gap * (columns - 1)) / columns;
        const cellH = Math.min((y - margin - footer - gap * (rows - 1)) / rows, mm(76));
        block.files.forEach((file, index) => {
          const column = index % columns, row = Math.floor(index / columns);
          if (row > 0 && row % rows === 0) newPage();
          const rowInPage = row % rows;
          const left = margin + column * (cellW + gap);
          const top = y - rowInPage * (cellH + gap);
          page!.drawRectangle({ x: left, y: top - cellH, width: cellW, height: cellH, borderColor: rgb(.85, .87, .89), borderWidth: .5 });
          if (!file.content) return;
          galleryQueue.push(imageEmbed(file).then(embedded => {
            const dim = embedded.scaleToFit(cellW - mm(2), cellH - mm(2));
            page!.drawImage(embedded, { x: left + (cellW - dim.width) / 2, y: top - cellH + (cellH - dim.height) / 2, ...dim });
          }).catch(() => undefined));
        });
        y -= Math.min(rows, Math.max(1, Math.ceil(block.files.length / columns))) * (cellH + gap);
        if (!block.files.length) write('Belum ada foto dokumentasi.', 11);
      }
      if (block.type === 'image' && block.file.content) {
        if (block.file.mime === 'application/pdf') {
          const source = await PDFDocument.load(content(block.file));
          for (let i = 0; i < source.getPageCount(); i++) {
            if (i > 0) newPage();
            const embedded = await pdf.embedPage(source.getPages()[i]);
            const scale = Math.min(usable / embedded.width, (y - margin - 15) / embedded.height);
            const width = embedded.width * scale, height = embedded.height * scale;
            page!.drawPage(embedded, { x: (w - width) / 2, y: y - height, width, height });
            y -= height + 12;
          }
        } else {
          const medium = block.size === 'medium';
          const large = block.size === 'large';
          const maxW = medium ? usable * .62 : large ? usable * .93 : usable;
          const maxH = medium ? Math.min(mm(105), Math.max(mm(35), y - margin - 15)) : large ? Math.max(mm(30), Math.min(mm(185), y - margin - 15)) : y - margin - 15;
          if (medium) ensure(maxH);
          const embedded = await imageEmbed(block.file); const dim = embedded.scaleToFit(maxW, maxH);
          const x = (w - dim.width) / 2;
          page!.drawRectangle({ x: x - 3, y: y - dim.height - 3, width: dim.width + 6, height: dim.height + 6, borderColor: rgb(.82, .85, .87), borderWidth: .5 });
          page!.drawImage(embedded, { x, y: y - dim.height, ...dim }); y -= dim.height + 12;
        }
      }
    }
  }
  await Promise.all(galleryQueue);
  pdf.getPages().forEach((p, i) => { const label = `Halaman ${i + 1} dari ${pdf.getPageCount()}`; p.drawText(label, { x: (p.getWidth() - regular.widthOfTextAtSize(label, 10)) / 2, y: Math.max(12, margin / 2), size: 10, font: regular }); });
  return pdf.save();
}
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
export async function renderWord(documents: DocumentPage[], school: SchoolProfile, assets: Attachment[], options: PrintOptions) {
  const margin = twips(options.margin);
  const para = (text: string, bold = false, center = false) => new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 160, line: 280 }, children: text.split('\n').flatMap((line, i) => [new TextRun({ text: line, bold, ...(i > 0 ? { break: 1 } : {}) })]) });
  const imageRun = async (file: Attachment, maxWidth = 550, maxHeight = 820) => { const data = content(file); const meta = await sharp(data).metadata(); const scale = Math.min(maxWidth / (meta.width || maxWidth), maxHeight / (meta.height || maxHeight), 1); return new ImageRun({ data, type: file.mime === 'image/png' ? 'png' : 'jpg', transformation: { width: Math.round((meta.width || maxWidth) * scale), height: Math.round((meta.height || maxHeight) * scale) } }); };
  const richRuns = (value: string, size: number, forceBold = false, underline = false) => value.split('\n').flatMap((line, lineIndex) => line.split('**').map((chunk, i) => new TextRun({ text: chunk.split(/ /).join(' '), bold: forceBold || i % 2 === 1, size, ...(underline ? { underline: {} } : {}), ...(lineIndex > 0 && i === 0 ? { break: 1 } : {}) })).filter(run => (run as unknown as { options?: { text?: string } }) !== undefined));
  const sections = [];
  for (const page of documents) {
    const landscape = (page.orientation || options.orientation) === 'landscape';
    const width = twips(landscape ? 330 : 215), height = twips(landscape ? 215 : 330), available = width - margin * 2;
    const children: (Paragraph | Table)[] = [];
    if (page.receipt) children.push(...await receiptWordParagraphs(page.receipt, school, assets, options.margin, available / 1440 * 25.4));
    if (page.letterhead) {
      const head = letterheadLines(school);
      const leftLogo = assets.find(f => f.id === school.logoId);
      const rightLogo = assets.find(f => f.id === school.rightLogoId);
      const headCell = (children: Paragraph[] = [], fraction = .15) => new TableCell({ borders, verticalAlign: VerticalAlignTable.CENTER, width: { size: Math.floor(available * fraction), type: WidthType.DXA }, children });
      const headPara = (value: string, size: number, bold = false, underline = false) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20, line: 240 }, children: [new TextRun({ text: value, size, bold, ...(underline ? { underline: {} } : {}) })] });
      const center: Paragraph[] = [];
      if (head.government) center.push(headPara(head.government, 24));
      if (head.department) center.push(headPara(head.department, 30));
      center.push(headPara(head.school || '—', 34, true));
      if (school.letterhead) center.push(headPara(school.letterhead, 22, true));
      if (head.address) center.push(headPara(head.address, 21));
      if (head.contacts) center.push(headPara(head.contacts, 20, false, true));
      if (!head.contacts && head.npsn) center.push(headPara(head.npsn, 19));
      children.push(new Table({ width: { size: available, type: WidthType.DXA }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder }, rows: [new TableRow({ children: [headCell(leftLogo ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [await imageRun(leftLogo, 54, 54)] })] : []), headCell(center, .7), headCell(rightLogo ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [await imageRun(rightLogo, 54, 54)] })] : [])] })] }));
      children.push(new Paragraph({ border: { bottom: { color: '000000', size: 18, style: BorderStyle.DOUBLE, space: 1 } }, spacing: { after: 240 }, children: [new TextRun({ text: '', size: 2 })] }));
    }
    if (!page.receipt && page.showTitle !== false) children.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 200, after: 300 }, children: [new TextRun({ text: page.title, bold: true, size: 28 })] }));
    for (const block of page.blocks) {
      if (block.type === 'text') children.push(new Paragraph({ alignment: block.center ? AlignmentType.CENTER : AlignmentType.LEFT, keepNext: block.value.trim() === 'MEMUTUSKAN', spacing: { after: 160, line: 280 }, children: block.value.split('\n').flatMap((line, lineIndex) => line.split('**').map((chunk, i) => new TextRun({ text: chunk, bold: Boolean(block.bold) || i % 2 === 1, ...(block.size ? { size: Math.round(block.size * 2) } : {}), ...(lineIndex > 0 && i === 0 ? { break: 1 } : {}) }))) }));
      if (block.type === 'table' && (block.rows.length || block.headers.length)) {
        const count = block.headers.length || block.rows[0].length;
        const colWidths = widthsOf(count, block.widths).map(v => Math.floor(v * available)); colWidths[colWidths.length - 1] += available - colWidths.reduce((s, v) => s + v, 0);
        const rows = [...(block.headers.length ? [block.headers] : []), ...block.rows];
        const tableSize = Math.round((block.size || 12) * 2), cellPad = (block.size || 12) > 10.5 ? 110 : 70;
        const cellPara = (value: string, bold: boolean) => new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 30, line: Math.round((block.size || 12) * 1.3 * 20) }, children: value.split('\n').flatMap((line, index) => [new TextRun({ text: line, bold, size: tableSize, ...(index > 0 ? { break: 1 } : {}) })]) });
        children.push(new Table({ width: { size: available, type: WidthType.DXA }, columnWidths: colWidths, rows: rows.map((row, i) => { const header = block.headers.length > 0 && i === 0; const totalRow = Boolean(block.boldLastRow) && i === rows.length - 1; return new TableRow({ tableHeader: header, cantSplit: row.every(cell => cell.length < 600), children: row.map((cell, c) => new TableCell({ width: { size: colWidths[c], type: WidthType.DXA }, margins: { top: cellPad, bottom: cellPad, left: 80, right: 80 }, children: [cellPara(cell, header || totalRow)] })) }); }) }));
        children.push(para(''));
      }
      if (block.type === 'kv' || block.type === 'diktum') {
        const labelRatio = block.type === 'kv' ? .3 : .22;
        const rows: [string, string][] = block.type === 'kv' ? block.rows : block.rows.map(row => [row.label, row.value]);
        const labelWidth = Math.floor(available * labelRatio), valueWidth = available - labelWidth;
        const cell = (size: number, children: Paragraph[], right = false) => new TableCell({ borders, width: { size, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: right ? 40 : 0, right: 60 }, children });
        const tableRows = rows.map(([label, value], index) => new TableRow({ cantSplit: false, children: [cell(labelWidth, [new Paragraph({ children: [new TextRun(label)] })]), cell(valueWidth, value.split('\n').map(line => new Paragraph({ spacing: { after: 20, line: 250 }, children: [new TextRun(line)] }))), ...(block.type === 'kv' && index === 0 && block.right ? [cell(Math.floor(available * .28), [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(block.right)] })], true)] : [])] }));
        const widths = block.type === 'kv' && block.right ? [Math.floor(available * .27), Math.floor(available * .45), Math.floor(available * .28)] : [labelWidth, valueWidth];
        children.push(new Table({ width: { size: available, type: WidthType.DXA }, columnWidths: widths, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder }, rows: tableRows }));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      }
      if (block.type === 'decree-sign') {
        children.push(new Paragraph({ alignment: AlignmentType.LEFT, indent: { left: Math.floor(available * .45) }, children: [new TextRun(block.placeLine)] }));
        children.push(new Paragraph({ alignment: AlignmentType.LEFT, indent: { left: Math.floor(available * .45) }, spacing: { after: 240 }, children: [new TextRun(block.dateLine)] }));
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(block.role)] }));
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(block.schoolLine)] }));
        if (block.image) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [await imageRun(block.image, 110, 60)] }));
        else children.push(new Paragraph({ spacing: { before: 900 }, children: [] }));
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: block.name, bold: true, underline: {} })] }));
        if (block.nip) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`NIP. ${block.nip}`)] }));
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
      }
      if (block.type === 'tembusan') {
        children.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: 'Tembusan:', size: 22 })] }));
        block.items.forEach((item, i) => children.push(new Paragraph({ spacing: { after: 20 }, indent: { left: 260 }, children: [new TextRun({ text: `${i + 1}. ${item}`, size: 20 })] })));
      }
      if (block.type === 'payroll') {
        const count = block.headers.length || block.totalRow.length;
        const cols = widthsOf(count, block.widths).map(v => Math.floor(v * available)); cols[cols.length - 1] += available - cols.reduce((a, b) => a + b, 0);
        const cellOf = (value: string, index: number, fill?: string, forceBold = false) => new TableCell({ width: { size: cols[index], type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, ...(fill ? { shading: { fill } } : {}), children: [new Paragraph({ alignment: fill ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 0, line: 240 }, children: value.split('\n').map((line, i) => new TextRun({ text: line, size: 20, bold: forceBold || Boolean(fill), ...(block.underlineCols?.includes(index) && !fill ? { underline: {} } : {}), ...(i > 0 ? { break: 1 } : {}) })) })] });
        const rows = [new TableRow({ tableHeader: true, children: block.headers.map((cell, i) => cellOf(cell, i, 'D9D9D9', true)) }), ...block.rows.map(cells => new TableRow({ cantSplit: true, children: cells.map((cell, i) => cellOf(cell, i)) })), new TableRow({ cantSplit: true, children: block.totalRow.map((cell, i) => cellOf(cell, i, 'BDD7EE', true)) })];
        children.push(new Table({ width: { size: available, type: WidthType.DXA }, columnWidths: cols, rows }));
        children.push(para(''));
      }
      if (block.type === 'signatures') {
        if (block.date) children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 260, after: 200 }, keepNext: true, children: [new TextRun(block.date)] }));
        const fraction = block.widthFraction || 1;
        const blockWidth = Math.floor(available * fraction);
        const indent = available - blockWidth;
        const cells = [];
        for (const signer of block.signers) {
          const contentChildren = [para(signer.role, false, true)];
          if (signer.image) contentChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 100 }, children: [await imageRun(signer.image, 110, 65)] }));
          else contentChildren.push(new Paragraph({ spacing: { before: 900 }, children: [] }));
          contentChildren.push(para(signer.name, true, true));
          if (signer.nip) contentChildren.push(para(`NIP. ${signer.nip}`, false, true));
          cells.push(new TableCell({ borders, width: { size: Math.floor(blockWidth / block.signers.length), type: WidthType.DXA }, children: contentChildren }));
        }
        children.push(new Table({ width: { size: blockWidth, type: WidthType.DXA }, indent: { size: indent, type: WidthType.DXA }, borders: { ...borders, insideHorizontal: noBorder, insideVertical: noBorder }, rows: [new TableRow({ cantSplit: true, children: cells })] }));
      }
      if (block.type === 'gallery') {
        const columns = Math.max(1, Math.min(3, block.columns || 2));
        if (!block.files.length) children.push(para('Belum ada foto dokumentasi.'));
        for (let start = 0; start < block.files.length; start += columns) {
          const slice = block.files.slice(start, start + columns);
          const cellWidth = Math.floor(available / columns);
          const cellWidthPx = Math.max(80, (cellWidth / 1440) * 96 - 14);
          const cells = [];
          for (const file of slice) cells.push(new TableCell({ borders, width: { size: cellWidth, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 60, right: 60 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [await imageRun(file, cellWidthPx, cellWidthPx * .78)] })] }));
          while (cells.length < columns) cells.push(new TableCell({ borders, width: { size: cellWidth, type: WidthType.DXA }, children: [para('')] }));
          children.push(new Table({ width: { size: available, type: WidthType.DXA }, columnWidths: Array(columns).fill(cellWidth), borders: { ...borders, insideHorizontal: noBorder, insideVertical: noBorder }, rows: [new TableRow({ cantSplit: true, children: cells })] }));
        }
        children.push(para(''));
      }
      if (block.type === 'image' && block.file.content) {
        if (block.file.mime === 'application/pdf') {
          children.push(para('Lampiran PDF asli disertakan dalam paket PDF. Buka tautan berikut untuk mengunduh berkas aslinya.'));
          children.push(new Paragraph({ children: [new ExternalHyperlink({ link: `${options.origin || ''}/api/spj?route=files/${block.file.id}`, children: [new TextRun({ text: block.file.name, style: 'Hyperlink' })] })] }));
        } else {
          const medium = block.size === 'medium';
          const large = block.size === 'large';
          const maxWidthPx = (available / 1440) * 96 * (medium ? .62 : large ? .93 : 1);
          const maxHeightPx = medium ? 400 : large ? 660 : ((height - margin * 2) / 1440) * 96 - 150;
          children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [await imageRun(block.file, maxWidthPx, maxHeightPx)] }));
        }
      }
    }
    sections.push({ properties: { type: SectionType.NEXT_PAGE, page: { size: { width: twips(215), height: twips(330), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: margin, bottom: margin, left: margin, right: margin, footer: twips(8) } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Halaman ', PageNumber.CURRENT, ' dari ', PageNumber.TOTAL_PAGES], size: 20 })] })] }) }, children });
  }
  const document = new Document({ creator: 'SPJ BOSP Sekolah', title: 'Dokumen SPJ BOSP', styles: { default: { document: { run: { font: 'Times New Roman', size: 24 }, paragraph: { spacing: { line: 280 } } } } }, sections });
  return Packer.toBuffer(document);
}
export async function renderExcel(list: Transaction[], school: SchoolProfile, year: number) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'SPJ BOSP Sekolah';
  const sheet = (title: string, columns: string[], rows: (string | number)[][]) => { const s = workbook.addWorksheet(title); s.addRow([school.name || 'Identitas sekolah belum diisi']); s.addRow([`Tahun anggaran ${year}`]); s.addRow(columns); rows.forEach(row => s.addRow(row)); s.views = [{ state: 'frozen', ySplit: 3 }]; s.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } }; s.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF152C45' } }; s.columns.forEach((col, i) => { col.width = i === 0 ? 24 : 28; }); s.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } }; s.eachRow(row => { row.alignment = { vertical: 'middle', wrapText: true }; }); return s; };
  const txRows = (ts: Transaction[]) => ts.map(t => [t.number, t.date, t.title, categoryOf(t.category).label, t.amount, STATUS_LABELS[transactionStatus(t, school)]]);
  sheet('Seluruh transaksi', ['Nomor kuitansi', 'Tanggal', 'Kegiatan', 'Kategori', 'Nominal (Rp)', 'Kelengkapan'], txRows(list)).getColumn(5).numFmt = '#,##0';
  sheet('Rekap bulanan', ['Bulan', 'Jumlah transaksi', 'Total (Rp)'], FULL_MONTHS.map((m, i) => { const ts = list.filter(t => Number(t.date.slice(5, 7)) === i + 1); return [m, ts.length, ts.reduce((s, t) => s + t.amount, 0)]; })).getColumn(3).numFmt = '#,##0';
  sheet('Rekap kategori', ['Kategori', 'Jumlah transaksi', 'Total (Rp)'], CATEGORIES.map(c => { const ts = list.filter(t => t.category === c.id); return [c.label, ts.length, ts.reduce((s, t) => s + t.amount, 0)]; })).getColumn(3).numFmt = '#,##0';
  sheet('Dokumen belum lengkap', ['Nomor kuitansi', 'Tanggal', 'Kegiatan', 'Kategori', 'Nominal (Rp)', 'Kelengkapan'], txRows(list.filter(t => transactionStatus(t, school) !== 'complete'))).getColumn(5).numFmt = '#,##0';
  const types = [...new Set(list.map(t => String(t.data.purchaseType || categoryOf(t.category).short)))];
  sheet('Jenis belanja', ['Jenis belanja', 'Jumlah transaksi', 'Total (Rp)'], types.map(type => { const ts = list.filter(t => String(t.data.purchaseType || categoryOf(t.category).short) === type); return [type, ts.length, ts.reduce((s, t) => s + t.amount, 0)]; })).getColumn(3).numFmt = '#,##0';
  return workbook.xlsx.writeBuffer();
}

export async function renderTransferExcel(rows: { name: string; accountNumber: string; bank: string; amount: number; description: string }[], school: SchoolProfile, month: number, year: number, date: string) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'SPJ BOSP Sekolah';
  const monthName = FULL_MONTHS[Math.max(0, Math.min(11, (month || 1) - 1))].toUpperCase();
  const sheet = workbook.addWorksheet(`Non Tunai ${monthName}`, { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.columns = [{ width: 6 }, { width: 42 }, { width: 20 }, { width: 28 }, { width: 14 }, { width: 20 }];
  const titles = [`DATA REKAP PEMBAYARAN NON TUNAI BULAN ${monthName} ${year}`, `BANTUAN OPERASIONAL SATUAN PENDIDIKAN (BOSP) ${year}`, (school.name || 'NAMA SEKOLAH BELUM DIISI').toUpperCase()];
  titles.forEach((title, idx) => { const row = sheet.addRow([title]); row.font = { name: 'Arial', bold: true, size: 13 }; row.alignment = { horizontal: 'center', vertical: 'middle' }; sheet.mergeCells(idx + 1, 1, idx + 1, 6); sheet.getRow(idx + 1).height = 20; });
  sheet.addRow([]);
  const headerRow = sheet.addRow(['NO', 'URAIAN', 'NO REKENING', 'NAMA REKENING', 'BANK', 'JUMLAH']);
  headerRow.font = { name: 'Arial', bold: true, size: 11 };
  headerRow.height = 22;
  const thin = { style: 'thin' as const };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  headerRow.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }; cell.border = border; cell.alignment = { horizontal: 'center', vertical: 'middle' }; });
  const defaultBank = school.bankName ? (school.bankName.toUpperCase().includes('JAWA TIMUR') ? 'BPD-JATIM' : school.bankName.slice(0, 18)) : 'BPD-JATIM';
  const fill = Math.max(10, rows.length);
  let sum = 0;
  for (let i = 0; i < fill; i++) {
    const item = rows[i];
    if (item) sum += item.amount;
    const row = sheet.addRow(item ? [i + 1, item.description, item.accountNumber || '', item.name, item.bank || defaultBank, item.amount] : [i + 1, '', '', '', '', '']);
    row.font = { name: 'Arial', size: 11 };
    row.eachCell({ includeEmpty: true }, (cell, col) => { if (col <= 6) { cell.border = border; cell.alignment = { vertical: 'middle', horizontal: col === 2 || col === 4 ? 'left' : 'center' }; } });
    if (item) { row.getCell(2).font = { name: 'Arial', size: 11, underline: true }; row.getCell(6).numFmt = '#,##0.00'; }
  }
  const totalRow = sheet.addRow(['', '', '', '', '', sum]);
  totalRow.font = { name: 'Arial', bold: true, size: 11 };
  totalRow.height = 22;
  totalRow.eachCell({ includeEmpty: true }, (cell, col) => { if (col <= 6) { cell.border = border; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }; cell.alignment = { horizontal: col === 6 ? 'right' : 'center', vertical: 'middle' }; } });
  totalRow.getCell(6).numFmt = '#,##0.00';
  sheet.addRow([]);
  const place = school.district || school.regency || school.village || '';
  sheet.addRow(['Mengetahui,', '', '', '', `${place ? `${place}, ` : ''}${date}`, '']);
  sheet.addRow(['Kepala Sekolah', '', '', '', 'Bendahara', '']);
  sheet.addRow([]); sheet.addRow([]); sheet.addRow([]);
  const nameRow = sheet.addRow([school.principal || '—', '', '', '', school.treasurer || '—', '']);
  nameRow.font = { name: 'Arial', bold: true, underline: true, size: 11 };
  const nipRow = sheet.addRow([school.principalNip ? `NIP. ${school.principalNip}` : '', '', '', '', school.treasurerNip ? `NIP. ${school.treasurerNip}` : '', '']);
  nipRow.font = { name: 'Arial', size: 11 };
  return workbook.xlsx.writeBuffer();
}
