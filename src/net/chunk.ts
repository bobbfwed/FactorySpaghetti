// Message splitting. PeerJS refuses a JSON message of about 16,300 bytes or more, and a whole
// room late in a game is about 33 KB, so any message bigger than a limit is cut into parts
// here and put back together on the other side. Sessions never see the parts.

import type { Conn } from './conn';

/** The `t` of a part envelope. Reserved: no session message may use it. */
export const PART = '~part';

/**
 * Largest message put back together from parts, by default (a whole journal of a long game with
 * the room is about 1 MB). A host takes much less from a client: see MAX_TO_HOST_BYTES.
 */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
/** Largest message a host accepts from a client (moves and commands are tiny). */
export const MAX_TO_HOST_BYTES = 256 * 1024;

/** At most this many messages may be half-received at once; the oldest is dropped beyond it. */
export const MAX_OPEN_MESSAGES = 8;

/** Bytes a string takes as UTF-8. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** Bytes one UTF-16 unit (or surrogate pair, `pair`) takes once written inside a JSON string. */
function jsonCharBytes(c: number, pair: boolean): number {
  if (pair) return 4;
  if (c === 0x22 || c === 0x5c) return 2;                     // \" and \\
  if (c < 0x20) return c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6; // \n or \u0001
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c >= 0xd800 && c <= 0xdfff) return 6;                   // a lone surrogate is written as \udxxx
  return 3;
}

interface Part { t: typeof PART; id: number; i: number; n: number; d: string }

/** Cut JSON text into pieces whose part envelopes each fit in `maxBytes` of UTF-8 JSON. */
export function splitText(text: string, id: number, maxBytes: number): Part[] {
  // The envelope around a piece, with room for the largest index and count we could need.
  const overhead = utf8Length(JSON.stringify({ t: PART, id, i: 9_999_999, n: 9_999_999, d: '' }));
  const budget = maxBytes - overhead;
  if (budget < 16) throw new Error(`chunked: a limit of ${maxBytes} bytes leaves no room for data`);
  const pieces: string[] = [];
  let start = 0;
  let used = 0;
  for (let i = 0; i < text.length;) {
    const c = text.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && isLow(text.charCodeAt(i + 1));
    const width = pair ? 2 : 1;
    const bytes = jsonCharBytes(c, pair);
    if (used + bytes > budget) {
      pieces.push(text.slice(start, i));
      start = i;
      used = 0;
    }
    used += bytes;
    i += width;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces.map((d, i) => ({ t: PART, id, i, n: pieces.length, d }));
}

function asPart(msg: object): Part | null {
  const { id, i, n, d } = msg as Record<string, unknown>;
  if (typeof id !== 'number' || typeof d !== 'string') return null;
  if (!Number.isInteger(n) || !Number.isInteger(i)) return null;
  const count = n as number;
  const index = i as number;
  if (count < 1 || count > 1_000_000 || index < 0 || index >= count) return null;
  return { t: PART, id, i: index, n: count, d };
}

interface OpenMessage { n: number; got: number; bytes: number; parts: (string | undefined)[] }

class ChunkedConn implements Conn {
  onclose: (() => void) | null = null;
  private handler: ((msg: unknown) => void) | null = null;
  private queue: unknown[] = [];
  private nextId = 1;
  private readonly openMessages = new Map<number, OpenMessage>();

  /** Most parts one message may have, from the size limit and the part size. */
  private readonly maxParts: number;

  constructor(private readonly raw: Conn, private readonly maxBytes: number, private readonly maxMessage: number) {
    this.maxParts = Math.ceil(maxMessage / Math.max(16, maxBytes - 64)) + 1;
    raw.onmessage = (m): void => this.receive(m);
    raw.onclose = (): void => { this.openMessages.clear(); this.onclose?.(); };
  }

  get open(): boolean { return this.raw.open; }

  get onmessage(): ((msg: unknown) => void) | null { return this.handler; }
  set onmessage(fn: ((msg: unknown) => void) | null) {
    this.handler = fn;
    while (this.handler && this.queue.length > 0) this.handler(this.queue.shift());
  }

  send(msg: unknown): void {
    if (!this.raw.open) return;
    const text = JSON.stringify(msg);
    // Most messages are small; only measure properly when the size could matter.
    if (text === undefined || text.length * 3 <= this.maxBytes || utf8Length(text) <= this.maxBytes) {
      this.raw.send(msg);
      return;
    }
    for (const part of splitText(text, this.nextId++, this.maxBytes)) this.raw.send(part);
  }

  close(): void {
    this.raw.close();
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null || (raw as { t?: unknown }).t !== PART) { this.deliver(raw); return; }
    const part = asPart(raw);
    if (!part) return; // a malformed part is dropped, never handed to the session
    // A message announced as larger than allowed, or growing past the limit, ends the connection:
    // only a broken or hostile peer sends one.
    if (part.n > this.maxParts) { this.refuse(); return; }
    let job = this.openMessages.get(part.id);
    if (job && job.n !== part.n) return; // inconsistent part: ignore it
    if (!job) {
      job = { n: part.n, got: 0, bytes: 0, parts: new Array<string | undefined>(part.n) };
      this.openMessages.set(part.id, job);
      // A message whose other parts never come (a link that dropped half way) is forgotten.
      if (this.openMessages.size > MAX_OPEN_MESSAGES) {
        const oldest = this.openMessages.keys().next().value;
        if (oldest !== undefined) this.openMessages.delete(oldest);
      }
    }
    if (job.parts[part.i] !== undefined) return; // a duplicate
    job.bytes += part.d.length;
    let held = 0;
    for (const m of this.openMessages.values()) held += m.bytes;
    if (job.bytes > this.maxMessage || held > this.maxMessage * 2) { this.refuse(); return; }
    job.parts[part.i] = part.d;
    job.got++;
    if (job.got < job.n) return;
    this.openMessages.delete(part.id);
    let msg: unknown;
    try { msg = JSON.parse(job.parts.join('')); } catch { return; }
    this.deliver(msg);
  }

  private refuse(): void {
    this.openMessages.clear();
    this.raw.close();
  }

  private deliver(msg: unknown): void {
    if (this.handler) this.handler(msg);
    else this.queue.push(msg);
  }
}

/**
 * Wrap a raw connection so that a message whose JSON is bigger than `maxBytes` of UTF-8 travels
 * as several parts (`{t:'~part', id, i, n, d}`), each within the limit, and arrives whole.
 * Both ends must be wrapped. Messages that arrive before a handler is set are queued.
 * maxMessage caps the size of a message put back together (the connection is closed beyond it).
 */
export function chunked(raw: Conn, maxBytes: number, maxMessage = MAX_MESSAGE_BYTES): Conn {
  return new ChunkedConn(raw, maxBytes, maxMessage);
}
