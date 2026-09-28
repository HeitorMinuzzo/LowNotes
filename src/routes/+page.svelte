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
  } from '$lib/api';
  import { locale, resolveLocale, t, trError } from '$lib/i18n';
  import { resolveNoteLink } from '$lib/note-links';
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
  import PairModal from '$lib/components/PairModal.svelte';
  import IncomingPairDialog from '$lib/components/IncomingPairDialog.svelte';
  import AiChatSidebar from '$lib/components/AiChatSidebar.svelte';
  import WelcomeModal from '$lib/components/WelcomeModal.svelte';
  import UpdateModal from '$lib/components/UpdateModal.svelte';
  import SettingsView from '$lib/components/SettingsView.svelte';
  let settings = $state<AppSettings | null>(null);
  let theme = $state<AppTheme>('dark');
  let viewMode = $state<ViewMode>('split');
  let activeVault = $state<VaultConfig | null>(null);
  let vaults = $state<VaultConfig[]>([]);
  let items = $state<VaultItem[]>([]);
  let selectedNotePath = $state<string>('');
  let currentNoteContent = $state<string>('');
  let currentCrdtBase64 = $state<string>('');

  let pairCode = $state<string>('');
  let endpointId = $state<string>('');
  let syncStatus = $state<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  let isPairModalOpen = $state(false);
  let incomingRequest = $state<{ request_id: string; peer: PeerConfig } | null>(null);
  let isAiChatOpen = $state(false);
  let isSettingsOpen = $state(false);
  let settingsTab = $state<'general' | 'ai' | 'providers' | 'web' | 'about'>('general');
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

  function openSettings(tab: 'general' | 'ai' | 'providers' | 'web' | 'about' = 'general') {
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
    document.documentElement.dataset.theme = theme;
  });

  $effect(() => {
    document.documentElement.lang = $locale;
  });

  onMount(async () => {
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

    unlisteners = [u1, u2, u3, u4, u5, u6, u7];

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
    <!-- Welcome screen when no vault is configured -->
    <main class="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
      <button class="absolute top-5 right-6 text-sm text-[var(--text-muted)] hover:text-[var(--accent-light)]" onclick={() => openSettings()}>{$t('settings.title')}</button>
      <div class="w-16 h-16 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-3xl mb-6 shadow-xl">
        ✦
      </div>
      <h1 class="text-2xl font-bold mb-2">{$t('app.welcomeTitle')}</h1>
      <p class="text-sm text-[var(--text-muted)] max-w-md mb-8 leading-relaxed">
        {$t('app.welcomeSubtitle')}
      </p>

      <button
        onclick={handleOpenVaultFolder}
        class="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black font-semibold text-sm rounded-xl transition shadow-lg flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
      >
        <span>📁</span>
        <span>{$t('app.chooseVaultFolder')}</span>
      </button>

      <p class="text-xs text-[var(--text-dim)] mt-6">
        {$t('app.filesReadable')}
      </p>
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
        selectedNotePath = '';
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
      presence={activeEditors}
    />

    <!-- Editor Surface -->
    <div class="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-main)]">
      {#if selectedNotePath}
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
          onOpenWikilink={handleOpenWikilink}
          deviceName={settings?.device_name ?? ''}
          deviceId={endpointId}
        />
        {/key}
      {:else}
        <div class="flex-1 flex flex-col items-center justify-center text-center p-8 select-none text-[var(--text-dim)] relative">
          <button
            onclick={() => (isAiChatOpen = !isAiChatOpen)}
            class="absolute top-3 right-4 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs text-[var(--text-muted)] hover:text-[var(--accent-light)] flex items-center gap-1.5 transition shadow"
          >
            <span>💬</span>
            <span>{$t('app.openAiChat')}</span>
          </button>
          <span class="text-4xl mb-3 opacity-60">📄</span>
          <p class="text-sm">{$t('app.emptyState')}</p>
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
</div>
