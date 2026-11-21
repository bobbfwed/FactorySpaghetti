// The internet transport: browser to browser over WebRTC, introduced by the free public PeerJS
// broker. The host registers `factory-spaghetti-v1-<CODE>`; joiners use a random id and open a
// reliable JSON data channel to it. Messages are split at 15 KiB (PeerJS refuses about 16,300
// bytes). Both ends send heartbeats, because a data channel whose other browser was killed can
// stay "open" for minutes (see heartbeat.ts). The PeerJS library is loaded on first use, so pages that never go online skip it.

import type { DataConnection, Peer as PeerType, PeerOptions } from 'peerjs';
import type { Conn, HostHandle, JoinErrorKind, Transport } from './conn';
import { JoinError } from './conn';
import { chunked } from './chunk';
import { heartbeat } from './heartbeat';
import { OWN_RELAY } from './relay';

export const PEER_ID_PREFIX = 'factory-spaghetti-v1-';
/** Split anything bigger than this; PeerJS refuses JSON messages of 16,300 bytes or more. */
export const PEER_CHUNK_BYTES = 15 * 1024;
export const JOIN_TIMEOUT_MS = 20_000;
/** How long a host waits for the broker to accept its room code. */
export const HOST_TIMEOUT_MS = 15_000;

export function hostPeerId(code: string): string {
  return PEER_ID_PREFIX + code.toUpperCase();
}

