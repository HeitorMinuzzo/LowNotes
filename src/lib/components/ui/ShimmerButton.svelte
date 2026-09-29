<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';

  let {
    class: className = '',
    shimmerColor = 'rgba(255, 255, 255, 0.25)',
    shimmerSize = '0.08em',
    shimmerDuration = '2.5s',
    borderRadius = '12px',
    background = 'var(--accent)',
    onclick,
    disabled = false,
    children,
  } = $props<{
    class?: string;
    shimmerColor?: string;
    shimmerSize?: string;
    shimmerDuration?: string;
    borderRadius?: string;
    background?: string;
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    children?: Snippet;
  }>();
</script>

<button
  style:--shimmer-color={shimmerColor}
  style:--radius={borderRadius}
  style:--speed={shimmerDuration}
  style:--cut={shimmerSize}
  style:--bg={background}
  {disabled}
  {onclick}
  class={cn(
    "group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap border border-white/10 px-5 py-2.5 [background:var(--bg)] text-[var(--accent-contrast)] [border-radius:var(--radius)] transform-gpu transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-[0_4px_20px_-4px_var(--accent-glow)] font-semibold text-sm select-none",
    disabled && "opacity-50 pointer-events-none",
    className
  )}
>
  <!-- Spark container -->
  <div
    class={cn(
      "-z-30 blur-[2px]",
      "absolute inset-0 overflow-visible [container-type:size]"
    )}
  >
    <!-- Spark -->
    <div
      class="absolute inset-0 h-[100cqh] animate-[glow-spin_4s_linear_infinite] [aspect-ratio:1] [border-radius:0] [mask:none]"
    >
      <!-- Spark before -->
      <div
        class="animate-[glow-spin_4s_linear_infinite] absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_0deg,transparent_0_340deg,white_360deg)] [translate:0_0]"
      ></div>
    </div>
  </div>

  <!-- Content -->
  <span class="relative z-10 flex items-center gap-2">
    {#if children}
      {@render children()}
    {/if}
  </span>

  <!-- Backdrop / Highlight -->
  <div
    class={cn(
      "insert-0 absolute size-full",
      "rounded-[calc(var(--radius)-1px)] px-4 py-1.5 text-sm font-medium",
      "transform-gpu transition-all duration-300 ease-in-out",
      "group-hover:shadow-[inset_0_-6px_10px_rgba(255,255,255,0.2)]",
      "group-active:shadow-[inset_0_-10px_10px_rgba(255,255,255,0.3)]"
    )}
  ></div>

  <!-- Shimmer sweep -->
  <div
    class="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
  ></div>
</button>
