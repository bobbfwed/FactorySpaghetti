// The connection contract shared by every transport (in-memory, same-browser tabs, PeerJS).
// Sessions only ever see this interface, so they cannot tell which transport is in use.

/** A two-way message channel. Messages are plain JSON-serialisable values. */
export interface Conn {
  /** Send one message. Silently ignored after close. */
  send(msg: unknown): void;
  /** Close the channel; the other side's onclose fires once. */
  close(): void;
  /** Message handler. Messages that arrive before a handler is set are queued and delivered when it is set. */
  onmessage: ((msg: unknown) => void) | null;
  /** Called exactly once when the channel closes, from either side. */
  onclose: (() => void) | null;
  /** True until the channel has closed. */
  readonly open: boolean;
}

/** Why a join attempt failed, so the interface can say something useful. */
export type JoinErrorKind =
  | 'no-room'             // nobody is hosting that code
  | 'broker-unreachable'  // the matchmaking service could not be reached
  | 'no-route'            // the room exists but the two browsers could not connect (router / firewall)
  | 'code-taken'          // host only: that room code is already registered
  | 'timeout'
  | 'other';

export class JoinError extends Error {
  constructor(public readonly kind: JoinErrorKind, message: string) {
    super(message);
    this.name = 'JoinError';
  }
}

/** A listening host. */
export interface HostHandle {
  /** Stop accepting connections and release the room code. Existing connections are closed. */
  close(): void;
}

/** One way of connecting browsers. */
export interface Transport {
  /** Start hosting under a room code. Rejects with JoinError ('code-taken', 'broker-unreachable', ...). */
  host(code: string, onConnection: (conn: Conn) => void): Promise<HostHandle>;
  /** Connect to the host of a room code. Rejects with JoinError. */
  join(code: string): Promise<Conn>;
}
