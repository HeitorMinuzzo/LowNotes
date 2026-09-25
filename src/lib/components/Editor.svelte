<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { EditorState } from '@codemirror/state';
  import * as Y from 'yjs';
  import { yCollab } from 'y-codemirror.next';
  import { marked } from 'marked';
  import mermaid from 'mermaid';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { crdtApplyClientUpdate, saveNote } from '../api';

  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
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
    fontFamily: 'inherit',
    securityLevel: 'loose',
  });

  marked.use({
    renderer: {
      code(token: { text: string; lang?: string }) {
        if (token.lang === 'mermaid') {
          const encoded = encodeURIComponent(token.text);
          return `<div class="mermaid-block my-4 p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-x-auto flex flex-col items-center justify-center transition-all" data-mermaid="${encoded}"><div class="mermaid-svg flex justify-center w-full"></div></div>`;
        }
        return false;
      },
    },
  });

  let {
    notePath,
    initialContent,
    crdtUpdateBase64,
    targetLine,
    isAiChatOpen = false,
    onToggleAiChat,
    onContentChange,
  } = $props<{
    notePath: string;
    initialContent: string;
    crdtUpdateBase64?: string;
    targetLine?: number;
    isAiChatOpen?: boolean;
    onToggleAiChat?: () => void;
    onContentChange?: (path: string, newContent: string) => void;
  }>();

  let editorContainer: HTMLDivElement | null = $state(null);
  let previewContainer: HTMLDivElement | null = $state(null);
  let viewMode = $state<'edit' | 'split' | 'preview'>('edit');
  let saveStatus = $state<'saved' | 'saving'>('saved');
  let currentContent = $state('');
  let wordCount = $derived(
    currentContent.trim() ? currentContent.trim().split(/\s+/).length : 0
  );
  let charCount = $derived(currentContent.length);

  let editorView: EditorView | null = null;
  let yDoc: Y.Doc | null = null;
  let unlistenCrdt: UnlistenFn | null = null;
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let mermaidCounter = 0;
  let mermaidDebounce: ReturnType<typeof setTimeout> | null = null;

  async function renderMermaidBlocks() {
    if (!previewContainer) return;
    const blocks = previewContainer.querySelectorAll<HTMLDivElement>('.mermaid-block');
    if (blocks.length === 0) return;

    for (const block of blocks) {
      const raw = block.getAttribute('data-mermaid');
      if (!raw) continue;
      const code = decodeURIComponent(raw).trim();
      const svgTarget = block.querySelector<HTMLDivElement>('.mermaid-svg');
      if (!svgTarget) continue;

      const id = `mermaid-${Date.now()}-${mermaidCounter++}`;
      try {
        const { svg } = await mermaid.render(id, code);
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

  function initEditor() {
    if (!editorContainer) return;

    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
    if (yDoc) {
      yDoc.destroy();
      yDoc = null;
    }

    yDoc = new Y.Doc();
    if (crdtUpdateBase64 && crdtUpdateBase64.trim().length > 0) {
      try {
        const update = base64ToUint8Array(crdtUpdateBase64);
        Y.applyUpdate(yDoc, update, 'init');
      } catch (e) {
        console.error('Falha ao aplicar update CRDT inicial:', e);
      }
    }

    const yText = yDoc.getText('content');
    if (yText.length === 0 && initialContent.length > 0) {
      yText.insert(0, initialContent);
    }

    currentContent = yText.toString();

    // Listen to Yjs local edits to broadcast and autosave
    yDoc.on('update', (update: Uint8Array, origin: any) => {
      const text = yText.toString();
      currentContent = text;
      onContentChange?.(notePath, text);

      if (origin !== 'remote') {
        const base64 = uint8ArrayToBase64(update);
        crdtApplyClientUpdate(notePath, base64).catch(console.error);

        // Debounced save
        saveStatus = 'saving';
        if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
          saveNote(notePath, text).then(() => {
            saveStatus = 'saved';
          }).catch((err) => {
            console.error('Erro ao salvar nota:', err);
            saveStatus = 'saved';
          });
        }, 500);
      }
    });

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        basicSetup,
        markdown(),
        yCollab(yText, null),
        EditorView.theme({
          '&': { height: '100%', outline: 'none' },
          '.cm-scroller': { overflow: 'auto' },
        }),
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
      console.error('Falha ao navegar para linha:', e);
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
    const replacement = `${prefix}${selectedText || 'texto'}${suffix}`;

    editorView.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + prefix.length, head: from + replacement.length - suffix.length },
    });
    editorView.focus();
  }

  onMount(async () => {
    initEditor();

    unlistenCrdt = await listen<{ note_path: string; update: number[] }>(
      'p2p:crdt-update',
      (event) => {
        if (event.payload.note_path === notePath && yDoc) {
          const update = new Uint8Array(event.payload.update);
          Y.applyUpdate(yDoc, update, 'remote');
        }
      }
    );
  });

  onDestroy(() => {
    if (editorView) editorView.destroy();
    if (yDoc) yDoc.destroy();
    if (unlistenCrdt) unlistenCrdt();
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    if (mermaidDebounce) clearTimeout(mermaidDebounce);
  });
  $effect(() => {
    // Re-initialize if notePath changes
    if (notePath) {
      initEditor();
    }
  });

  $effect(() => {
    if ((viewMode === 'split' || viewMode === 'preview') && previewContainer && currentContent) {
      if (mermaidDebounce) clearTimeout(mermaidDebounce);
      mermaidDebounce = setTimeout(() => {
        renderMermaidBlocks();
      }, 60);
    }
  });
