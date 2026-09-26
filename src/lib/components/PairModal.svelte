<script lang="ts">
  import type { PeerConfig } from '../types';
  import { networkRequestPair, networkRemovePeer, networkGetPairInfo } from '../api';

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
      console.error('Falha ao obter código de pareamento:', e);
      loadError = typeof e === 'string' ? e : e?.message || 'Falha ao obter código P2P.';
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
    statusMessage = { type: 'info', text: 'Conectando ao dispositivo remoto via P2P...' };

    try {
      await networkRequestPair(inputCode.trim());
      statusMessage = {
        type: 'info',
        text: 'Solicitação enviada! Aprove a conexão na tela do outro computador para concluir.',
      };
      inputCode = '';
      onPeersChange?.();
    } catch (err: any) {
      statusMessage = {
        type: 'error',
        text: typeof err === 'string' ? err : err.message || 'Falha ao solicitar pareamento.',
      };
    } finally {
      isConnecting = false;
    }
  }

  async function handleRemove(peerId: string) {
    if (confirm('Deseja realmente remover este dispositivo pareado?')) {
      try {
        await networkRemovePeer(peerId);
        onPeersChange?.();
      } catch (e) {
        console.error('Erro ao remover peer:', e);
      }
    }
  }
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-fadeIn"
    role="presentation"
  >
    <!-- Modal Dialog -->
    <div
      class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-sidebar)]">
        <div>
          <h2 class="text-base font-semibold text-[var(--text-main)]">Sincronização P2P & Dispositivos</h2>
          <p class="text-xs text-[var(--text-dim)]">Vault atual: <span class="text-[var(--text-muted)] font-medium">{vaultName}</span></p>
        </div>
        <button
          onclick={() => (isOpen = false)}
          class="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-dim)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition"
        >
          ✕
        </button>
      </div>

      <!-- Tabs Navigation -->
      <div class="flex border-b border-[var(--border)] bg-[var(--bg-sidebar)] px-6">
        <button
          onclick={() => { activeTab = 'share'; statusMessage = null; }}
          class="py-2.5 px-3 text-xs font-medium border-b-2 transition {activeTab === 'share' ? 'border-[var(--accent)] text-[var(--accent-light)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          Compartilhar Código
        </button>
        <button
          onclick={() => { activeTab = 'join'; statusMessage = null; }}
          class="py-2.5 px-3 text-xs font-medium border-b-2 transition {activeTab === 'join' ? 'border-[var(--accent)] text-[var(--accent-light)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          Conectar Dispositivo
        </button>
        <button
          onclick={() => { activeTab = 'devices'; statusMessage = null; }}
          class="py-2.5 px-3 text-xs font-medium border-b-2 transition {activeTab === 'devices' ? 'border-[var(--accent)] text-[var(--accent-light)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        >
          Dispositivos ({peers.length})
        </button>
      </div>

      <!-- Tab Content -->
      <div class="p-6 flex-1 overflow-y-auto">
        {#if activeTab === 'share'}
          <div class="flex flex-col gap-4">
            <p class="text-xs text-[var(--text-muted)] leading-relaxed">
              Cole este código seguro no outro computador para conectá-los diretamente ponto-a-ponto (P2P criptografado com QUIC). Sem servidor intermediário e sem intermediários lendo seus dados.
            </p>

            <div class="flex flex-col gap-1.5">
              <label for="p2p-code-display" class="text-xs font-medium text-[var(--text-dim)]">Seu código de convite:</label>
              <div class="relative">
                <textarea
                  id="p2p-code-display"
                  readonly
                  value={pairCode || 'Gerando código P2P seguro...'}
                  rows="3"
                  class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono text-[var(--text-main)] resize-none select-all focus:outline-none focus:border-[var(--accent)]"
                ></textarea>
              </div>
            </div>

            {#if loadError}
              <div class="p-3 rounded-lg text-xs leading-relaxed bg-red-950/40 border border-red-800/60 text-red-300 flex items-center justify-between">
                <span>{loadError}</span>
                <button
                  onclick={fetchPairInfo}
                  class="px-2.5 py-1 bg-red-900/60 hover:bg-red-800/80 rounded text-xs font-medium text-white transition"
                >
                  Tentar novamente
                </button>
              </div>
            {/if}

            <div class="flex justify-between items-center pt-2">
              <span class="text-[11px] text-[var(--text-dim)] font-mono truncate max-w-[280px]">
                ID: {endpointId ? (endpointId.length > 16 ? endpointId.slice(0, 16) + '...' : endpointId) : '...'}
              </span>
              <button
                onclick={copyCode}
                disabled={!pairCode}
                class="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-semibold rounded-lg transition shadow-md flex items-center gap-1.5"
              >
                {copied ? '✓ Código Copiado!' : 'Copiar Código'}
              </button>
            </div>
          </div>
        {:else if activeTab === 'join'}
          <div class="flex flex-col gap-4">
            <p class="text-xs text-[var(--text-muted)] leading-relaxed">
              Insira o código de convite gerado pelo outro computador para iniciar o pareamento.
            </p>

            <div class="flex flex-col gap-1.5">
              <label for="p2p-code-input" class="text-xs font-medium text-[var(--text-dim)]">Código do outro dispositivo:</label>
              <textarea
                id="p2p-code-input"
                bind:value={inputCode}
                placeholder="Cole o código LOWNOTES1_... aqui"
                rows="3"
                class="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono text-[var(--text-main)] resize-none focus:outline-none focus:border-[var(--accent)]"
              ></textarea>
            </div>

            {#if statusMessage}
              <div
                class="p-3 rounded-lg text-xs leading-relaxed {statusMessage.type === 'error' ? 'bg-red-950/40 border border-red-800/60 text-red-300' : statusMessage.type === 'success' ? 'bg-emerald-950/40 border border-emerald-800/60 text-emerald-300' : 'bg-amber-950/40 border border-amber-800/60 text-amber-300'}"
              >
                {statusMessage.text}
              </div>
            {/if}

            <div class="flex justify-end pt-2">
              <button
                onclick={handleRequestPair}
                disabled={isConnecting || !inputCode.trim()}
                class="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-50 text-black text-xs font-semibold rounded-lg transition shadow-md"
              >
                {isConnecting ? 'Conectando...' : 'Solicitar Pareamento'}
              </button>
            </div>
          </div>
        {:else if activeTab === 'devices'}
          <div class="flex flex-col gap-3">
            {#if peers.length === 0}
              <div class="text-center py-8">
                <p class="text-xs text-[var(--text-dim)]">Nenhum dispositivo pareado neste vault ainda.</p>
                <button
                  onclick={() => (activeTab = 'share')}
                  class="mt-2 text-xs text-[var(--accent-light)] hover:underline"
                >
                  Compartilhe um código para começar
                </button>
              </div>
            {:else}
              <div class="flex flex-col gap-2">
                {#each peers as peer}
                  <div class="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border)]">
                    <div class="flex flex-col">
                      <span class="text-xs font-medium text-[var(--text-main)]">{peer.name}</span>
                      <span class="text-[11px] font-mono text-[var(--text-dim)]">ID: {peer.endpoint_id.slice(0, 20)}...</span>
                    </div>
                    <button
                      onclick={() => handleRemove(peer.endpoint_id)}
                      class="px-2.5 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded border border-transparent hover:border-red-900/50 transition"
                    >
                      Remover
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

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.15s ease-out;
  }
</style>
