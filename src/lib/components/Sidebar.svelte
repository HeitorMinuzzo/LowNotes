<script lang="ts">
  import type { VaultConfig, VaultItem } from '../types';
  import type { PresenceUser } from '$lib/presence';
  import { visibleNoteRows } from '$lib/note-tree';
  import {
    Settings2,
    RefreshCw,
    Search,
    FilePlus,
    FolderPlus,
    ChevronRight,
    ChevronDown,
    FileText,
    Folder,
    FolderOpen,
    Trash2,
    Pencil,
    Plus,
    X,
    FolderArchive,
    Radio
  } from 'lucide-svelte';
  import {
    createNote,
    createFolder,
    deleteItem,
    renameItem,
    pickVaultDirectory,
    selectVault,
    networkSyncNow,
  } from '../api';
  import { t, trError, ts } from '$lib/i18n';
  import BorderBeam from './ui/BorderBeam.svelte';

  let {
    activeVault = null,
    vaults = [],
    items = [],
    selectedPath = '',
    syncStatus = 'idle',
    peerCount = 0,
    onOpenSettings,
    onSelectNote,
    onVaultChange,
    onOpenPairModal,
    presence = [],
    onRefreshItems,
    onItemDeleted,
    onOpenCommandPalette,
  } = $props<{
    activeVault: VaultConfig | null;
    vaults: VaultConfig[];
    items: VaultItem[];
    selectedPath: string;
    syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
    peerCount: number;
    onOpenSettings: () => void;
    onSelectNote: (path: string) => void;
    onVaultChange: (vault: VaultConfig) => void;
    onOpenPairModal: () => void;
    onRefreshItems: () => void;
    onItemDeleted?: () => void;
    onOpenCommandPalette?: () => void;
    presence?: PresenceUser[];
  }>();

  let searchQuery = $state('');
  let isVaultDropdownOpen = $state(false);
  let isCreatingNote = $state(false);
  let newNoteName = $state('');
  let isCreatingFolder = $state(false);
  let newFolderName = $state('');
  let collapsedFolders = $state<Set<string>>(new Set());
  let visibleRows = $derived(visibleNoteRows(items, collapsedFolders, searchQuery));
  let isSyncRotating = $state(false);

  function toggleFolder(path: string) {
    const next = new Set(collapsedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedFolders = next;
  }

  async function handleOpenFolder() {
    isVaultDropdownOpen = false;
    const path = await pickVaultDirectory();
    if (path) {
      const res = await selectVault(path);
      if (res.active_vault) {
        onVaultChange(res.active_vault);
      }
    }
  }

  async function handleSelectVault(v: VaultConfig) {
    isVaultDropdownOpen = false;
    const res = await selectVault(v.path);
    if (res.active_vault) {
      onVaultChange(res.active_vault);
    }
  }

  async function submitNewNote() {
    if (!newNoteName.trim()) return;
    try {
      const path = await createNote(newNoteName.trim(), newNoteName.trim().split('/').at(-1) || newNoteName.trim());
      isCreatingNote = false;
      newNoteName = '';
      onRefreshItems();
      onSelectNote(path);
    } catch (e: any) {
      alert(trError(typeof e === 'string' ? e : e.message || 'sidebar.errorCreateNote'));
    }
  }

  async function submitNewFolder() {
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName.trim());
      isCreatingFolder = false;
      newFolderName = '';
      onRefreshItems();
    } catch (e: any) {
      alert(trError(typeof e === 'string' ? e : e.message || 'sidebar.errorCreateFolder'));
    }
  }

  async function handleDelete(path: string, event: MouseEvent) {
    event.stopPropagation();
    if (confirm(ts('sidebar.confirmDelete', { path }))) {
      try {
        await deleteItem(path);
        onItemDeleted?.();
        onRefreshItems();
      } catch (e) {
        alert(trError(String(e)));
      }
    }
  }

  async function handleRename(oldPath: string, event: MouseEvent) {
    event.stopPropagation();
    const newName = prompt(ts('sidebar.renamePrompt'), oldPath);
    if (newName && newName !== oldPath) {
      try {
        await renameItem(oldPath, newName);
        onRefreshItems();
        if (selectedPath === oldPath) {
          onSelectNote(newName);
        }
      } catch (e: any) {
        alert(trError(typeof e === 'string' ? e : e.message || 'sidebar.errorRename'));
      }
    }
  }

  async function handleManualSync() {
    isSyncRotating = true;
    try {
      await networkSyncNow();
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => { isSyncRotating = false; }, 1000);
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && isVaultDropdownOpen) {
      isVaultDropdownOpen = false;
    }
  }}
  onclick={(e) => {
    if (!isVaultDropdownOpen) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.vault-switcher-zone')) {
      isVaultDropdownOpen = false;
    }
  }}
