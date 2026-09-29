<script lang="ts" generics="T extends string">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';

  let {
    options,
    value,
    onchange,
    class: className = '',
  } = $props<{
    options: { id: T; label: string; icon?: Snippet }[];
    value: T;
    onchange: (val: T) => void;
    class?: string;
  }>();
</script>

<div
  class={cn(
    "relative flex items-center p-1 rounded-xl bg-[var(--bg-main)] border border-[var(--border)] shadow-inner text-xs font-medium select-none",
    className
  )}
>
  {#each options as opt}
    {@const active = opt.id === value}
    <button
      type="button"
      onclick={() => onchange(opt.id)}
      class={cn(
        "relative z-10 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 cursor-pointer font-medium",
        active
          ? "text-[var(--text-main)] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.3)] bg-[var(--bg-card)] border border-[var(--border)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]/50"
      )}
    >
      {#if opt.icon}
        {@render opt.icon()}
      {/if}
      <span>{opt.label}</span>
    </button>
  {/each}
</div>
