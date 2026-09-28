<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { renderChatMarkdown } from '../markdown';
  import DocumentActions from './DocumentActions.svelte';
  import type {
    AiProviderConfig,
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
    fetchAiModels,
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
      web_search_api_key: '',
    }),
    currentNotePath = '',
    onNavigateToSource,
    onNotesCreated,
  } = $props<{
    isOpen: boolean;
    aiSettings: AiSettings;
    currentNotePath: string;
    onNavigateToSource: (path: string, line: number) => void;
    onNotesCreated: () => Promise<void>;
  }>();

  let isSettingsOpen = $state(false);
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
  }

  let messages = $state<MessageItem[]>([]);
  let messagesContainer: HTMLDivElement | null = $state(null);

  // Settings state
  let selectedProviderId = $state(aiSettings.active_provider_id || 'ollama');
  let currentProvider = $derived(
    aiSettings.providers.find((p: AiProviderConfig) => p.id === selectedProviderId) || aiSettings.providers[0]
  );

  let apiKeyInput = $state('');
  let baseUrlInput = $state('');
  let selectedModelInput = $state('');
  let availableModels = $state<string[]>([]);
  let isFetchingModels = $state(false);
  let showApiKey = $state(false);
  let webKeyInput = $state(aiSettings.web_search_api_key || '');

  // Add custom provider state
  let isAddingCustom = $state(false);
  let customName = $state('');
  let customUrl = $state('');
  // Unified Combobox State
  let isModelDropdownOpen = $state(false);
  let modelSearchQuery = $state('');

  let filteredModels = $derived(
    availableModels.filter((m: string) => {
      const q = modelSearchQuery.trim().toLowerCase();
      if (!q) return true;
      return m.toLowerCase().includes(q);
    })
  );

  function syncSettingsInputs(prov?: AiProviderConfig) {
    const target = prov || currentProvider;
    if (target) {
      apiKeyInput = target.api_key;
      baseUrlInput = target.base_url;
      selectedModelInput = target.selected_model;
      availableModels = [];
      isModelDropdownOpen = false;
      modelSearchQuery = '';
    }
  }

  let lastActiveId = '';
  $effect(() => {
    const active = aiSettings?.active_provider_id;
    if (active && active !== lastActiveId) {
      lastActiveId = active;
      selectedProviderId = active;
      untrack(() => {
        const prov = aiSettings.providers.find((p: AiProviderConfig) => p.id === active);
        syncSettingsInputs(prov);
      });
    }
  });

  function handleProviderChange(id: string) {
    if (id === selectedProviderId) return;

    // Save in-flight edits to the previous provider in memory
    const prevIndex = aiSettings.providers.findIndex((p: AiProviderConfig) => p.id === selectedProviderId);
    if (prevIndex !== -1) {
      aiSettings.providers[prevIndex].api_key = apiKeyInput.trim();
      aiSettings.providers[prevIndex].base_url = baseUrlInput.trim();
      aiSettings.providers[prevIndex].selected_model = selectedModelInput.trim();
    }

    selectedProviderId = id;
    const target = aiSettings.providers.find((p: AiProviderConfig) => p.id === id);
    if (target) {
      syncSettingsInputs(target);
    }
  }

  async function handleFetchModels() {
    isFetchingModels = true;
    errorMessage = null;
    try {
      const models = await fetchAiModels(selectedProviderId, baseUrlInput, apiKeyInput);
      availableModels = models;
      isModelDropdownOpen = true;
      modelSearchQuery = '';
      if (models.length > 0 && !selectedModelInput) {
        selectedModelInput = models[0];
      }
    } catch (err: any) {
      errorMessage = trError(typeof err === 'string' ? err : err.message || 'ai.errorFetchModels');
    } finally {
      isFetchingModels = false;
    }
  }

  async function handleSaveSettings() {
    const pIndex = aiSettings.providers.findIndex((p: AiProviderConfig) => p.id === selectedProviderId);
    if (pIndex !== -1) {
      aiSettings.providers[pIndex].api_key = apiKeyInput.trim();
      aiSettings.providers[pIndex].base_url = baseUrlInput.trim();
      aiSettings.providers[pIndex].selected_model = selectedModelInput.trim();
    }
    aiSettings.active_provider_id = selectedProviderId;
    aiSettings.web_search_api_key = webKeyInput.trim();
    lastActiveId = selectedProviderId;

    try {
      await saveAiSettings(aiSettings);
      isSettingsOpen = false;
      errorMessage = null;
    } catch (e: any) {
      errorMessage = trError(typeof e === 'string' ? e : e.message || 'ai.errorSave');
    }
  }

  async function handleAutoLinkChange() {
    try {
      await saveAiSettings(aiSettings);
    } catch (e: any) {
      errorMessage = trError(typeof e === 'string' ? e : e.message || 'ai.errorSave');
    }
  }

  async function handleAddCustomProvider() {
    if (!customName.trim() || !customUrl.trim()) return;
    const id = 'custom_' + Date.now();
    const newProv: AiProviderConfig = {
      id,
      name: customName.trim(),
      base_url: customUrl.trim(),
      api_key: '',
      selected_model: '',
      is_custom: true,
    };
    aiSettings.providers.push(newProv);
    selectedProviderId = id;
    syncSettingsInputs();
    isAddingCustom = false;
    customName = '';
    customUrl = '';
  }

  async function sendMessage(textToSend?: string, selectedSkill?: AssistantSkill) {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isLoading) return;
    if (selectedSkill) skill = selectedSkill;
    if (skill === 'research' && !aiSettings.web_search_api_key.trim()) {
      errorMessage = ts('ai.webKeyRequired');
      isSettingsOpen = true;
      return;
    }

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
        drafts: resp.drafts,
        warnings: resp.warnings,
        vaultId: resp.vault_id,
        appliedLinks,
        timestamp: new Date().toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err: any) {
      if (disposed) return;
      const msg = trError(typeof err === 'string' ? err : err.message || 'ai.errorQuery');
      messages.push({
        role: 'assistant',
        content: ts('ai.errorMessage', { message: msg }),
        isError: true,
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
            handleProviderChange(newId);
            aiSettings.active_provider_id = newId;
            lastActiveId = newId;
            await saveAiSettings(aiSettings);
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
          onclick={() => (isSettingsOpen = !isSettingsOpen)}
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

    <!-- Settings Overlay Drawer -->
    {#if isSettingsOpen}
      <div class="absolute top-[88px] left-0 right-0 bottom-0 bg-[var(--bg-card)] z-40 p-4 overflow-y-auto flex flex-col gap-4 border-b border-[var(--border)] animate-fadeIn">
        <div class="flex items-center justify-between pb-2 border-b border-[var(--border)]">
          <span class="text-xs font-bold text-[var(--text-main)]">{$t('ai.settingsTitle')}</span>
          <button
            onclick={() => (isSettingsOpen = false)}
            class="text-xs text-[var(--text-dim)] hover:text-[var(--text-main)]"
          >
            ✕
          </button>
        </div>

        <!-- Provider Selection -->
        <!-- Provider Selection in Settings Drawer -->
        <div class="flex flex-col gap-1.5">
          <label for="ai-provider-select" class="text-xs text-[var(--text-dim)] font-medium">{$t('ai.provider')}</label>
          <select
            id="ai-provider-select"
            value={selectedProviderId}
            onchange={(e) => handleProviderChange(e.currentTarget.value)}
            class="bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            {#each aiSettings.providers as prov}
              <option value={prov.id} selected={selectedProviderId === prov.id}>
                {prov.name}
              </option>
            {/each}
          </select>
        </div>

        <!-- Base URL -->
        <div class="flex flex-col gap-1.5">
          <label for="ai-base-url" class="text-xs text-[var(--text-dim)] font-medium">{$t('ai.baseUrl')}</label>
          <input
            id="ai-base-url"
            type="text"
            bind:value={baseUrlInput}
            placeholder="http://localhost:11434/v1"
            class="bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <!-- API Key -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label for="ai-api-key" class="text-xs text-[var(--text-dim)] font-medium">{$t('ai.apiKey')}</label>
            <button
              onclick={() => (showApiKey = !showApiKey)}
              class="text-[10px] text-[var(--text-dim)] hover:text-[var(--accent-light)]"
            >
              {showApiKey ? $t('ai.hide') : $t('ai.show')}
            </button>
          </div>
          <input
            id="ai-api-key"
            type={showApiKey ? 'text' : 'password'}
            bind:value={apiKeyInput}
            placeholder={selectedProviderId === 'ollama' || selectedProviderId === 'lmstudio' ? $t('ai.apiKeyLocalPlaceholder') : 'sk-...'}
            class="bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <!-- Model Selection & Fetching -->
        <!-- Model Selection Combobox -->
        <div class="flex flex-col gap-1.5 relative">
          <div class="flex items-center justify-between">
            <label for="ai-model-input" class="text-xs text-[var(--text-dim)] font-medium">{$t('ai.selectedModel')}</label>
            <button
              type="button"
              onclick={handleFetchModels}
              disabled={isFetchingModels}
              class="text-[11px] text-[var(--accent-light)] hover:underline flex items-center gap-1 disabled:opacity-50"
            >
              <span>↻</span>
              <span>{isFetchingModels ? $t('ai.fetching') : $t('ai.listModels')}</span>
            </button>
          </div>

          <!-- Main Unified Input / Combobox Trigger -->
          <div class="relative flex items-center">
            <input
              id="ai-model-input"
              type="text"
              bind:value={selectedModelInput}
              onfocus={() => { if (availableModels.length > 0) isModelDropdownOpen = true; }}
              placeholder={$t('ai.modelPlaceholder')}
              class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-md pl-2.5 pr-14 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)]"
            />

            <div class="absolute right-1.5 flex items-center gap-1">
              {#if selectedModelInput}
                <button
                  type="button"
                  onclick={() => { selectedModelInput = ''; modelSearchQuery = ''; }}
                  class="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--text-dim)] hover:text-[var(--text-main)]"
                  title={$t('ai.clear')}
                >
                  ✕
                </button>
              {/if}

              {#if availableModels.length > 0}
                <button
                  type="button"
                  onclick={() => (isModelDropdownOpen = !isModelDropdownOpen)}
                  class="w-5 h-5 flex items-center justify-center rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--accent-light)] hover:bg-[var(--bg-hover)] transition"
                  title={$t('ai.openModelList')}
                >
                  {isModelDropdownOpen ? '▲' : '▼'}
                </button>
              {/if}
            </div>
          </div>

          <!-- Floating Dropdown Popover for Model Search & Selection -->
          {#if isModelDropdownOpen && availableModels.length > 0}
            <div class="mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-2xl overflow-hidden flex flex-col z-50 animate-fadeIn">
              <!-- Internal Fast Filter Search Bar -->
              <div class="p-2 border-b border-[var(--border)] bg-[var(--bg-main)] flex items-center gap-2">
                <span class="text-xs text-[var(--text-dim)]">🔍</span>
                <input
                  type="text"
                  bind:value={modelSearchQuery}
                  placeholder={$t('ai.searchModels', { count: availableModels.length })}
                  class="flex-1 bg-transparent text-xs text-[var(--text-main)] placeholder-[var(--text-dim)] focus:outline-none"
                />
                {#if modelSearchQuery}
                  <button
                    type="button"
                    onclick={() => (modelSearchQuery = '')}
                    class="text-[11px] text-[var(--text-dim)] hover:text-[var(--text-main)]"
                  >
                    ✕
                  </button>
                {/if}
                <button
                  type="button"
                  onclick={() => (isModelDropdownOpen = false)}
                  class="text-[11px] text-[var(--text-dim)] hover:text-[var(--text-main)] ml-1"
                  title={$t('ai.closeList')}
                >
                  {$t('ai.done')}
                </button>
              </div>

              <!-- Models List -->
              <div class="max-h-52 overflow-y-auto p-1 flex flex-col gap-0.5">
                {#if modelSearchQuery.trim() && !availableModels.includes(modelSearchQuery.trim())}
                  <button
                    type="button"
                    onclick={() => {
                      selectedModelInput = modelSearchQuery.trim();
                      isModelDropdownOpen = false;
                    }}
                    class="w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono text-[var(--accent-light)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 transition border-b border-[var(--border)]"
                  >
                    <span>➕</span>
                    <span class="truncate">{$t('ai.useCustomModel', { model: modelSearchQuery.trim() })}</span>
                  </button>
                {/if}

                {#if filteredModels.length === 0}
                  <div class="p-4 text-center text-xs text-[var(--text-dim)]">
                    {$t('ai.noModelsFound', { query: modelSearchQuery })}
                  </div>
                {:else}
                  {#each filteredModels as mod}
                    <button
                      type="button"
                      onclick={() => {
                        selectedModelInput = mod;
                        isModelDropdownOpen = false;
                      }}
                      class="w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono transition flex items-center justify-between {selectedModelInput === mod ? 'bg-[var(--bg-active)] text-[var(--accent-light)] font-semibold' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'}"
                    >
                      <span class="truncate">{mod}</span>
                      {#if selectedModelInput === mod}
                        <span class="text-xs text-[var(--accent-light)]">✓</span>
                      {/if}
                    </button>
                  {/each}
                {/if}
              </div>

              <!-- Footer with count -->
              <div class="px-3 py-1.5 border-t border-[var(--border)] bg-[var(--bg-main)] text-[10px] text-[var(--text-dim)] flex items-center justify-between">
                <span>{$t('ai.modelsCount', { shown: filteredModels.length, total: availableModels.length })}</span>
                <span class="text-emerald-400">{$t('ai.available')}</span>
              </div>
            </div>
          {/if}
        </div>

        {#if errorMessage}
          <div class="p-2 bg-red-950/40 border border-red-900/60 rounded text-xs text-red-300">
            {errorMessage}
          </div>
        {/if}

        <!-- Add Custom Provider Toggle -->
        {#if !isAddingCustom}
          <button
            onclick={() => (isAddingCustom = true)}
            class="text-xs text-[var(--text-dim)] hover:text-[var(--accent-light)] text-left"
          >
            + {$t('ai.addCustomProvider')}
          </button>
        {:else}
          <div class="p-3 bg-[var(--bg-main)] border border-[var(--border)] rounded-md flex flex-col gap-2">
            <span class="text-xs font-semibold text-[var(--text-main)]">{$t('ai.newProvider')}</span>
            <input
              type="text"
              bind:value={customName}
              placeholder={$t('ai.providerNamePlaceholder')}
              class="bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-main)]"
            />
            <input
              type="text"
              bind:value={customUrl}
              placeholder={$t('ai.providerUrlPlaceholder')}
              class="bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono text-[var(--text-main)]"
            />
            <div class="flex justify-end gap-1.5">
              <button
                onclick={() => (isAddingCustom = false)}
                class="px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text-main)]"
              >
                {$t('ai.cancel')}
              </button>
              <button
                onclick={handleAddCustomProvider}
                class="px-3 py-1 bg-[var(--accent)] text-black text-xs font-semibold rounded"
              >
                {$t('ai.add')}
              </button>
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-1.5 pt-2 border-t border-[var(--border)]">
          <label for="ai-web-key" class="text-xs text-[var(--text-main)]">{$t('ai.webKey')}</label>
          <input id="ai-web-key" type="password" bind:value={webKeyInput} autocomplete="off"
            class="bg-[var(--bg-main)] border border-[var(--border)] rounded px-2 py-1.5 text-xs text-[var(--text-main)]" />
          <p class="text-[10px] text-[var(--text-dim)] leading-relaxed">{$t('ai.webKeyHint')}</p>
          <button onclick={() => openUrl('https://api-dashboard.search.brave.com/')}
            class="text-left text-[11px] text-[var(--accent-light)] hover:underline">{$t('ai.webGetKey')}</button>
        </div>

        <!-- Auto-link Notes -->
        <div class="flex flex-col gap-1 pt-2 border-t border-[var(--border)]">
          <label class="flex items-center gap-2 text-xs text-[var(--text-main)] cursor-pointer">
            <input
              type="checkbox"
              bind:checked={aiSettings.auto_link_notes}
              onchange={handleAutoLinkChange}
              class="accent-[var(--accent)]"
            />
            {$t('ai.autoLink')}
          </label>
          <span class="text-[10px] text-[var(--text-dim)] leading-relaxed">{$t('ai.autoLinkHint')}</span>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <button
            onclick={handleSaveSettings}
            class="w-full py-2 bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black text-xs font-semibold rounded-lg shadow-md transition"
          >
            {$t('ai.saveSettings')}
          </button>
        </div>
      </div>
    {/if}

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
      {#if errorMessage && !isSettingsOpen}
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

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.15s ease-out;
  }
</style>