/>

<aside class="w-68 h-full flex flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)] select-none relative z-20">
  <!-- Vault Switcher Zone (Header & Collapsible Drawer) -->
  <div class="vault-switcher-zone flex flex-col shrink-0">
    <!-- Vault Switcher Header -->
    <div class="h-11 flex items-center justify-between border-b border-[var(--border)] px-2.5 bg-[var(--bg-sidebar)]/80 backdrop-blur-md shrink-0">
      <button
        onclick={() => (isVaultDropdownOpen = !isVaultDropdownOpen)}
        class="w-full h-7 flex items-center justify-between px-2 rounded-md hover:bg-[var(--bg-hover)] text-left transition-all duration-150 group border border-transparent hover:border-[var(--border)] cursor-pointer"
        title="Alternar cofre"
      >
        <div class="flex items-center gap-2 overflow-hidden">
          <Folder size={14} class="text-[var(--accent)] shrink-0" />
          <div class="flex flex-col min-w-0 leading-tight">
            <span class="text-xs font-medium text-[var(--text-main)] truncate tracking-tight">
              {activeVault ? activeVault.name : $t('sidebar.selectVault')}
            </span>
            <span class="text-[9px] text-[var(--text-dim)] truncate">
              {activeVault ? 'Vault local' : 'Nenhum selecionado'}
            </span>
          </div>
        </div>
        <ChevronDown size={13} class="text-[var(--text-dim)] group-hover:text-[var(--text-main)] transition-transform duration-200 {isVaultDropdownOpen ? 'rotate-180 text-[var(--accent)]' : ''}" />
      </button>
    </div>

    <!-- Expandable Vaults Drawer (Inline Document Flow - Zero Overlaps) -->
    {#if isVaultDropdownOpen}
      <div
        class="border-b border-[var(--border)] p-2 flex flex-col gap-1 shrink-0 animate-in fade-in duration-150"
        style="background: var(--bg-card); background-color: var(--bg-card);"
      >
        <div class="flex items-center justify-between px-1.5 py-0.5">
          <span class="text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-wider">
            {$t('sidebar.yourVaults')}
          </span>
          <button
            onclick={() => (isVaultDropdownOpen = false)}
            class="text-[10px] text-[var(--text-dim)] hover:text-[var(--text-main)] p-0.5 rounded cursor-pointer transition-colors"
            title="Fechar"
          >
            ✕
          </button>
        </div>

        <div class="max-h-48 overflow-y-auto flex flex-col gap-0.5 custom-scrollbar pr-0.5">
          {#each vaults as v}
            {@const isActive = activeVault?.id === v.id}
            <button
              onclick={() => handleSelectVault(v)}
              class="h-7 w-full flex items-center justify-between px-2 rounded-md text-xs text-left transition-all duration-150 cursor-pointer {isActive ? 'bg-[var(--bg-active)] text-[var(--text-main)] font-medium shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'}"
            >
              <div class="flex items-center gap-1.5 truncate">
                <FolderArchive size={13} class={isActive ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'} />
                <span class="truncate">{v.name}</span>
              </div>
              {#if isActive}
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_5px_var(--accent)]"></span>
              {/if}
            </button>
          {/each}
        </div>

        <div class="h-[1px] bg-[var(--border)] my-0.5"></div>

        <button
          onclick={handleOpenFolder}
          class="h-7 w-full flex items-center gap-1.5 px-2 rounded-md text-xs text-left text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all font-medium cursor-pointer"
        >
          <Plus size={13} />
          <span>{$t('sidebar.openComputerFolder')}</span>
        </button>
      </div>
    {/if}
  </div>

  <!-- Search & Quick Action Toolbar -->
  <div class="p-2.5 flex flex-col gap-2 border-b border-[var(--border)]">
    <!-- Spotlight Search Input -->
    <div class="relative flex items-center">
      <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)] pointer-events-none" />
      <input
        type="text"
        bind:value={searchQuery}
        onfocus={() => (isVaultDropdownOpen = false)}
        onclick={() => (isVaultDropdownOpen = false)}
        placeholder={$t('sidebar.searchPlaceholder')}
        class="h-7 w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-md pl-7 pr-10 text-xs text-[var(--text-main)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-glow)] transition-all shadow-inner"
      />
      {#if searchQuery}
        <button
          onclick={() => (searchQuery = '')}
          class="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-dim)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition"
        >
          <X size={12} />
        </button>
      {:else if onOpenCommandPalette}
        <button
          onclick={onOpenCommandPalette}
          title="Abrir busca rápida (Ctrl+K)"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-[9px] font-mono text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition cursor-pointer"
        >
          ⌘K
        </button>
      {/if}
    </div>

    <!-- Quick Action Bar -->
    <div class="flex items-center gap-1.5">
      <button
        onclick={() => (isCreatingNote = true)}
        class="h-7 flex-1 flex items-center justify-center gap-1.5 px-2.5 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent)]/40 transition-all shadow-sm cursor-pointer"
      >
        <FilePlus size={13} class="text-[var(--accent)]" />
        <span>{$t('sidebar.newNote')}</span>
      </button>

      <button
        onclick={() => (isCreatingFolder = true)}
        class="h-7 w-7 flex items-center justify-center rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--accent)]/40 transition shadow-sm cursor-pointer"
        title={$t('sidebar.newFolder')}
      >
        <FolderPlus size={14} />
      </button>
    </div>

    <!-- Inline Create Note Form -->
    {#if isCreatingNote}
      <form
        onsubmit={(e) => { e.preventDefault(); submitNewNote(); }}
        class="relative flex flex-col gap-2 p-3 bg-[var(--bg-card)] border border-[var(--accent)] rounded-2xl shadow-xl animate-in fade-in zoom-in-95 duration-150"
      >
        <span class="text-[11px] font-bold text-[var(--accent)]">Nova Nota</span>
        <input
          type="text"
          bind:value={newNoteName}
          placeholder={$t('sidebar.noteNamePlaceholder')}
          class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)]"
        />
        <div class="flex justify-end gap-1.5">
          <button
            type="button"
            onclick={() => (isCreatingNote = false)}
            class="px-2.5 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text-main)] rounded-md hover:bg-[var(--bg-hover)]"
          >
            {$t('sidebar.cancel')}
          </button>
          <button
            type="submit"
            class="px-3 py-1 text-[11px] bg-[var(--accent)] text-[var(--accent-contrast)] font-bold rounded-lg shadow-sm hover:opacity-90 transition"
          >
            {$t('sidebar.create')}
          </button>
        </div>
      </form>
    {/if}

    <!-- Inline Create Folder Form -->
    {#if isCreatingFolder}
      <form
        onsubmit={(e) => { e.preventDefault(); submitNewFolder(); }}
        class="relative flex flex-col gap-2 p-3 bg-[var(--bg-card)] border border-[var(--accent)] rounded-2xl shadow-xl animate-in fade-in zoom-in-95 duration-150"
      >
        <span class="text-[11px] font-bold text-[var(--accent)]">Nova Pasta</span>
        <input
          type="text"
          bind:value={newFolderName}
          placeholder={$t('sidebar.folderNamePlaceholder')}
          class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--accent)]"
        />
        <div class="flex justify-end gap-1.5">
          <button
            type="button"
            onclick={() => (isCreatingFolder = false)}
            class="px-2.5 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text-main)] rounded-md hover:bg-[var(--bg-hover)]"
          >
            {$t('sidebar.cancel')}
          </button>
          <button
            type="submit"
            class="px-3 py-1 text-[11px] bg-[var(--accent)] text-[var(--accent-contrast)] font-bold rounded-lg shadow-sm hover:opacity-90 transition"
          >
            {$t('sidebar.createFolder')}
          </button>
        </div>
      </form>
    {/if}
  </div>

  <!-- Note Tree & Folder Hierarchy -->
  <div class="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
    {#if visibleRows.length === 0}
      <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
        <span class="text-2xl mb-2 opacity-40">📂</span>
        <span class="text-xs text-[var(--text-dim)] font-medium">
          {searchQuery ? $t('sidebar.noNotesFound') : $t('sidebar.noNotesInVault')}
        </span>
      </div>
    {:else}
      {#each visibleRows as { item, depth } (item.path)}
        {@const isSelected = selectedPath === item.path}
        {@const peerEditing = presence.find((p: PresenceUser) => p.notePath === item.path)}
        <div
          role="button"
          tabindex="0"
          onclick={() => item.is_dir ? toggleFolder(item.path) : onSelectNote(item.path)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.is_dir ? toggleFolder(item.path) : onSelectNote(item.path); } }}
          aria-expanded={item.is_dir ? !collapsedFolders.has(item.path) : undefined}
          class="group relative w-full h-7 flex items-center justify-between px-2 rounded-md text-xs text-left cursor-pointer transition-all duration-150 {isSelected ? 'bg-[var(--bg-card)] text-[var(--text-main)] font-medium shadow-sm border border-[var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/70 hover:text-[var(--text-main)]'}"
          style:padding-left={`${8 + depth * 14}px`}
        >
          {#if isSelected}
            <span class="absolute left-1 top-2 bottom-2 w-1 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]"></span>
          {/if}

          <div class="flex items-center gap-2 overflow-hidden flex-1 pl-1.5">
            {#if item.is_dir}
              <span class="text-[var(--text-dim)] transition-transform duration-150">
                {#if collapsedFolders.has(item.path) && !searchQuery.trim()}
                  <ChevronRight size={13} />
                {:else}
                  <ChevronDown size={13} />
                {/if}
              </span>
              {#if collapsedFolders.has(item.path) && !searchQuery.trim()}
                <Folder size={14} class="text-[var(--accent)] shrink-0 opacity-80" />
              {:else}
                <FolderOpen size={14} class="text-[var(--accent)] shrink-0" />
              {/if}
            {:else}
              <FileText size={14} class={isSelected ? 'text-[var(--accent)] shrink-0' : 'text-[var(--text-dim)] shrink-0 group-hover:text-[var(--text-muted)]'} />
            {/if}
            <span class="truncate" title={item.path}>{item.is_dir ? item.name : item.title}</span>

            <!-- Peer live avatar dot if active on this note -->
            {#if peerEditing}
              <span
                class="w-2 h-2 rounded-full shrink-0 animate-pulse ml-auto"
                style="background: {peerEditing.color}; box-shadow: 0 0 6px {peerEditing.color};"
                title={$t('presence.editingNote', { name: peerEditing.name, note: peerEditing.notePath })}
              ></span>
            {/if}
          </div>

          <!-- Hover Action Toolbar -->
          <div class="hidden group-hover:flex items-center gap-1 opacity-90 pl-1 shrink-0">
            {#if item.is_dir}
              <button
                onclick={(e) => { e.stopPropagation(); newNoteName = `${item.path}/`; isCreatingNote = true; }}
                class="p-1 rounded-md text-[var(--text-dim)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] transition"
                title={$t('sidebar.newNote')}
              >
                <Plus size={12} />
              </button>
            {/if}
            <button
              onclick={(e) => handleRename(item.path, e)}
              class="p-1 rounded-md text-[var(--text-dim)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] transition"
              title={$t('sidebar.rename')}
            >
              <Pencil size={12} />
            </button>
            <button
              onclick={(e) => handleDelete(item.path, e)}
              class="p-1 rounded-md text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-[var(--bg-card)] transition"
              title={$t('sidebar.delete')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Live Collaborative Presence Pill -->
  {#if presence.length > 0}
    <div class="px-3.5 py-2 border-t border-[var(--border)] bg-[var(--bg-card)]/50 backdrop-blur-md flex flex-col gap-1.5">
      <div class="flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-wider">
        <Radio size={12} class="text-[var(--success)] animate-pulse" />
        <span>Em tempo real</span>
      </div>
      {#each presence.slice(0, 3) as person (person.deviceId)}
        <div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span class="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style="background: {person.color}; box-shadow: 0 0 6px {person.color}"></span>
          <span class="truncate text-[11px]">
            {$t('presence.editingNote', { name: person.name, note: person.notePath })}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Footer: Settings & P2P Status Card -->
  <div class="p-3 border-t border-[var(--border)] bg-[var(--bg-sidebar)]/80 backdrop-blur-md flex flex-col gap-2">
    <!-- P2P Status Badge -->
    <div class="flex items-center justify-between p-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]/70 shadow-sm">
      <button
        onclick={onOpenPairModal}
        class="flex items-center gap-2.5 text-xs text-left hover:opacity-90 transition group flex-1 min-w-0"
        title={syncStatus === 'error' ? $t('sidebar.syncError') : $t('sidebar.manageConnections')}
      >
        <span class="relative flex h-2.5 w-2.5 shrink-0">
          {#if syncStatus === 'syncing' || peerCount > 0}
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 {peerCount > 0 ? 'bg-[var(--success)]' : 'bg-[var(--accent)]'}"></span>
          {/if}
          <span class="relative inline-flex rounded-full h-2.5 w-2.5 {syncStatus === 'error' ? 'bg-[var(--danger)]' : syncStatus === 'syncing' ? 'bg-[var(--accent)]' : peerCount > 0 ? 'bg-[var(--success)]' : 'bg-gray-500'}"></span>
        </span>
        <div class="flex flex-col min-w-0">
          <span class="font-bold text-[var(--text-main)] leading-tight text-[11.5px] truncate">
            {peerCount > 0
              ? peerCount === 1
                ? $t('sidebar.pairedOne')
                : $t('sidebar.pairedMany', { count: peerCount })
              : $t('sidebar.p2pOffline')}
          </span>
          <span class="text-[10px] text-[var(--text-dim)] group-hover:text-[var(--accent)] transition-colors truncate">
            {$t('sidebar.manageConnections')}
          </span>
        </div>
      </button>

      <button
        onclick={handleManualSync}
        class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all shrink-0"
        title={$t('sidebar.syncNow')}
        aria-label={$t('sidebar.syncNow')}
      >
        <RefreshCw size={14} class={isSyncRotating ? 'animate-spin text-[var(--accent)]' : ''} />
      </button>
    </div>

    <!-- Settings Trigger Button -->
    <button
      onclick={onOpenSettings}
      class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] border border-transparent hover:border-[var(--border)] transition-all shadow-sm group"
      title={$t('settings.title')}
    >
      <div class="flex items-center gap-2">
        <Settings2 size={15} class="group-hover:rotate-45 transition-transform duration-300 text-[var(--text-dim)] group-hover:text-[var(--accent)]" />
        <span>{$t('settings.title')}</span>
      </div>
      <span class="text-[10px] text-[var(--text-dim)] font-mono">v0.2.1</span>
    </button>
  </div>
</aside>
