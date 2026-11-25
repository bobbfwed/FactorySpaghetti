// Files made before the draw step and reserved belt points (RULES_REVISION 2): a replay and a
// report recorded by the live game at that time (fixtures/), and the save and save link inside
// the report. Each must open with the "different rules" warning, never crash, and a replay must
// step through as far as this version's engine accepts it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MemoryHub } from '../../net/memory';
import { createMemoryHub } from '../../net/memory';
import { memoryStore } from '../../session/store';
import type { SaveEnvelope } from '../../session/save';
import { packLink, rulesFingerprint } from '../../session/save';
import { VirtualClock, pump, settled } from '../../online/__tests__/helpers';
import type { AppDeps } from '../controller';
import { AppController } from '../controller';
import type { Action } from '../../engine/actions';
import type { PlayerId } from '../../engine/state';
import { applyAction, createGame } from '../../engine';
import { chooseAction as greedy } from '../../bots/greedyBot';
import { SEAT_COLORS, activeSeat } from '../../session/room';
import { diceRngFromSeed, rollDice } from '../../session/dice';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const OLD_REPLAY = fixture('before-draw-step.fsreplay');
const OLD_REPORT = fixture('before-draw-step.fsreport');
const OLD_RULES = '6d2b5fa0';
/** With this seed, greedy bots open a second stack while the first still has pieces (so they draw). */
const SEED_WITH_DRAWS = 2;

/** A whole greedy 4-player game under this version's rules (host-style seeded dice). */
function greedyGame(seed: number): Action[] {
  let s = createGame(seed, 4);
  let dice = diceRngFromSeed(seed);
  const moves: Action[] = [];
  for (let n = 0; n < 6000 && !s.gameOver; n++) {
    const actor = (s.pendingFactoryOps[0]?.ownerId ?? activeSeat(s)) as PlayerId;
    let a = greedy(s, actor);
    if (a.type === 'ROLL_DICE') { const [rolls, next] = rollDice(dice, s.mineCount); dice = next; a = { type: 'ROLL_DICE', rolls }; }
    const res = applyAction(s, a);
    if (!res.ok) throw new Error(res.error.code);
    s = res.state;
    moves.push(a);
  }
  return moves;
}

interface World { hub: MemoryHub; clock: VirtualClock }

function world(): World {
  const clock = new VirtualClock();
  return { clock, hub: createMemoryHub({ scheduler: clock, maxMessageBytes: 16_299, chunkBytes: 15 * 1024 }) };
}

function device(w: World): AppController {
  const deps: AppDeps = {
    transport: () => w.hub.transport(),
    saves: memoryStore(),
    identity: memoryStore(),
    location: { search: '', hash: '', base: 'https://example.test/fs/', clearHash: (): void => undefined },
    appVersion: 'test',
    scheduler: w.clock,
    autoplayDelayMs: 0,
    online: { randomSeed: (): number => 77, retries: 4, retryMs: 500, rejoinDelayMs: 200, welcomeTimeoutMs: 5000 },
  };
  const ctrl = new AppController(deps);
  ctrl.setName('Tester');
  return ctrl;
}

