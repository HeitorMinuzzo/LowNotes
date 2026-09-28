export interface PresenceUser {
  name: string;
  color: string;
  deviceId: string;
  notePath: string;
}

/** Deterministic, visually distinct color per device id (HSL golden-angle hue). */
export function colorForDevice(deviceId: string): string {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = (hash * 31 + deviceId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export function parsePresenceState(state: unknown): { user?: PresenceUser } | null {
  if (typeof state !== 'object' || state === null) return null;
  return state as { user?: PresenceUser };
}
