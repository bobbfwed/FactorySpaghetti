// Where automatic saves live on a device. Saves are stored under `fs.save.<code>`.

import type { Room } from './room';
import { parseSaveFile, saveSummary, serializeSaveFile, toSave } from './save';

export interface SaveStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
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

/** Write the room as this device's automatic save for its code. */
export function writeSave(store: SaveStore, room: Room, meta: { savedAt: number; app: string }): void {
  try {
    store.set(saveKey(room.code), serializeSaveFile(toSave(room, meta)));
  } catch {
    // A full or broken store must never break the game.
  }
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
