<script lang="ts">
  import { cn } from '$lib/utils';

  let {
    class: className = '',
    color = 'var(--accent)',
    size = '400px',
    opacity = 0.15,
  } = $props<{
    class?: string;
    color?: string;
    size?: string;
    opacity?: number;
  }>();
</script>

<div
  style:--glow-color={color}
  style:--glow-size={size}
  style:--glow-opacity={opacity}
  class={cn(
    "pointer-events-none absolute -z-10 rounded-full blur-[100px] transform-gpu",
    "w-[var(--glow-size)] h-[var(--glow-size)] bg-[var(--glow-color)] opacity-[var(--glow-opacity)]",
    className
  )}
></div>
