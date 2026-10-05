<script lang="ts">
  import {
    AlertCircle,
    Bold,
    CheckCircle2,
    Code,
    Columns,
    Edit3,
    Eye,
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
  import { onMount, onDestroy } from 'svelte';
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
    isAppleTheme = false,
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
    isAppleTheme?: boolean;
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
    const linkColor = isAppleTheme ? (isDark ? '#2997ff' : '#0066cc') : isDark ? '#7dd3fc' : '#0284c7';
    const linkHover = isAppleTheme ? (isDark ? '#70baff' : '#0071e3') : isDark ? '#bae6fd' : '#0369a1';

    const highlight = syntaxHighlighting(
      HighlightStyle.define(isAppleTheme ? [
        { tag: [tags.link, tags.url], color: linkColor, textDecoration: 'underline' },
        { tag: [tags.atom, tags.bool, tags.labelName, tags.keyword], color: linkColor },
        { tag: [tags.definition(tags.variableName), tags.local(tags.variableName), tags.definition(tags.propertyName)], color: 'var(--text-main)' },
        { tag: tags.comment, color: 'var(--text-dim)', fontStyle: 'italic' },
        { tag: tags.string, color: 'var(--text-main)' },
      ] : [
        { tag: tags.link, color: linkColor, textDecoration: 'underline' },
        { tag: tags.url, color: linkColor, textDecoration: 'underline' },
        { tag: [tags.atom, tags.bool, tags.labelName], color: isDark ? '#f7c65d' : '#d97706' },
        { tag: tags.keyword, color: isDark ? '#f472b6' : '#be185d' },
        { tag: [tags.definition(tags.variableName), tags.local(tags.variableName)], color: isDark ? '#93c5fd' : '#1d4ed8' },
        { tag: tags.definition(tags.propertyName), color: isDark ? '#7dd3fc' : '#0284c7' },
        { tag: tags.comment, color: isDark ? '#ae9293' : '#6b586b', fontStyle: 'italic' },
        { tag: tags.string, color: isDark ? '#b9c978' : '#4d7c0f' },
      ])
    );

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

  async function renderMermaidBlocks(activeTheme: AppTheme, appleTheme: boolean) {
    if (!previewContainer) return;
    const blocks = previewContainer.querySelectorAll<HTMLDivElement>('.mermaid-block');
    if (blocks.length === 0) return;

    const config = {
      startOnLoad: false,
      theme: activeTheme === 'dark' ? 'dark' as const : 'default' as const,
      ...(appleTheme ? {
        themeVariables: {
          darkMode: activeTheme === 'dark',
          background: activeTheme === 'dark' ? '#272729' : '#f5f5f7',
          primaryColor: activeTheme === 'dark' ? '#2997ff' : '#0066cc',
          primaryTextColor: activeTheme === 'dark' ? '#f5f5f7' : '#1d1d1f',
          primaryBorderColor: activeTheme === 'dark' ? '#38383a' : '#e0e0e0',
          lineColor: activeTheme === 'dark' ? '#a1a1a6' : '#7a7a7a',
          secondaryColor: activeTheme === 'dark' ? '#2a2a2c' : '#fafafc',
          tertiaryColor: activeTheme === 'dark' ? '#252527' : '#ffffff',
        },
      } : activeTheme === 'dark' ? {
        themeVariables: {
          darkMode: true,
          background: '#151b26',
          primaryColor: '#d97706',
          primaryTextColor: '#f1f5f9',
          primaryBorderColor: '#232d3d',
          lineColor: '#8e9bb0',
          secondaryColor: '#1c2433',
          tertiaryColor: '#0f141c',
        },
      } : {}),
      fontFamily: 'inherit',
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
        svgTarget.innerHTML = `<pre class="text-xs text-amber-400/90 font-mono text-left w-full p-2 bg-[var(--bg-main)] rounded border border-amber-900/40 overflow-x-auto whitespace-pre-wrap">${code}</pre>`;
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
      const activePalette = isAppleTheme;
      if (mermaidDebounce) clearTimeout(mermaidDebounce);
      mermaidDebounce = setTimeout(() => {
        renderMermaidBlocks(activeTheme, activePalette);
      }, 60);
    }
  });
