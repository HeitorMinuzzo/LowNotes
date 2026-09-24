<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import type {
    AppSettings,
    VaultConfig,
    VaultItem,
    PeerConfig,
    NetworkEventPayload,
  } from '$lib/types';
  import {
    getAppState,
    listNotes,
    readNote,
    pickVaultDirectory,
    selectVault,
  } from '$lib/api';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Editor from '$lib/components/Editor.svelte';
  import PairModal from '$lib/components/PairModal.svelte';
  import IncomingPairDialog from '$lib/components/IncomingPairDialog.svelte';

  let settings = $state<AppSettings | null>(null);
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

  let unlisteners: UnlistenFn[] = [];

  async function loadInitialData() {
    try {
      const data = await getAppState();
      settings = data.settings;
      activeVault = data.active_vault;
      vaults = data.settings.vaults;
      items = data.items;

      if (items.length > 0 && !selectedNotePath) {
        const firstNote = items.find((i) => !i.is_dir);
        if (firstNote) {
          await openNote(firstNote.path);
        }
      }
    } catch (e) {
      console.error('Falha ao carregar estado inicial:', e);
    }
  }

  async function refreshItems() {
    try {
      items = await listNotes();
    } catch (e) {
      console.error('Falha ao atualizar notas:', e);
    }
  }

  async function openNote(path: string) {
    try {
      selectedNotePath = path;
      const res = await readNote(path);
      currentNoteContent = res.content;
      currentCrdtBase64 = res.crdt_update_base64;
    } catch (e) {
      console.error('Falha ao abrir nota:', e);
    }
  }

  async function handleOpenVaultFolder() {
    const path = await pickVaultDirectory();
    if (path) {
      const res = await selectVault(path);
      activeVault = res.active_vault;
      settings = res.settings;
      vaults = res.settings.vaults;
      items = res.items;

      if (items.length > 0) {
        const first = items.find((i) => !i.is_dir);
        if (first) await openNote(first.path);
      }
    }
  }

  onMount(async () => {
    await loadInitialData();

    // Setup P2P event listeners
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

    unlisteners = [u1, u2, u3, u4, u5];
  });

  onDestroy(() => {
    unlisteners.forEach((u) => u());
  });
</script>

<div class="flex h-screen w-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]">
  {#if !activeVault}
    <!-- Welcome screen when no vault is configured -->
    <main class="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
      <div class="w-16 h-16 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-3xl mb-6 shadow-xl">
        ✦
      </div>
      <h1 class="text-2xl font-bold mb-2">Bem-vindo ao LowNotes</h1>
      <p class="text-sm text-[var(--text-muted)] max-w-md mb-8 leading-relaxed">
        Editor de notas Markdown local-first, super leve e com sincronização P2P criptografada sem servidor central.
      </p>

      <button
        onclick={handleOpenVaultFolder}
        class="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black font-semibold text-sm rounded-xl transition shadow-lg flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
      >
        <span>📁</span>
        <span>Escolher pasta para o Vault</span>
      </button>

      <p class="text-xs text-[var(--text-dim)] mt-6">
        Seus arquivos permanecem 100% legíveis como arquivos .md no seu computador.
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
      onSelectNote={(path) => openNote(path)}
      onVaultChange={(v) => {
        activeVault = v;
        refreshItems();
      }}
      onOpenPairModal={() => (isPairModalOpen = true)}
      onRefreshItems={refreshItems}
    />

    <!-- Editor Surface -->
    <div class="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-main)]">
      {#if selectedNotePath}
        <Editor
          notePath={selectedNotePath}
          initialContent={currentNoteContent}
          crdtUpdateBase64={currentCrdtBase64}
        />
      {:else}
        <div class="flex-1 flex flex-col items-center justify-center text-center p-8 select-none text-[var(--text-dim)]">
          <span class="text-4xl mb-3 opacity-60">📄</span>
          <p class="text-sm">Selecione uma nota na barra lateral ou crie uma nova para começar.</p>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Modals -->
  <PairModal
    bind:isOpen={isPairModalOpen}
    {pairCode}
    {endpointId}
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
</div>
