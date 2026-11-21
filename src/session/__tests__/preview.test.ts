// Previews: what the active player is considering, shown to everyone else before they confirm.
// Not game state: never in the room, a save or the journal; the host passes them on only from
// the active player placing a piece, a Mine or the meeple, for the current move number, at most
// one per PREVIEW_INTERVAL_MS per player, and drops anything else without a reply.

import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import { chooseAction as greedy } from '../../bots/greedyBot';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import { activeSeat } from '../room';
import { memoryPair } from '../memoryConn';
import type { MemoryConn } from '../memoryConn';
import type { Preview } from '../preview';
import { PREVIEW_INTERVAL_MS, PREVIEW_MAX_BYTES, normalizePreview } from '../preview';
import { parseClientMsg, parseHostMsg } from '../protocol';
import { memoryStore } from '../store';
import { packLink, toSave } from '../save';
import { ManualScheduler, findState, playingRoom, settle } from './helpers';

const QUIET = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, awayPolicy: 'wait' as const, botDelayMs: 0 };
const NAMES = ['Ann', 'Bea', 'Cy', 'Dee'];
const tokenOf = (seat: number): string => `tok-${NAMES[seat]!.toLowerCase()}-0123456789`;

const PIECE: Preview = { k: 'piece', q: 1, r: -1, rot: 2 };
const OTHER: Preview = { k: 'piece', q: 2, r: -1, rot: 3 };

interface Device {
  client: ClientSession;
  end: MemoryConn;
  /** Every preview or refusal the host sent to this device. */
  inbox: Array<{ t?: string }>;
  /** What the device's preview listeners heard. */
  seen: Array<[number, Preview | null]>;
}

interface Table {
  host: HostSession;
  sched: ManualScheduler;
  /** By seat; null for a seat nobody is connected to. */
  seats: Array<Device | null>;
  active: number;
}

function wire(client: ClientSession, end: MemoryConn): Device {
  const d: Device = { client, end, inbox: [], seen: [] };
  const handler = end.onmessage!;
  end.onmessage = (m): void => { const t = (m as { t?: string }).t; if (t === 'peek' || t === 'nope') d.inbox.push(m as { t?: string }); handler(m); };
  client.onPreview((seat, p) => { d.seen.push([seat, p]); });
  return d;
}

function device(host: HostSession, sched: ManualScheduler, name: string, token: string): Device {
  const [hostEnd, clientEnd] = memoryPair();
  host.accept(hostEnd);
  return wire(new ClientSession(clientEnd, { name, token, scheduler: sched }), clientEnd);
}

/** A 4-player room around `game`, hosted by `hostSeat`; `absent` seats have nobody connected. */
async function table(game: GameState, hostSeat: number, absent: number[] = []): Promise<Table> {
  const sched = new ManualScheduler();
  const room = playingRoom(game, NAMES.slice(0, game.playerCount).map(name => ({ kind: 'human' as const, name })), hostSeat, QUIET);
  const host = new HostSession({
    code: 'ROOMA', hostName: NAMES[hostSeat]!, hostToken: tokenOf(hostSeat), room, mode: 'takeover', hostSeat, scheduler: sched,
  });
  const seats: Array<Device | null> = [];
  for (let s = 0; s < game.playerCount; s++) {
    if (absent.includes(s)) { seats.push(null); continue; }
    if (s === hostSeat) {
      const end = host.connectLocal() as MemoryConn;
      seats.push(wire(new ClientSession(end, { name: NAMES[s]!, token: tokenOf(s), scheduler: sched }), end));
    } else seats.push(device(host, sched, NAMES[s]!, tokenOf(s)));
  }
  await settle();
  seats.forEach((d, s) => { if (d) expect(d.client.seat).toBe(s); });
  return { host, sched, seats, active: activeSeat(game)! };
}

const placing = (): GameState => findState(4, s => s.phase === 'placePiece' && s.pendingFactoryOps.length === 0 && !s.gameOver);
const others = (t: Table, but: number): Device[] => t.seats.filter((d, s): d is Device => !!d && s !== but);
const clearAll = (t: Table): void => { for (const d of t.seats) if (d) { d.seen.length = 0; d.inbox.length = 0; } };

