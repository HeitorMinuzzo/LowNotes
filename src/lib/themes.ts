import type { TKey } from './i18n';
import type { AppTheme, ThemeColors, ThemePalette } from './types';

/**
 * Built-in palettes ship in code (mirrored by `BUILTIN_PALETTE_IDS` in
 * src-tauri/src/config.rs) so new defaults can be added in any release.
 * Only user-created palettes are persisted in appdata settings.
 *
 * Megumin's colors mirror the static `:root` / `:root[data-theme="light"]`
 * blocks in app.css, which act as the pre-JS fallback and as the exact
 * rendering path while Megumin is active.
 */

export const DEFAULT_PALETTE_ID = 'megumin';

const MEGUMIN_PALETTE: ThemePalette = {
  id: 'megumin',
  name: 'Megumin',
  dark: {
    bg_main: '#241d24', bg_sidebar: '#1c181e', bg_card: '#30252c',
    bg_hover: '#3d3038', bg_active: '#6b586b', border: '#644e51',
    text_main: '#fff5e6', text_muted: '#d0b9b4', text_dim: '#ae9293',
    accent: '#f7c65d', accent_light: '#ffe09a', accent_contrast: '#251a20',
    success: '#b9c978', danger: '#dc694a',
  },
  light: {
    bg_main: '#fbf5ed', bg_sidebar: '#f1e6dd', bg_card: '#fffaf4',
    bg_hover: '#ead8cf', bg_active: '#f5d5bd', border: '#cbb8ae',
    text_main: '#32242c', text_muted: '#644e51', text_dim: '#6b586b',
    accent: '#f7c65d', accent_light: '#9b3239', accent_contrast: '#251a20',
    success: '#59764c', danger: '#bd493d',
  },
};

const RIMURU_PALETTE: ThemePalette = {
  id: 'rimuru',
  name: 'Rimuru Tempest',
  dark: {
    bg_main: '#1a2432', bg_sidebar: '#121b26', bg_card: '#213042',
    bg_hover: '#2a3c52', bg_active: '#33506f', border: '#3a5f8a',
    text_main: '#f7fcfc', text_muted: '#a9c6e2', text_dim: '#7e9cba',
    accent: '#93b9e8', accent_light: '#cce9f6', accent_contrast: '#12202f',
    success: '#84cfa9', danger: '#e2837e',
  },
  light: {
    bg_main: '#f7fcfc', bg_sidebar: '#e9f4fa', bg_card: '#ffffff',
    bg_hover: '#dbeef8', bg_active: '#cce9f6', border: '#a8c8e0',
    text_main: '#1c2b3a', text_muted: '#3a71a4', text_dim: '#6288ab',
    accent: '#93b9e8', accent_light: '#3a71a4', accent_contrast: '#12202f',
    success: '#4c8a63', danger: '#c05650',
  },
};

const APPLE_PALETTE: ThemePalette = {
  id: 'apple',
  name: 'Apple macOS',
  dark: {
    bg_main: '#1d1d1f',      // Near-black ink canvas (apple.design.md)
    bg_sidebar: '#161617',   // Frosted sub-surface sidebar
    bg_card: '#272729',      // surface-tile-1
    bg_hover: '#333336',     // surface-tile-2
    bg_active: '#424245',    // active tile
    border: '#38383a',       // hairline border
    text_main: '#f5f5f7',    // canvas-parchment text
    text_muted: '#a1a1a6',   // body-muted
    text_dim: '#6e6e73',     // ink-muted-48
    accent: '#2997ff',       // Sky Link Blue (Action Blue on dark)
    accent_light: '#70baff', // focus ring / hover
    accent_contrast: '#ffffff',
    success: '#30d158',      // Apple system green
    danger: '#ff453a',       // Apple system red
  },
  light: {
    bg_main: '#ffffff',      // Pure white canvas
    bg_sidebar: '#f5f5f7',   // Canvas parchment (signature Apple off-white)
    bg_card: '#ffffff',      // Utility card canvas
    bg_hover: '#e8e8ed',     // Soft hover
    bg_active: '#d2d2d7',    // Translucent chip base
    border: '#e0e0e0',       // Hairline border
    text_main: '#1d1d1f',    // Near-black ink
    text_muted: '#6e6e73',   // Ink muted 80
    text_dim: '#86868b',     // Ink muted 48
    accent: '#0066cc',       // Action Blue (#0066cc)
    accent_light: '#0071e3', // Focus Blue (#0071e3)
    accent_contrast: '#ffffff',
    success: '#34c759',      // Apple system green
    danger: '#ff3b30',       // Apple system red
  },
};

export const BUILTIN_PALETTES: ThemePalette[] = [MEGUMIN_PALETTE, RIMURU_PALETTE, APPLE_PALETTE];

export type ThemeToken = keyof ThemeColors;

