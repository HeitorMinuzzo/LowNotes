import { expect, spyOn, test } from 'bun:test';
import { installAppZoom } from '../src/lib/app-zoom';

function zoomWindow(stored?: string) {
  const values = new Map<string, string>();
  if (stored !== undefined) values.set('lownotes:app-zoom', stored);
  return Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  }) as unknown as Window;
}

function keyboard(target: Window, key: string, extra: Partial<KeyboardEvent> = {}) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    key, code: '', ctrlKey: true, metaKey: false, altKey: false, isComposing: false, ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

function wheel(target: Window, deltaY: number, extra: Partial<WheelEvent> = {}) {
  const event = Object.assign(new Event('wheel', { cancelable: true }), {
    deltaY, ctrlKey: true, altKey: false, ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

test('zoom accepts +, =, numeric keypad, minus and reset shortcuts', async () => {
  const target = zoomWindow();
  const applied: number[] = [];
  const stop = installAppZoom(target, async (factor) => { applied.push(factor); });
  try {
    expect(keyboard(target, '+').defaultPrevented).toBe(true);
    keyboard(target, '=');
    keyboard(target, 'Add', { code: 'NumpadAdd' });
    keyboard(target, '-');
    keyboard(target, 'Subtract', { code: 'NumpadSubtract' });
    keyboard(target, '0');
    await Bun.sleep(0);
    expect(applied).toEqual([1, 1.1, 1.2, 1.3, 1.2, 1.1, 1]);
  } finally { stop(); }
});

test('Ctrl+wheel zooms in both directions and leaves ordinary scrolling alone', async () => {
  const target = zoomWindow();
  const applied: number[] = [];
  const stop = installAppZoom(target, async (factor) => { applied.push(factor); });
  try {
    expect(wheel(target, -100).defaultPrevented).toBe(true);
    expect(wheel(target, 100).defaultPrevented).toBe(true);
    expect(wheel(target, -100, { ctrlKey: false }).defaultPrevented).toBe(false);
    expect(wheel(target, 0).defaultPrevented).toBe(false);
    expect(keyboard(target, '+', { ctrlKey: false }).defaultPrevented).toBe(false);
    expect(keyboard(target, '+', { altKey: true }).defaultPrevented).toBe(false);
    expect(keyboard(target, '+', { isComposing: true }).defaultPrevented).toBe(false);
    await Bun.sleep(0);
    expect(applied).toEqual([1, 1.1, 1]);
  } finally { stop(); }
});

test('zoom restores the local preference, clamps its range and removes listeners', async () => {
  const target = zoomWindow('1.8');
  const applied: number[] = [];
  const stop = installAppZoom(target, async (factor) => { applied.push(factor); });
  for (let i = 0; i < 20; i++) keyboard(target, '+');
  await Bun.sleep(0);
  expect(applied).toEqual([1.8, 1.9, 2]);
  expect(target.localStorage.getItem('lownotes:app-zoom')).toBe('2');
  for (let i = 0; i < 20; i++) keyboard(target, '-');
  await Bun.sleep(0);
  expect(applied.at(-1)).toBe(0.5);
  stop();
  expect(keyboard(target, '+').defaultPrevented).toBe(false);
  expect(wheel(target, -100).defaultPrevented).toBe(false);
  await Bun.sleep(0);
  expect(applied.at(-1)).toBe(0.5);
});

test('zoom serializes native calls and persists only the applied factor', async () => {
  const target = zoomWindow();
  const applied: number[] = [];
  let finish: (() => void) | undefined;
  const stop = installAppZoom(target, (factor) => {
    applied.push(factor);
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  try {
    keyboard(target, '+');
    keyboard(target, '+');
    await Bun.sleep(0);
    expect(applied).toEqual([1]);
    expect(target.localStorage.getItem('lownotes:app-zoom')).toBeNull();
    finish?.();
    await Bun.sleep(0);
    expect(applied).toEqual([1, 1.1]);
    expect(target.localStorage.getItem('lownotes:app-zoom')).toBe('1');
    finish?.();
    await Bun.sleep(0);
    expect(applied).toEqual([1, 1.1, 1.2]);
    finish?.();
    await Bun.sleep(0);
    expect(target.localStorage.getItem('lownotes:app-zoom')).toBe('1.2');
  } finally { stop(); }
});

test('invalid stored zoom and failed native calls do not break subsequent shortcuts', async () => {
  const target = zoomWindow('NaN');
  const applied: number[] = [];
  const log = spyOn(console, 'error').mockImplementation(() => {});
  const stop = installAppZoom(target, async (factor) => {
    applied.push(factor);
    if (applied.length === 2) throw new Error('unavailable');
  });
  try {
    await Bun.sleep(0);
    keyboard(target, '+');
    await Bun.sleep(0);
    expect(target.localStorage.getItem('lownotes:app-zoom')).toBe('1');
    keyboard(target, '+', { ctrlKey: false, metaKey: true });
    await Bun.sleep(0);
    expect(applied).toEqual([1, 1.1, 1.1]);
    expect(target.localStorage.getItem('lownotes:app-zoom')).toBe('1.1');
  } finally { stop(); log.mockRestore(); }
});
