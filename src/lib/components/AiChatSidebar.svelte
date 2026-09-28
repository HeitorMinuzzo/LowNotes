<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { renderChatMarkdown } from '../markdown';
  import { connectDraftCollection, groupDraftPaths } from '$lib/draft-paths';
  import DocumentActions from './DocumentActions.svelte';
  import type {
    AiSettings,
    AssistantSkill,
    NoteDraft,
    WebSource,
    ChatMessage,
    LinkOperation,
    RagChunk,
  } from '../types';
  import {
    aiChatQuery,
    aiSaveDraft,
    linksApply,
    saveAiSettings,
  } from '../api';
  import { locale, t, trError, ts } from '$lib/i18n';

  let {
    isOpen = $bindable(false),
    aiSettings = $bindable<AiSettings>({
      active_provider_id: 'ollama',
      providers: [],
      auto_link_notes: false,
    }),
    currentNotePath = '',
    onNavigateToSource,
    onNotesCreated,
    onOpenSettings,
  } = $props<{
    isOpen: boolean;
    aiSettings: AiSettings;
    currentNotePath: string;
    onNavigateToSource: (path: string, line: number) => void;
    onNotesCreated: () => Promise<void>;
    onOpenSettings: (tab?: 'ai' | 'providers' | 'web') => void;
  }>();

  let scope = $state<'vault' | 'note'>('vault');
  let skill = $state<AssistantSkill>('auto');
  let inputPrompt = $state('');
  let isLoading = $state(false);
  let errorMessage = $state<string | null>(null);
  let disposed = false;
  onDestroy(() => { disposed = true; });

  interface DraftItem extends NoteDraft {
    savedPath?: string;
    saving?: boolean;
    error?: string;
  }

  interface MessageItem extends ChatMessage {
    sources?: RagChunk[];
    timestamp: string;
    appliedLinks?: number;
    webSources?: WebSource[];
    drafts?: DraftItem[];
    warnings?: string[];
    vaultId?: string;
    isError?: boolean;
    errorSettingsTab?: 'web' | 'providers';
  }

  let messages = $state<MessageItem[]>([]);
  let messagesContainer: HTMLDivElement | null = $state(null);

  async function sendMessage(textToSend?: string, selectedSkill?: AssistantSkill) {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isLoading) return;
    if (selectedSkill) skill = selectedSkill;
    inputPrompt = '';
    errorMessage = null;

    const time = new Date().toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' });
    messages.push({
      role: 'user',
      content: text,
      timestamp: time,
    });

    isLoading = true;
    await scrollToBottom();

    try {
      const history = messages
        .slice(0, -1).filter((m) => !m.isError).slice(-8)
        .map((m) => ({ role: m.role, content: m.content + (m.drafts?.length
          ? '\n' + JSON.stringify({ notes: m.drafts.map((d) => ({ path: d.savedPath || d.path, content: d.content, saved: !!d.savedPath })) })
          : '') }));

      const scopePath = scope === 'note' && currentNotePath ? currentNotePath : undefined;
      const resp = await aiChatQuery(text, scopePath, history, skill);
      if (disposed) return;

      let content = resp.answer;
      let appliedLinks = 0;
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
            await linksApply(ops, 'agent');
            appliedLinks = ops.length;
          }
        } catch (e) {
          console.error('Failed to apply AI link operations:', e);
          content = resp.answer;
          appliedLinks = 0;
        }
      }

      messages.push({
        role: 'assistant',
        content,
        sources: resp.sources,
        webSources: resp.web_sources,
        drafts: connectDraftCollection(groupDraftPaths(text, resp.drafts)),
        warnings: resp.warnings,
        vaultId: resp.vault_id,
        appliedLinks,
        timestamp: new Date().toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err: any) {
      if (disposed) return;
      const rawError = typeof err === 'string' ? err : err.message || 'ai.errorQuery';
      const msg = trError(rawError);
      messages.push({
        role: 'assistant',
        content: ts('ai.errorMessage', { message: msg }),
        isError: true,
        errorSettingsTab: rawError.startsWith('ai.web') ? 'web' : 'providers',
        timestamp: new Date().toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' }),
      });
    } finally {
      isLoading = false;
      await scrollToBottom();
    }
  }

  async function saveDraft(msg: MessageItem, draft: DraftItem) {
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
    if (draft.savedPath && !disposed) {
      try { await onNotesCreated(); } catch (err) { errorMessage = trError(String(err)); }
    }
  }

  async function saveAllDrafts(msg: MessageItem) {
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
    class="w-96 h-full flex flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)] z-30 select-none shadow-2xl relative transition-all"
  >
    <!-- Top Header -->
    <header class="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-card)]">
      <div class="flex items-center gap-2">
        <span class="text-[var(--accent-light)] font-bold text-sm">✦</span>
        <h3 class="text-xs font-bold text-[var(--text-main)]">{$t('ai.title')}</h3>

        <!-- Quick Provider Switcher in Header -->
        <select
          value={aiSettings.active_provider_id}
          onchange={async (e) => {
            const newId = e.currentTarget.value;
            const previous = aiSettings.active_provider_id;
            aiSettings.active_provider_id = newId;
            try { await saveAiSettings(aiSettings); } catch (reason) { aiSettings.active_provider_id = previous; errorMessage = trError(String(reason)); }
          }}
          class="bg-[var(--bg-main)] border border-[var(--border)] rounded px-2 py-0.5 text-[11px] font-medium text-[var(--accent-light)] focus:outline-none focus:border-[var(--accent)] cursor-pointer hover:border-[var(--accent)] transition"
          title={$t('ai.quickProviderSwitch')}
        >
          {#each aiSettings.providers as prov}
            <option value={prov.id} selected={aiSettings.active_provider_id === prov.id}>
              {prov.name}
            </option>
          {/each}
        </select>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          onclick={() => onOpenSettings(skill === 'research' ? 'web' : 'ai')}
          class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--accent-light)] transition"
          title={$t('ai.settings')}
        >
          ⚙️
        </button>
        <button
          onclick={() => (isOpen = false)}
          class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-main)] transition"
          title={$t('ai.close')}
        >
          ✕
        </button>
      </div>
    </header>

    <!-- Scope Selector Bar -->
    <div class="flex items-center justify-between px-4 py-2 bg-[var(--bg-main)] border-b border-[var(--border)] text-xs">
      <span class="text-[11px] text-[var(--text-dim)]">{$t('ai.scope')}</span>
      <div class="flex bg-[var(--bg-card)] p-0.5 rounded-lg border border-[var(--border)]">
        <button
          onclick={() => (scope = 'vault')}
          class="px-2.5 py-0.5 rounded-md text-[11px] transition {scope === 'vault' ? 'bg-[var(--accent)] text-black font-semibold shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          {$t('ai.scopeVault')}
        </button>
        <button
          onclick={() => (scope = 'note')}
          disabled={!currentNotePath}
          class="px-2.5 py-0.5 rounded-md text-[11px] transition disabled:opacity-40 {scope === 'note' ? 'bg-[var(--accent)] text-black font-semibold shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
          title={currentNotePath ? currentNotePath : $t('ai.scopeNoteHint')}
        >
          {$t('ai.scopeNote')}
        </button>
      </div>
    </div>

    <div class="px-4 py-2 border-b border-[var(--border)] flex flex-col gap-1.5">
      <label for="assistant-skill" class="text-[11px] text-[var(--text-dim)]">{$t('ai.skill')}</label>
      <select id="assistant-skill" bind:value={skill} disabled={isLoading}
        class="w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs text-[var(--text-main)]">
        <option value="auto">{$t('ai.skillAuto')}</option>
        <option value="notes">{$t('ai.skillNotes')}</option>
        <option value="write">{$t('ai.skillWrite')}</option>
        <option value="research">{$t('ai.skillResearch')}</option>
      </select>
      <p class="text-[10px] text-[var(--text-dim)] leading-relaxed">
        {skill === 'research' ? $t('ai.researchHint') : $t('ai.skillsHint')}
      </p>
    </div>


    <!-- Chat Messages Container -->
    <div
      bind:this={messagesContainer}
      use:interceptLinks
      class="flex-1 overflow-y-auto p-4 flex flex-col gap-4 select-text"
    >
      {#if messages.length === 0}
        <div class="flex flex-col items-center justify-center my-auto py-8 text-center text-[var(--text-dim)] select-none">
          <div class="w-12 h-12 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-xl mb-3">
            ✦
          </div>
          <h4 class="text-xs font-bold text-[var(--text-main)] mb-1">{$t('ai.emptyTitle')}</h4>
          <p class="text-[11px] text-[var(--text-muted)] max-w-[240px] leading-relaxed mb-4">
            {$t('ai.emptySubtitle')}
          </p>

          <div class="flex flex-col gap-1.5 w-full max-w-[260px]">
            <button
              onclick={() => sendMessage(ts('ai.suggestionCreate'), 'write')}
              class="px-3 py-2 text-[11px] text-left rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
            >
              {$t('ai.suggestionCreate')}
            </button>
            <button
              onclick={() => sendMessage(ts('ai.suggestionSummary'))}
              class="px-3 py-2 text-[11px] text-left rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
            >
              {$t('ai.suggestionSummary')}
            </button>
            <button
              onclick={() => sendMessage(ts('ai.suggestionResearch'), 'research')}
              class="px-3 py-2 text-[11px] text-left rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
            >
              {$t('ai.suggestionResearch')}
            </button>
          </div>
        </div>
      {:else}
        {#each messages as msg}
          <div class="flex flex-col gap-1 {msg.role === 'user' ? 'items-end' : 'items-start'}">
            <div class="flex items-center gap-1.5 text-[10px] text-[var(--text-dim)] px-1 select-none">
              <span>{msg.role === 'user' ? $t('ai.you') : $t('ai.assistantRole')}</span>
              <span>•</span>
              <span>{msg.timestamp}</span>
            </div>

            <div
              class="max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed {msg.role === 'user' ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--text-main)]' : 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-main)] shadow-sm'}"
            >
              {#if msg.role === 'assistant'}
                <div class="prose max-w-none text-xs leading-relaxed">
                  {@html renderChatMarkdown(trError(msg.content))}
                </div>
                {#if msg.isError}
                  <button class="mt-3 text-xs font-semibold text-[var(--accent-light)] hover:underline" onclick={() => onOpenSettings(msg.errorSettingsTab || 'providers')}>{msg.errorSettingsTab === 'web' ? $t('settings.webSearch') : $t('settings.providers')}</button>
                {/if}

                {#each msg.warnings || [] as warning}
                  <p role="status" class="mt-2 text-xs text-[var(--accent-light)]">{trError(warning)}</p>
                {/each}

                {#if !msg.drafts?.length && !msg.isError && msg.content.trim()}
                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <button onclick={() => { msg.drafts = [{ path: `${ts('ai.responseDocumentName')}.md`, content: msg.content }]; }}
                      class="px-2 py-1 rounded border border-[var(--border)] text-[11px] text-[var(--accent-light)] hover:bg-[var(--bg-hover)]">
                      {$t('ai.responseToNote')}
                    </button>
                    <DocumentActions content={msg.content} path={`${ts('ai.responseDocumentName')}.md`} />
                  </div>
                {/if}

                {#if msg.drafts?.length}
                  <div class="mt-3 flex flex-col gap-3">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-[11px] font-semibold">{$t('ai.drafts', { count: msg.drafts.length })}</span>
                      {#if msg.drafts.length > 1 && msg.drafts.some((d) => !d.savedPath)}
                        <button onclick={() => saveAllDrafts(msg)} disabled={msg.drafts.some((d) => d.saving)}
                          class="text-[11px] text-[var(--accent-light)] disabled:opacity-40">{$t('ai.saveAll')}</button>
                      {/if}
                    </div>
                    {#each msg.drafts as draft}
                      <div class="rounded-lg border border-[var(--border)] bg-[var(--bg-main)] p-2.5 flex flex-col gap-2">
                        <input aria-label={$t('ai.draftPath')} bind:value={draft.path} disabled={!!draft.savedPath || draft.saving}
                          class="w-full bg-[var(--bg-card)] text-[var(--text-main)] border border-[var(--border)] rounded px-2 py-1 text-[11px] disabled:opacity-70" />
                        <details>
                          <summary class="cursor-pointer text-[11px] text-[var(--text-muted)]">{$t('ai.previewDraft')}</summary>
                          <div class="prose text-xs max-h-72 overflow-auto py-2">{@html renderChatMarkdown(draft.content)}</div>
                          <textarea aria-label={$t('ai.editDraft')} bind:value={draft.content} rows="8" disabled={!!draft.savedPath || draft.saving}
                            class="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded p-2 font-mono text-[11px] disabled:opacity-60"></textarea>
                        </details>
                        <div class="flex flex-wrap items-center gap-2">
                          {#if draft.savedPath}
                            <button onclick={() => onNavigateToSource(draft.savedPath!, 1)}
                              class="text-[11px] text-[var(--accent-light)] hover:underline">✓ {$t('ai.openSavedNote')}</button>
                          {:else}
                            <button onclick={() => saveDraft(msg, draft)} disabled={draft.saving || !draft.content.trim()}
                              class="px-2 py-1 rounded bg-[var(--accent)] text-black text-[11px] disabled:opacity-40">
                              {draft.saving ? $t('editor.saving') : $t('ai.saveDraft')}
                            </button>
                          {/if}
                          <DocumentActions content={draft.content} path={draft.path} />
                        </div>
                        {#if draft.error}<p role="alert" class="text-[11px] text-red-500">{draft.error}</p>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}

                {#if msg.webSources?.length}
                  <div class="mt-3 pt-2 border-t border-[var(--border)] flex flex-col gap-1">
                    <span class="text-[10px] text-[var(--text-dim)]">{$t('ai.webSources')}</span>
                    {#each msg.webSources as source}
                      <a href={source.url} title={source.description} class="text-[11px] text-[var(--accent-light)] hover:underline break-words">{source.title}</a>
                    {/each}
                  </div>
                {/if}

                {#if msg.appliedLinks && msg.appliedLinks > 0}
                  <div class="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border)] text-[10px] text-[var(--accent-light)] select-none">
                    🔗 {$t('ai.linksApplied', { count: msg.appliedLinks })}
                  </div>
                {/if}

                <!-- Sources Chips -->
                {#if msg.sources && msg.sources.length > 0}
                  <div class="mt-3 pt-2 border-t border-[var(--border)] flex flex-col gap-1.5 select-none">
                    <span class="text-[10px] text-[var(--text-dim)] font-medium">{$t('ai.sources')}</span>
                    <div class="flex flex-wrap gap-1">
                      {#each msg.sources as src}
                        <button
                          onclick={() => onNavigateToSource(src.note_path, src.line_number)}
                          class="px-2 py-0.5 rounded bg-[var(--bg-main)] hover:bg-[var(--bg-active)] border border-[var(--border)] text-[10px] text-[var(--accent-light)] flex items-center gap-1 transition"
                          title="{src.content.slice(0, 100)}..."
                        >
                          <span>📄</span>
                          <span class="truncate max-w-[140px]">{src.note_title}</span>
                          <span class="text-[var(--text-dim)]">:L{src.line_number}</span>
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

        {#if isLoading}
          <div class="flex items-center gap-2 text-xs text-[var(--text-dim)] px-2 animate-pulse">
            <span class="inline-block w-2 h-2 rounded-full bg-[var(--accent)]"></span>
            <span>{$t('ai.thinking')}</span>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Chat Input Footer -->
    <footer class="p-3 border-t border-[var(--border)] bg-[var(--bg-card)]">
      {#if errorMessage}
        <p role="alert" class="mb-2 text-xs text-red-500">{errorMessage}</p>
      {/if}
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
            class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-lg p-2.5 text-xs text-[var(--text-main)] placeholder-[var(--text-dim)] resize-none focus:outline-none focus:border-[var(--accent)] select-text"
          ></textarea>
        </div>

        <div class="flex items-center justify-between text-[11px] text-[var(--text-dim)]">
          <span class="text-[10px]">{$t('ai.shiftEnterHint')}</span>
          <button
            type="submit"
            disabled={isLoading || !inputPrompt.trim()}
            class="px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-40 text-black text-xs font-semibold rounded-md transition shadow flex items-center gap-1"
          >
            <span>{$t('ai.send')}</span>
            <span>➤</span>
          </button>
        </div>
      </form>
    </footer>
  </aside>
{/if}
