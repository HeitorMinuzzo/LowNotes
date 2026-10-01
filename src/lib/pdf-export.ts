import { prepareDocument, columnFractions, type PreparedSpan, type PreparedBlock } from './prepared-document';
import type { ExportImage, ExportOptions } from './export-assets';

export interface PdfFonts { normal: string; bold: string; italic: string; bolditalic: string; mono?: string }
let fontPromise: Promise<PdfFonts> | undefined;

async function loadPdfFonts(): Promise<PdfFonts> {
  if (!fontPromise) fontPromise = (async () => {
    const styles = { normal: 'NotoSans-Regular', bold: 'NotoSans-Bold', italic: 'NotoSans-Italic', bolditalic: 'NotoSans-BoldItalic', mono: 'NotoSansMono-Regular' };
    const fonts = await Promise.all(Object.entries(styles).map(async ([style, name]) => {
      const response = await fetch(`/fonts/${name}.ttf`);
      if (!response.ok) throw new Error('export.fontFailed');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return [style, btoa(binary)];
    }));
    return Object.fromEntries(fonts) as unknown as PdfFonts;
  })().catch((error) => { fontPromise = undefined; throw error; });
  return fontPromise;
}

interface Fragment { span: PreparedSpan; text: string; width: number; height: number; size: number; font: string; style: string }
interface Line { fragments: Fragment[]; width: number; height: number }
const PT = 25.4 / 72;
const MARGIN = 20, RIGHT = 190, BOTTOM = 277, WIDTH = RIGHT - MARGIN;
const COLORS: Record<string, string> = { info: '#EFF6FF', tip: '#F0FDF4', warning: '#FFFBEB', danger: '#FEF2F2' };

