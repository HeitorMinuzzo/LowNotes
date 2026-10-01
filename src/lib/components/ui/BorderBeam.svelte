<script lang="ts">
  import { cn } from '$lib/utils';

  let {
    class: className = '',
    size = 200,
    duration = 12,
    borderWidth = 1.5,
    anchor = 90,
    colorFrom = '#f7c65d',
    colorTo = '#ffe09a',
    delay = 0,
  } = $props<{
    class?: string;
    size?: number;
    duration?: number;
    borderWidth?: number;
    anchor?: number;
    colorFrom?: string;
    colorTo?: string;
    delay?: number;
  }>();
</script>

<div
  style:--size="{size}px"
  style:--duration="{duration}s"
  style:--anchor="{anchor}%"
  style:--border-width="{borderWidth}px"
  style:--color-from={colorFrom}
  style:--color-to={colorTo}
  style:--delay="-{delay}s"
  class={cn(
    "border-beam pointer-events-none absolute inset-0 rounded-[inherit] [border:calc(var(--border-width)*1px)_solid_transparent]",
    "![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]",
    "after:absolute after:aspect-square after:w-[calc(var(--size)*1px)] after:animate-[border-beam_var(--duration)_infinite_linear] after:[animation-delay:var(--delay)] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)] after:[offset-anchor:calc(var(--anchor)*1%)_50%] after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)*1px))]",
    className
  )}
></div>
