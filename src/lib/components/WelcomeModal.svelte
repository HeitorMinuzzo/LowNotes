<script lang="ts">
  import { markWelcomeSeen, saveLanguage } from '../api';
  import { t, locale, LOCALE_LABELS, SUPPORTED_LOCALES } from '$lib/i18n';
  import logoUrl from '../../../assets/brand/lownotes_logo.png';
  import { dismissibleModal } from '$lib/modal-dismiss';

  let {
    isOpen = $bindable(false),
    onOpenAiChat,
  } = $props<{
    isOpen: boolean;
    onOpenAiChat?: () => void;
  }>();

  async function handleDismiss(openAi: boolean = false) {
    isOpen = false;
    try {
      await markWelcomeSeen();
    } catch (e) {
      console.error('Failed to mark welcome as seen:', e);
    }
    if (openAi && onOpenAiChat) {
      onOpenAiChat();
    }
  }
</script>

{#if isOpen}
  <div
    use:dismissibleModal={() => void handleDismiss(false)}
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-fadeIn"
    role="presentation"
  >
    <div
      class="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Hero Header -->
      <div class="px-8 pt-8 pb-6 text-center border-b border-[var(--border)] bg-gradient-to-b from-[var(--bg-hover)] to-[var(--bg-card)]">
        <img src={logoUrl} alt="" class="w-[70px] h-[70px] object-contain mx-auto mb-4" style="image-rendering: pixelated" />
        <h2 class="text-xl font-bold text-[var(--text-main)] mb-1.5">{$t('welcome.title')}</h2>
        <p class="text-xs text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
          {$t('welcome.subtitle')}
        </p>
        <div class="mt-4 flex items-center justify-center gap-2 flex-wrap">
          <span class="text-[11px] text-[var(--text-dim)]">{$t('settings.language')}:</span>
          {#each SUPPORTED_LOCALES as code}
            <button
              onclick={async () => {
                locale.set(code);
                await saveLanguage(code);
              }}
              class="px-2.5 py-1 text-[11px] rounded-lg border transition {$locale === code
                ? 'bg-[var(--accent)]/15 border-[var(--accent)]/50 text-[var(--accent-light)] font-semibold'
                : 'bg-[var(--bg-main)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
            >
              {LOCALE_LABELS[code]}
            </button>
          {/each}
        </div>
      </div>

      <!-- Feature Pillars -->
      <div class="p-8 flex flex-col gap-4">
        <!-- Feature 1 -->
        <div class="flex items-start gap-3.5 p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border)]">
          <span class="text-xl mt-0.5">📄</span>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">{$t('welcome.feature1Title')}</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {$t('welcome.feature1Body')}
            </p>
          </div>
        </div>

        <!-- Feature 2 -->
        <div class="flex items-start gap-3.5 p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border)]">
          <span class="text-xl mt-0.5">🔗</span>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">{$t('welcome.feature2Title')}</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {$t('welcome.feature2Body')}
            </p>
          </div>
        </div>

        <!-- Feature 3 -->
        <div class="flex items-start gap-3.5 p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--accent)]/30">
          <span class="text-xl mt-0.5">🤖</span>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">{$t('welcome.feature3Title')}</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {$t('welcome.feature3Body')}
            </p>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="px-8 pb-8 pt-2 flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-sidebar)]">
        <button
          onclick={() => handleDismiss(false)}
          class="text-xs text-[var(--text-dim)] hover:text-[var(--text-main)] transition"
        >
          {$t('welcome.skip')}
        </button>

        <div class="flex gap-2">
          <button
            onclick={() => handleDismiss(false)}
            class="px-5 py-2.5 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-xs font-semibold rounded-xl text-[var(--text-main)] transition"
          >
            {$t('welcome.start')}
          </button>
          <button
            onclick={() => handleDismiss(true)}
            class="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-black text-xs font-semibold rounded-xl shadow-lg transition flex items-center gap-1.5"
          >
            <span>{$t('welcome.tryAi')}</span>
            <span>💬</span>
          </button>
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
