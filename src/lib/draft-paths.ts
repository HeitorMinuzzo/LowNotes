import type { NoteDraft } from './types';

/** Put a generated collection in one visible folder, preserving explicit subfolders. */
export function groupDraftPaths(prompt: string, drafts: NoteDraft[]): NoteDraft[] {
  if (drafts.length < 2 || drafts.every((draft) => draft.path.includes('/'))) return drafts;
  const folders = [...new Set(drafts.filter((draft) => draft.path.includes('/'))
    .map((draft) => draft.path.split('/', 1)[0]))];
  if (folders.length > 1) return drafts;
  const topic = prompt.match(/\bpython\b/i)?.[0]
    ?? prompt.match(/(?:aprender|estudar|sobre)\s+(?:o\s+|a\s+)?([\p{L}\p{N}+#.-]+)/iu)?.[1]
    ?? 'Notas geradas';
  const folder = (folders[0] || topic).trim().replace(/[\\/:*?"<>|.]/g, '')
    .replace(/\s+/g, ' ').slice(0, 48) || 'Notas geradas';
  return drafts.map((draft) => draft.path.includes('/') ? draft : {
    ...draft,
    path: `${folder}/${draft.path}`,
  });
}

/** Ensure a generated series has a navigable overview even if the model omitted links. */
export function connectDraftCollection(drafts: NoteDraft[]): NoteDraft[] {
  if (drafts.length < 2) return drafts;
  const overviewIndex = drafts.findIndex((draft) =>
    /(?:plano|índice|indice|visão|overview|readme)/i.test(draft.path.split('/').at(-1) ?? ''));
  const index = overviewIndex >= 0 ? overviewIndex : 0;
  const overview = drafts[index];
  const missing = drafts.filter((draft, i) => {
    if (i === index) return false;
    const stem = draft.path.replace(/\.(?:md|markdown)$/i, '');
    const name = draft.path.split('/').at(-1)!;
    const basename = name.replace(/\.(?:md|markdown)$/i, '');
    return !overview.content.includes(`[[${stem}`)
      && !overview.content.includes(`[[${basename}`)
      && !overview.content.includes(`(${draft.path})`)
      && !overview.content.includes(`(${name})`);
  });
  if (!missing.length) return drafts;
  const links = missing.map((draft) => {
    const target = draft.path.replace(/\.(?:md|markdown)$/i, '');
    const label = target.split('/').at(-1)!;
    return `- [[${target}|${label}]]`;
  });
  const content = `${overview.content.trimEnd()}\n\n## Notas relacionadas\n\n${links.join('\n')}\n`;
  return drafts.map((draft, i) => i === index ? { ...draft, content } : draft);
}
