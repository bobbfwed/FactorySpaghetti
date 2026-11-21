// Feel settings: defaults, remembered per device, broken or missing storage never throws.

import { describe, it, expect } from 'vitest';
import { FEEL_KEY, defaultFeel, loadFeel, saveFeel } from '../feel';

function memory(init: Record<string, string> = {}): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k: string): string | null => data[k] ?? null, setItem: (k: string, v: string): void => { data[k] = v; } };
}

describe('feel settings', () => {
  it('defaults to Normal speed with sound and vibration, or Off for reduced motion', () => {
    expect(defaultFeel(false)).toEqual({ speed: 'normal', sound: true, vibrate: true });
    expect(defaultFeel(true).speed).toBe('off');
    expect(loadFeel(memory(), true).speed).toBe('off');
    expect(loadFeel(null, false)).toEqual(defaultFeel(false));
  });

  it('remembers the choice under fs.feel', () => {
    const m = memory();
    saveFeel(m, { speed: 'fast', sound: false, vibrate: true });
    expect(JSON.parse(m.data[FEEL_KEY]!)).toEqual({ speed: 'fast', sound: false, vibrate: true });
    // A saved choice wins over reduced motion.
    expect(loadFeel(m, true)).toEqual({ speed: 'fast', sound: false, vibrate: true });
  });

  it('ignores damaged values and storage that throws', () => {
    expect(loadFeel(memory({ [FEEL_KEY]: '{not json' }), false)).toEqual(defaultFeel(false));
    expect(loadFeel(memory({ [FEEL_KEY]: '{"speed":"warp","sound":"yes"}' }), false)).toEqual(defaultFeel(false));
    const broken = { getItem: (): string => { throw new Error('blocked'); }, setItem: (): void => { throw new Error('blocked'); } };
    expect(loadFeel(broken, false)).toEqual(defaultFeel(false));
    expect(() => saveFeel(broken, defaultFeel(false))).not.toThrow();
  });
});
