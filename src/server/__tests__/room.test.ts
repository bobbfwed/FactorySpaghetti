import { describe, it, expect, beforeEach } from 'vitest';
import { Room } from '../room';
import type { RoomTransport } from '../room';
import type { ServerMessage, StateSnapshot, LobbyView } from '../protocol';
import { legalActions } from '../../engine/reducer';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';

// Records every message the room sends, so tests can assert on them per client.
class FakeTransport implements RoomTransport {
  readonly sent: { clientId: string; msg: ServerMessage }[] = [];
  send(clientId: string, msg: ServerMessage): void {
    this.sent.push({ clientId, msg });
  }
  clear(): void { this.sent.length = 0; }
  for(clientId: string): ServerMessage[] {
    return this.sent.filter(s => s.clientId === clientId).map(s => s.msg);
  }
  last<T extends ServerMessage['type']>(clientId: string, type: T):
    Extract<ServerMessage, { type: T }> | undefined {
    const msgs = this.for(clientId).filter(m => m.type === type);
    return msgs[msgs.length - 1] as Extract<ServerMessage, { type: T }> | undefined;
  }
  hasType(clientId: string, type: ServerMessage['type']): boolean {
    return this.for(clientId).some(m => m.type === type);
  }
}

function hello(room: Room, connId: string, name: string, token?: string): void {
  room.handleMessage(connId, JSON.stringify({ type: 'hello', name, ...(token ? { token } : {}) }));
}
function send(room: Room, connId: string, msg: Record<string, unknown>): void {
  room.handleMessage(connId, JSON.stringify(msg));
}

function activePlayerId(state: GameState): PlayerId {
  return state.turnOrder[state.activePlayerIndex]!;
}

const SEED = () => 12345;

describe('Room — lobby', () => {
  let t: FakeTransport;
  let room: Room;
  beforeEach(() => {
    t = new FakeTransport();
    room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
  });

  it('welcomes a new client, marks the first as host, and auto-claims a seat', () => {
    hello(room, 'A', 'Alice');
    const welcome = t.last('A', 'welcome');
    expect(welcome?.isHost).toBe(true);
    expect(welcome?.token).toBeTruthy();

    const lobby = t.last('A', 'lobby')!.lobby;
    expect(lobby.playerCount).toBe(2);
    expect(lobby.seats[0]!.claimedByName).toBe('Alice'); // auto-claimed lowest open seat
    expect(lobby.hostClientId).toBe('A');
  });

  it('second client is not host and auto-claims the next open seat', () => {
    hello(room, 'A', 'Alice');
    hello(room, 'B', 'Bob');
    expect(t.last('B', 'welcome')?.isHost).toBe(false);
    const lobby = t.last('A', 'lobby')!.lobby;
    expect(lobby.seats[0]!.claimedByName).toBe('Alice');
    expect(lobby.seats[1]!.claimedByName).toBe('Bob');
    expect(lobby.canStart).toBe(true);
  });

  it('rejects a non-host configuring, accepts the host, and clears a now-bot claim', () => {
    hello(room, 'A', 'Alice');
    hello(room, 'B', 'Bob'); // seat 1
    t.clear();
    send(room, 'B', { type: 'configure', playerCount: 2, seatKinds: ['open', 'open'] });
    expect(t.last('B', 'rejected')?.reason).toMatch(/host/);

    send(room, 'A', { type: 'configure', playerCount: 2, seatKinds: ['open', 'bot:greedy'] });
    const lobby = t.last('A', 'lobby')!.lobby;
    expect(lobby.seats[1]!.kind).toBe('bot:greedy');
    expect(lobby.seats[1]!.claimedByName).toBeNull(); // Bob's claim on seat 1 was dropped
    expect(lobby.canStart).toBe(true);               // only the open seat 0 needs a claimant
  });

  it('lets a client release and another claim a seat', () => {
    hello(room, 'A', 'Alice'); // seat 0
    hello(room, 'B', 'Bob');   // seat 1
    send(room, 'B', { type: 'releaseSeat' });
    expect(t.last('A', 'lobby')!.lobby.seats[1]!.claimedByName).toBeNull();
    send(room, 'B', { type: 'claimSeat', seatIndex: 1 });
    expect(t.last('A', 'lobby')!.lobby.seats[1]!.claimedByName).toBe('Bob');
  });

  it('rejects claiming a seat already taken', () => {
    hello(room, 'A', 'Alice'); // seat 0
    hello(room, 'B', 'Bob');   // seat 1
    send(room, 'B', { type: 'claimSeat', seatIndex: 0 });
    expect(t.last('B', 'rejected')?.reason).toMatch(/claimed/);
  });

  it('host can start with an unclaimed open seat; it is filled with a bot', () => {
    hello(room, 'A', 'Alice'); // seat 0 auto-claimed
    // Two open seats but only A is present — seat 1 stays unclaimed.
    send(room, 'A', { type: 'configure', playerCount: 2, seatKinds: ['open', 'open'] });
    const lobby = t.last('A', 'lobby')!.lobby;
    expect(lobby.canStart).toBe(true);          // host can always start...
    expect(lobby.allSeatsClaimed).toBe(false);  // ...but the UI knows a seat will be bot-filled
    t.clear();
    send(room, 'A', { type: 'start' });
    const snap = t.last('A', 'snapshot')!.snapshot;
    expect(snap.phase).toBe('playing');
    expect(snap.seats[0]!.kind).toBe('human');
    expect(snap.seats[1]!.kind).toBe('bot');    // unclaimed open seat → bot
    expect(snap.yourPlayerId).toBe(0);
  });

  it('a seat explicitly configured as a bot starts as that bot', () => {
    hello(room, 'A', 'Alice');
    send(room, 'A', { type: 'configure', playerCount: 2, seatKinds: ['open', 'bot:greedy'] });
    t.clear();
    send(room, 'A', { type: 'start' });
    const snap = t.last('A', 'snapshot')!.snapshot;
    expect(snap.seats[1]!.kind).toBe('bot');
    expect(snap.seats[1]!.label).toBe('Smart Bot');
  });
});

