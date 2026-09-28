import MarkdownIt from 'markdown-it';
import type { ParagraphChild } from 'docx';

export type ExportFormat = 'docx' | 'pdf';
export interface TextSpan { text: string; bold?: boolean; italic?: boolean; code?: boolean; url?: string }
export interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'code' | 'table' | 'rule';
  spans: TextSpan[];
  level?: number;
  indent?: number;
  quote?: boolean;
  rows?: TextSpan[][][];
}

const parser = new MarkdownIt({ html: false, linkify: true });
type Token = ReturnType<typeof parser.parse>[number];

function inlineSpans(tokens: Token[]): TextSpan[] {
  let bold = false, italic = false;
  let url: string | undefined;
  const spans: TextSpan[] = [];
  for (const token of tokens) {
    if (token.type === 'strong_open') bold = true;
    else if (token.type === 'strong_close') bold = false;
    else if (token.type === 'em_open') italic = true;
    else if (token.type === 'em_close') italic = false;
    else if (token.type === 'link_open') url = String(token.attrGet('href') || '') || undefined;
    else if (token.type === 'link_close') url = undefined;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') spans.push({ text: '\n' });
    else if (token.type === 'image') {
      // Keep an explicit image reference; exporting never fetches remote/local image data.
      spans.push({ text: `[${token.content || 'Image'}] (${token.attrGet('src') || ''})` });
    } else if (token.type === 'text' || token.type === 'code_inline' || token.type === 'html_inline') {
      spans.push({ text: token.content, bold, italic, code: token.type === 'code_inline', url });
    }
  }
  return spans;
}

export function parseDocument(content: string): DocumentBlock[] {
  const tokens = parser.parse(content, {});
  const blocks: DocumentBlock[] = [];
  const lists: Array<{ ordered: boolean; index: number; pending: boolean }> = [];
  let heading = 0, quote = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') heading = Number(token.tag.slice(1));
    else if (token.type === 'heading_close') heading = 0;
    else if (token.type === 'blockquote_open') quote++;
    else if (token.type === 'blockquote_close') quote--;
    else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      lists.push({ ordered: token.type === 'ordered_list_open', index: Number(token.attrGet('start') || 1) - 1, pending: false });
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop();
    else if (token.type === 'list_item_open' && lists.length) {
      lists[lists.length - 1].index++;
      lists[lists.length - 1].pending = true;
    } else if (token.type === 'inline') {
      const spans = inlineSpans(token.children || []);
      const list = lists.at(-1);
      if (list?.pending) {
        // Task markers remain literal [ ] / [x], preserving completion in both formats.
        if (!/^\[[ xX]\]/.test(spans[0]?.text || '')) spans.unshift({ text: list.ordered ? `${list.index}. ` : '• ' });
        list.pending = false;
      }
      blocks.push({ kind: heading ? 'heading' : 'paragraph', level: heading, spans, indent: lists.length, quote: quote > 0 });
    } else if (token.type === 'fence' || token.type === 'code_block') {
      blocks.push({ kind: 'code', spans: [{ text: token.content.trimEnd(), code: true }], indent: lists.length });
    } else if (token.type === 'hr') blocks.push({ kind: 'rule', spans: [] });
    else if (token.type === 'table_open') {
      const rows: TextSpan[][][] = [];
      let row: TextSpan[][] = [];
      while (++i < tokens.length && tokens[i].type !== 'table_close') {
        if (tokens[i].type === 'tr_open') row = [];
        else if (tokens[i].type === 'inline') row.push(inlineSpans(tokens[i].children || []));
        else if (tokens[i].type === 'tr_close') rows.push(row);
      }
      blocks.push({ kind: 'table', spans: [], rows });
    }
  }
  return blocks;
}

