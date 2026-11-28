// The guide's animated examples: every example replays through the engine (each move a legal,
// listed move), its captions' numbers come from the engine, and the player behaves as the owner
// decided (starts by itself once in view, plays once, rests on the last step, Play again,
// Previous / Next, pauses out of view, one example at a time, stills without motion, nothing
// left running after it stops). The player is driven by a fake clock and a fake stage.

import { describe, it, expect, vi } from 'vitest';
import { FACTORY_POWER_COST, POWER_PLANT_MATERIAL_YIELD } from '../../../engine/config';
import { isListedMove } from '../../../engine/rules/legalActions';
import type { GameState, PlayerId } from '../../../engine/state';
import { GUIDE } from '../content';
import { CLAIM_PLAY, FIRST_CLAIMS_PLAY, PLACE_PLAY, ROLL_PLAY } from '../content/plays';
import { FigureCache, type FigureRenderer, type PlayView } from '../figures/jobs';
import { activeSeat, buildTimeline, playLayout, stepTiming, PlayError, type Timeline } from '../figures/play';
import { Coordinator, Player, type Clock, type Motion, type PlayStage, type PlayerUi } from '../figures/player';
import { renderFigure } from '../figures/render';
import type { FigureBlock, PlayExample } from '../figures/types';
import type { Block } from '../types';
import { textOf, walk, type VNode } from '../vdom';

const EXAMPLES: readonly PlayExample[] = [FIRST_CLAIMS_PLAY, PLACE_PLAY, ROLL_PLAY, CLAIM_PLAY];
const COLOR_WORD = { blue: 'Blue', red: 'Red', orange: 'Orange', green: 'Green' } as const;

function figuresIn(blocks: readonly Block[]): FigureBlock[] {
  return blocks.flatMap(b => (b.k === 'figure' ? [b] : b.k === 'details' ? figuresIn(b.blocks) : []));
}
const PLAYS = GUIDE.topics.flatMap(t => figuresIn(t.blocks).filter(f => f.show.kind === 'play').map(f => ({ topic: t.id, f })));

