<script lang="ts">
  import '../app.css';
  import '../lib/apple-system.css';
  import { onMount } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { installAppZoom } from '$lib/app-zoom';

  let { children } = $props();

  onMount(() => {
    if (isTauri()) {
      return installAppZoom(window, (factor) => getCurrentWebview().setZoom(factor));
    }
  });
</script>

{@render children()}
