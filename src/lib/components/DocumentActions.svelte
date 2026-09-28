<script lang="ts">
  import { t, trError } from '$lib/i18n';
  import type { ExportFormat } from '../document-export';
  let { content, path } = $props<{ content: string; path: string }>();
  let busy = $state(false);
  let error = $state('');
  let saved = $state(false);

  async function handleExport(format: ExportFormat) {
    if (busy) return;
    busy = true; error = ''; saved = false;
    const snapshot = { content, path };
    try {
      const { exportDocument } = await import('../document-export');
      saved = await exportDocument(snapshot.content, snapshot.path, format);
    } catch (err) {
      error = trError(err instanceof Error ? err.message : String(err));
    } finally { busy = false; }
  }
</script>

<div class="relative inline-flex items-center gap-1">
  {#each ['docx', 'pdf'] as format}
    <button onclick={() => handleExport(format as ExportFormat)} disabled={busy || !content.trim()}
      title={$t(format === 'docx' ? 'export.word' : 'export.pdf')}
      class="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-muted)] disabled:opacity-40">
      {format === 'docx' ? 'Word' : 'PDF'}
    </button>
  {/each}
  {#if busy}<span role="status" class="text-[10px] text-[var(--text-dim)]">{$t('export.exporting')}</span>{/if}
  {#if saved}<span role="status" title={$t('export.saved')} class="text-[var(--success)]">✓</span>{/if}
  {#if error}<p role="alert" class="absolute right-0 top-full z-50 mt-1 rounded border border-[var(--border)] bg-[var(--bg-card)] p-2 text-xs text-red-500 w-60 shadow">{error}</p>{/if}
</div>
