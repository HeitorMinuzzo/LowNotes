import { expect, test } from 'bun:test';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ImageUploadProvider } from '../src/lib/types';
import { clipboardImages, createImagePaste, imageBytes, imageMarkdown, MAX_PASTED_IMAGE_BYTES, MAX_PASTED_GIF_BYTES, uploadAnchors,
  type ImagePasteStatus } from '../src/lib/image-paste';

const image = (name = 'image.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
const link = (name = 'one') => `https://files.catbox.moe/${name}.png`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function editor(doc: string, cursor: number, upload: (bytes: Uint8Array, provider: ImageUploadProvider) => Promise<string>, to = cursor, getProvider?: () => ImageUploadProvider) {
  let statuses: ImagePasteStatus[] = [];
  const paste = createImagePaste({ upload, getProvider: getProvider ?? (() => 'catbox'), onStatus: (value) => { statuses = value; } });
  let state = EditorState.create({ doc, selection: { anchor: cursor, head: to }, extensions: paste.extension });
  const view = {
    get state() { return state; },
    dispatch(spec: TransactionSpec) { state = state.update(spec).state; },
  } as unknown as EditorView;
  let prevented = false;
  return { paste, view, statuses: () => statuses, doc: () => state.doc.toString(), prevented: () => prevented,
    async image(files = [image()]) {
      const event = { clipboardData: { items: [], files }, preventDefault() { prevented = true; } } as unknown as ClipboardEvent;
      const handled = paste.paste(event, view);
      await tick();
      return handled;
    },
  };
}

test('plain text paste uses CodeMirror default without sending a request', () => {
  const subject = editor('text', 2, async () => { throw new Error('must not upload'); });
  const event = { clipboardData: { items: [], files: [] } } as unknown as ClipboardEvent;
  expect(subject.paste.paste(event, subject.view)).toBe(false);
  expect(subject.statuses()).toHaveLength(0);
  expect(subject.doc()).toBe('text');
});

test('local paste inserts a stable reference and never requires an external URL', async () => {
  const pending = deferred<string>();
  const reference = `lownotes-image:${'a'.repeat(64)}.webp`;
  let chosen = '';
  const subject = editor('text', 2, async (_, provider) => { chosen = provider; return pending.promise; }, 2, () => 'local');
  await subject.image();
  expect(chosen).toBe('local');
  expect(subject.statuses()[0].provider).toBe('local');
  expect(subject.doc()).toBe('text');
  pending.resolve(reference);
  await tick();
  expect(subject.doc()).toBe(`te![image.png](${reference})xt`);
  expect(subject.statuses()).toHaveLength(0);
  for (const invalid of ['https://files.catbox.moe/a.png', 'lownotes-image:../../settings.json', `lownotes-image:${'a'.repeat(64)}.exe`]) {
    expect(() => imageMarkdown('image.png', invalid, 'local')).toThrow('errors.localImageInvalid');
  }
});

test('local input limit rejects oversized data before it is read', async () => {
  const file = { name: 'huge.png', type: 'image/png', size: 50 * 1024 * 1024 + 1,
    arrayBuffer: () => { throw new Error('must not read oversized bytes'); } } as unknown as File;
  await expect(imageBytes(file, 'local')).rejects.toThrow('errors.localImageTooLarge');
});

test('Imgur pastes and retries keep their provider after a settings change', async () => {
  let provider: ImageUploadProvider = 'imgur';
  const sent: ImageUploadProvider[] = [];
  const first = deferred<string>();
  const subject = editor('text', 2, async (_, chosen) => {
    sent.push(chosen);
    return sent.length === 1 ? first.promise : 'https://i.imgur.com/abc.jpg';
  }, 2, () => provider);
  await subject.image();
  expect(subject.statuses()[0].provider).toBe('imgur');
  provider = 'catbox';
  first.reject(new Error('errors.imgurRateLimit'));
  await tick();
  subject.paste.retry(subject.statuses()[0].id);
  await tick();
  expect(sent).toEqual(['imgur', 'imgur']);
  expect(subject.doc()).toBe('te![image.png](https://i.imgur.com/abc.jpg)xt');
  expect(subject.statuses()).toHaveLength(0);
});

test('Imgur enforces its own size and formats before reading or uploading', async () => {
  let sent = false;
  const subject = editor('unchanged', 0, async () => { sent = true; return ''; }, 0, () => 'imgur');
  const tooLarge = { name: 'large.png', type: 'image/png', size: 10 * 1024 * 1024 + 1,
    arrayBuffer: () => { throw new Error('must not read oversized bytes'); } } as unknown as File;
  await subject.image([tooLarge]);
  expect(subject.statuses()[0].error).toBe('errors.imgurTooLarge');
  await subject.image([new File(['RIFF1234WEBP'], 'image.webp', { type: 'image/webp' })]);
  expect(subject.statuses()[1].error).toBe('errors.imgurUnsupported');
  expect(sent).toBe(false);
  expect(subject.doc()).toBe('unchanged');
});

test('Imgur links must match the provider and be direct safe images', () => {
  expect(imageMarkdown('image.png', 'https://i.imgur.com/abc.jpg', 'imgur')).toBe('![image.png](https://i.imgur.com/abc.jpg)');
  for (const url of ['https://files.catbox.moe/abc.png', 'https://i.imgur.com/abc.mp4', 'https://i.imgur.com/abc.png?x=1', 'https://i.imgur.com.evil.com/abc.png']) {
    expect(() => imageMarkdown('image.png', url, 'imgur')).toThrow('errors.imgurResponse');
  }
  expect(() => imageMarkdown('image.png', 'https://i.imgur.com/abc.png', 'catbox')).toThrow('errors.catboxResponse');
});

test('clipboard items do not duplicate their files entries', () => {
  const file = image();
  const clipboard = { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file] } as unknown as DataTransfer;
  expect(clipboardImages(clipboard)).toEqual([file]);
});

