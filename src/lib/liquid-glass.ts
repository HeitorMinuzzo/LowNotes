import type { Action } from 'svelte/action';
import { base } from '$app/paths';

const BACKDROP_KEY = 'lownotes.glass.background';

export const GLASS_BACKDROPS = ['none', 'aurora', 'ocean', 'sunset'] as const;
export type GlassBackdrop = typeof GLASS_BACKDROPS[number];

export function getGlassBackdrop(): GlassBackdrop {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(BACKDROP_KEY) : null;
    return GLASS_BACKDROPS.includes(stored as GlassBackdrop) ? stored as GlassBackdrop : 'none';
  } catch { return 'none'; }
}

export function setGlassBackdrop(value: GlassBackdrop): void {
  const backdrop = GLASS_BACKDROPS.includes(value) ? value : 'none';
  try { localStorage.setItem(BACKDROP_KEY, backdrop); } catch { /* Session preference still works. */ }
  document.documentElement.dataset.lgBackdrop = backdrop;
}

type SurfaceOptions = { kind?: 'regular' | 'clear'; shape?: 'capsule'; refraction?: number; active?: boolean };
type SurfaceRecord = {
  node: HTMLElement;
  options: SurfaceOptions;
  filter?: SVGFilterElement;
  image?: SVGFEImageElement;
  displacement?: SVGFEDisplacementMapElement;
  blur?: SVGFEGaussianBlurElement;
  geometry?: string;
};
const NS = 'http://www.w3.org/2000/svg';
let nextId = 0;
let material: ReturnType<typeof createMaterial> | undefined;