describe('the animated examples in the guide', () => {
  it('are each in the topic where their rule is explained', () => {
    const byTopic = new Map<string, string[]>();
    for (const p of PLAYS) byTopic.set(p.topic, [...(byTopic.get(p.topic) ?? []), (p.f.show as { play: PlayExample }).play.id].sort());
    expect(Object.fromEntries(byTopic)).toEqual({
      starting: ['first-claims'], turn: ['turn'], 'step-place': ['place-piece'], 'step-roll': ['roll'], 'step-actions': ['actions'],
      'step-meeple': ['meeple'], 'round-end': ['round-end'], claiming: ['claim-upgrade'], production: ['power-plants', 'production'],
      moving: ['moving'], belts: ['belt-chain', 'belt-rules'], teleporters: ['teleporter-in', 'teleporter-out'], bank: ['bank'],
      cards: ['asset-forfeiture', 'changing-priorities', 'short-sale', 'sink-hole'], mines: ['mine-drop'], bonuses: ['bonus'], winning: ['win'],
    });
  });

  it('replay through the engine: every move is accepted and is one the game would offer', () => {
    for (const ex of PLAYS.map(x => (x.f.show as { play: PlayExample }).play)) {
      const tl = buildTimeline(ex);
      expect(tl.steps).toHaveLength(ex.steps.length);
      for (const [i, s] of tl.steps.entries()) {
        for (const m of s.moves) {
          // A decision on another player's building is listed for that player.
          expect(isListedMove(m.before, m.seat as PlayerId, m.action), `${ex.id} step ${i + 1}: ${m.action.type}`).toBe(true);
        }
      }
    }
  });

  it('report a refused move as an error naming the step', () => {
    const bad: PlayExample = { ...ROLL_PLAY, steps: [{ caption: 'x', moves: [{ act: { type: 'ROLL_DICE', rolls: [3] } }] }] };
    expect(() => buildTimeline(bad)).toThrow(PlayError);
    expect(() => buildTimeline(bad)).toThrow(/roll step 1 move 1 \(ROLL_DICE\): WRONG_DICE_COUNT/);
  });

  it('have alt text, a caption, a one-sentence-or-so caption per step in the rulebook\'s words, and unique ids', () => {
    const ids = new Set<string>();
    for (const { topic, f } of PLAYS) {
      const ex = (f.show as { play: PlayExample }).play;
      expect(ids.has(ex.id)).toBe(false);
      ids.add(ex.id);
      expect(f.alt.length, topic).toBeGreaterThan(30);
      expect(f.caption?.length ?? 0, topic).toBeGreaterThan(20);
      for (const s of ex.steps) {
        expect(s.caption.length).toBeGreaterThan(20);
        expect(s.caption.length).toBeLessThan(260);
        // Interface text uses the rulebook's words, never the engine's names.
        expect(s.caption).not.toMatch(/SETUP_CLAIM|PLACE_PIECE|ROLL_DICE|OPERATE|plateFact|sphereFact|powerPlant|tesseractFact|freeActionCredits|pieceId|controlModule\b/);
      }
    }
  });

  it('render a picture box, the controls (hidden until the player runs) and every caption in a numbered list', () => {
    const node = renderFigure(PLAYS[0]!.f, s => [s]);
    const find = (pred: (n: VNode) => boolean): VNode[] => { const out: VNode[] = []; walk(node, n => { if (pred(n)) out.push(n); }); return out; };
    const has = (n: VNode, c: string): boolean => (n.attrs?.class ?? '').split(' ').includes(c);
    const [pic] = find(n => has(n, 'g-playpic'));
    expect(pic?.attrs?.role).toBe('img');
    expect(pic?.attrs?.['aria-label']).toBe(PLAYS[0]!.f.alt);
    expect(pic?.attrs?.style).toMatch(/aspect-ratio/);
    const steps = find(n => has(n, 'g-pstep'));
    expect(steps).toHaveLength(FIRST_CLAIMS_PLAY.steps.length);
    expect(textOf(steps[0]!)).toContain(FIRST_CLAIMS_PLAY.steps[0]!.caption);
    const buttons = find(n => n.tag === 'button');
    expect(buttons.map(b => b.attrs?.['aria-label'])).toEqual(['Play the example', 'Previous step', 'Next step']);
    expect(find(n => has(n, 'g-pbar'))[0]?.attrs?.hidden).toBe('');
    expect(find(n => n.attrs?.['aria-live'] === 'polite')).toHaveLength(1);
    // The example travels in the page as data and comes back whole.
    expect(JSON.parse(node.attrs!['data-play']!)).toEqual(FIRST_CLAIMS_PLAY);
  });

  it('frame the board, the glowing spaces and what stands beside it, and time every step', () => {
    for (const ex of PLAYS.map(x => (x.f.show as { play: PlayExample }).play)) {
      const tl = buildTimeline(ex);
      const l = playLayout(ex, tl);
      expect(l.bounds.maxX).toBeGreaterThan(l.bounds.minX);
      for (const k of ex.pile === true ? [0] : ex.pile || []) expect(l.side.stacks[k as 0 | 1 | 2].x).toBeLessThan(1e5);
      if (ex.dice) expect(l.side.dice.length).toBe(Math.max(...[tl.start, ...tl.steps.map(s => s.after)].map(s => s.mineCount)));
      for (const s of tl.steps) {
        const t = stepTiming(s, 1, !!ex.side?.tray);
        expect(t.total).toBeGreaterThan(0);
        expect(stepTiming(s, 0.5, !!ex.side?.tray).total).toBeCloseTo(t.total / 2, 0);
      }
    }
  });
});

// ── What the captions say, checked against the engine ──

const colorOf = (ex: PlayExample, seat: number): string => COLOR_WORD[(ex.colors ?? ['blue', 'red', 'orange', 'green'])[seat]!];
const claimsOf = (s: GameState, seat: number): string[] => s.board.flatMap(p => p.claims.filter(c => c.ownerId === seat).map(c => `${p.id}:${c.controlModule}`));

