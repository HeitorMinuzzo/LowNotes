<script lang="ts">
  import { liquidGlass } from '$lib/liquid-glass';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { relaunch } from '@tauri-apps/plugin-process';
  import type { DownloadEvent } from '@tauri-apps/plugin-updater';
  import type { UpdatePolicy } from '$lib/types';
  import { canInstallUpdate, updateInstructionKey, type AvailableUpdate } from '$lib/updates';
  import { t } from '$lib/i18n';
  import { dismissibleModal } from '$lib/modal-dismiss';
  import { Loader2, AlertCircle } from 'lucide-svelte';

  let {
    isOpen = $bindable(false),
    update = null,
    policy = null,
    autoCheck = $bindable(true),
    onSkip,
    onAutoCheckChange,
  } = $props<{
    isOpen: boolean;
    update: AvailableUpdate | null;
    policy?: UpdatePolicy | null;
    autoCheck?: boolean;
    onSkip?: (version: string) => void;
    onAutoCheckChange?: (value: boolean) => void;
  }>();

  let phase = $state<'idle' | 'downloading' | 'installing' | 'error'>('idle');
  let percent = $state(0);
  let errorMessage = $state('');
  const canInstall = $derived(canInstallUpdate(policy, update));

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

  async function handleDownloadPackage() {
    if (!update?.download_url) return;
    try {
      await openUrl(update.download_url);
    } catch (e) {
      console.error('Failed to open package download:', e);
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
    if (!canInstall || !update?.installer || phase === 'downloading' || phase === 'installing') return;
    const installer = update.installer;
    phase = 'downloading';
    percent = 0;
    errorMessage = '';
    let received = 0;
    const total = installer.contentLength ?? 0;
    try {
      await installer.downloadAndInstall((event: DownloadEvent) => {
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
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in zoom-in-95 duration-200"
    role="presentation"
  >
    <div
      class="relative bg-[var(--bg-card)]/95 backdrop-blur-2xl border border-[var(--border)] rounded-2xl w-full max-w-[560px] shadow-2xl overflow-hidden flex flex-col"
      use:liquidGlass role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      tabindex="-1"
    >


      <!-- Modal Header -->
      <div class="px-6 pt-5 pb-4 border-b border-[var(--border)] bg-[var(--bg-sidebar)]/60">
        <div>
          <h2 id="update-dialog-title" class="text-sm font-bold text-[var(--text-main)] tracking-tight">{$t('update.title')}</h2>
          <p class="text-xs text-[var(--text-muted)] mt-0.5">{$t('update.body', { version: update.version })}</p>
        </div>
      </div>

      <!-- Release Notes Body -->
      <div class="px-6 py-4 max-h-60 overflow-y-auto bg-[var(--bg-main)]/60">
        <div class="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{update.body}</div>
      </div>

      {#if !canInstall}
        <div class="px-6 py-4 border-t border-[var(--border)]">
          <p class="text-xs text-[var(--text-main)] leading-relaxed">{$t(updateInstructionKey(policy))}</p>
        </div>
      {/if}

      {#if phase === 'downloading' || phase === 'installing' || phase === 'error'}
        <div class="px-6 py-3 border-t border-[var(--border)] flex flex-col gap-2 bg-[var(--bg-card)]">
          {#if phase === 'error'}
            <div class="flex items-center gap-2 text-xs text-[var(--danger)]">
              <AlertCircle size={14} class="shrink-0" />
              <span>{$t('update.installFailed')} {errorMessage}</span>
            </div>
          {:else if phase === 'downloading'}
            <div class="flex items-center gap-3">
              <div class="flex-1 h-2 rounded-full bg-[var(--bg-hover)] overflow-hidden p-0.5">
                <div class="h-full bg-[var(--accent)] rounded-full transition-all duration-200" style="width: {percent}%"></div>
              </div>
              <span class="text-xs text-[var(--accent)] font-mono font-bold w-14 text-right">
                {percent}%
              </span>
            </div>
          {:else}
            <div class="flex items-center gap-2 text-xs text-[var(--accent)] font-semibold animate-pulse">
              <Loader2 size={13} class="animate-spin" />
              <span>{$t('update.installing')}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Footer Actions -->
      <div class="px-6 py-4 border-t border-[var(--border)] bg-[var(--bg-sidebar)]/80 flex flex-col gap-3">
        <label class="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
          <input
            type="checkbox" role="switch"
            checked={autoCheck}
            onchange={handleAutoCheckChange}
            class="accent-[var(--accent)] w-3.5 h-3.5 rounded"
          />
          <span>{$t('update.autoCheck')}</span>
        </label>

        <div class="flex items-center justify-between gap-2 flex-wrap">
          <button
            onclick={handleSkip}
            disabled={phase === 'downloading' || phase === 'installing'}
            class="text-xs text-[var(--text-dim)] hover:text-[var(--text-main)] transition disabled:opacity-40 cursor-pointer whitespace-nowrap"
          >
            {$t('update.skip')}
          </button>

          <div class="flex items-center gap-2 flex-wrap">
            <button
              onclick={() => (isOpen = false)}
              disabled={phase === 'downloading' || phase === 'installing'}
              class="h-8 px-3 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border)] hover:bg-[var(--bg-hover)] rounded-md transition disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              {$t('update.later')}
            </button>
            <button
              onclick={handleOpenRelease}
              class="h-8 px-3 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border)] hover:bg-[var(--bg-hover)] rounded-md transition cursor-pointer whitespace-nowrap"
            >
              {$t('update.openRelease')}
            </button>
            {#if canInstall}
              <button
                onclick={handleInstallNow}
                disabled={phase === 'downloading' || phase === 'installing'}
                class="h-8 px-3.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-[var(--accent-contrast)] text-xs font-semibold rounded-md shadow-sm transition cursor-pointer whitespace-nowrap"
              >
                {$t('update.installNow')}
              </button>
            {:else if update.download_url}
              <button
                onclick={handleDownloadPackage}
                class="h-8 px-3.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] text-xs font-semibold rounded-md shadow-sm transition cursor-pointer whitespace-nowrap"
              >
                {$t('update.downloadMatching')}
              </button>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