test('shows uploading and only inserts a completed Catbox Markdown image', async () => {
  const request = deferred<string>();
  const subject = editor('hello world', 6, () => request.promise);
  expect(await subject.image()).toBe(true);
  expect(subject.prevented()).toBe(true);
  expect(subject.statuses()[0].status).toBe('uploading');
  expect(subject.doc()).toBe('hello world');
  request.resolve(link());
  await tick();
  expect(subject.doc()).toBe(`hello ![image.png](${link()})world`);
  expect(subject.statuses()).toHaveLength(0);
});

test('typing and incoming edits map the paste position without moving the active cursor', async () => {
  const request = deferred<string>();
  const subject = editor('abcdef', 3, () => request.promise);
  await subject.image();
  subject.view.dispatch({ changes: { from: 0, insert: 'REMOTE ' }, annotations: Transaction.remote.of(true) });
  subject.view.dispatch({ changes: { from: 10, insert: 'typing' }, selection: { anchor: 16 } });
  request.resolve(link());
  await tick();
  expect(subject.doc()).toBe(`REMOTE abc![image.png](${link()})typingdef`);
  expect(subject.view.state.selection.main.head).toBe(16 + imageMarkdown('image.png', link()).length);
});

test('replaces untouched selected text, but never deletes text typed during upload', async () => {
  const first = deferred<string>();
  const subject = editor('before SELECT after', 7, () => first.promise, 13);
  await subject.image();
  first.resolve(link());
  await tick();
  expect(subject.doc()).toBe(`before ![image.png](${link()}) after`);
  const second = deferred<string>();
  const edited = editor('before SELECT after', 7, () => second.promise, 13);
  await edited.image();
  edited.view.dispatch({ changes: { from: 7, to: 13, insert: 'NEW' } });
  second.resolve(link());
  await tick();
  expect(edited.doc()).toBe(`before ![image.png](${link()})NEW after`);
});

test('failed upload keeps text intact and retries at the mapped position', async () => {
  const first = deferred<string>();
  let calls = 0;
  const subject = editor('abcd', 2, () => ++calls === 1 ? first.promise : Promise.resolve(link()));
  await subject.image();
  first.reject(new Error('errors.catboxRateLimit'));
  await tick();
  expect(subject.doc()).toBe('abcd');
  expect(subject.statuses()[0].error).toBe('errors.catboxRateLimit');
  subject.view.dispatch({ changes: { from: 0, insert: 'new ' } });
  subject.paste.retry(subject.statuses()[0].id);
  await tick();
  expect(subject.doc()).toBe(`new ab![image.png](${link()})cd`);
});

