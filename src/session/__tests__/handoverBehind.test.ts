// A move in flight when the host drops, and the successor never heard the move before it.
// Seen over the real PeerJS service (N10 check): the old host's last broadcast reached the mover
// but not the successor, so the new host's game is one move behind the mover. The mover's re-sent
// move must not be applied on top of the wrong position; it is refused with a clear message, and
// every device ends with the successor's game and the same journal. The mover's earlier move,
// which the successor never had, is undone: the mover is told so (ClientSession.rolledBack).

import { describe, it, expect } from 'vitest';
import type { PlayerId } from '../../engine/state';
import { chooseAction as greedy } from '../../bots/greedyBot';
import { activeSeat } from '../room';
import { promoteToHost } from '../clientSession';
import { ManualScheduler, join, newLobby, rejoin, settle } from './helpers';
import { refusalText } from '../../app/gameText';

describe('a move in flight when the successor is behind the mover', () => {
  it('is refused, never applied twice or on the wrong position, and every journal agrees', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 3, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0, awayPolicy: 'wait' } });
    const bea = join(host, 'Bea', 'tok-bea-0123456789');
    const cy = join(host, 'Cy', 'tok-cy-0123456789xx');
    await settle();
    for (const c of [me, bea.client, cy.client]) expect((await c.setReady(true)).ok).toBe(true);
    expect((await me.start()).ok).toBe(true);
    const clients = [me, bea.client, cy.client];
    // Play by hand until Cy (seat 2) is to move, with nobody else owing a choice.
    for (let n = 0; n < 2000; n++) {
      await settle();
      const g = host.room.game!;
      if (activeSeat(g) === 2 && g.pendingFactoryOps.length === 0 && host.room.seq > 10) break;
      const seat = g.pendingFactoryOps[0]?.ownerId ?? activeSeat(g)!;
      expect((await clients[seat]!.act(greedy(g, seat as PlayerId))).ok).toBe(true);
    }
    await settle();
    const s = host.room.seq;

    // Cy's first move reaches everyone except Bea, the successor.
    bea.clientEnd.dropIncoming = true;
    expect((await cy.client.act(greedy(host.room.game!, 2 as PlayerId))).ok).toBe(true);
    await settle();
    expect(bea.client.room!.seq).toBe(s);
    expect(cy.client.room!.seq).toBe(s + 1);
    bea.clientEnd.dropIncoming = false;

    // Cy presses the next move as the host's tab closes: the host never gets it.
    cy.hostEnd.dropIncoming = true;
    const g1 = cy.client.room!.game!;
    const result = cy.client.act(greedy(g1, (g1.pendingFactoryOps[0]?.ownerId ?? activeSeat(g1)!) as PlayerId));
    await settle();
    host.dispose();
    await settle();

    // Bea takes over from her copy (one move behind); Cy comes back and re-sends.
    const sched = new ManualScheduler();
    const next = promoteToHost(bea.client.room!, 1, { hostToken: 'tok-bea-0123456789', scheduler: sched, journal: bea.client.journal });
    bea.client.reattach(next.connectLocal());
    rejoin(next, cy);
    const res = await result;
    await settle();
    await settle();
    expect(res).toMatchObject({ ok: false, error: { code: 'STALE' } });
    // The player is told the move was not made and may make it again.
    expect(refusalText(res.ok ? { code: '' } : res.error)).toMatch(/not made/);
    expect(res.ok ? '' : res.error.message).toMatch(/not applied/);
    expect(next.room.seq).toBe(s);
    expect(cy.client.room!.seq).toBe(s);
    // Cy's first move had been accepted, and the new host never had it: Cy is told, once.
    expect(cy.client.takeRollback()).toEqual({ from: s + 1, to: s });
    expect(cy.client.takeRollback()).toBeNull();
    expect(bea.client.takeRollback()).toBeNull();
    expect(cy.client.pending).toBeNull();
    expect(cy.client.journal).toEqual(next.journal);
    expect(bea.client.journal).toEqual(next.journal);
    next.dispose();
  }, 60_000);
});
