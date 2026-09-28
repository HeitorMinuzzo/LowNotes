import type { VaultItem } from './types';

export interface NoteTreeRow {
  item: VaultItem;
  depth: number;
}

/** Keep the vault hierarchy visible while filtering notes and their ancestors. */
export function visibleNoteRows(items: VaultItem[], collapsed: ReadonlySet<string>, query = ''): NoteTreeRow[] {
  const byParent = new Map<string, VaultItem[]>();
  for (const item of items) {
    const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
    const siblings = byParent.get(parent) ?? [];
    siblings.push(item);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => Number(b.is_dir) - Number(a.is_dir)
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }

  const needle = query.trim().toLocaleLowerCase();
  const matches = new Set<string>();
  if (needle) {
    for (const item of items) {
      if (!item.title.toLocaleLowerCase().includes(needle)
        && !item.path.toLocaleLowerCase().includes(needle)) continue;
      let path = item.path;
      while (path) {
        matches.add(path);
        path = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      }
    }
  }

  const rows: NoteTreeRow[] = [];
  const visit = (parent: string, depth: number) => {
    for (const item of byParent.get(parent) ?? []) {
      if (needle && !matches.has(item.path)) continue;
      rows.push({ item, depth });
      if (item.is_dir && (needle || !collapsed.has(item.path))) visit(item.path, depth + 1);
    }
  };
  visit('', 0);
  return rows;
}