function createMaterial(root: HTMLElement) {
  root.dataset.lgBackdrop = getGlassBackdrop();
  // Let the fixed CSS defaults replace overrides left by an earlier app session.
  for (const property of ['--lg-sidebar-alpha', '--lg-blur', '--lg-rim']) root.style.removeProperty(property);
  for (const attribute of ['data-lg-transparency', 'data-lg-sidebar-transparency', 'data-lg-blur', 'data-lg-rim']) root.removeAttribute(attribute);
  const capable = /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent)
    && CSS.supports('backdrop-filter', 'url("#glass-filter")');
  const preferences = ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)'].map(query => matchMedia(query));
  const records = new Map<HTMLElement, SurfaceRecord>();
  let svg: SVGSVGElement | undefined;
  let defs: SVGDefsElement | undefined;
  let frame = 0;
  let disposed = false;

  function enabled() {
    return capable && root.dataset.palette === 'liquid-glass'
      && root.dataset.lgFallback !== 'true'
      && !preferences.some(query => query.matches);
  }

  function clear(record: SurfaceRecord) {
    record.node.style.removeProperty('--lg-lens');
    record.node.removeAttribute('data-lg-optics');
    record.filter?.remove();
    record.filter = record.image = record.displacement = undefined;
    record.blur = undefined;
    record.geometry = undefined;
  }

  function build(record: SurfaceRecord) {
    if (!defs) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      svg.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
      defs = document.createElementNS(NS, 'defs'); svg.append(defs); document.body.append(svg);
    }
    const filter = document.createElementNS(NS, 'filter');
    filter.id = `lownotes-glass-lens-${++nextId}`;
    const capsule = record.options.shape === 'capsule';
    for (const [key, value] of Object.entries({ x: '0', y: '0', filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(key, value);
    const image = document.createElementNS(NS, 'feImage');
    image.setAttribute('x', '0'); image.setAttribute('y', '0');
    image.setAttribute('result', 'normal-map'); image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('href', `${base}/glass/switcher-map.webp`);
    const displacement = document.createElementNS(NS, 'feDisplacementMap');
    for (const [key, value] of Object.entries({ in: 'SourceGraphic', in2: 'normal-map', xChannelSelector: 'R', yChannelSelector: 'G', scale: '0' })) displacement.setAttribute(key, value);
    let blur: SVGFEGaussianBlurElement | undefined;
    if (capsule) {
      // An opaque neutral field prevents transparent map edges from producing extreme offsets.
      const neutral = document.createElementNS(NS, 'feFlood');
      neutral.setAttribute('flood-color', 'rgb(128,128,128)'); neutral.setAttribute('result', 'neutral-map');
      const map = document.createElementNS(NS, 'feComposite');
      for (const [key, value] of Object.entries({ in: 'normal-map', in2: 'neutral-map', operator: 'over', result: 'opaque-map' })) map.setAttribute(key, value);
      blur = document.createElementNS(NS, 'feGaussianBlur');
      blur.setAttribute('in', 'SourceGraphic'); blur.setAttribute('result', 'blur');
      displacement.setAttribute('in', 'blur'); displacement.setAttribute('in2', 'opaque-map');
      filter.append(image, neutral, map, blur, displacement);
    } else filter.append(image, displacement);
    defs.append(filter);
    Object.assign(record, { filter, image, displacement, blur });
  }

  function update(record: SurfaceRecord) {
    const { node } = record;
    if (!enabled() || record.options.active === false || !node.isConnected || (node.parentElement?.closest('[data-lg-surface]') && record.options.shape !== 'capsule')) { clear(record); return; }
    // Filter coordinates must follow layout pixels, unaffected by zoom or entrance transforms.
    const width = node.offsetWidth, height = node.offsetHeight;
    if (!width || !height) return;
    const style = getComputedStyle(node);
    if (style.backdropFilter === 'none' || node.closest('[data-lg-fallback="true"]')) { clear(record); return; }
    if (!record.filter) build(record);
    const capsule = record.options.shape === 'capsule';
    const strength = Math.max(0, Math.min(16, record.options.refraction ?? (parseFloat(style.getPropertyValue('--lg-refraction')) || 0)));
    const geometry = [width, height].join(':');
    if (record.geometry !== geometry) {
      // Scale the reference's map with the panel; no canvas or captured content.
      record.filter!.setAttribute('width', String(width)); record.filter!.setAttribute('height', String(height));
      record.image!.setAttribute('width', String(width)); record.image!.setAttribute('height', String(height));
      record.blur?.setAttribute('stdDeviation', `${width * .01} ${height * .01}`);
      record.geometry = geometry;
    }
    // Keep capsule refraction within a few pixels instead of scaling it to half the full control.
    record.displacement!.setAttribute('scale', String(capsule ? Math.min(10, height * .18) : strength * 2));
    node.style.setProperty('--lg-lens', `url("#${record.filter!.id}")`);
    node.dataset.lgOptics = 'reference';
  }

  function refresh() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0; records.forEach(update);
      if (![...records.values()].some(record => record.filter)) { svg?.remove(); svg = defs = undefined; }
    });
  }
  const resize = new ResizeObserver(refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(root, { attributes: true, attributeFilter: ['data-palette', 'data-theme', 'data-lg-backdrop', 'data-lg-fallback'] });
  preferences.forEach(query => query.addEventListener('change', refresh));
  function stored(event: StorageEvent) {
    if (event.key === BACKDROP_KEY) root.dataset.lgBackdrop = getGlassBackdrop();
  }
  window.addEventListener('storage', stored);

  return {
    add(node: HTMLElement, options: SurfaceOptions) {
      const record: SurfaceRecord = { node, options }; records.set(node, record);
      node.dataset.lgSurface = options.kind ?? 'regular'; resize.observe(node); refresh();
      return {
        update(options: SurfaceOptions = {}) { record.options = options; node.dataset.lgSurface = options.kind ?? 'regular'; refresh(); },
        destroy() { resize.unobserve(node); clear(record); records.delete(node); node.removeAttribute('data-lg-surface'); },
      };
    },
    destroy() {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect();
      preferences.forEach(query => query.removeEventListener('change', refresh));
      window.removeEventListener('storage', stored); records.forEach(clear); svg?.remove();
    },
  };
}

function currentMaterial() { return material ??= createMaterial(document.documentElement); }

export const liquidGlass: Action<HTMLElement, SurfaceOptions | undefined> = (node, options = {}) => currentMaterial().add(node, options);

export function installLiquidGlass(_root: HTMLElement): () => void {
  const current = currentMaterial();
  return () => { current.destroy(); if (material === current) material = undefined; };
}
