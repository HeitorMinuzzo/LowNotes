<script lang="ts">
  import type { PeerConfig } from '../types';
  import { networkAnswerPair } from '../api';
  import { t } from '$lib/i18n';
  import { dismissibleModal } from '$lib/modal-dismiss';
  import { Link, Check, X, ShieldAlert, Laptop } from 'lucide-svelte';
  import BorderBeam from './ui/BorderBeam.svelte';

  let {
    request = null,
    onAnswer,
  } = $props<{
    request: { request_id: string; peer: PeerConfig } | null;
    onAnswer: () => void;
  }>();

  let answering = false;
  async function handleDecision(accept: boolean) {
    if (!request || answering) return;
    answering = true;
    try {
      await networkAnswerPair(request.request_id, accept);
    } catch (e) {
      console.error('Failed to answer pairing request:', e);
    } finally {
      answering = false;
      onAnswer();
    }
  }
</script>

{#if request}
  <div
    use:dismissibleModal={() => void handleDecision(false)}
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in zoom-in-95 duration-200"
    role="presentation"
  >
    <div
      class="relative bg-[var(--bg-card)]/95 backdrop-blur-xl border border-[var(--accent)] rounded-3xl w-full max-w-md shadow-2xl p-6 flex flex-col gap-4 overflow-hidden"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <BorderBeam size={160} duration={8} borderWidth={1.5} colorFrom="var(--accent)" colorTo="var(--accent-light)" />

      <div class="flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-2xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 flex items-center justify-center text-lg shadow-sm">
          <Link size={18} />
        </div>
        <div>
          <h3 class="text-sm font-bold text-[var(--text-main)]">{$t('incoming.title')}</h3>
          <p class="text-xs text-[var(--text-dim)]">{$t('incoming.subtitle')}</p>
        </div>
      </div>

      <div class="p-3.5 bg-[var(--bg-main)]/80 border border-[var(--border)] rounded-2xl flex items-center gap-3">
        <Laptop size={18} class="text-[var(--accent)] shrink-0" />
        <div class="flex flex-col min-w-0">
          <span class="text-xs font-bold text-[var(--text-main)] truncate">{request.peer.name}</span>
          <span class="text-[10px] font-mono text-[var(--text-dim)] truncate">ID: {request.peer.endpoint_id}</span>
        </div>
      </div>

      <p class="text-xs text-[var(--text-muted)] leading-relaxed">
        {$t('incoming.description')}
      </p>

      <div class="flex justify-end gap-2.5 pt-2">
        <button
          onclick={() => handleDecision(false)}
          class="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-xl border border-[var(--danger)]/30 transition cursor-pointer"
        >
          <X size={13} />
          <span>{$t('incoming.reject')}</span>
        </button>
        <button
          onclick={() => handleDecision(true)}
          class="flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] rounded-xl transition shadow-lg cursor-pointer"
        >
          <Check size={14} />
          <span>{$t('incoming.accept')}</span>
        </button>
      </div>
    </div>
  </div>
{/if}
