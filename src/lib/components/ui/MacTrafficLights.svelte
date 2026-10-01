<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { X, Minus, Plus } from 'lucide-svelte';

  let { onClose } = $props<{
    onClose?: () => void;
  }>();

  let hovered = $state(false);

  async function handleClose(e: MouseEvent) {
    e.stopPropagation();
    if (onClose) {
      onClose();
    } else {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.close();
      } catch (err) {
        console.warn('Window close not available:', err);
      }
    }
  }

  async function handleMinimize(e: MouseEvent) {
    e.stopPropagation();
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (err) {
      console.warn('Window minimize not available:', err);
    }
  }

  async function handleMaximize(e: MouseEvent) {
    e.stopPropagation();
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
    } catch (err) {
      console.warn('Window maximize not available:', err);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex items-center gap-2 group/lights cursor-pointer select-none px-1 py-1"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  role="group"
  aria-label="Controles de Janela macOS"
>
  <!-- Red: Close -->
  <button
    onclick={handleClose}
    class="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] flex items-center justify-center transition-all duration-150 active:scale-90 shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:brightness-105"
    title="Fechar"
    aria-label="Fechar"
  >
    <X
      size={8}
      strokeWidth={2.5}
      class="text-[#4c0002] transition-opacity duration-100 {hovered ? 'opacity-100' : 'opacity-0'}"
    />
  </button>

  <!-- Yellow: Minimize -->
  <button
    onclick={handleMinimize}
    class="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] flex items-center justify-center transition-all duration-150 active:scale-90 shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:brightness-105"
    title="Minimizar"
    aria-label="Minimizar"
  >
    <Minus
      size={8}
      strokeWidth={2.5}
      class="text-[#5c3e00] transition-opacity duration-100 {hovered ? 'opacity-100' : 'opacity-0'}"
    />
  </button>

  <!-- Green: Maximize -->
  <button
    onclick={handleMaximize}
    class="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] flex items-center justify-center transition-all duration-150 active:scale-90 shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:brightness-105"
    title="Maximizar"
    aria-label="Maximizar"
  >
    <Plus
      size={8}
      strokeWidth={2.5}
      class="text-[#004d11] transition-opacity duration-100 {hovered ? 'opacity-100' : 'opacity-0'}"
    />
  </button>
</div>
