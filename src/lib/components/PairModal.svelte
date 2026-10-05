<script lang="ts">
  import { Check, Copy, Laptop, Link, RefreshCw, Share2, Trash2, X } from 'lucide-svelte';
  import type { NetworkEventPayload, PeerConfig } from '../types';
  import { networkRequestPair, networkRemovePeer, networkGetPairInfo } from '../api';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { onDestroy, onMount } from 'svelte';
  import { t, trError, ts } from '$lib/i18n';
  import { dismissibleModal } from '$lib/modal-dismiss';
  import BorderBeam from './ui/BorderBeam.svelte';

  let {
    isOpen = $bindable(false),
    pairCode = $bindable(''),
    endpointId = $bindable(''),
    vaultName = '',
    peers = [],
    onPeersChange,
  } = $props<{
    isOpen: boolean;
    pairCode?: string;
    endpointId?: string;
    vaultName: string;
    peers: PeerConfig[];
    onPeersChange?: () => void;
  }>();

  let activeTab = $state<'share' | 'join' | 'devices'>('share');
  let inputCode = $state('');
  let isConnecting = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  let copied = $state(false);

  let isLoadingCode = $state(false);
  let loadError = $state<string | null>(null);

  async function fetchPairInfo() {
    if (pairCode) return;
    isLoadingCode = true;
    loadError = null;
    try {
      const info = await networkGetPairInfo();
      if (info) {
        pairCode = info.pair_code;
        endpointId = info.endpoint_id;
      }
    } catch (e: any) {
      console.error('Failed to fetch pairing code:', e);
      loadError = trError(typeof e === 'string' ? e : e?.message || 'pair.fetchFailed');
    } finally {
      isLoadingCode = false;
    }
  }

  $effect(() => {
    if (isOpen && !pairCode) {
      fetchPairInfo();
    }
  });

  function copyCode() {
    if (!pairCode) return;
    navigator.clipboard.writeText(pairCode);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2500);
  }

  async function handleRequestPair() {
    if (!inputCode.trim()) return;

    isConnecting = true;
    statusMessage = { type: 'info', text: ts('pair.connecting') };

    try {
      await networkRequestPair(inputCode.trim());
      statusMessage = {
        type: 'info',
        text: ts('pair.requestSent'),
      };
      inputCode = '';
      onPeersChange?.();
    } catch (err: any) {
      statusMessage = {
        type: 'error',
        text: trError(typeof err === 'string' ? err : err.message || 'pair.requestFailed'),
      };
    } finally {
      isConnecting = false;
    }
  }

  async function handleRemove(peerId: string) {
    if (confirm(ts('pair.confirmRemove'))) {
      try {
        await networkRemovePeer(peerId);
        onPeersChange?.();
      } catch (e) {
        console.error('Failed to remove peer:', e);
      }
    }
  }

  let unlistenError: UnlistenFn | null = null;
  onMount(async () => {
    unlistenError = await listen<NetworkEventPayload>('p2p:error', (event) => {
      if (event.payload.type === 'Error') {
        statusMessage = {
          type: 'error',
          text: trError(event.payload.message),
        };
      }
    });
  });

  onDestroy(() => {
    unlistenError?.();
  });
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div
    use:dismissibleModal={() => (isOpen = false)}
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in zoom-in-95 duration-200"
    role="presentation"
  >
    <!-- Modal Dialog -->
    <div
      class="relative bg-[var(--bg-card)]/95 backdrop-blur-xl border border-[var(--border)] rounded-3xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <BorderBeam size={220} duration={12} borderWidth={1.5} colorFrom="var(--accent)" colorTo="var(--accent-light)" />

      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4.5 border-b border-[var(--border)] bg-[var(--bg-sidebar)]/80 backdrop-blur-md">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 flex items-center justify-center shadow-sm">
            <Share2 size={16} />
          </div>
          <div>
            <h2 class="text-sm font-bold text-[var(--text-main)]">{$t('pair.title')}</h2>
            <p class="text-[11px] text-[var(--text-dim)]">{$t('pair.currentVault')} <span class="text-[var(--accent)] font-semibold">{vaultName}</span></p>
          </div>
        </div>
        <button
          onclick={() => (isOpen = false)}
          title={$t('ai.close')}
          aria-label={$t('ai.close')}
          class="p-1.5 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Tabs Navigation -->
      <div class="flex border-b border-[var(--border)] bg-[var(--bg-sidebar)]/40 px-6 gap-2 pt-2">
        <button
          onclick={() => { activeTab = 'share'; statusMessage = null; }}
          class="flex items-center gap-1.5 py-2.5 px-3.5 text-xs font-semibold border-b-2 transition-all cursor-pointer {activeTab === 'share' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          <Share2 size={13} />
          <span>{$t('pair.tabShare')}</span>
        </button>
        <button
          onclick={() => { activeTab = 'join'; statusMessage = null; }}
          class="flex items-center gap-1.5 py-2.5 px-3.5 text-xs font-semibold border-b-2 transition-all cursor-pointer {activeTab === 'join' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          <Link size={13} />
          <span>{$t('pair.tabJoin')}</span>
        </button>
        <button
          onclick={() => { activeTab = 'devices'; statusMessage = null; }}
          class="flex items-center gap-1.5 py-2.5 px-3.5 text-xs font-semibold border-b-2 transition-all cursor-pointer {activeTab === 'devices' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          <Laptop size={13} />
          <span>{$t('pair.tabDevices', { count: peers.length })}</span>
        </button>
      </div>

      <!-- Tab Content -->
      <div class="p-6 flex-1 overflow-y-auto">
        {#if activeTab === 'share'}
          <div class="flex flex-col gap-4">
            <p class="text-xs text-[var(--text-muted)] leading-relaxed">
              {$t('pair.shareDescription')}
            </p>

            <div class="flex flex-col gap-1.5">
              <label for="p2p-code-display" class="text-xs font-semibold text-[var(--text-dim)]">{$t('pair.inviteLabel')}</label>
              <div class="relative">
                <textarea
                  id="p2p-code-display"
                  readonly
                  value={pairCode || $t('pair.generating')}
                  rows="3"
                  class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-2xl p-3 text-xs font-mono text-[var(--text-main)] resize-none select-all focus:outline-none focus:border-[var(--accent)] shadow-inner"
                ></textarea>
              </div>
            </div>

            {#if loadError}
              <div class="p-3 rounded-xl text-xs leading-relaxed bg-[var(--danger)]/15 border border-[var(--danger)]/40 text-[var(--danger)] flex items-center justify-between">
                <span>{loadError}</span>
                <button
                  onclick={fetchPairInfo}
                  class="px-3 py-1 bg-[var(--danger)]/20 hover:bg-[var(--danger)]/30 rounded-lg text-xs font-semibold text-[var(--danger)] transition"
                >
                  {$t('pair.retry')}
                </button>
              </div>
            {/if}

            <div class="flex justify-between items-center pt-2">
              <span class="text-[11px] text-[var(--text-dim)] font-mono truncate max-w-[260px]">
                {$t('pair.idLabel')} {endpointId ? (endpointId.length > 16 ? endpointId.slice(0, 16) + '...' : endpointId) : '...'}
              </span>
              <button
                onclick={copyCode}
                disabled={!pairCode}
                class="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--accent-contrast)] text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                {#if copied}
                  <Check size={14} />
                  <span>{$t('pair.copied')}</span>
                {:else}
                  <Copy size={14} />
                  <span>{$t('pair.copy')}</span>
                {/if}
              </button>
            </div>
          </div>
        {:else if activeTab === 'join'}
          <div class="flex flex-col gap-4">
            <p class="text-xs text-[var(--text-muted)] leading-relaxed">
              {$t('pair.joinDescription')}
            </p>

            <div class="flex flex-col gap-1.5">
              <label for="p2p-code-input" class="text-xs font-semibold text-[var(--text-dim)]">{$t('pair.joinLabel')}</label>
              <textarea
                id="p2p-code-input"
                bind:value={inputCode}
                placeholder={$t('pair.joinPlaceholder')}
                rows="3"
                class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-2xl p-3 text-xs font-mono text-[var(--text-main)] resize-none focus:outline-none focus:border-[var(--accent)] shadow-inner"
              ></textarea>
            </div>

            {#if statusMessage}
              <div
                class="p-3 rounded-xl text-xs leading-relaxed {statusMessage.type === 'error' ? 'bg-[var(--danger)]/15 border border-[var(--danger)]/30 text-[var(--danger)]' : statusMessage.type === 'success' ? 'bg-[var(--success)]/15 border border-[var(--success)]/30 text-[var(--success)]' : 'bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--accent)]'}"
              >
                {statusMessage.text}
              </div>
            {/if}

            <div class="flex justify-end pt-2">
              <button
                onclick={handleRequestPair}
                disabled={isConnecting || !inputCode.trim()}
                class="px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-[var(--accent-contrast)] text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer active:scale-95"
              >
                {isConnecting ? $t('pair.connectingButton') : $t('pair.requestPair')}
              </button>
            </div>
          </div>
        {:else if activeTab === 'devices'}
          <div class="flex flex-col gap-3">
            {#if peers.length === 0}
              <div class="text-center py-10 flex flex-col items-center">
                <Laptop size={28} class="text-[var(--text-dim)] mb-2 opacity-50" />
                <p class="text-xs text-[var(--text-dim)] font-medium">{$t('pair.noDevices')}</p>
                <button
                  onclick={() => (activeTab = 'share')}
                  class="mt-2 text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  {$t('pair.shareToStart')}
                </button>
              </div>
            {:else}
              <div class="flex flex-col gap-2">
                {#each peers as peer}
                  <div class="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--bg-main)] border border-[var(--border)] shadow-sm">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)]">
                        <Laptop size={16} />
                      </div>
                      <div class="flex flex-col">
                        <span class="text-xs font-bold text-[var(--text-main)]">{peer.name}</span>
                        <span class="text-[10px] font-mono text-[var(--text-dim)]">ID: {peer.endpoint_id.slice(0, 18)}...</span>
                      </div>
                    </div>
                    <button
                      onclick={() => handleRemove(peer.endpoint_id)}
                      class="flex items-center gap-1 px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-xl border border-transparent hover:border-[var(--danger)]/30 transition cursor-pointer"
                    >
                      <Trash2 size={12} />
                      <span>{$t('pair.remove')}</span>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
