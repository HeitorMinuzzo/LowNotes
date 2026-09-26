<script lang="ts">
  import { markWelcomeSeen } from '../api';
  import { t } from '$lib/i18n';

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
        <div class="w-14 h-14 rounded-2xl bg-[var(--bg-main)] border border-[var(--accent)]/40 flex items-center justify-center text-2xl mx-auto mb-4 shadow-lg text-[var(--accent-light)]">
          ✦
        </div>
        <h2 class="text-xl font-bold text-[var(--text-main)] mb-1.5">{$t('welcome.title')}</h2>
        <p class="text-xs text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
          {$t('welcome.subtitle')}
        </p>
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
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5 flex items-center gap-1.5">
              <span>{$t('welcome.feature3Title')}</span>
              <span class="px-1.5 py-0.2 text-[9px] font-mono rounded bg-[var(--accent)] text-black font-bold">{$t('welcome.new')}</span>
            </h4>
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
            class="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black text-xs font-semibold rounded-xl shadow-lg transition flex items-center gap-1.5"
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
