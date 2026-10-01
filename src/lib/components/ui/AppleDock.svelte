<script lang="ts">
  import { FilePlus, Search, Network, Sparkles, Columns2, Eye, FilePenLine, Settings2, Sun, Moon } from 'lucide-svelte';
  import type { AppTheme, ViewMode } from '$lib/types';
  import { t } from '$lib/i18n';

  let {
    onCreateNote,
    onSearch,
    onToggleGraph,
    onToggleAi,
    onOpenSettings,
    onToggleTheme,
    onViewModeChange,
    isGraphOpen = false,
    isAiOpen = false,
    hasActiveNote = false,
    viewMode = 'split',
    theme = 'dark'
  } = $props<{
    onCreateNote: () => void;
    onSearch: () => void;
    onToggleGraph: () => void;
    onToggleAi: () => void;
    onOpenSettings: () => void;
    onToggleTheme: () => void;
    onViewModeChange: (mode: ViewMode) => void;
    isGraphOpen?: boolean;
    isAiOpen?: boolean;
    hasActiveNote?: boolean;
    viewMode?: ViewMode;
    theme?: AppTheme;
  }>();

  let dockElement: HTMLElement;
  let mouseX = $state<number | null>(null);
  let viewMenuOpen = $state(false);

  $effect(() => {
    if (!hasActiveNote) viewMenuOpen = false;
  });

  function chooseViewMode(mode: ViewMode) {
    onViewModeChange(mode);
    viewMenuOpen = false;
  }

  const items = $derived([
    { id: 'new', label: $t('sidebar.newNote'), icon: FilePlus, action: onCreateNote, active: false, primary: true },
    { id: 'search', label: $t('sidebar.searchPlaceholder'), icon: Search, action: onSearch, active: false, primary: false },
    { id: 'graph', label: $t('graph.title'), icon: Network, action: onToggleGraph, active: isGraphOpen, primary: false },
    { id: 'ai', label: $t('ai.title'), icon: Sparkles, action: onToggleAi, active: isAiOpen, primary: false },
    ...(hasActiveNote ? [{ id: 'view', label: viewMode === 'edit' ? $t('editor.modeEdit') : viewMode === 'split' ? $t('editor.modeSplit') : $t('editor.modePreview'), icon: viewMode === 'edit' ? FilePenLine : viewMode === 'split' ? Columns2 : Eye, action: () => viewMenuOpen = !viewMenuOpen, active: true, primary: false }] : []),
    { id: 'theme', label: theme === 'dark' ? $t('settings.light') : $t('settings.dark'), icon: theme === 'dark' ? Sun : Moon, action: onToggleTheme, active: false, primary: false },
    { id: 'settings', label: $t('settings.title'), icon: Settings2, action: onOpenSettings, active: false, primary: false }
  ]);

  // Shadcn Space apple-dock-01: icons expand toward 60px within a
  // 140px pointer radius. CSS transitions adapt its spring motion to Svelte.
  function itemSize(index: number): number {
    if (mouseX === null || !dockElement) return 44;
    const button = dockElement.querySelector<HTMLElement>(`[data-dock-index="${index}"]`);
    if (!button) return 44;
    const bounds = button.getBoundingClientRect();
    const distance = Math.abs(mouseX - bounds.left - bounds.width / 2);
    return 44 + 16 * Math.max(0, 1 - distance / 140);
  }
</script>

<svelte:window
  onclick={(event) => {
    if (viewMenuOpen && !(event.target instanceof Element && event.target.closest('[data-dock-view]'))) viewMenuOpen = false;
  }}
  onkeydown={(event) => { if (event.key === 'Escape') viewMenuOpen = false; }}
/>

<nav
  bind:this={dockElement}
  class="apple-dock"
  aria-label="Dock"
  onmousemove={(event) => mouseX = event.clientX}
  onmouseleave={() => mouseX = null}
>
  <div class="apple-dock-track">
    {#each items as item, index (item.id)}
      {#if index === 2 || item.id === 'theme'}<span class="apple-dock-separator" aria-hidden="true"></span>{/if}
      {@const Icon = item.icon}
      <div class="apple-dock-slot" data-dock-view={item.id === 'view' ? 'true' : undefined} style:width={`${itemSize(index)}px`}>
        {#if item.id === 'view' && viewMenuOpen}
          <div class="apple-dock-view-menu" role="group" aria-label={$t('editor.viewMode')}>
            <button class:active={viewMode === 'edit'} onclick={() => chooseViewMode('edit')} aria-pressed={viewMode === 'edit'}><FilePenLine size={16} /> {$t('editor.modeEdit')}</button>
            <button class:active={viewMode === 'split'} onclick={() => chooseViewMode('split')} aria-pressed={viewMode === 'split'}><Columns2 size={16} /> {$t('editor.modeSplit')}</button>
            <button class:active={viewMode === 'preview'} onclick={() => chooseViewMode('preview')} aria-pressed={viewMode === 'preview'}><Eye size={16} /> {$t('editor.modePreview')}</button>
          </div>
        {/if}
        <button
          type="button"
          data-dock-index={index}
          class="apple-dock-icon"
          class:apple-dock-primary={item.primary}
          class:apple-dock-active={item.active}
          style:width={`${itemSize(index)}px`}
          style:height={`${itemSize(index)}px`}
          onclick={item.action}
          aria-label={item.label}
          aria-pressed={item.id === 'graph' || item.id === 'ai' ? item.active : undefined}
        >
          <Icon size={20} strokeWidth={1.85} />
        </button>
        <span class="apple-dock-tooltip" aria-hidden="true">{item.label}</span>
        <span class="apple-dock-indicator" class:visible={item.active} aria-hidden="true"></span>
      </div>
    {/each}
  </div>
</nav>
