<script lang="ts">
  import "../app.css";
  import "../lib/apple-system.css";
  import "../lib/liquid-glass.css";
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { installAppZoom } from "$lib/app-zoom";
  import { installLiquidGlass } from "$lib/liquid-glass";

  let { children } = $props();

  onMount(() => {
    const stopMaterial = installLiquidGlass(document.documentElement);
    let stopZoom: (() => void) | undefined;
    if (isTauri()) {
      stopZoom = installAppZoom(window, (factor) =>
        getCurrentWebview().setZoom(factor),
      );
    }
    return () => {
      stopMaterial();
      stopZoom?.();
    };
  });
</script>

{@render children()}
