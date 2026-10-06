import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BUILTIN_PALETTES, DEFAULT_PALETTE_ID, isHexColor, lighten, resolvePalette, themeVarsStyle, withAlpha } from '../src/lib/themes';
import type { ThemeColors, ThemePalette } from '../src/lib/types';

const TOKENS: (keyof ThemeColors)[] = [
  'bg_main', 'bg_sidebar', 'bg_card', 'bg_hover', 'bg_active', 'border',
  'text_main', 'text_muted', 'text_dim', 'accent', 'accent_light',
  'accent_contrast', 'success', 'danger',
];

test('Liquid Glass is the only available and default theme', () => {
  expect(BUILTIN_PALETTES.map((p) => [p.id, p.name])).toEqual([['liquid-glass', 'Liquid Glass']]);
  expect(DEFAULT_PALETTE_ID).toBe('liquid-glass');
  for (const palette of BUILTIN_PALETTES) {
    for (const mode of ['dark', 'light'] as const) {
      expect(Object.keys(palette[mode]).sort()).toEqual([...TOKENS].sort());
      for (const token of TOKENS) expect(isHexColor(palette[mode][token])).toBe(true);
    }
  }
});

test('former and custom themes resolve to Liquid Glass without changing archived data', () => {
  const custom: ThemePalette = { ...resolvePalette('liquid-glass'), id: 'custom_x', name: 'Archived' };
  const archive = [custom];
  const before = JSON.stringify(archive);
  for (const id of ['apple', 'apple-glass', 'lowbloat', 'megumin', 'rimuru', 'custom_x', 'unknown', '']) {
    expect(resolvePalette(id, archive).id).toBe('liquid-glass');
  }
  expect(resolvePalette('liquid-glass', archive).id).toBe('liquid-glass');
  expect(JSON.stringify(archive)).toBe(before);
});

test('pre-JS colors match Liquid Glass in both appearances', () => {
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  const blocks = {
    light: css.match(/:root\s*\{([^}]+)\}/)?.[1],
    dark: css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1],
  };
  for (const mode of ['light', 'dark'] as const) {
    expect(blocks[mode]).toContain(`color-scheme: ${mode}`);
    for (const token of TOKENS) {
      expect(blocks[mode]).toContain(`--${token.replaceAll('_', '-')}: ${resolvePalette('liquid-glass')[mode][token]}`);
    }
  }
});

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

test('Liquid Glass retains readable main and secondary text in light and dark', () => {
  for (const palette of BUILTIN_PALETTES) {
    for (const mode of ['light', 'dark'] as const) {
      const colors = palette[mode];
      for (const surface of [colors.bg_main, colors.bg_sidebar, colors.bg_card]) {
        expect(contrast(colors.text_main, surface)).toBeGreaterThanOrEqual(7);
        expect(contrast(colors.text_muted, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

test('scoped previews use each palette accent for links and subtle selection', () => {
  for (const palette of BUILTIN_PALETTES) {
    for (const mode of ['dark', 'light'] as const) {
      const colors = palette[mode];
      const style = themeVarsStyle(colors, mode);
      expect(style).toContain(`color-scheme: ${mode}`);
      expect(style).toContain(`--accent-glow: ${withAlpha(colors.accent, .12)}`);
      expect(style).toContain(`--selection: ${withAlpha(colors.accent, .18)}`);
      expect(style).toContain(`--editor-link: ${colors.accent}`);
      expect(style).toContain(`--editor-link-hover: ${colors.accent_light}`);
    }
  }
});

test('color utilities accept only six-digit hex and compute colors', () => {
  expect(isHexColor('#ABCDEF')).toBe(true);
  for (const invalid of ['#fff', 'ffffff', '#gggggg', '']) expect(isHexColor(invalid)).toBe(false);
  expect(withAlpha('#0066cc', .12)).toBe('rgba(0, 102, 204, 0.12)');
  expect(lighten('#000000', .5)).toBe('#808080');
});
