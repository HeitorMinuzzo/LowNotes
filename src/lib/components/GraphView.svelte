<script lang="ts">
  import { listNotes, linksGet, linksApply } from '../api';
  import type { LinkEdge, VaultItem } from '../types';
  import { t } from '$lib/i18n';

  let {
    isOpen = $bindable(false),
    onOpenNote,
  } = $props<{
    isOpen: boolean;
    onOpenNote?: (path: string) => void;
  }>();

  let notes = $state<VaultItem[]>([]);
  let links = $state<LinkEdge[]>([]);
  let selectedPath = $state<string | null>(null);
  let linkMode = $state(false);
  let linkSource = $state<string | null>(null);

  async function load() {
    try {
      const [items, edges] = await Promise.all([listNotes(), linksGet()]);
      notes = items.filter((item) => !item.is_dir);
      links = edges;
    } catch (e) {
      console.error('Failed to load graph data:', e);
    }
  }

  $effect(() => {
    if (isOpen) {
      load();
    }
  });

  $effect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') isOpen = false;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  interface LaidOutNode {
    path: string;
    title: string;
    x: number;
    y: number;
    r: number;
  }

  interface LaidOutEdge {
    source: string;
    target: string;
    origin: LinkEdge['origin'];
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  function truncate(title: string): string {
    return title.length > 18 ? `${title.slice(0, 17)}…` : title;
  }

  function computeLayout(items: VaultItem[], edges: LinkEdge[]) {
    const index = new Map<string, number>();
    items.forEach((item, i) => index.set(item.path, i));
    const n = items.length;

    const validEdges = edges.filter(
      (e) => index.has(e.source) && index.has(e.target) && e.source !== e.target
    );

    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const degree = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / Math.max(n, 1);
      xs[i] = 50 + 35 * Math.cos(angle);
      ys[i] = 50 + 35 * Math.sin(angle);
    }
    const edgeIdx = validEdges.map((e) => [index.get(e.source)!, index.get(e.target)!] as const);
    for (const [a, b] of edgeIdx) {
      degree[a]++;
      degree[b]++;
    }

    const iterations = 180;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let iter = 0; iter < iterations; iter++) {
      dx.fill(0);
      dy.fill(0);

      // Repulsion between all pairs
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const ddx = xs[i] - xs[j];
          const ddy = ys[i] - ys[j];
          const d2 = ddx * ddx + ddy * ddy + 0.01;
          const d = Math.sqrt(d2);
          const f = 300 / d2;
          const fx = (ddx / d) * f;
          const fy = (ddy / d) * f;
          dx[i] += fx;
          dy[i] += fy;
          dx[j] -= fx;
          dy[j] -= fy;
        }
      }

      // Springs along edges
      for (const [a, b] of edgeIdx) {
        const ddx = xs[b] - xs[a];
        const ddy = ys[b] - ys[a];
        const d = Math.sqrt(ddx * ddx + ddy * ddy) + 0.001;
        const f = (d - 18) * 0.08;
        const fx = (ddx / d) * f;
        const fy = (ddy / d) * f;
        dx[a] += fx;
        dy[a] += fy;
        dx[b] -= fx;
        dy[b] -= fy;
      }

      // Gravity toward center + cooling
      const maxStep = 0.2 + 6 * (1 - iter / iterations);
      for (let i = 0; i < n; i++) {
        dx[i] += (50 - xs[i]) * 0.02;
        dy[i] += (50 - ys[i]) * 0.02;
        const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
        if (len > maxStep) {
          dx[i] = (dx[i] / len) * maxStep;
          dy[i] = (dy[i] / len) * maxStep;
        }
        xs[i] += dx[i];
        ys[i] += dy[i];
      }
    }

    // Normalize into the 100x100 viewBox with padding
    if (n > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        if (xs[i] < minX) minX = xs[i];
        if (xs[i] > maxX) maxX = xs[i];
        if (ys[i] < minY) minY = ys[i];
        if (ys[i] > maxY) maxY = ys[i];
      }
      const spanX = Math.max(maxX - minX, 1e-6);
      const spanY = Math.max(maxY - minY, 1e-6);
      const scale = Math.min(84 / spanX, 84 / spanY);
      const offX = 50 - ((minX + maxX) / 2) * scale;
      const offY = 50 - ((minY + maxY) / 2) * scale;
      for (let i = 0; i < n; i++) {
        xs[i] = xs[i] * scale + offX;
        ys[i] = ys[i] * scale + offY;
      }
    }

    const laidNodes: LaidOutNode[] = items.map((item, i) => ({
      path: item.path,
      title: truncate(item.title || item.name),
      x: xs[i],
      y: ys[i],
      r: 1.2 + Math.min(Math.sqrt(degree[i]), 4) * 0.45,
    }));
    const posOf = new Map<string, LaidOutNode>(laidNodes.map((nd) => [nd.path, nd]));
    const laidEdges: LaidOutEdge[] = validEdges.map((e) => {
      const a = posOf.get(e.source)!;
      const b = posOf.get(e.target)!;
      return { source: e.source, target: e.target, origin: e.origin, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
    return { nodes: laidNodes, edges: laidEdges };
  }

  const graph = $derived(computeLayout(notes, links));
  const selected = $derived(notes.find((item) => item.path === selectedPath) ?? null);
  const selectedLinks = $derived(
    links.filter((l) => l.source === selectedPath || l.target === selectedPath)
  );

  function titleFor(path: string): string {
    const item = notes.find((n) => n.path === path);
    return item ? item.title || item.name : path;
  }

  function otherSide(link: LinkEdge): string {
    return link.source === selectedPath ? link.target : link.source;
  }

  function toggleLinkMode() {
    linkMode = !linkMode;
    linkSource = null;
  }

  async function addLink(source: string, target: string) {
    linkMode = false;
    linkSource = null;
    try {
      await linksApply([{ source, target, action: 'add' }]);
      await load();
    } catch (e) {
      console.error('Failed to add link:', e);
    }
  }

  async function removeLink(source: string, target: string) {
    try {
      await linksApply([{ source, target, action: 'remove' }]);
      await load();
    } catch (e) {
      console.error('Failed to remove link:', e);
    }
  }

  function handleNodeClick(path: string) {
    if (linkMode) {
      if (!linkSource) {
        linkSource = path;
      } else if (linkSource !== path) {
        void addLink(linkSource, path);
      }
      return;
    }
    selectedPath = selectedPath === path ? null : path;
  }

  function handleEdgeClick(edge: LaidOutEdge) {
    void removeLink(edge.source, edge.target);
  }
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-fadeIn"
    role="presentation"
  >
    <!-- Modal Dialog -->
    <div
      class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-3xl h-[80vh] shadow-2xl flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-sidebar)]">
        <div class="flex items-center gap-3">
          <h2 class="text-base font-semibold text-[var(--text-main)]">{$t('graph.title')}</h2>
          <button
            onclick={toggleLinkMode}
            class="px-2.5 py-1 text-xs rounded transition border {linkMode ? 'border-[var(--accent)] bg-[var(--bg-active)] text-[var(--accent-light)] font-medium' : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'}"
          >
            {$t('graph.startLink')}
          </button>
        </div>
        <button
          onclick={() => (isOpen = false)}
          class="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-dim)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition"
        >
          ✕
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 flex overflow-hidden min-h-0">
        <!-- Graph Area -->
        <div class="flex-1 relative bg-[var(--bg-main)] overflow-hidden">
          {#if linkMode}
            <div class="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--accent)] text-xs text-[var(--accent-light)] shadow">
              {$t('graph.linkMode')}
            </div>
          {/if}

          {#if graph.edges.length === 0}
            <div class="absolute inset-0 flex items-center justify-center p-8">
              <p class="text-sm text-[var(--text-dim)] text-center max-w-md">{$t('graph.empty')}</p>
            </div>
          {:else}
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" class="w-full h-full graph-svg">
              {#each graph.edges as edge (edge.source + '→' + edge.target + '→' + edge.origin)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <g class="graph-edge" role="button" tabindex="-1" onclick={() => handleEdgeClick(edge)}>
                  <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} class="edge-line" />
                  <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} class="edge-hit" />
                </g>
              {/each}
              {#each graph.nodes as node (node.path)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <g
                  class="graph-node"
                  class:node-selected={selectedPath === node.path}
                  class:node-link-source={linkSource === node.path}
                  role="button"
                  tabindex="-1"
                  onclick={() => handleNodeClick(node.path)}
                >
                  <circle cx={node.x} cy={node.y} r={node.r} class="node-circle" />
                  <text x={node.x} y={node.y - node.r - 1} text-anchor="middle" class="node-label">{node.title}</text>
                </g>
              {/each}
            </svg>
          {/if}
        </div>

        <!-- Selection Side Panel -->
        {#if selected}
          <div class="w-72 shrink-0 border-l border-[var(--border)] bg-[var(--bg-sidebar)] flex flex-col overflow-y-auto p-4 gap-3">
            <div>
              <h3 class="text-sm font-semibold text-[var(--text-main)] break-words">{selected.title || selected.name}</h3>
              <p class="text-xs text-[var(--text-dim)] break-all">{selected.path}</p>
            </div>
            <button
              onclick={() => {
                isOpen = false;
                onOpenNote?.(selected.path);
              }}
              class="px-3 py-1.5 text-xs rounded-md border border-[var(--accent)] bg-[var(--bg-active)] text-[var(--accent-light)] font-medium hover:bg-[var(--bg-hover)] transition self-start"
            >
              {$t('graph.open')}
            </button>

            <div class="flex flex-col gap-1.5">
              <p class="text-xs font-medium text-[var(--text-muted)]">{$t('graph.linksOf', { note: selected.title || selected.name })}</p>
              {#if selectedLinks.length === 0}
                <p class="text-xs text-[var(--text-dim)]">{$t('graph.noLinksNote')}</p>
              {:else}
                {#each selectedLinks as link (link.source + '→' + link.target + '→' + link.origin)}
                  <div class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-[var(--bg-card)] border border-[var(--border)]">
                    <div class="min-w-0">
                      <p class="text-xs text-[var(--text-main)] truncate">{titleFor(otherSide(link))}</p>
                      <p class="text-[10px] text-[var(--text-dim)]">{link.origin} · {link.source === selectedPath ? '→' : '←'}</p>
                    </div>
                    <button
                      onclick={() => removeLink(link.source, link.target)}
                      class="shrink-0 px-2 py-0.5 text-[10px] rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition"
                      title={$t('graph.unlink')}
                    >
                      {$t('graph.unlink')}
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-6 py-2 border-t border-[var(--border)] bg-[var(--bg-sidebar)] text-xs text-[var(--text-dim)]">
        <span>{$t('graph.notes', { count: notes.length })} · {$t('graph.links', { count: links.length })}</span>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.15s ease-out;
  }
  .graph-svg {
    display: block;
  }
  .edge-line {
    stroke: var(--border);
    stroke-width: 0.35;
  }
  .edge-hit {
    stroke: transparent;
    stroke-width: 2.5;
    cursor: pointer;
  }
  .graph-edge:hover .edge-line {
    stroke: var(--danger);
    stroke-width: 0.6;
  }
  .node-circle {
    fill: var(--accent);
    fill-opacity: 0.75;
    stroke: transparent;
    stroke-width: 0.5;
    cursor: pointer;
    transition: fill-opacity 0.1s;
  }
  .graph-node:hover .node-circle {
    fill-opacity: 1;
  }
  .node-selected .node-circle {
    stroke: var(--accent-light);
    fill-opacity: 1;
  }
  .node-link-source .node-circle {
    stroke: var(--success);
    stroke-width: 0.8;
    fill-opacity: 1;
  }
  .node-label {
    fill: var(--text-muted);
    font-size: 2px;
    pointer-events: none;
    user-select: none;
  }
  .node-selected .node-label {
    fill: var(--text-main);
    font-weight: 600;
  }
</style>
