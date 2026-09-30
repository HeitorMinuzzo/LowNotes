<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { relaunch } from '@tauri-apps/plugin-process';
  import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
  import { t } from '$lib/i18n';
  import { dismissibleModal } from '$lib/modal-dismiss';

  let {
    isOpen = $bindable(false),
    update = null,
    autoCheck = $bindable(true),
    onSkip,
    onAutoCheckChange,
  } = $props<{
    isOpen: boolean;
    update: Update | null;
    autoCheck?: boolean;
    onSkip?: (version: string) => void;
    onAutoCheckChange?: (value: boolean) => void;
  }>();

  let phase = $state<'idle' | 'downloading' | 'installing' | 'error'>('idle');
  let percent = $state(0);
  let errorMessage = $state('');

  const releaseUrl = $derived(
    update ? `https://github.com/LowBloat/LowNotes/releases/tag/v${update.version}` : ''
  );

  async function handleOpenRelease() {
    if (!releaseUrl) return;
    try {
      await openUrl(releaseUrl);
    } catch (e) {
      console.error('Failed to open release URL:', e);
    }
  }

  function handleSkip() {
    if (update && onSkip) {
      onSkip(update.version);
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

  async function handleInstallNow() {
    if (!update || phase === 'downloading' || phase === 'installing') return;
    phase = 'downloading';
    percent = 0;
    errorMessage = '';
    let received = 0;
    const total = update.contentLength ?? 0;
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Progress') {
          received += event.data.chunkLength;
          if (total > 0) {
            percent = Math.min(99, Math.round((received / total) * 100));
          }
        } else if (event.event === 'Finished') {
          phase = 'installing';
        }
      });
      phase = 'installing';
      await relaunch();
    } catch (e) {
      console.error('Failed to install update:', e);
      phase = 'error';
      errorMessage = typeof e === 'string' ? e : (e as Error)?.message || String(e);
    }
  }
</script>

{#if isOpen && update}
  <div
    use:dismissibleModal={() => { if (phase !== 'downloading' && phase !== 'installing') isOpen = false; }}
    class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-fadeIn"
    role="presentation"
  >
    <div
      class="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="px-6 pt-6 pb-4 border-b border-[var(--border)]">
        <h2 class="text-base font-bold text-[var(--text-main)] mb-1">{$t('update.title')}</h2>
        <p class="text-xs text-[var(--text-muted)]">{$t('update.body', { version: update.version })}</p>
      </div>

      <div class="px-6 py-4 max-h-64 overflow-y-auto bg-[var(--bg-main)]">
        <div class="text-[11px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{update.body}</div>
      </div>

      {#if phase === 'downloading' || phase === 'installing' || phase === 'error'}
        <div class="px-6 py-3 border-t border-[var(--border)] flex flex-col gap-2">
          {#if phase === 'error'}
            <p class="text-[11px] text-red-300 leading-relaxed">
              {$t('update.installFailed')} {errorMessage}
            </p>
          {:else if phase === 'downloading'}
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1.5 rounded bg-[var(--bg-hover)] overflow-hidden">
                <div class="h-full bg-[var(--accent)] transition-all" style="width: {percent}%"></div>
              </div>
              <span class="text-[10px] text-[var(--text-dim)] font-mono w-24 text-right">
                {$t('update.downloading', { percent })}
              </span>
            </div>
          {:else}
            <p class="text-[11px] text-[var(--accent-light)] animate-pulse">{$t('update.installing')}</p>
          {/if}
        </div>
      {/if}

      <div class="px-6 py-4 border-t border-[var(--border)] bg-[var(--bg-sidebar)] flex flex-col gap-3">
        <label class="flex items-center gap-2 text-[11px] text-[var(--text-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoCheck}
            onchange={handleAutoCheckChange}
            class="accent-[var(--accent)] w-3.5 h-3.5"
          />
          {$t('update.autoCheck')}
        </label>

        <div class="flex items-center justify-between gap-2">
          <button
            onclick={handleSkip}
            disabled={phase === 'downloading' || phase === 'installing'}
            class="text-[11px] text-[var(--text-dim)] hover:text-[var(--text-main)] transition disabled:opacity-40"
          >
            {$t('update.skip')}
          </button>

          <div class="flex items-center gap-2">
            <button
              onclick={() => (isOpen = false)}
              disabled={phase === 'downloading' || phase === 'installing'}
              class="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border)] rounded-lg transition disabled:opacity-40"
            >
              {$t('update.later')}
            </button>
            <button
              onclick={handleOpenRelease}
              class="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border)] rounded-lg transition"
            >
              {$t('update.openRelease')}
            </button>
            <button
              onclick={handleInstallNow}
              disabled={phase === 'downloading' || phase === 'installing'}
              class="px-4 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-black text-xs font-semibold rounded-lg shadow-md transition"
            >
              {$t('update.installNow')}
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