export async function createPdf(content: string, fonts?: PdfFonts, options: ExportOptions = {}): Promise<Uint8Array> {
  const [{ jsPDF: Pdf }, fontData, blocks] = await Promise.all([import('jspdf'), fonts || loadPdfFonts(), prepareDocument(content, options)]);
  const pdf = new Pdf({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ creator: 'LowNotes' });
  for (const [style, data] of Object.entries(fontData)) {
    pdf.addFileToVFS(`NotoSans-${style}.ttf`, data);
    pdf.addFont(`NotoSans-${style}.ttf`, style === 'mono' ? 'NotoSansMono' : 'NotoSans', style === 'mono' ? 'normal' : style);
  }
  let y = MARGIN;
  function newPage() { pdf.addPage(); y = MARGIN; }
  function room(height: number) { if (y + height > BOTTOM && y > MARGIN) newPage(); }
  function layout(spans: PreparedSpan[], size: number, available: number, code = false): Line[] {
    const lineHeight = size * PT * 1.5;
    const lines: Line[] = [];
    let line: Line = { fragments: [], width: 0, height: lineHeight };
    function newline() { lines.push(line); line = { fragments: [], width: 0, height: lineHeight }; }
    function push(fragment: Fragment) {
      if (line.width + fragment.width > available + 0.001 && line.fragments.length) newline();
      if (!code && !line.fragments.length && /^\s+$/.test(fragment.text)) return;
      line.fragments.push(fragment); line.width += fragment.width; line.height = Math.max(line.height, fragment.height);
    }
    for (const span of spans) {
      const script = span.subscript || span.superscript;
      const font = span.code ? (fontData.mono ? 'NotoSansMono' : 'courier') : 'NotoSans';
      const style = span.code ? 'normal' : span.bold ? (span.italic ? 'bolditalic' : 'bold') : span.italic ? 'italic' : 'normal';
      const fontSize = script ? size * 0.75 : size;
      pdf.setFont(font, style); pdf.setFontSize(fontSize);
      const fragment = (text: string): Fragment => ({ span, text, width: pdf.getTextWidth(text), height: lineHeight, size: fontSize, font, style });
      if (span.asset) {
        const nativeWidth = span.asset.width * 25.4 / 96;
        const nativeHeight = span.asset.height * 25.4 / 96;
        const scale = span.emoji ? size * PT / nativeHeight : Math.min(1, available / nativeWidth, (BOTTOM - MARGIN) * 0.65 / nativeHeight);
        push({ ...fragment(''), width: nativeWidth * scale, height: Math.max(lineHeight, nativeHeight * scale + 1) });
      } else if (span.checkbox !== undefined) {
        push({ ...fragment(''), width: 4, height: lineHeight });
      } else {
        for (const part of span.text.replace(/\t/g, '    ').split(/(\n|[^\S\n]+)/).filter(Boolean)) {
          if (part === '\n') { newline(); continue; }
          const text = !code && /^\s+$/.test(part) ? ' ' : part;
          if (pdf.getTextWidth(text) <= available) push(fragment(text));
          else {
            let chunk = '';
            for (const character of Array.from(text)) {
              if (chunk && pdf.getTextWidth(chunk + character) > available) { push(fragment(chunk)); newline(); chunk = ''; }
              chunk += character;
            }
            if (chunk) push(fragment(chunk));
          }
        }
      }
    }
    if (line.fragments.length || !lines.length) lines.push(line);
    return lines;
  }
  function drawLine(line: Line, left: number, top: number, available: number, alignment: 'left' | 'center' | 'right' = 'left', color = '#202B3B') {
    let x = left + (alignment === 'right' ? available - line.width : alignment === 'center' ? (available - line.width) / 2 : 0);
    for (const item of line.fragments) {
      const { span } = item;
      const baseline = top + line.height - item.size * PT * 0.35 + (span.subscript ? 0.7 : span.superscript ? -1.1 : 0);
      if (span.asset) {
        const height = item.width * span.asset.height / span.asset.width;
        pdf.addImage(span.asset.data, 'PNG', x, top + line.height - height - 0.5, item.width, height);
        if (span.url && /^(https?:|mailto:)/i.test(span.url)) {
          pdf.link(x, top + line.height - height - 0.5, item.width, height, { url: span.url });
        }
      } else if (span.checkbox !== undefined) {
        const boxTop = baseline - 2.9;
        pdf.setDrawColor('#475569'); pdf.setLineWidth(0.25); pdf.roundedRect(x, boxTop, 2.8, 2.8, 0.3, 0.3);
        if (span.checkbox) { pdf.line(x + 0.5, boxTop + 1.4, x + 1.1, boxTop + 2.1); pdf.line(x + 1.1, boxTop + 2.1, x + 2.3, boxTop + 0.6); }
      } else {
        pdf.setFont(item.font, item.style); pdf.setFontSize(item.size);
        const link = span.url && /^(https?:|mailto:)/i.test(span.url) ? span.url : undefined;
        if (span.highlight || span.code) {
          pdf.setFillColor(span.highlight ? '#FFF2A8' : '#F3F4F6');
          pdf.rect(x - 0.2, baseline - item.size * PT * 0.9, item.width + 0.4, item.size * PT * 1.2, 'F');
        }
        pdf.setTextColor(link ? '#1565C0' : color);
        pdf.text(item.text, x, baseline);
        if (span.underline || link || span.strike) {
          pdf.setDrawColor(link ? '#1565C0' : color); pdf.setLineWidth(0.16);
          if (span.underline || link) pdf.line(x, baseline + 0.5, x + item.width, baseline + 0.5);
          if (span.strike) pdf.line(x, baseline - item.size * PT * 0.3, x + item.width, baseline - item.size * PT * 0.3);
        }
        if (link) pdf.link(x, baseline - item.size * PT, item.width, item.size * PT * 1.3, { url: link });
      }
      x += item.width;
    }
  }
  function imageSize(asset: ExportImage, available: number) {
    const scale = Math.min(available / asset.width, (BOTTOM - MARGIN - 5) / asset.height, 25.4 / 96);
    return { width: asset.width * scale, height: asset.height * scale };
  }
  function image(asset: ExportImage, left: number, available: number) {
    const { width, height } = imageSize(asset, available);
    room(height + 5);
    pdf.addImage(asset.data, 'PNG', left + (available - width) / 2, y, width, height);
    y += height + 5;
  }
  function table(block: PreparedBlock) {
    const widths = columnFractions(block.rows || []).map((fraction) => fraction * WIDTH);
    const rows = (block.rows || []).map((row, index) => row.map((cell, column) =>
      layout(cell.map((span) => ({ ...span, bold: index === 0 || span.bold })), 9.5, widths[column] - 5)));
    const header = rows[0];
    if (!header) return;
    const rowHeight = (row: Line[][]) => Math.max(...row.map((cell) => cell.reduce((height, line) => height + line.height, 0))) + 5;
    const headerHeight = rowHeight(header);
    const repeatHeader = headerHeight < 80;
    function drawSegment(cells: Line[][], height: number, head: boolean, striped: boolean) {
      let left = MARGIN;
      for (let column = 0; column < widths.length; column++) {
        pdf.setFillColor(head ? '#EAF0F6' : striped ? '#F8FAFC' : '#FFFFFF');
        pdf.setDrawColor('#CBD5E1'); pdf.setLineWidth(0.2);
        pdf.rect(left, y, widths[column], height, 'FD');
        let top = y + 2.5;
        for (const line of cells[column] || []) {
          drawLine(line, left + 2.5, top, widths[column] - 5, block.alignments?.[column] || 'left');
          top += line.height;
        }
        left += widths[column];
      }
      y += height;
    }
    function nextPage(withHeader: boolean) {
      newPage();
      if (withHeader && repeatHeader) drawSegment(header, headerHeight, true, false);
    }
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const height = rowHeight(row);
      const capacity = BOTTOM - MARGIN - (index > 0 && repeatHeader ? headerHeight : 0);
      if (height <= capacity && y + height > BOTTOM) nextPage(index > 0);
      const remaining = row.map((cell) => [...cell]);
      while (remaining.some((cell) => cell.length)) {
        const available = BOTTOM - y - 5;
        const segment = remaining.map((cell) => {
          let used = 0, count = 0;
          while (count < cell.length && used + cell[count].height <= available + 0.001) used += cell[count++].height;
          return cell.slice(0, count);
        });
        if (!segment.some((cell) => cell.length)) { nextPage(index > 0); continue; }
        const segmentHeight = rowHeight(segment);
        drawSegment(segment, segmentHeight, index === 0, index % 2 === 0);
        segment.forEach((cell, column) => remaining[column].splice(0, cell.length));
        if (remaining.some((cell) => cell.length)) nextPage(index > 0);
      }
    }
    y += 5;
  }
  let previousFootnote: number | undefined;
  const textBlocks = blocks.map((block) => {
    const left = MARGIN + Math.min(block.indent || (block.quote || block.callout ? 1 : 0), 12) * 5;
    const size = block.kind === 'heading' ? [22, 17, 14, 12, 11, 10.5][(block.level || 1) - 1]
      : block.kind === 'code' ? 9 : block.footnoteId ? 9 : 10.5;
    const spans = block.spans.map((span) => ({ ...span, bold: block.kind === 'heading' || block.definitionTerm || span.bold }));
    if (block.footnoteId && previousFootnote !== block.footnoteId) {
      spans.unshift({ text: `${block.footnoteId}. `, bold: true }); previousFootnote = block.footnoteId;
    }
    const lines = layout(spans, size, RIGHT - left - (block.kind === 'code' ? 4 : 0), block.kind === 'code');
    const height = lines.reduce((height, line) => height + line.height, 0);
    return { left, size, lines, height, keepCode: block.kind === 'code' && height <= (BOTTOM - MARGIN) / 2 };
  });
  function followingHeight(index: number): number {
    const next = blocks[index], text = textBlocks[index];
    if (!next) return 0;
    if (next.asset) return imageSize(next.asset, RIGHT - text.left).height + 5;
    if (next.kind === 'heading') return text.height + 6.5 + followingHeight(index + 1);
    if (text.keepCode) return text.height + 3;
    return Math.max(12, text.lines.slice(0, 2).reduce((height, line) => height + line.height, 0));
  }
  for (const [blockIndex, block] of blocks.entries()) {
    if (block.kind === 'table') { room(15); table(block); continue; }
    if (block.kind === 'rule') {
      room(8); pdf.setDrawColor('#CBD5E1'); pdf.line(MARGIN, y + 2, RIGHT, y + 2); y += 8; continue;
    }
    const { left, size, lines, height: totalHeight, keepCode } = textBlocks[blockIndex];
    if (block.asset) { image(block.asset, left, RIGHT - left); continue; }
    if (keepCode) room(totalHeight + 3);
    if (block.kind === 'heading') {
      room(Math.min(BOTTOM - MARGIN, totalHeight + 6.5 + followingHeight(blockIndex + 1)));
      y += y > MARGIN ? 3 : 0;
    }
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]; room(line.height);
      if (block.kind === 'code' || block.callout) {
        pdf.setFillColor(block.kind === 'code' ? '#F3F4F6' : COLORS[block.callout!] || COLORS.info);
        pdf.rect(left - 2, y, RIGHT - left + 2, line.height, 'F');
      }
      if (block.quote || block.callout) {
        pdf.setDrawColor(block.quote ? '#94A3B8' : '#60A5FA'); pdf.setLineWidth(0.8); pdf.line(left - 3, y, left - 3, y + line.height);
      }
      if (index === 0 && block.list?.first && (!block.spans.some((span) => span.checkbox !== undefined) || block.list.ordered)) {
        pdf.setFont('NotoSans', 'normal'); pdf.setFontSize(size); pdf.setTextColor('#202B3B');
        if (block.list.ordered) pdf.text(`${block.list.index}.`, left - 2, y + line.height - size * PT * 0.35, { align: 'right' });
        else { pdf.setFillColor('#202B3B'); pdf.circle(left - 2.7, y + line.height / 2, 0.55, 'F'); }
      }
      drawLine(line, left, y, RIGHT - left, 'left', block.quote ? '#596579' : '#202B3B');
      y += line.height;
    }
    y += block.kind === 'heading' ? 3.5 : 3;
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('NotoSans', 'normal'); pdf.setFontSize(8); pdf.setTextColor('#788395');
    pdf.text(`${page} / ${pages}`, RIGHT, 288, { align: 'right' });
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}
