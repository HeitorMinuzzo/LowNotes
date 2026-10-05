<script lang="ts">
  import {
    AlertCircle,
    Bold,
    CheckCircle2,
    Code,
    Columns,
    Edit3,
    Eye,
    FileText,
    Heading1,
    Heading2,
    Italic,
    List,
    ListTodo,
    Loader2,
    LoaderCircle,
    MessageSquare,
    Network,
    Quote,
    Sparkles,
    Strikethrough,
  } from 'lucide-svelte';
  import { onMount, onDestroy, tick } from 'svelte';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import { EditorView, basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { Compartment, EditorState } from '@codemirror/state';
  import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
  import { tags } from '@lezer/highlight';
  import * as Y from 'yjs';
  import { createLocalCollaboration } from '$lib/editor-collaboration';
  import { createImagePaste, type ImagePasteStatus } from '$lib/image-paste';
  import { renderMermaidSvg } from '$lib/mermaid-renderer';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { crdtApplyClientUpdate, readNote, broadcastAwareness, uploadClipboardImage, localImageUrl } from '../api';
  import { renderMarkdown } from '../markdown';
  import DocumentActions from './DocumentActions.svelte';
  import type { AppTheme, ViewMode, ImageUploadProvider } from '../types';
  import { t, ts, trError } from '$lib/i18n';
  import {
    Awareness,
    applyAwarenessUpdate,
    encodeAwarenessUpdate,
    outdatedTimeout,
    removeAwarenessStates,
  } from 'y-protocols/awareness';
  import { colorForDevice, parsePresenceState, type PresenceUser } from '$lib/presence';

  let {
    notePath,
    initialContent,
    crdtUpdateBase64,
    targetLine,
    theme,
    viewMode,
    lineWrapping = true,
    imageUploadProvider = 'local',
    vaultId = '',
    onViewModeChange,
    isAiChatOpen = false,
    onToggleAiChat,
    onContentChange,
    onLocalEdit,
    onOpenNote,
    onOpenGraph,
    onOpenWikilink,
    deviceName = '',
    deviceId = '',
  } = $props<{
    notePath: string;
    initialContent: string;
    crdtUpdateBase64?: string;
    targetLine?: number;
    theme: AppTheme;
    viewMode: ViewMode;
    lineWrapping?: boolean;
    imageUploadProvider?: ImageUploadProvider;
    vaultId?: string;
    onViewModeChange: (mode: ViewMode) => void;
    isAiChatOpen?: boolean;
    onToggleAiChat?: () => void;
    onContentChange?: (path: string, newContent: string) => void;
    onLocalEdit?: () => void;
    onOpenNote?: (path: string) => void;
    onOpenGraph?: () => void;
    onOpenWikilink?: (title: string) => void;
    deviceName?: string;
    deviceId?: string;
  }>();

  const pane = new Spring(.5, { stiffness: .2, damping: .95, precision: .001 });
  const paneRatio = $derived(Math.max(0, Math.min(1, pane.current)));
  let paneContainer = $state<HTMLElement | null>(null);
  let paneWidth = $state(0);
  let sourceLayoutRatio = $state(.5);
  let previewLayoutRatio = $state(.5);
  let paneObserver: ResizeObserver | null = null;
  let paneInitialized = false;
  $effect(() => {
    const ratio = viewMode === 'edit' ? 1 : viewMode === 'preview' ? 0 : .5;
    // Lay text out once at its destination width; only the surrounding reveal animates.
    // This prevents CodeMirror and paragraphs from rewrapping on every spring frame.
    if (viewMode !== 'preview') sourceLayoutRatio = ratio;
    if (viewMode !== 'edit') previewLayoutRatio = 1 - ratio;
    void pane.set(ratio, { instant: !paneInitialized || prefersReducedMotion.current });
    paneInitialized = true;
    void tick().then(() => editorView?.requestMeasure());
  });
  let editorContainer: HTMLDivElement | null = $state(null);
  let previewContainer: HTMLDivElement | null = $state(null);
  let saveStatus = $state<'saved' | 'error'>('saved');
  let currentContent = $state('');
  let wordCount = $derived(
    currentContent.trim() ? currentContent.trim().split(/\s+/).length : 0
  );
  let charCount = $derived(currentContent.length);
  let imageUploads = $state<ImagePasteStatus[]>([]);
  let imageRevision = $state(0);
  let unlistenImages: UnlistenFn | null = null;
  let imagePaste: ReturnType<typeof createImagePaste> | null = null;

  let editorView: EditorView | null = null;
  let yDoc: Y.Doc | null = null;
  let undoManager: Y.UndoManager | null = null;
  let unlistenCrdt: UnlistenFn | null = null;
  let awareness: Awareness | null = null;
  let remoteUsers = $state<PresenceUser[]>([]);
  let awarenessSendTimer: ReturnType<typeof setTimeout> | null = null;
  let stalePruneTimer: ReturnType<typeof setInterval> | undefined;
  let unlistenAwareness: UnlistenFn | null = null;
  let pendingRemoteUpdates: Uint8Array[] = [];
  let disposed = false;
  let mermaidCounter = 0;
  let mermaidDebounce: ReturnType<typeof setTimeout> | null = null;
  const editorTheme = new Compartment();
  const editorWrapping = new Compartment();

  function codeMirrorTheme() {
    const isDark = theme === 'dark';
    const linkColor = 'var(--editor-link)';
    const linkHover = 'var(--editor-link-hover)';
    const highlight = syntaxHighlighting(HighlightStyle.define([
      { tag: [tags.link, tags.url], color: linkColor, textDecoration: 'underline' },
      { tag: [tags.atom, tags.bool, tags.labelName, tags.keyword], color: 'var(--accent)' },
      { tag: [tags.definition(tags.variableName), tags.local(tags.variableName), tags.definition(tags.propertyName)], color: 'var(--text-main)' },
      { tag: tags.comment, color: 'var(--text-dim)', fontStyle: 'italic' },
      { tag: tags.string, color: 'var(--text-main)' },
    ]));
    const baseTheme = EditorView.theme({
      '&': { height: '100%', outline: 'none' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-link, .cm-url': {
        color: `${linkColor} !important`,
        textDecoration: 'underline',
      },
      '.cm-link:hover, .cm-url:hover': {
        color: `${linkHover} !important`,
      },
      '&.cm-editor a': {
        color: `${linkColor} !important`,
      },
    }, { dark: isDark });

    return [baseTheme, highlight];
  }

  async function renderMermaidBlocks(activeTheme: AppTheme) {
    if (!previewContainer) return;
    const blocks = previewContainer.querySelectorAll<HTMLDivElement>('.mermaid-block');
    if (blocks.length === 0) return;

    const colors = getComputedStyle(document.documentElement);
    const config = {
      startOnLoad: false,
      theme: activeTheme === 'dark' ? 'dark' as const : 'default' as const,
      themeVariables: {
        darkMode: activeTheme === 'dark',
        background: colors.getPropertyValue('--bg-card').trim(),
        primaryColor: colors.getPropertyValue('--bg-active').trim(),
        primaryTextColor: colors.getPropertyValue('--text-main').trim(),
        primaryBorderColor: colors.getPropertyValue('--border').trim(),
        lineColor: colors.getPropertyValue('--text-muted').trim(),
        secondaryColor: colors.getPropertyValue('--bg-sidebar').trim(),
        tertiaryColor: colors.getPropertyValue('--bg-main').trim(),
      },      fontFamily: 'inherit',
      securityLevel: 'strict' as const,
    };

    for (const block of blocks) {
      const raw = block.getAttribute('data-mermaid');
      if (!raw) continue;
      const code = decodeURIComponent(raw).trim();
      const svgTarget = block.querySelector<HTMLDivElement>('.mermaid-svg');
      if (!svgTarget) continue;

      const id = `mermaid-${Date.now()}-${mermaidCounter++}`;
      try {
        const svg = await renderMermaidSvg(id, code, config);
        svgTarget.innerHTML = svg;
      } catch {
        svgTarget.innerHTML = `<pre class="text-xs text-[var(--text-muted)] font-mono text-left w-full p-2 bg-[var(--bg-main)] rounded border border-[var(--border)] overflow-x-auto whitespace-pre-wrap">${code}</pre>`;
      }
    }
  }

  function base64ToUint8Array(base64: string): Uint8Array {
    let clean = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4 !== 0) {
      clean += '=';
    }
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function initEditor(content = initialContent, snapshot = crdtUpdateBase64) {
    if (!editorContainer) return;
    imagePaste?.destroy();
    imageUploads = [];

    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
    if (undoManager) {
      undoManager.destroy();
      undoManager = null;
    }
    if (yDoc) {
      yDoc.destroy();
      yDoc = null;
    }

    yDoc = new Y.Doc();
    if (snapshot && snapshot.trim().length > 0) {
      try {
        const update = base64ToUint8Array(snapshot);
        Y.applyUpdate(yDoc, update, 'init');
      } catch (e) {
        console.error('Failed to apply initial CRDT update:', e);
      }
    }

    const yText = yDoc.getText('content');
    if (yText.length === 0 && content.length > 0) {
      yText.insert(0, content);
    }

    currentContent = yText.toString();

    if (awareness) {
      awareness.destroy();
      awareness = null;
    }
    awareness = new Awareness(yDoc);
    awareness.setLocalState({
      user: {
        name: deviceName || 'LowNotes',
        color: colorForDevice(deviceId || 'local'),
        deviceId: deviceId || 'local',
        notePath,
      },
    });
    awareness.on('update', (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (!awareness || origin === 'remote' || origin === 'prune') return;
      const encoded = encodeAwarenessUpdate(awareness, [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ]);
      if (awarenessSendTimer) clearTimeout(awarenessSendTimer);
      awarenessSendTimer = setTimeout(() => {
        broadcastAwareness(notePath, Array.from(encoded)).catch(() => {});
      }, 50);
      refreshRemoteUsers();
    });
    refreshRemoteUsers();

    // Listen to Yjs local edits to broadcast and autosave
    yDoc.on('update', (update: Uint8Array, origin: any) => {
      const text = yText.toString();
      currentContent = text;
      onContentChange?.(notePath, text);

      if (origin !== 'remote') {
        onLocalEdit?.();
        const base64 = uint8ArrayToBase64(update);
        crdtApplyClientUpdate(notePath, base64)
          .catch((error) => { console.error('Failed to persist CRDT update:', error); saveStatus = 'error'; });
      }
    });

    const collaboration = createLocalCollaboration(yText, awareness);
    undoManager = collaboration.undoManager;
    const uploadVaultId = vaultId;
    imagePaste = createImagePaste({
      upload: (bytes, provider) => uploadClipboardImage(bytes, provider, uploadVaultId),
      getProvider: () => imageUploadProvider,
      onStatus: (statuses) => { imageUploads = statuses; },
      isolateUndo: () => undoManager?.stopCapturing(),
    });
    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        basicSetup,
        markdown(),
        collaboration.extension,
        imagePaste.extension,
        editorTheme.of(codeMirrorTheme()),
        editorWrapping.of(lineWrapping ? EditorView.lineWrapping : []),
      ],
    });

    editorView = new EditorView({
      state,
      parent: editorContainer,
    });
  }

  function navigateToLine(lineNumber: number) {
    if (!editorView || lineNumber <= 0) return;
    try {
      const totalLines = editorView.state.doc.lines;
      const target = Math.min(lineNumber, totalLines);
      const line = editorView.state.doc.line(target);
      editorView.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      });
      editorView.focus();
    } catch (e) {
      console.error('Failed to navigate to line:', e);
    }
  }

  $effect(() => {
    if (targetLine && targetLine > 0 && editorView) {
      navigateToLine(targetLine);
    }
  });

  function applyFormatting(prefix: string, suffix: string = '') {
    if (!editorView) return;
    const { from, to } = editorView.state.selection.main;
    const selectedText = editorView.state.sliceDoc(from, to);
    const replacement = `${prefix}${selectedText || ts('editor.placeholderText')}${suffix}`;

    editorView.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + prefix.length, head: from + replacement.length - suffix.length },
    });
    editorView.focus();
  }

  function handlePreviewClick(e: MouseEvent) {
    const target = e.target as Element | null;
    const link = target?.closest('a');
    if (!link) return;
    const wikilink = link.getAttribute('data-wikilink');
    const href = link.getAttribute('href') ?? '';
    if (wikilink !== null || /\.(?:md|markdown)(?:#[^?]*)?$/i.test(href)) {
      e.preventDefault();
      onOpenWikilink?.(wikilink ?? href);
    }
  }

  function refreshRemoteUsers() {
    if (!awareness) {
      remoteUsers = [];
      return;
    }
    const users: PresenceUser[] = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const user = parsePresenceState(state)?.user;
      if (user && user.notePath === notePath && user.deviceId) {
        users.push(user);
      }
    }
    remoteUsers = users;
  }

  function pruneStalePeers() {
    if (!awareness) return;
    const now = Date.now();
    const stale: number[] = [];
    awareness.meta.forEach((meta, clientId) => {
      if (clientId !== awareness!.clientID && now - meta.lastUpdated > outdatedTimeout) {
        stale.push(clientId);
      }
    });
    if (stale.length > 0) {
      removeAwarenessStates(awareness, stale, 'prune');
      refreshRemoteUsers();
    }
  }

  onMount(async () => {
    if (paneContainer) {
      paneWidth = paneContainer.clientWidth;
      paneObserver = new ResizeObserver(([entry]) => { paneWidth = entry.contentRect.width; });
      paneObserver.observe(paneContainer);
    }
    const stopCrdt = await listen<{ note_path: string; update: number[] }>(
      'p2p:crdt-update',
      (event) => {
        if (event.payload.note_path === notePath) {
          const update = new Uint8Array(event.payload.update);
          if (yDoc) Y.applyUpdate(yDoc, update, 'remote');
          else pendingRemoteUpdates.push(update);
        }
      }
    );
    if (disposed) { stopCrdt(); return; }
    unlistenCrdt = stopCrdt;

    const stopAwareness = await listen<{ note_path: string; update: number[] }>(
      'p2p:awareness',
      (event) => {
        if (event.payload.note_path === notePath && awareness) {
          applyAwarenessUpdate(awareness, new Uint8Array(event.payload.update), 'remote');
          refreshRemoteUsers();
        }
      }
    );
    if (disposed) { stopAwareness(); return; }
    unlistenAwareness = stopAwareness;
    const stopImages = await listen('p2p:synced', () => { imageRevision++; });
    if (disposed) { stopImages(); return; }
    unlistenImages = stopImages;

    // Read after listeners are ready so edits arriving while this note opens are not lost.
    try {
      const latest = await readNote(notePath);
      if (disposed) return;
      initEditor(latest.content, latest.crdt_update_base64);
    } catch (error) {
      if (disposed) return;
      console.error('Failed to refresh note before editing:', error);
      initEditor();
    }
    for (const update of pendingRemoteUpdates) {
      if (yDoc) Y.applyUpdate(yDoc, update, 'remote');
    }
    pendingRemoteUpdates = [];

    stalePruneTimer = setInterval(pruneStalePeers, 15000);
  });

  onDestroy(() => {
    paneObserver?.disconnect();
    imagePaste?.destroy();
    disposed = true;
    if (editorView) editorView.destroy();
    if (undoManager) undoManager.destroy();
    if (yDoc) yDoc.destroy();
    if (unlistenCrdt) unlistenCrdt();
    if (unlistenAwareness) unlistenAwareness();
    if (unlistenImages) unlistenImages();
    if (awarenessSendTimer) clearTimeout(awarenessSendTimer);
    if (stalePruneTimer) clearInterval(stalePruneTimer);
    if (awareness) {
      awareness.destroy();
      awareness = null;
    }
  });
  $effect(() => {
    if (editorView) {
      editorView.dispatch({ effects: editorTheme.reconfigure(codeMirrorTheme()) });
    }
  });

  $effect(() => {
    const wrap = lineWrapping;
    if (editorView) {
      editorView.dispatch({ effects: editorWrapping.reconfigure(wrap ? EditorView.lineWrapping : []) });
    }
  });

  $effect(() => {
    if ((viewMode === 'split' || viewMode === 'preview') && previewContainer && currentContent) {
      imageRevision;
      const activeTheme = theme;
      if (mermaidDebounce) clearTimeout(mermaidDebounce);
      mermaidDebounce = setTimeout(() => {
        renderMermaidBlocks(activeTheme);
      }, 60);
    }
  });
