<script lang="ts">
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import { fade } from 'svelte/transition';
  import {
    NotebookPen, PanelLeft, PanelLeftClose, Search, Plus, FileText, Folder,
    FolderOpen, FolderPlus, ChevronRight, ChevronsUpDown,
    Network, Sparkles, Settings2, Sun, Moon, RefreshCw, MoreHorizontal,
    Pencil, Trash2, Check, X, Columns2, Eye, FilePenLine,
  } from 'lucide-svelte';
  import type { AppTheme, ViewMode, VaultConfig, VaultItem } from '$lib/types';
  import type { PresenceUser } from '$lib/presence';
  import { visibleNoteRows } from '$lib/note-tree';
  import { createFolder, deleteItem, renameItem, pickVaultDirectory, selectVault, networkSyncNow } from '$lib/api';
  import { t, trError } from '$lib/i18n';

  let {
    activeVault, vaults, items, selectedPath, syncStatus, peerCount, presence = [],
    theme = 'light', viewMode = 'split', isGraphOpen = false, isAiOpen = false,
    onOpenSettings, onSelectNote, onVaultChange, onOpenPairModal, onRefreshItems,
    onItemDeleted, onOpenCommandPalette, onCreateNote, onToggleGraph, onToggleAi,
    onToggleTheme, onViewModeChange,
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
  }>();

  const narrow = new MediaQuery('(max-width: 760px)');
  const shortcutLabel = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  let collapsed = $state(false);
  let mobileOpen = $state(false);
  let vaultMenuOpen = $state(false);
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

  const width = new Spring(narrow.current ? 64 : 280, { stiffness: .18, damping: .85, precision: .1 });
  const expansion = new Spring(1, { stiffness: .2, damping: .9 });
  const drawer = new Spring(0, { stiffness: .2, damping: .9 });
  const selection = new Spring(0, { stiffness: .22, damping: .85 });
  const modeSelection = new Spring(1, { stiffness: .25, damping: .9 });
  let panelClosed = $derived(narrow.current ? !mobileOpen : collapsed);
  let rows = $derived(visibleNoteRows(items, collapsedFolders));
  let noteCount = $derived(items.filter((item: VaultItem) => !item.is_dir).length);
  let modes = $derived([
    { value: 'edit' as const, icon: FilePenLine, label: $t('editor.modeEdit') },
    { value: 'split' as const, icon: Columns2, label: $t('editor.modeSplit') },
    { value: 'preview' as const, icon: Eye, label: $t('editor.modePreview') },
  ]);

  // Retargeting a live Spring preserves its position and velocity, including rapid reversals.
  $effect(() => {
    const instant = prefersReducedMotion.current;
    void width.set(narrow.current || collapsed ? 64 : 280, { instant });
    void expansion.set(collapsed ? 0 : 1, { instant });
    void drawer.set(mobileOpen ? 1 : 0, { instant });
    void selection.set(isGraphOpen ? 1 : 0, { instant });
    void modeSelection.set(modes.findIndex((mode) => mode.value === viewMode), { instant });
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
      alert(trError(String(error)));
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
    <span class="apple-nav-selection" aria-hidden="true" style:transform="translateY(calc({selection.current} * 2.75rem))"></span>
    <button class:current={!isGraphOpen} aria-current={!isGraphOpen ? 'page' : undefined} onclick={() => showNotes(rail)} title={$t('sidebar.allNotes')}>
      <FileText size={18} strokeWidth={1.8} /><span>{$t('sidebar.allNotes')}</span><small>{noteCount}</small>
    </button>
    <button class:current={isGraphOpen} aria-current={isGraphOpen ? 'page' : undefined} onclick={() => run(onToggleGraph)} title={$t('graph.title')}>
      <Network size={18} strokeWidth={1.8} /><span>{$t('graph.title')}</span>
    </button>
    <button class:assistant-active={isAiOpen} aria-pressed={isAiOpen} onclick={() => run(onToggleAi)} title={$t('ai.title')}>
      <Sparkles size={18} strokeWidth={1.8} /><span>{$t('ai.title')}</span><i class:visible={isAiOpen} aria-hidden="true"></i>
    </button>
  </nav>
{/snippet}

<div class="apple-sidebar-frame" style:width="{width.current}px">
  <div class="apple-sidebar-rail" inert={narrow.current ? mobileOpen : !collapsed} style:opacity={narrow.current ? 1 : 1 - expansion.current}>
    <button bind:this={toggleElement} class="apple-icon-button" onclick={toggleSidebar} aria-label={$t('sidebar.expandSidebar')} title={$t('sidebar.expandSidebar')} aria-expanded={!panelClosed} aria-controls="apple-sidebar-panel"><PanelLeft size={20} /></button>
    <button class="apple-compose rail-compose" onclick={() => run(() => onCreateNote?.())} title={$t('sidebar.newNote')} aria-label={$t('sidebar.newNote')}><Plus size={20} /></button>
    <button class="apple-icon-button rail-search" onclick={() => run(onOpenCommandPalette)} title={$t('sidebar.searchPlaceholder')} aria-label={$t('sidebar.searchPlaceholder')}><Search size={19} /></button>
    {@render navigation(true)}
    <div class="apple-rail-footer">
      <button class="apple-icon-button" onclick={() => run(onOpenPairModal)} title={$t('sidebar.manageConnections')} aria-label={$t('sidebar.manageConnections')}><span class="apple-sync-dot" class:online={peerCount > 0} class:sync-error={syncStatus === 'error'}></span></button>
      <button class="apple-icon-button" onclick={onToggleTheme} title={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')} aria-label={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')}>{#if theme === 'dark'}<Sun size={19} />{:else}<Moon size={19} />{/if}</button>
      <button class="apple-icon-button" onclick={() => run(onOpenSettings)} title={$t('settings.title')} aria-label={$t('settings.title')}><Settings2 size={19} /></button>
    </div>
  </div>

  {#if narrow.current && (mobileOpen || drawer.current > .001)}
    <button class="apple-sidebar-scrim" tabindex="-1" aria-label={$t('sidebar.collapseSidebar')} onclick={() => mobileOpen = false} style:opacity={drawer.current}></button>
  {/if}

  <aside bind:this={sidebarElement} id="apple-sidebar-panel" class="apple-sidebar-panel" class:mobile={narrow.current}
    inert={panelClosed} role={narrow.current ? 'dialog' : undefined} aria-modal={narrow.current && mobileOpen && !dialog && !menu ? true : undefined}
    aria-label={$t('sidebar.navigation')} style:opacity={narrow.current ? 1 : expansion.current}
    style:transform={narrow.current ? `translateX(${(drawer.current - 1) * 100}%)` : undefined}>
    <header class="apple-sidebar-header">
      <span class="apple-app-mark"><NotebookPen size={20} strokeWidth={1.65} /></span>
      <div class="apple-app-name"><strong>LowNotes</strong><span>{$t('sidebar.personalSpace')}</span></div>
      <button class="apple-icon-button" onclick={toggleSidebar} title={$t('sidebar.collapseSidebar')} aria-label={$t('sidebar.collapseSidebar')} aria-expanded={!panelClosed} aria-controls="apple-sidebar-panel"><PanelLeftClose size={18} /></button>
    </header>

    <div class="apple-vault-switcher">
      <button class="apple-vault-button" onclick={() => vaultMenuOpen = !vaultMenuOpen} aria-expanded={vaultMenuOpen}>
        <span class="apple-vault-icon"><FolderOpen size={18} strokeWidth={1.7} /></span>
        <span><strong>{activeVault?.name ?? $t('sidebar.selectVault')}</strong><small>{$t('sidebar.localVault')}</small></span>
        <ChevronsUpDown size={14} />
      </button>
      {#if vaultMenuOpen}
        <div class="apple-vault-menu" transition:fade={{ duration: prefersReducedMotion.current ? 0 : 120 }}>
          <span class="apple-section-label">{$t('sidebar.yourVaults')}</span>
          {#each vaults as vault (vault.id)}
            <button onclick={() => void chooseVault(vault)}><Folder size={16} /><span>{vault.name}</span>{#if vault.id === activeVault?.id}<Check size={15} />{/if}</button>
          {/each}
          <button class="apple-vault-open" onclick={() => void chooseVault()}><FolderPlus size={16} /><span>{$t('sidebar.openComputerFolder')}</span></button>
        </div>
      {/if}
    </div>

    <div class="apple-sidebar-quick-actions">
      <button class="apple-sidebar-search" onclick={() => run(onOpenCommandPalette)}><Search size={16} /><span>{$t('sidebar.searchPlaceholder')}</span><kbd>{shortcutLabel}</kbd></button>
      <button class="apple-compose" onclick={() => run(() => onCreateNote?.())}><Plus size={17} strokeWidth={2} /><span>{$t('sidebar.newNote')}</span></button>
    </div>

    <div class="apple-navigation-area">{@render navigation()}</div>

    <section class="apple-library" aria-label={$t('sidebar.library')}>
      <div class="apple-library-heading"><span class="apple-section-label">{$t('sidebar.library')}</span><button class="apple-icon-button" onclick={() => openDialog('folder')} title={$t('sidebar.newFolder')} aria-label={$t('sidebar.newFolder')}><FolderPlus size={16} /></button></div>
      <div class="apple-note-tree">
        {#if rows.length === 0}
          <div class="apple-library-empty"><FolderOpen size={28} strokeWidth={1.25} /><p>{$t('sidebar.noNotesInVault')}</p></div>
        {/if}
        {#each rows as { item, depth } (item.path)}
          {@const selected = item.path === selectedPath && !isGraphOpen}
          {@const peerEditing = presence.find((person: PresenceUser) => person.notePath === item.path)}
          <div class="apple-note-row" class:selected style:--note-depth={depth} transition:fade={{ duration: prefersReducedMotion.current ? 0 : 120 }}>
            <button class="apple-note-button" onclick={() => item.is_dir ? toggleFolder(item.path) : run(() => onSelectNote(item.path))}
              aria-expanded={item.is_dir ? !collapsedFolders.has(item.path) : undefined} aria-current={selected ? 'page' : undefined} title={item.path}>
              {#if item.is_dir}
                <ChevronRight size={12} class={collapsedFolders.has(item.path) ? 'apple-folder-chevron' : 'apple-folder-chevron open'} />
                {#if collapsedFolders.has(item.path)}<Folder size={16} strokeWidth={1.7} />{:else}<FolderOpen size={16} strokeWidth={1.7} />{/if}
              {:else}<FileText size={16} strokeWidth={1.7} />{/if}
              <span>{item.is_dir ? item.name : item.title}</span>
              {#if peerEditing}<i class="apple-peer-dot" style:background={peerEditing.color} title={$t('presence.editingNote', { name: peerEditing.name, note: peerEditing.notePath })}></i>{/if}
            </button>
            <button class="apple-note-more apple-icon-button" onclick={(event) => openMenu(item, event)} aria-label={$t('sidebar.noteActions', { name: item.is_dir ? item.name : item.title })} aria-expanded={menu?.item.path === item.path} title={$t('sidebar.noteActions', { name: item.is_dir ? item.name : item.title })}><MoreHorizontal size={16} /></button>
          </div>
        {/each}
      </div>
    </section>

    {#if selectedPath && !isGraphOpen}
      <div class="apple-sidebar-view"><span class="apple-section-label">{$t('editor.viewMode')}</span>
        <div class="apple-view-control" role="group" aria-label={$t('editor.viewMode')}>
          <span aria-hidden="true" class="apple-view-selection" style:transform="translateX({modeSelection.current * 100}%)"></span>
          {#each modes as mode (mode.value)}<button class:active={viewMode === mode.value} aria-pressed={viewMode === mode.value} onclick={() => onViewModeChange?.(mode.value)} title={mode.label}><mode.icon size={15} /><span>{mode.label}</span></button>{/each}
        </div>
      </div>
    {/if}

    {#if presence.length > 0}
      <div class="apple-presence">{#each presence.slice(0, 3) as person (person.deviceId)}<span title={$t('presence.editingNote', { name: person.name, note: person.notePath })}><i style:background={person.color}></i>{person.name}</span>{/each}</div>
    {/if}

    <footer class="apple-sidebar-footer">
      <div class="apple-sync-status">
        <button onclick={() => run(onOpenPairModal)} title={$t('sidebar.manageConnections')}><span class="apple-sync-dot" class:online={peerCount > 0} class:sync-error={syncStatus === 'error'} class:syncing={syncStatus === 'syncing'}></span><span>{syncStatus === 'error' ? $t('sidebar.syncError') : syncStatus === 'syncing' ? $t('sidebar.syncing') : peerCount > 0 ? $t('sidebar.pairedMany', { count: peerCount }) : $t('sidebar.localOnly')}</span></button>
        <button class="apple-icon-button" onclick={() => void sync()} disabled={syncing} title={$t('sidebar.syncNow')} aria-label={$t('sidebar.syncNow')}><RefreshCw size={14} class={syncing || syncStatus === 'syncing' ? 'apple-sync-spinning' : ''} /></button>
      </div>
      <div class="apple-sidebar-preferences">
        <button class="apple-settings-link" onclick={() => run(onOpenSettings)}><Settings2 size={17} strokeWidth={1.7} /><span>{$t('settings.title')}</span></button>
        <button class="apple-icon-button apple-theme-toggle" onclick={onToggleTheme} title={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')} aria-label={theme === 'dark' ? $t('sidebar.enableLightTheme') : $t('sidebar.enableDarkTheme')}>{#if theme === 'dark'}<Sun size={17} />{:else}<Moon size={17} />{/if}</button>
      </div>
    </footer>
  </aside>
</div>

{#if menu}
  <div bind:this={menuElement} class="apple-note-menu" style:left="{menu.x}px" style:top="{menu.y}px" transition:fade={{ duration: prefersReducedMotion.current ? 0 : 100 }}>
    {#if menu.item.is_dir}<button onclick={() => { const folder = menu!.item.path; closeMenu(); run(() => onCreateNote?.(`${folder}/`)); }}><Plus size={15} />{$t('sidebar.newNote')}</button>{/if}
    <button onclick={() => openDialog('rename', menu!.item.path)}><Pencil size={15} />{$t('sidebar.rename')}</button>
    <button class="apple-danger" onclick={() => openDialog('delete', menu!.item.path)}><Trash2 size={15} />{$t('sidebar.delete')}</button>
  </div>
{/if}

{#if dialog}
  <div class="apple-sidebar-dialog-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !dialogBusy) dialog = null; }} transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}>
    <div bind:this={dialogElement} class="apple-sidebar-dialog" role="dialog" aria-modal="true" aria-labelledby="apple-sidebar-dialog-title" aria-busy={dialogBusy} tabindex="-1">
    <form onsubmit={submitDialog}>
      <div class="apple-sidebar-dialog-heading"><span class="apple-dialog-symbol" class:apple-danger={dialog.kind === 'delete'}>{#if dialog.kind === 'delete'}<Trash2 size={23} />{:else if dialog.kind === 'folder'}<FolderPlus size={23} />{:else}<Pencil size={23} />{/if}</span><button type="button" class="apple-icon-button" disabled={dialogBusy} onclick={() => dialog = null} aria-label={$t('ai.close')}><X size={18} /></button></div>
      <h2 id="apple-sidebar-dialog-title">{$t(dialog.kind === 'folder' ? 'sidebar.newFolder' : dialog.kind === 'rename' ? 'sidebar.rename' : 'sidebar.delete')}</h2>
      {#if dialog.kind === 'delete'}<p>{$t('sidebar.confirmDelete', { path: dialog.path })}</p>
      {:else}<label for="apple-sidebar-name">{$t(dialog.kind === 'folder' ? 'sidebar.folderNamePlaceholder' : 'sidebar.renamePrompt')}</label><input id="apple-sidebar-name" bind:value={dialogName} required disabled={dialogBusy} autocomplete="off" />{/if}
      {#if dialogError}<p class="apple-danger" role="alert">{dialogError}</p>{/if}
      <div class="apple-sidebar-dialog-actions"><button type="button" class="apple-dialog-cancel" disabled={dialogBusy} onclick={() => dialog = null}>{$t('sidebar.cancel')}</button><button type="submit" class="apple-compose" class:destructive={dialog.kind === 'delete'} disabled={dialogBusy || (dialog.kind !== 'delete' && !dialogName.trim())}>{$t(dialog.kind === 'delete' ? 'sidebar.delete' : dialog.kind === 'rename' ? 'sidebar.rename' : 'sidebar.create')}</button></div>
    </form>
    </div>
  </div>
{/if}

<style>
  .apple-sidebar-frame {
    position: relative; flex: 0 0 auto; height: 100%; overflow: hidden;
    --sidebar-material: color-mix(in srgb, var(--bg-sidebar) 91%, transparent);
    --sidebar-selection: color-mix(in srgb, var(--accent) 12%, var(--bg-sidebar));
    --sidebar-wash: color-mix(in srgb, var(--bg-card) 65%, transparent);
    font-family: var(--apple-font); font-size: .8125rem; letter-spacing: 0; font-optical-sizing: auto;
    background: var(--bg-sidebar); border-right: 1px solid var(--apple-hairline);
  }
  .apple-sidebar-panel {
    display: flex; flex-direction: column; position: absolute; inset: 0 auto 0 0; width: 280px;
    background: var(--sidebar-material); backdrop-filter: blur(32px) saturate(150%);
    -webkit-backdrop-filter: blur(32px) saturate(150%); color: var(--text-main); isolation: isolate;
  }
  .apple-sidebar-panel::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(ellipse at top left, color-mix(in srgb, var(--accent) 7%, transparent), transparent 55%); }
  button { cursor: pointer; border: 0; transition: background-color 140ms ease, color 140ms ease; }
  button:not(:disabled):active { transform: scale(.97); }
  button:disabled { opacity: .45; cursor: default; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
  .apple-icon-button { display: grid; place-items: center; flex-shrink: 0; width: 2rem; height: 2rem; border-radius: .5rem; background: transparent; color: var(--text-muted); }
  .apple-icon-button:hover { background: var(--bg-hover); color: var(--text-main); }
  .apple-sidebar-header { display: flex; align-items: center; gap: .625rem; padding: 1.25rem 1rem 1rem; flex: 0 0 auto; }
  .apple-app-mark { display: grid; place-items: center; width: 2.125rem; height: 2.125rem; border-radius: .625rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 11%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 12%, transparent); }
  .apple-app-name { flex: 1; display: flex; flex-direction: column; gap: .0625rem; }
  .apple-app-name strong { font-family: var(--apple-display); font-size: 1rem; line-height: 1.25; font-weight: 650; letter-spacing: -.025em; }
  .apple-app-name > span { font-size: .6875rem; color: var(--text-muted); letter-spacing: .015em; }
  .apple-vault-switcher { position: relative; margin: 0 .875rem .875rem; flex: 0 0 auto; }
  .apple-vault-button { display: flex; align-items: center; gap: .625rem; width: 100%; padding: .625rem; text-align: left; border: 1px solid var(--apple-hairline); border-radius: .75rem; background: var(--sidebar-wash); color: var(--text-muted); }
  .apple-vault-button:hover { background: var(--bg-hover); }
  .apple-vault-icon { color: var(--accent); width: 1.75rem; height: 1.75rem; display: grid; place-items: center; }
  .apple-vault-button > span:nth-child(2) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .125rem; }
  .apple-vault-button strong { color: var(--text-main); font-size: .8125rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .apple-vault-button small { font-size: .625rem; letter-spacing: .015em; color: var(--text-muted); }
  .apple-vault-menu, .apple-note-menu { padding: .375rem; border: 1px solid var(--apple-hairline); border-radius: .75rem; background: var(--bg-card); box-shadow: 0 8px 30px #0002; }
  .apple-vault-menu { position: absolute; top: calc(100% + .375rem); inset-inline: 0; z-index: 5; max-height: 18rem; overflow-y: auto; }
  .apple-vault-menu > .apple-section-label { display: block; padding: .375rem .5rem; }
  .apple-vault-menu button, .apple-note-menu button { display: flex; align-items: center; gap: .625rem; width: 100%; padding: .625rem; text-align: left; color: var(--text-main); border-radius: .4375rem; font-size: .8125rem; }
  .apple-vault-menu button span { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .apple-vault-menu button:hover, .apple-note-menu button:hover { background: var(--bg-hover); }
  .apple-vault-open { margin-top: .25rem; border-top: 1px solid var(--apple-hairline) !important; }
  .apple-sidebar-quick-actions { display: flex; flex-direction: column; gap: .625rem; padding: 0 .875rem; flex: 0 0 auto; }
  .apple-sidebar-search { display: flex; align-items: center; gap: .5rem; padding: 0 .625rem; height: 2.25rem; border: 1px solid var(--apple-hairline); border-radius: .625rem; color: var(--text-muted); background: color-mix(in srgb, var(--bg-main) 50%, transparent); }
  .apple-sidebar-search:hover { background: var(--bg-hover); }
  .apple-sidebar-search > span { flex: 1; text-align: left; font-size: .75rem; }
  kbd { font: inherit; font-size: .5625rem; color: var(--text-muted); opacity: .75; white-space: nowrap; }
  .apple-compose { display: flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.375rem; padding: .5rem .875rem; border-radius: .625rem; background: var(--apple-action); color: #fff; font-size: .8125rem; font-weight: 550; }
  .apple-compose:hover { background: #0071e3; }
  .apple-compose > span { flex: 1; text-align: left; }
  .apple-navigation-area { padding: 1rem .875rem .75rem; flex: 0 0 auto; }
  .apple-sidebar-navigation { position: relative; display: flex; flex-direction: column; gap: .25rem; }
  .apple-sidebar-navigation > button { display: flex; align-items: center; gap: .625rem; height: 2.5rem; padding: 0 .75rem; border-radius: .625rem; background: transparent; position: relative; color: var(--text-muted); text-align: left; }
  .apple-sidebar-navigation > button:hover { background: color-mix(in srgb, var(--bg-hover) 60%, transparent); color: var(--text-main); }
  .apple-sidebar-navigation > button > span { flex: 1; }
  .apple-sidebar-navigation > button.current, .apple-sidebar-navigation > button.assistant-active { color: var(--accent); font-weight: 550; }
  .apple-sidebar-navigation small { font-size: .6875rem; font-weight: 500; }
  .apple-nav-selection { position: absolute; inset: 0 0 auto; height: 2.5rem; border-radius: .625rem; background: var(--sidebar-selection); pointer-events: none; }
  .apple-sidebar-navigation i { width: .3125rem; height: .3125rem; border-radius: 50%; background: var(--accent); opacity: 0; }
  .apple-sidebar-navigation i.visible { opacity: 1; }
  .apple-library { display: flex; flex-direction: column; min-height: 3rem; flex: 1; overflow: hidden; padding-inline: .875rem; }
  .apple-library-heading { display: flex; align-items: center; justify-content: space-between; padding: .5rem .5rem .375rem; border-top: 1px solid var(--apple-hairline); }
  .apple-library-heading .apple-icon-button { width: 1.75rem; height: 1.75rem; }
  .apple-section-label { font-size: .625rem; line-height: 1.4; font-weight: 650; letter-spacing: .065em; text-transform: uppercase; color: var(--text-muted); }
  .apple-note-tree { overflow: auto; overscroll-behavior: contain; padding: .1875rem .0625rem .75rem; scrollbar-width: thin; mask-image: linear-gradient(to bottom, #000 calc(100% - 12px), transparent); }
  .apple-note-row { display: flex; align-items: center; gap: .125rem; border-radius: .5rem; min-height: 2.125rem; margin-bottom: .125rem; padding-left: min(calc(var(--note-depth) * .875rem), 7rem); }
  .apple-note-row:hover, .apple-note-row:focus-within { background: var(--sidebar-wash); }
  .apple-note-row.selected { background: var(--sidebar-selection); }
  .apple-note-button { display: flex; align-items: center; gap: .4375rem; min-width: 0; flex: 1; min-height: 2.125rem; padding: .375rem .5rem; text-align: left; color: var(--text-muted); border-radius: .5rem; }
  .apple-note-button > :global(svg) { flex-shrink: 0; }
  .apple-note-button > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .78125rem; line-height: 1.4; }
  .apple-note-row.selected .apple-note-button { color: var(--text-main); font-weight: 550; }
  .apple-note-row.selected .apple-note-button > :global(svg), .apple-note-button[aria-expanded] > :global(svg:nth-child(2)) { color: var(--accent); }
  .apple-note-button > :global(.apple-folder-chevron) { color: var(--text-muted); transition: transform 160ms ease; }
  .apple-note-button > :global(.apple-folder-chevron.open) { transform: rotate(90deg); }
  .apple-note-more { width: 1.5rem; height: 1.75rem; margin-right: .25rem; opacity: 0; }
  .apple-note-row:hover .apple-note-more, .apple-note-row:focus-within .apple-note-more, .apple-note-more[aria-expanded='true'] { opacity: 1; }
  .apple-peer-dot { width: .375rem; height: .375rem; flex-shrink: 0; border-radius: 50%; }
  .apple-library-empty { display: flex; flex-direction: column; align-items: center; text-align: center; color: var(--text-muted); padding: 2rem .75rem; gap: .625rem; }
  .apple-library-empty > :global(svg) { opacity: .45; }
  .apple-library-empty p { font-size: .75rem; }
  .apple-sidebar-view { padding: .625rem 1rem .875rem; flex: 0 0 auto; }
  .apple-sidebar-view > span { display: block; padding-bottom: .5rem; font-size: .5625rem; }
  .apple-view-control { display: flex; position: relative; padding: .1875rem; border-radius: .625rem; background: color-mix(in srgb, var(--text-main) 6%, transparent); }
  .apple-view-control > button { position: relative; display: flex; flex-direction: column; gap: .25rem; align-items: center; justify-content: center; width: 33.3333%; min-height: 2.625rem; padding: .375rem .0625rem; color: var(--text-muted); border-radius: .4375rem; }
  .apple-view-control > button.active { color: var(--text-main); }
  .apple-view-control > button > span { font-size: .625rem; letter-spacing: .01em; }
  .apple-view-selection { position: absolute; top: .1875rem; bottom: .1875rem; left: .1875rem; width: calc((100% - .375rem) / 3); border-radius: .4375rem; background: var(--bg-card); box-shadow: 0 1px 3px #0001; pointer-events: none; }
  .apple-presence { display: flex; flex-wrap: wrap; gap: .375rem .75rem; padding: .25rem 1.25rem .75rem; font-size: .625rem; color: var(--text-muted); }
  .apple-presence span { display: flex; align-items: center; gap: .3125rem; }
  .apple-presence i { width: .375rem; height: .375rem; border-radius: 50%; }
  .apple-sidebar-footer { flex: 0 0 auto; padding: .5rem .875rem .875rem; border-top: 1px solid var(--apple-hairline); }
  .apple-sync-status { display: flex; align-items: center; gap: .25rem; padding-left: .625rem; }
  .apple-sync-status > button:first-child { display: flex; align-items: center; gap: .5rem; flex: 1; min-width: 0; min-height: 2rem; color: var(--text-muted); text-align: left; }
  .apple-sync-status > button:first-child > span:last-child { font-size: .625rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .apple-sync-dot { width: .375rem; height: .375rem; border-radius: 50%; flex-shrink: 0; background: var(--text-muted); }
  .apple-sync-dot.online { background: var(--success); }
  .apple-sync-dot.sync-error { background: var(--danger); }
  .apple-sync-dot.syncing { background: var(--accent); }
  .apple-sync-status :global(.apple-sync-spinning) { animation: apple-sync-rotation 1s linear infinite; }
  .apple-sidebar-preferences { display: flex; gap: .375rem; align-items: center; padding-top: .25rem; }
  .apple-settings-link { display: flex; align-items: center; gap: .625rem; flex: 1; padding: .625rem; border-radius: .5rem; color: var(--text-muted); text-align: left; }
  .apple-settings-link:hover { background: var(--bg-hover); color: var(--text-main); }
  .apple-theme-toggle { border: 1px solid var(--apple-hairline); background: var(--sidebar-wash); }
  .apple-sidebar-rail { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; width: 63px; padding-block: 1.25rem .75rem; gap: .875rem; }
  .rail-compose { padding: 0; width: 2.5rem; min-height: 2.5rem; }
  .rail-search { margin-top: -.25rem; }
  .apple-sidebar-navigation.rail { width: 2.5rem; }
  .apple-sidebar-navigation.rail > button { justify-content: center; padding: 0; }
  .apple-sidebar-navigation.rail > button > span, .apple-sidebar-navigation.rail small { display: none; }
  .apple-sidebar-navigation.rail i { position: absolute; bottom: .25rem; right: .25rem; }
  .apple-rail-footer { display: flex; flex-direction: column; gap: .625rem; margin-top: auto; }
  .apple-sidebar-panel.mobile { position: fixed; width: min(280px, calc(100vw - 48px)); z-index: 80; border-right: 1px solid var(--apple-hairline); box-shadow: 16px 0 60px #0002; }
  .apple-sidebar-scrim { position: fixed; inset: 0; z-index: 70; background: var(--apple-overlay); cursor: default; }
  .apple-sidebar-scrim:active { transform: none !important; }
  .apple-note-menu { position: fixed; width: 184px; z-index: 90; }
  .apple-danger { color: var(--danger) !important; }
  .apple-sidebar-dialog-backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 1.5rem; background: var(--apple-overlay); backdrop-filter: blur(8px); }
  .apple-sidebar-dialog { width: min(100%, 380px); padding: 1.5rem; border-radius: 1.25rem; background: var(--bg-card); border: 1px solid var(--apple-hairline); box-shadow: 0 16px 60px #0002; }
  .apple-sidebar-dialog-heading { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1rem; }
  .apple-dialog-symbol { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: .875rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .apple-sidebar-dialog h2 { font-size: 1.375rem; letter-spacing: -.025em; margin-bottom: .875rem; color: var(--text-main); }
  .apple-sidebar-dialog p, .apple-sidebar-dialog label { color: var(--text-muted); font-size: .8125rem; line-height: 1.5; overflow-wrap: anywhere; }
  .apple-sidebar-dialog label { display: block; margin-bottom: .375rem; }
  .apple-sidebar-dialog input { width: 100%; padding: .625rem .75rem; border: 1px solid var(--apple-hairline); border-radius: .625rem; background: var(--bg-main); color: var(--text-main); }
  .apple-sidebar-dialog-actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1.5rem; }
  .apple-dialog-cancel { border-radius: .625rem; padding: .5rem .875rem; color: var(--text-main); background: var(--bg-hover); }
  .apple-compose.destructive { background: var(--danger); }
  @keyframes apple-sync-rotation { to { transform: rotate(360deg); } }
  @media (hover: none) { .apple-note-more { opacity: .7; } }
  @media (pointer: coarse) { .apple-icon-button { min-height: 2.5rem; min-width: 2.5rem; } .apple-note-row, .apple-note-button { min-height: 2.75rem; } .apple-sidebar-navigation > button { height: 2.5rem; } }
  @media (max-height: 660px) { .apple-sidebar-header { padding-block: .75rem; } .apple-vault-switcher { margin-bottom: .625rem; } .apple-navigation-area { padding-block: .625rem .375rem; } .apple-sidebar-view { padding-block: .375rem; } .apple-sidebar-view > .apple-section-label { display: none; } .apple-view-control > button { min-height: 2rem; } .apple-view-control > button > span { display: none; } }
  @media (max-height: 620px) { .apple-sidebar-panel { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; } .apple-library { flex: 0 0 auto; overflow: visible; } .apple-note-tree { overflow: visible; mask-image: none; } .apple-sidebar-rail { overflow-y: auto; } .apple-rail-footer { padding-top: 1rem; } }
  @media (prefers-reduced-motion: reduce) { button, .apple-note-button > :global(.apple-folder-chevron) { transition: none; } button:not(:disabled):active { transform: none; } .apple-sync-status :global(.apple-sync-spinning) { animation: none; } }
  @media (prefers-reduced-transparency: reduce) { .apple-sidebar-panel { background: var(--bg-sidebar); backdrop-filter: none; -webkit-backdrop-filter: none; } .apple-sidebar-panel::before { display: none; } .apple-sidebar-dialog-backdrop { backdrop-filter: none; } }
  @media (prefers-contrast: more) { .apple-sidebar-frame, .apple-vault-button, .apple-sidebar-search, .apple-view-control, .apple-sidebar-dialog { border: 1px solid var(--text-muted); } .apple-nav-selection, .apple-note-row.selected { outline: 1px solid var(--accent); } .apple-note-more { opacity: 1; } }
</style>
