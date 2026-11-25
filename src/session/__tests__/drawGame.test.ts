// A whole 4-player game under the draw step (several stacks open, DRAW_PIECE), through a host and
// three client devices: every device's journal equals the host's, the replay reproduces the final
// state, draws reach the table as `pieceDrawn` events, and the save link stays under 6,000 characters.

import { describe, it, expect } from 'vitest';
import type { HostSession } from '../hostSession';
import type { ClientSession } from '../clientSession';
import type { Room, TableEvent } from '../room';
import { journalEnd, journalFrom, replayTo } from '../journal';
import { makeReplay, serializeReplay, validateReplay, verifyReplay } from '../replay';
import { MAX_LINK_CHARS, isTableEvent, packLink, toSave } from '../save';
import type { ManualScheduler } from './helpers';
import { join, newLobby, settle } from './helpers';

// Greedy bots open a second stack while the first still has pieces with this seed.
const SEED = 2;

async function quick(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>(r => setImmediate(r));
}

async function botsUntil(host: HostSession, sched: ManualScheduler, until: (r: Room) => boolean): Promise<void> {
  for (let i = 0; i < 200_000; i++) {
    await quick();
    if (until(host.room)) { await settle(); return; }
    if (sched.pending === 0) throw new Error('botsUntil: nothing left to happen');
    sched.runUntil(() => until(host.room), 1);
  }
  throw new Error('botsUntil: too many steps');
}

describe('a game with draws through a host and three clients', () => {
  it('every journal equals the host\'s, the replay reaches the final state, and the link stays short', async () => {
    const { host, sched, me } = await newLobby({
      settings: { playerCount: 4, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0 }, randomSeed: () => SEED,
    });
    const others = ['Bea', 'Cy', 'Dee'].map(n => join(host, n, `tok-${n.toLowerCase()}-0123456789`).client);
    await settle();
    const devices: ClientSession[] = [me, ...others];
    for (const c of devices) expect((await c.setReady(true)).ok).toBe(true);
    expect((await me.start()).ok).toBe(true);
    for (let i = 0; i < 4; i++) expect((await me.setAutopilot(i, true)).ok).toBe(true);
    await settle();

    const drawn: TableEvent[] = [];
    let open2 = false;
    let linkAtDraw: string | null = null;
    host.subscribe(() => {
      const r = host.room;
      drawn.push(...r.lastEvents.filter(e => e.kind === 'pieceDrawn' && !drawn.includes(e)));
      if (r.game && r.game.stacks.filter(s => s.available && s.pieces.length > 0).length > 1) open2 = true;
    });
    await botsUntil(host, sched, r => {
      if (!linkAtDraw && r.game?.drawnStackIndex != null) linkAtDraw = JSON.stringify(r);
      return r.phase === 'finished';
    });
    await settle();

    const room = host.room;
    expect(room.game!.gameOver).toBe(true);
    const journal = host.journal!;
    expect(journalFrom(journal)).toBe(0);
    expect(journalEnd(journal)).toBe(room.seq);
    expect(replayTo(journal, room.seq)).toEqual(room.game);
    for (const c of devices) {
      expect(c.journalCurrent).toBe(true);
      expect(c.journal).toEqual(journal);
      expect(c.room).toEqual(room);
    }

    // Draws happened, and each reached the table as a well-formed event.
    expect(open2).toBe(true);
    const draws = journal.moves.filter(m => m.type === 'DRAW_PIECE');
    expect(draws.length).toBeGreaterThan(0);
    expect(drawn.length).toBeGreaterThan(0);
    for (const e of drawn) expect(isTableEvent(e, 4)).toBe(true);
    expect(drawn[0]).toMatchObject({ kind: 'pieceDrawn', stack: draws[0]!.type === 'DRAW_PIECE' ? draws[0]!.stackIndex : -1 });
    for (const bad of [{ stack: 3 }, { stack: '1' }, { seat: 4 }, { pieceId: '' }, { building: 'castle' }]) {
      expect(isTableEvent({ ...drawn[0], ...bad }, 4)).toBe(false);
    }

    // The replay file (as text, as a player would save it) reproduces the final state.
    const replay = validateReplay(JSON.parse(serializeReplay(makeReplay(room, journal, { savedAt: 1, app: 'test' }))));
    const cursor = await verifyReplay(replay);
    expect(cursor.refused).toBeNull();
    expect(cursor.sameRules).toBe(true);
    expect(cursor.dice.status).toBe('ok');
    expect(cursor.stateAt(cursor.length)).toEqual(room.game);

    // The save link, at the end and while a drawn piece waited to be placed. Instant bots play in
    // batches, so that moment is not always seen between two of them; then it is rebuilt from the
    // journal (the room at the first draw, as the host held it then).
    const firstDraw = journal.moves.findIndex(m => m.type === 'DRAW_PIECE') + 1;
    const atDraw: Room = linkAtDraw
      ? JSON.parse(linkAtDraw) as Room
      : { ...room, phase: 'playing', seq: firstDraw, game: replayTo(journal, firstDraw)! };
    expect(atDraw.game!.drawnStackIndex).not.toBeNull();
    for (const r of [room, atDraw]) {
      const link = await packLink(toSave(r, { savedAt: 1, app: 'test' }, { forLink: true }));
      expect(link.length).toBeLessThan(MAX_LINK_CHARS);
      expect(link.length).toBeLessThan(6000);
    }
    host.dispose();
  }, 120_000);
});
