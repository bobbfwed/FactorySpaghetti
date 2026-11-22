// Soundness: random gestures — including taps on unlit targets and disabled items — never make
// the controller send an action that is not in legalActions for the current state (the roll
// excepted). Whole games are played through the controllers this way.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';
import { applyAction, createGame, legalActions } from '../../engine';
import { PlayController } from '../controller';
import type { Target } from '../../table/types';
import { GestureError, Rand, active, actors, allItems, expectLegal, gesturesFor, harness, offered, randomMove, roll } from './helpers';

/** Can a player reach at least one of the moves offered to them with gestures alone? */
function reachable(s: GameState, p: PlayerId): boolean {
  const acts = offered(s, p);
  if (acts.length === 0) return true;
  for (const a of acts.slice(0, 40)) {
    const { c, sent } = harness(s, p);
    try { gesturesFor(c, a); } catch (e) { if (e instanceof GestureError) continue; throw e; }
    if (sent.length > 0) return true;
  }
  return false;
}

function randomTarget(r: Rand, s: GameState): Target {
  const piece = s.board.length ? r.pick(s.board) : null;
  switch (r.int(8)) {
    case 0: return { kind: 'cell', q: r.int(15) - 7, r: r.int(15) - 7 };
    case 1: return piece ? { kind: 'piece', pieceId: piece.id } : { kind: 'deck' };
    case 2: return piece ? { kind: 'point', pieceId: piece.id, point: r.int(24) } : { kind: 'deck' };
    case 3: return piece ? { kind: 'buffer', pieceId: piece.id, buffer: r.next() < 0.5 ? 'input' : 'output' } : { kind: 'deck' };
    case 4: return piece ? { kind: 'mineSlot', pieceId: piece.id, slot: r.int(2) } : { kind: 'deck' };
    case 5: return s.belts.length ? { kind: 'belt', beltId: r.pick(s.belts).id } : { kind: 'belt', beltId: 'nope' };
    case 6: return { kind: 'stack', index: r.int(3) };
    default: return { kind: 'deck' };
  }
}

function randomGesture(r: Rand, c: PlayController, s: GameState): void {
  const v = c.view;
  const x = r.next();
  if (x < 0.5 && v.targets.length) { c.tap(r.pick(v.targets)); return; }
  if (x < 0.62) { c.tap(randomTarget(r, s)); return; }
  if (x < 0.84) {
    const ids = allItems(v).map(i => i.id);
    for (let m = 1; m <= 18; m++) ids.push(`module:${m}`);
    ids.push('junk', 'menu:run', 'bank:nothing', 'route:buy', 'pi:done', 'slot:1', 'buffer:input');
    c.choose(r.pick(ids));
    return;
  }
  // The primary button ends steps, so it is pressed rarely enough for long turns to happen.
  if (x < 0.865) { c.primary(); return; }
  if (x < 0.95) { c.confirm(); return; }
  if (x < 0.97) { c.rotate(r.int(5) - 2); return; }
  c.cancel();
}

describe('soundness: random gestures only ever send legal actions', () => {
  it('plays whole games through the controllers', () => {
    let states = 0, sends = 0, fallbacks = 0, gestures = 0, rolls = 0, routes = 0;
    const stuck: string[] = [];
    const sentTypes = new Map<string, number>();
    for (const [pc, seeds] of [[2, [11, 12, 13, 14]], [3, [21, 22, 23]], [4, [31, 32, 33]]] as const) {
      for (const seed of seeds) {
        const r = new Rand(seed);
        let s = createGame(seed, pc);
        const outbox: { p: PlayerId; a: Action; at: GameState }[] = [];
        const history: string[] = [];
        let inBroadcast = false;
        const ctrls = Array.from({ length: pc }, (_, i) => {
          const p = i as PlayerId;
          return new PlayController({ send: (a): void => { if (inBroadcast) routes++; outbox.push({ p, a, at: s }); } });
        });
        const broadcast = (): void => {
          inBroadcast = true;
          for (let i = 0; i < pc; i++) ctrls[i]!.update(s, i as PlayerId);
          inBroadcast = false;
        };
        broadcast();

        const drain = (): void => {
          while (outbox.length) {
            const { p, a, at } = outbox.shift()!;
            sends++;
            sentTypes.set(a.type, (sentTypes.get(a.type) ?? 0) + 1);
            expectLegal(at, p, a);
            const real = a.type === 'ROLL_DICE' ? roll(r, s) : a;
            if (a.type === 'ROLL_DICE') rolls++;
            // A move sent against an older state is re-checked against the current one.
            if (at !== s && a.type !== 'ROLL_DICE' && !legalActions(s, p).some(x => JSON.stringify(x) === JSON.stringify(a))) continue;
            const res = applyAction(s, real);
            if (!res.ok) {
              // legalActions offered it but the engine refuses it: an engine inconsistency, not the
              // controller's doing. None is tolerated; the moves since the roll help find the cause.
              const since = history.slice(history.map(h => h.includes('ROLL_DICE')).lastIndexOf(true));
              throw new Error(`engine refused an action legalActions offered: ${a.type} ${res.error.code} (${pc} players, seed ${seed}, moves since the roll: ${since.join(' | ')})`);
            }
            s = res.state;
            history.push(`P${p} ${JSON.stringify(real)}`);
            broadcast();
          }
        };

        for (let step = 0; step < 600 && !s.gameOver; step++) {
          states++;
          const p = r.pick(actors(s));
          const c = ctrls[p]!;
          for (let g = 0; g < 120 && outbox.length === 0; g++) { randomGesture(r, c, s); gestures++; }
          if (outbox.length) { drain(); continue; }
          // Random gestures did not finish a move. That is fine only when some gesture could have:
          // a state where moves are legal for this player but none can be made is a dead end.
          if (!reachable(s, p)) stuck.push(`${pc}p seed ${seed} step ${step} P${p} ${s.phase}: ${offered(s, p).map(a => a.type).join(',')}`);
          // Let a random legal move happen so the game goes on.
          fallbacks++;
          const a = randomMove(r, s, p);
          if (!a) continue;
          const res = applyAction(s, a);
          if (!res.ok) throw new Error(res.error.message);
          s = res.state;
          history.push(`P${p} ${JSON.stringify(a)}`);
          broadcast();
          drain();
        }
        expect(active(s)).toBeDefined();
      }
    }
    // eslint-disable-next-line no-console -- the run's coverage figures are part of the report
    console.log(`soundness: ${states} states, ${gestures} gestures, ${sends} sends (${rolls} rolls, ${routes} route steps), ${fallbacks} fallback moves\n  sent: ${[...sentTypes].sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
    expect(sends).toBeGreaterThan(500);
    expect(stuck, 'states where legal moves exist but no gesture can make one').toEqual([]);
  }, 600_000);
});