describe('files made before the draw step', () => {
  it('were made with other rules than this version', () => {
    expect(rulesFingerprint()).not.toBe(OLD_RULES);
    expect((JSON.parse(OLD_REPLAY) as { rules: string }).rules).toBe(OLD_RULES);
    expect((JSON.parse(OLD_REPORT) as { rules: string }).rules).toBe(OLD_RULES);
  });

  it('a recorded replay opens with the warning and steps through every move this version accepts', async () => {
    const w = world();
    const ctrl = device(w);
    await settled(w, ctrl.openReplayText(OLD_REPLAY, 'file'));
    expect(ctrl.state.error).toBeNull();
    expect(ctrl.screen).toBe('replay');
    const rs = ctrl.state.replay!;
    expect(rs.status).toBe('ready');
    const c = rs.cursor!;
    expect(c.sameRules).toBe(false);
    // Stacks opened one at a time in this game, so no draw was ever needed. Its Mine credits
    // follow the old upgrade point (Mines + 1), so the replay stops at the first upgrade that
    // spends more credits than the Mine's printed number now gives (RULES_CHANGES.md #49).
    expect(c.refused).toMatchObject({ error: { code: 'INSUFFICIENT_CREDITS' } });
    expect(c.length).toBeGreaterThan(100);
    expect(c.length).toBeLessThan((JSON.parse(OLD_REPLAY) as { moves: unknown[] }).moves.length);
    for (let p = 0; p <= c.length; p += 7) { expect(c.stateAt(p).phase).toBeTruthy(); expect(c.lineAt(p)).toBeTruthy(); }
    ctrl.closeReplay();
    expect(ctrl.screen).toBe('menu');
  }, 30_000);

  it('a replay of a game with several open stacks, recorded without draws, stops at the first move that needed one', async () => {
    // As an older build would have recorded this game: the same moves without DRAW_PIECE.
    const all = greedyGame(SEED_WITH_DRAWS);
    const firstDraw = all.findIndex(m => m.type === 'DRAW_PIECE');
    expect(firstDraw).toBeGreaterThan(0);
    const old = {
      ...(JSON.parse(OLD_REPLAY) as Record<string, unknown>),
      code: 'OLDRL', start: { seed: SEED_WITH_DRAWS, playerCount: 4 },
      players: ['Tester', 'Smart Bot', 'Smart Bot 2', 'Smart Bot 3'].map((name, seat) => ({
        seat, name, color: SEAT_COLORS[seat], bot: seat === 0 ? null : 'greedy',
      })),
      moves: all.filter(m => m.type !== 'DRAW_PIECE'),
    };
    const w = world();
    const ctrl = device(w);
    await settled(w, ctrl.openReplayText(JSON.stringify(old), 'file'));
    expect(ctrl.state.error).toBeNull();
    const c = ctrl.state.replay!.cursor!;
    expect(c.sameRules).toBe(false);
    expect(c.length).toBe(firstDraw);
    expect(c.refused).toMatchObject({ seq: firstDraw + 1, action: all[firstDraw + 1], error: { code: 'MUST_DRAW' } });
    expect(c.stateAt(c.length)).toBeTruthy();
    expect(c.lineAt(c.length)).toBeTruthy();
  }, 30_000);

  it('a report opens in the viewer with the warning', async () => {
    const w = world();
    const ctrl = device(w);
    await settled(w, ctrl.openReplayText(OLD_REPORT, 'paste'));
    expect(ctrl.state.error).toBeNull();
    expect(ctrl.screen).toBe('replay');
    const rs = ctrl.state.replay!;
    expect(rs.status).toBe('ready');
    expect(rs.kind).toBe('report');
    expect(rs.cursor!.sameRules).toBe(false);
    expect(rs.cursor!.stateAt(rs.cursor!.length).phase).toBeTruthy();
  }, 30_000);

  for (const how of ['file', 'link'] as const) {
    it(`a save (${how}) opens with the warning, and the game resumes and goes on under this version's rules`, async () => {
      const w = world();
      const ctrl = device(w);
      const save = (JSON.parse(OLD_REPORT) as { room: SaveEnvelope }).room;
      expect(save.rules).toBe(OLD_RULES);
      expect(save.room.game).not.toHaveProperty('drawnStackIndex'); // the old shape
      const text = how === 'file' ? JSON.stringify(save) : `https://example.test/fs/#save=${await packLink(save)}`;
      // Unpacking a link uses the platform's compression streams, not the test clock, so it is
      // awaited directly: pumping the virtual clock gives up when the platform is slower (CI).
      await ctrl.loadSaveText(text, how);
      expect(ctrl.state.error).toBeNull();
      expect(ctrl.screen).toBe('resume-setup');
      expect(ctrl.state.resume!.sameRules).toBe(false);

      // One player and bots: it resumes on this device and plays on.
      ctrl.chooseResumeSeat(0);
      await settled(w, ctrl.hostResume());
      await pump(w.hub, w.clock, () => ctrl.screen === 'lobby' && !!ctrl.room?.hold);
      expect(await settled(w, ctrl.continueGame())).toBe(true);
      await pump(w.hub, w.clock, () => ctrl.screen === 'game');
      const from = ctrl.room!.seq;
      ctrl.toggleAutoplay();
      await pump(w.hub, w.clock, () => ctrl.room!.seq >= from + 150 || !!ctrl.room!.game!.gameOver);
      if (ctrl.state.autoplay) ctrl.toggleAutoplay();
      expect(ctrl.state.error).toBeNull();
      expect(ctrl.room!.seq).toBeGreaterThan(from);
      ctrl.leave();
    }, 60_000);
  }
});