</script>

<div class="apple-editor flex flex-col h-full w-full bg-[var(--bg-main)]">
  <!-- Top Editor Toolbar (Glassmorphic Bar) -->
  <header class="apple-note-header">
    <div class="apple-note-heading"><span class="apple-document-icon"><FileText size={20} strokeWidth={1.6} /></span><div><strong>{notePath.split('/').at(-1)?.replace(/\.md$/i, '')}</strong><span>{notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : 'LowNotes'}</span></div></div>
    <div class="apple-note-header-actions">
      <span class="apple-save-state" role="status">{#if saveStatus === 'error'}<AlertCircle size={13} /><span>{$t('editor.saveError')}</span>{:else}<CheckCircle2 size={13} /><span>{$t('editor.saved')}</span>{/if}</span>
      {#if remoteUsers.length > 0}<div class="apple-editor-presence">{#each remoteUsers as user (user.deviceId)}<span style:background={user.color} title={user.name}>{user.name.slice(0, 1).toUpperCase()}</span>{/each}</div>{/if}
      <DocumentActions content={currentContent} path={notePath} />
    </div>
  </header>
  <div class="apple-formatting-toolbar" role="toolbar" aria-label={$t('editor.formatting')}>
    {#each [
      [{ icon: Bold, label: $t('editor.bold'), prefix: '**', suffix: '**' }, { icon: Italic, label: $t('editor.italic'), prefix: '*', suffix: '*' }, { icon: Strikethrough, label: $t('editor.strikethrough'), prefix: '~~', suffix: '~~' }],
      [{ icon: Heading1, label: $t('editor.heading1'), prefix: '# ', suffix: '' }, { icon: Heading2, label: $t('editor.heading2'), prefix: '## ', suffix: '' }],
      [{ icon: List, label: $t('editor.list'), prefix: '- ', suffix: '' }, { icon: ListTodo, label: $t('editor.checklist'), prefix: '- [ ] ', suffix: '' }, { icon: Code, label: $t('editor.code'), prefix: '`', suffix: '`' }, { icon: Quote, label: $t('editor.quote'), prefix: '> ', suffix: '' }],
    ] as group}
      <div class="apple-formatting-group">{#each group as tool}<button type="button" disabled={viewMode === 'preview'} onclick={() => applyFormatting(tool.prefix, tool.suffix)} title={tool.label} aria-label={tool.label}><tool.icon size={16} strokeWidth={1.7} /></button>{/each}</div>
    {/each}
    <span class="apple-formatting-caption">Markdown</span>
  </div>
  <!-- Editor & Preview Body -->
  {#if imageUploads.length}
    <div class="border-b border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-xs space-y-2">
      {#each imageUploads as upload (upload.id)}
        <div class="flex flex-wrap items-center gap-2">
          {#if upload.status === 'uploading'}
            <span role="status" class="flex items-center gap-2 text-[var(--accent-light)]">
              <LoaderCircle size={15} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {$t(upload.provider === 'local' ? 'editor.imageSavingLocal' : 'editor.imageUploading', { provider: upload.provider === 'imgur' ? 'Imgur' : 'Catbox', name: upload.name, uploaded: upload.uploaded, count: upload.count })}
            </span>
          {:else if upload.status === 'error'}
            <span role="alert" class="text-[var(--danger)]">{upload.name}: {trError(upload.error)}</span>
            <button class="underline text-[var(--accent-light)]" onclick={() => imagePaste?.retry(upload.id)}>{$t('editor.imageRetry')}</button>
          {:else}
            <span role="status">{$t('editor.imagePositionDeleted')}</span>
            <button class="underline text-[var(--accent-light)]" onclick={() => imagePaste?.insertAtCursor(upload.id)}>{$t('editor.imageInsertHere')}</button>
          {/if}
          <button class="ml-auto shrink-0 underline text-[var(--text-muted)]" onclick={() => imagePaste?.cancel(upload.id)}>{$t('editor.imageCancel')}</button>
        </div>
      {/each}
    </div>
  {/if}
  <main bind:this={paneContainer} class="apple-editor-panes" style:grid-template-columns="{paneRatio}fr {1 - paneRatio}fr">
    <div bind:this={editorContainer} class="apple-source-pane" inert={viewMode === 'preview'} aria-hidden={viewMode === 'preview'} style:--source-width={paneWidth ? `${paneWidth * sourceLayoutRatio}px` : '100%'} style:opacity={Math.min(1, paneRatio * 5)}></div>
    <div class="apple-preview-pane" inert={viewMode === 'edit'} aria-hidden={viewMode === 'edit'} style:--preview-width={paneWidth ? `${paneWidth * previewLayoutRatio}px` : '100%'} style:opacity={Math.min(1, (1 - paneRatio) * 5)}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div bind:this={previewContainer} role="presentation" onclick={handlePreviewClick} class="apple-editor-preview select-text">
        <article class="prose max-w-none text-[var(--text-main)]">
          {@html renderMarkdown(currentContent, (src) => localImageUrl(src, vaultId, imageRevision))}
        </article>
      </div>
    </div>
  </main>
  <!-- Status Bar Footer -->
  <footer class="flex items-center justify-between px-5 py-2 border-t border-[var(--border)] bg-[var(--bg-sidebar)]/80 backdrop-blur-md text-xs text-[var(--text-dim)] select-none">
    <div class="flex items-center gap-2">
      <span class="font-mono text-[11px] text-[var(--text-muted)] truncate max-w-md">{notePath}</span>
    </div>
    <div class="flex items-center gap-4 text-[11.5px]">
      <span>{$t('editor.words', { count: wordCount })}</span>
      <span>•</span>
      <span>{$t('editor.chars', { count: charCount })}</span>
    </div>
  </footer>

</div>

<style>
  :global(.prose) {
    line-height: 1.7;
    font-size: 15px;
  }
  :global(.prose h1) {
    font-size: 1.85rem;
    font-weight: 700;
    margin-top: 1.5rem;
    margin-bottom: 0.8rem;
    color: var(--text-main);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4rem;
  }
  :global(.prose h2) {
    font-size: 1.4rem;
    font-weight: 600;
    margin-top: 1.3rem;
    margin-bottom: 0.6rem;
    color: var(--text-main);
  }
  :global(.prose h3) {
    font-size: 1.15rem;
    font-weight: 600;
    margin-top: 1rem;
    margin-bottom: 0.4rem;
    color: var(--text-main);
  }
  :global(.prose p) {
    margin-top: 0.6rem;
    margin-bottom: 0.6rem;
  }
  :global(.prose code) {
    background-color: var(--bg-card);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    border: 1px solid var(--border);
  }
  :global(.prose pre) {
    background-color: var(--bg-card);
    padding: 12px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    overflow-x: auto;
  }
  :global(.prose pre code) {
    padding: 0;
    border: 0;
    background: transparent;
  }
  :global(.prose blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 12px;
    color: var(--text-muted);
    font-style: italic;
  }
  :global(.prose ul) {
    list-style-type: disc;
    padding-left: 1.4rem;
    margin: 0.6rem 0;
  }
  :global(.prose ol) {
    list-style-type: decimal;
    padding-left: 1.4rem;
    margin: 0.6rem 0;
  }
  :global(.prose a) {
    color: var(--accent-light);
    text-decoration: underline;
  }
  :global(.wikilink) {
    color: var(--accent-light);
    text-decoration: underline;
    cursor: pointer;
  }
  :global(.prose table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }
  :global(.prose th, .prose td) {
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
  }
  :global(.prose th) {
    background-color: var(--bg-card);
  }
  :global(.prose dl) {
    margin: 0.8rem 0 1.2rem;
  }
  :global(.prose dt) {
    font-weight: 650;
    margin-top: 0.8rem;
  }
  :global(.prose dd) {
    margin: 0.2rem 0 0.7rem 1.25rem;
    color: var(--text-muted);
  }
  :global(.prose dd p) {
    margin: 0.35rem 0;
  }
  :global(.prose .footnotes) {
    margin-top: 2rem;
    border-top: 1px solid var(--border);
    padding-top: 0.8rem;
    color: var(--text-muted);
    font-size: 0.9em;
  }
  :global(.prose .footnotes-sep) {
    border: 0;
    border-top: 1px solid var(--border);
    margin-top: 2rem;
  }
  :global(.prose .footnote-ref), :global(.prose .footnote-backref) {
    font-size: 0.85em;
  }
  :global(.prose abbr) {
    text-decoration: underline dotted;
    cursor: help;
  }
  :global(.prose mark) {
    background: var(--accent-glow);
    color: var(--text-main);
    border-radius: 2px;
  }
  :global(.prose .warning), :global(.prose .info), :global(.prose .tip), :global(.prose .danger) {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    padding: 0.6rem 1rem;
    margin: 1rem 0;
  }
  :global(.prose .danger) {
    border-left-color: var(--danger);
  }
  :global(.prose .tip) {
    border-left-color: var(--success);
  }
  :global(.prose .mermaid-block) {
    margin: 1rem 0;
    padding: 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow-x: auto;
    text-align: center;
  }
  :global(.prose .mermaid-svg) {
    display: flex;
    justify-content: center;
  }
  :global(.prose img) {
    max-width: 100%;
  }
  :global(.prose .task-list-item) {
    list-style-type: none;
  }
  :global(.prose .task-list-item input) {
    margin-right: 0.4rem;
    accent-color: var(--accent);
  }
</style>
