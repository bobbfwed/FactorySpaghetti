// The playback queue: order, the lag cap (compression, then skipping), skip, snap rules.

import { describe, it, expect } from 'vitest';
import {
  LAG_CAP_MS, MAX_EXPLAINED_JUMP, MIN_COMPRESS, Playback, URGENT_CAP_MS, snapReason,
  type PlayCommand, type PlayItem,
} from '../playback';

const item = (seq: number, baseMs = 500): PlayItem<string> => ({ seq, data: `s${seq}`, baseMs });

/** Run the queue on a simulated clock until drained; returns the commands in order and the end time. */
function drain(q: Playback<string>, now: number, cmds: PlayCommand<string>[] = []): { cmds: PlayCommand<string>[]; t: number } {
  let t = now;
  for (let guard = 0; guard < 1000 && !q.drained; guard++) {
    t = q.nextAt() ?? t;
    cmds.push(...q.tick(t));
  }
  return { cmds, t };
}

describe('Playback queue', () => {
  it('snaps the first state and plays later ones in order at full length', () => {
    const q = new Playback<string>();
    expect(q.push(item(1), 0)).toEqual([{ kind: 'snap', item: item(1) }]);
    expect(q.drained).toBe(true);
    const c1 = q.push(item(2, 400), 100);
    expect(c1).toEqual([{ kind: 'play', item: item(2, 400), durMs: 400, scale: 1 }]);
    q.push(item(3, 300), 150);
    q.push(item(4, 200), 160);
    expect(q.drained).toBe(false);
    expect(q.shown?.seq).toBe(2);
    expect(q.newest?.seq).toBe(4);
    const { cmds, t } = drain(q, 160);
    expect(cmds.map(c => `${c.kind}:${c.item.seq}`)).toEqual(['play:3', 'play:4']);
    expect(t).toBe(100 + 400 + 300 + 200); // each starts when the one before ends
    expect(q.drained).toBe(true);
    expect(q.shown?.seq).toBe(4);
  });

  it('halves durations at Fast and snaps everything when off', () => {
    const q = new Playback<string>();
    q.setSpeed('fast');
    q.push(item(1), 0);
    expect(q.push(item(2, 600), 0)).toEqual([{ kind: 'play', item: item(2, 600), durMs: 300, scale: 0.5 }]);
    q.push(item(3, 600), 10);
    expect(q.setSpeed('off')).toEqual([{ kind: 'snap', item: item(3, 600) }]);
    expect(q.drained).toBe(true);
    expect(q.push(item(4, 600), 20)).toEqual([{ kind: 'snap', item: item(4, 600) }]);
  });

  it('compresses waiting transitions so the newest is shown within the cap', () => {
    const q = new Playback<string>();
    q.push(item(1), 0);
    // Six 600 ms transitions arrive together: 3,600 ms > 2,500 ms.
    const cmds: PlayCommand<string>[] = [];
    for (let s = 2; s <= 7; s++) cmds.push(...q.push(item(s, 600), 0));
    expect(q.lagMs(0)).toBeLessThanOrEqual(LAG_CAP_MS + 1);
    const { cmds: all, t } = drain(q, 0, cmds);
    expect(all.every(c => c.kind === 'play')).toBe(true);
    expect(all.map(c => c.item.seq)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(t).toBeLessThanOrEqual(LAG_CAP_MS + 1);
  });

  it('skips the oldest transitions of a long burst and never freezes for long', () => {
    const q = new Playback<string>();
    q.push(item(1), 0);
    const cmds: PlayCommand<string>[] = [];
    // A burst of 40 bot moves, 30 ms apart, each 600 ms long at Normal speed.
    let now = 0;
    for (let s = 2; s <= 41; s++) {
      now = (s - 2) * 30;
      // Let due transitions finish as time passes.
      for (let at = q.nextAt(); at !== null && at <= now; at = q.nextAt()) cmds.push(...q.tick(at));
      cmds.push(...q.push(item(s, 600), now));
    }
    const { cmds: all, t } = drain(q, now, cmds);
    expect(q.shown?.seq).toBe(41);
    // The last move is on screen within the cap of its arrival.
    expect(t - now).toBeLessThanOrEqual(LAG_CAP_MS + 1);
    // Older moves were skipped (snapped past), the newest ones still played, in order.
    expect(all.some(c => c.kind === 'snap')).toBe(true);
    const seqs = all.map(c => c.item.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const played = all.filter(c => c.kind === 'play') as Extract<PlayCommand<string>, { kind: 'play' }>[];
    expect(played.length).toBeGreaterThan(3);
    // Nothing is compressed below the floor except to fit the very last budget.
    for (const p of played.slice(0, -1)) expect(p.scale).toBeGreaterThanOrEqual(MIN_COMPRESS - 1e-9);
  });

  it('a transition with nothing to show is shown at once', () => {
    const q = new Playback<string>();
    q.push(item(1), 0);
    expect(q.push(item(2, 0), 5)).toEqual([{ kind: 'snap', item: item(2, 0) }]);
    expect(q.drained).toBe(true);
  });

  it('skip() jumps to the newest state', () => {
    const q = new Playback<string>();
    q.push(item(1), 0);
    q.push(item(2, 800), 0);
    q.push(item(3, 800), 10);
    expect(q.skip()).toEqual([{ kind: 'snap', item: item(3, 800) }]);
    expect(q.drained).toBe(true);
    expect(q.skip()).toEqual([]);
  });

  it('an urgent state (a prompt with a countdown) uses the tighter cap and cuts a long transition', () => {
    const q = new Playback<string>();
    q.push(item(1), 0);
    q.push(item(2, 1500), 0);                       // a roll, playing
    const cmds = q.push(item(3, 900), 100, { urgent: true });
    expect(cmds[0]).toEqual({ kind: 'snap', item: item(2, 1500) });
    const { t } = drain(q, 100, cmds);
    expect(t - 100).toBeLessThanOrEqual(URGENT_CAP_MS + 1);
  });

  it('a snap drops whatever is waiting', () => {
    const q = new Playback<string>();
    q.push(item(1), 0);
    q.push(item(2, 800), 0);
    q.push(item(3, 800), 0);
    expect(q.push(item(9, 800), 10, { snap: true })).toEqual([{ kind: 'snap', item: item(9, 800) }]);
    expect(q.drained).toBe(true);
    expect(q.shown?.seq).toBe(9);
  });
});

describe('snapReason', () => {
  const opts = { speed: 'normal' as const };
  const s = (seq: number, events = 1, game = 'g1'): { seq: number; game: string; events: number } => ({ seq, game, events });
  it('animates the next move of the same game', () => {
    expect(snapReason(s(4), s(5), opts)).toBeNull();
    expect(snapReason(s(4), s(4 + MAX_EXPLAINED_JUMP), opts)).toBeNull();
  });
  it('snaps on first load, resume, reconnect, another game, big or unexplained jumps, and when off', () => {
    expect(snapReason(null, s(5), opts)).toBe('first state');
    expect(snapReason(s(4), s(5), { speed: 'off' })).toBe('animation off');
    expect(snapReason(s(4), s(5), { ...opts, resync: true })).toBe('reconnected');
    expect(snapReason(s(4), s(5), { ...opts, hidden: true })).toBe('page hidden');
    expect(snapReason(s(4), s(5), { ...opts, tableReady: false })).toBe('table not ready');
    expect(snapReason(s(4), s(5, 1, 'g2'), opts)).toBe('another game');
    expect(snapReason(s(4), s(4), opts)).toBe('seq did not advance');
    expect(snapReason(s(9), s(4), opts)).toBe('seq did not advance');
    expect(snapReason(s(4), s(5 + MAX_EXPLAINED_JUMP), opts)).toBe('seq jumped too far');
    expect(snapReason(s(4), s(7, 0), opts)).toBe('seq jumped without events');
  });
});

describe('Playback queue, urgent states', () => {
  it('counts the tighter cap from the first urgent state, even while more moves keep arriving', () => {
    const q = new Playback<string>();
    q.push(item(1), 0);
    let all: PlayCommand<string>[] = [];
    // A prompt for me arrives at t=0 with a roll; the active player keeps moving every 300 ms.
    all = all.concat(q.push(item(2, 1500), 0, { urgent: true }));
    for (let s = 3; s <= 8; s++) {
      const now = (s - 2) * 300;
      for (let at = q.nextAt(); at !== null && at <= now; at = q.nextAt()) all = all.concat(q.tick(at));
      all = all.concat(q.push(item(s, 600), now, { urgent: true }));
      // From the first urgent arrival on, the picture is never more than the urgent cap behind.
      if (now >= URGENT_CAP_MS) expect(q.drained).toBe(true);
    }
  });
});
