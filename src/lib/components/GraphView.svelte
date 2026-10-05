<script lang="ts">
  import {
    ArrowLeft,
    FileText,
    Link2,
    Link2Off,
    Maximize2,
    Minus,
    Plus,
    RotateCcw,
    Search,
    X,
  } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { linksGet, linksApply } from '../api';
  import type { LinkEdge, VaultItem } from '../types';
  import { t } from '$lib/i18n';

  let { items, vaultId, onClose, onOpenNote } = $props<{
    items: VaultItem[];
    vaultId: string;
    onClose: () => void;
    onOpenNote: (path: string) => void;
  }>();

  interface Point { x: number; y: number }
  interface GraphNode extends Point { path: string; title: string; r: number }
  interface GraphEdge extends LinkEdge { x1: number; y1: number; x2: number; y2: number }
  type Gesture = {
    pointerId: number;
    path: string | null;
    startClient: Point;
    startCanvas: Point;
    startPosition: Point;
    moved: boolean;
  };

  let links = $state<LinkEdge[]>([]);
  let positions = $state<Record<string, Point>>({});
  let selectedPath = $state<string | null>(null);
  let searchQuery = $state('');
  let linkMode = $state(false);
  let linkSource = $state<string | null>(null);
  let viewport = $state({ x: 0, y: 0, scale: 1 });
  let svg = $state<SVGSVGElement | null>(null);
  let canvasSpan = $state(700);
  const unitsPerPixel = $derived(100 / Math.max(1, canvasSpan));
  let gesture = $state<Gesture | null>(null);
  const storageKey = $derived(`lownotes:graph-positions:${vaultId}`);

  const notes = $derived<VaultItem[]>(items.filter((item: VaultItem) => !item.is_dir));
  const baseGraph = $derived(computeLayout(notes, links));
  const graph = $derived.by(() => {
    const nodes = baseGraph.nodes.map((node) => ({ ...node, ...(positions[node.path] ?? {}) }));
    const byPath = new Map(nodes.map((node) => [node.path, node]));
    const edges = baseGraph.edges.map((edge) => {
      const source = byPath.get(edge.source)!;
      const target = byPath.get(edge.target)!;
      return { ...edge, x1: source.x, y1: source.y, x2: target.x, y2: target.y };
    });
    return { nodes, edges };
  });
  const selected = $derived(notes.find((note: VaultItem) => note.path === selectedPath) ?? null);
  const selectedLinks = $derived(links.filter((link) => link.source === selectedPath || link.target === selectedPath));
  const searchResults = $derived(searchQuery.trim()
    ? notes.filter((note: VaultItem) => `${note.title} ${note.name} ${note.path}`.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())).slice(0, 8)
    : []);
  const matches = $derived(new Set(searchResults.map((note: VaultItem) => note.path)));

  $effect(() => {
    const canvas = svg;
    if (!canvas) return;
    const measure = () => {
      const span = Math.min(canvas.clientWidth, canvas.clientHeight);
      if (span > 0) canvasSpan = span;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  function labelFor(title: string) {
    const limit = Math.max(12, Math.min(28, Math.floor(canvasSpan / 18)));
    return title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
  }

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, Point>;
      positions = Object.fromEntries(Object.entries(saved).filter(([, point]) =>
        point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ));
    } catch {
      positions = {};
    }
  });

  $effect(() => {
    items;
    void loadLinks();
  });

  async function loadLinks() {
    try {
      links = await linksGet();
    } catch (error) {
      console.error('Failed to load graph links:', error);
    }
  }

  function persistPositions() {
    localStorage.setItem(storageKey, JSON.stringify(positions));
  }

  function resetPositions() {
    positions = {};
    localStorage.removeItem(storageKey);
    resetView();
  }

  function truncate(title: string): string {
    return title.length > 28 ? `${title.slice(0, 27)}…` : title;
  }

  function computeLayout(noteItems: VaultItem[], edges: LinkEdge[]) {
    const index = new Map(noteItems.map((item, i) => [item.path, i]));
    const validEdges = edges.filter((edge) => index.has(edge.source) && index.has(edge.target) && edge.source !== edge.target);
    const count = noteItems.length;
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const degree = new Uint16Array(count);
    const forcesX = new Float64Array(count);
    const forcesY = new Float64Array(count);
    const edgeIndexes = validEdges.map((edge) => [index.get(edge.source)!, index.get(edge.target)!] as const);

    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / Math.max(count, 1);
      xs[i] = 50 + 35 * Math.cos(angle);
      ys[i] = 50 + 35 * Math.sin(angle);
    }
    for (const [a, b] of edgeIndexes) { degree[a]++; degree[b]++; }

    for (let iteration = 0; iteration < 180; iteration++) {
      forcesX.fill(0);
      forcesY.fill(0);
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = xs[i] - xs[j];
          const dy = ys[i] - ys[j];
          const distanceSquared = dx * dx + dy * dy + 0.01;
          const force = 300 / distanceSquared / Math.sqrt(distanceSquared);
          forcesX[i] += dx * force;
          forcesY[i] += dy * force;
          forcesX[j] -= dx * force;
          forcesY[j] -= dy * force;
        }
      }
      for (const [a, b] of edgeIndexes) {
        const dx = xs[b] - xs[a];
        const dy = ys[b] - ys[a];
        const distance = Math.hypot(dx, dy) + 0.001;
        const force = (distance - 18) * 0.08 / distance;
        forcesX[a] += dx * force;
        forcesY[a] += dy * force;
        forcesX[b] -= dx * force;
        forcesY[b] -= dy * force;
      }
      const maxStep = 0.2 + 6 * (1 - iteration / 180);
      for (let i = 0; i < count; i++) {
        let dx = forcesX[i] + (50 - xs[i]) * 0.02;
        let dy = forcesY[i] + (50 - ys[i]) * 0.02;
        const magnitude = Math.hypot(dx, dy);
        if (magnitude > maxStep) { dx = dx / magnitude * maxStep; dy = dy / magnitude * maxStep; }
        xs[i] += dx;
        ys[i] += dy;
      }
    }

    if (count > 0) {
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const scale = Math.min(82 / Math.max(maxX - minX, 1), 72 / Math.max(maxY - minY, 1));
      for (let i = 0; i < count; i++) {
        xs[i] = (xs[i] - (minX + maxX) / 2) * scale + 50;
        ys[i] = (ys[i] - (minY + maxY) / 2) * scale + 50;
      }
    }

    const nodes: GraphNode[] = noteItems.map((item, i) => ({
      path: item.path, title: truncate(item.title || item.name), x: xs[i], y: ys[i],
      r: 0.9 + Math.min(Math.sqrt(degree[i]), 4) * 0.32,
    }));
    const byPath = new Map(nodes.map((node) => [node.path, node]));
    const laidEdges: GraphEdge[] = validEdges.map((edge) => {
      const a = byPath.get(edge.source)!;
      const b = byPath.get(edge.target)!;
      return { ...edge, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
    return { nodes, edges: laidEdges };
  }

  function canvasPoint(clientX: number, clientY: number): Point {
    const point = svg!.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const canvas = point.matrixTransform(svg!.getScreenCTM()!.inverse());
    return { x: canvas.x, y: canvas.y };
  }

  function zoomAt(factor: number, anchor: Point) {
    const scale = Math.max(0.35, Math.min(4, viewport.scale * factor));
    const ratio = scale / viewport.scale;
    viewport = {
      x: anchor.x - (anchor.x - viewport.x) * ratio,
      y: anchor.y - (anchor.y - viewport.y) * ratio,
      scale,
    };
  }

  function resetView() { viewport = { x: 0, y: 0, scale: 1 }; }

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const element = event.target instanceof Element ? event.target.closest<SVGGElement>('[data-node-path]') : null;
    const path = element?.dataset.nodePath ?? null;
    const node = path ? graph.nodes.find((item) => item.path === path) : null;
    gesture = {
      pointerId: event.pointerId,
      path,
      startClient: { x: event.clientX, y: event.clientY },
      startCanvas: canvasPoint(event.clientX, event.clientY),
      startPosition: node ? { x: node.x, y: node.y } : { x: viewport.x, y: viewport.y },
      moved: false,
    };
    svg!.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    const current = canvasPoint(event.clientX, event.clientY);
    const dx = current.x - gesture.startCanvas.x;
    const dy = current.y - gesture.startCanvas.y;
    if (gesture.path) {
      positions = { ...positions, [gesture.path]: {
        x: gesture.startPosition.x + dx / viewport.scale,
        y: gesture.startPosition.y + dy / viewport.scale,
      } };
    } else {
      viewport = { ...viewport, x: gesture.startPosition.x + dx, y: gesture.startPosition.y + dy };
    }
  }

  function handlePointerUp(event: PointerEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const finished = gesture;
    gesture = null;
    if (svg!.hasPointerCapture(event.pointerId)) svg!.releasePointerCapture(event.pointerId);
    if (finished.path) {
      if (finished.moved) persistPositions();
      else handleNodeClick(finished.path);
    }
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.001), canvasPoint(event.clientX, event.clientY));
  }

  function focusNote(path: string) {
    selectedPath = path;
    searchQuery = '';
    const node = graph.nodes.find((item) => item.path === path);
    if (node) viewport = { ...viewport, x: 50 - node.x * viewport.scale, y: 50 - node.y * viewport.scale };
  }

  function handleNodeClick(path: string) {
    if (!linkMode) { onOpenNote(path); return; }
    if (!linkSource) { linkSource = path; return; }
    if (linkSource !== path) void addLink(linkSource, path);
  }

  async function addLink(source: string, target: string) {
    try {
      await linksApply([{ source, target, action: 'add' }]);
      await loadLinks();
      selectedPath = source;
    } catch (error) {
      console.error('Failed to add graph link:', error);
    } finally {
      linkMode = false;
      linkSource = null;
    }
  }

  async function removeLink(source: string, target: string) {
    try {
      await linksApply([{ source, target, action: 'remove' }]);
      await loadLinks();
    } catch (error) {
      console.error('Failed to remove graph link:', error);
    }
  }

  function titleFor(path: string): string {
    const note = notes.find((item: VaultItem) => item.path === path);
    return note ? note.title || note.name : path;
  }
