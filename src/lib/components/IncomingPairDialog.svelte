<script lang="ts">
  import type { PeerConfig } from '../types';
  import { networkAnswerPair } from '../api';

  let {
    request = null,
    onAnswer,
  } = $props<{
    request: { request_id: string; peer: PeerConfig } | null;
    onAnswer: () => void;
  }>();

  async function handleDecision(accept: boolean) {
    if (!request) return;
    try {
      await networkAnswerPair(request.request_id, accept);
    } catch (e) {
      console.error('Erro ao responder pareamento:', e);
    } finally {
      onAnswer();
    }
  }
</script>

{#if request}
  <div
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-fadeIn"
    role="presentation"
  >
    <div
      class="bg-[var(--bg-card)] border-2 border-[var(--accent)] rounded-xl w-full max-w-md shadow-2xl p-6 flex flex-col gap-4"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="flex items-center gap-3">
        <span class="text-2xl text-[var(--accent-light)]">🔗</span>
        <div>
          <h3 class="text-sm font-bold text-[var(--text-main)]">Solicitação de Conexão P2P</h3>
          <p class="text-xs text-[var(--text-dim)]">Um novo computador deseja sincronizar este vault</p>
        </div>
      </div>

      <div class="p-3 bg-[var(--bg-main)] border border-[var(--border)] rounded-lg flex flex-col gap-1">
        <span class="text-xs font-semibold text-[var(--text-main)]">{request.peer.name}</span>
        <span class="text-[11px] font-mono text-[var(--text-dim)] truncate">ID: {request.peer.endpoint_id}</span>
      </div>

      <p class="text-xs text-[var(--text-muted)] leading-relaxed">
        Ao aceitar, as notas deste vault serão sincronizadas diretamente entre os dois computadores via QUIC com criptografia ponta a ponta.
      </p>

      <div class="flex justify-end gap-2.5 pt-2">
        <button
          onclick={() => handleDecision(false)}
          class="px-4 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg border border-red-900/40 transition"
        >
          Recusar
        </button>
        <button
          onclick={() => handleDecision(true)}
          class="px-4 py-2 text-xs font-semibold bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black rounded-lg transition shadow-md"
        >
          Aceitar Conexão
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: scale(0.97); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.15s ease-out;
  }
</style>
