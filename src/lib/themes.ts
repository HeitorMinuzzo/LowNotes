
import type { AppTheme, ThemeColors, ThemePalette } from './types';

/** The two Apple designs share system colors, typography and components. */

export const DEFAULT_PALETTE_ID = 'apple';

const APPLE_PALETTE: ThemePalette = {
  id: 'apple',
  name: 'Apple',
  dark: {
    bg_main: '#1d1d1f',      // Near-black ink canvas (apple.design.md)
    bg_sidebar: '#161617',   // Frosted sub-surface sidebar
    bg_card: '#272729',      // surface-tile-1
    bg_hover: '#333336',     // surface-tile-2
    bg_active: '#424245',    // active tile
    border: '#38383a',       // hairline border
    text_main: '#f5f5f7',    // canvas-parchment text
    text_muted: '#b1b1b8',   // body-muted
    text_dim: '#96969f',     // ink-muted-48
    accent: '#2997ff',       // Sky Link Blue (Action Blue on dark)
    accent_light: '#70baff', // focus ring / hover
    accent_contrast: '#ffffff',
    success: '#30d158',      // Apple system green
    danger: '#ff6961',       // Apple system red
  },
  light: {
    bg_main: '#ffffff',      // Pure white canvas
    bg_sidebar: '#f5f5f7',   // Canvas parchment (signature Apple off-white)
    bg_card: '#ffffff',      // Utility card canvas
    bg_hover: '#e8e8ed',     // Soft hover
    bg_active: '#d2d2d7',    // Translucent chip base
    border: '#e0e0e0',       // Hairline border
    text_main: '#1d1d1f',    // Near-black ink
    text_muted: '#62626a',   // Ink muted 80
    text_dim: '#73737b',     // Ink muted 48
    accent: '#0066cc',       // Action Blue (#0066cc)
    accent_light: '#0071e3', // Focus Blue (#0071e3)
    accent_contrast: '#ffffff',
    success: '#248a3d',      // Apple system green
    danger: '#d93025',       // Apple system red
  },
};

const GLASS_PALETTE: ThemePalette = {
  id: 'apple-glass', name: 'Apple Liquid Glass',
  light: {
    bg_main: '#edf4f7', bg_sidebar: '#e5f0f2', bg_card: '#f9fcfd',
    bg_hover: '#dcebee', bg_active: '#d1e9ef', border: '#cadce3',
    text_main: '#172d38', text_muted: '#48626f', text_dim: '#58717d',
    accent: '#006b99', accent_light: '#007fb5', accent_contrast: '#ffffff',
    success: '#227c62', danger: '#ce3d42',
  },
  dark: {
    bg_main: '#15242d', bg_sidebar: '#13252d', bg_card: '#243b46',
    bg_hover: '#314c58', bg_active: '#24536a', border: '#3e5865',
    text_main: '#eff8fa', text_muted: '#b6ccd4', text_dim: '#a2bcc7',
    accent: '#70c9ee', accent_light: '#a1e2fa', accent_contrast: '#102630',
    success: '#77d8b4', danger: '#ff979a',
  },
};

export const BUILTIN_PALETTES: ThemePalette[] = [APPLE_PALETTE, GLASS_PALETTE];

export type ThemeToken = keyof ThemeColors;

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
  parts.push(`--accent-glow: ${withAlpha(colors.accent, 0.12)}`);
  parts.push(`--accent-hover: ${colors.accent_light}`);
  parts.push(`--selection: ${withAlpha(colors.accent, 0.18)}`);
  parts.push(`--line-highlight: ${withAlpha(colors.accent, .04)}`);
  parts.push(`--editor-link: ${colors.accent}`);
  parts.push(`--editor-link-hover: ${colors.accent_light}`);
  return parts.map((part) => `${part};`).join(' ');
}

/** Legacy palettes remain stored for compatibility, but only the two Apple designs are selectable. */
export function resolvePalette(id: string, _legacy: ThemePalette[] = []): ThemePalette {
  return BUILTIN_PALETTES.find((palette) => palette.id === id) ?? APPLE_PALETTE;
}

export function applyTheme(id: string, mode: AppTheme, legacy: ThemePalette[] = []): void {
  const palette = resolvePalette(id, legacy);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.palette = palette.id;
  root.dataset.design = 'apple';
  const colors = palette[mode];
  for (const [token, variable] of Object.entries(PALETTE_VARS)) {
    root.style.setProperty(variable, colors[token as ThemeToken]);
  }
  root.style.setProperty('--accent-glow', withAlpha(colors.accent, .12));
  root.style.setProperty('--accent-hover', colors.accent_light);
  root.style.setProperty('--selection', withAlpha(colors.accent, .18));
  root.style.setProperty('--line-highlight', withAlpha(colors.accent, .04));
  root.style.setProperty('--editor-link', colors.accent);
  root.style.setProperty('--editor-link-hover', colors.accent_light);
}
