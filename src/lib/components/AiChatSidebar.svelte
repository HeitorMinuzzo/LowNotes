<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { renderChatMarkdown } from '../markdown';
  import { connectDraftCollection, groupDraftPaths } from '$lib/draft-paths';
  import { activeConversation, emptyChatHistory, modelConversation, titleFromPrompt } from '$lib/chat-history';
  import DocumentActions from './DocumentActions.svelte';
  import type {
    AiSettings,
    AssistantSkill,
    ChatConversation,
    ChatHistory,
    StoredChatEntry,
    LinkOperation,
  } from '../types';
  import {
    aiChatQuery,
    aiSaveDraft,
    chatHistoryGet,
    chatHistorySave,
    linksApply,
    saveAiSettings,
  } from '../api';
  import { locale, t, trError, ts } from '$lib/i18n';
  import {
    Plus,
    Clock,
    Brain,
    Settings,
    X,
    FileText,
    Globe,
    Link2,
    Check,
    Bot,
    User,
    ChevronDown,
    Search,
    Edit2,
    Trash2
  } from 'lucide-svelte';
  import BorderBeam from './ui/BorderBeam.svelte';

  let {
    isOpen = $bindable(false),
    aiSettings = $bindable<AiSettings>({
      active_provider_id: 'ollama',
      providers: [],
      auto_link_notes: false,
    }),
    currentNotePath = '',
    vaultId,
    onNavigateToSource,
    onNotesCreated,
    onOpenSettings,
  } = $props<{
    isOpen: boolean;
    aiSettings: AiSettings;
    currentNotePath: string;
    vaultId: string;
    onNavigateToSource: (path: string, line: number) => void;
    onNotesCreated: () => Promise<void>;
    onOpenSettings: (tab?: 'ai' | 'providers' | 'web') => void;
  }>();

  let scope = $state<'vault' | 'note'>('vault');
  let skill = $state<AssistantSkill>('auto');
  let inputPrompt = $state('');
  let isLoading = $state(false);
  let loadingConversationId = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let pane = $state<'chat' | 'history' | 'memory'>('chat');
  let historySearch = $state('');
  let memoryDraft = $state('');
  let historyReady = $state(false);
  let archive = $state<ChatHistory>(emptyChatHistory());
  let currentChat = $derived(activeConversation(archive));
  let messages = $derived(currentChat?.messages ?? []);
  let sortedChats = $derived([...archive.conversations].sort((a, b) => b.updatedAt - a.updatedAt));
  let saveChain: Promise<void> = Promise.resolve();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  onMount(() => { void loadHistory(); });
  onDestroy(() => {
    disposed = true;
    if (saveTimer) { clearTimeout(saveTimer); void persistHistory(); }
  });

  let messagesContainer: HTMLDivElement | null = $state(null);

  async function loadHistory() {
    try {
      const saved = await chatHistoryGet(vaultId);
      if (disposed) return;
      archive = saved;
      memoryDraft = saved.memory;
      historyReady = true;
      errorMessage = null;
      void scrollToBottom();
    } catch (error) {
      if (!disposed) errorMessage = trError(String(error));
    }
  }

  function persistHistory(): Promise<void> {
    if (!historyReady) return Promise.resolve();
    const snapshot = $state.snapshot(archive) as ChatHistory;
    saveChain = saveChain.catch(() => {}).then(() => chatHistorySave(vaultId, snapshot));
    return saveChain.catch((error) => {
      if (!disposed) errorMessage = trError(String(error));
    });
  }

  function schedulePersist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = undefined; void persistHistory(); }, 400);
  }

  function ensureChat(prompt: string): ChatConversation {
    const existing = activeConversation(archive);
    if (existing) return existing;
    const now = Date.now();
    const chat: ChatConversation = {
      id: crypto.randomUUID(), title: titleFromPrompt(prompt), createdAt: now,
      updatedAt: now, messages: [],
    };
    archive.conversations.push(chat);
    archive.activeConversationId = chat.id;
    return activeConversation(archive)!;
  }

  function newChat() {
    archive.activeConversationId = null;
    pane = 'chat';
    void persistHistory();
  }

  function openChat(id: string) {
    archive.activeConversationId = id;
    pane = 'chat';
    void persistHistory();
    void scrollToBottom();
  }

  function deleteChat(id: string) {
    if (!confirm(ts('ai.deleteChatConfirm'))) return;
    archive.conversations = archive.conversations.filter((chat) => chat.id !== id);
    if (archive.activeConversationId === id) archive.activeConversationId = null;
    void persistHistory();
  }

  function renameChat(id: string) {
    const chat = archive.conversations.find((item) => item.id === id);
    if (!chat) return;
    const title = prompt(ts('ai.renameChatPrompt'), chat.title)?.trim();
    if (!title || title === chat.title) return;
    chat.title = title.slice(0, 100);
    chat.updatedAt = Date.now();
    void persistHistory();
  }

  async function saveMemory() {
    archive.memory = memoryDraft.trim();
    await persistHistory();
    pane = 'chat';
  }

  function rememberMessage(message: StoredChatEntry) {
    memoryDraft = [archive.memory, message.content].filter(Boolean).join('\n').slice(0, 8000);
    pane = 'memory';
  }

  async function sendMessage(textToSend?: string, selectedSkill?: AssistantSkill) {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isLoading || !historyReady) return;
    if (selectedSkill) skill = selectedSkill;
    const scopePath = scope === 'note' && currentNotePath ? currentNotePath : undefined;
    inputPrompt = '';
    errorMessage = null;

    const time = new Date().toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' });
    const chat = ensureChat(text);
    chat.messages.push({
      role: 'user',
      content: text,
      timestamp: time,
    });
    chat.updatedAt = Date.now();
    isLoading = true;
    loadingConversationId = chat.id;
    await persistHistory();
    await scrollToBottom();

    try {
      const history = modelConversation(chat.messages.slice(0, -1));

      const resp = await aiChatQuery(text, scopePath, history, skill);
      let content = resp.answer;
      let appliedLinks = 0;
      const warnings = [...resp.warnings];
      const fenceMatch = content.match(/```lownotes-links\s*\n([\s\S]*?)```/);
      if (fenceMatch && skill !== 'notes' && skill !== 'research') {
        try {
          const payload = JSON.parse(fenceMatch[1]) as {
            add?: Array<{ source?: unknown; target?: unknown }>;
            remove?: Array<{ source?: unknown; target?: unknown }>;
          };
          const ops: LinkOperation[] = [];
          const groups: Array<['add' | 'remove', Array<{ source?: unknown; target?: unknown }> | undefined]> = [
            ['add', payload?.add],
            ['remove', payload?.remove],
          ];
          for (const [action, entries] of groups) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
              if (entry && typeof entry.source === 'string' && typeof entry.target === 'string') {
                ops.push({ source: entry.source, target: entry.target, action });
              }
            }
          }
          content = content.replace(fenceMatch[0], '').trim();
          if (ops.length > 0) {
            if (disposed || resp.vault_id !== vaultId) warnings.push('ai.vaultChanged');
            else {
              await linksApply(ops, 'agent');
              appliedLinks = ops.length;
            }
          }
        } catch (e) {
          console.error('Failed to apply AI link operations:', e);
          content = resp.answer;
          appliedLinks = 0;
        }
      }

      chat.messages.push({
        role: 'assistant',
        content,
        sources: resp.sources,
        webSources: resp.web_sources,
        drafts: connectDraftCollection(groupDraftPaths(text, resp.drafts)),
        warnings,
        vaultId: resp.vault_id,
        appliedLinks,
        timestamp: new Date().toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' }),
      });
      chat.updatedAt = Date.now();
    } catch (err: any) {
      const rawError = typeof err === 'string' ? err : err.message || 'ai.errorQuery';
      const msg = trError(rawError);
      chat.messages.push({
        role: 'assistant',
        content: ts('ai.errorMessage', { message: msg }),
        isError: true,
        errorSettingsTab: rawError.startsWith('ai.web') ? 'web' : 'providers',
        timestamp: new Date().toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' }),
      });
      chat.updatedAt = Date.now();
    } finally {
      isLoading = false;
      loadingConversationId = null;
      await persistHistory();
      if (!disposed) await scrollToBottom();
    }
  }

  async function saveDraft(msg: StoredChatEntry, draft: NonNullable<StoredChatEntry['drafts']>[number]) {
    if (!msg.vaultId || draft.savedPath || draft.saving) return;
    draft.saving = true;
    draft.error = undefined;
    try {
      draft.savedPath = await aiSaveDraft(msg.vaultId, { path: draft.path, content: draft.content });
    } catch (err) {
      draft.error = trError(String(err));
    } finally {
      draft.saving = false;
    }
    await persistHistory();
    if (draft.savedPath && !disposed) {
      try { await onNotesCreated(); } catch (err) { errorMessage = trError(String(err)); }
    }
  }

  async function saveAllDrafts(msg: StoredChatEntry) {
    for (const draft of msg.drafts || []) {
      if (disposed) break;
      await saveDraft(msg, draft);
    }
  }

  async function scrollToBottom() {
    await tick();
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  function interceptLinks(node: HTMLElement) {
    node.addEventListener('click', handleMessageLinkClick);
    return {
      destroy() {
        node.removeEventListener('click', handleMessageLinkClick);
      },
    };
  }

  function handleMessageLinkClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest('a');
    if (link && link.href) {
      const href = link.getAttribute('href') || '';
      e.preventDefault();
      if (/^https?:\/\//i.test(href)) {
        void openUrl(href).catch((err) => { errorMessage = String(err); });
        return;
      }
      if (href.startsWith('lownotes://open')) {
        e.preventDefault();
        try {
          const url = new URL(href);
          const path = url.searchParams.get('path');
          const line = parseInt(url.searchParams.get('line') || '1', 10);
          if (path) {
            onNavigateToSource(path, line);
          }
        } catch {
          // Manual fallback parser if URL constructor fails
          const match = href.match(/path=([^&]+)(?:&line=(\d+))?/);
          if (match) {
            onNavigateToSource(decodeURIComponent(match[1]), parseInt(match[2] || '1', 10));
          }
        }
      }
    }
  }
