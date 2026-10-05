<script lang="ts">
  import { Check, FileDown, FileText, Loader2, ChevronDown } from 'lucide-svelte';
  import { t, trError } from '$lib/i18n';
  import type { ExportFormat } from '../document-export';

  let { content, path } = $props<{ content: string; path: string }>();
  let busy = $state(false);
  let error = $state('');
  let saved = $state(false);
  let menu = $state<HTMLDetailsElement>();

  async function handleExport(format: ExportFormat) {
    if (busy) return;
    if (menu) menu.open = false;
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

<svelte:window onclick={(event) => { if (menu?.open && !menu.contains(event.target as Node)) menu.open = false; }} onkeydown={(event) => { if (event.key === 'Escape' && menu?.open) { event.preventDefault(); menu.open = false; menu.querySelector('summary')?.focus(); } }} />
<div class="apple-export relative inline-flex items-center gap-1.5">
  <details bind:this={menu}>
    <summary class="apple-secondary-button" aria-label={$t('export.menu')} aria-busy={busy}><FileDown size={16} /><span>{$t('export.menu')}</span><ChevronDown size={12} /></summary>
    <div class="apple-export-menu">
    <button
      onclick={() => handleExport('docx')}
      disabled={busy || !content.trim()}
      title={$t('export.word')}
      aria-label={$t('export.word')}
      class="h-6 flex items-center gap-1 px-2 rounded hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40 transition-all cursor-pointer"
    >
      <FileText size={16} />
      <span>Word</span>
    </button>

    <button
      onclick={() => handleExport('pdf')}
      disabled={busy || !content.trim()}
      title={$t('export.pdf')}
      aria-label={$t('export.pdf')}
      class="h-6 flex items-center gap-1 px-2 rounded hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40 transition-all cursor-pointer"
    >
      <FileDown size={16} />
      <span>PDF</span>
    </button>
    </div>
  </details>

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