export function exportFileName(path: string, format: ExportFormat): string {
  const name = (path.split(/[\\/]/).pop() || 'document').replace(/\.(md|markdown)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim();
  return `${name || 'document'}.${format}`;
}

export async function createDocx(content: string): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, HeadingLevel, BorderStyle, VerticalAlign } = await import('docx');
  const runs = (spans: TextSpan[]): ParagraphChild[] => spans.flatMap<ParagraphChild>((span) => {
    const parts = span.text.split('\n');
    const textRuns = parts.map((text, i) => new TextRun({ text, break: i ? 1 : undefined,
      bold: span.bold, italics: span.italic, font: span.code ? 'Consolas' : undefined,
      ...(span.url ? { color: '1565C0', underline: {} } : {}),
    }));
    return span.url && /^https?:\/\//i.test(span.url)
      ? [new ExternalHyperlink({ link: span.url, children: textRuns })] : textRuns;
  });
  const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
  const children = parseDocument(content).map((block) => {
    if (block.kind === 'table') return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: Array.from({ length: block.rows?.[0]?.length || 1 }, () => Math.floor(9638 / (block.rows?.[0]?.length || 1))),
      rows: (block.rows || []).map((row, index) => new TableRow({ tableHeader: index === 0,
        children: row.map((cell) => new TableCell({
          shading: index === 0 ? { fill: 'EAF0F6' } : undefined,
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ children: runs(cell.map((span) => ({ ...span, bold: index === 0 || span.bold }))) })],
        })),
      })),
    });
    return new Paragraph({
      children: runs(block.spans),
      heading: block.kind === 'heading' ? headings[(block.level || 1) - 1] : undefined,
      keepNext: block.kind === 'heading',
      spacing: { after: block.kind === 'heading' ? 180 : 120, before: block.kind === 'heading' ? 240 : 0 },
      indent: block.indent || block.quote ? { left: (block.indent || 1) * 280 } : undefined,
      shading: block.kind === 'code' ? { fill: 'F3F5F7' } : undefined,
      border: block.kind === 'rule' ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } } : undefined,
    });
  });
  const document = new Document({
    creator: 'LowNotes',
    styles: { default: {
      document: { run: { font: 'Calibri', size: 22, color: '000000' }, paragraph: { spacing: { line: 280 } } },
      heading1: { run: { color: '000000', bold: true, size: 40 } },
      heading2: { run: { color: '000000', bold: true, size: 32 } },
      heading3: { run: { color: '000000', bold: true, size: 28 } },
      heading4: { run: { color: '000000', bold: true, size: 24 } },
      heading5: { run: { color: '000000', bold: true, size: 22 } },
      heading6: { run: { color: '000000', bold: true, size: 22 } },
    } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
}

export interface PdfFonts { normal: string; bold: string; italic: string; bolditalic: string }
let fontPromise: Promise<PdfFonts> | undefined;

async function loadPdfFonts(): Promise<PdfFonts> {
  if (!fontPromise) fontPromise = (async () => {
    const styles = { normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' };
    const fonts = await Promise.all(Object.entries(styles).map(async ([style, suffix]) => {
      const response = await fetch(`/fonts/NotoSans-${suffix}.ttf`);
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

export async function createPdf(content: string, fonts?: PdfFonts): Promise<Uint8Array> {
  const [{ jsPDF }, { autoTable }, fontData] = await Promise.all([import('jspdf'), import('jspdf-autotable'), fonts || loadPdfFonts()]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ creator: 'LowNotes' });
  for (const [style, data] of Object.entries(fontData)) {
    pdf.addFileToVFS(`NotoSans-${style}.ttf`, data);
    pdf.addFont(`NotoSans-${style}.ttf`, 'NotoSans', style);
  }
  const margin = 20, bottom = 277, width = 170;
  let y = margin;
  const room = (height: number) => { if (y + height > bottom) { pdf.addPage(); y = margin; } };
  for (const block of parseDocument(content)) {
    if (block.kind === 'rule') {
      room(8); pdf.setDrawColor(200); pdf.line(margin, y + 2, margin + width, y + 2); y += 8;
      continue;
    }
    if (block.kind === 'table') {
      room(15);
      const cells = (block.rows || []).map((row) => row.map((cell) => cell.map((s) => s.text).join('')));
      autoTable(pdf, { startY: y, head: cells.slice(0, 1), body: cells.slice(1),
        margin: { left: margin, right: margin, top: margin, bottom: margin },
        styles: { font: 'NotoSans', fontSize: 9, cellPadding: 2.5, overflow: 'linebreak' },
        headStyles: { fillColor: [44, 62, 80], fontStyle: 'bold' }, theme: 'grid',
      });
      y = (pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      continue;
    }
    const size = block.kind === 'heading' ? [22, 17, 14, 12, 11, 10][(block.level || 1) - 1] : block.kind === 'code' ? 9 : 10.5;
    const lineHeight = size * 0.48;
    room(block.kind === 'heading' ? lineHeight + 14 : lineHeight);
    const left = margin + Math.min(block.indent || (block.quote ? 1 : 0), 6) * 5;
    let x = left;
    const newline = () => { y += lineHeight; room(lineHeight); x = left; };
    for (const span of block.spans) {
      const bold = block.kind === 'heading' || span.bold;
      const style = bold ? (span.italic ? 'bolditalic' : 'bold') : span.italic ? 'italic' : 'normal';
      pdf.setFont('NotoSans', style); pdf.setFontSize(size);
      const link = span.url && /^https?:\/\//i.test(span.url) ? span.url : undefined;
      pdf.setTextColor(link ? '#1565C0' : block.quote ? '#596579' : '#202B3B');
      for (const part of span.text.split(/(\n|[^\S\n]+)/).filter(Boolean)) {
        if (part === '\n') { newline(); continue; }
        if (x === left && /^\s+$/.test(part) && block.kind !== 'code') continue;
        const available = margin + width - left;
        const chunks: string[] = pdf.getTextWidth(part) > available ? pdf.splitTextToSize(part, available) : [part];
        for (const chunk of chunks) {
          const length = pdf.getTextWidth(chunk);
          if (x > left && x + length > margin + width) newline();
          if (link) pdf.textWithLink(chunk, x, y + lineHeight * 0.8, { url: link });
          else pdf.text(chunk, x, y + lineHeight * 0.8);
          x += length;
        }
      }
    }
    y += lineHeight + (block.kind === 'heading' ? 4 : 3);
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('NotoSans', 'normal'); pdf.setFontSize(8); pdf.setTextColor('#788395');
    pdf.text(`${page} / ${pages}`, 190, 288, { align: 'right' });
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}

export async function exportDocument(content: string, path: string, format: ExportFormat): Promise<boolean> {
  const [{ save }, { invoke }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/core')]);
  const destination = await save({ defaultPath: exportFileName(path, format), filters: [{ name: format === 'docx' ? 'Word' : 'PDF', extensions: [format] }] });
  if (!destination) return false;
  const bytes = format === 'docx' ? await createDocx(content) : await createPdf(content);
  const outputPath = destination.toLowerCase().endsWith(`.${format}`) ? destination : `${destination}.${format}`;
  await invoke('export_document', { path: outputPath, bytes: Array.from(bytes) });
  return true;
}
