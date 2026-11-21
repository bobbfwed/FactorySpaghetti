// Room codes: five capital letters, without I and O (easily mistaken for 1 and 0).

export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 5;

const CODE_RE = new RegExp(`^[${CODE_LETTERS}]{${CODE_LENGTH}}$`);

/** A new random room code, from the platform's cryptographic random source. */
export function makeRoomCode(): string {
  const n = CODE_LETTERS.length;
  const limit = 256 - (256 % n); // reject bytes that would make some letters likelier
  let code = '';
  const buf = new Uint8Array(16);
  while (code.length < CODE_LENGTH) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      code += CODE_LETTERS[b % n];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

export function isRoomCode(text: string): boolean {
  return CODE_RE.test(text);
}

/**
 * The room code a person typed or pasted, or null if it is not one. Case, spaces and dashes
 * are ignored, and a pasted invite link (`...?join=ABCDE`) gives its code.
 */
export function normalizeCode(text: string): string | null {
  const fromLink = /[?&#]join=([^&#\s]*)/i.exec(text);
  const raw = fromLink ? decodeSafe(fromLink[1] ?? '') : text;
  const code = raw.toUpperCase().replace(/[\s-]+/g, '');
  return isRoomCode(code) ? code : null;
}

/** An invite link: `base` with `?join=CODE` (any `#...` part, such as a save, is dropped). */
export function inviteLink(base: string, code: string): string {
  const url = new URL(base);
  url.hash = '';
  url.searchParams.set('join', code);
  return url.toString();
}

/** The room code in a page address's query (`location.search`), or null. */
export function codeFromLocation(search: string): string | null {
  const value = new URLSearchParams(search).get('join');
  return value === null ? null : normalizeCode(value);
}

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
