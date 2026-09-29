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
  } from '$lib/types';
  import { check, type Update } from '@tauri-apps/plugin-updater';
  import {
    getAppState,
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
  import Sidebar from '$lib/components/Sidebar.svelte';
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
  import BorderBeam from '$lib/components/ui/BorderBeam.svelte';
  import ShimmerButton from '$lib/components/ui/ShimmerButton.svelte';
  import AmbientGlow from '$lib/components/ui/AmbientGlow.svelte';
  let settings = $state<AppSettings | null>(null);
  let theme = $state<AppTheme>('dark');
  let viewMode = $state<ViewMode>('split');
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
  let pendingUpdate = $state<Update | null>(null);
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

  async function handleQuickNewNote() {
    const name = prompt($t('sidebar.noteNamePlaceholder') || 'Nome da nova nota:');
    if (!name || !name.trim()) return;
    try {
      const trimmed = name.trim();
      const path = await createNote(trimmed, trimmed.split('/').at(-1) || trimmed);
      await refreshItems();
      await openNote(path);
    } catch (e: any) {
      alert(trError(typeof e === 'string' ? e : e.message || 'sidebar.errorCreateNote'));
    }
  }

  async function handleQuickNewFolder() {
    const name = prompt($t('sidebar.folderNamePlaceholder') || 'Nome da nova pasta:');
    if (!name || !name.trim()) return;
    try {
      await createFolder(name.trim());
      await refreshItems();
    } catch (e: any) {
      alert(trError(typeof e === 'string' ? e : e.message || 'sidebar.errorCreateFolder'));
    }
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
      alert(trError(String(error)));
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
      const update = await check();
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

  async function handleViewModeChange(next: ViewMode) {
    const previous = viewMode;
    viewMode = next;
    try {
      await saveViewMode(next);
      if (settings) settings.view_mode = next;
    } catch (error) {
      viewMode = previous;
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

<div class="flex h-screen w-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]">
  {#if isSettingsOpen && settings}
    <SettingsView {settings} initialTab={settingsTab} onClose={() => void closeSettings()} onChange={handleSettingsChange} />
  {:else if !activeVault}
    <!-- Welcome screen when no vault is configured (Magic UI Bento Showcase) -->
    <main class="relative flex-1 flex flex-col items-center justify-center p-6 md:p-12 text-center select-none overflow-y-auto">
      <AmbientGlow color="var(--accent)" size="600px" opacity={0.12} class="top-[-100px] left-1/2 -translate-x-1/2" />
      <AmbientGlow color="var(--danger)" size="450px" opacity={0.08} class="bottom-[-150px] right-[-100px]" />

      <!-- Topbar actions -->
      <div class="absolute top-6 right-8 flex items-center gap-3">
        <button
          onclick={() => openSettings()}
          class="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-card)]/80 hover:bg-[var(--bg-hover)] text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all shadow-sm backdrop-blur-md"
        >
          <span>⚙️</span>
          <span>{$t('settings.title')}</span>
        </button>
      </div>

      <!-- Hero Header -->
      <div class="relative z-10 max-w-2xl flex flex-col items-center">
        <!-- Floating badge -->
        <div class="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-card)]/90 backdrop-blur-md text-xs font-medium text-[var(--accent)] mb-6 shadow-sm">
          <span class="w-2 h-2 rounded-full bg-[var(--accent)] animate-[pulse-subtle_2s_infinite]"></span>
          <span>LowNotes v0.2.1 • P2P & Markdown Local</span>
        </div>

        <h1 class="text-3xl md:text-5xl font-extrabold tracking-tight mb-4 text-[var(--text-main)] leading-tight">
          {$t('app.welcomeTitle')}
        </h1>

        <p class="text-sm md:text-base text-[var(--text-muted)] max-w-lg mb-8 leading-relaxed">
          {$t('app.welcomeSubtitle')}
        </p>

        <!-- CTA Shimmer Button -->
        <div class="relative mb-12">
          <ShimmerButton onclick={handleOpenVaultFolder} class="px-7 py-3.5 text-sm font-bold shadow-xl">
            <span class="text-base">📁</span>
            <span>{$t('app.chooseVaultFolder')}</span>
          </ShimmerButton>
        </div>
      </div>

      <!-- Bento Grid features -->
      <div class="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl w-full text-left">
        <div class="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/70 backdrop-blur-md p-5 glow-card-hover group">
          <div class="w-10 h-10 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 flex items-center justify-center text-lg mb-3">
            📄
          </div>
          <h3 class="text-sm font-bold text-[var(--text-main)] mb-1">Arquivos Markdown Reais</h3>
          <p class="text-xs text-[var(--text-muted)] leading-relaxed">
            {$t('app.filesReadable')} Suas notas permanecem legíveis em qualquer outro editor.
          </p>
        </div>

        <div class="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/70 backdrop-blur-md p-5 glow-card-hover group">
          <BorderBeam size={120} duration={8} borderWidth={1.5} colorFrom="var(--accent)" colorTo="var(--accent-light)" />
          <div class="w-10 h-10 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 flex items-center justify-center text-lg mb-3">
            ⚡
          </div>
          <h3 class="text-sm font-bold text-[var(--text-main)] mb-1">P2P Criptografado</h3>
          <p class="text-xs text-[var(--text-muted)] leading-relaxed">
            Sincronização direta entre seus dispositivos via Iroh e CRDTs, sem nuvem proprietária.
          </p>
        </div>

        <div class="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/70 backdrop-blur-md p-5 glow-card-hover group">
          <div class="w-10 h-10 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 flex items-center justify-center text-lg mb-3">
            🧠
          </div>
          <h3 class="text-sm font-bold text-[var(--text-main)] mb-1">Assistente com RAG Local</h3>
          <p class="text-xs text-[var(--text-muted)] leading-relaxed">
            Consulte suas notas e faça buscas na web mantendo sua privacidade sob total controle.
          </p>
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
    />

    <!-- Editor Surface -->
    <div class="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-main)]">
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
          onOpenNote={(path) => void openNote(path)}
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
          onViewModeChange={handleViewModeChange}
          {isAiChatOpen}
          onToggleAiChat={() => (isAiChatOpen = !isAiChatOpen)}
          onOpenNote={(path) => openNote(path)}
          onOpenGraph={() => (isGraphOpen = true)}
          onLocalEdit={() => (lastUndoableAction = 'text')}
          onOpenWikilink={handleOpenWikilink}
          deviceName={settings?.device_name ?? ''}
          deviceId={endpointId}
        />
        {/key}
      {:else}
        <!-- Modern Empty Dashboard state when vault is open but no note is active -->
        <div class="relative flex-1 flex flex-col min-h-0 select-none bg-[var(--bg-main)]">
          <AmbientGlow color="var(--accent)" size="500px" opacity={0.08} class="top-10 right-20" />

          <header class="h-11 flex items-center justify-between gap-3 px-3 border-b border-[var(--border)] bg-[var(--bg-sidebar)]/80 backdrop-blur-xl shrink-0">
            <div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span class="font-semibold text-[var(--text-main)]">{activeVault.name}</span>
              <span>/</span>
              <span class="text-[var(--text-dim)]">{$t('app.emptyState')}</span>
            </div>

            <div class="flex items-center gap-1.5">
              <button
                onclick={() => (isGraphOpen = true)}
                class="h-7 flex items-center px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)]/70 hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition shadow-sm cursor-pointer"
              >
                <span>{$t('graph.button')}</span>
              </button>
              <button
                onclick={() => (isAiChatOpen = !isAiChatOpen)}
                class="h-7 flex items-center px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)]/70 hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--accent)] transition shadow-sm cursor-pointer"
              >
                <span>{$t('app.openAiChat')}</span>
              </button>
            </div>
          </header>

          <div class="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div class="relative p-8 rounded-3xl border border-[var(--border)] bg-[var(--bg-card)]/60 backdrop-blur-xl shadow-2xl max-w-md w-full flex flex-col items-center glow-card-hover">
              <BorderBeam size={180} duration={10} borderWidth={1.5} colorFrom="var(--accent)" colorTo="var(--accent-light)" />
              <div class="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 flex items-center justify-center text-3xl mb-4 shadow-inner">
                📝
              </div>
              <h2 class="text-lg font-bold text-[var(--text-main)] mb-1">
                {$t('app.emptyState')}
              </h2>
              <p class="text-xs text-[var(--text-muted)] max-w-xs leading-relaxed mb-6">
                Selecione uma nota no menu lateral ou abra o assistente de inteligência artificial.
              </p>

              <div class="flex items-center gap-3">
                <button
                  onclick={() => (isGraphOpen = true)}
                  class="px-4 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-main)] transition"
                >
                  🕸 Mapa de Grafos
                </button>
                <button
                  onclick={() => (isAiChatOpen = true)}
                  class="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 text-xs font-bold transition shadow-md"
                >
                  💬 Assistente IA
                </button>
              </div>
            </div>
          </div>
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
    onOpenNote={(path) => void openNote(path)}
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