describe('Your first claims', () => {
  const tl = buildTimeline(FIRST_CLAIMS_PLAY);
  it('follows the setup order: Plate Factories in turn order from the starting player, then Power Plants in reverse', () => {
    const order = tl.start.turnOrder;
    const expected = [...order, ...[...order].reverse()];
    tl.steps.forEach((s, i) => {
      const seat = s.moves[0]!.seat;
      expect(seat).toBe(expected[i]);
      // The caption names the player (in bold) and the module the engine put down.
      expect(s.caption).toContain(`**${colorOf(FIRST_CLAIMS_PLAY, seat)}**`);
      const module = i < order.length ? 3 : 2;
      expect(s.caption).toContain(`Control Module ${module}`);
      const piece = s.after.board.find(p => p.id === (s.moves[0]!.action as { pieceId: string }).pieceId)!;
      expect(piece.type).toBe(i < order.length ? 'plateFact' : 'powerPlant');
      expect(piece.claims).toEqual([{ ownerId: seat, controlModule: module }]);
    });
    expect(tl.steps[0]!.caption).toMatch(/starting player/);
    expect(tl.steps[tl.steps.length - 1]!.after.phase).toBe('placePiece');
  });
  it('builds the order up as numbered markers on the claimed buildings', () => {
    expect(tl.steps[tl.steps.length - 1]!.marks.map(m => m.mark)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

describe('Place a piece', () => {
  const tl = buildTimeline(PLACE_PLAY);
  it('turns the top piece of stack 1 over and lights every free space touching the board', () => {
    const s = tl.steps[0]!;
    expect(s.after.phase).toBe('placePiece');
    const top = s.after.stacks[0].pieces[0]!;
    expect(s.caption).toContain('Sphere Factory');
    expect(top.type).toBe('sphereFact');
    const cells = s.glow.filter(t => t.kind === 'cell');
    expect(cells.length).toBeGreaterThan(8);
    expect(s.caption).toContain(`**${colorOf(PLACE_PLAY, activeSeat(s.after))}**`);
  });
  it('places it on one of them, and the next player\'s piece elsewhere', () => {
    const placed = tl.steps[1]!.after.board.find(p => p.id === tl.steps[0]!.after.stacks[0].pieces[0]!.id);
    expect(placed).toBeTruthy();
    expect(tl.steps[0]!.glow).toContainEqual({ kind: 'cell', q: placed!.coord.q, r: placed!.coord.r });
    expect(tl.steps[2]!.caption).toContain('Plate Factory');
    expect(tl.steps[2]!.after.stacks[0].pieces[0]!.type).toBe('plateFact');
    const second = tl.steps[3]!.after.board.find(p => p.id === tl.steps[2]!.after.stacks[0].pieces[0]!.id)!;
    expect(tl.steps[2]!.glow).toContainEqual({ kind: 'cell', q: second.coord.q, r: second.coord.r });
    expect(second.coord).not.toEqual(placed!.coord);
  });
});

describe('Roll the dice', () => {
  const tl = buildTimeline(ROLL_PLAY);
  const [roll1, run1, roll2, run2] = tl.steps;
  it('rolls one die per Mine and activates exactly the buildings whose Control Module equals the total', () => {
    for (const s of [roll1!, roll2!]) {
      const e = s.events.find(x => x.kind === 'roll') as { dice: number[]; total: number };
      expect(e.dice).toHaveLength(s.from.mineCount);
      expect(s.caption).toContain(`**${e.total}**`);
      expect(s.caption).toContain(`${e.dice[0]} and ${e.dice[1]}`);
      const matching = s.from.board.filter(p => p.claims.some(c => c.controlModule === e.total)).map(p => p.id).sort();
      const activated = s.events.filter(x => x.kind === 'activated').map(x => (x as { pieceId: string }).pieceId).sort();
      expect(activated).toEqual(matching);
    }
  });
  it('gives the Power Tokens, costs and products the engine does', () => {
    const pp = roll1!.events.find(e => e.kind === 'activated' && e.building === 'powerPlant') as { amount: number; seat: number };
    expect(pp.amount).toBe(POWER_PLANT_MATERIAL_YIELD.ore);
    expect(roll1!.caption).toContain(`gives Red ${pp.amount} Power Tokens`);
    const op1 = run1!.events.find(e => e.kind === 'operated') as { powerChange: number; product: string };
    expect(-op1.powerChange).toBe(FACTORY_POWER_COST.plate);
    expect(op1.product).toBe('plate');
    expect(run1!.caption).toContain(`${FACTORY_POWER_COST.plate} Power Token`);
    const op2 = run2!.events.find(e => e.kind === 'operated') as { powerChange: number; product: string };
    expect(-op2.powerChange).toBe(FACTORY_POWER_COST.sphere);
    expect(op2.product).toBe('sphere');
    expect(run2!.caption).toContain(`${FACTORY_POWER_COST.sphere} Power Tokens`);
  });
  it('names the buildings that do nothing by their numbers', () => {
    const others = roll1!.from.board.filter(p => p.claims.length && !p.claims.some(c => c.controlModule === 7));
    for (const p of others) expect(run1!.caption).toContain(`(${p.claims[0]!.controlModule})`);
  });
});

describe('Claiming and upgrading', () => {
  const tl = buildTimeline(CLAIM_PLAY);
  const me = 0;
  const pl = (s: GameState): GameState['players'][number] => s.players[me]!;
  it('gets its upgrades legally: the meeple on a Mine\'s upgrade point ends the round', () => {
    for (const i of [0, 3]) {
      const s = tl.steps[i]!;
      expect(s.after.phase).toBe('roundEnd');
      expect(activeSeat(s.after)).toBe(me);
      expect(s.caption).toContain(`${pl(s.after).freeActionCredits} Mine credits`);
      expect(s.caption).toContain(`${pl(s.after).freeUpgradesRemaining} free upgrade`);
      expect(pl(s.after).freeUpgradesRemaining).toBe(s.after.mineCount);
    }
  });
  it('claims at M - Mines + 1 and upgrades at the difference, as the captions say', () => {
    for (const i of [1, 4]) {
      const s = tl.steps[i]!;
      const a = s.moves[0]!.action as { controlModule: number };
      const cost = a.controlModule - s.from.mineCount + 1;
      expect(pl(s.from).freeActionCredits - pl(s.after).freeActionCredits).toBe(cost);
      expect(s.caption).toContain(`${a.controlModule} − ${s.from.mineCount} Mine${s.from.mineCount === 1 ? '' : 's'} + 1 = **${cost}**`);
    }
    for (const i of [2, 5]) {
      const s = tl.steps[i]!;
      const a = s.moves[0]!.action as { oldModule: number; newModule: number };
      expect(pl(s.from).freeUpgradesRemaining - pl(s.after).freeUpgradesRemaining).toBe(a.newModule - a.oldModule);
      expect(s.caption).toContain(`from ${a.oldModule} to ${a.newModule}`);
      expect(s.caption).toContain(`**${a.newModule - a.oldModule}**`);
      // The old module goes back to the tray.
      expect(pl(s.after).controlModules).toContain(a.oldModule);
      expect(claimsOf(s.after, me)).not.toContain(`${(s.moves[0]!.action as { pieceId: string }).pieceId}:${a.oldModule}`);
    }
  });
  it('shows Control Module 1 below the claim floor once two Mines are in play', () => {
    const s = tl.steps[3]!;
    expect(s.after.mineCount).toBe(2);
    expect(pl(s.after).controlModules).toContain(1);
    expect(s.caption).toMatch(/Control Module 1 is greyed/);
  });
});

// ── The player ──

class FakeClock implements Clock {
  t = 0;
  private frames = new Map<number, (t: number) => void>();
  private timers = new Map<number, { at: number; fn: () => void }>();
  private id = 0;
  now(): number { return this.t; }
  frame(fn: (t: number) => void): unknown { const i = ++this.id; this.frames.set(i, fn); return i; }
  cancelFrame(h: unknown): void { this.frames.delete(h as number); }
  later(fn: () => void, ms: number): unknown { const i = ++this.id; this.timers.set(i, { at: this.t + ms, fn }); return i; }
  cancel(h: unknown): void { this.timers.delete(h as number); }
  get pending(): number { return this.frames.size + this.timers.size; }
  get framesPending(): number { return this.frames.size; }
  /** Let `ms` pass in 16 ms frames, firing timers on time. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 16);
      for (const [i, x] of [...this.timers]) if (x.at <= this.t) { this.timers.delete(i); x.fn(); }
      const fs = [...this.frames];
      this.frames.clear();
      for (const [, fn] of fs) fn(this.t);
      await Promise.resolve();
    }
  }
}

function fakeStage(ok = true): PlayStage & { calls: string[]; held: boolean } {
  const s = {
    calls: [] as string[], held: false,
    prepare: async (): Promise<boolean> => ok,
    rest: (i: number): void => { s.calls.push(`rest ${i}`); },
    begin: (i: number): void => { s.calls.push(`begin ${i}`); },
    tick: (): void => undefined,
    running: (on: boolean): void => { s.held = on; s.calls.push(on ? 'hold' : 'unhold'); },
  };
  return s;
}

const STEP_MS = 1000;
type FakeStage = ReturnType<typeof fakeStage>;
function makePlayer(opts: { motion?: Motion; count?: number; coord?: Coordinator; clock?: FakeClock; stage?: FakeStage } = {}): { p: Player; clock: FakeClock; stage: FakeStage; uis: PlayerUi[] } {
  const clock = opts.clock ?? new FakeClock();
  const stage = opts.stage ?? fakeStage();
  const uis: PlayerUi[] = [];
  const p = new Player({
    count: opts.count ?? 3, duration: (_i: number, k: number): number => STEP_MS * k, stage, clock, motion: opts.motion ?? 'normal',
    coordinator: opts.coord ?? new Coordinator(), onUi: (u: PlayerUi): void => { uis.push(u); }, restMs: { normal: 1000, fast: 600 }, firstMs: 500,
  });
  return { p, clock, stage, uis };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('the example player', () => {
  it('starts by itself once at least 60% is in view, plays through once and rests on the last step', async () => {
    const { p, clock, stage } = makePlayer();
    p.setVisible(0.5);
    await flush();
    expect(stage.calls).toEqual([]);
    p.setVisible(0.7);
    await flush();
    expect(p.state.playing).toBe(true);
    expect(stage.held).toBe(true);
    await clock.advance(500 + 3 * STEP_MS + 2 * 1000 + 100);
    expect(stage.calls.filter(c => c.startsWith('begin'))).toEqual(['begin 0', 'begin 1', 'begin 2']);
    expect(p.state).toMatchObject({ index: 2, playing: false, moving: false, finished: true });
    expect(stage.calls[stage.calls.length - 1]).toBe('unhold');
    expect(stage.calls).toContain('rest 2');
    // Resting: nothing scheduled, so nothing is drawn.
    expect(clock.pending).toBe(0);
    // It does not start again on its own.
    p.setVisible(0);
    p.setVisible(1);
    await flush();
    expect(p.state.playing).toBe(false);
  });

  it('plays at the game\'s Fast scale', async () => {
    const { p, clock } = makePlayer({ motion: 'fast' });
    p.setVisible(1);
    await flush();
    await clock.advance(500 + 3 * STEP_MS * 0.5 + 2 * 600 + 100);
    expect(p.state.finished).toBe(true);
  });

  it('Play again starts from the beginning; Previous and Next step through, Next playing one step', async () => {
    const { p, clock, stage } = makePlayer();
    p.setVisible(1);
    await flush();
    await clock.advance(10000);
    expect(p.state.finished).toBe(true);
    stage.calls.length = 0;
    p.primary();
    await flush();
    expect(stage.calls.slice(0, 2)).toEqual(['rest -1', 'hold']);
    await clock.advance(600);
    expect(p.state).toMatchObject({ index: 0, moving: true, playing: true });
    p.previous();
    await flush();
    expect(p.state).toMatchObject({ index: -1, moving: false, playing: false });
    p.next();
    await flush();
    expect(p.state).toMatchObject({ index: 0, moving: true, playing: false });
    await clock.advance(STEP_MS + 50);
    expect(p.state).toMatchObject({ index: 0, moving: false, playing: false });
    expect(clock.pending).toBe(0);
    p.next();
    await flush();
    p.next(); // while step 1 plays: jump to its end
    expect(p.state).toMatchObject({ index: 1, moving: false });
    p.previous();
    await flush();
    expect(p.state.index).toBe(0);
    expect(stage.calls).toContain('rest 0');
  });

  it('pauses when scrolled out of view and carries on when back, unless the reader paused it', async () => {
    const { p, clock } = makePlayer();
    p.setVisible(1);
    await flush();
    await clock.advance(800);
    expect(p.state.moving).toBe(true);
    p.setVisible(0.2);
    expect(p.state.paused).toBe(true);
    expect(clock.pending).toBe(0);
    const at = p.state.index;
    await clock.advance(5000);
    expect(p.state.index).toBe(at);
    p.setVisible(0.9);
    expect(p.state.paused).toBe(false);
    p.primary(); // the reader pauses
    expect(p.state.paused).toBe(true);
    p.setVisible(0);
    p.setVisible(1);
    expect(p.state.paused).toBe(true);
    p.tap(); // a tap on the picture carries on
    expect(p.state.paused).toBe(false);
    await clock.advance(10000);
    expect(p.state.index).toBe(2);
  });

  it('lets one example play at a time: starting another stops the first at the rest of its step', async () => {
    const coord = new Coordinator();
    const clock = new FakeClock();
    const a = makePlayer({ coord, clock });
    const b = makePlayer({ coord, clock });
    a.p.setVisible(1);
    b.p.setVisible(1);
    await flush();
    expect(a.p.state.playing).toBe(true);
    expect(b.p.state.playing).toBe(false); // waits: no two at once
    await clock.advance(800);
    b.p.primary();
    await flush();
    expect(a.p.state).toMatchObject({ playing: false, moving: false });
    expect(a.stage.calls).toContain('rest 0');
    expect(a.stage.held).toBe(false);
    expect(b.p.state.playing).toBe(true);
    await clock.advance(10000);
    expect(b.p.state.finished).toBe(true);
    // A stopped by the reader's choice does not start again by itself.
    expect(a.p.state.playing).toBe(false);
  });

  it('starts the next example in view once the playing one has finished', async () => {
    const coord = new Coordinator();
    const clock = new FakeClock();
    const a = makePlayer({ coord, clock });
    const b = makePlayer({ coord, clock });
    a.p.setVisible(1);
    b.p.setVisible(1);
    await flush();
    await clock.advance(10000);
    await flush();
    expect(a.p.state.finished).toBe(true);
    expect(b.p.state.playing).toBe(true);
  });

  it('with Animation Off or reduced motion shows stills: step 1 first, Previous and Next, nothing moves by itself', async () => {
    const { p, clock, stage } = makePlayer({ motion: 'stills' });
    expect(p.state.index).toBe(0);
    p.setVisible(1);
    p.show();
    await flush();
    await clock.advance(5000);
    expect(stage.calls).toEqual(['rest 0']);
    p.primary();
    p.next();
    await flush();
    expect(p.state.index).toBe(1);
    p.next();
    p.next();
    await flush();
    expect(p.state.index).toBe(2);
    p.previous();
    p.previous();
    p.previous();
    await flush();
    expect(p.state.index).toBe(0);
    expect(stage.calls.some(c => c.startsWith('begin'))).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it('falls back to the step list when nothing can be drawn', async () => {
    const { p, stage, uis } = makePlayer({ stage: fakeStage(false) });
    p.setVisible(1);
    await flush();
    expect(p.state.noPicture).toBe(true);
    expect(uis[uis.length - 1]!.noPicture).toBe(true);
    p.next();
    await flush();
    expect(p.state.index).toBe(0);
    expect(stage.calls).toEqual([]);
  });

  it('leaves nothing running when the page changes or the guide closes', async () => {
    const coord = new Coordinator();
    const { p, clock, stage } = makePlayer({ coord });
    p.setVisible(1);
    await flush();
    await clock.advance(800);
    expect(clock.pending).toBeGreaterThan(0);
    p.dispose();
    expect(clock.pending).toBe(0);
    expect(stage.held).toBe(false);
    expect(coord.playing).toBeNull();
    await clock.advance(5000);
    expect(stage.calls.filter(c => c.startsWith('begin'))).toEqual(['begin 0']);
  });

  it('announces a step only when the reader pressed a button', async () => {
    const { p, clock, uis } = makePlayer();
    p.setVisible(1);
    await flush();
    await clock.advance(10000);
    expect(uis.some(u => u.fromReader)).toBe(false);
    p.previous();
    await flush();
    expect(uis[uis.length - 1]).toMatchObject({ fromReader: true, index: 1 });
  });
});

describe('the shared renderer and the examples', () => {
  const view = (): PlayView => ({ alive: true, ratio: 1, use: vi.fn(), show: vi.fn(), animate: vi.fn(), draw: vi.fn(() => false), where: vi.fn(() => null) });
  it('hands out the live view of the one renderer, keeps it while an example plays, and gives it back after', async () => {
    const timers: (() => void)[] = [];
    const r: FigureRenderer & { disposed: number } = { disposed: 0, render: async (): Promise<null> => null, stage: async (): Promise<PlayView> => view(), dispose: (): void => { r.disposed++; } };
    const make = vi.fn(async () => r);
    const cache = new FigureCache(make, { setTimer: (fn): number => { timers.push(fn); return timers.length; }, clearTimer: (): void => { timers.length = 0; } });
    expect(await cache.view()).toBeTruthy();
    expect(await cache.view()).toBeTruthy();
    expect(make).toHaveBeenCalledTimes(1);
    cache.hold();
    expect(timers).toHaveLength(0); // held: no quiet-spell countdown
    cache.unhold();
    expect(timers.length).toBeGreaterThan(0);
    cache.release();
    await new Promise(res => setTimeout(res, 0));
    expect(r.disposed).toBe(1);
  });
  it('gives no view, never an error, without WebGL', async () => {
    expect(await new FigureCache(async () => null).view()).toBeNull();
    expect(await new FigureCache(async () => { throw new Error('no context'); }).view()).toBeNull();
    expect(await new FigureCache(async () => ({ render: async (): Promise<null> => null, dispose: (): void => undefined })).view()).toBeNull();
  });
});

export type { Timeline };
