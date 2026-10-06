<script lang="ts">
  import { liquidGlass } from '$lib/liquid-glass';
  import { tick } from 'svelte';
  import {
    Search, FileText, FolderPlus, FilePlus, Share2, Settings,
    Palette, RefreshCw, Eye, Columns2, FileEdit, Sparkles,
    CornerDownLeft, X, Network, Moon, Sun
  } from 'lucide-svelte';
  import { t } from '$lib/i18n';
  import type { VaultItem, ViewMode } from '$lib/types';

  interface Props {
    isOpen: boolean;
    items: VaultItem[];
    viewMode: ViewMode;
    theme: 'dark' | 'light';
    onClose: () => void;
    onOpenNote: (path: string) => void;
    onCreateNote: () => void;
    onCreateFolder: () => void;
    onToggleAi: () => void;
    onToggleGraph: () => void;
    onOpenSettings: (tab?: any) => void;
    onOpenPair: () => void;
    onSync: () => void;
    onChangeTheme: (theme: 'dark' | 'light') => void;
    onChangeViewMode: (mode: ViewMode) => void;
  }

  let {
    isOpen,
    items,
    viewMode,
    theme,
    onClose,
    onOpenNote,
    onCreateNote,
    onCreateFolder,
    onToggleAi,
    onToggleGraph,
    onOpenSettings,
    onOpenPair,
    onSync,
    onChangeTheme,
    onChangeViewMode
  }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  interface CommandItem {
    id: string;
    title: string;
    subtitle?: string;
    category: 'actions' | 'notes' | 'view' | 'system';
    icon: any;
    shortcut?: string;
    accent?: string;
    run: () => void;
  }

  const noteItems = $derived<CommandItem[]>(
    items
      .filter((i) => !i.is_dir)
      .map((i) => {
        const name = i.path.split(/[/\\]/).pop()?.replace(/\.md$/, '') || i.path;
        return {
          id: `note-${i.path}`,
          title: name,
          subtitle: i.path,
          category: 'notes',
          icon: FileText,
          accent: 'var(--accent)',
          run: () => {
            onOpenNote(i.path);
            onClose();
          }
        };
      })
  );

  const baseActions = $derived<CommandItem[]>([
    {
      id: 'action-new-note',
      title: $t('sidebar.newNote'),
      subtitle: 'Criar um novo arquivo Markdown no cofre',
      category: 'actions',
      icon: FilePlus,
      shortcut: 'Ctrl+N',
      accent: 'var(--accent)',
      run: () => {
        onCreateNote();
        onClose();
      }
    },
    {
      id: 'action-new-folder',
      title: $t('sidebar.newFolder'),
      subtitle: 'Organizar documentos em pastas',
      category: 'actions',
      icon: FolderPlus,
      accent: 'var(--accent)',
      run: () => {
        onCreateFolder();
        onClose();
      }
    },
    {
      id: 'action-ai-chat',
      title: $t('editor.openAiAssistant'),
      subtitle: 'Perguntar às suas notas com RAG e busca web',
      category: 'actions',
      icon: Sparkles,
      shortcut: 'Ctrl+J',
      accent: 'var(--accent)',
      run: () => {
        onToggleAi();
        onClose();
      }
    },
    {
      id: 'action-graph',
      title: 'Grafo de Conexões',
      subtitle: 'Visualizar constelação interativa de notas',
      category: 'actions',
      icon: Network,
      shortcut: 'Ctrl+G',
      accent: 'var(--accent)',
      run: () => {
        onToggleGraph();
        onClose();
      }
    },
    {
      id: 'action-pair',
      title: $t('sidebar.manageConnections'),
      subtitle: 'Sincronização P2P direta com Iroh',
      category: 'actions',
      icon: Share2,
      accent: 'var(--accent)',
      run: () => {
        onOpenPair();
        onClose();
      }
    },
    {
      id: 'action-sync',
      title: $t('sidebar.syncNow'),
      subtitle: 'Forçar sincronização de dados via rede P2P',
      category: 'actions',
      icon: RefreshCw,
      shortcut: 'Ctrl+S',
      accent: 'var(--accent)',
      run: () => {
        onSync();
        onClose();
      }
    },
    // View modes
    {
      id: 'view-edit',
      title: `${$t('editor.modeEdit')} - Modo Apenas Editor`,
      subtitle: 'Foco total na escrita de código e Markdown',
      category: 'view',
      icon: FileEdit,
      run: () => {
        onChangeViewMode('edit');
        onClose();
      }
    },
    {
      id: 'view-split',
      title: `${$t('editor.modeSplit')} - Modo Dividido`,
      subtitle: 'Editor e visualizador em tempo real lado a lado',
      category: 'view',
      icon: Columns2,
      run: () => {
        onChangeViewMode('split');
        onClose();
      }
    },
    {
      id: 'view-preview',
      title: `${$t('editor.modePreview')} - Modo Pré-visualização`,
      subtitle: 'Visualização renderizada sem o editor de texto',
      category: 'view',
      icon: Eye,
      run: () => {
        onChangeViewMode('preview');
        onClose();
      }
    },
    // System
    {
      id: 'theme-toggle',
      title: theme === 'dark' ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro',
      subtitle: 'Alternar tema de cores do LowNotes',
      category: 'system',
      icon: theme === 'dark' ? Sun : Moon,
      run: () => {
        onChangeTheme(theme === 'dark' ? 'light' : 'dark');
        onClose();
      }
    },
    {
      id: 'settings-themes',
      title: $t('settings.themes'),
      subtitle: $t('settings.appearanceOptionsHint'),
      category: 'system',
      icon: Palette,
      accent: 'var(--accent)',
      run: () => {
        onOpenSettings('themes');
        onClose();
      }
    },
    {
      id: 'settings-open',
      title: $t('settings.title'),
      subtitle: 'Preferências gerais, IA, idiomas e atualizações',
      category: 'system',
      icon: Settings,
      shortcut: 'Ctrl+,',
      run: () => {
        onOpenSettings('general');
        onClose();
      }
    }
  ]);

  const filteredCommands = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...baseActions, ...noteItems.slice(0, 8)];
    }
    const match = (text?: string) => text && text.toLowerCase().includes(q);
    const notes = noteItems.filter((i) => match(i.title) || match(i.subtitle));
    const actions = baseActions.filter((i) => match(i.title) || match(i.subtitle));

    return [...actions, ...notes];
  });

  $effect(() => {
    if (isOpen) {
      query = '';
      selectedIndex = 0;
      tick().then(() => inputEl?.focus());
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    const itemsList = filteredCommands;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % Math.max(1, itemsList.length);
      scrollToSelected();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + itemsList.length) % Math.max(1, itemsList.length);
      scrollToSelected();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (itemsList[selectedIndex]) {
        itemsList[selectedIndex].run();
      }
    }
  }

  function scrollToSelected() {
    tick().then(() => {
      const activeEl = document.querySelector('[data-command-active="true"]');
      activeEl?.scrollIntoView({ block: 'nearest' });
    });
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-start justify-center pt-[12vh] p-4 transition-opacity animate-fade-in"
    onclick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
    role="presentation"
    data-modal-backdrop="command-palette"
  >
    <!-- Modal Dialog -->
    <div
      class="apple-command relative w-full max-w-xl rounded-2xl glass-panel border border-white/10 dark:border-white/[0.08] shadow-2xl overflow-hidden flex flex-col max-h-[70vh] animate-scale-in"
      use:liquidGlass role="dialog"
      aria-modal="true"
      aria-label="Paleta de Comandos"
    >


      <!-- Top Search Input -->
      <div class="apple-command-header flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06] bg-black/20">
        <Search size={18} class="text-neutral-400 shrink-0" />
        <input
          bind:this={inputEl}
          bind:value={query}
          placeholder="Digite um comando ou busque uma nota..."
          class="flex-1 bg-transparent border-none text-sm text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
          autocomplete="off"
          spellcheck="false"
        />
        {#if query}
          <button
            onclick={() => query = ''}
            class="text-neutral-400 hover:text-neutral-200 p-1 rounded-md transition-colors"
            title="Limpar busca"
          >
            <X size={14} />
          </button>
        {/if}
        <span class="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-md bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
          ESC
        </span>
      </div>

      <!-- Results List -->
      <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {#if filteredCommands.length === 0}
          <div class="py-12 text-center text-neutral-400 text-sm">
            Nenhum resultado encontrado para "<span class="text-neutral-200">{query}</span>"
          </div>
        {:else}
          {#each filteredCommands as cmd, index (cmd.id)}
            {@const isSelected = index === selectedIndex}
            {@const Icon = cmd.icon}
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-all group {isSelected
                ? 'text-[var(--text-main)]'
                : 'text-[var(--text-muted)]'}"
              data-command-active={isSelected ? 'true' : 'false'}
              onmouseenter={() => selectedIndex = index}
              onclick={cmd.run}
            >
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="apple-command-icon w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style="background: {isSelected ? 'var(--accent)' : 'var(--material-field)'}; color: {isSelected ? 'var(--accent-contrast)' : (cmd.accent || 'currentColor')};"
                >
                  <Icon size={16} />
                </div>
                <div class="min-w-0">
                  <div class="text-xs font-semibold truncate flex items-center gap-2">
                    <span>{cmd.title}</span>
                  </div>
                  {#if cmd.subtitle}
                    <div class="text-[11px] text-neutral-400 truncate mt-0.5">
                      {cmd.subtitle}
                    </div>
                  {/if}
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                {#if cmd.shortcut}
                  <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 border border-white/[0.08] text-neutral-400">
                    {cmd.shortcut}
                  </span>
                {/if}
                {#if isSelected}
                  <CornerDownLeft size={13} class="text-[var(--accent)]" />
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>

      <!-- Footer Info -->
      <div class="apple-command-footer px-4 py-2 border-t border-white/[0.06] bg-black/20 flex items-center justify-between text-[11px] text-neutral-400">
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px]">↑</kbd>
            <kbd class="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px]">↓</kbd>
            navegar
          </span>
          <span class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px]">↵</kbd>
            executar
          </span>
        </div>
        <span class="text-[10px] text-neutral-400">
          LowNotes Spotlight
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.96) translateY(-8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  .animate-fade-in {
    animation: fadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .animate-scale-in {
    animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
</style>