</script>

<div class="apple-editor flex flex-col h-full w-full bg-[var(--bg-main)]">
  <!-- Top Editor Toolbar (Glassmorphic Bar) -->
  <header class="apple-editor-toolbar h-11 flex items-center justify-between gap-2 px-3 border-b border-[var(--border)] bg-[var(--bg-sidebar)]/80 backdrop-blur-xl select-none shrink-0">
    <!-- Left Formatting Actions -->
    <div class="flex items-center gap-1.5 overflow-x-auto py-0.5">
      <div class="h-7 flex items-center gap-0.5 p-0.5 rounded-md bg-[var(--bg-card)]/70 border border-[var(--border)] shadow-sm">
        <button
          onclick={() => applyFormatting('**', '**')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.bold')}
          aria-label={$t('editor.bold')}
        >
          <Bold size={13} />
        </button>
        <button
          onclick={() => applyFormatting('*', '*')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.italic')}
          aria-label={$t('editor.italic')}
        >
          <Italic size={13} />
        </button>
        <button
          onclick={() => applyFormatting('~~', '~~')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.strikethrough')}
          aria-label={$t('editor.strikethrough')}
        >
          <Strikethrough size={13} />
        </button>
      </div>

      <div class="h-7 flex items-center gap-0.5 p-0.5 rounded-md bg-[var(--bg-card)]/70 border border-[var(--border)] shadow-sm">
        <button
          onclick={() => applyFormatting('# ')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.heading1')}
          aria-label={$t('editor.heading1')}
        >
          <Heading1 size={13} />
        </button>
        <button
          onclick={() => applyFormatting('## ')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.heading2')}
          aria-label={$t('editor.heading2')}
        >
          <Heading2 size={13} />
        </button>
      </div>

      <div class="h-7 flex items-center gap-0.5 p-0.5 rounded-md bg-[var(--bg-card)]/70 border border-[var(--border)] shadow-sm">
        <button
          onclick={() => applyFormatting('- ')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.list')}
          aria-label={$t('editor.list')}
        >
          <List size={13} />
        </button>
        <button
          onclick={() => applyFormatting('- [ ] ')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.checklist')}
          aria-label={$t('editor.checklist')}
        >
          <ListTodo size={13} />
        </button>
        <button
          onclick={() => applyFormatting('`', '`')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.code')}
          aria-label={$t('editor.code')}
        >
          <Code size={13} />
        </button>
        <button
          onclick={() => applyFormatting('> ')}
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('editor.quote')}
          aria-label={$t('editor.quote')}
        >
          <Quote size={13} />
        </button>
      </div>

      {#if !isAppleTheme}
      <button
        onclick={() => onOpenGraph?.()}
        class="h-7 flex items-center gap-1.5 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)]/70 hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition shadow-sm cursor-pointer"
        title={$t('graph.toolbarTitle')}
        aria-label={$t('graph.toolbarTitle')}
      >
        <Network size={13} class="text-[var(--accent)]" />
        <span>{$t('graph.button')}</span>
      </button>
      {/if}
    </div>

    <!-- Right Controls: Save Status, View Mode, Export, AI Chat -->
    <div class="flex shrink-0 items-center gap-1.5 ml-auto">
      <!-- Presence Avatars -->
      {#if remoteUsers.length > 0}
        <div
          class="flex items-center -space-x-1.5 mr-1"
          title={remoteUsers.map((u) => u.name).join(', ')}
        >
          {#each remoteUsers as user (user.deviceId)}
            <span
              class="w-5 h-5 rounded-full border border-[var(--bg-sidebar)] flex items-center justify-center text-[9px] font-extrabold text-black select-none shadow-sm"
              style="background: {user.color}; box-shadow: 0 0 6px {user.color}88"
            >
              {user.name.slice(0, 1).toUpperCase()}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Save Status Pill -->
      <div class="h-7 flex items-center gap-1.5 px-2 rounded-md bg-[var(--bg-card)]/70 border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] shadow-sm">
        {#if saveStatus === 'error'}
          <AlertCircle size={12} class="text-[var(--danger)]" />
          <span class="text-[var(--danger)]">{$t('editor.saveError')}</span>
        {:else}
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--success)] shadow-[0_0_5px_var(--success)]"></span>
          <span>{$t('editor.saved')}</span>
        {/if}
      </div>

      <!-- Segmented View Mode Switcher -->
      {#if !isAppleTheme}<div class="h-7 flex items-center p-0.5 rounded-md bg-[var(--bg-card)]/70 border border-[var(--border)] shadow-sm">
        <button
          onclick={() => onViewModeChange('edit')}
          class="h-6 px-2 text-xs font-medium rounded transition-all duration-150 cursor-pointer {viewMode === 'edit' ? 'bg-[var(--bg-active)] text-[var(--text-main)] font-semibold shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
          title={$t('editor.modeEdit')}
        >
          {$t('editor.modeEdit')}
        </button>
        <button
          onclick={() => onViewModeChange('split')}
          class="h-6 px-2 text-xs font-medium rounded transition-all duration-150 cursor-pointer {viewMode === 'split' ? 'bg-[var(--bg-active)] text-[var(--text-main)] font-semibold shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
          title={$t('editor.modeSplit')}
        >
          {$t('editor.modeSplit')}
        </button>
        <button
          onclick={() => onViewModeChange('preview')}
          class="h-6 px-2 text-xs font-medium rounded transition-all duration-150 cursor-pointer {viewMode === 'preview' ? 'bg-[var(--bg-active)] text-[var(--text-main)] font-semibold shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
          title={$t('editor.modePreview')}
        >
          {$t('editor.modePreview')}
        </button>
      </div>{/if}

      <!-- Document Word / PDF Exports -->
      <DocumentActions content={currentContent} path={notePath} />

      <!-- AI Assistant Toggle Button -->
      {#if onToggleAiChat && !isAppleTheme}
        <button
          onclick={onToggleAiChat}
          class="h-7 flex items-center gap-1.5 px-2.5 rounded-md border text-xs font-medium transition-all duration-150 shadow-sm cursor-pointer {isAiChatOpen ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] font-semibold shadow-[0_0_10px_var(--accent-glow)]' : 'border-[var(--border)] bg-[var(--bg-card)]/70 hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
          title={$t('editor.openAiAssistant')}
        >
          <Sparkles size={13} class={isAiChatOpen ? 'text-[var(--accent)] animate-pulse' : 'text-[var(--accent)]'} />
          <span>{$t('editor.assistant')}</span>
        </button>
      {/if}
    </div>
  </header>

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
  <main class="flex-1 flex min-w-0 min-h-0 overflow-hidden relative">
    <!-- CodeMirror Container -->
    <div
      bind:this={editorContainer}
      class="min-w-0 h-full overflow-hidden transition-all duration-200 {viewMode === 'edit' ? 'w-full' : viewMode === 'split' ? 'w-1/2 border-r border-[var(--border)]' : 'hidden'}"
    ></div>

    <!-- Rendered Markdown Container -->
    {#if viewMode === 'split' || viewMode === 'preview'}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        bind:this={previewContainer}
        role="presentation"
        onclick={handlePreviewClick}
        class="apple-editor-preview min-w-0 h-full overflow-y-auto px-10 py-8 select-text {viewMode === 'preview' ? 'w-full max-w-4xl mx-auto' : 'w-1/2'}"
      >
        <article class="prose max-w-none text-[var(--text-main)]">
          {@html renderMarkdown(currentContent, (src) => localImageUrl(src, vaultId, imageRevision))}
        </article>
      </div>
    {/if}
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
      <span>•</span>
      <span class="inline-flex items-center gap-1.5 text-[var(--accent)] font-semibold font-mono text-[11px]">
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse"></span>
        <span>{$t('editor.p2pRealtime')}</span>
      </span>
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
