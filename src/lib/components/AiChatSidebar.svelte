<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { marked } from 'marked';
  import type {
    AiProviderConfig,
    AiSettings,
    ChatMessage,
    RagChunk,
  } from '../types';
  import {
    aiChatQuery,
    fetchAiModels,
    saveAiSettings,
  } from '../api';

  let {
    isOpen = $bindable(false),
    aiSettings = $bindable<AiSettings>({
      active_provider_id: 'ollama',
      providers: [],
    }),
    currentNotePath = '',
    onNavigateToSource,
  } = $props<{
    isOpen: boolean;
    aiSettings: AiSettings;
    currentNotePath: string;
    onNavigateToSource: (path: string, line: number) => void;
  }>();

  let isSettingsOpen = $state(false);
  let scope = $state<'vault' | 'note'>('vault');
  let inputPrompt = $state('');
  let isLoading = $state(false);
  let errorMessage = $state<string | null>(null);

  interface MessageItem extends ChatMessage {
    sources?: RagChunk[];
    timestamp: string;
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
  let modelSearchFilter = $state('');
  let isFetchingModels = $state(false);
  let showApiKey = $state(false);

  // Add custom provider state
  let isAddingCustom = $state(false);
  let customName = $state('');
  let customUrl = $state('');

  let filteredModels = $derived(
    availableModels.filter((m) =>
      m.toLowerCase().includes(modelSearchFilter.toLowerCase())
    )
  );

  function syncSettingsInputs(prov?: AiProviderConfig) {
    const target = prov || currentProvider;
    if (target) {
      apiKeyInput = target.api_key;
      baseUrlInput = target.base_url;
      selectedModelInput = target.selected_model;
      availableModels = [];
      modelSearchFilter = '';
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
      if (models.length > 0 && !selectedModelInput) {
        selectedModelInput = models[0];
      }
    } catch (err: any) {
      errorMessage = typeof err === 'string' ? err : err.message || 'Falha ao buscar modelos';
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
    lastActiveId = selectedProviderId;

    try {
      await saveAiSettings(aiSettings);
      isSettingsOpen = false;
      errorMessage = null;
    } catch (e: any) {
      errorMessage = typeof e === 'string' ? e : e.message || 'Erro ao salvar';
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

  async function sendMessage(textToSend?: string) {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isLoading) return;

    inputPrompt = '';
    errorMessage = null;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messages.push({
      role: 'user',
      content: text,
      timestamp: time,
    });

    isLoading = true;
    await scrollToBottom();

    try {
      const history = messages
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const scopePath = scope === 'note' && currentNotePath ? currentNotePath : undefined;
      const resp = await aiChatQuery(text, scopePath, history);

      messages.push({
        role: 'assistant',
        content: resp.answer,
        sources: resp.sources,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Falha ao obter resposta da IA';
      messages.push({
        role: 'assistant',
        content: `⚠️ **Erro:** ${msg}\n\n*Dica: Verifique se o provedor está ativo (ex: Ollama rodando) ou confira a API Key nas configurações (⚙️).*`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } finally {
      isLoading = false;
      await scrollToBottom();
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
        <h3 class="text-xs font-bold text-[var(--text-main)]">Assistente</h3>

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
          title="Mudar provedor de IA rapidamente"
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
          title="Configurações da IA"
        >
          ⚙️
        </button>
        <button
          onclick={() => (isOpen = false)}
          class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-main)] transition"
          title="Fechar"
        >
          ✕
        </button>
      </div>
    </header>

    <!-- Scope Selector Bar -->
    <div class="flex items-center justify-between px-4 py-2 bg-[var(--bg-main)] border-b border-[var(--border)] text-xs">
      <span class="text-[11px] text-[var(--text-dim)]">Escopo:</span>
      <div class="flex bg-[var(--bg-card)] p-0.5 rounded-lg border border-[var(--border)]">
        <button
          onclick={() => (scope = 'vault')}
          class="px-2.5 py-0.5 rounded-md text-[11px] transition {scope === 'vault' ? 'bg-[var(--accent)] text-black font-semibold shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          Vault Inteiro
        </button>
        <button
          onclick={() => (scope = 'note')}
          disabled={!currentNotePath}
          class="px-2.5 py-0.5 rounded-md text-[11px] transition disabled:opacity-40 {scope === 'note' ? 'bg-[var(--accent)] text-black font-semibold shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
          title={currentNotePath ? currentNotePath : 'Abra uma nota para usar este modo'}
        >
          Esta Nota
        </button>
      </div>
    </div>

    <!-- Settings Overlay Drawer -->
    {#if isSettingsOpen}
      <div class="absolute top-[88px] left-0 right-0 bottom-0 bg-[var(--bg-card)] z-40 p-4 overflow-y-auto flex flex-col gap-4 border-b border-[var(--border)] animate-fadeIn">
        <div class="flex items-center justify-between pb-2 border-b border-[var(--border)]">
          <span class="text-xs font-bold text-[var(--text-main)]">Configurações de Provedores de IA</span>
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
          <label for="ai-provider-select" class="text-xs text-[var(--text-dim)] font-medium">Provedor:</label>
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
          <label for="ai-base-url" class="text-xs text-[var(--text-dim)] font-medium">Endpoint Base URL (OpenAI-compatible):</label>
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
            <label for="ai-api-key" class="text-xs text-[var(--text-dim)] font-medium">API Key:</label>
            <button
              onclick={() => (showApiKey = !showApiKey)}
              class="text-[10px] text-[var(--text-dim)] hover:text-[var(--accent-light)]"
            >
              {showApiKey ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <input
            id="ai-api-key"
            type={showApiKey ? 'text' : 'password'}
            bind:value={apiKeyInput}
            placeholder={selectedProviderId === 'ollama' || selectedProviderId === 'lmstudio' ? 'Não necessária para provedor local' : 'sk-...'}
            class="bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <!-- Model Selection & Fetching -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label for="ai-model-input" class="text-xs text-[var(--text-dim)] font-medium">Modelo Selecionado:</label>
            <button
              onclick={handleFetchModels}
              disabled={isFetchingModels}
              class="text-[11px] text-[var(--accent-light)] hover:underline flex items-center gap-1 disabled:opacity-50"
            >
              <span>↻</span>
              <span>{isFetchingModels ? 'Buscando...' : 'Listar Modelos'}</span>
            </button>
          </div>
          <input
            id="ai-model-input"
            type="text"
            bind:value={selectedModelInput}
            list="ai-models-datalist"
            placeholder="ex: qwen2.5:1.5b ou gpt-4o-mini"
            class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)]"
          />

          <!-- Native Autocomplete Datalist -->
          <datalist id="ai-models-datalist">
            {#each availableModels as mod}
              <option value={mod}>{mod}</option>
            {/each}
          </datalist>

          {#if availableModels.length > 0}
            <div class="mt-1 flex flex-col gap-1.5 p-2.5 bg-[var(--bg-main)] border border-[var(--border)] rounded-lg">
              <div class="flex items-center justify-between text-[11px]">
                <span class="text-emerald-400 font-medium">✓ {availableModels.length} modelos disponíveis</span>
                <span class="text-[10px] text-[var(--text-dim)]">Selecione ou digite acima</span>
              </div>

              <!-- Search Filter Input -->
              <div class="relative">
                <input
                  type="text"
                  bind:value={modelSearchFilter}
                  placeholder="Filtrar modelos (ex: llama, claude, gpt, free)..."
                  class="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-main)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)]"
                />
                {#if modelSearchFilter}
                  <button
                    onclick={() => (modelSearchFilter = '')}
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-dim)] hover:text-[var(--text-main)]"
                  >
                    ✕
                  </button>
                {/if}
              </div>

              <!-- Select Dropdown with Filtered Models -->
              <select
                value={selectedModelInput}
                onchange={(e) => (selectedModelInput = e.currentTarget.value)}
                class="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                <option value="" disabled>-- Selecione um modelo da lista ({filteredModels.length}) --</option>
                {#each filteredModels as mod}
                  <option value={mod} selected={selectedModelInput === mod}>
                    {mod}
                  </option>
                {/each}
              </select>
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
            + Adicionar outro Provedor Personalizado
          </button>
        {:else}
          <div class="p-3 bg-[var(--bg-main)] border border-[var(--border)] rounded-md flex flex-col gap-2">
            <span class="text-xs font-semibold text-[var(--text-main)]">Novo Provedor</span>
            <input
              type="text"
              bind:value={customName}
              placeholder="Nome (ex: LocalAI)"
              class="bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-main)]"
            />
            <input
              type="text"
              bind:value={customUrl}
              placeholder="URL (ex: http://192.168.1.50:8080/v1)"
              class="bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1 text-xs font-mono text-[var(--text-main)]"
            />
            <div class="flex justify-end gap-1.5">
              <button
                onclick={() => (isAddingCustom = false)}
                class="px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text-main)]"
              >
                Cancelar
              </button>
              <button
                onclick={handleAddCustomProvider}
                class="px-3 py-1 bg-[var(--accent)] text-black text-xs font-semibold rounded"
              >
                Adicionar
              </button>
            </div>
          </div>
        {/if}

        <div class="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <button
            onclick={handleSaveSettings}
            class="w-full py-2 bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black text-xs font-semibold rounded-lg shadow-md transition"
          >
            Salvar Configurações
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
          <h4 class="text-xs font-bold text-[var(--text-main)] mb-1">Como posso te ajudar hoje?</h4>
          <p class="text-[11px] text-[var(--text-muted)] max-w-[240px] leading-relaxed mb-4">
            Consulte qualquer nota do seu vault com busca semântica e citações diretas.
          </p>

          <div class="flex flex-col gap-1.5 w-full max-w-[260px]">
            <button
              onclick={() => sendMessage('O que minhas notas dizem sobre este projeto?')}
              class="px-3 py-2 text-[11px] text-left rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
            >
              "O que minhas notas dizem sobre este projeto?"
            </button>
            <button
              onclick={() => sendMessage('Resuma as principais ideias e tópicos anotados.')}
              class="px-3 py-2 text-[11px] text-left rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
            >
              "Resuma as principais ideias e tópicos anotados."
            </button>
            <button
              onclick={() => sendMessage('Liste tarefas ou pontos pendentes encontrados.')}
              class="px-3 py-2 text-[11px] text-left rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
            >
              "Liste tarefas ou pontos pendentes encontrados."
            </button>
          </div>
        </div>
      {:else}
        {#each messages as msg}
          <div class="flex flex-col gap-1 {msg.role === 'user' ? 'items-end' : 'items-start'}">
            <div class="flex items-center gap-1.5 text-[10px] text-[var(--text-dim)] px-1 select-none">
              <span>{msg.role === 'user' ? 'Você' : 'Assistente'}</span>
              <span>•</span>
              <span>{msg.timestamp}</span>
            </div>

            <div
              class="max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed {msg.role === 'user' ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--text-main)]' : 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-main)] shadow-sm'}"
            >
              {#if msg.role === 'assistant'}
                <div class="prose prose-invert max-w-none text-xs leading-relaxed">
                  {@html marked.parse(msg.content)}
                </div>

                <!-- Sources Chips -->
                {#if msg.sources && msg.sources.length > 0}
                  <div class="mt-3 pt-2 border-t border-[var(--border)] flex flex-col gap-1.5 select-none">
                    <span class="text-[10px] text-[var(--text-dim)] font-medium">Fontes consultadas:</span>
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
            <span>Buscando no vault e gerando resposta...</span>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Chat Input Footer -->
    <footer class="p-3 border-t border-[var(--border)] bg-[var(--bg-card)]">
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
            placeholder="Pergunte às suas notas... (Enter envia)"
            rows="2"
            class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-lg p-2.5 text-xs text-[var(--text-main)] placeholder-[var(--text-dim)] resize-none focus:outline-none focus:border-[var(--accent)] select-text"
          ></textarea>
        </div>

        <div class="flex items-center justify-between text-[11px] text-[var(--text-dim)]">
          <span class="text-[10px]">Shift+Enter para nova linha</span>
          <button
            type="submit"
            disabled={isLoading || !inputPrompt.trim()}
            class="px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-40 text-black text-xs font-semibold rounded-md transition shadow flex items-center gap-1"
          >
            <span>Enviar</span>
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