test('multiple clipboard images stay ordered and retry preserves completed uploads', async () => {
  let calls = 0;
  const subject = editor('', 0, async () => {
    calls++;
    if (calls === 2) throw new Error('errors.catboxConnection');
    return link(calls === 1 ? 'one' : 'two');
  });
  await subject.image([image('one.png'), image('two.png')]);
  expect(subject.statuses()[0].uploaded).toBe(1);
  expect(subject.doc()).toBe('');
  subject.paste.retry(subject.statuses()[0].id);
  await tick();
  expect(calls).toBe(3);
  expect(subject.doc()).toBe(`![one.png](${link('one')})\n![two.png](${link('two')})`);
});

test('separate pastes at the same position preserve order despite reverse completion', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  let calls = 0;
  const subject = editor('ab', 1, () => ++calls === 1 ? first.promise : second.promise);
  await subject.image([image('first.png')]);
  await subject.image([image('second.png')]);
  second.resolve(link('second'));
  await tick();
  first.resolve(link('first'));
  await tick();
  expect(subject.doc()).toBe(`a![first.png](${link('first')})![second.png](${link('second')})b`);
});

test('deleted insertion context waits for explicit placement at the current cursor', async () => {
  const request = deferred<string>();
  const subject = editor('abcdef', 3, () => request.promise);
  await subject.image();
  subject.view.dispatch({ changes: { from: 1, to: 5, insert: '' }, selection: { anchor: 2 } });
  expect(subject.view.state.field(uploadAnchors)).toHaveLength(0);
  request.resolve(link());
  await tick();
  expect(subject.doc()).toBe('af');
  expect(subject.statuses()[0].status).toBe('ready');
  subject.paste.insertAtCursor(subject.statuses()[0].id);
  expect(subject.doc()).toBe(`af![image.png](${link()})`);
});

test('cancel and note teardown prevent late upload results from modifying the document', async () => {
  for (const teardown of [false, true]) {
    const request = deferred<string>();
    const subject = editor('unchanged', 3, () => request.promise);
    await subject.image();
    if (teardown) subject.paste.destroy();
    else subject.paste.cancel(subject.statuses()[0].id);
    request.resolve(link());
    await tick();
    expect(subject.doc()).toBe('unchanged');
  }
});

test('oversized clipboard image is rejected before the upload request', async () => {
  let sent = false;
  const subject = editor('original', 2, async () => { sent = true; return link(); });
  await subject.image([{ name: 'large.png', type: 'image/png', size: MAX_PASTED_IMAGE_BYTES + 1,
    arrayBuffer: () => { throw new Error('oversized data must not be read'); } } as unknown as File]);
  expect(sent).toBe(false);
  expect(subject.statuses()[0].error).toBe('errors.imageTooLarge');
  expect(subject.doc()).toBe('original');
});

test('preserves binary image data and prevents Markdown/link injection', async () => {
  expect(await imageBytes(image())).toEqual(new Uint8Array([137, 80, 78, 71]));
  expect(imageMarkdown('a]b[.png', link())).toBe(`![a\\]b\\[.png](${link()})`);
  expect(() => imageMarkdown('x', 'https://evil.com/x.png')).toThrow('errors.catboxResponse');
});

test('enforces the separate GIF limit before reading or uploading the data', async () => {
  let sent = false;
  const subject = editor('unchanged', 0, async () => { sent = true; return link(); });
  await subject.image([{ name: 'large.gif', type: 'image/gif', size: MAX_PASTED_GIF_BYTES + 1,
    arrayBuffer: () => { throw new Error('oversized data must not be read'); } } as unknown as File]);
  expect(sent).toBe(false);
  expect(subject.statuses()[0].error).toBe('errors.imageGifTooLarge');
  expect(subject.doc()).toBe('unchanged');
});

test('allows static images above the previous 10 MB limit using binary transport', async () => {
  let received = 0;
  const subject = editor('', 0, async (bytes) => { received = bytes.byteLength; return link(); });
  await subject.image([new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]);
  expect(received).toBe(10 * 1024 * 1024 + 1);
  expect(subject.doc()).toBe(`![large.png](${link()})`);
});
