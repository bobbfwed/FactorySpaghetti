// "Moving Teleporter portals": on by default, off by default with reduced motion, and the player's
// choice (remembered on the device) wins over the device default. Storage that fails never throws.

import { afterEach, describe, it, expect, vi } from 'vitest';

function memory(init: Record<string, string> = {}): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k: string): string | null => data[k] ?? null, setItem: (k: string, v: string): void => { data[k] = v; } };
}
const broken = { getItem(): string | null { throw new Error('blocked'); }, setItem(): void { throw new Error('blocked'); } };

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('the moving-portals preference', () => {
  it('defaults to on, or off when the device asks for reduced motion', async () => {
    const { defaultPortalMotion, loadPortalMotion } = await import('../portalPref');
    expect(defaultPortalMotion(false)).toBe(true);
    expect(defaultPortalMotion(true)).toBe(false);
    expect(loadPortalMotion(memory(), false)).toBe(true);
    expect(loadPortalMotion(memory(), true)).toBe(false);
    expect(loadPortalMotion(null, false)).toBe(true);
    expect(loadPortalMotion(broken, true)).toBe(false);
    expect(loadPortalMotion(memory({ 'fs.portals': 'maybe' }), false)).toBe(true);
  });

  it('remembers the player\'s choice under fs.portals, and the choice wins over the device default', async () => {
    const { PORTAL_MOTION_KEY, loadPortalMotion, savePortalMotion } = await import('../portalPref');
    const m = memory();
    savePortalMotion(m, false);
    expect(m.data[PORTAL_MOTION_KEY]).toBe('off');
    expect(loadPortalMotion(m, false)).toBe(false);
    savePortalMotion(m, true);
    expect(m.data[PORTAL_MOTION_KEY]).toBe('on');
    expect(loadPortalMotion(m, true)).toBe(true);
    expect(() => savePortalMotion(broken, true)).not.toThrow();
  });

  it('on this device: follows the stored choice or the device, and a flip takes effect at once for every listener', async () => {
    const store = memory();
    vi.stubGlobal('localStorage', store);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const pref = await import('../portalPref');
    expect(pref.movingPortals()).toBe(false); // reduced motion, no choice yet
    let heard = 0;
    const off = pref.onPortalMotionChange(() => { heard++; });
    pref.setMovingPortals(true);
    expect(pref.movingPortals()).toBe(true);
    expect(store.data['fs.portals']).toBe('on');
    expect(heard).toBe(1);
    off();
    pref.setMovingPortals(false);
    expect(heard).toBe(1);
    expect(pref.movingPortals()).toBe(false);
  });
});
