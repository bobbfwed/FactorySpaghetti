// End-to-end smoke test over REAL WebSockets: it exercises the exact production wiring
// (createLanServer → ws → Room), not a stub. Two clients join, the host starts, and they
// play a real game by always having the active seat's owner submit a legal action. Verifies
// the handshake, per-client snapshots (yourPlayerId), action validation, and that the game
// actually advances over the wire.

import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { createLanServer, type LanServer } from '../server';
import { legalActions } from '../../engine/reducer';
import type { ServerMessage, StateSnapshot } from '../protocol';
import type { GameState, PlayerId } from '../../engine/state';
import type { Action } from '../../engine/actions';

// A test client with a proper FIFO message queue: `take` pulls the next message matching a
// predicate (from the queue or a future arrival), and `drain` discards buffered messages so
// a subsequent `take` reflects the server's response to the request we're about to send.
// This avoids stale-snapshot races entirely — every decision uses authoritative state.
class TestClient {
  private ws: WebSocket;
  private queue: ServerMessage[] = [];
  private waiter: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void } | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', d => {
      const msg = JSON.parse(String(d)) as ServerMessage;
      if (this.waiter && this.waiter.match(msg)) {
        const w = this.waiter; this.waiter = null; w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  take(match: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    const i = this.queue.findIndex(match);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]!);
    return new Promise(resolve => { this.waiter = { match, resolve }; });
  }

  takeType<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    return this.take(m => m.type === type) as Promise<Extract<ServerMessage, { type: T }>>;
  }

  drain(): void { this.queue = []; }
  send(msg: Record<string, unknown>): void { this.ws.send(JSON.stringify(msg)); }
  close(): void { this.ws.close(); }
}

function activePlayerId(state: GameState): PlayerId {
  return state.turnOrder[state.activePlayerIndex]!;
}

// Choose a legal action for the active player (roll phase needs generated dice).
function chooseAction(state: GameState, pid: PlayerId): Action {
  if (state.phase === 'roll') {
    return { type: 'ROLL_DICE', rolls: Array.from({ length: state.mineCount }, () => 3) };
  }
  return legalActions(state, pid)[0]!;
}

async function connectAndHello(url: string, name: string): Promise<TestClient> {
  const c = new TestClient(url);
  await c.open();
  c.send({ type: 'hello', name });
  await c.takeType('welcome');
  return c;
}

describe('LAN server integration (real WebSockets)', () => {
  it('two clients join, host starts, and a full game plays over the wire', async () => {
    let server: LanServer | null = null;
    let a: TestClient | null = null;
    let b: TestClient | null = null;
    try {
      // Deterministic seed + instant bots (none here — both seats human).
      server = createLanServer({ botDelayMs: 0, createSeed: () => 777, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
      await new Promise<void>(res => server!.httpServer.listen(0, '127.0.0.1', res));
      const url = `ws://127.0.0.1:${server.port()}/ws`;

      a = await connectAndHello(url, 'Alice');
      b = await connectAndHello(url, 'Bob');

      // Host starts (both open seats were auto-claimed on hello).
      a.drain(); b.drain();
      a.send({ type: 'start' });
      const [snapA, snapB] = await Promise.all([a.takeType('snapshot'), b.takeType('snapshot')]);
      expect(snapA.snapshot.yourPlayerId).toBe(0);
      expect(snapB.snapshot.yourPlayerId).toBe(1);

      let latest: StateSnapshot = snapA.snapshot;
      const startPhase = latest.state.phase;

      // Play: the active seat's owner submits a legal action; take the authoritative echo.
      let moves = 0;
      let rejection = '';
      const MAX = 200;
      while (!latest.gameOver && moves < MAX) {
        const pid = activePlayerId(latest.state);
        const owner = pid === 0 ? a : b;
        const action = chooseAction(latest.state, pid);
        owner.drain();
        owner.send({ type: 'action', action });
        const res = await owner.take(m => m.type === 'snapshot' || m.type === 'rejected');
        if (res.type === 'rejected') { rejection = `move ${moves} ${latest.state.phase}/${action.type}: ${res.reason}`; break; }
        if (res.type !== 'snapshot') continue;
        latest = res.snapshot;
        moves++;
      }

      expect(rejection).toBe('');           // no action was ever refused
      expect(moves).toBeGreaterThan(10);
      // The game advanced over the wire (past the opening setup phase, or finished).
      const advanced = latest.gameOver || latest.state.phase !== startPhase || latest.state.round > 1;
      expect(advanced).toBe(true);
    } finally {
      a?.close();
      b?.close();
      await server?.close();
    }
  }, 30000);

  it('rejects an action from the client whose seat is not active', async () => {
    let server: LanServer | null = null;
    let a: TestClient | null = null;
    let b: TestClient | null = null;
    try {
      server = createLanServer({ botDelayMs: 0, createSeed: () => 777, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
      await new Promise<void>(res => server!.httpServer.listen(0, '127.0.0.1', res));
      const url = `ws://127.0.0.1:${server.port()}/ws`;

      a = await connectAndHello(url, 'Alice');
      b = await connectAndHello(url, 'Bob');

      a.drain(); b.drain();
      a.send({ type: 'start' });
      const first = (await a.takeType('snapshot')).snapshot;

      const pid = activePlayerId(first.state);
      const wrong = pid === 0 ? b : a;
      wrong.drain();
      wrong.send({ type: 'action', action: chooseAction(first.state, pid) });
      const rej = await wrong.takeType('rejected');
      expect(rej.reason).toMatch(/not your turn/);
    } finally {
      a?.close();
      b?.close();
      await server?.close();
    }
  }, 30000);
});
