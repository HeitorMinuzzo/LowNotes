import { MapMode, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ImageUploadProvider } from './types';

export const MAX_PASTED_IMAGE_BYTES = 200 * 1024 * 1024;
export const MAX_PASTED_GIF_BYTES = 20 * 1024 * 1024;
export const MAX_IMGUR_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_LOCAL_IMAGE_BYTES = 50 * 1024 * 1024;

interface UploadAnchor {
  id: number;
  from: number;
  to: number;
  selectedText: string;
  replaceSelection: boolean;
}

export const addUploadAnchor = StateEffect.define<UploadAnchor>();
export const removeUploadAnchor = StateEffect.define<number>();
export const completeUploadAnchor = StateEffect.define<number>();

/** Pending paste positions follow local typing and incoming collaboration changes. */
export const uploadAnchors = StateField.define<UploadAnchor[]>({
  create: () => [],
  update(anchors, transaction) {
    const completed = transaction.effects.find((effect) => effect.is(completeUploadAnchor))?.value;
    let next = anchors.flatMap((anchor) => {
      // A completion before another paste at the same position keeps paste order.
      const association = typeof completed === 'number' && completed < anchor.id ? 1 : -1;
      const from = transaction.changes.mapPos(anchor.from, association, MapMode.TrackDel);
      if (from === null) return [];
      const to = anchor.from === anchor.to ? from : transaction.changes.mapPos(anchor.to, 1);
      let replaceSelection = anchor.replaceSelection;
      transaction.changes.iterChangedRanges((start, end) => {
        if (start <= anchor.to && end >= anchor.from) replaceSelection = false;
      });
      return [{ ...anchor, from, to, replaceSelection }];
    });
    for (const effect of transaction.effects) {
      if (effect.is(addUploadAnchor)) next.push(effect.value);
      if (effect.is(removeUploadAnchor) || effect.is(completeUploadAnchor)) {
        next = next.filter((anchor) => anchor.id !== effect.value);
      }
    }
    return next;
  },
});

export interface ImagePasteStatus {
  provider: ImageUploadProvider;
  id: number;
  name: string;
  count: number;
  uploaded: number;
  status: 'uploading' | 'error' | 'ready';
  error: string;
}

interface UploadJob extends ImagePasteStatus {
  files: File[];
  links: string[];
  view: EditorView;
}

export function clipboardImages(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  // items and files describe the same clipboard entries; use only one list.
  const items = Array.from(clipboard.items ?? []);
  const files = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .flatMap((item) => { const file = item.getAsFile(); return file ? [file] : []; });
  return files.length ? files : Array.from(clipboard.files ?? []).filter((file) => file.type.startsWith('image/'));
}

export async function imageBytes(file: File, provider: ImageUploadProvider = 'catbox'): Promise<Uint8Array> {
  if (provider === 'local' && file.size > MAX_LOCAL_IMAGE_BYTES) throw new Error('errors.localImageTooLarge');
  if (provider === 'imgur') {
    if (file.size > MAX_IMGUR_IMAGE_BYTES) throw new Error('errors.imgurTooLarge');
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) throw new Error('errors.imgurUnsupported');
  }
  if (file.size > MAX_PASTED_IMAGE_BYTES) throw new Error('errors.imageTooLarge');
  if (file.type === 'image/gif' && file.size > MAX_PASTED_GIF_BYTES) throw new Error('errors.imageGifTooLarge');
  return new Uint8Array(await file.arrayBuffer());
}

