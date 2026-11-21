// Where automatic saves live on a device. Saves are stored under `fs.save.<code>`.

import type { Room } from './room';
import { MAX_SAVE_BYTES, parseSaveFile, saveSummary, serializeSaveFile, toSave } from './save';
import type { JournalData } from './journal';
import { journalSeed, parseJournal } from './journal';

export interface SaveStore {
  get(key: string): string | null;
  /** Store a value; a store that cannot keep it durably may keep it for this page only. */
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
  /**
   * Store a value durably, or report that it could not be (a full browser store). Stores without
   * it (memory) always keep what is set.
   */
  tryPersist?(key: string, value: string): boolean;
}

/** How many saved games keep their move journals on this device (the newest ones). */
export const JOURNALS_KEPT = 5;

/** Store durably if the store can say so; true when stored. */
function persist(store: SaveStore, key: string, value: string): boolean {
  if (store.tryPersist) return store.tryPersist(key, value);
  store.set(key, value);
  return true;
}

export const SAVE_KEY_PREFIX = 'fs.save.';

export function saveKey(code: string): string {
  return SAVE_KEY_PREFIX + code;
}

export function memoryStore(): SaveStore {
  const data = new Map<string, string>();
  return {
    get: (k): string | null => data.get(k) ?? null,
    set: (k, v): void => { data.set(k, v); },
    remove: (k): void => { data.delete(k); },
    keys: (): string[] => [...data.keys()],
  };
}

/**
 * The browser's localStorage. When it is missing or refuses (private windows, blocked
 * site data, a full quota), saves fall back to memory for this page instead of failing.
 */
export function localStorageStore(): SaveStore {
  const fallback = memoryStore();
  const ls = (): Storage | null => {
    try {
      const s = (globalThis as { localStorage?: Storage }).localStorage;
      return s ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(k): string | null {
      try { const s = ls(); if (s) return s.getItem(k) ?? fallback.get(k); } catch { /* fall back */ }
      return fallback.get(k);
    },
    set(k, v): void {
      try { const s = ls(); if (s) { s.setItem(k, v); return; } } catch { /* fall back */ }
      fallback.set(k, v);
    },
    tryPersist(k, v): boolean {
      try {
        const s = ls();
        if (!s) return false;
        s.setItem(k, v);
        fallback.remove(k);
        return true;
      } catch {
        return false; // full, or storage blocked
      }
    },
    remove(k): void {
      try { ls()?.removeItem(k); } catch { /* ignore */ }
      fallback.remove(k);
    },
    keys(): string[] {
      const out = new Set(fallback.keys());
      try {
        const s = ls();
        if (s) for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k !== null) out.add(k); }
      } catch { /* ignore */ }
      return [...out];
    },
  };
}

/**
 * Write the room as this device's automatic save for its code. When the store is full, move
 * journals are given up for it (oldest games first, then all of them). Returns false when even
 * then the save could not be stored durably: it is kept for this page only, and the player
 * should be told to use a save link or file.
 */
export function writeSave(store: SaveStore, room: Room, meta: { savedAt: number; app: string }): boolean {
  try {
    const key = saveKey(room.code);
    const text = serializeSaveFile(toSave(room, meta));
    if (persist(store, key, text)) return true;
    for (const jk of journalKeysOldestFirst(store, room.code)) {
      store.remove(jk);
      if (persist(store, key, text)) return true;
    }
    store.set(key, text); // at least for this page
    return false;
  } catch {
    return false; // a broken store must never break the game
  }
}

/** Journal keys, those of the oldest saved games first and this room's own last. */
function journalKeysOldestFirst(store: SaveStore, code: string): string[] {
  const savedAt = new Map(listSaves(store).map(s => [journalKey(s.code), s.savedAt]));
  return store.keys()
    .filter(k => k.startsWith(JOURNAL_KEY_PREFIX))
    .sort((a, b) => {
      const own = Number(a === journalKey(code)) - Number(b === journalKey(code));
      return own || (savedAt.get(a) ?? -Infinity) - (savedAt.get(b) ?? -Infinity);
    });
}

/** Keep the journals of the JOURNALS_KEPT newest saved games (and of `code`); remove the rest. */
export function pruneJournals(store: SaveStore, code: string): void {
  try {
    const keep = new Set([journalKey(code), ...listSaves(store).slice(0, JOURNALS_KEPT).map(s => journalKey(s.code))]);
    for (const k of store.keys()) if (k.startsWith(JOURNAL_KEY_PREFIX) && !keep.has(k)) store.remove(k);
  } catch {
    // ignore: pruning is housekeeping
  }
}

// --- The move journal, kept beside the automatic save --------------------------------
// It lives under its own key (`fs.journal.<code>`) so listing the saved games stays quick.

export const JOURNAL_KEY_PREFIX = 'fs.journal.';

export function journalKey(code: string): string {
  return JOURNAL_KEY_PREFIX + code;
}

/** The journal key that belongs to a save key. */
export function journalKeyForSave(saveKeyText: string): string {
  return JOURNAL_KEY_PREFIX + saveKeyText.slice(SAVE_KEY_PREFIX.length);
}

/**
 * Store this device's journal for a room. A full store loses the journal, never the game: the
 * journal is never kept at a save's expense. Returns whether it was stored.
 */
export function writeJournal(store: SaveStore, code: string, journal: JournalData): boolean {
  try {
    return persist(store, journalKey(code), JSON.stringify(journal));
  } catch {
    return false; // ignore: the journal is a playtest aid
  }
}

/** This device's journal for a room, checked; null when there is none or it is unreadable. */
export function readJournal(store: SaveStore, code: string): JournalData | null {
  return parseStoredJournal(store.get(journalKey(code)));
}

function parseStoredJournal(text: string | null): JournalData | null {
  if (text === null || text.length > MAX_SAVE_BYTES * 2) return null;
  try {
    return parseJournal(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Every stored journal of the game with this seed (a save link carries no journal; this device may have one). */
export function findJournals(store: SaveStore, seed: number): JournalData[] {
  const out: JournalData[] = [];
  for (const key of store.keys()) {
    if (!key.startsWith(JOURNAL_KEY_PREFIX)) continue;
    const j = parseStoredJournal(store.get(key));
    if (j && journalSeed(j) === seed) out.push(j);
  }
  return out;
}

export type SaveListing = ReturnType<typeof saveSummary> & { key: string };

/** Every readable save in the store, newest first. Damaged entries are skipped. */
export function listSaves(store: SaveStore): SaveListing[] {
  const out: SaveListing[] = [];
  for (const key of store.keys()) {
    if (!key.startsWith(SAVE_KEY_PREFIX)) continue;
    const text = store.get(key);
    if (text === null) continue;
    try {
      out.push({ ...saveSummary(parseSaveFile(text)), key });
    } catch {
      // skip unreadable saves
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
