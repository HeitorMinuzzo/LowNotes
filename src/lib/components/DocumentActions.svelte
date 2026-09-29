<script lang="ts">
  import { t, trError } from '$lib/i18n';
  import type { ExportFormat } from '../document-export';
  import { FileDown, FileText, Check, Loader2 } from 'lucide-svelte';

  let { content, path } = $props<{ content: string; path: string }>();
  let busy = $state(false);
  let error = $state('');
  let saved = $state(false);

  async function handleExport(format: ExportFormat) {
    if (busy) return;
    busy = true;
    error = '';
    saved = false;
    const snapshot = { content, path };
    try {
      const { exportDocument } = await import('../document-export');
      saved = await exportDocument(snapshot.content, snapshot.path, format);
      setTimeout(() => { saved = false; }, 3000);
    } catch (err) {
      error = trError(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }
</script>

<div class="relative inline-flex items-center gap-1.5">
  <div class="h-7 flex items-center p-0.5 rounded-md bg-[var(--bg-card)]/70 border border-[var(--border)] shadow-sm">
    <button
      onclick={() => handleExport('docx')}
      disabled={busy || !content.trim()}
      title={$t('export.word')}
      class="h-6 flex items-center gap-1 px-2 rounded hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40 transition-all cursor-pointer"
    >
      <FileText size={12} class="text-blue-400" />
      <span>Word</span>
    </button>

    <div class="w-[1px] h-3 bg-[var(--border)] my-auto mx-0.5"></div>

    <button
      onclick={() => handleExport('pdf')}
      disabled={busy || !content.trim()}
      title={$t('export.pdf')}
      class="h-6 flex items-center gap-1 px-2 rounded hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40 transition-all cursor-pointer"
    >
      <FileDown size={12} class="text-red-400" />
      <span>PDF</span>
    </button>
  </div>

  {#if busy}
    <span role="status" class="flex items-center gap-1 text-[11px] text-[var(--accent)] font-medium">
      <Loader2 size={12} class="animate-spin" />
      <span>{$t('export.exporting')}</span>
    </span>
  {/if}

  {#if saved}
    <span role="status" title={$t('export.saved')} class="flex items-center gap-1 text-[11px] text-[var(--success)] font-medium">
      <Check size={13} />
      <span>Exportado</span>
    </span>
  {/if}

  {#if error}
    <p role="alert" class="absolute right-0 top-full z-50 mt-1 rounded-xl border border-[var(--danger)]/50 bg-[var(--bg-card)] p-2.5 text-xs text-[var(--danger)] w-64 shadow-xl backdrop-blur-md">
      {error}
    </p>
  {/if}
</div>
