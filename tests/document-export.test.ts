import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { createDocx, createPdf, exportFileName, parseDocument, type PdfFonts } from '../src/lib/document-export';
import { renderChatMarkdown } from '../src/lib/markdown';

const sample = '# Plano de estudos de Python\n\nAprenda **funções**, *coleções* e organização com prática.\n\n## Acompanhamento\n\n- [ ] Estudar variáveis\n- [x] Instalar Python\n\n3. Ler documentação\n4. Praticar\n   - Revisar exemplos\n\n| Semana | Objetivo |\n| --- | --- |\n| 1 | Variáveis e operações |\n| 2 | Funções e coleções |\n\n```python\nprint("Olá, ação!")\n```\n\n[Documentação](https://docs.python.org/3/)\n';

export async function testPdfFonts(): Promise<PdfFonts> {
  const entries = await Promise.all(Object.entries({ normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' }).map(async ([key, style]) =>
    [key, (await readFile(new URL(`../static/fonts/NotoSans-${style}.ttf`, import.meta.url))).toString('base64')]
  ));
  return Object.fromEntries(entries) as unknown as PdfFonts;
}

// Read generated ZIP members without adding a test-only runtime dependency.
function unzipText(bytes: Uint8Array, name: string): string {
  const data = Buffer.from(bytes);
  let cursor = 0;
  while ((cursor = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cursor)) >= 0) {
    const method = data.readUInt16LE(cursor + 10);
    const size = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const memberName = data.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    if (memberName === name) {
      const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
      const member = data.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(member) : member).toString();
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing ZIP entry ${name}`);
}

test('export preserves tasks, nested lists, ordered starts, table cells and accented code', () => {
  const blocks = parseDocument(sample);
  const text = blocks.flatMap((b) => b.spans).map((s) => s.text).join('\n');
  expect(text).toContain('[ ] Estudar variáveis');
  expect(text).toContain('[x] Instalar Python');
  expect(text).toContain('3. ');
  expect(blocks.some((b) => b.indent === 2)).toBe(true);
  expect(blocks.find((b) => b.kind === 'table')?.rows?.length).toBe(3);
  expect(blocks.find((b) => b.kind === 'code')?.spans[0].text).toContain('Olá, ação!');
});

test('Word contains paragraphs, formatted runs, tables and actual external hyperlinks', async () => {
  const bytes = await createDocx(sample);
  const xml = unzipText(bytes, 'word/document.xml');
  expect(xml).toContain('Plano de estudos de Python');
  expect(xml).toContain('funções');
  expect(xml).toContain('<w:tbl>');
  expect(xml).toContain('<w:b/>');
  expect(xml).toContain('<w:i/>');
  expect(xml).toContain('[ ] Estudar variáveis');
  expect(unzipText(bytes, 'word/_rels/document.xml.rels')).toContain('https://docs.python.org/3/');
});

test('PDF embeds Unicode fonts, paginates long text and retains link annotations', async () => {
  const bytes = await createPdf(sample + '\n\n' + 'Um parágrafo longo com acentuação e funções. '.repeat(600), await testPdfFonts());
  const data = Buffer.from(bytes).toString('latin1');
  expect(data.startsWith('%PDF-')).toBe(true);
  expect(data.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
  expect(data).toContain('/FontFile2');
  expect(data).toContain('/ToUnicode');
  expect(data).toContain('/URI (https://docs.python.org/3/)');
});

test('chat escapes raw HTML and dangerous links, while keeping source links and code diagrams visible', () => {
  const rendered = renderChatMarkdown('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[Nota](lownotes://open?path=Plano.md&line=2)\n\n```mermaid\ngraph TD; A-->B\n```');
  expect(rendered).not.toContain('<img');
  expect(rendered).not.toContain('href="javascript:');
  expect(rendered).toContain('href="lownotes://');
  expect(rendered).toContain('graph TD');
  expect(rendered).not.toContain('class="mermaid-svg"');
});

test('export filename is derived from the note basename', () => {
  expect(exportFileName('Python/Plano de estudos.md', 'pdf')).toBe('Plano de estudos.pdf');
  expect(exportFileName('notes\\A.markdown', 'docx')).toBe('A.docx');
});