/** Picker groups with i18n keys for group and token labels. */
export const TOKEN_GROUPS: { group: TKey; tokens: { token: ThemeToken; labelKey: TKey }[] }[] = [
  {
    group: 'settings.groupBackgrounds',
    tokens: [
      { token: 'bg_main', labelKey: 'settings.tokenBgMain' },
      { token: 'bg_sidebar', labelKey: 'settings.tokenBgSidebar' },
      { token: 'bg_card', labelKey: 'settings.tokenBgCard' },
      { token: 'bg_hover', labelKey: 'settings.tokenBgHover' },
      { token: 'bg_active', labelKey: 'settings.tokenBgActive' },
      { token: 'border', labelKey: 'settings.tokenBorder' },
    ],
  },
  {
    group: 'settings.groupText',
    tokens: [
      { token: 'text_main', labelKey: 'settings.tokenTextMain' },
      { token: 'text_muted', labelKey: 'settings.tokenTextMuted' },
      { token: 'text_dim', labelKey: 'settings.tokenTextDim' },
    ],
  },
  {
    group: 'settings.groupAccents',
    tokens: [
      { token: 'accent', labelKey: 'settings.tokenAccent' },
      { token: 'accent_light', labelKey: 'settings.tokenAccentLight' },
      { token: 'accent_contrast', labelKey: 'settings.tokenAccentContrast' },
    ],
  },
  {
    group: 'settings.groupStatus',
    tokens: [
      { token: 'success', labelKey: 'settings.tokenSuccess' },
      { token: 'danger', labelKey: 'settings.tokenDanger' },
    ],
  },
];

const PALETTE_VARS: Record<ThemeToken, string> = {
  bg_main: '--bg-main',
  bg_sidebar: '--bg-sidebar',
  bg_card: '--bg-card',
  bg_hover: '--bg-hover',
  bg_active: '--bg-active',
  border: '--border',
  text_main: '--text-main',
  text_muted: '--text-muted',
  text_dim: '--text-dim',
  accent: '--accent',
  accent_light: '--accent-light',
  accent_contrast: '--accent-contrast',
  success: '--success',
  danger: '--danger',
};

const DERIVED_VARS = ['--accent-glow', '--accent-hover', '--selection', '--line-highlight', '--editor-link', '--editor-link-hover'];

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Full CSS variable string (base + derived tokens) for scoped previews. */
export function themeVarsStyle(colors: ThemeColors, mode: AppTheme): string {
  const parts: string[] = [`color-scheme: ${mode}`];
  for (const [token, cssVar] of Object.entries(PALETTE_VARS)) {
    parts.push(`${cssVar}: ${colors[token as ThemeToken]}`);
  }
  parts.push(`--accent-glow: ${withAlpha(colors.accent, 0.17)}`);
  parts.push(`--accent-hover: ${lighten(colors.accent, 0.25)}`);
  parts.push(`--selection: ${mode === 'dark' ? withAlpha(colors.accent, 0.3) : withAlpha(colors.danger, 0.2)}`);
  parts.push(`--line-highlight: ${mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.045)'}`);
  parts.push(`--editor-link: ${mode === 'dark' ? '#7dd3fc' : '#0284c7'}`);
  parts.push(`--editor-link-hover: ${mode === 'dark' ? '#bae6fd' : '#0369a1'}`);
  return parts.map((part) => `${part};`).join(' ');
}

export function resolvePalette(id: string, customs: ThemePalette[]): ThemePalette {
  return BUILTIN_PALETTES.find((palette) => palette.id === id)
    ?? customs.find((palette) => palette.id === id)
    ?? MEGUMIN_PALETTE;
}

function clearThemeOverrides(): void {
  const root = document.documentElement;
  for (const cssVar of Object.values(PALETTE_VARS)) root.style.removeProperty(cssVar);
  for (const cssVar of DERIVED_VARS) root.style.removeProperty(cssVar);
}

function applyThemeColors(colors: ThemeColors, mode: AppTheme, paletteId: string): void {
  const root = document.documentElement;
  for (const [token, cssVar] of Object.entries(PALETTE_VARS)) {
    root.style.setProperty(cssVar, colors[token as ThemeToken]);
  }
  root.style.setProperty('--accent-glow', withAlpha(colors.accent, 0.17));
  root.style.setProperty('--accent-hover', paletteId === 'apple' ? '#0071e3' : lighten(colors.accent, 0.25));
  root.style.setProperty('--selection', paletteId === 'apple' ? withAlpha(colors.accent, 0.18) : mode === 'dark' ? withAlpha(colors.accent, 0.3) : withAlpha(colors.danger, 0.2));
  root.style.setProperty('--line-highlight', mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.045)');
  root.style.setProperty('--editor-link', paletteId === 'apple' ? (mode === 'dark' ? '#2997ff' : '#0066cc') : mode === 'dark' ? '#7dd3fc' : '#0284c7');
  root.style.setProperty('--editor-link-hover', paletteId === 'apple' ? (mode === 'dark' ? '#70baff' : '#0071e3') : mode === 'dark' ? '#bae6fd' : '#0369a1');
}

/**
 * Applies mode + palette to the document. Megumin renders through the static
 * stylesheet (pixel-exact fallback); other palettes are applied as inline
 * custom properties that override it.
 */
export function applyTheme(paletteId: string, mode: AppTheme, customs: ThemePalette[]): void {
  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.palette = paletteId;
  if (paletteId === DEFAULT_PALETTE_ID) {
    clearThemeOverrides();
    return;
  }
  const palette = resolvePalette(paletteId, customs);
  applyThemeColors(palette[mode], mode, paletteId);
}

/** Starting point for a new user palette: a copy of `base` with a fresh id. */
export function newCustomPalette(base: ThemePalette): ThemePalette {
  return {
    id: `custom_${crypto.randomUUID()}`,
    name: '',
    dark: { ...base.dark },
    light: { ...base.light },
  };
}