</script>

{#if isOpen}
  <aside
    class="apple-ai-sidebar w-100 h-full flex flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)] z-30 select-none shadow-2xl relative transition-all"
  >
    <!-- Top Header -->
    <header class="app-topbar h-11 shrink-0 flex items-center justify-between gap-2 px-4 border-b border-[var(--border)] bg-[var(--bg-card)]/90 backdrop-blur-xl min-w-0">
      <div class="flex flex-col min-w-0">
        <h3 class="text-xs font-bold text-[var(--text-main)] truncate tracking-tight">{$t('ai.title')}</h3>
        <span class="text-[10px] text-[var(--text-dim)] truncate">Local RAG & Assistente</span>
      </div>

      <!-- Action Icons Toolbar -->
      <div class="flex items-center gap-1 shrink-0">
        <button onclick={newChat} disabled={!historyReady}
          class="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-main)] disabled:opacity-40 transition cursor-pointer"
          title={$t('ai.newChat')} aria-label={$t('ai.newChat')}>
          <Plus size={14} />
        </button>
        <button onclick={() => (pane = pane === 'history' ? 'chat' : 'history')} disabled={!historyReady}
          class="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] {pane === 'history' ? 'bg-[var(--bg-hover)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text-main)]'} disabled:opacity-40 transition cursor-pointer"
          title={$t('ai.history')} aria-label={$t('ai.history')}>
          <Clock size={14} />
        </button>
        <button onclick={() => { memoryDraft = archive.memory; pane = pane === 'memory' ? 'chat' : 'memory'; }} disabled={!historyReady}
          class="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] {archive.memory || pane === 'memory' ? 'bg-[var(--bg-hover)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text-main)]'} disabled:opacity-40 transition cursor-pointer"
          title={$t('ai.memory')} aria-label={$t('ai.memory')}>
          <Brain size={14} />
        </button>
        <button
          onclick={() => onOpenSettings(skill === 'research' ? 'web' : 'ai')}
          class="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('ai.settings')} aria-label={$t('ai.settings')}
        >
          <Settings size={14} />
        </button>
        <button
          onclick={() => (isOpen = false)}
          class="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-main)] transition cursor-pointer"
          title={$t('ai.close')} aria-label={$t('ai.close')}
        >
          <X size={14} />
        </button>
      </div>
    </header>

    <!-- Provider and Scope Bar -->
    <div class="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-sidebar)]/90 backdrop-blur-md flex flex-col gap-2 min-w-0">
      <!-- Provider Selector -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-semibold text-[var(--text-dim)]">Modelo / Provedor:</span>
        <select
          value={aiSettings.active_provider_id}
          onchange={async (e) => {
            const newId = e.currentTarget.value;
            const previous = aiSettings.active_provider_id;
            aiSettings.active_provider_id = newId;
            try { await saveAiSettings(aiSettings); } catch (reason) { aiSettings.active_provider_id = previous; errorMessage = trError(String(reason)); }
          }}
          class="h-7 bg-[var(--bg-card)] border border-[var(--border)] rounded-md px-2 text-xs font-semibold text-[var(--accent)] focus:outline-none focus:border-[var(--accent)] cursor-pointer hover:border-[var(--accent)]/50 transition shadow-sm max-w-[190px] truncate"
        >
          {#each aiSettings.providers as prov}
            <option value={prov.id} selected={aiSettings.active_provider_id === prov.id}>
              {prov.name}
            </option>
          {/each}
        </select>
      </div>

      <!-- Scope & Skill Selector -->
      <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--border)]/50">
        <!-- Scope Switcher -->
        <div class="h-7 flex items-center p-0.5 rounded-md bg-[var(--bg-card)] border border-[var(--border)] shadow-sm shrink-0">
          <button
            onclick={() => (scope = 'vault')}
            class="h-6 px-2.5 rounded text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer {scope === 'vault' ? 'bg-[var(--bg-active)] text-[var(--text-main)] font-semibold shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
          >
            {$t('ai.scopeVault')}
          </button>
          <button
            onclick={() => (scope = 'note')}
            disabled={!currentNotePath}
            class="h-6 px-2.5 rounded text-[11px] font-medium whitespace-nowrap transition-all disabled:opacity-40 cursor-pointer {scope === 'note' ? 'bg-[var(--bg-active)] text-[var(--text-main)] font-semibold shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
            title={currentNotePath ? currentNotePath : $t('ai.scopeNoteHint')}
          >
            {$t('ai.scopeNote')}
          </button>
        </div>

        <!-- Skill Select -->
        <select bind:value={skill} disabled={isLoading}
          class="h-7 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-[11px] font-medium text-[var(--text-main)] focus:outline-none shadow-sm cursor-pointer truncate max-w-[170px]">
          <option value="auto">{$t('ai.skillAuto')}</option>
          <option value="notes">{$t('ai.skillNotes')}</option>
          <option value="write">{$t('ai.skillWrite')}</option>
          <option value="research">{$t('ai.skillResearch')}</option>
        </select>
      </div>
    </div>

    {#if errorMessage}
      <div role="alert" class="px-4 py-2 text-xs text-[var(--danger)] bg-[var(--danger)]/10 border-b border-[var(--danger)]/30 font-medium">{errorMessage}</div>
    {/if}

    {#if pane === 'history'}
      <div class="flex-1 min-h-0 flex flex-col p-4 gap-3">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-bold text-[var(--text-main)]">{$t('ai.history')}</h4>
          <button onclick={() => (pane = 'chat')} class="text-xs text-[var(--accent)] font-semibold hover:underline">{$t('ai.backToChat')}</button>
        </div>
        <p class="text-[11px] text-[var(--text-dim)]">{$t('ai.historyLocalHint')}</p>
        <div class="relative">
          <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <input bind:value={historySearch} placeholder={$t('ai.searchHistory')}
            class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[var(--text-main)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)]" />
        </div>
        <div class="flex-1 overflow-y-auto flex flex-col gap-2">
          {#each sortedChats.filter((chat) => {
            const query = historySearch.trim().toLocaleLowerCase();
            return !query || chat.title.toLocaleLowerCase().includes(query)
              || chat.messages.some((message) => message.content.toLocaleLowerCase().includes(query));
          }) as chat (chat.id)}
            {@const isActiveChat = archive.activeConversationId === chat.id}
            <div class="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)]/40 transition-all shadow-sm">
              <button onclick={() => openChat(chat.id)}
                class="flex-1 min-w-0 px-3 py-2 text-left">
                <span class="block text-xs font-semibold truncate {isActiveChat ? 'text-[var(--accent)]' : 'text-[var(--text-main)]'}">{chat.title}</span>
                <span class="block text-[10px] text-[var(--text-dim)] mt-0.5">{new Date(chat.updatedAt).toLocaleDateString($locale)} · {chat.messages.length} {$t('ai.messages')}</span>
              </button>
              <button onclick={() => renameChat(chat.id)} title={$t('ai.renameChat')} aria-label={$t('ai.renameChat')}
                class="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-main)]">
                <Edit2 size={12} />
              </button>
              <button onclick={() => deleteChat(chat.id)} title={$t('ai.deleteChat')} aria-label={$t('ai.deleteChat')}
                class="p-1.5 mr-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--danger)]">
                <Trash2 size={12} />
              </button>
            </div>
          {:else}
            <p class="text-xs text-[var(--text-dim)] text-center py-12">{$t('ai.noHistory')}</p>
          {/each}
        </div>
      </div>
    {:else if pane === 'memory'}
      <div class="flex-1 min-h-0 flex flex-col p-4 gap-3">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-bold text-[var(--text-main)]">{$t('ai.memory')}</h4>
          <button onclick={() => (pane = 'chat')} class="text-xs text-[var(--accent)] font-semibold hover:underline">{$t('ai.backToChat')}</button>
        </div>
        <p class="text-xs leading-relaxed text-[var(--text-muted)]">{$t('ai.memoryHelp')}</p>
        <textarea bind:value={memoryDraft} maxlength="8000"
          placeholder="Ex: Prefiro notas em formato de tópicos sucintos..."
          class="flex-1 min-h-40 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-3 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] shadow-inner"></textarea>
        <button onclick={saveMemory} class="self-end px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-bold shadow-md hover:opacity-90 transition">{$t('ai.saveMemory')}</button>
      </div>
    {:else}
    <!-- Chat Messages Container -->
    <div
      bind:this={messagesContainer}
      use:interceptLinks
      class="flex-1 overflow-y-auto p-4 flex flex-col gap-4 select-text"
    >
      {#if !historyReady}
        <div class="my-auto text-center text-xs text-[var(--text-dim)]">
          <p>{$t('ai.historyLoading')}</p>
          {#if errorMessage}<button onclick={loadHistory} class="mt-2 text-[var(--accent)] underline">{$t('ai.retryHistory')}</button>{/if}
        </div>
      {:else if messages.length === 0}
        <div class="flex flex-col items-center justify-center my-auto py-8 text-center text-[var(--text-dim)] select-none">
          <h4 class="text-sm font-bold text-[var(--text-main)] mb-1">{$t('ai.emptyTitle')}</h4>
          <p class="text-xs text-[var(--text-muted)] max-w-[280px] leading-relaxed mb-5">
            {$t('ai.emptySubtitle')}
          </p>

          <div class="flex flex-col gap-2 w-full max-w-[320px]">
            <button
              onclick={() => sendMessage(ts('ai.suggestionCreate'), 'write')}
              class="p-2.5 text-xs text-left rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all shadow-sm cursor-pointer"
            >
              {$t('ai.suggestionCreate')}
            </button>
            <button
              onclick={() => sendMessage(ts('ai.suggestionSummary'))}
              class="p-2.5 text-xs text-left rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all shadow-sm cursor-pointer"
            >
              {$t('ai.suggestionSummary')}
            </button>
            <button
              onclick={() => sendMessage(ts('ai.suggestionResearch'), 'research')}
              class="p-2.5 text-xs text-left rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all shadow-sm cursor-pointer"
            >
              {$t('ai.suggestionResearch')}
            </button>
          </div>
        </div>
      {:else}
        {#each messages as msg}
          <div class="flex flex-col gap-1.5 {msg.role === 'user' ? 'items-end' : 'items-start'}">
            <div class="flex items-center gap-1.5 text-[10px] text-[var(--text-dim)] px-1 select-none">
              <span class="font-semibold">{msg.role === 'user' ? $t('ai.you') : $t('ai.assistantRole')}</span>
              <span>•</span>
              <span>{msg.timestamp}</span>
              {#if msg.role === 'user'}
                <button onclick={() => rememberMessage(msg)} title={$t('ai.rememberMessage')}
                  aria-label={$t('ai.rememberMessage')} class="ml-1 hover:text-[var(--accent)] text-[10px] font-medium text-[var(--text-dim)] cursor-pointer">Lembrar</button>
              {/if}
            </div>

            <div
              class="max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed {msg.role === 'user' ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--text-main)] shadow-sm' : 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-main)] shadow-md'}"
            >
              {#if msg.role === 'assistant'}
                <div class="prose max-w-none text-xs leading-relaxed">
                  {@html renderChatMarkdown(trError(msg.content))}
                </div>
                {#if msg.isError}
                  <button class="mt-3 text-xs font-bold text-[var(--danger)] hover:underline block" onclick={() => onOpenSettings(msg.errorSettingsTab || 'providers')}>{msg.errorSettingsTab === 'web' ? $t('settings.webSearch') : $t('settings.providers')}</button>
                {/if}

                {#each msg.warnings || [] as warning}
                  <p role="status" class="mt-2 text-xs text-[var(--accent)] font-medium">{trError(warning)}</p>
                {/each}

                {#if !msg.drafts?.length && !msg.isError && msg.content.trim()}
                  <div class="mt-3 pt-2 border-t border-[var(--border)]/60 flex flex-wrap items-center gap-2">
                    <button onclick={() => { msg.drafts = [{ path: `${ts('ai.responseDocumentName')}.md`, content: msg.content }]; void persistHistory(); }}
                      class="h-7 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-main)] text-xs font-medium text-[var(--accent)] hover:bg-[var(--bg-hover)] shadow-sm cursor-pointer">
                      {$t('ai.responseToNote')}
                    </button>
                    <DocumentActions content={msg.content} path={`${ts('ai.responseDocumentName')}.md`} />
                  </div>
                {/if}

                {#if msg.drafts?.length}
                  <div class="mt-3 flex flex-col gap-3">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-[11px] font-bold text-[var(--text-main)]">{$t('ai.drafts', { count: msg.drafts.length })}</span>
                      {#if msg.drafts.length > 1 && msg.drafts.some((d) => !d.savedPath)}
                        <button onclick={() => saveAllDrafts(msg)} disabled={msg.drafts.some((d) => d.saving)}
                          class="text-[11px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-40">{$t('ai.saveAll')}</button>
                      {/if}
                    </div>
                    {#each msg.drafts as draft}
                      <div class="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-3 flex flex-col gap-2 shadow-sm">
                        <input aria-label={$t('ai.draftPath')} bind:value={draft.path} oninput={schedulePersist} onchange={() => void persistHistory()} disabled={!!draft.savedPath || draft.saving}
                          class="w-full bg-[var(--bg-card)] text-[var(--text-main)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-xs font-mono disabled:opacity-70 focus:outline-none focus:border-[var(--accent)]" />
                        <details class="group">
                          <summary class="cursor-pointer text-[11px] text-[var(--text-muted)] font-medium hover:text-[var(--text-main)]">{$t('ai.previewDraft')}</summary>
                          <div class="prose text-xs max-h-72 overflow-auto py-2">{@html renderChatMarkdown(draft.content)}</div>
                          <textarea aria-label={$t('ai.editDraft')} bind:value={draft.content} oninput={schedulePersist} onchange={() => void persistHistory()} rows="8" disabled={!!draft.savedPath || draft.saving}
                            class="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-2 font-mono text-[11px] disabled:opacity-60 focus:outline-none"></textarea>
                        </details>
                        <div class="flex flex-wrap items-center gap-2">
                          {#if draft.savedPath}
                            <button onclick={() => onNavigateToSource(draft.savedPath!, 1)}
                              class="text-[11px] text-[var(--success)] font-semibold hover:underline">✓ {$t('ai.openSavedNote')}</button>
                          {:else}
                            <button onclick={() => saveDraft(msg, draft)} disabled={draft.saving || !draft.content.trim()}
                              class="px-3 py-1 rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] font-bold text-[11px] shadow-sm disabled:opacity-40">
                              {draft.saving ? $t('editor.saving') : $t('ai.saveDraft')}
                            </button>
                          {/if}
                          <DocumentActions content={draft.content} path={draft.path} />
                        </div>
                        {#if draft.error}<p role="alert" class="text-[11px] text-[var(--danger)]">{draft.error}</p>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}

                {#if msg.webSources?.length}
                  <div class="mt-3 pt-2.5 border-t border-[var(--border)] flex flex-col gap-1.5">
                    <span class="text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-wider flex items-center gap-1">
                      <Globe size={11} />
                      {$t('ai.webSources')}
                    </span>
                    <div class="flex flex-col gap-1">
                      {#each msg.webSources as source}
                        <a href={source.url} title={source.description} class="text-[11px] text-[var(--accent)] hover:underline truncate block">
                          {source.title}
                        </a>
                      {/each}
                    </div>
                  </div>
                {/if}

                {#if msg.appliedLinks && msg.appliedLinks > 0}
                  <div class="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-[var(--border)] text-[11px] text-[var(--accent)] font-semibold select-none">
                    <Link2 size={12} />
                    <span>{$t('ai.linksApplied', { count: msg.appliedLinks })}</span>
                  </div>
                {/if}

                <!-- Sources Chips -->
                {#if msg.sources && msg.sources.length > 0}
                  <div class="mt-3 pt-2.5 border-t border-[var(--border)] flex flex-col gap-1.5 select-none">
                    <span class="text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-wider flex items-center gap-1">
                      <FileText size={11} />
                      {$t('ai.sources')}
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      {#each msg.sources as src}
                        <button
                          onclick={() => onNavigateToSource(src.note_path, src.line_number)}
                          class="px-2.5 py-1 rounded-lg bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[11px] text-[var(--accent)] font-medium flex items-center gap-1.5 transition shadow-sm"
                          title="{src.content.slice(0, 100)}..."
                        >
                          <span class="truncate max-w-[130px]">{src.note_title}</span>
                          <span class="text-[10px] font-mono text-[var(--text-dim)]">:L{src.line_number}</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              {:else}
                <div class="whitespace-pre-wrap">{msg.content}</div>
              {/if}
            </div>
          </div>
        {/each}

        {#if isLoading && loadingConversationId === currentChat?.id}
          <div class="flex items-center gap-2.5 text-xs text-[var(--text-dim)] px-2 py-1">
            <span class="w-2 h-2 rounded-full bg-[var(--accent)] animate-ping"></span>
            <span class="font-medium text-[var(--text-muted)] animate-pulse">{$t('ai.thinking')}</span>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Chat Input Footer -->
    <footer class="p-3 border-t border-[var(--border)] bg-[var(--bg-card)]/90 backdrop-blur-xl">
      <form
        onsubmit={(e) => { e.preventDefault(); sendMessage(); }}
        class="flex flex-col gap-2"
      >
        <div class="relative">
          <textarea
            bind:value={inputPrompt}
            onkeydown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={$t('ai.inputPlaceholder')}
            rows="2"
            class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text-main)] placeholder-[var(--text-dim)] resize-none focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-glow)] select-text shadow-inner transition-all"
          ></textarea>
        </div>

        <div class="flex items-center justify-between text-[11px] text-[var(--text-dim)]">
          <span class="text-[10px]">{$t('ai.shiftEnterHint')}</span>
          <button
            type="submit"
            disabled={isLoading || !historyReady || !inputPrompt.trim()}
            class="h-7 px-3.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-[var(--accent-contrast)] text-xs font-semibold rounded-md transition shadow-sm flex items-center justify-center cursor-pointer"
          >
            {$t('ai.send')}
          </button>
        </div>
      </form>
    </footer>
    {/if}
  </aside>
{/if}