/** A random id for a joiner (the broker only needs it to be unique). */
export function joinerPeerId(): string {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return `${PEER_ID_PREFIX}j-${Array.from(a, b => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The public helper servers. STUN servers tell a browser its public address, which is enough
 * for most home routers. TURN servers relay traffic when it is not (strict routers, two players
 * on one wifi, some mobile and office networks).
 */
export const PUBLIC_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // The relays the PeerJS project runs for its users: free, and not always up.
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

/** Every ICE server the game uses: our own relay first, when it is completely filled in. */
export function iceServers(ownRelay: RTCIceServer | null = OWN_RELAY): RTCIceServer[] {
  return ownRelay ? [ownRelay, ...PUBLIC_ICE_SERVERS] : [...PUBLIC_ICE_SERVERS];
}

const BROKER_ERRORS = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'ssl-unavailable', 'disconnected']);

/** The JoinError for a PeerJS error type while registering a room code. */
export function hostErrorKind(type: string): JoinErrorKind {
  if (type === 'unavailable-id') return 'code-taken';
  if (BROKER_ERRORS.has(type)) return 'broker-unreachable';
  return 'other';
}

/** The JoinError for a PeerJS error type while joining. */
export function joinErrorKind(type: string): JoinErrorKind {
  if (type === 'peer-unavailable') return 'no-room';
  if (BROKER_ERRORS.has(type)) return 'broker-unreachable';
  if (type === 'webrtc' || type === 'negotiation-failed' || type === 'connection-closed') return 'no-route';
  return 'other';
}

/** The JoinError when a join timed out: before or after the broker put us through to the room. */
export function joinTimeoutKind(askedForRoom: boolean): JoinErrorKind {
  return askedForRoom ? 'no-route' : 'broker-unreachable';
}

export const JOIN_ERROR_TEXT: Record<JoinErrorKind, string> = {
  'no-room': 'No game with that room code is open.',
  'broker-unreachable': 'Could not reach the matchmaking service. Check the internet connection and try again.',
  'no-route': 'Found the room, but the two browsers could not reach each other. This usually means a router, '
    + 'firewall or VPN is in the way, or both players are on the same wifi without a relay. Try another network '
    + '(a phone on mobile data, for example).',
  'code-taken': 'That room code is already in use.',
  timeout: 'The connection timed out.',
  other: 'Could not connect.',
};

export interface PeerTransportOptions {
  /** PeerJS console logging (off by default). */
  debug?: boolean;
  joinTimeoutMs?: number;
  hostTimeoutMs?: number;
  iceServers?: RTCIceServer[];
  /** Broker settings (host, port, path, secure) for a self-hosted PeerJS server. */
  broker?: Pick<PeerOptions, 'host' | 'port' | 'path' | 'secure' | 'key'>;
}

type PeerCtor = typeof PeerType;
let peerLib: Promise<PeerCtor> | null = null;

function loadPeer(): Promise<PeerCtor> {
  peerLib ??= import('peerjs').then(m => m.Peer ?? m.default);
  return peerLib;
}

const errType = (e: unknown): string => String((e as { type?: unknown } | null)?.type ?? 'other');

/** A PeerJS data connection as a raw Conn (before splitting). `onClosed` runs once when it closes. */
function wrapData(dc: DataConnection, onClosed?: () => void): Conn {
  let handler: ((msg: unknown) => void) | null = null;
  let queue: unknown[] = [];
  let open = true;
  const conn: Conn = {
    onclose: null,
    get open(): boolean { return open; },
    get onmessage(): ((msg: unknown) => void) | null { return handler; },
    set onmessage(fn: ((msg: unknown) => void) | null) {
      handler = fn;
      while (handler && queue.length > 0) handler(queue.shift());
    },
    send(msg: unknown): void {
      if (!open) return;
      try { void dc.send(msg); } catch { shut(); }
    },
    close(): void {
      if (!open) return;
      try { dc.close(); } catch { /* already closing */ }
      shut();
    },
  };
  const shut = (): void => {
    if (!open) return;
    open = false;
    queue = [];
    onClosed?.();
    conn.onclose?.();
  };
  dc.on('data', (m: unknown) => {
    if (!open) return;
    if (handler) handler(m); else queue.push(m);
  });
  dc.on('close', shut);
  dc.on('error', () => {
    // An error on an open data channel (too big, negotiation) leaves it unusable.
    try { dc.close(); } catch { /* ignore */ }
    shut();
  });
  return conn;
}

class PeerTransport implements Transport {
  constructor(private readonly opts: PeerTransportOptions) {}

  private peerOptions(): PeerOptions {
    return {
      ...(this.opts.broker ?? {}),
      debug: this.opts.debug ? 2 : 0,
      config: { iceServers: this.opts.iceServers ?? iceServers() },
    };
  }

  async host(code: string, onConnection: (conn: Conn) => void): Promise<HostHandle> {
    const Peer = await loadPeer();
    return new Promise<HostHandle>((resolve, reject) => {
      const peer = new Peer(hostPeerId(code), this.peerOptions());
      let ready = false;
      let closed = false;
      const conns = new Set<Conn>();
      const fail = (kind: JoinErrorKind, detail: string): void => {
        if (ready || closed) return;
        closed = true;
        globalThis.clearTimeout(timer);
        peer.destroy();
        reject(new JoinError(kind, kind === 'other' ? `${JOIN_ERROR_TEXT.other} (${detail})` : JOIN_ERROR_TEXT[kind]));
      };
      const timer = globalThis.setTimeout(() => fail('broker-unreachable', 'timeout'), this.opts.hostTimeoutMs ?? HOST_TIMEOUT_MS);

      peer.on('open', () => {
        if (closed) return;
        globalThis.clearTimeout(timer);
        if (ready) return; // a reconnect to the broker after a drop
        ready = true;
        resolve({
          close: (): void => {
            if (closed) return;
            closed = true;
            for (const c of [...conns]) c.close();
            peer.destroy();
          },
        });
      });
      peer.on('connection', (dc: DataConnection) => {
        dc.on('open', () => {
          if (closed) { dc.close(); return; }
          let raw: Conn | null = null;
          raw = wrapData(dc, () => { if (raw) conns.delete(raw); });
          conns.add(raw);
          onConnection(chunked(heartbeat(raw), PEER_CHUNK_BYTES));
        });
      });
      // Losing the broker does not end the game: players already connected keep their links.
      // Reconnect so new and returning players can find the room again.
      let backoff = 1000;
      peer.on('disconnected', () => {
        if (closed || peer.destroyed || !ready) return;
        const retry = (): void => {
          if (closed || peer.destroyed || !peer.disconnected) return;
          try { peer.reconnect(); } catch { /* try again below */ }
          backoff = Math.min(backoff * 2, 30_000);
          globalThis.setTimeout(retry, backoff);
        };
        globalThis.setTimeout(retry, 500);
      });
      peer.on('open', () => { backoff = 1000; });
      peer.on('error', (e: unknown) => fail(hostErrorKind(errType(e)), errType(e)));
    });
  }

  async join(code: string): Promise<Conn> {
    const Peer = await loadPeer();
    return new Promise<Conn>((resolve, reject) => {
      const peer = new Peer(joinerPeerId(), this.peerOptions());
      let done = false;
      let asked = false; // true once the broker has been asked to put us through to the host
      const fail = (kind: JoinErrorKind, detail: string): void => {
        if (done) return;
        done = true;
        globalThis.clearTimeout(timer);
        peer.destroy();
        reject(new JoinError(kind, kind === 'other' ? `${JOIN_ERROR_TEXT.other} (${detail})` : JOIN_ERROR_TEXT[kind]));
      };
      const timer = globalThis.setTimeout(() => fail(joinTimeoutKind(asked), 'timeout'), this.opts.joinTimeoutMs ?? JOIN_TIMEOUT_MS);

      peer.on('open', () => {
        if (done || asked) return;
        asked = true;
        const dc = peer.connect(hostPeerId(code), { reliable: true, serialization: 'json' });
        dc.on('open', () => {
          if (done) { dc.close(); return; }
          done = true;
          globalThis.clearTimeout(timer);
          // Once connected the broker is no longer needed; closing the link ends the peer too.
          const raw = wrapData(dc, () => { globalThis.setTimeout(() => peer.destroy(), 0); });
          resolve(chunked(heartbeat(raw), PEER_CHUNK_BYTES));
        });
        dc.on('error', (e: unknown) => fail(joinErrorKind(errType(e)), errType(e)));
      });
      peer.on('error', (e: unknown) => {
        if (done) return; // after connecting, broker trouble does not matter
        fail(joinErrorKind(errType(e)), errType(e));
      });
    });
  }
}

/** The PeerJS transport. */
export function peerTransport(opts: PeerTransportOptions = {}): Transport {
  return new PeerTransport(opts);
}
