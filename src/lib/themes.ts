
import type { AppTheme, ThemeColors, ThemePalette } from './types';

/** Liquid Glass is the app's only design, with light and dark appearances. */
export const DEFAULT_PALETTE_ID = 'liquid-glass';

const GLASS_PALETTE: ThemePalette = {
  id: 'liquid-glass', name: 'Liquid Glass',
  light: {
    bg_main: '#e8e8e9', bg_sidebar: '#e5e5e7', bg_card: '#f5f5f7',
    bg_hover: '#dddddf', bg_active: '#d6d6da', border: '#cfcfd4',
    text_main: '#222244', text_muted: '#525268', text_dim: '#626276',
    accent: '#0052f5', accent_light: '#0045d1', accent_contrast: '#ffffff',
    success: '#287852', danger: '#c8323a',
  },
  dark: {
    bg_main: '#1b1b1d', bg_sidebar: '#202022', bg_card: '#242426',
    bg_hover: '#343437', bg_active: '#414146', border: '#444449',
    text_main: '#e1e1e1', text_muted: '#bdbdc8', text_dim: '#a5a5b5',
    accent: '#9cdcff', accent_light: '#c4eaff', accent_contrast: '#112234',
    success: '#81d4a5', danger: '#ffa3a7',
  },
};

export const BUILTIN_PALETTES: ThemePalette[] = [GLASS_PALETTE];

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

/** Former theme IDs resolve to Liquid Glass without altering archived color data. */
export function resolvePalette(id: string, _legacy: ThemePalette[] = []): ThemePalette {
  return BUILTIN_PALETTES.find((palette) => palette.id === id) ?? GLASS_PALETTE;
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
