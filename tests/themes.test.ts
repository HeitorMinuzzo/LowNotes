import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  BUILTIN_PALETTES,
  DEFAULT_PALETTE_ID,
  TOKEN_GROUPS,
  isHexColor,
  lighten,
  newCustomPalette,
  resolvePalette,
  themeVarsStyle,
  withAlpha,
} from '../src/lib/themes';
import type { ThemeColors, ThemePalette } from '../src/lib/types';

const TOKENS: (keyof ThemeColors)[] = [
  'bg_main', 'bg_sidebar', 'bg_card', 'bg_hover', 'bg_active', 'border',
  'text_main', 'text_muted', 'text_dim', 'accent', 'accent_light',
  'accent_contrast', 'success', 'danger',
];

test('isHexColor accepts only #rrggbb', () => {
  expect(isHexColor('#f7c65d')).toBe(true);
  expect(isHexColor('#ABCDEF')).toBe(true);
  expect(isHexColor('#fff')).toBe(false);
  expect(isHexColor('f7c65d')).toBe(false);
  expect(isHexColor('#gggggg')).toBe(false);
  expect(isHexColor('')).toBe(false);
});

test('withAlpha and lighten compute expected colors', () => {
  expect(withAlpha('#f7c65d', 0.3)).toBe('rgba(247, 198, 93, 0.3)');
  expect(lighten('#000000', 0.5)).toBe('#808080');
  expect(lighten('#ffffff', 0.5)).toBe('#ffffff');
});

test('resolvePalette finds builtin, custom, then falls back to default', () => {
  const custom: ThemePalette = { id: 'custom_x', name: 'X', dark: {} as ThemeColors, light: {} as ThemeColors };
  expect(resolvePalette('megumin', []).id).toBe('megumin');
  expect(resolvePalette('rimuru', []).id).toBe('rimuru');
  expect(resolvePalette('lowbloat', []).id).toBe('lowbloat');
  expect(resolvePalette('custom_x', [custom]).id).toBe('custom_x');
  expect(resolvePalette('does-not-exist', []).id).toBe(DEFAULT_PALETTE_ID);
});

test('builtin palettes are complete, valid hex, and correctly identified', () => {
  expect(BUILTIN_PALETTES.map((p) => p.id)).toEqual(['lowbloat', 'megumin', 'rimuru']);
  expect(DEFAULT_PALETTE_ID).toBe('lowbloat');
  for (const palette of BUILTIN_PALETTES) {
    expect(palette.name.length).toBeGreaterThan(0);
    for (const mode of ['dark', 'light'] as const) {
      for (const token of TOKENS) {
        expect(isHexColor(palette[mode][token])).toBe(true);
      }
    }
  }
});

test('LowBloat uses the site and helpdesk colors in both modes', () => {
  const lowbloat = resolvePalette('lowbloat', []);
  expect(lowbloat.name).toBe('LowBloat');
  expect(lowbloat.light.bg_main).toBe('#f1f3ee');
  expect(lowbloat.light.bg_card).toBe('#fbfcf8');
  expect(lowbloat.light.text_main).toBe('#171a17');
  expect(lowbloat.light.accent).toBe('#b8f238');
  expect(lowbloat.light.accent_contrast).toBe('#1a2700');
  expect(lowbloat.dark.bg_main).toBe('#171a17');
  expect(lowbloat.dark.accent).toBe('#b8f238');
});

test('static pre-JS colors mirror the default palette', () => {
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  const light = css.match(/:root\s*\{([^}]+)\}/)?.[1];
  const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1];
  const palette = resolvePalette(DEFAULT_PALETTE_ID, []);
  expect(light).toBeDefined();
  expect(dark).toBeDefined();
  for (const mode of ['light', 'dark'] as const) {
    const block = mode === 'light' ? light : dark;
    expect(block).toContain(`color-scheme: ${mode}`);
    for (const token of TOKENS) {
      expect(block).toContain(`--${token.replaceAll('_', '-')}: ${palette[mode][token]}`);
    }
  }
});

test('Megumin keeps its original colors', () => {
  const megumin = resolvePalette('megumin', []);
  expect(megumin.name).toBe('Megumin');
  expect(megumin.dark.bg_main).toBe('#241d24');
  expect(megumin.dark.accent).toBe('#f7c65d');
  expect(megumin.light.bg_main).toBe('#fbf5ed');
  expect(megumin.light.accent).toBe('#f7c65d');
});

test('Rimuru palette uses the requested blue family', () => {
  const rimuru = resolvePalette('rimuru', []);
  expect(rimuru.name).toBe('Rimuru Tempest');
  expect(rimuru.dark.accent).toBe('#93b9e8');
  expect(rimuru.dark.text_main).toBe('#f7fcfc');
  expect(rimuru.light.bg_active).toBe('#cce9f6');
  expect(rimuru.light.text_muted).toBe('#3a71a4');
});

test('themeVarsStyle emits base and derived tokens plus color-scheme', () => {
  const colors = resolvePalette('rimuru', []).dark;
  const style = themeVarsStyle(colors, 'dark');
  expect(style).toContain('color-scheme: dark');
  expect(style).toContain(`--bg-main: ${colors.bg_main}`);
  expect(style).toContain(`--accent: ${colors.accent}`);
  expect(style).toContain(`--accent-glow: ${withAlpha(colors.accent, 0.17)}`);
  expect(style).toContain(`--accent-hover: ${lighten(colors.accent, 0.25)}`);
  expect(style).toContain(`--selection: ${withAlpha(colors.accent, 0.3)}`);
  expect(style).toContain('--line-highlight: rgba(255,255,255,0.02)');
  // Light and dark modes both use the palette accent for selection.
  const lightStyle = themeVarsStyle(resolvePalette('rimuru', []).light, 'light');
  expect(lightStyle).toContain('color-scheme: light');
  expect(lightStyle).toContain(`--selection: ${withAlpha(resolvePalette('rimuru', []).light.accent, 0.3)}`);
});

test('every picker token is covered by a group exactly once', () => {
  const grouped = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.token));
  expect([...grouped].sort()).toEqual([...TOKENS].sort());
  expect(new Set(grouped).size).toBe(grouped.length);
});

test('newCustomPalette clones base colors under a fresh custom id', () => {
  const base = resolvePalette('rimuru', []);
  const custom = newCustomPalette(base);
  expect(custom.id.startsWith('custom_')).toBe(true);
  expect(custom.name).toBe('');
  expect(custom.dark).toEqual(base.dark);
  expect(custom.dark).not.toBe(base.dark);
  expect(custom.light).not.toBe(base.light);
});
