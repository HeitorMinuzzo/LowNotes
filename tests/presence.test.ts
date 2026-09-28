import { expect, test } from 'bun:test';
import { colorForDevice, parsePresenceState } from '../src/lib/presence';

test('colorForDevice é determinístico e distinto por dispositivo', () => {
  const a = colorForDevice('device-a');
  const b = colorForDevice('device-b');
  expect(a).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
  expect(colorForDevice('device-a')).toBe(a);
  expect(a).not.toBe(b);
});

test('parsePresenceState valida payloads', () => {
  const user = { name: 'PC', color: 'hsl(1, 70%, 55%)', deviceId: 'x', notePath: 'a.md' };
  expect(parsePresenceState({ user })?.user?.name).toBe('PC');
  expect(parsePresenceState(null)).toBeNull();
  expect(parsePresenceState('nope')).toBeNull();
  expect(parsePresenceState({})?.user).toBeUndefined();
});
