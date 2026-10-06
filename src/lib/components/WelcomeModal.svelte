<script lang="ts">
  import { liquidGlass } from '$lib/liquid-glass';
  import { ArrowRight, Bot, FileText, Link2, MessageSquare, Sparkles } from 'lucide-svelte';
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
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in zoom-in-95 duration-200"
    role="presentation"
  >
    <div
      class="relative bg-[var(--bg-card)]/95 backdrop-blur-2xl border border-[var(--border)] rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col"
      use:liquidGlass role="dialog" aria-label={$t('welcome.title')}
      aria-modal="true"
      tabindex="-1"
    >


      <!-- Hero Header -->
      <div class="px-8 pt-8 pb-6 text-center border-b border-[var(--border)]">
        <div class="relative w-16 h-16 mx-auto mb-4 p-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center">
          <img src={logoUrl} alt="" class="w-full h-full object-contain" style="image-rendering: pixelated" />
        </div>
        <h2 class="text-2xl font-extrabold text-[var(--text-main)] mb-1.5 tracking-tight">{$t('welcome.title')}</h2>
        <p class="text-xs text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
          {$t('welcome.subtitle')}
        </p>

        <!-- Language Pill Switcher -->
        <div class="mt-4 flex items-center justify-center gap-1.5 flex-wrap">
          <span class="text-[11px] font-semibold text-[var(--text-dim)]">{$t('settings.language')}:</span>
          {#each SUPPORTED_LOCALES as code}
            {@const active = $locale === code}
            <button
              onclick={async () => {
                locale.set(code);
                await saveLanguage(code);
              }}
              class="px-2.5 py-1 text-xs rounded-xl border transition-all duration-150 cursor-pointer {active
                ? 'bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)] font-bold shadow-sm'
                : 'bg-[var(--bg-main)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
            >
              {LOCALE_LABELS[code]}
            </button>
          {/each}
        </div>
      </div>

      <!-- Feature Pillars Bento -->
      <div class="p-6 md:p-8 flex flex-col gap-3">
        <!-- Feature 1 -->
        <div class="flex items-start gap-3.5 p-3.5 rounded-2xl bg-[var(--bg-main)]/70 border border-[var(--border)]">
          <div class="w-9 h-9 rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 flex items-center justify-center shrink-0">
            <FileText size={16} />
          </div>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">{$t('welcome.feature1Title')}</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {$t('welcome.feature1Body')}
            </p>
          </div>
        </div>

        <!-- Feature 2 -->
        <div class="flex items-start gap-3.5 p-3.5 rounded-2xl bg-[var(--bg-main)]/70 border border-[var(--border)]">
          <div class="w-9 h-9 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center shrink-0">
            <Link2 size={16} />
          </div>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">{$t('welcome.feature2Title')}</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {$t('welcome.feature2Body')}
            </p>
          </div>
        </div>

        <!-- Feature 3 -->
        <div class="flex items-start gap-3.5 p-3.5 rounded-2xl bg-[var(--bg-main)]/70 border border-[var(--border)]">
          <div class="w-9 h-9 rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 flex items-center justify-center shrink-0">
            <Sparkles size={16} />
          </div>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">{$t('welcome.feature3Title')}</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {$t('welcome.feature3Body')}
            </p>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="px-8 pb-8 pt-3 flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-sidebar)]/60">
        <button
          onclick={() => handleDismiss(false)}
          class="text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text-main)] transition cursor-pointer"
        >
          {$t('welcome.skip')}
        </button>

        <div class="flex items-center gap-2">
          <button
            onclick={() => handleDismiss(false)}
            class="h-8 px-4 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-xs font-semibold rounded-md text-[var(--text-main)] transition cursor-pointer"
          >
            {$t('welcome.start')}
          </button>
          <button
            onclick={() => handleDismiss(true)}
            class="h-8 px-4 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] text-xs font-semibold rounded-md shadow-sm transition cursor-pointer flex items-center gap-1.5"
          >
            <span>{$t('welcome.tryAi')}</span>
            <MessageSquare size={14} />
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