describe('Room — game start & actions', () => {
  let t: FakeTransport;
  let room: Room;
  beforeEach(() => {
    t = new FakeTransport();
    room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    hello(room, 'A', 'Alice'); // seat 0
    hello(room, 'B', 'Bob');   // seat 1
    t.clear();
    send(room, 'A', { type: 'start' });
  });

  it('broadcasts an initial snapshot to both clients with correct yourPlayerId', () => {
    const snapA = t.last('A', 'snapshot')!.snapshot;
    const snapB = t.last('B', 'snapshot')!.snapshot;
    expect(snapA.phase).toBe('playing');
    expect(snapA.yourPlayerId).toBe(0);
    expect(snapB.yourPlayerId).toBe(1);
    expect(snapA.seats).toHaveLength(2);
    expect(snapA.seats[0]!.ownerName).toBe('Alice');
    expect(snapA.seats[1]!.ownerName).toBe('Bob');
  });

  it('accepts a legal action from the active seat owner and broadcasts the new state', () => {
    const snap = t.last('A', 'snapshot')!.snapshot;
    const active = activePlayerId(snap.state);
    const ownerConn = active === 0 ? 'A' : 'B';
    const action = legalActions(snap.state, active)[0]!;
    t.clear();
    send(room, ownerConn, { type: 'action', action });
    // No rejection, and a fresh snapshot went out to both clients.
    expect(t.hasType(ownerConn, 'rejected')).toBe(false);
    expect(t.last('A', 'snapshot')).toBeDefined();
    expect(t.last('B', 'snapshot')).toBeDefined();
  });

  it('rejects an action from a client whose seat is not active ("not your turn")', () => {
    const snap = t.last('A', 'snapshot')!.snapshot;
    const active = activePlayerId(snap.state);
    const wrongConn = active === 0 ? 'B' : 'A';
    const action = legalActions(snap.state, active)[0]!;
    t.clear();
    send(room, wrongConn, { type: 'action', action });
    expect(t.last(wrongConn, 'rejected')?.reason).toMatch(/not your turn/);
  });

  it('rejects an illegal action from the active seat owner', () => {
    const snap = t.last('A', 'snapshot')!.snapshot;
    const active = activePlayerId(snap.state);
    const ownerConn = active === 0 ? 'A' : 'B';
    t.clear();
    // END_TURN is illegal during the setup-claim phase.
    send(room, ownerConn, { type: 'action', action: { type: 'END_TURN' } as Action });
    expect(t.last(ownerConn, 'rejected')?.reason).toMatch(/illegal/);
  });
});