describe('previews', () => {
  it('reach every other player and a waiting visitor, with the sender\'s seat, and never the sender', async () => {
    const game = placing();
    const active = activeSeat(game)!;
    const hostSeat = (active + 1) % 4;
    const away = (active + 2) % 4;
    const t = await table(game, hostSeat, [away]);
    const visitor = device(t.host, t.sched, 'Zed', 'tok-zed-0123456789');
    await settle();
    expect(t.host.room.waiting.map(w => w.name)).toEqual(['Zed']);

    t.seats[active]!.client.sendPreview(PIECE);
    await settle();
    for (const d of [...others(t, active), visitor]) expect(d.seen).toEqual([[active, PIECE]]);
    expect(t.seats[active]!.seen).toEqual([]);
    expect(t.seats[active]!.inbox).toEqual([]); // no reply to the sender

    // Taking it back (null) reaches everyone the same way.
    await t.sched.advance(PREVIEW_INTERVAL_MS);
    t.seats[active]!.client.sendPreview(null);
    await settle();
    for (const d of [...others(t, active), visitor]) expect(d.seen).toEqual([[active, PIECE], [active, null]]);
  });

  it('work the same for the host\'s own player, and for a meeple', async () => {
    const game = findState(4, s => s.phase === 'placeMeeple' && s.pendingFactoryOps.length === 0 && !s.gameOver);
    const active = activeSeat(game)!;
    const t = await table(game, active);
    const meeple: Preview = { k: 'meeple', pieceId: 'mine-1', slot: 0 };
    t.seats[active]!.client.sendPreview(meeple);
    await settle();
    for (const d of others(t, active)) expect(d.seen).toEqual([[active, meeple]]);
    expect(t.seats[active]!.seen).toEqual([]);
  });

  it('are dropped without a reply when they come from anyone but the active player, or do not fit', async () => {
    const game = placing();
    const active = activeSeat(game)!;
    const hostSeat = (active + 1) % 4;
    const away = (active + 3) % 4;
    const t = await table(game, hostSeat, [away]);
    const visitor = device(t.host, t.sched, 'Zed', 'tok-zed-0123456789');
    const stranger = memoryPair(); // never says hello
    t.host.accept(stranger[0]);
    const strangerInbox: unknown[] = [];
    stranger[1].onmessage = (m): void => { strangerInbox.push(m); };
    await settle();
    clearAll(t);
    visitor.seen.length = 0;
    visitor.inbox.length = 0;
    const room = t.host.room;
    const seq = room.seq;
    const bystander = (active + 2) % 4;

    // A bystander's own session sends nothing; raw messages are dropped by the host.
    t.seats[bystander]!.client.sendPreview(PIECE);
    t.seats[bystander]!.end.send({ t: 'peek', seq, p: PIECE });
    visitor.end.send({ t: 'peek', seq, p: PIECE });
    stranger[1].send({ t: 'peek', seq, p: PIECE });
    const from = t.seats[active]!.end;
    from.send({ t: 'peek', seq: seq - 1, p: PIECE });                                  // an older move number
    from.send({ t: 'peek', seq: seq + 1, p: PIECE });
    from.send({ t: 'peek', seq, p: { ...PIECE, extra: 1 } });                          // unknown field
    from.send({ t: 'peek', seq, p: { k: 'piece', q: 1, r: -1, rot: 6 } });             // no such turn
    from.send({ t: 'peek', seq, p: { k: 'piece', q: 65, r: 0, rot: 0 } });             // off the table
    from.send({ t: 'peek', seq, p: { k: 'meeple', pieceId: 'x'.repeat(65), slot: null } });
    from.send({ t: 'peek', seq, p: { k: 'meeple', pieceId: 'm', slot: 2 } });
    from.send({ t: 'peek', seq, p: { k: 'belt' } });
    from.send({ t: 'peek', seq });                                                       // no preview at all
    from.send({ t: 'peek', p: PIECE });                                                  // no move number
    from.send({ t: 'peek', seq, p: PIECE, id: 'x'.repeat(PREVIEW_MAX_BYTES) });          // too large
    await settle();
    await t.sched.advance(PREVIEW_INTERVAL_MS * 3);

    for (const d of [...t.seats, visitor]) if (d) { expect(d.seen).toEqual([]); expect(d.inbox).toEqual([]); }
    expect(strangerInbox).toEqual([]);
    expect(t.host.room).toBe(room);
  });

  it('are dropped outside placing a piece, a Mine or the meeple', async () => {
    const game = findState(4, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && !s.gameOver);
    const active = activeSeat(game)!;
    const t = await table(game, (active + 1) % 4);
    t.seats[active]!.end.send({ t: 'peek', seq: t.host.room.seq, p: PIECE });
    t.seats[active]!.client.sendPreview(PIECE); // its own session does not even send it
    await settle();
    for (const d of t.seats) { expect(d!.seen).toEqual([]); expect(d!.inbox).toEqual([]); }
  });

  it('are sent and passed on at most once per interval, keeping the latest', async () => {
    const game = placing();
    const active = activeSeat(game)!;
    const t = await table(game, (active + 1) % 4);
    const me = t.seats[active]!;
    const sent: unknown[] = [];
    const send = me.end.send.bind(me.end);
    me.end.send = (m: unknown): void => { sent.push(m); send(m); };

    // From the session: the first leaves at once, the rest wait and only the latest goes.
    me.client.sendPreview(PIECE);
    me.client.sendPreview({ k: 'piece', q: 0, r: 1, rot: 0 });
    me.client.sendPreview({ k: 'piece', q: 0, r: 2, rot: 0 });
    me.client.sendPreview(OTHER);
    await settle();
    expect(sent).toHaveLength(1);
    await t.sched.advance(PREVIEW_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    for (const d of others(t, me.client.seat!)) expect(d.seen).toEqual([[active, PIECE], [active, OTHER]]);
    // The same preview again is not sent again.
    await t.sched.advance(PREVIEW_INTERVAL_MS);
    me.client.sendPreview(OTHER);
    await settle();
    expect(sent).toHaveLength(2);

    // Sent straight past the session's own limit, the host still passes on one per interval.
    clearAll(t);
    await t.sched.advance(PREVIEW_INTERVAL_MS);
    const seq = t.host.room.seq;
    for (let q = 0; q < 5; q++) me.end.send({ t: 'peek', seq, p: { k: 'piece', q, r: 0, rot: 0 } });
    await settle();
    for (const d of others(t, active)) expect(d.seen).toEqual([[active, { k: 'piece', q: 0, r: 0, rot: 0 }]]);
    await t.sched.advance(PREVIEW_INTERVAL_MS);
    for (const d of others(t, active)) {
      expect(d.seen).toEqual([[active, { k: 'piece', q: 0, r: 0, rot: 0 }], [active, { k: 'piece', q: 4, r: 0, rot: 0 }]]);
    }
  });

  it('end on every device when the move number moves on, and late ones for an old move are ignored', async () => {
    const game = placing();
    const active = activeSeat(game)!;
    const t = await table(game, (active + 1) % 4);
    const me = t.seats[active]!;
    me.client.sendPreview(PIECE);
    await settle();
    const seq = t.host.room.seq;
    // A preview held back for this move is forgotten when the move is made.
    me.client.sendPreview(OTHER);
    const res = await me.client.act(greedy(t.host.room.game!, active as 0 | 1 | 2 | 3));
    expect(res.ok).toBe(true);
    await t.sched.advance(PREVIEW_INTERVAL_MS * 2);
    expect(t.host.room.seq).toBeGreaterThan(seq);
    for (const d of others(t, active)) expect(d.seen).toEqual([[active, PIECE], [active, null]]);

    // A host message for the old move number changes nothing.
    const watcher = others(t, active).find(d => d.client.seat !== t.host.room.hostSeat)!;
    const hostEnd = watcher.end.peer!;
    hostEnd.send({ t: 'peek', seat: active, seq, p: PIECE });
    await settle();
    expect(watcher.seen).toEqual([[active, PIECE], [active, null]]);
  });

  it('never reach the room, the save, the save link or the journal', async () => {
    const game = placing();
    const active = activeSeat(game)!;
    const sched = new ManualScheduler();
    const store = memoryStore();
    const room = playingRoom(game, NAMES.map(name => ({ kind: 'human' as const, name })), (active + 1) % 4, QUIET);
    const host = new HostSession({
      code: 'ROOMA', hostName: NAMES[(active + 1) % 4]!, hostToken: tokenOf((active + 1) % 4), room, mode: 'takeover',
      hostSeat: (active + 1) % 4, scheduler: sched, store,
    });
    const devices: ClientSession[] = [];
    const stores = NAMES.map(() => memoryStore());
    for (let s = 0; s < 4; s++) {
      const [h, c] = memoryPair();
      host.accept(h);
      devices.push(new ClientSession(c, { name: NAMES[s]!, token: tokenOf(s), scheduler: sched, store: stores[s]! }));
    }
    await settle();
    const snapshot = (): string => JSON.stringify({
      room: host.room, journal: host.journal, store: [...store.keys()].map(k => [k, store.get(k)]),
      clients: devices.map(d => [d.room, d.journal]), stores: stores.map(st => [...st.keys()].map(k => [k, st.get(k)])),
    });
    const link = async (): Promise<string> => packLink(toSave(host.room, { savedAt: 1, app: 'test' }, { forLink: true, journal: host.journal }));
    const before = snapshot();
    const linkBefore = await link();
    const hostRoom = host.room;
    let heard = 0;
    for (const d of devices) d.onPreview(() => { heard++; });
    for (let i = 0; i < 6; i++) {
      devices[active]!.sendPreview({ k: 'piece', q: i, r: 0, rot: i % 6 });
      await sched.advance(PREVIEW_INTERVAL_MS);
    }
    devices[active]!.sendPreview(null);
    await sched.advance(PREVIEW_INTERVAL_MS);
    expect(heard).toBe(3 * 7); // three other players, seven previews each
    expect(host.room).toBe(hostRoom);
    expect(snapshot()).toBe(before);
    expect(await link()).toBe(linkBefore);
  });

  it('stop quietly after an older host refuses one, without an error or a refused move', async () => {
    const game = placing();
    const active = activeSeat(game)!;
    const sched = new ManualScheduler();
    const room = playingRoom(game, NAMES.map(name => ({ kind: 'human' as const, name })), (active + 1) % 4, QUIET);
    const host = new HostSession({
      code: 'ROOMA', hostName: NAMES[(active + 1) % 4]!, hostToken: tokenOf((active + 1) % 4), room, mode: 'takeover',
      hostSeat: (active + 1) % 4, scheduler: sched,
    });
    const [hostEnd, clientEnd] = memoryPair();
    host.accept(hostEnd);
    // An older host does not know `peek`: it answers BAD_MESSAGE with the message's id.
    const handler = hostEnd.onmessage!;
    let refused = 0;
    hostEnd.onmessage = (m): void => {
      const msg = m as { t?: string; id?: unknown };
      if (msg.t !== 'peek') { handler(m); return; }
      refused++;
      hostEnd.send({ t: 'nope', id: typeof msg.id === 'string' ? msg.id : null, error: { code: 'BAD_MESSAGE', message: 'That message was not understood.' } });
    };
    const me = new ClientSession(clientEnd, { name: NAMES[active]!, token: tokenOf(active), scheduler: sched });
    let changes = 0;
    me.subscribe(() => { changes++; });
    await settle();
    expect(me.seat).toBe(active);
    changes = 0;

    me.sendPreview(PIECE);
    await settle();
    expect(refused).toBe(1);
    expect(me.lastRefused).toBeNull();
    expect(me.pending).toBeNull();
    expect(changes).toBe(0);
    for (let i = 0; i < 3; i++) { await sched.advance(PREVIEW_INTERVAL_MS); me.sendPreview({ ...PIECE, rot: i }); }
    await sched.advance(PREVIEW_INTERVAL_MS);
    expect(refused).toBe(1);
    // Moves still work as before.
    expect((await me.act(greedy(host.room.game!, active as 0 | 1 | 2 | 3))).ok).toBe(true);
  });

  it('a new connection shows no preview from before it', async () => {
    const game = placing();
    const active = activeSeat(game)!;
    const t = await table(game, (active + 1) % 4);
    t.seats[active]!.client.sendPreview(PIECE);
    await settle();
    const watcher = others(t, active).find(d => d.client.seat !== t.host.room.hostSeat)!;
    expect(watcher.seen).toEqual([[active, PIECE]]);
    // The watcher's link drops and comes back: what it showed is gone, even at the same move number.
    const [hostEnd, clientEnd] = memoryPair();
    t.host.accept(hostEnd);
    watcher.client.reattach(clientEnd);
    await settle();
    expect(watcher.seen).toEqual([[active, PIECE], [active, null]]);
    expect(watcher.client.room!.seq).toBe(t.host.room.seq);
  });
});

describe('preview messages', () => {
  it('are read strictly', () => {
    expect(normalizePreview(PIECE)).toEqual(PIECE);
    expect(normalizePreview({ k: 'meeple', pieceId: 'pp-3', slot: null })).toEqual({ k: 'meeple', pieceId: 'pp-3', slot: null });
    for (const bad of [
      null, 1, 'piece', [], {}, { k: 'piece', q: 0.5, r: 0, rot: 0 }, { k: 'piece', q: 0, r: -65, rot: 0 },
      { k: 'piece', q: 0, r: 0, rot: -1 }, { k: 'piece', q: 0, r: 0 }, { k: 'meeple', pieceId: '', slot: null },
      { k: 'meeple', pieceId: 'a', slot: 1, x: 1 }, { k: 'meeple', pieceId: 3, slot: null },
    ]) expect(normalizePreview(bad)).toBeNull();
    expect(parseClientMsg({ t: 'peek', seq: 3, p: null })).toEqual({ t: 'peek', seq: 3, p: null });
    expect(parseClientMsg({ t: 'peek', seq: 3, p: PIECE, junk: 'y'.repeat(PREVIEW_MAX_BYTES) })).toBeNull();
    expect(parseHostMsg({ t: 'peek', seat: 2, seq: 3, p: PIECE })).toEqual({ t: 'peek', seat: 2, seq: 3, p: PIECE });
    expect(parseHostMsg({ t: 'peek', seat: 4, seq: 3, p: PIECE })).toBeNull();
    expect(parseHostMsg({ t: 'peek', seat: 1, seq: 3, p: { k: 'piece' } })).toBeNull();
  });
});
