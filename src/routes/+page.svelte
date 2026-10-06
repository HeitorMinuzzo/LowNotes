<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import type {
    AppSettings,
    AppTheme,
    ViewMode,
    VaultConfig,
    VaultItem,
    PeerConfig,
    NetworkEventPayload,
    UpdatePolicy,
  } from '$lib/types';
  import { checkAvailableUpdate, type AvailableUpdate } from '$lib/updates';
  import {
    getAppState,
    getUpdatePolicy,
    listNotes,
    readNote,
    pickVaultDirectory,
    selectVault,
    saveViewMode,
    networkGetPairInfo,
    saveUpdatePrefs,
    undoLastDelete,
    createNote,
    createFolder,
    networkSyncNow,
    saveTheme,
  } from '$lib/api';
  import { locale, resolveLocale, t, trError } from '$lib/i18n';
  import { resolveNoteLink } from '$lib/note-links';
  import { DEFAULT_PALETTE_ID, applyTheme } from '$lib/themes';
  import { liquidGlass } from '$lib/liquid-glass';
  import Sidebar from '$lib/components/AppleSidebar.svelte';
  import * as Y from 'yjs';
  import {
    Awareness,
    applyAwarenessUpdate,
    outdatedTimeout,
    removeAwarenessStates,
  } from 'y-protocols/awareness';
  import { parsePresenceState, type PresenceUser } from '$lib/presence';
  import Editor from '$lib/components/Editor.svelte';
  import GraphView from '$lib/components/GraphView.svelte';
  import PairModal from '$lib/components/PairModal.svelte';
  import IncomingPairDialog from '$lib/components/IncomingPairDialog.svelte';
  import AiChatSidebar from '$lib/components/AiChatSidebar.svelte';
  import WelcomeModal from '$lib/components/WelcomeModal.svelte';
  import UpdateModal from '$lib/components/UpdateModal.svelte';
  import SettingsView from '$lib/components/SettingsView.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import {
    ChevronRight,
    FileText,
    NotebookPen,
    FolderOpen,
    MessageSquare,
    Network,
    Plus,
    Settings2,
    ShieldCheck,
    Sparkles,
  } from 'lucide-svelte';

  let settings = $state<AppSettings | null>(null);
  let theme = $state<AppTheme>('light');
  let viewMode = $state<ViewMode>('split');
  let sidebarVisible = $state(true);
  let appleNewNoteOpen = $state(false);
  let appleNewNoteName = $state('');
  let appleNewNoteError = $state('');
  let appleCreateKind = $state<'note' | 'folder'>('note');
  let appleCreateBusy = $state(false);
  let appError = $state('');
  let appleNoteInput = $state<HTMLInputElement | null>(null);
  let appleDialogElement = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!appleNewNoteOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => {
      appleNoteInput?.focus();
      const end = appleNoteInput?.value.length ?? 0;
      appleNoteInput?.setSelectionRange(end, end);
    });
    return () => previous?.focus();
  });

  function handleAppleDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      appleNewNoteOpen = false;
      return;
    }
    if (event.key !== 'Tab' || !appleDialogElement) return;
    const controls = Array.from(appleDialogElement.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault();
      first.focus();
    }
  }

  async function toggleTheme() {
    await handleThemeChange(theme === 'dark' ? 'light' : 'dark');
  }

  let isGraphOpen = $state(false);
  let isCommandPaletteOpen = $state(false);
  let activeVault = $state<VaultConfig | null>(null);
  let vaults = $state<VaultConfig[]>([]);
  let items = $state<VaultItem[]>([]);
  let selectedNotePath = $state<string>('');
  let currentNoteContent = $state<string>('');
  let currentCrdtBase64 = $state<string>('');

  let pairCode = $state<string>('');
  let endpointId = $state<string>('');
  let syncStatus = $state<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  let conflictNotice = $state<{ note_path: string; conflict_path: string } | null>(null);

  let isPairModalOpen = $state(false);
  let incomingRequest = $state<{ request_id: string; peer: PeerConfig } | null>(null);
  let isAiChatOpen = $state(false);
  let isSettingsOpen = $state(false);
  let settingsTab = $state<'general' | 'themes' | 'ai' | 'providers' | 'web' | 'about'>('general');
  let isWelcomeOpen = $state(false);
  let targetLine = $state<number | undefined>(undefined);
  let pendingUpdate = $state<AvailableUpdate | null>(null);
  let updatePolicy = $state<UpdatePolicy | null>(null);
  let isUpdateOpen = $state(false);
  let updateCheckLocal = $state(true);
  let updateTimer: ReturnType<typeof setInterval> | undefined;
  let remoteRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let unlisteners: UnlistenFn[] = [];

  let presenceRegistry: Awareness | null = null;
  let presenceDoc: Y.Doc | null = null;
  let activeEditors = $state<PresenceUser[]>([]);
  let unlistenAwareness: UnlistenFn | null = null;
  let presencePruneTimer: ReturnType<typeof setInterval> | undefined;
  let undoPending = false;
  let lastUndoableAction: 'delete' | 'text' = 'text';
  function handleGlobalShortcuts(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat) return;
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;
    const target = event.target instanceof Element ? event.target : null;

    // Ctrl+K / Cmd+K -> Toggle Command Palette
    if (isCtrlOrMeta && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopPropagation();
      isCommandPaletteOpen = !isCommandPaletteOpen;
      return;
    }

    // Skip other shortcuts if inside an input or editor
    if (target?.closest('input, textarea, select, .cm-editor, [contenteditable="true"]')) return;

    // Ctrl+J / Cmd+J -> Toggle AI Copilot
    if (isCtrlOrMeta && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      event.stopPropagation();
      isAiChatOpen = !isAiChatOpen;
      return;
    }

    // Ctrl+G / Cmd+G -> Toggle Graph
    if (isCtrlOrMeta && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      event.stopPropagation();
      isGraphOpen = !isGraphOpen;
      return;
    }

    // Ctrl+, -> Open Settings
    if (isCtrlOrMeta && event.key === ',') {
      event.preventDefault();
      event.stopPropagation();
      openSettings('general');
      return;
    }
  }

  async function handleQuickNewNote(folder = '') {
    appleCreateKind = 'note';
    appleNewNoteName = folder;
    appleNewNoteError = '';
    appleNewNoteOpen = true;
  }

  async function submitAppleNewNote() {
    const name = appleNewNoteName.trim();
    if (!name || appleCreateBusy) return;
    appleCreateBusy = true;
    try {
      let path = '';
      if (appleCreateKind === 'note') path = await createNote(name, name.split('/').at(-1) || name);
      else await createFolder(name);
      appleNewNoteOpen = false;
      await refreshItems();
      if (path) await openNote(path);
    } catch (e: any) {
      appleNewNoteError = trError(typeof e === 'string' ? e : e.message || 'sidebar.errorCreateNote');
    } finally { appleCreateBusy = false; }
  }

  async function handleQuickNewFolder() {
    appleCreateKind = 'folder';
    appleNewNoteName = '';
    appleNewNoteError = '';
    appleNewNoteOpen = true;
  }

  async function handleQuickSync() {
    syncStatus = 'syncing';
    try {
      await networkSyncNow();
      await refreshItems();
      syncStatus = 'synced';
      setTimeout(() => {
        syncStatus = 'idle';
      }, 2500);
    } catch {
      syncStatus = 'error';
    }
  }

  async function handleThemeChange(nextTheme: AppTheme) {
    theme = nextTheme;
    try {
      await saveTheme(nextTheme);
      if (settings) settings.theme = nextTheme;
    } catch (err) {
      console.error('Failed to save theme:', err);
    }
  }

  async function handleUndoDeletedItem(event: KeyboardEvent) {
    if (event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey)
      || event.shiftKey || event.altKey || event.repeat || event.defaultPrevented || undoPending
      || isSettingsOpen || !activeVault || document.querySelector('[data-modal-backdrop]')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.cm-editor')) {
      if (lastUndoableAction !== 'delete') return;
    } else if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    undoPending = true;
    try {
      const restored = await undoLastDelete();
      if (restored) {
        await refreshItems();
        if (!restored.is_dir) await openNote(restored.path);
        lastUndoableAction = restored.has_more ? 'delete' : 'text';
      } else lastUndoableAction = 'text';
    } catch (error) {
      appError = trError(String(error));
    } finally {
      undoPending = false;
    }
  }
  async function loadInitialData() {
    try {
      const data = await getAppState();
      settings = data.settings;
      locale.set(resolveLocale(data.settings.language));
      updateCheckLocal = data.settings.update_check;
      theme = data.settings.theme === 'light' ? 'light' : 'dark';
      viewMode = ['edit', 'split', 'preview'].includes(data.settings.view_mode)
        ? data.settings.view_mode
        : 'split';
      activeVault = data.active_vault;
      vaults = data.settings.vaults;
      items = data.items;
      if (data.pair_info) {
        pairCode = data.pair_info.pair_code;
        endpointId = data.pair_info.endpoint_id;
      }
      if (!data.settings.has_seen_welcome) {
        isWelcomeOpen = true;
      }

      if (items.length > 0 && !selectedNotePath) {
        const firstNote = items.find((i) => !i.is_dir);
        if (firstNote) {
          await openNote(firstNote.path);
        }
      }
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  async function checkForUpdates() {
    if (settings?.update_check === false) return;
    try {
      updatePolicy = await getUpdatePolicy();
      const update = await checkAvailableUpdate(updatePolicy);
      if (update && update.version !== settings?.skipped_version) {
        pendingUpdate = update;
        isUpdateOpen = true;
      }
    } catch (e) {
      console.error('Failed to check for updates:', e);
    }
  }

  async function refreshItems() {
    try {
      items = await listNotes();
      if (selectedNotePath && !items.some((item) => !item.is_dir && item.path === selectedNotePath)) {
        selectedNotePath = '';
        currentNoteContent = '';
        currentCrdtBase64 = '';
      }
    } catch (e) {
      console.error('Failed to refresh notes:', e);
    }
  }

  function handleOpenWikilink(token: string) {
    const path = resolveNoteLink(items, selectedNotePath, token);
    if (path) {
      openNote(path);
    }
  }


  function refreshActiveEditors() {
    if (!presenceRegistry) {
      activeEditors = [];
      return;
    }
    const byDevice = new Map<string, PresenceUser>();
    for (const [clientId, state] of presenceRegistry.getStates()) {
      if (clientId === presenceRegistry.clientID) continue;
      const user = parsePresenceState(state)?.user;
      if (user?.deviceId) {
        byDevice.set(user.deviceId, user);
      }
    }
    activeEditors = [...byDevice.values()];
  }
  async function openNote(path: string) {
    try {
      const res = await readNote(path);
      currentNoteContent = res.content;
      currentCrdtBase64 = res.crdt_update_base64;
      selectedNotePath = path;
      isGraphOpen = false;
    } catch (e) {
      console.error('Failed to open note:', e);
    }
  }

  async function handleNavigateToSource(path: string, line: number) {
    if (selectedNotePath !== path) {
      await openNote(path);
    }
    targetLine = line;
  }

  async function handleOpenVaultFolder() {
    const path = await pickVaultDirectory();
    if (path) {
      const res = await selectVault(path);
      activeVault = res.active_vault;
      lastUndoableAction = 'text';
      settings = res.settings;
      vaults = res.settings.vaults;
      items = res.items;
      if (res.pair_info) {
        pairCode = res.pair_info.pair_code;
        endpointId = res.pair_info.endpoint_id;
      } else {
        networkGetPairInfo().then((info) => {
          if (info) {
            pairCode = info.pair_code;
            endpointId = info.endpoint_id;
          }
        });
      }

      if (items.length > 0) {
        const first = items.find((i) => !i.is_dir);
        if (first) await openNote(first.path);
      }
    }
  }

  function openSettings(tab: 'general' | 'themes' | 'ai' | 'providers' | 'web' | 'about' = 'general') {
    settingsTab = tab;
    isSettingsOpen = true;
  }

  async function closeSettings() {
    if (selectedNotePath) await openNote(selectedNotePath);
    isSettingsOpen = false;
  }

  function handleSettingsChange(next: AppSettings) {
    settings = next;
    theme = next.theme;
    viewMode = next.view_mode;
    updateCheckLocal = next.update_check;
    locale.set(resolveLocale(next.language));
  }

  let viewModeRevision = 0;
  let viewModeSave: Promise<void> = Promise.resolve();
  async function handleViewModeChange(next: ViewMode) {
    if (next === viewMode) return;
    const previous = viewMode;
    viewMode = next;
    const revision = ++viewModeRevision;
    const saving = viewModeSave.catch(() => {}).then(() => saveViewMode(next));
    viewModeSave = saving;
    try {
      await saving;
      if (settings && revision === viewModeRevision) settings.view_mode = next;
    } catch (error) {
      if (revision === viewModeRevision) viewMode = previous;
      console.error('Failed to save view mode:', error);
    }
  }

  $effect(() => {
    const palettes = settings?.theme_palettes;
    applyTheme(palettes?.active_palette_id ?? DEFAULT_PALETTE_ID, theme, palettes?.custom_palettes ?? []);
  });

  $effect(() => {
    document.documentElement.lang = $locale;
  });

  onMount(async () => {
    window.addEventListener('keydown', handleGlobalShortcuts, true);
    window.addEventListener('keydown', handleUndoDeletedItem, true);
    // Setup P2P event listeners first so no events are lost
    const u1 = await listen<NetworkEventPayload>('p2p:ready', (event) => {
      if (event.payload.type === 'Ready') {
        pairCode = event.payload.pair_code;
        endpointId = event.payload.endpoint_id;
      }
    });

    const u2 = await listen<NetworkEventPayload>('p2p:syncing', () => {
      syncStatus = 'syncing';
    });

    const u3 = await listen<NetworkEventPayload>('p2p:synced', async () => {
      syncStatus = 'synced';
      await refreshItems();
      setTimeout(() => {
        syncStatus = 'idle';
      }, 3000);
    });

    const u4 = await listen<NetworkEventPayload>('p2p:pair-requested', (event) => {
      if (event.payload.type === 'PairRequested') {
        incomingRequest = {
          request_id: event.payload.request_id,
          peer: event.payload.peer,
        };
      }
    });

    const u5 = await listen<{ type: string; peer: PeerConfig }>('p2p:pair-approved', async (event) => {
      if (activeVault && event.payload.peer) {
        if (!activeVault.peers.some((p) => p.endpoint_id === event.payload.peer.endpoint_id)) {
          activeVault.peers.push(event.payload.peer);
        }
      }
    });

    const u6 = await listen<NetworkEventPayload>('p2p:error', (event) => {
      if (event.payload.type === 'Error') {
        syncStatus = 'error';
        console.error('[p2p]', trError(event.payload.message), event.payload.peer ?? '');
      }
    });

    const u7 = await listen<NetworkEventPayload>('p2p:crdt-update', () => {
      if (remoteRefreshTimer) clearTimeout(remoteRefreshTimer);
      remoteRefreshTimer = setTimeout(refreshItems, 300);
    });

    const u8 = await listen<NetworkEventPayload>('p2p:conflict', (event) => {
      if (event.payload.type !== 'Conflict') return;
      conflictNotice = {
        note_path: event.payload.note_path,
        conflict_path: event.payload.conflict_path,
      };
      void refreshItems();
    });

    unlisteners = [u1, u2, u3, u4, u5, u6, u7, u8];

    presenceDoc = new Y.Doc();
    presenceRegistry = new Awareness(presenceDoc);
    unlistenAwareness = await listen<{ note_path: string; update: number[] }>(
      'p2p:awareness',
      (event) => {
        if (presenceRegistry) {
          applyAwarenessUpdate(presenceRegistry, new Uint8Array(event.payload.update), 'remote');
          refreshActiveEditors();
        }
      }
    );
    presencePruneTimer = setInterval(() => {
      if (!presenceRegistry) return;
      const now = Date.now();
      const stale: number[] = [];
      presenceRegistry.meta.forEach((meta, clientId) => {
        if (clientId !== presenceRegistry!.clientID && now - meta.lastUpdated > outdatedTimeout) {
          stale.push(clientId);
        }
      });
      if (stale.length > 0) {
        removeAwarenessStates(presenceRegistry, stale, 'prune');
        refreshActiveEditors();
      }
    }, 15000);

    await loadInitialData();
    void checkForUpdates();
    updateTimer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);

    // Fallback: if pairCode is still empty after initial load, fetch it on-demand
    if (!pairCode) {
      try {
        const info = await networkGetPairInfo();
        if (info) {
          pairCode = info.pair_code;
          endpointId = info.endpoint_id;
        }
      } catch (err) {
        console.error('Failed to fetch P2P code:', err);
      }
    }
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalShortcuts, true);
    window.removeEventListener('keydown', handleUndoDeletedItem, true);
    unlisteners.forEach((u) => u());
    if (updateTimer) clearInterval(updateTimer);
    if (remoteRefreshTimer) clearTimeout(remoteRefreshTimer);
    if (unlistenAwareness) unlistenAwareness();
    if (presencePruneTimer) clearInterval(presencePruneTimer);
    if (presenceRegistry) {
      presenceRegistry.destroy();
      presenceRegistry = null;
    }
    if (presenceDoc) {
      presenceDoc.destroy();
      presenceDoc = null;
    }
  });