</script>

<section class="apple-graph flex flex-col h-full min-h-0 w-full bg-[var(--bg-main)] select-none" aria-label={$t('graph.title')}>
  <!-- Header Bar -->
  <header class="app-topbar h-11 flex items-center justify-between gap-3 px-3 border-b border-[var(--border)] bg-[var(--bg-sidebar)]/80 backdrop-blur-xl shrink-0">
    <div class="flex items-center gap-3">
      <button
        onclick={onClose}
        class="h-7 flex items-center gap-1.5 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors shadow-sm cursor-pointer"
        title={$t('graph.back')}
        aria-label={$t('graph.back')}
      >
        <ArrowLeft size={13} />
        <span>{$t('graph.back')}</span>
      </button>

      <div class="flex items-center gap-2">
        <h2 class="font-bold text-xs text-[var(--text-main)] tracking-tight">{$t('graph.title')}</h2>
        <span class="text-[11px] text-[var(--text-dim)] font-mono">
          ({$t('graph.notes', { count: notes.length })} · {$t('graph.links', { count: links.length })})
        </span>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button
        onclick={() => { linkMode = !linkMode; linkSource = null; }}
        class="h-7 flex items-center gap-1.5 px-2.5 rounded-md border text-xs font-medium transition-colors shadow-sm cursor-pointer {linkMode ? 'bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]' : 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
        aria-pressed={linkMode}
      >
        <Link2 size={13} />
        <span>{$t('graph.startLink')}</span>
      </button>

      <button
        onclick={resetPositions}
        class="h-7 flex items-center gap-1.5 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors shadow-sm cursor-pointer"
        title={$t('graph.resetPositions')}
      >
        <RotateCcw size={13} />
        <span>{$t('graph.resetPositions')}</span>
      </button>
    </div>
  </header>

  <div class="flex-1 flex min-h-0 overflow-hidden relative">
    <div class="graph-area relative flex-1 min-w-0 overflow-hidden">
      <!-- Search Input in Graph -->
      <div class="absolute top-4 left-4 z-10 w-64 max-w-[calc(100%_-_2rem)]">
        <div class="relative">
          <Search size={13} class="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] pointer-events-none" />
          <input
            bind:value={searchQuery}
            aria-label={$t('graph.search')}
            placeholder={$t('graph.search')}
            class="w-full bg-[var(--bg-card)]/90 backdrop-blur-xl border border-[var(--border)] rounded-xl pl-8 pr-3 py-2 text-xs text-[var(--text-main)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] shadow-lg transition-all"
          />
        </div>
        {#if searchResults.length > 0}
          <div class="mt-1.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/95 backdrop-blur-xl shadow-2xl max-h-60 overflow-y-auto p-1 animate-in fade-in zoom-in-95 duration-150">
            {#each searchResults as result (result.path)}
              <button
                onclick={() => focusNote(result.path)}
                class="w-full text-left px-3 py-1.5 text-xs truncate rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-main)] transition cursor-pointer"
              >
                {result.title || result.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if linkMode}
        <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-full bg-[var(--bg-card)]/95 backdrop-blur-xl border border-[var(--accent)] text-xs font-semibold text-[var(--accent)] shadow-xl animate-bounce">
          {linkSource ? $t('graph.linkMode') : $t('graph.chooseSource')}
        </div>
      {/if}

      {#if graph.nodes.length === 0}
        <div class="absolute inset-0 flex items-center justify-center p-8 text-sm text-[var(--text-dim)] text-center font-medium">{$t('graph.empty')}</div>
      {:else}
        <svg
          bind:this={svg}
          style:--graph-label-size="{12 * unitsPerPixel}px"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          class="w-full h-full touch-none select-none cursor-grab"
          class:cursor-grabbing={gesture?.moved && !gesture.path}
          role="img"
          aria-label={$t('graph.title')}
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerUp}
          onpointercancel={handlePointerUp}
          onwheel={handleWheel}
        >
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {#each graph.edges as edge (edge.source + '→' + edge.target + '→' + edge.origin)}
              <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} class="edge-line" />
            {/each}
            {#each graph.nodes as node (node.path)}
              <g
                data-node-path={node.path}
                role="button"
                tabindex="0"
                aria-label={`${$t('graph.open')}: ${node.title}`}
                onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleNodeClick(node.path); } }}
                class="graph-node cursor-pointer"
                class:node-selected={selectedPath === node.path}
                class:node-link-source={linkSource === node.path}
                class:node-dimmed={searchQuery.trim().length > 0 && !matches.has(node.path)}
              >
                <title>{node.path}</title>
                <circle cx={node.x} cy={node.y} r={Math.max(node.r + 1.4, 22 * unitsPerPixel)} class="node-hit" />
                <circle cx={node.x} cy={node.y} r={Math.max(node.r, 5 * unitsPerPixel)} class="node-circle" />
                <text x={node.x} y={node.y + Math.max(node.r, 5 * unitsPerPixel) + 14 * unitsPerPixel} text-anchor="middle" class="node-label">{labelFor(node.title)}</text>
              </g>
            {/each}
          </g>
        </svg>
      {/if}

      <!-- Zoom controls -->
      <div class="absolute bottom-5 right-5 z-10 flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/90 backdrop-blur-xl p-1.5 shadow-2xl">
        <button class="p-1.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer" onclick={() => zoomAt(1.25, { x: 50, y: 50 })} title={$t('graph.zoomIn')} aria-label={$t('graph.zoomIn')}>
          <Plus size={14} />
        </button>
        <span class="text-xs font-mono font-bold text-[var(--text-main)] min-w-11 text-center select-none">{Math.round(viewport.scale * 100)}%</span>
        <button class="p-1.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer" onclick={() => zoomAt(0.8, { x: 50, y: 50 })} title={$t('graph.zoomOut')} aria-label={$t('graph.zoomOut')}>
          <Minus size={14} />
        </button>
        <div class="w-[1px] h-4 bg-[var(--border)] mx-0.5"></div>
        <button class="p-1.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition cursor-pointer" onclick={resetView} title={$t('graph.resetView')} aria-label={$t('graph.resetView')}>
          <Maximize2 size={13} />
        </button>
      </div>
      <p class="absolute bottom-5 left-5 z-10 max-w-[55%] text-[11px] text-[var(--text-dim)] pointer-events-none font-medium">{$t('graph.hint')}</p>
    </div>

    <!-- Selected Node Details Drawer -->
    {#if selected}
      <aside class="w-72 shrink-0 border-l border-[var(--border)] bg-[var(--bg-sidebar)]/95 backdrop-blur-xl flex flex-col overflow-y-auto p-5 gap-4 shadow-2xl">
        <button class="self-end p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" onclick={() => (selectedPath = '')} title={$t('ai.close')} aria-label={$t('ai.close')}><X size={16} /></button>
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">Nota Selecionada</span>
          <h3 class="text-sm font-bold text-[var(--text-main)] break-words mt-1 leading-tight">{selected.title || selected.name}</h3>
          <p class="text-[11px] font-mono text-[var(--text-dim)] break-all mt-1">{selected.path}</p>
        </div>

        <button
          onclick={() => onOpenNote(selected.path)}
          class="flex items-center justify-center gap-1.5 w-full py-2 text-xs rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)] font-bold shadow-md hover:opacity-90 transition cursor-pointer"
        >
          <FileText size={13} />
          <span>{$t('graph.open')}</span>
        </button>

        <div class="flex flex-col gap-2.5 pt-2 border-t border-[var(--border)]">
          <p class="text-xs font-bold text-[var(--text-muted)]">{$t('graph.linksOf', { note: selected.title || selected.name })}</p>
          {#if selectedLinks.length === 0}
            <p class="text-xs text-[var(--text-dim)] font-medium">{$t('graph.noLinksNote')}</p>
          {:else}
            <div class="flex flex-col gap-1.5">
              {#each selectedLinks as link (link.source + '→' + link.target + '→' + link.origin)}
                <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm">
                  <span class="text-xs font-semibold text-[var(--text-main)] truncate">{titleFor(link.source === selectedPath ? link.target : link.source)}</span>
                  <button
                    onclick={() => void removeLink(link.source, link.target)}
                    class="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition cursor-pointer inline-flex items-center justify-center"
                    title={$t('graph.unlink')}
                    aria-label={$t('graph.unlink')}
                  >
                    <Link2Off size={14} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</section>

<style>
  .graph-area { background: var(--reading-surface); }
  .edge-line { stroke: var(--text-dim); stroke-opacity: 0.58; stroke-width: 0.16; }
  .node-hit { fill: transparent; }
  .node-circle { fill: var(--accent); stroke: var(--accent-light); stroke-width: 0.12; transition: fill 120ms ease; }
  .graph-node:hover .node-circle, .node-selected .node-circle { fill: var(--accent-light); stroke-width: 0.3; }
  .node-link-source .node-circle { fill: var(--success); stroke: var(--success); }
  .node-label { fill: var(--text-main); font-size: var(--graph-label-size, 1.45px); font-weight: 500; paint-order: stroke; stroke: var(--bg-main); stroke-width: 0.3px; pointer-events: none; }
  .node-dimmed { opacity: 0.2; }
  /* An outline on the SVG group scales with the viewBox and covers nearby nodes. */
  .graph-node:focus, .graph-node:focus-visible { outline: none; }
  .graph-node:focus-visible .node-circle { stroke: var(--success); stroke-width: 0.45; }
</style>
