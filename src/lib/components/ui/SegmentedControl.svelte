<script lang="ts" generics="T extends string">
  import type { Snippet } from 'svelte';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import { liquidGlass } from '$lib/liquid-glass';

  let {
    options,
    value,
    onchange,
    class: className = '',
    label,
    vertical = false,
  } = $props<{
    options: { id: T; label: string; icon?: Snippet; disabled?: boolean }[];
    value: T;
    onchange: (val: T) => void;
    class?: string;
    label: string;
    vertical?: boolean;
  }>();
  const position = new Spring(0, { stiffness: .075, damping: .8, precision: .001 });
  let initialized = false;
  $effect(() => {
    const index = Math.max(0, options.findIndex((option: { id: T }) => option.id === value));
    void position.set(index, { instant: !initialized || prefersReducedMotion.current });
    initialized = true;
  });
  function navigate(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const available = options.map((option: { disabled?: boolean }, i: number) => !option.disabled ? i : -1).filter((i: number) => i >= 0);
    const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1) : available[(available.indexOf(index) + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length];
    if (next === undefined) return;
    onchange(options[next].id);
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
</script>

<div class="apple-segmented {className}" class:vertical role="group" aria-label={label} style:--segments={options.length}>
  <span use:liquidGlass={{ shape: 'capsule' }} class="apple-segment-material" aria-hidden="true"></span>
  <span class="apple-segment-indicator" aria-hidden="true" style:transform="translate3d(calc({position.current} * (100% - var(--segment-overlap, 0px))), 0, 0)"></span>
  {#each options as opt, index (opt.id)}
    {@const active = opt.id === value}
    <button
      type="button"
      onclick={() => onchange(opt.id)}
      class:active
      aria-pressed={active}
      disabled={opt.disabled}
      onkeydown={(event) => navigate(event, index)}
      title={opt.label}
    >
      {#if opt.icon}
        {@render opt.icon()}
      {/if}
      <span>{opt.label}</span>
    </button>
  {/each}
  <span class="apple-segment-rim" aria-hidden="true"></span>
</div>

<style>
  .apple-segmented { display: grid; grid-template-columns: repeat(var(--segments), minmax(0, 1fr)); position: relative; isolation: isolate; padding: 3px; border-radius: 11px; background: var(--control-track); border: 0; font-size: .75rem; user-select: none; -webkit-user-select: none; }
  .apple-segment-material { position: absolute; inset: 0; z-index: 0; border-radius: inherit; overflow: clip; pointer-events: none; }
  .apple-segment-indicator { position: absolute; z-index: 1; inset: 3px auto 3px 3px; width: calc((100% - 6px) / var(--segments)); border-radius: 8px; background: var(--control-selected); box-shadow: var(--control-shadow); border: 0; pointer-events: none; }
  .apple-segment-rim { position: absolute; inset: 0; z-index: 3; border-radius: inherit; pointer-events: none; }
  button { position: relative; z-index: 2; min-width: 0; min-height: 32px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px 10px; color: var(--text-muted); font-weight: 500; border-radius: 8px; background: transparent; cursor: pointer; transition: color 120ms ease; }
  button.active { color: var(--text-main); font-weight: 600; }
  button:not(:disabled):hover { color: var(--text-main); }
  button:active { transform: none; }
  button:focus-visible { outline-offset: -3px; }
  button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vertical button { flex-direction: column; gap: 4px; min-height: 44px; padding-inline: 2px; }
  .vertical button span { font-size: .625rem; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
