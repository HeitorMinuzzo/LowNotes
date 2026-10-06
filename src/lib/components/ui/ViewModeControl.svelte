<script lang="ts">
  import { FilePenLine, Columns2, Eye } from 'lucide-svelte';
  import type { ViewMode } from '$lib/types';
  import { t } from '$lib/i18n';
  import SegmentedControl from './SegmentedControl.svelte';

  let { value, onchange } = $props<{
    value: ViewMode;
    onchange: (mode: ViewMode) => void;
  }>();
</script>

{#snippet editIcon()}<FilePenLine size={14} />{/snippet}
{#snippet splitIcon()}<Columns2 size={14} />{/snippet}
{#snippet previewIcon()}<Eye size={14} />{/snippet}
<SegmentedControl {value} {onchange} label={$t('editor.viewMode')} vertical options={[
  { id: 'edit', label: $t('editor.modeEdit'), icon: editIcon },
  { id: 'split', label: $t('editor.modeSplit'), icon: splitIcon },
  { id: 'preview', label: $t('editor.modePreview'), icon: previewIcon },
]} />