</script>

<div class="apple-app-shell flex h-screen w-screen overflow-hidden text-[var(--text-main)]">
  {#if isSettingsOpen && settings}
    <SettingsView {settings} initialTab={settingsTab} onClose={() => void closeSettings()} onChange={handleSettingsChange} />
  {:else if !activeVault}
    <main class="apple-welcome">
      <div class="apple-welcome-content">
        <span class="apple-welcome-mark"><NotebookPen size={34} strokeWidth={1.5} /></span>
        <h1>{$t('app.welcomeTitle')}</h1>
        <p class="apple-welcome-intro">{$t('app.welcomeSubtitle')}</p>
        <div class="apple-welcome-actions"><button class="apple-primary-button" onclick={handleOpenVaultFolder}><FolderOpen size={17} />{$t('app.chooseVaultFolder')}</button><button class="apple-secondary-button" onclick={() => openSettings()}><Settings2 size={17} />{$t('settings.title')}</button></div>
        <p class="apple-welcome-footnote">{$t('app.filesReadable')}</p>
        <div class="apple-welcome-features">
          <section><FileText size={22} strokeWidth={1.6} /><h2>{$t('app.featureMarkdownTitle')}</h2><p>{$t('app.featureMarkdownDesc')}</p></section>
          <section><ShieldCheck size={22} strokeWidth={1.6} /><h2>{$t('app.featureP2PTitle')}</h2><p>{$t('app.featureP2PDesc')}</p></section>
          <section><Sparkles size={22} strokeWidth={1.6} /><h2>{$t('app.featureAiTitle')}</h2><p>{$t('app.featureAiDesc')}</p></section>
        </div>
      </div>
    </main>
  {:else}
    <!-- Main App Layout -->
    <Sidebar
      {activeVault}
      {vaults}
      {items}
      selectedPath={selectedNotePath}
      {syncStatus}
      peerCount={activeVault.peers.length}
      onOpenSettings={() => openSettings()}
      onSelectNote={(path) => openNote(path)}
      onVaultChange={(v) => {
        activeVault = v;
        lastUndoableAction = 'text';
        selectedNotePath = '';
        isGraphOpen = false;
        currentNoteContent = '';
        currentCrdtBase64 = '';
        pairCode = '';
        endpointId = '';
        refreshItems();
        networkGetPairInfo().then((info) => {
          if (info) {
            pairCode = info.pair_code;
            endpointId = info.endpoint_id;
          }
        });
      }}
      onOpenPairModal={() => (isPairModalOpen = true)}
      onRefreshItems={refreshItems}
      onItemDeleted={() => (lastUndoableAction = 'delete')}
      onOpenCommandPalette={() => (isCommandPaletteOpen = true)}
      presence={activeEditors}
      {theme}
      {viewMode}
      {isGraphOpen}
      isAiOpen={isAiChatOpen}
      onCreateNote={handleQuickNewNote}
      onToggleGraph={() => (isGraphOpen = !isGraphOpen)}
      onToggleAi={() => (isAiChatOpen = !isAiChatOpen)}
      onToggleTheme={toggleTheme}
      onViewModeChange={handleViewModeChange}
      onPanelVisibilityChange={(visible) => sidebarVisible = visible}
    />

    <!-- Editor Surface -->
    <div class="apple-content-surface flex-1 min-w-0 flex flex-col h-full overflow-hidden relative">
      {#if conflictNotice}
        <div role="alert" class="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--danger)]/50 bg-[var(--bg-card)]/95 backdrop-blur-md text-xs shadow-lg">
          <div class="flex-1 min-w-0">
            <strong class="text-[var(--danger)] font-bold">{$t('app.conflictDetected')}</strong>
            <span class="ml-2 text-[var(--text-muted)]">{$t('app.conflictExplanation')}</span>
            <span class="block truncate mt-0.5 text-[var(--text-dim)] font-mono text-[11px]">{conflictNotice.note_path} → {conflictNotice.conflict_path}</span>
          </div>
          <button class="shrink-0 rounded-lg px-3.5 py-1.5 bg-[var(--accent)] text-[var(--accent-contrast)] font-bold text-xs shadow hover:opacity-90 transition" onclick={() => { if (conflictNotice) void openNote(conflictNotice.conflict_path); conflictNotice = null; }}>{$t('app.openConflict')}</button>
          <button class="shrink-0 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded-md hover:bg-[var(--bg-hover)]" aria-label={$t('app.dismissConflict')} title={$t('app.dismissConflict')} onclick={() => (conflictNotice = null)}>✕</button>
        </div>
      {/if}
      {#if isGraphOpen}
        <GraphView
          {items}
          vaultId={activeVault.id}
          onClose={() => (isGraphOpen = false)}
          onOpenNote={(path: string) => void openNote(path)}
        />
      {:else if selectedNotePath}
        {#key selectedNotePath}
        <Editor
          notePath={selectedNotePath}
          initialContent={currentNoteContent}
          crdtUpdateBase64={currentCrdtBase64}
          {targetLine}
          {theme}
          {viewMode}
          showFloatingViewModes={!sidebarVisible}
          lineWrapping={settings?.line_wrapping ?? true}
          imageUploadProvider={settings?.image_upload?.provider ?? 'local'}
          vaultId={settings?.active_vault_id ?? ''}
          onViewModeChange={handleViewModeChange}
          {isAiChatOpen}
          onToggleAiChat={() => (isAiChatOpen = !isAiChatOpen)}
          onOpenNote={(path: string) => openNote(path)}
          onOpenGraph={() => (isGraphOpen = true)}
          onLocalEdit={() => (lastUndoableAction = 'text')}
          onOpenWikilink={handleOpenWikilink}
          deviceName={settings?.device_name ?? ''}
          deviceId={endpointId}
        />
        {/key}
      {:else}
        <div class="apple-empty-library">
          <header class="app-topbar flex items-center gap-3 px-6 border-b border-[var(--border)] text-xs text-[var(--text-muted)]"><span>{activeVault.name}</span><ChevronRight size={12} /><span>{$t('sidebar.allNotes')}</span></header>
          <div class="apple-empty-message"><span class="apple-welcome-mark"><NotebookPen size={28} strokeWidth={1.5} /></span><h2>{$t('app.appleEmptyTitle')}</h2><p>{$t('app.appleEmptyDescription')}</p></div>
        </div>
      {/if}
    </div>

  {/if}

  <!-- Keep chat mounted while settings are open so pending replies and drafts survive. -->
  {#if settings && activeVault}
    <div style:display={isSettingsOpen ? 'none' : 'contents'}>
      {#key activeVault.id}
        <AiChatSidebar
          bind:isOpen={isAiChatOpen}
          bind:aiSettings={settings.ai}
          vaultId={activeVault.id}
          currentNotePath={selectedNotePath}
          onNavigateToSource={handleNavigateToSource}
          onNotesCreated={refreshItems}
          onOpenSettings={openSettings}
        />
      {/key}
    </div>
  {/if}

  <!-- Modals -->
  {#if appError}<div class="apple-app-notice" role="alert"><span>{appError}</span><button aria-label={$t('ai.close')} onclick={() => (appError = '')}>✕</button></div>{/if}
  {#if appleNewNoteOpen}
    <div
      class="apple-dialog-backdrop"
      data-modal-backdrop="apple-create"
      role="presentation"
      onclick={(event) => { if (event.target === event.currentTarget) appleNewNoteOpen = false; }}
    >
      <div
        bind:this={appleDialogElement}
        class="apple-new-note-dialog"
        use:liquidGlass role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="apple-new-note-title"
        onkeydown={handleAppleDialogKeydown}
      >
        <form onsubmit={(event) => { event.preventDefault(); void submitAppleNewNote(); }}>
        <span class="apple-dialog-eyebrow">LowNotes</span>
        <h2 id="apple-new-note-title">{$t(appleCreateKind === 'note' ? 'sidebar.newNote' : 'sidebar.newFolder')}</h2>
        <p>{$t(appleCreateKind === 'note' ? 'sidebar.noteNamePlaceholder' : 'sidebar.folderNamePlaceholder')}</p>
        <input bind:this={appleNoteInput} bind:value={appleNewNoteName} aria-label={$t(appleCreateKind === 'note' ? 'sidebar.noteNamePlaceholder' : 'sidebar.folderNamePlaceholder')} placeholder={$t(appleCreateKind === 'note' ? 'sidebar.noteNamePlaceholder' : 'sidebar.folderNamePlaceholder')} autocomplete="off" disabled={appleCreateBusy} />
        {#if appleNewNoteError}<p class="apple-dialog-error" role="alert">{appleNewNoteError}</p>{/if}
        <div class="apple-dialog-actions">
          <button type="button" class="apple-secondary-action" onclick={() => appleNewNoteOpen = false}>{$t('sidebar.cancel')}</button>
          <button type="submit" class="apple-primary-action" disabled={appleCreateBusy || !appleNewNoteName.trim()}>{$t('sidebar.create')}</button>
        </div>
        </form>
      </div>
    </div>
  {/if}
  <PairModal
    bind:isOpen={isPairModalOpen}
    bind:pairCode
    bind:endpointId
    vaultName={activeVault?.name || ''}
    peers={activeVault?.peers || []}
    onPeersChange={async () => {
      const data = await getAppState();
      activeVault = data.active_vault;
    }}
  />

  <IncomingPairDialog
    request={incomingRequest}
    onAnswer={() => {
      incomingRequest = null;
    }}
  />

  <WelcomeModal
    bind:isOpen={isWelcomeOpen}
    onOpenAiChat={() => {
      isAiChatOpen = true;
    }}
  />

  <UpdateModal
    bind:isOpen={isUpdateOpen}
    update={pendingUpdate}
    policy={updatePolicy}
    bind:autoCheck={updateCheckLocal}
    onAutoCheckChange={async (v) => {
      updateCheckLocal = v;
      await saveUpdatePrefs(v, settings?.skipped_version ?? '');
      if (settings) settings.update_check = v;
    }}
    onSkip={async (v) => {
      await saveUpdatePrefs(updateCheckLocal, v);
      if (settings) {
        settings.skipped_version = v;
      }
      isUpdateOpen = false;
    }}
  />

  <CommandPalette
    isOpen={isCommandPaletteOpen}
    {items}
    {viewMode}
    {theme}
    onClose={() => (isCommandPaletteOpen = false)}
    onOpenNote={(path: string) => void openNote(path)}
    onCreateNote={() => void handleQuickNewNote()}
    onCreateFolder={() => void handleQuickNewFolder()}
    onToggleAi={() => (isAiChatOpen = !isAiChatOpen)}
    onToggleGraph={() => (isGraphOpen = !isGraphOpen)}
    onOpenSettings={(tab) => void openSettings(tab || 'general')}
    onOpenPair={() => (isPairModalOpen = true)}
    onSync={() => void handleQuickSync()}
    onChangeTheme={(next) => void handleThemeChange(next)}
    onChangeViewMode={(mode) => void handleViewModeChange(mode)}
  />
</div>
