// The drawing side of an animated example (playMount.ts DomStage), on a fake document and a fake
// view of the shared renderer: its flying tokens when two examples take turns with the one view.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GameState, PlayerId } from '../../../engine/state';
import { planTransition } from '../../../table/transition';
import { CLAIM_PLAY, ROLL_PLAY } from '../content/plays';
import { FigureCache, type FigureRenderer, type PlayView } from '../figures/jobs';
import { buildTimeline, stepTiming, type Timeline } from '../figures/play';
import type { PlayExample } from '../figures/types';
import { FakeEl, installFakeDom } from './fakeDom';

let uninstall: () => void = () => undefined;
// playMount.ts touches the document only when a stage is made: load it after the fake is in place.
let DomStage: typeof import('../figures/playMount').DomStage;
beforeAll(async () => {
  uninstall = installFakeDom();
  ({ DomStage } = await import('../figures/playMount'));
});
afterAll(() => uninstall());

function sharedCache(): FigureCache {
  const view: PlayView = { alive: true, ratio: 1, use: vi.fn(), show: vi.fn(), animate: vi.fn(), draw: vi.fn(() => false), where: vi.fn(() => ({ x: 0.5, y: 0.5 })) };
  const r: FigureRenderer = { render: async () => null, stage: async () => view, dispose: () => undefined };
  return new FigureCache(async () => r, { setTimer: () => 0, clearTimer: () => undefined });
}

type Stage = InstanceType<typeof DomStage>;
function makeStage(ex: PlayExample, cache: FigureCache): Stage {
  const fig = new FakeEl('figure');
  const pic = new FakeEl('div');
  const side = new FakeEl('div');
  fig.append(pic, side);
  return new DomStage(ex, buildTimeline(ex), pic as unknown as HTMLElement, side as unknown as HTMLElement, cache);
}
const flightsOf = (s: Stage): number => (s as unknown as { flights: unknown[] }).flights.length;

describe('the example stage', () => {
  it('an example coming back to the shared view does not fly its tokens twice', async () => {
    const cache = sharedCache();
    const a = makeStage(ROLL_PLAY, cache), b = makeStage(ROLL_PLAY, cache);
    const tl = buildTimeline(ROLL_PLAY);
    // A step whose move flies Power Tokens or materials to a player.
    const i = tl.steps.findIndex(s => s.moves.some(m => m.plan.steps.some(x => x.kind === 'toPlayer' && x.item !== 'card')));
    expect(i).toBeGreaterThanOrEqual(0);
    const seg = stepTiming(tl.steps[i]!, 1, !!ROLL_PLAY.side?.tray).segments.find(sg => tl.steps[i]!.moves[sg.move]!.plan.steps.some(x => x.kind === 'toPlayer'))!;
    const t = seg.at + seg.lead + 5;
    expect(await a.prepare()).toBe(true);
    expect(await b.prepare()).toBe(true);
    a.begin(i, 1);
    a.tick(i, t);
    const n = flightsOf(a);
    expect(n).toBeGreaterThan(0);
    // A scrolls away (paused); B takes the shared view.
    b.begin(0, 1);
    b.tick(0, 5);
    // A comes back and carries on.
    a.tick(i, t + 10);
    expect(flightsOf(a)).toBe(n);
    a.dispose();
    b.dispose();
  });

  it('an upgrade sends home the module it replaced, matched by owner and number', async () => {
    // The guide's upgrade (Power Plant 4 -> 5), restaged with two of Blue's modules on the Power
    // Plant in an order that changes: 4 and 6 before, 6 and 7 after. Module 4 must fly home, not 6.
    const tl0 = buildTimeline(CLAIM_PLAY);
    const i = tl0.steps.findIndex(s => s.moves.some(m => m.action.type === 'UPGRADE_BUILDING'));
    const step = tl0.steps[i]!;
    const m0 = step.moves[0]!;
    const withClaims = (g: GameState, mods: number[]): GameState => ({
      ...g, board: g.board.map(p => (p.id === 'pp' ? { ...p, claims: mods.map(n => ({ ownerId: 0 as PlayerId, controlModule: n })) } : p)),
    });
    const before = withClaims(m0.before, [4, 6]), after = withClaims(m0.after, [6, 7]);
    const move = { ...m0, before, after, plan: planTransition(before, after, []) };
    const tl: Timeline = { ...tl0, steps: tl0.steps.map((s, j) => (j === i ? { ...s, from: before, after, moves: [move] } : s)) };
    const fig = new FakeEl('figure'), pic = new FakeEl('div'), side = new FakeEl('div');
    fig.append(pic, side);
    const stage = new DomStage(CLAIM_PLAY, tl, pic as unknown as HTMLElement, side as unknown as HTMLElement, sharedCache());
    expect(await stage.prepare()).toBe(true);
    const seg = stepTiming(tl.steps[i]!, 1, true).segments[0]!;
    stage.begin(i, 1);
    stage.tick(i, seg.at + seg.lead + 1);
    const flying = fig.querySelectorAll('.g-flymod').map(e => e.querySelector('.n')?.textContent);
    expect(flying).toEqual(['4']);
    stage.dispose();
  });
});