describe('Room — reconnection (token rejoin re-syncs)', () => {
  it('a reconnecting client reclaims its seat mid-game and receives the snapshot', () => {
    const t = new FakeTransport();
    const room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    hello(room, 'A', 'Alice');
    hello(room, 'B', 'Bob');
    send(room, 'A', { type: 'start' });
    const bToken = t.last('B', 'welcome')!.token;

    // Bob drops.
    room.handleDisconnect('B');
    t.clear();

    // Bob reconnects on a new socket, replaying his token.
    hello(room, 'B2', 'Bob', bToken);
    const welcome = t.last('B2', 'welcome')!;
    expect(welcome.clientId).toBe('B2');
    const snap = t.last('B2', 'snapshot')!.snapshot;
    expect(snap.yourPlayerId).toBe(1); // same seat as before the drop
  });

  it('rejoin without a token starts as a spectator (yourPlayerId null) mid-game', () => {
    const t = new FakeTransport();
    const room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    hello(room, 'A', 'Alice');
    hello(room, 'B', 'Bob');
    send(room, 'A', { type: 'start' });
    t.clear();
    hello(room, 'C', 'Carol'); // late joiner, no seat
    const snap = t.last('C', 'snapshot')!.snapshot;
    expect(snap.yourPlayerId).toBeNull();
    // And a spectator's action is refused.
    const active = activePlayerId(snap.state);
    send(room, 'C', { type: 'action', action: legalActions(snap.state, active)[0]! });
    expect(t.last('C', 'rejected')?.reason).toMatch(/spectator/);
  });
});

describe('Room — resync & return to lobby', () => {
  it('resync resends the current lobby view', () => {
    const t = new FakeTransport();
    const room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    hello(room, 'A', 'Alice');
    t.clear();
    send(room, 'A', { type: 'resync' });
    const lobby: LobbyView | undefined = t.last('A', 'lobby')?.lobby;
    expect(lobby?.phase).toBe('lobby');
  });

  it('host can return the room to the lobby after starting', () => {
    const t = new FakeTransport();
    const room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    hello(room, 'A', 'Alice');
    hello(room, 'B', 'Bob');
    send(room, 'A', { type: 'start' });
    t.clear();
    send(room, 'A', { type: 'returnToLobby' });
    expect(t.last('A', 'lobby')).toBeDefined();
    // A subsequent resync confirms we're back in the lobby.
    send(room, 'B', { type: 'resync' });
    const snap: StateSnapshot | undefined = t.last('B', 'snapshot')?.snapshot;
    // No new snapshot after return-to-lobby + resync (lobby is sent instead).
    expect(t.last('B', 'lobby')).toBeDefined();
    expect(snap).toBeUndefined();
  });
});

describe('Room — presence relay (spectating)', () => {
  const PRESENCE = {
    hoveredCoord: { q: 2, r: 0 },
    ghost: null,
    selectedCoord: null,
    route: null,
  };

  it('relays a seated player\'s presence to others (tagged by seat), never echoing the sender', () => {
    const t = new FakeTransport();
    const room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    hello(room, 'A', 'Alice'); // seat 0
    hello(room, 'B', 'Bob');   // seat 1
    send(room, 'A', { type: 'start' });
    t.clear();

    send(room, 'A', { type: 'presence', presence: PRESENCE });

    const toB = t.last('B', 'presence');
    expect(toB?.playerId).toBe(0);                 // tagged with the sender's seat
    expect(toB?.presence).toEqual(PRESENCE);
    expect(t.last('A', 'presence')).toBeUndefined(); // not echoed to the sender
  });

  it('ignores presence from a spectator (no seat)', () => {
    const t = new FakeTransport();
    const room = new Room(t, { botDelayMs: 0, createSeed: SEED, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    hello(room, 'A', 'Alice'); // seat 0
    send(room, 'A', { type: 'start' }); // seat 1 auto-filled with a bot
    hello(room, 'S', 'Spectator'); // joins mid-game, no seat
    t.clear();
    send(room, 'S', { type: 'presence', presence: PRESENCE });
    expect(t.last('A', 'presence')).toBeUndefined(); // spectator presence is not relayed
  });
});
