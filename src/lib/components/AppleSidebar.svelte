<script lang="ts">
  import { liquidGlass } from '$lib/liquid-glass';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import { fade } from 'svelte/transition';
  import {
    NotebookPen, PanelLeft, PanelLeftClose, Search, Plus, FileText, Folder,
    FolderOpen, FolderPlus, ChevronRight, ChevronsUpDown,
    Network, Sparkles, Settings2, Sun, Moon, RefreshCw, MoreHorizontal,
    Pencil, Trash2, Check, X,
  } from 'lucide-svelte';
  import type { AppTheme, ViewMode, VaultConfig, VaultItem } from '$lib/types';
  import type { PresenceUser } from '$lib/presence';
  import { visibleNoteRows } from '$lib/note-tree';
  import { createFolder, deleteItem, renameItem, pickVaultDirectory, selectVault, networkSyncNow } from '$lib/api';
  import { t, trError } from '$lib/i18n';
  import ViewModeControl from './ui/ViewModeControl.svelte';

  let {
    activeVault, vaults, items, selectedPath, syncStatus, peerCount, presence = [],
    theme = 'light', viewMode = 'split', isGraphOpen = false, isAiOpen = false,
    onOpenSettings, onSelectNote, onVaultChange, onOpenPairModal, onRefreshItems,
    onItemDeleted, onOpenCommandPalette, onCreateNote, onToggleGraph, onToggleAi,
    onToggleTheme, onViewModeChange, onPanelVisibilityChange,
  } = $props<{
    activeVault: VaultConfig | null;
    vaults: VaultConfig[];
    items: VaultItem[];
    selectedPath: string;
    syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
    peerCount: number;
    presence?: PresenceUser[];
    theme?: AppTheme;
    viewMode?: ViewMode;
    isGraphOpen?: boolean;
    isAiOpen?: boolean;
    onOpenSettings: () => void;
    onSelectNote: (path: string) => void;
    onVaultChange: (vault: VaultConfig) => void;
    onOpenPairModal: () => void;
    onRefreshItems: () => void;
    onItemDeleted?: () => void;
    onOpenCommandPalette?: () => void;
    onCreateNote?: (folder?: string) => void;
    onToggleGraph?: () => void;
    onToggleAi?: () => void;
    onToggleTheme?: () => void;
    onViewModeChange?: (mode: ViewMode) => void;
    onPanelVisibilityChange?: (visible: boolean) => void;
  }>();

  const narrow = new MediaQuery('(max-width: 760px)');
  const shortcutLabel = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  let collapsed = $state(false);
  let mobileOpen = $state(false);
  let vaultMenuOpen = $state(false);
  let vaultError = $state('');
  let collapsedFolders = $state(new Set<string>());
  let syncing = $state(false);
  let sidebarElement = $state<HTMLElement>();
  let toggleElement = $state<HTMLButtonElement>();
  let menu = $state<{ item: VaultItem; x: number; y: number } | null>(null);
  let menuElement = $state<HTMLDivElement>();
  let menuTrigger: HTMLElement | null = null;
  let dialog = $state<{ kind: 'folder' | 'rename' | 'delete'; path: string } | null>(null);
  let dialogName = $state('');
  let dialogError = $state('');
  let dialogBusy = $state(false);
  let dialogElement = $state<HTMLDivElement>();

  const railWidth = $derived(narrow.current ? 72 : 84);
  const expansion = new Spring(1, { stiffness: .075, damping: .8, precision: .001 });
  const drawer = new Spring(0, { stiffness: .075, damping: .8, precision: .001 });
  const expansionRatio = $derived(Math.max(0, Math.min(1, expansion.current)));
  const frameWidth = $derived(narrow.current ? railWidth : railWidth + (280 - railWidth) * expansionRatio);
  const panelWidth = $derived(56 + (260 - 56) * expansionRatio);
  const contentOpacity = $derived(narrow.current ? 1 : Math.max(0, (expansionRatio - .6) / .4));
  const railOpacity = $derived(narrow.current ? 1 : Math.max(0, 1 - expansionRatio / .6));
  let panelClosed = $derived(narrow.current ? !mobileOpen : collapsed);
  let rows = $derived(visibleNoteRows(items, collapsedFolders));
  let noteCount = $derived(items.filter((item: VaultItem) => !item.is_dir).length);

  $effect(() => {
    onPanelVisibilityChange?.(!panelClosed);
  });

  $effect(() => {
    const instant = prefersReducedMotion.current;
    void expansion.set(collapsed ? 0 : 1, { instant });
    void drawer.set(mobileOpen ? 1 : 0, { instant });
  });

  $effect(() => {
    if (!narrow.current || !mobileOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => sidebarElement?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => (previous?.isConnected ? previous : toggleElement)?.focus();
  });

  $effect(() => {
    if (!menu) return;
    void tick().then(() => menuElement?.querySelector<HTMLButtonElement>('button')?.focus());
  });

  $effect(() => {
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => {
      const control = dialogElement?.querySelector<HTMLInputElement>('input') ?? dialogElement?.querySelector<HTMLButtonElement>('.apple-dialog-cancel');
      control?.focus();
      if (control instanceof HTMLInputElement) control.select();
    });
    return () => (previous?.isConnected ? previous : menuTrigger)?.focus();
  });

  function toggleSidebar() {
    vaultMenuOpen = false;
    closeMenu();
    if (narrow.current) mobileOpen = !mobileOpen;
    else {
      collapsed = !collapsed;
      void tick().then(() => {
        if (collapsed) toggleElement?.focus();
        else sidebarElement?.querySelector<HTMLButtonElement>('button')?.focus();
      });
    }
  }

  function run(action?: () => void) {
    action?.();
    mobileOpen = false;
    vaultMenuOpen = false;
  }

  function showNotes(fromRail = false) {
    if (isGraphOpen) onToggleGraph?.();
    if (fromRail) {
      if (narrow.current) mobileOpen = true;
      else {
        collapsed = false;
        void tick().then(() => sidebarElement?.querySelector<HTMLButtonElement>('button')?.focus());
      }
    }
    else mobileOpen = false;
  }

  function toggleFolder(path: string) {
    const next = new Set(collapsedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedFolders = next;
  }

  async function chooseVault(vault?: VaultConfig) {
    vaultMenuOpen = false;
    vaultError = '';
    try {
      const path = vault?.path ?? await pickVaultDirectory();
      if (!path) return;
      const result = await selectVault(path);
      if (result.active_vault) {
        collapsedFolders = new Set();
        onVaultChange(result.active_vault);
        mobileOpen = false;
      }
    } catch (error) {
      vaultError = trError(String(error));
      vaultMenuOpen = true;
    }
  }

  function openMenu(item: VaultItem, event: MouseEvent) {
    menuTrigger = event.currentTarget as HTMLElement;
    const rect = menuTrigger.getBoundingClientRect();
    menu = { item, x: Math.max(8, Math.min(rect.right - 184, window.innerWidth - 192)), y: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 154)) };
  }

  function closeMenu(restoreFocus = false) {
    menu = null;
    if (restoreFocus) menuTrigger?.focus();
  }

  function openDialog(kind: 'folder' | 'rename' | 'delete', path = '') {
    closeMenu();
    dialogName = kind === 'rename' ? path : '';
    dialogError = '';
    dialog = { kind, path };
  }

  async function submitDialog(event: SubmitEvent) {
    event.preventDefault();
    if (!dialog || dialogBusy || (dialog.kind !== 'delete' && !dialogName.trim())) return;
    const action = dialog;
    dialogBusy = true;
    dialogError = '';
    try {
      if (action.kind === 'folder') await createFolder(dialogName.trim());
      else if (action.kind === 'delete') {
        await deleteItem(action.path);
        onItemDeleted?.();
      } else {
        const newPath = dialogName.trim();
        await renameItem(action.path, newPath);
        if (selectedPath === action.path) onSelectNote(newPath);
      }
      onRefreshItems();
      dialog = null;
    } catch (error) {
      dialogError = trError(String(error));
    } finally {
      dialogBusy = false;
    }
  }

  async function sync() {
    if (syncing) return;
    syncing = true;
    try { await networkSyncNow(); }
    catch (error) { console.error(error); }
    finally { syncing = false; }
  }

  function trapFocus(event: KeyboardEvent, element?: HTMLElement) {
    if (event.key !== 'Tab' || !element) return;
    const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (dialog) {
      if (event.key === 'Escape' && !dialogBusy) { event.preventDefault(); dialog = null; }
      trapFocus(event, dialogElement);
    } else if (menu) {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
      const controls = Array.from(menuElement?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus();
      }
      if (event.key === 'Tab' && ((event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1))) closeMenu(true);
    } else if (vaultMenuOpen && event.key === 'Escape') {
      event.preventDefault();
      vaultMenuOpen = false;
      sidebarElement?.querySelector<HTMLButtonElement>('.apple-vault-button')?.focus();
    } else if (narrow.current && mobileOpen) {
      if (event.key === 'Escape') { event.preventDefault(); mobileOpen = false; }
      trapFocus(event, sidebarElement);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={(event) => {
  const target = event.target as Element | null;
  if (!target?.closest('.apple-note-menu, .apple-note-more')) closeMenu();
  if (!target?.closest('.apple-vault-switcher')) vaultMenuOpen = false;
}} />

{#snippet navigation(rail = false)}
  <nav class:rail class="apple-sidebar-navigation" aria-label={$t('sidebar.navigation')}>
    <button class:current={!isGraphOpen} aria-current={!isGraphOpen ? 'page' : undefined} onclick={() => showNotes(rail)} title={$t('sidebar.allNotes')}>
      <FileText size={17} strokeWidth={1.8} />
      <span>{$t('sidebar.allNotes')}</span>
      <small>{noteCount}</small>
    </button>
    <button class:current={isGraphOpen} aria-current={isGraphOpen ? 'page' : undefined} onclick={() => run(onToggleGraph)} title={$t('graph.title')}>
      <Network size={17} strokeWidth={1.8} />
      <span>{$t('graph.title')}</span>
    </button>
    <button class:assistant-active={isAiOpen} aria-pressed={isAiOpen} onclick={() => run(onToggleAi)} title={$t('ai.title')}>
      <Sparkles size={17} strokeWidth={1.8} />
      <span>{$t('ai.title')}</span>
      <i class:visible={isAiOpen} aria-hidden="true"></i>
    </button>
  </nav>
{/snippet}

<div class="apple-sidebar-frame" style:width="{frameWidth}px">
  <div use:liquidGlass={{ active: narrow.current }} class="apple-sidebar-rail" class:desktop={!narrow.current} inert={narrow.current ? mobileOpen : !collapsed} style:opacity={railOpacity}>
    <button bind:this={toggleElement} class="apple-icon-button" onclick={toggleSidebar} aria-label={$t('sidebar.expandSidebar')} title={$t('sidebar.expandSidebar')} aria-expanded={!panelClosed} aria-controls="apple-sidebar-panel"><PanelLeft size={19} /></button>
    <button class="apple-compose rail-compose" onclick={() => run(() => onCreateNote?.())} title={$t('sidebar.newNote')} aria-label={$t('sidebar.newNote')}><Plus size={20} strokeWidth={2.4} /></button>
    <button class="apple-icon-button rail-search" onclick={() => run(onOpenCommandPalette)} title={$t('sidebar.searchPlaceholder')} aria-label={$t('sidebar.searchPlaceholder')}><Search size={18} /></button>
    {@render navigation(true)}
    <div class="apple-rail-footer">
      <button class="apple-icon-button" onclick={() => run(onOpenPairModal)} title={$t('sidebar.manageConnections')} aria-label={$t('sidebar.manageConnections')}><span class="apple-sync-dot" class:online={peerCount > 0} class:sync-error={syncStatus === 'error'}></span></button>
      <button class="apple-icon-button" onclick={onToggleTheme} title={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')} aria-label={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')}>{#if theme === 'dark'}<Sun size={18} />{:else}<Moon size={18} />{/if}</button>
      <button class="apple-icon-button" onclick={() => run(onOpenSettings)} title={$t('settings.title')} aria-label={$t('settings.title')}><Settings2 size={18} /></button>
    </div>
  </div>

  {#if narrow.current && (mobileOpen || drawer.current > .001)}
    <button class="apple-sidebar-scrim" tabindex="-1" aria-label={$t('sidebar.collapseSidebar')} onclick={() => mobileOpen = false} style:opacity={drawer.current}></button>
  {/if}

  <aside use:liquidGlass={{ active: !narrow.current || mobileOpen || drawer.current > .001 }} bind:this={sidebarElement} id="apple-sidebar-panel" class="apple-sidebar-panel" class:mobile={narrow.current} class:desktop={!narrow.current}
    inert={panelClosed} role={narrow.current ? 'dialog' : undefined} aria-modal={narrow.current && mobileOpen && !dialog && !menu ? true : undefined}
    aria-label={$t('sidebar.navigation')} style:opacity={narrow.current ? drawer.current : 1}
    style:width={narrow.current ? undefined : `${panelWidth}px`}
    style:border-radius={narrow.current ? undefined : `${28 - 2 * expansionRatio}px`}
    style:visibility={narrow.current && panelClosed && drawer.current <= .001 ? 'hidden' : undefined}
    style:transform={narrow.current ? `translateX(${(1 - drawer.current) * 8}px) scale(${.97 + .03 * drawer.current})` : undefined}>

    <div class="apple-sidebar-expanded-content" style:opacity={contentOpacity}>

    <!-- Topbar: App Identity & Collapse -->
    <header class="apple-sidebar-header">
      <span class="apple-app-mark"><NotebookPen size={19} strokeWidth={1.8} /></span>
      <div class="apple-app-name">
        <strong>LowNotes</strong>
        <span>{$t('sidebar.personalSpace')}</span>
      </div>
      <button class="apple-icon-button" onclick={toggleSidebar} title={$t('sidebar.collapseSidebar')} aria-label={$t('sidebar.collapseSidebar')} aria-expanded={!panelClosed} aria-controls="apple-sidebar-panel"><PanelLeftClose size={18} /></button>
    </header>

    <!-- Vault Switcher Card -->
    <div class="apple-vault-switcher">
      <button class="apple-vault-button" onclick={() => vaultMenuOpen = !vaultMenuOpen} aria-expanded={vaultMenuOpen}>
        <span class="apple-vault-icon"><FolderOpen size={17} strokeWidth={1.8} /></span>
        <span class="apple-vault-meta">
          <strong>{activeVault?.name ?? $t('sidebar.selectVault')}</strong>
          <small>{$t('sidebar.localVault')}</small>
        </span>
        <ChevronsUpDown size={14} class="apple-vault-chevron" />
      </button>
      {#if vaultMenuOpen}
        <div use:liquidGlass class="apple-vault-menu" transition:fade={{ duration: prefersReducedMotion.current ? 0 : 120 }}>
          <span class="apple-section-label">{$t('sidebar.yourVaults')}</span>
          {#each vaults as vault (vault.id)}
            <button onclick={() => void chooseVault(vault)}>
              <Folder size={15} />
              <span>{vault.name}</span>
              {#if vault.id === activeVault?.id}<Check size={14} />{/if}
            </button>
          {/each}
          <button class="apple-vault-open" onclick={() => void chooseVault()}>
            <FolderPlus size={15} />
            <span>{$t('sidebar.openComputerFolder')}</span>
          </button>
          {#if vaultError}<p class="apple-danger p-2 text-xs" role="alert">{vaultError}</p>{/if}
        </div>
      {/if}
    </div>

    <!-- Quick Action Bar: Search & New Note Hero Button -->
    <div class="apple-sidebar-quick-actions">
      <button class="apple-sidebar-search" onclick={() => run(onOpenCommandPalette)} title={$t('sidebar.searchPlaceholder')} aria-label={$t('sidebar.searchPlaceholder')}>
        <Search size={15} class="apple-search-icon" />
        <span>{$t('sidebar.searchPlaceholder')}</span>
        <kbd>{shortcutLabel}</kbd>
      </button>

      <button class="apple-compose" onclick={() => run(() => onCreateNote?.())} title={$t('sidebar.newNote')} aria-label={$t('sidebar.newNote')}>
        <div class="apple-compose-badge">
          <Plus size={15} strokeWidth={2.6} />
        </div>
        <span>{$t('sidebar.newNote')}</span>
      </button>
    </div>

    <!-- Navigation Section -->
    <div class="apple-navigation-area">
      {@render navigation()}
    </div>

    <!-- Notes Library Tree -->
    <section class="apple-library" aria-label={$t('sidebar.library')}>
      <div class="apple-library-heading">
        <span class="apple-section-label">{$t('sidebar.library')}</span>
        <button class="apple-icon-button" onclick={() => openDialog('folder')} title={$t('sidebar.newFolder')} aria-label={$t('sidebar.newFolder')}>
          <FolderPlus size={15} />
        </button>
      </div>

      <div class="apple-note-tree">
        {#if rows.length === 0}
          <div class="apple-library-empty">
            <FolderOpen size={26} strokeWidth={1.25} />
            <p>{$t('sidebar.noNotesInVault')}</p>
          </div>
        {/if}
        {#each rows as { item, depth } (item.path)}
          {@const selected = item.path === selectedPath && !isGraphOpen}
          {@const peerEditing = presence.find((person: PresenceUser) => person.notePath === item.path)}
          <div class="apple-note-row" class:selected style:--note-depth={depth} transition:fade={{ duration: prefersReducedMotion.current ? 0 : 120 }}>
            <button class="apple-note-button" onclick={() => item.is_dir ? toggleFolder(item.path) : run(() => onSelectNote(item.path))}
              aria-expanded={item.is_dir ? !collapsedFolders.has(item.path) : undefined} aria-current={selected ? 'page' : undefined} title={item.path}>
              {#if item.is_dir}
                <ChevronRight size={13} class={collapsedFolders.has(item.path) ? 'apple-folder-chevron' : 'apple-folder-chevron open'} />
                {#if collapsedFolders.has(item.path)}<Folder size={15} strokeWidth={1.8} />{:else}<FolderOpen size={15} strokeWidth={1.8} />{/if}
              {:else}
                <FileText size={15} strokeWidth={1.8} />
              {/if}
              <span class="apple-note-text">{item.is_dir ? item.name : item.title}</span>
              {#if peerEditing}<i class="apple-peer-dot" style:background={peerEditing.color} title={$t('presence.editingNote', { name: peerEditing.name, note: peerEditing.notePath })}></i>{/if}
            </button>
            <button class="apple-note-more apple-icon-button" onclick={(event) => openMenu(item, event)} aria-label={$t('sidebar.noteActions', { name: item.is_dir ? item.name : item.title })} aria-expanded={menu?.item.path === item.path} title={$t('sidebar.noteActions', { name: item.is_dir ? item.name : item.title })}><MoreHorizontal size={15} /></button>
          </div>
        {/each}
      </div>
    </section>

    <!-- Document View Mode (Segmented Glass Control) -->
    {#if selectedPath && !isGraphOpen}
      <div class="apple-sidebar-view">
        <span class="apple-section-label">{$t('editor.viewMode')}</span>
        <ViewModeControl value={viewMode} onchange={(mode) => onViewModeChange?.(mode)} />
      </div>
    {/if}

    <!-- Collaborative Presence Pills -->
    {#if presence.length > 0}
      <div class="apple-presence">
        {#each presence.slice(0, 3) as person (person.deviceId)}
          <span title={$t('presence.editingNote', { name: person.name, note: person.notePath })}>
            <i style:background={person.color}></i>
            {person.name}
          </span>
        {/each}
      </div>
    {/if}

    <!-- Footer Dock: P2P Status, Settings, Theme Toggle -->
    <footer class="apple-sidebar-footer">
      <div class="apple-sync-status">
        <button onclick={() => run(onOpenPairModal)} title={$t('sidebar.manageConnections')}>
          <span class="apple-sync-dot" class:online={peerCount > 0} class:sync-error={syncStatus === 'error'} class:syncing={syncStatus === 'syncing'}></span>
          <span>{syncStatus === 'error' ? $t('sidebar.syncError') : syncStatus === 'syncing' ? $t('sidebar.syncing') : peerCount > 0 ? $t('sidebar.pairedMany', { count: peerCount }) : $t('sidebar.localOnly')}</span>
        </button>
        <button class="apple-icon-button" onclick={() => void sync()} disabled={syncing} title={$t('sidebar.syncNow')} aria-label={$t('sidebar.syncNow')}>
          <RefreshCw size={13} class={syncing || syncStatus === 'syncing' ? 'apple-sync-spinning' : ''} />
        </button>
      </div>
      <div class="apple-sidebar-preferences">
        <button class="apple-settings-link" onclick={() => run(onOpenSettings)}>
          <Settings2 size={16} strokeWidth={1.8} />
          <span>{$t('settings.title')}</span>
        </button>
        <button class="apple-icon-button apple-theme-toggle" onclick={onToggleTheme} title={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')} aria-label={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')}>
          {#if theme === 'dark'}<Sun size={16} />{:else}<Moon size={16} />{/if}
        </button>
      </div>
    </footer>
    </div>
  </aside>
</div>

<!-- Context Menu -->
{#if menu}
  <div bind:this={menuElement} use:liquidGlass class="apple-note-menu" style:left="{menu.x}px" style:top="{menu.y}px" transition:fade={{ duration: prefersReducedMotion.current ? 0 : 100 }}>
    {#if menu.item.is_dir}<button onclick={() => { const folder = menu!.item.path; closeMenu(); run(() => onCreateNote?.(`${folder}/`)); }}><Plus size={15} />{$t('sidebar.newNote')}</button>{/if}
    <button onclick={() => openDialog('rename', menu!.item.path)}><Pencil size={15} />{$t('sidebar.rename')}</button>
    <button class="apple-danger" onclick={() => openDialog('delete', menu!.item.path)}><Trash2 size={15} />{$t('sidebar.delete')}</button>
  </div>
{/if}

<!-- Modals -->
{#if dialog}
  <div class="apple-sidebar-dialog-backdrop" data-modal-backdrop="apple-library" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !dialogBusy) dialog = null; }} transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}>
    <div bind:this={dialogElement} class="apple-sidebar-dialog" use:liquidGlass role="dialog" aria-modal="true" aria-labelledby="apple-sidebar-dialog-title" aria-busy={dialogBusy} tabindex="-1">
    <form onsubmit={submitDialog}>
      <div class="apple-sidebar-dialog-heading">
        <span class="apple-dialog-symbol" class:apple-danger={dialog.kind === 'delete'}>
          {#if dialog.kind === 'delete'}<Trash2 size={22} />{:else if dialog.kind === 'folder'}<FolderPlus size={22} />{:else}<Pencil size={22} />{/if}
        </span>
        <button type="button" class="apple-icon-button" disabled={dialogBusy} onclick={() => dialog = null} aria-label={$t('ai.close')}><X size={17} /></button>
      </div>
      <h2 id="apple-sidebar-dialog-title">{$t(dialog.kind === 'folder' ? 'sidebar.newFolder' : dialog.kind === 'rename' ? 'sidebar.rename' : 'sidebar.delete')}</h2>
      {#if dialog.kind === 'delete'}
        <p>{$t('sidebar.confirmDelete', { path: dialog.path })}</p>
      {:else}
        <label for="apple-sidebar-name">{$t(dialog.kind === 'folder' ? 'sidebar.folderNamePlaceholder' : 'sidebar.renamePrompt')}</label>
        <input id="apple-sidebar-name" bind:value={dialogName} required disabled={dialogBusy} autocomplete="off" />
      {/if}
      {#if dialogError}<p class="apple-danger" role="alert">{dialogError}</p>{/if}
      <div class="apple-sidebar-dialog-actions">
        <button type="button" class="apple-dialog-cancel" disabled={dialogBusy} onclick={() => dialog = null}>{$t('sidebar.cancel')}</button>
        <button type="submit" class="apple-compose" class:destructive={dialog.kind === 'delete'} disabled={dialogBusy || (dialog.kind !== 'delete' && !dialogName.trim())}>
          {$t(dialog.kind === 'delete' ? 'sidebar.delete' : dialog.kind === 'rename' ? 'sidebar.rename' : 'sidebar.create')}
        </button>
      </div>
    </form>
    </div>
  </div>
{/if}

<style>
  .apple-sidebar-frame {
    position: relative;
    flex: 0 0 auto;
    height: var(--sidebar-frame-height, 100%);
    overflow: hidden;
    background: transparent !important;
    border-right: none !important;
    font-family: var(--apple-font);
    font-size: 0.8125rem;
    letter-spacing: 0;
  }

  /* Liquid Glass Main Panel */
  .apple-sidebar-panel {
    display: flex;
    flex-direction: column;
    position: absolute;
    inset: 0 auto 0 0;
    width: 280px;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.55) 0%, rgba(235, 246, 250, 0.38) 100%);
    backdrop-filter: blur(36px) saturate(190%) contrast(104%);
    -webkit-backdrop-filter: blur(36px) saturate(190%) contrast(104%);
    color: var(--text-main);
    isolation: isolate;
    border-right: 1px solid rgba(255, 255, 255, 0.45);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65), inset -1px 0 0 rgba(255, 255, 255, 0.20), 12px 0 35px rgba(0, 0, 0, 0.04);
  }

  .apple-sidebar-expanded-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  .desktop .apple-sidebar-expanded-content { width: 260px; min-width: 260px; }
  .apple-sidebar-panel.desktop { overflow: hidden; z-index: 1; }
  .apple-sidebar-rail.desktop { z-index: 2; }

  :root[data-theme="dark"] .apple-sidebar-panel {
    background: linear-gradient(145deg, rgba(15, 24, 33, 0.45) 0%, rgba(10, 18, 26, 0.35) 100%);
    border-right: 1px solid var(--glass-border, rgba(255, 255, 255, 0.09));
    box-shadow: inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.12)), 16px 0 50px rgba(0, 0, 0, 0.35);
  }

  /* Top glass sheen */
  .apple-sidebar-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: radial-gradient(ellipse at 15% 0%, rgba(255, 255, 255, 0.45), transparent 60%);
  }

  :root[data-theme="dark"] .apple-sidebar-panel::before {
    background: radial-gradient(ellipse at 15% 0%, rgba(112, 201, 238, 0.14), transparent 60%);
  }

  button {
    cursor: pointer;
    border: 0;
    transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  button:not(:disabled):active {
    transform: scale(0.965);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible, input:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }

  /* Header */
  .apple-sidebar-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 1.125rem 1rem 0.875rem;
    flex: 0 0 auto;
  }
  .apple-app-mark {
    display: grid;
    place-items: center;
    width: 2.125rem;
    height: 2.125rem;
    border-radius: 0.6875rem;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, rgba(255, 255, 255, 0.15));
    border: 1px solid color-mix(in srgb, var(--accent) 30%, rgba(255, 255, 255, 0.4));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 2px 8px var(--accent-glow);
  }
  .apple-app-name {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.0625rem;
  }
  .apple-app-name strong {
    font-family: var(--apple-display);
    font-size: 1rem;
    line-height: 1.25;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: var(--text-main);
  }
  .apple-app-name > span {
    font-size: 0.6875rem;
    color: var(--text-muted);
    letter-spacing: 0.01em;
  }

  /* Glass Icon Button */
  .apple-icon-button {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5625rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-icon-button:hover {
    background: color-mix(in srgb, var(--text-main) 8%, rgba(255, 255, 255, 0.12));
    border-color: color-mix(in srgb, var(--text-main) 12%, rgba(255, 255, 255, 0.2));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
    color: var(--text-main);
  }

  /* Vault Switcher Card */
  .apple-vault-switcher {
    position: relative;
    margin: 0 0.875rem 0.75rem;
    flex: 0 0 auto;
  }
  .apple-vault-button {
    display: flex;
    align-items: center;
    gap: 0.6875rem;
    width: 100%;
    padding: 0.625rem 0.875rem;
    text-align: left;
    border-radius: 1rem; /* 16px */
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.02) 100%),
      var(--glass-control-bg, rgba(255, 255, 255, 0.055));
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 0;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.14)),
      inset 0 -1px 0.5px rgba(0, 0, 0, 0.08),
      0 4px 16px rgba(0, 0, 0, 0.05);
    color: var(--text-muted);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-vault-button:hover {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.04) 100%),
      var(--glass-control-hover, rgba(255, 255, 255, 0.095));
    border-color: transparent;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.2)),
      0 8px 24px var(--accent-glow, rgba(0, 110, 160, 0.15));
    transform: translateY(-0.5px);
  }
  .apple-vault-icon {
    width: 2rem;
    height: 2rem;
    border-radius: 0.6875rem;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, rgba(255, 255, 255, 0.08) 100%),
      color-mix(in srgb, var(--accent) 22%, transparent);
    border: 0;
    box-shadow:
      inset 0 1px 0.5px rgba(255, 255, 255, 0.8),
      0 2px 6px rgba(0, 0, 0, 0.08);
    color: var(--accent);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .apple-vault-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.0625rem;
  }
  .apple-vault-meta strong {
    color: var(--text-main);
    font-size: 0.8125rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }
  .apple-vault-meta small {
    font-size: 0.625rem;
    letter-spacing: 0.01em;
    color: var(--text-muted);
  }
  :global(.apple-vault-chevron) {
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .apple-vault-menu {
    position: absolute;
    top: calc(100% + 0.375rem);
    inset-inline: 0;
    z-index: 50;
    max-height: 18rem;
    overflow-y: auto;
    padding: 0.5rem;
    border-radius: 1.125rem;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.03) 100%),
      rgba(15, 24, 33, 0.65);
    backdrop-filter: blur(32px) saturate(190%);
    -webkit-backdrop-filter: blur(32px) saturate(190%);
    border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.18)),
      0 20px 52px rgba(0, 0, 0, 0.3);
  }
  .apple-vault-menu > .apple-section-label {
    display: block;
    padding: 0.375rem 0.5rem;
  }
  .apple-vault-menu button {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.5625rem 0.75rem;
    text-align: left;
    color: var(--text-main);
    border-radius: 0.6875rem;
    font-size: 0.8125rem;
    font-weight: 500;
    transition: all 0.15s ease;
  }
  .apple-vault-menu button span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .apple-vault-menu button:hover {
    background: color-mix(in srgb, var(--accent) 18%, rgba(255, 255, 255, 0.15));
    color: var(--accent);
  }
  .apple-vault-open {
    margin-top: 0.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.2) !important;
  }

  /* Quick Actions */
  .apple-sidebar-quick-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0.875rem;
    flex: 0 0 auto;
  }

  /* Spotlight Search Capsule (Direct Reference: Image 2 & 4) */
  .apple-sidebar-search {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0 0.875rem;
    height: 2.375rem;
    border-radius: 9999px; /* Seamless Capsule */
    color: var(--text-muted);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.02) 100%),
      var(--glass-control-bg, rgba(255, 255, 255, 0.055));
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    border: 0;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.14)),
      inset 0 -1px 0.5px rgba(0, 0, 0, 0.08),
      0 4px 14px rgba(0, 0, 0, 0.06);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-sidebar-search:hover {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.04) 100%),
      var(--glass-control-hover, rgba(255, 255, 255, 0.095));
    border-color: transparent;
    color: var(--text-main);
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.2)),
      0 6px 20px var(--accent-glow, rgba(0, 110, 160, 0.15));
    transform: translateY(-0.5px);
  }
  .apple-sidebar-search > span {
    flex: 1;
    text-align: left;
    font-size: 0.75rem;
    font-weight: 500;
  }
  kbd {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.08);
    border: 0;
    box-shadow: inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.14));
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  /* Liquid Glass Hero Compose Capsule (Direct Reference: Image 1 & 2) */
  .apple-compose {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.75rem;
    padding: 0.375rem 1.125rem 0.375rem 0.4375rem;
    border-radius: 9999px; /* Seamless continuous capsule */
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.08) 45%, rgba(0, 0, 0, 0.08) 100%),
      var(--accent);
    color: var(--accent-contrast, #ffffff);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: -0.015em;
    border: 0;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.4),
      inset 0 -1.5px 1px 0 rgba(0, 0, 0, 0.22),
      0 8px 24px -4px var(--accent-glow, rgba(0, 110, 160, 0.4)),
      0 2px 8px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(24px) saturate(190%) contrast(105%);
    -webkit-backdrop-filter: blur(24px) saturate(190%) contrast(105%);
    transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-compose:hover {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.36) 0%, rgba(255, 255, 255, 0.12) 45%, rgba(0, 0, 0, 0.06) 100%),
      var(--accent-light, var(--accent));
    border-color: transparent;
    box-shadow:
      inset 0 1.5px 0 rgba(255, 255, 255, 0.55),
      0 12px 32px -4px var(--accent-glow, rgba(0, 110, 160, 0.55)),
      0 4px 12px rgba(0, 0, 0, 0.12);
    transform: translateY(-1px);
  }
  .apple-compose:active {
    transform: scale(0.965);
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.3),
      0 2px 8px var(--accent-glow, rgba(0, 110, 160, 0.2));
  }
  /* Elevated 3D Convex Glass Lens Orb inside Compose (Reference: Image 1 & 3) */
  .apple-compose-badge {
    width: 1.875rem;
    height: 1.875rem;
    border-radius: 50%;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.12) 100%),
      rgba(255, 255, 255, 0.12);
    border: 0;
    display: grid;
    place-items: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 -1px 1px 0 rgba(0, 0, 0, 0.2),
      0 3px 8px rgba(0, 0, 0, 0.2);
    color: var(--accent-contrast, #ffffff);
    flex-shrink: 0;
  }
  .apple-compose > span {
    flex: 1;
    text-align: left;
  }

  /* Navigation Area */
  .apple-navigation-area {
    padding: 0.875rem 0.875rem 0.625rem;
    flex: 0 0 auto;
  }
  .apple-sidebar-navigation {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.3125rem;
  }
  .apple-sidebar-navigation > button {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    height: 2.4375rem;
    padding: 0 0.875rem;
    border-radius: 9999px; /* Smooth capsule pills */
    background: transparent;
    border: 0;
    color: var(--text-muted);
    text-align: left;
    font-size: 0.8125rem;
    font-weight: 500;
    transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-sidebar-navigation > button:hover {
    background: var(--glass-control-hover, rgba(255, 255, 255, 0.08));
    color: var(--text-main);
    border-color: transparent;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.12));
  }
  .apple-sidebar-navigation > button > span {
    flex: 1;
  }
  .apple-sidebar-navigation > button.current,
  .apple-sidebar-navigation > button.assistant-active {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.02) 100%),
      color-mix(in srgb, var(--accent) 20%, transparent);
    border: 0;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.15)),
      0 4px 18px var(--accent-glow, rgba(0, 110, 160, 0.25));
    color: var(--accent);
    font-weight: 600;
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
  }
  .apple-sidebar-navigation small {
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 0.125rem 0.5625rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.08);
    border: 0;
    color: var(--accent);
    box-shadow: inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.12));
  }
  .apple-sidebar-navigation i {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .apple-sidebar-navigation i.visible {
    opacity: 1;
  }

  /* Library / Note Tree */
  .apple-library {
    display: flex;
    flex-direction: column;
    min-height: 3rem;
    flex: 1;
    overflow: hidden;
    padding-inline: 0.875rem;
  }
  .apple-library-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.5rem 0.375rem;
    border-top: 1px solid var(--apple-hairline, rgba(255, 255, 255, 0.08));
  }
  .apple-library-heading .apple-icon-button {
    width: 1.75rem;
    height: 1.75rem;
  }
  .apple-section-label {
    font-size: 0.625rem;
    line-height: 1.4;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .apple-note-tree {
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0.1875rem 0.0625rem 0.75rem;
    scrollbar-width: thin;
    mask-image: linear-gradient(to bottom, #000 calc(100% - 12px), transparent);
  }
  .apple-note-row {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    border-radius: 0.625rem;
    min-height: 2.125rem;
    margin-bottom: 0.125rem;
    padding-left: min(calc(var(--note-depth) * 0.875rem), 7rem);
    border: 0;
    transition: all 0.15s ease;
  }
  .apple-note-row:hover,
  .apple-note-row:focus-within {
    background: var(--glass-control-hover, rgba(255, 255, 255, 0.08));
    border-color: transparent;
    backdrop-filter: blur(8px);
  }
  .apple-note-row.selected {
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 18%, rgba(255, 255, 255, 0.06)), color-mix(in srgb, var(--accent) 6%, transparent));
    border: 0;
    box-shadow: inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.12)), 0 2px 10px var(--accent-glow);
  }
  .apple-note-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
    min-height: 2.125rem;
    padding: 0.375rem 0.5rem;
    text-align: left;
    color: var(--text-muted);
    border-radius: 0.5rem;
  }
  .apple-note-button > :global(svg) {
    flex-shrink: 0;
  }
  .apple-note-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.78125rem;
    line-height: 1.4;
  }
  .apple-note-row.selected .apple-note-button {
    color: var(--text-main);
    font-weight: 600;
  }
  .apple-note-row.selected .apple-note-button > :global(svg),
  .apple-note-button[aria-expanded] > :global(svg:nth-child(2)) {
    color: var(--accent);
  }
  .apple-note-button > :global(.apple-folder-chevron) {
    color: var(--text-muted);
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-note-button > :global(.apple-folder-chevron.open) {
    transform: rotate(90deg);
  }
  .apple-note-more {
    width: 1.5rem;
    height: 1.75rem;
    margin-right: 0.25rem;
    opacity: 0;
  }
  .apple-note-row:hover .apple-note-more,
  .apple-note-row:focus-within .apple-note-more,
  .apple-note-more[aria-expanded='true'] {
    opacity: 1;
  }
  .apple-peer-dot {
    width: 0.4375rem;
    height: 0.4375rem;
    flex-shrink: 0;
    border-radius: 50%;
    box-shadow: 0 0 8px currentColor;
    margin-left: auto;
  }
  .apple-library-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: var(--text-muted);
    padding: 2rem 0.75rem;
    gap: 0.625rem;
  }
  .apple-library-empty > :global(svg) {
    opacity: 0.45;
  }
  .apple-library-empty p {
    font-size: 0.75rem;
  }

  /* View Mode */
  .apple-sidebar-view {
    padding: 0.625rem 1rem 0.875rem;
    flex: 0 0 auto;
  }
  .apple-sidebar-view > span {
    display: block;
    padding-bottom: 0.5rem;
    font-size: 0.5625rem;
  }

  /* Presence */
  .apple-presence {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 0.75rem;
    padding: 0.25rem 1.25rem 0.75rem;
    font-size: 0.625rem;
    color: var(--text-muted);
  }
  .apple-presence span {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
  }
  .apple-presence i {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
  }

  /* Footer Dock */
  .apple-sidebar-footer {
    flex: 0 0 auto;
    padding: 0.625rem 0.875rem 0.875rem;
    border-top: 1px solid var(--apple-hairline, rgba(255, 255, 255, 0.08));
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .apple-sync-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0.75rem;
    border-radius: 9999px; /* Seamless glass pill */
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 100%),
      var(--glass-control-bg, rgba(255, 255, 255, 0.055));
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 0;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.12)),
      inset 0 -1px 0.5px rgba(0, 0, 0, 0.08),
      0 4px 14px rgba(0, 0, 0, 0.05);
  }
  .apple-sync-status > button:first-child {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    min-height: 2rem;
    color: var(--text-muted);
    font-size: 0.6875rem;
    text-align: left;
  }
  .apple-sync-status > button:first-child:hover {
    color: var(--text-main);
  }
  .apple-sync-status > button:first-child > span:last-child {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .apple-sync-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-muted);
    transition: all 0.2s ease;
  }
  .apple-sync-dot.online {
    background: var(--success);
    box-shadow: 0 0 10px var(--success), 0 0 2px #fff;
  }
  .apple-sync-dot.sync-error {
    background: var(--danger);
    box-shadow: 0 0 10px var(--danger), 0 0 2px #fff;
  }
  .apple-sync-dot.syncing {
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent), 0 0 2px #fff;
  }
  .apple-sync-status :global(.apple-sync-spinning) {
    animation: apple-sync-rotation 1s linear infinite;
  }
  .apple-sidebar-preferences {
    display: flex;
    gap: 0.4375rem;
    align-items: center;
  }
  .apple-settings-link {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex: 1;
    padding: 0.5rem 0.875rem;
    border-radius: 9999px; /* Capsule pill */
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 100%),
      var(--glass-control-bg, rgba(255, 255, 255, 0.055));
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 0;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.12)),
      0 3px 10px rgba(0, 0, 0, 0.05);
    color: var(--text-muted);
    text-align: left;
    font-size: 0.8125rem;
    font-weight: 500;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-settings-link:hover {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.04) 100%),
      var(--glass-control-hover, rgba(255, 255, 255, 0.095));
    border-color: transparent;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.18)),
      0 6px 18px rgba(0, 0, 0, 0.1);
    color: var(--text-main);
    transform: translateY(-0.5px);
  }
  /* Circular 3D Glass Lens Button (Direct Reference: Image 1 & 5) */
  .apple-theme-toggle {
    width: 2.375rem;
    height: 2.375rem;
    border-radius: 50% !important; /* Perfect circle */
    border: 0;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.02) 100%),
      var(--glass-control-bg, rgba(255, 255, 255, 0.055));
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.14)),
      inset 0 -1px 0.5px rgba(0, 0, 0, 0.12),
      0 4px 14px rgba(0, 0, 0, 0.08);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    display: grid;
    place-items: center;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .apple-theme-toggle:hover {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.04) 100%),
      var(--glass-control-hover, rgba(255, 255, 255, 0.095));
    border-color: transparent;
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.2)),
      0 6px 20px var(--accent-glow, rgba(0, 110, 160, 0.2));
    color: var(--accent);
    transform: translateY(-0.5px);
  }

  /* Rail Mode (Collapsed Dock) */
  .apple-sidebar-rail {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 63px;
    padding-block: 1.25rem 0.75rem;
    gap: 0.875rem;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.60) 0%, rgba(235, 246, 250, 0.40) 100%);
    backdrop-filter: blur(36px) saturate(190%) contrast(104%);
    -webkit-backdrop-filter: blur(36px) saturate(190%) contrast(104%);
    border-right: 1px solid rgba(255, 255, 255, 0.45);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65), inset -1px 0 0 rgba(255, 255, 255, 0.2), 12px 0 35px rgba(0, 0, 0, 0.04);
  }
  :root[data-theme="dark"] .apple-sidebar-rail {
    background: linear-gradient(145deg, rgba(20, 38, 48, 0.62) 0%, rgba(13, 25, 33, 0.48) 100%);
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.20), inset -1px 0 0 rgba(255, 255, 255, 0.05), 16px 0 50px rgba(0, 0, 0, 0.35);
  }
  .rail-compose {
    padding: 0;
    width: 2.75rem;
    height: 2.75rem;
    min-height: 2.75rem;
    border-radius: 50% !important;
    display: grid;
    place-items: center;
  }
  .rail-search {
    margin-top: -0.25rem;
    border-radius: 50% !important;
  }
  .apple-sidebar-navigation.rail {
    width: 2.5rem;
  }
  .apple-sidebar-navigation.rail > button {
    justify-content: center;
    padding: 0;
    border-radius: 50% !important;
    width: 2.5rem;
    height: 2.5rem;
  }
  .apple-sidebar-navigation.rail > button > span,
  .apple-sidebar-navigation.rail small {
    display: none;
  }
  .apple-sidebar-navigation.rail i {
    position: absolute;
    bottom: 0.25rem;
    right: 0.25rem;
  }
  .apple-rail-footer {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-top: auto;
  }

  /* Popover Menus & Dialogs */
  .apple-note-menu {
    position: fixed;
    width: 184px;
    z-index: 90;
    padding: 0.4375rem;
    border-radius: 0.875rem;
    background: color-mix(in srgb, var(--bg-card) 85%, transparent);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .apple-note-menu button {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.5625rem 0.75rem;
    text-align: left;
    color: var(--text-main);
    border-radius: 0.5625rem;
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .apple-note-menu button:hover {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }
  .apple-danger {
    color: var(--danger) !important;
  }
  .apple-danger:hover {
    background: color-mix(in srgb, var(--danger) 15%, transparent) !important;
    color: var(--danger) !important;
  }

  /* Modals */
  .apple-sidebar-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: var(--apple-overlay);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
  .apple-sidebar-dialog {
    width: min(100%, 380px);
    padding: 1.5rem;
    border-radius: 1.25rem;
    background: color-mix(in srgb, var(--bg-card) 90%, transparent);
    backdrop-filter: blur(32px) saturate(180%);
    -webkit-backdrop-filter: blur(32px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .apple-sidebar-dialog-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .apple-dialog-symbol {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.875rem;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  }
  .apple-dialog-symbol.apple-danger {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
    border-color: color-mix(in srgb, var(--danger) 25%, transparent);
  }
  .apple-sidebar-dialog h2 {
    font-size: 1.375rem;
    letter-spacing: -0.025em;
    margin-bottom: 0.875rem;
    color: var(--text-main);
  }
  .apple-sidebar-dialog p,
  .apple-sidebar-dialog label {
    color: var(--text-muted);
    font-size: 0.8125rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .apple-sidebar-dialog label {
    display: block;
    margin-bottom: 0.375rem;
  }
  .apple-sidebar-dialog input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--text-main) 14%, rgba(255, 255, 255, 0.2));
    border-radius: 0.625rem;
    background: color-mix(in srgb, var(--bg-main) 70%, transparent);
    color: var(--text-main);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .apple-sidebar-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }
  .apple-dialog-cancel {
    border-radius: 9999px;
    padding: 0.5rem 1rem;
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, rgba(255, 255, 255, 0.15));
    border: 1px solid color-mix(in srgb, var(--text-main) 12%, rgba(255, 255, 255, 0.2));
    font-weight: 500;
  }
  .apple-dialog-cancel:hover {
    background: color-mix(in srgb, var(--text-main) 12%, rgba(255, 255, 255, 0.2));
  }
  .apple-compose.destructive {
    background: var(--control-danger, #c92e29);
    border-color: rgba(255, 255, 255, 0.3);
    box-shadow: 0 4px 14px rgba(201, 46, 41, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.4);
    color: #fff;
  }

  @keyframes apple-sync-rotation {
    to { transform: rotate(360deg); }
  }
  @media (hover: none) {
    .apple-note-more { opacity: 0.7; }
  }
  @media (pointer: coarse) {
    .apple-icon-button { min-height: 2.5rem; min-width: 2.5rem; }
    .apple-note-row, .apple-note-button { min-height: 2.75rem; }
    .apple-sidebar-navigation > button { height: 2.5rem; }
  }
  @media (max-height: 660px) {
    .apple-sidebar-header { padding-block: 0.75rem; }
    .apple-vault-switcher { margin-bottom: 0.625rem; }
    .apple-navigation-area { padding-block: 0.625rem 0.375rem; }
    .apple-sidebar-view { padding-block: 0.375rem; }
    .apple-sidebar-view > .apple-section-label { display: none; }
  }
  @media (max-height: 620px) {
    .apple-sidebar-panel { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .apple-sidebar-expanded-content { overflow-y: auto; overscroll-behavior: contain; }
    .apple-library { flex: 0 0 auto; overflow: visible; }
    .apple-note-tree { overflow: visible; mask-image: none; }
    .apple-sidebar-rail { overflow-y: auto; }
    .apple-rail-footer { padding-top: 1rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    button, .apple-note-button > :global(.apple-folder-chevron) { transition: none; }
    button:not(:disabled):active { transform: none; }
    .apple-sync-status :global(.apple-sync-spinning) { animation: none; }
  }
</style>
