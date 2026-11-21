// The double-tap guard: a control that just changed under the finger does not take the press.

import { describe, it, expect } from 'vitest';
import { PRESS_WINDOW_MS, allowPress, observe } from '../pressGuard';

const loose = { strict: false, stateChangedAt: -1e9 };

describe('press guard', () => {
  it('keeps the record while the key is unchanged and restarts it when the key changes', () => {
    const a = observe(undefined, 'primary:Roll 1 die', 100);
    expect(observe(a, 'primary:Roll 1 die', 900)).toBe(a);
    expect(observe(a, 'primary:Done with actions', 900)).toEqual({ key: 'primary:Done with actions', since: 900 });
  });

  it('ignores a press on a control whose key changed less than the window ago', () => {
    // Roll pressed at 1000; the button becomes "Done with actions" at 1100; second tap at 1150.
    const seen = observe(observe(undefined, 'primary:Roll', 0), 'primary:Done with actions', 1100);
    expect(allowPress(seen, 'primary:Done with actions', 1150, loose)).toBe(false);
    expect(allowPress(seen, 'primary:Done with actions', 1100 + PRESS_WINDOW_MS, loose)).toBe(true);
  });

  it('allows the same unchanged control twice in quick succession (buying two belts)', () => {
    const seen = observe(undefined, 'bank:buyBelt', 0);
    expect(allowPress(seen, 'bank:buyBelt', 2000, loose)).toBe(true);
    // The belt was bought (state advanced) but the bank is not strict: still allowed.
    expect(allowPress(seen, 'bank:buyBelt', 2100, { strict: false, stateChangedAt: 2080 })).toBe(true);
  });

  it('strict controls also wait out a change of the displayed state', () => {
    const seen = observe(undefined, 'confirm:place', 0);
    expect(allowPress(seen, 'confirm:place', 5000, { strict: true, stateChangedAt: 4900 })).toBe(false);
    expect(allowPress(seen, 'confirm:place', 5000, { strict: true, stateChangedAt: 5000 - PRESS_WINDOW_MS })).toBe(true);
  });

  it('a prompt sliding into the place of the one just answered does not take the second tap', () => {
    const first = observe(undefined, 'op:s0-plateFact-1:run', 0);
    const second = observe(first, 'op:s0-plateFact-4:run', 3000);
    expect(allowPress(second, 'op:s0-plateFact-4:run', 3100, { strict: true, stateChangedAt: 0 })).toBe(false);
  });

  it('a press on a control never observed, or showing another key than observed, is ignored', () => {
    expect(allowPress(undefined, 'x', 1000, loose)).toBe(false);
    expect(allowPress(observe(undefined, 'a', 0), 'b', 1000, loose)).toBe(false);
  });
});