export function imageMarkdown(fileName: string, link: string, provider: ImageUploadProvider = 'catbox'): string {
  const alt = fileName.replace(/[\r\n]/g, ' ').replace(/[\\\[\]<>`*_]/g, '\\$&');
  if (provider === 'local') {
    if (!/^lownotes-image:[0-9a-f]{64}\.(png|jpg|gif|webp|bmp)$/.test(link)) throw new Error('errors.localImageInvalid');
    return `![${alt}](${link})`;
  }
  const url = new URL(link);
  const host = provider === 'imgur' ? 'i.imgur.com' : 'files.catbox.moe';
  const path = provider === 'imgur' ? /^\/[a-zA-Z0-9]+\.(png|jpg|jpeg|gif)$/ : /^\/[a-zA-Z0-9]+\.(png|jpg|jpeg|gif|webp|bmp)$/;
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password
      || url.port || !path.test(url.pathname) || url.search || url.hash) throw new Error(`errors.${provider}Response`);
  return `![${alt}](${url.href})`;
}

export function createImagePaste(options: {
  upload: (bytes: Uint8Array, provider: ImageUploadProvider) => Promise<string>;
  getProvider?: () => ImageUploadProvider;
  onStatus: (statuses: ImagePasteStatus[]) => void;
  isolateUndo?: () => void;
}) {
  const jobs = new Map<number, UploadJob>();
  let nextId = 0;
  let destroyed = false;
  const notify = () => {
    if (!destroyed) options.onStatus(Array.from(jobs.values(), ({ id, name, count, uploaded, status, error, provider }) =>
      ({ id, name, count, uploaded, status, error, provider })));
  };
  const active = (job: UploadJob) => !destroyed && jobs.get(job.id) === job;

  function insert(job: UploadJob) {
    if (!active(job)) return;
    const anchor = job.view.state.field(uploadAnchors).find((item) => item.id === job.id);
    if (!anchor) {
      // The original location was deleted. Keep the uploaded link available explicitly.
      job.status = 'ready';
      notify();
      return;
    }
    const replace = anchor.replaceSelection
      && job.view.state.sliceDoc(anchor.from, anchor.to) === anchor.selectedText;
    options.isolateUndo?.();
    job.view.dispatch({
      changes: { from: anchor.from, to: replace ? anchor.to : anchor.from,
        insert: job.links.map((link, index) => imageMarkdown(job.files[index].name, link, job.provider)).join('\n') },
      effects: completeUploadAnchor.of(job.id),
      annotations: Transaction.userEvent.of('input.paste'),
    });
    options.isolateUndo?.();
    jobs.delete(job.id);
    notify();
  }

  async function run(job: UploadJob) {
    job.status = 'uploading';
    job.error = '';
    notify();
    try {
      // Preserve completed uploads on failure so retry never uploads the same file again.
      for (let index = job.links.length; index < job.files.length; index++) {
        const bytes = await imageBytes(job.files[index], job.provider);
        if (!active(job)) return;
        const link = await options.upload(bytes, job.provider);
        if (!active(job)) return;
        imageMarkdown(job.files[index].name, link, job.provider);
        job.links.push(link);
        job.uploaded = job.links.length;
        notify();
      }
      insert(job);
    } catch (error) {
      if (!active(job)) return;
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      notify();
    }
  }

  function paste(event: ClipboardEvent, view: EditorView): boolean {
    const files = clipboardImages(event.clipboardData);
    if (!files.length || view.state.readOnly || destroyed) return false;
    event.preventDefault();
    const { from, to } = view.state.selection.main;
    const id = ++nextId;
    view.dispatch({ effects: addUploadAnchor.of({ id, from, to,
      selectedText: view.state.sliceDoc(from, to), replaceSelection: true }) });
    const job: UploadJob = { id, view, files, links: [], name: files[0].name, provider: options.getProvider?.() ?? 'local',
      count: files.length, uploaded: 0, status: 'uploading', error: '' };
    jobs.set(id, job);
    void run(job);
    return true;
  }

  return {
    extension: [uploadAnchors, EditorView.domEventHandlers({ paste })] as Extension,
    paste,
    retry(id: number) {
      const job = jobs.get(id);
      if (job?.status === 'error') void run(job);
    },
    insertAtCursor(id: number) {
      const job = jobs.get(id);
      if (job?.status !== 'ready') return;
      const from = job.view.state.selection.main.head;
      job.view.dispatch({ effects: addUploadAnchor.of({ id, from, to: from,
        selectedText: '', replaceSelection: false }) });
      insert(job);
    },
    cancel(id: number) {
      const job = jobs.get(id);
      if (!job || destroyed) return;
      job.view.dispatch({ effects: removeUploadAnchor.of(id) });
      jobs.delete(id);
      notify();
    },
    destroy() { destroyed = true; jobs.clear(); },
  };
}
