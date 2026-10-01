import type { ExportOptions } from './export-assets';
export { parseDocument, type DocumentBlock, type TextSpan } from './document-model';
export type { ExportOptions, ExportImage } from './export-assets';
export { createDocx } from './docx-export';
export { createPdf, type PdfFonts } from './pdf-export';
export type ExportFormat = 'docx' | 'pdf';

export function exportFileName(path: string, format: ExportFormat): string {
  const name = (path.split(/[\\/]/).pop() || 'document').replace(/\.(md|markdown)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim();
  return `${name || 'document'}.${format}`;
}

export async function exportDocument(content: string, path: string, format: ExportFormat): Promise<boolean> {
  const [{ save }, { invoke }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/core')]);
  const destination = await save({ defaultPath: exportFileName(path, format), filters: [{ name: format === 'docx' ? 'Word' : 'PDF', extensions: [format] }] });
  if (!destination) return false;
  const options: ExportOptions = { notePath: path };
  const bytes = format === 'docx'
    ? await (await import('./docx-export')).createDocx(content, options)
    : await (await import('./pdf-export')).createPdf(content, undefined, options);
  const outputPath = destination.toLowerCase().endsWith(`.${format}`) ? destination : `${destination}.${format}`;
  await invoke('export_document', { path: outputPath, bytes: Array.from(bytes) });
  return true;
}
