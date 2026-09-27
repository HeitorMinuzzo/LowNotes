<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { t } from '$lib/i18n';
  import type { UpdateInfo } from '$lib/types';

  let {
    isOpen = $bindable(false),
    info = null,
    autoCheck = $bindable(true),
    onSkip,
    onAutoCheckChange,
  } = $props<{
    isOpen: boolean;
    info: UpdateInfo | null;
    autoCheck?: boolean;
    onSkip?: (version: string) => void;
    onAutoCheckChange?: (value: boolean) => void;
  }>();

  async function handleOpenRelease() {
    if (!info?.url) return;
    try {
      await openUrl(info.url);
    } catch (e) {
      console.error('Failed to open release URL:', e);
    }
  }

  function handleSkip() {
    if (info && onSkip) {
      onSkip(info.latest);
    }
    isOpen = false;
  }

  function handleAutoCheckChange(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    autoCheck = checked;
    if (onAutoCheckChange) {
      onAutoCheckChange(checked);
    }
  }
</script>

{#if isOpen && info}
  <div
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-fadeIn"
    role="presentation"
  >
    <div
      class="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="px-6 pt-6 pb-4 border-b border-[var(--border)]">
        <h2 class="text-lg font-bold text-[var(--text-main)] mb-1">{$t('update.title')}</h2>
        <p class="text-xs text-[var(--text-muted)] leading-relaxed">
          {$t('update.body', { version: info.latest })}
        </p>
      </div>

      {#if info.notes}
        <div
          class="px-6 py-3 max-h-48 overflow-y-auto text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap border-b border-[var(--border)] bg-[var(--bg-main)]"
        >
          {info.notes}
        </div>
      {/if}

      <div class="px-6 py-4 flex flex-col gap-3">
        <label class="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={autoCheck}
            onchange={handleAutoCheckChange}
            class="accent-[var(--accent)]"
          />
          {$t('update.autoCheck')}
        </label>

        <div class="flex items-center justify-between gap-2">
          <button
            onclick={handleSkip}
            class="px-3 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text-main)] transition"
          >
            {$t('update.skip')}
          </button>
          <div class="flex items-center gap-2">
            <button
              onclick={() => (isOpen = false)}
              class="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
            >
              {$t('update.later')}
            </button>
            <button
              onclick={handleOpenRelease}
              class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black shadow-md transition"
            >
              {$t('update.openRelease')}
            </button>
          </div>
        </div>
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