</script>

<div class="flex flex-col h-full w-full bg-[var(--bg-main)]">
  <!-- Top Editor Toolbar -->
  <header class="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-sidebar)] select-none">
    <div class="flex items-center gap-1">
      <button
        onclick={() => applyFormatting('**', '**')}
        class="px-2 py-1 text-xs font-bold rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Negrito (Ctrl+B)"
      >
        B
      </button>
      <button
        onclick={() => applyFormatting('*', '*')}
        class="px-2 py-1 text-xs italic rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Itálico (Ctrl+I)"
      >
        I
      </button>
      <button
        onclick={() => applyFormatting('~~', '~~')}
        class="px-2 py-1 text-xs line-through rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Riscado"
      >
        S
      </button>
      <span class="w-[1px] h-4 bg-[var(--border)] mx-1"></span>
      <button
        onclick={() => applyFormatting('# ')}
        class="px-2 py-1 text-xs font-semibold rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Título H1"
      >
        H1
      </button>
      <button
        onclick={() => applyFormatting('## ')}
        class="px-2 py-1 text-xs font-semibold rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Título H2"
      >
        H2
      </button>
      <button
        onclick={() => applyFormatting('- ')}
        class="px-2 py-1 text-xs rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Lista"
      >
        • Lista
      </button>
      <button
        onclick={() => applyFormatting('- [ ] ')}
        class="px-2 py-1 text-xs rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Checklist"
      >
        ☑ Tarefa
      </button>
      <button
        onclick={() => applyFormatting('`', '`')}
        class="px-2 py-1 text-xs font-mono rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Código"
      >
        &lt;/&gt;
      </button>
      <button
        onclick={() => applyFormatting('> ')}
        class="px-2 py-1 text-xs rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
        title="Citação"
      >
        ” Citação
      </button>
    </div>

    <!-- Mode Selector & Status -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
        {#if saveStatus === 'saving'}
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse"></span>
          <span>Salvando...</span>
        {:else}
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--success)]"></span>
          <span>Salvo</span>
        {/if}
      </div>

      <div class="flex items-center bg-[var(--bg-card)] p-0.5 rounded-md border border-[var(--border)]">
        <button
          onclick={() => (viewMode = 'edit')}
          class="px-2.5 py-1 text-xs rounded transition {viewMode === 'edit' ? 'bg-[var(--bg-active)] text-[var(--accent-light)] font-medium shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          Editor
        </button>
        <button
          onclick={() => (viewMode = 'split')}
          class="px-2.5 py-1 text-xs rounded transition {viewMode === 'split' ? 'bg-[var(--bg-active)] text-[var(--accent-light)] font-medium shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          Dividido
        </button>
        <button
          onclick={() => (viewMode = 'preview')}
          class="px-2.5 py-1 text-xs rounded transition {viewMode === 'preview' ? 'bg-[var(--bg-active)] text-[var(--accent-light)] font-medium shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          Visualizar
        </button>
      </div>

      {#if onToggleAiChat}
        <button
          onclick={onToggleAiChat}
          class="px-2.5 py-1 text-xs rounded transition flex items-center gap-1.5 border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-light)] {isAiChatOpen ? 'border-[var(--accent)] text-[var(--accent-light)] font-medium shadow-sm bg-[var(--bg-active)]' : ''}"
          title="Abrir Assistente de IA (Chat & RAG)"
        >
          <span>💬</span>
          <span class="font-medium">Assistente</span>
        </button>
      {/if}
    </div>
  </header>

  <!-- Editor & Preview Body -->
  <main class="flex-1 flex overflow-hidden relative">
    <!-- CodeMirror Container -->
    <div
      bind:this={editorContainer}
      class="h-full overflow-hidden transition-all duration-150 {viewMode === 'edit' ? 'w-full' : viewMode === 'split' ? 'w-1/2 border-r border-[var(--border)]' : 'hidden'}"
    ></div>

    <!-- Rendered Markdown Container -->
    {#if viewMode === 'split' || viewMode === 'preview'}
      <div
        bind:this={previewContainer}
        class="h-full overflow-y-auto px-8 py-6 select-text {viewMode === 'preview' ? 'w-full max-w-4xl mx-auto' : 'w-1/2'}"
      >
        <article class="prose prose-invert max-w-none text-[var(--text-main)]">
          <!-- Rendered HTML from marked -->
          {@html marked.parse(currentContent)}
        </article>
      </div>
    {/if}
  </main>

  <!-- Status Bar Footer -->
  <footer class="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border)] bg-[var(--bg-sidebar)] text-xs text-[var(--text-dim)] select-none">
    <div class="flex items-center gap-3">
      <span>{notePath}</span>
    </div>
    <div class="flex items-center gap-4">
      <span>{wordCount} palavras</span>
      <span>{charCount} caracteres</span>
      <span class="text-[var(--accent-light)] font-mono">P2P Realtime Ativo</span>
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
</style>
