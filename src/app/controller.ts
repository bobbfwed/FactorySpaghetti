// The app controller: every decision the app shell makes, with no DOM access, so it runs in
// Vitest. It knows the current screen, who this device is (name + device token), the room it
// is in (through OnlineRoom), saving and resuming, and how to word every failure. Views read
// `state`, call methods, and re-render on `subscribe`.
//
// Everything external is injected: transports, storage, clipboard, sharing, downloads, the
// page address, and the clock.

import type { Action } from '../engine/actions';
import type { JoinErrorKind, Transport } from '../net/conn';
import { JoinError } from '../net/conn';
import { CODE_LETTERS, codeFromLocation, inviteLink, normalizeCode } from '../net/roomCode';
import type { OnlineOptions } from '../online/onlineRoom';
import { OnlineRoom } from '../online/onlineRoom';
import { autoplay } from '../online/autoplay';
import type { ActResult } from '../session/clientSession';
import { chooseSuccessor } from '../session/seating';
import type { Room, RoomSettings, SeatColor } from '../session/room';
import { NAME_MAX, cleanName } from '../session/room';
import type { SaveEnvelope, SaveErrorKind } from '../session/save';
import { SaveError, packLink, parseSaveFile, sameRules, saveFromHash, saveSummary, serializeSaveFile, toSave, unpackLink } from '../session/save';
import type { SaveListing, SaveStore } from '../session/store';
import { findJournals, journalKey, listSaves, readJournal, saveKey } from '../session/store';
import type { Scheduler } from '../session/scheduler';
import { realScheduler } from '../session/scheduler';
import type { BotSpeed } from '../session/pacing';
import { botPauseMs, lastMoveOf } from '../session/pacing';
import type { JournalData } from '../session/journal';
import { journalFrom, journalMatches, partialJournal } from '../session/journal';
import type { RefusedMove } from '../session/clientSession';
import type { ReplayCursor, ReplayFile } from '../session/replay';
import { ReplayError, makeReplay, replayFileName, serializeReplay, verifyReplay } from '../session/replay';
import type { ReportFile } from '../session/report';
import { makeReport, openPlaytestText, reportFileName, serializeReport } from '../session/report';

export type Screen = 'menu' | 'lobby' | 'game' | 'resume-setup' | 'replay';

/** The replay viewer: a replay being checked, then ready to step through. */
export interface ReplayScreen {
  status: 'checking' | 'ready';
  /** Share of the moves checked so far (0 to 1). */
  progress: number;
  /** What was opened: a replay file, a rules-problem report, a save file, or the game on this device. */
  kind: 'replay' | 'report' | 'save' | 'this-game';
  replay: ReplayFile;
  cursor: ReplayCursor | null;
  report: ReportFile | null;
  /** For a report: the replay's last position is the reported position (null until checked). */
  matchesReport: boolean | null;
}

/** The "Report a rules problem" dialog. */
export interface ReportDialog {
  /** The file name once it was made (the dialog then says what to do with it). */
  saved: string | null;
}
export type TransportKind = 'internet' | 'local' | 'solo';

export interface AppLocation {
  /** `location.search`, e.g. "?join=ABCDE&t=local". */
  search: string;
  /** `location.hash`, e.g. "#save=v1.…". */
  hash: string;
  /** The page address without query or fragment, used to build invite and save links. */
  base: string;
  /** Remove the fragment from the address bar (so a reload does not open the save again). */
  clearHash(): void;
}

export interface ShareData {
  title: string;
  text: string;
  url?: string;
  file?: { name: string; text: string };
}

export interface AppDeps {
  /** A transport of the given kind. 'solo' must need no network (an in-memory hub). */
  transport(kind: TransportKind): Transport;
  /** Where this device keeps its automatic saves. */
  saves: SaveStore;
  /** Where this device keeps its name and device token. */
  identity: SaveStore;
  location: AppLocation;
  appVersion: string;
  /** Write text to the clipboard; reject when not allowed. Absent: the link is shown instead. */
  clipboard?: (text: string) => Promise<void>;
  /** The Web Share API, when the browser has it. Reject with name 'AbortError' when cancelled. */
  share?: (data: ShareData) => Promise<void>;
  /** Hand the browser a file to save. */
  download?: (name: string, text: string) => void;
  scheduler?: Scheduler;
  /** 32 hexadecimal characters; defaults to the platform's cryptographic random source. */
  randomToken?: () => string;
  /** Overrides for every OnlineRoom (tests shorten retries and timeouts). */
  online?: Partial<OnlineOptions>;
  /** Pause before each autoplay move. Default: the room's bot speed (see session/pacing.ts). */
  autoplayDelayMs?: number;
  /** True when the device knows it has no connection (navigator.onLine === false). */
  isOffline?: () => boolean;
}

export interface ResumeSetup {
  save: SaveEnvelope;
  source: 'device' | 'link' | 'file';
  summary: ReturnType<typeof saveSummary>;
  sameRules: boolean;
  /** The saved player (human) seats; one of them is "you". */
  seats: { index: number; name: string; color: SeatColor }[];
  chosen: number | null;
}

export interface LinkBox {
  title: string;
  text: string;
  hint: string;
}

export interface AppState {
  name: string;
  /** A room code to show in the join boxes (from `?join=` or typed). */
  joinCode: string;
  /** Which menu field to focus first (from `?join=`). */
  focus: 'name' | 'join' | null;
  transportKind: 'internet' | 'local';
  busy: string | null;
  error: string | null;
  notice: string | null;
  linkBox: LinkBox | null;
  saves: SaveListing[];
  resume: ResumeSetup | null;
  online: OnlineRoom | null;
  solo: boolean;
  autoplay: boolean;
  /** The last refused move of this player (the code says why; see refusalText in gameText.ts). */
  moveError: { code: string; message: string } | null;
  installAvailable: boolean;
  /** How to install on this browser when it offers no install button, or null. */
  installNote: string | null;
  /** The replay viewer, when open (it shows over whatever else is going on). */
  replay: ReplayScreen | null;
  /**
   * This device could not store the automatic save of the current game (its storage is full or
   * blocked): the interface should say "use Save link or Download save file".
   */
  cannotStore: boolean;
  /** The rules-problem dialog, when open. */
  report: ReportDialog | null;
}

export interface Banner {
  kind: 'reconnecting' | 'taking-over' | 'lost' | 'closed';
  text: string;
  actions: ('host-copy' | 'menu' | 'reload')[];
}

export const NAME_KEY = 'fs.name';
export const TOKEN_KEY = 'fs.token';
const NOTICE_MS = 5000;

// ── Words ────────────────────────────────────────────────────────────────────────

export function joinErrorMessage(kind: JoinErrorKind, code: string | null, detail?: string): string {
  switch (kind) {
    case 'no-room':
      return code ? `There is no game with the code ${code}. Check the code, or ask the host whether the room is still open.`
        : 'There is no game with that code.';
    case 'broker-unreachable':
      return 'Could not reach the matchmaking service. Check your internet connection and try again.';
    case 'no-route':
      return 'Found the room, but could not connect to the host. A router, firewall or VPN is usually in the way. '
        + 'Try a different network (a phone on mobile data, for example), or open the network check page.';
    case 'timeout':
      return 'The connection timed out. Try again; if it keeps happening, open the network check page.';
    case 'code-taken':
      return 'That room code is already in use. Try again for a new code.';
    case 'other':
      return detail || 'Could not connect.';
  }
}

/** Plain words for any failure while hosting or joining. */
export function connectErrorMessage(e: unknown, code: string | null): string {
  if (e instanceof JoinError) return joinErrorMessage(e.kind, code, e.message);
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong while connecting.';
}

const SAVE_TEXT: Record<SaveErrorKind, string> = {
  truncated: 'This save link is incomplete. It was probably cut off when it was sent; ask for the save file instead.',
  corrupt: 'This is not a Factory Spaghetti save.',
  'unsupported-version': 'This save was made by a newer version of the game. Reload the page to update, then try again.',
  invalid: 'This save is damaged and cannot be resumed.',
};

export function saveErrorMessage(e: unknown, source: 'device' | 'link' | 'file'): string {
  if (e instanceof SaveError) {
    if (e.kind === 'truncated' && source === 'file') return 'This save file is incomplete. It may not have finished downloading.';
    return SAVE_TEXT[e.kind];
  }
  return 'Could not read this save.';
}

const CLOSED_TEXT: Record<string, string> = {
  full: 'The game is full.',
  version: 'The host runs a different version of the game. Reload the page to update.',
  kicked: 'The host removed you from this game.',
  ended: 'The host ended the game.',
  replaced: 'This seat was opened on another device or tab, so this one was disconnected.',
  invalid: 'The host did not accept this player name or device.',
};

/** The connection banner for a room, or null while all is well. */
export function connectionBanner(online: OnlineRoom): Banner | null {
  const room = online.client.room;
  switch (online.status) {
    case 'online':
      return null;
    case 'reconnecting': {
      const next = room ? chooseSuccessor(room) : null;
      const name = next !== null ? room?.seats[next]?.name : undefined;
      const who = next !== null && next === online.client.seat ? 'you will take over as host' : name ? `${name} will take over` : 'another player will take over';
      return { kind: 'reconnecting', text: `Lost the connection to the host. Reconnecting… If the host has left, ${who}.`, actions: [] };
    }
    case 'taking-over':
      return { kind: 'taking-over', text: 'The host left. You are taking over as host…', actions: [] };
    case 'lost':
      return {
        kind: 'lost',
        text: 'Could not reach anyone hosting this game. This device still holds the game as it was; you can host it from this copy.',
        actions: room && online.client.seat !== null ? ['host-copy', 'menu'] : ['menu'],
      };
    case 'closed': {
      const why = online.closedWhy;
      return {
        kind: 'closed',
        text: (why && CLOSED_TEXT[why]) || 'The room closed.',
        actions: why === 'version' ? ['reload', 'menu'] : ['menu'],
      };
    }
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "saved today 14:05", "saved yesterday", "saved Tuesday", "saved 3 Nov". */
export function savedWhen(savedAt: number, now: number): string {
  const d = new Date(savedAt);
  const n = new Date(now);
  const day = (x: Date): number => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(n) - day(d);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff <= 0) return `saved today ${hhmm}`;
  if (diff === 1) return 'saved yesterday';
  if (diff < 7) return `saved ${DAY_NAMES[d.getDay()]}`;
  return `saved ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** Five code letters from whatever was typed or pasted (an invite link gives its code). */
export function cleanCodeInput(text: string): string {
  const full = normalizeCode(text);
  if (full) return full;
  let out = '';
  for (const ch of text.toUpperCase()) {
    if (CODE_LETTERS.includes(ch)) out += ch;
    if (out.length === 5) break;
  }
  return out;
}

/** The notice when a new host never had moves this device saw, and they could not all be made again. */
export function rollbackText(r: { at: number; lost: number }): string {
  const moves = r.lost === 1 ? 'move' : `${r.lost} moves`;
  return `The new host had not received ${r.lost === 1 ? 'a move' : `${r.lost} moves`} seen on this device after move ${r.at}, `
    + `so the game went on without ${r.lost === 1 ? 'it' : 'them'}. Make your ${moves} again if still allowed.`;
}

/** The page's own address: origin and path only (no query such as ?debug, no fragment). */
export function pageAddress(base: string): string {
  try {
    const url = new URL(base);
    return url.origin + url.pathname;
  } catch {
    return base.replace(/[?#].*$/, '');
  }
}

/**
 * An invite link: the page plus ?join=CODE. A room on the same-browser transport (tabs of one
 * browser, for testing) keeps t=local, since its invite only works that way.
 */
export function inviteUrl(base: string, code: string, sameBrowser: boolean): string {
  const link = inviteLink(pageAddress(base), code);
  return sameBrowser ? `${link}&t=local` : link;
}

/** A save link: the page plus #save=…, and nothing else (a save opens on any device and transport). */
export function saveUrl(base: string, packed: string): string {
  return `${pageAddress(base)}#save=${packed}`;
}

/** Whether anyone has rolled the dice yet in this game (from the journal when it starts at the beginning). */
export function hasRolled(room: Room, journal: JournalData | null): boolean {
  const g = room.game;
  if (!g) return false;
  if (journal && journalFrom(journal) === 0) return journal.moves.some(m => m.type === 'ROLL_DICE');
  return true; // a resumed game, or no journal: assume it has, and keep it
}

/** A saved game with a single person and bots in every other seat (it needs no network). */
export function isSoloSave(save: SaveEnvelope): boolean {
  return save.room.seats.filter(s => s.kind === 'human').length === 1;
}

export function makeDeviceToken(): string {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

// ── Controller ─────────────────────────────────────────────────────────────────────

export class AppController {
  state: AppState;
  readonly token: string;
  /** Settles once the start-up work (a save in the address) is done. */
  readonly ready: Promise<void>;

  private readonly deps: AppDeps;
  private readonly sched: Scheduler;
  private readonly listeners = new Set<() => void>();
  private offRoom: (() => void) | null = null;
  private stopAuto: (() => void) | null = null;
  private noticeTimer: unknown = null;
  private installer: (() => void) | null = null;

  constructor(deps: AppDeps) {
    this.deps = deps;
    this.sched = deps.scheduler ?? realScheduler;
    const savedName = cleanName(deps.identity.get(NAME_KEY) ?? '').slice(0, NAME_MAX);
    let token = deps.identity.get(TOKEN_KEY) ?? '';
    if (!/^[0-9a-f]{32}$/.test(token)) {
      token = (deps.randomToken ?? makeDeviceToken)();
      deps.identity.set(TOKEN_KEY, token);
    }
    this.token = token;
    const params = new URLSearchParams(deps.location.search);
    const joinCode = codeFromLocation(deps.location.search) ?? '';
    this.state = {
      name: savedName,
      joinCode,
      focus: joinCode ? (savedName ? 'join' : 'name') : null,
      transportKind: params.get('t') === 'local' ? 'local' : 'internet',
      busy: null,
      error: null,
      notice: null,
      linkBox: null,
      saves: listSaves(deps.saves),
      resume: null,
      online: null,
      solo: false,
      autoplay: false,
      moveError: null,
      installAvailable: false,
      installNote: null,
      replay: null,
      cannotStore: false,
      report: null,
    };
    const fromHash = saveFromHash(deps.location.hash);
    if (fromHash !== null) {
      deps.location.clearHash();
      this.ready = this.loadSaveText(fromHash, 'link');
    } else {
      this.ready = Promise.resolve();
    }
  }

  // ── Plumbing ────────────────────────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  get screen(): Screen {
    if (this.state.replay) return 'replay';
    if (this.state.resume) return 'resume-setup';
    const room = this.state.online?.client.room;
    if (!this.state.online || !room) return 'menu';
    if (room.phase === 'lobby' || room.hold) return 'lobby';
    return 'game';
  }

  /** The room as this device last saw it. */
  get room(): Room | null {
    return this.state.online?.client.room ?? null;
  }

  get mySeat(): number | null {
    return this.state.online?.client.seat ?? null;
  }

  get banner(): Banner | null {
    return this.state.online ? connectionBanner(this.state.online) : null;
  }

  /** Milliseconds until a host-clock deadline. */
  msLeft(deadline: number | null): number | null {
    return this.state.online ? this.state.online.client.msLeft(deadline) : null;
  }

  get canShare(): boolean {
    return !!this.deps.share;
  }

  private notify(text: string): void {
    if (this.noticeTimer !== null) this.sched.clearTimeout(this.noticeTimer);
    this.noticeTimer = this.sched.setTimeout(() => {
      this.noticeTimer = null;
      if (this.state.notice === text) this.set({ notice: null });
    }, NOTICE_MS);
    this.set({ notice: text });
  }

  dismissError(): void { this.set({ error: null, moveError: null }); }
  dismissLinkBox(): void { this.set({ linkBox: null }); }

  // ── Identity ────────────────────────────────────────────────────────────────────

  setName(raw: string): void {
    const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, NAME_MAX);
    this.deps.identity.set(NAME_KEY, name.trim());
    this.state = { ...this.state, name };
    // No emit: the name field owns its text while the player types.
  }

  /** The name to use, or null (with an error shown) when it is empty. */
  private validName(): string | null {
    const name = cleanName(this.state.name).slice(0, NAME_MAX).trim();
    if (name.length === 0) {
      this.set({ error: 'Enter your name first (1 to 20 characters).', focus: 'name' });
      return null;
    }
    return name;
  }

  setJoinCode(text: string): string {
    const code = cleanCodeInput(text);
    this.state = { ...this.state, joinCode: code };
    return code;
  }

  // ── Install hint ───────────────────────────────────────────────────────────────

  /** Called by the install shell when the browser offers (or withdraws) installing. */
  setInstaller(fn: (() => void) | null): void {
    this.installer = fn;
    this.set({ installAvailable: fn !== null });
  }

  install(): void {
    const fn = this.installer;
    this.setInstaller(null);
    fn?.();
  }

  /** A short "how to install" note for browsers that never offer an install button (see install.ts). */
  setInstallNote(text: string | null): void {
    this.set({ installNote: text });
  }

  dismissInstall(): void { this.set({ installAvailable: false, installNote: null }); }

  // ── Rooms ───────────────────────────────────────────────────────────────────────

  private options(kind: TransportKind, name: string): OnlineOptions {
    return {
      transport: this.deps.transport(kind),
      name,
      token: this.token,
      store: this.deps.saves,
      appVersion: this.deps.appVersion,
      ...(this.deps.scheduler ? { scheduler: this.deps.scheduler } : {}),
      ...this.deps.online,
    };
  }

  private attach(online: OnlineRoom, solo: boolean): void {
    this.detach();
    this.offRoom = online.subscribe(() => this.onRoomChange());
    this.set({ online, solo, busy: null, error: null, resume: null, moveError: null, autoplay: false });
  }

  private detach(): void {
    this.offRoom?.();
    this.offRoom = null;
    this.stopAutoplay();
  }

  private onRoomChange(): void {
    const o = this.state.online;
    if (o && o.status === 'closed') this.stopAutoplay();
    const cannotStore = !!o?.client.storageFailed;
    if (cannotStore !== this.state.cannotStore) this.state = { ...this.state, cannotStore };
    const undone = o?.client.takeRollback();
    if (undone) {
      this.notify(rollbackText(undone));
    }
    this.emit();
  }

  private async connect(busy: string, code: string | null, fn: () => Promise<OnlineRoom>, solo = false): Promise<OnlineRoom | null> {
    if (this.state.busy) return null;
    this.set({ busy, error: null });
    try {
      const online = await fn();
      this.attach(online, solo);
      return online;
    } catch (e) {
      this.set({ busy: null, error: connectErrorMessage(e, code) });
      return null;
    }
  }

  async host(): Promise<void> {
    const name = this.validName();
    if (!name) return;
    if (this.needsConnection(this.state.transportKind, 'Hosting a game')) return;
    await this.connect('Opening a room…', null, () => OnlineRoom.host(this.options(this.state.transportKind, name)));
  }

  async join(text?: string): Promise<void> {
    const name = this.validName();
    if (!name) return;
    const code = normalizeCode(text ?? this.state.joinCode);
    if (!code) {
      this.set({ error: 'A room code is five letters (there is no I or O).', focus: 'join' });
      return;
    }
    this.state = { ...this.state, joinCode: code };
    if (this.needsConnection(this.state.transportKind, 'Joining a game')) return;
    await this.connect(`Joining ${code}…`, code, () => OnlineRoom.join({ ...this.options(this.state.transportKind, name), code }));
  }

  /** A game against bots on this device only: an in-memory room with bots in every other seat. */
  async solo(): Promise<void> {
    const name = this.validName();
    if (!name) return;
    const online = await this.connect('Setting up the table…', null, () => OnlineRoom.host(this.options('solo', name)), true);
    if (!online) return;
    await this.fillSolo();
  }

  private async fillSolo(): Promise<void> {
    const online = this.state.online;
    const room = online?.client.room;
    if (!online || !room || room.phase !== 'lobby') return;
    for (const s of room.seats) {
      if (s.kind === 'open') await online.client.setSeat(s.index, 'bot', 'greedy');
    }
    await online.client.setReady(true);
  }

  /** Leave the room on purpose and go back to the menu. A solo room ends; a host hands over. */
  leave(): void {
    const online = this.state.online;
    const solo = this.state.solo;
    // A solo game left before its first roll is not worth keeping: nothing has happened yet.
    const room = online?.client.room ?? null;
    const untouched = solo && !!room?.game && !room.game.gameOver && !hasRolled(room, online?.client.journal ?? null);
    this.detach();
    online?.leave(solo ? { endRoom: true } : {});
    if (untouched && room) this.forget(saveKey(room.code), room.code);
    this.set({
      online: null, solo: false, error: null, moveError: null, linkBox: null, report: null, saves: listSaves(this.deps.saves), focus: null,
    });
  }

  backToMenu(): void {
    this.leave();
  }

  // ── Lobby ───────────────────────────────────────────────────────────────────────

  private async command(p: Promise<ActResult> | null): Promise<boolean> {
    if (!p) return false;
    const res = await p;
    if (!res.ok) { this.set({ error: res.error.message }); return false; }
    return true;
  }

  private get client(): OnlineRoom['client'] | null {
    return this.state.online?.client ?? null;
  }

  setReady(ready: boolean): Promise<boolean> { return this.command(this.client?.setReady(ready) ?? null); }
  setColor(color: SeatColor): Promise<boolean> { return this.command(this.client?.setColor(color) ?? null); }
  kick(seat: number): Promise<boolean> { return this.command(this.client?.kick(seat) ?? null); }
  start(): Promise<boolean> { return this.command(this.client?.start() ?? null); }
  continueGame(): Promise<boolean> { return this.command(this.client?.resumeGame() ?? null); }
  assign(waitingId: string, seat: number): Promise<boolean> { return this.command(this.client?.assign(waitingId, seat) ?? null); }
  seatToBot(seat: number): Promise<boolean> { return this.command(this.client?.setSeat(seat, 'bot', 'greedy') ?? null); }
  openSeat(seat: number): Promise<boolean> { return this.command(this.client?.setSeat(seat, 'open') ?? null); }

  /** The host sets how fast bots move (lobby or game): 'instant', 'fast' or 'normal'. */
  setBotSpeed(speed: BotSpeed): Promise<boolean> {
    return this.command(this.client?.configure({ botSpeed: speed }) ?? null);
  }

  async configure(patch: Partial<RoomSettings>): Promise<boolean> {
    const ok = await this.command(this.client?.configure(patch) ?? null);
    if (ok && this.state.solo) await this.fillSolo();
    return ok;
  }

  copyInvite(): Promise<void> {
    const online = this.state.online;
    if (!online) return Promise.resolve();
    const link = inviteUrl(this.deps.location.base, online.code, this.state.transportKind === 'local' && !this.state.solo);
    return this.copy(link, 'Invite link copied. Send it to the other players.', 'Invite link');
  }

  inviteText(): string {
    const online = this.state.online;
    if (!online) return '';
    return inviteUrl(this.deps.location.base, online.code, this.state.transportKind === 'local' && !this.state.solo);
  }

  private async copy(text: string, done: string, title: string): Promise<void> {
    const write = this.deps.clipboard;
    if (write) {
      try {
        await write(text);
        this.notify(done);
        return;
      } catch {
        // fall through to the text box
      }
    }
    this.set({ linkBox: { title, text, hint: 'Copying is not available here. Select the text and copy it by hand.' } });
  }

  // ── Playing ─────────────────────────────────────────────────────────────────────

  async act(action: Action): Promise<boolean> {
    const client = this.client;
    if (!client) return false;
    const res = await client.act(action);
    if (!res.ok) { this.set({ moveError: res.error }); return false; }
    if (this.state.moveError) this.set({ moveError: null });
    return true;
  }

  roll(): Promise<boolean> {
    return this.act({ type: 'ROLL_DICE', rolls: [] });
  }

  toggleAutoplay(): void {
    if (this.stopAuto) { this.stopAutoplay(); this.emit(); return; }
    const client = this.client;
    if (!client) return;
    this.stopAuto = autoplay(client, {
      // As fast as the room's bot speed: paced so each move can be followed on the table.
      delayMs: this.deps.autoplayDelayMs ?? ((room, offTurn): number => botPauseMs(room.settings, lastMoveOf(room.lastEvents), offTurn)),
      ...(this.deps.scheduler ? { scheduler: this.deps.scheduler } : {}),
    });
    this.set({ autoplay: true });
  }

  private stopAutoplay(): void {
    if (!this.stopAuto) return;
    this.stopAuto();
    this.stopAuto = null;
    this.state = { ...this.state, autoplay: false };
  }

  /** Take a seat back from the host's stand-in bot. */
  takeSeatBack(): Promise<boolean> {
    const seat = this.mySeat;
    return this.command(seat === null ? null : this.client?.setAutopilot(seat, false) ?? null);
  }

  // ── Saving ──────────────────────────────────────────────────────────────────────

  private currentSave(forLink: boolean): SaveEnvelope | null {
    const room = this.room;
    if (!room || !room.game) {
      this.set({ error: 'There is no game to save yet.' });
      return null;
    }
    // A save file carries the moves so far (for the replay tool); a save link never does.
    return toSave(room, { savedAt: this.sched.now(), app: this.deps.appVersion }, { forLink, journal: forLink ? null : this.journal });
  }

  /** This device's journal of the current game, when it reaches the current move. */
  get journal(): JournalData | null {
    const client = this.client;
    return client && client.journalCurrent ? client.journal : null;
  }

  /** Write this device's move journal now (the page is being hidden or closed). */
  flushJournal(): void {
    this.state.online?.client.flushJournal();
  }

  /** The last move of this player the host refused in this session, with the reason. */
  get lastRefused(): RefusedMove | null {
    return this.client?.lastRefused ?? null;
  }

  /** The save link for the current game, or null. */
  async saveLink(): Promise<string | null> {
    const save = this.currentSave(true);
    if (!save) return null;
    return saveUrl(this.deps.location.base, await packLink(save));
  }

  async copySaveLink(): Promise<void> {
    const link = await this.saveLink();
    if (!link) return;
    const long = link.length > 2000 ? ' It is long: if a message app cuts it off, send the save file instead.' : '';
    await this.copy(link, `Save link copied (${link.length.toLocaleString('en-US')} characters).${long}`, 'Save link');
  }

  saveFile(): { name: string; text: string } | null {
    const save = this.currentSave(false);
    if (!save) return null;
    const round = save.room.game?.round ?? 0;
    return { name: `factory-spaghetti-${save.room.code}-round-${round}.fsgame`, text: serializeSaveFile(save) };
  }

  downloadSave(): void {
    const file = this.saveFile();
    if (!file) return;
    if (!this.deps.download) {
      this.set({ linkBox: { title: 'Save file', text: file.text, hint: 'Downloading is not available here. Copy this text into a file ending in .fsgame.' } });
      return;
    }
    this.deps.download(file.name, file.text);
    this.notify(`Saved ${file.name}.`);
  }

  async shareSave(): Promise<void> {
    const link = await this.saveLink();
    const file = this.saveFile();
    if (!link || !file) return;
    const room = this.room!;
    const text = `Factory Spaghetti, room ${room.code}, round ${room.game?.round ?? 0}`;
    if (!this.deps.share) {
      this.set({ linkBox: { title: 'Save link', text: link, hint: 'Sharing is not available here. Select the link and copy it by hand.' } });
      return;
    }
    try {
      await this.deps.share({ title: 'Factory Spaghetti save', text, url: link, file });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      this.set({ linkBox: { title: 'Save link', text: link, hint: 'Sharing did not work. Select the link and copy it by hand.' } });
    }
  }

  // ── Replays ─────────────────────────────────────────────────────────────────────

  /** A replay of the current game: from the start when this device has every move. */
  private currentReplay(): ReplayFile | null {
    const room = this.room;
    if (!room || !room.game) {
      this.set({ error: 'There is no game to replay yet.' });
      return null;
    }
    const journal = this.journal ?? partialJournal(room.game, room.seq);
    return makeReplay(room, journal, { savedAt: this.sched.now(), app: this.deps.appVersion });
  }

  /** The replay file of the current game (`.fsreplay`, JSON). */
  replayFile(): { name: string; text: string } | null {
    const replay = this.currentReplay();
    if (!replay) return null;
    return { name: replayFileName(replay, this.room?.game ?? null), text: serializeReplay(replay) };
  }

  /** "Save replay": hand the browser the replay file. */
  downloadReplay(): void {
    const file = this.replayFile();
    if (!file) return;
    this.handOver(file, 'Replay file', 'Downloading is not available here. Copy this text into a file ending in .fsreplay.');
  }

  private handOver(file: { name: string; text: string }, title: string, hint: string): void {
    if (!this.deps.download) {
      this.set({ linkBox: { title, text: file.text, hint } });
      return;
    }
    this.deps.download(file.name, file.text);
    this.notify(`Saved ${file.name}.`);
  }

  /** "Watch this game again": open the viewer on the game this device is in. */
  watchThisGame(): Promise<void> {
    const replay = this.currentReplay();
    if (!replay) return Promise.resolve();
    return this.openReplay({ kind: 'this-game', replay, report: null });
  }

  /** A replay, report or save file, pasted or read from a file, opened in the viewer. */
  openReplayText(text: string, source: 'paste' | 'file'): Promise<void> {
    let opened: ReturnType<typeof openPlaytestText>;
    try {
      opened = openPlaytestText(text);
    } catch (e) {
      const msg = e instanceof ReplayError ? e.message : 'Could not read this replay.';
      const empty = e instanceof ReplayError && e.kind === 'empty' && source === 'file';
      this.set({ error: empty ? 'That file is empty.' : msg });
      return Promise.resolve();
    }
    return this.openReplay(opened);
  }

  /** A replay file over the size limit was chosen (refused before it is read). */
  replayFileTooLarge(): void {
    this.set({ error: 'This file is too large to be a Factory Spaghetti replay.' });
  }

  private async openReplay(opened: { kind: ReplayScreen['kind']; replay: ReplayFile; report: ReportFile | null }): Promise<void> {
    const screen: ReplayScreen = {
      status: 'checking', progress: 0, kind: opened.kind, replay: opened.replay, cursor: null, report: opened.report, matchesReport: null,
    };
    this.set({ replay: screen, error: null, report: null });
    const cursor = await verifyReplay(opened.replay, {
      // Let the page draw the progress between batches of moves (on the app's clock, so tests control it).
      pause: () => new Promise<void>(resolve => { this.sched.setTimeout(resolve, 0); }),
      onProgress: (done, total) => {
        if (this.state.replay?.replay !== opened.replay) return;
        this.set({ replay: { ...this.state.replay, progress: total > 0 ? done / total : 1 } });
      },
    });
    const cur = this.state.replay;
    if (cur?.replay !== opened.replay) return; // closed (or replaced) while checking
    const reported = opened.report?.room.room.game ?? null;
    const matchesReport = reported && !cursor.refused
      ? JSON.stringify(cursor.stateAt(cursor.length)) === JSON.stringify(reported) : null;
    this.set({ replay: { ...cur, status: 'ready', progress: 1, cursor, matchesReport } });
  }

  closeReplay(): void {
    this.set({ replay: null, error: null, saves: listSaves(this.deps.saves) });
  }

  // ── Report a rules problem ─────────────────────────────────────────────────────

  openReport(): void {
    if (!this.room?.game) return;
    this.set({ report: { saved: null } });
  }

  closeReport(): void {
    this.set({ report: null });
  }

  /** The report file for the current game, with the player's note. */
  reportFile(note: string): { name: string; text: string } | null {
    const room = this.room;
    if (!room || !room.game) return null;
    const report = makeReport({
      room, journal: this.journal, seat: this.mySeat, note, lastRefused: this.lastRefused,
      now: this.sched.now(), app: this.deps.appVersion,
    });
    return { name: reportFileName(report), text: serializeReport(report) };
  }

  /** Make the report file and hand it to the browser to save; the player sends it on. */
  saveReport(note: string): void {
    const file = this.reportFile(note);
    if (!file) { this.set({ report: null, error: 'There is no game to report on.' }); return; }
    if (!this.deps.download) {
      this.set({
        report: null,
        linkBox: { title: 'Rules problem report', text: file.text, hint: 'Downloading is not available here. Copy this text into a file ending in .fsreport and send it to the designer.' },
      });
      return;
    }
    this.deps.download(file.name, file.text);
    this.set({ report: { saved: file.name } });
  }

  // ── Saved games and resuming ───────────────────────────────────────────────────

  refreshSaves(): void {
    this.set({ saves: listSaves(this.deps.saves) });
  }

  /** "Watch replay" for a finished game on this device: its save and its stored moves. */
  watchSaved(key: string): Promise<void> {
    const text = this.deps.saves.get(key);
    if (text === null) { this.refreshSaves(); return Promise.resolve(); }
    try {
      const save = this.withJournal(parseSaveFile(text), readJournal(this.deps.saves, parseSaveFile(text).room.code));
      if (!save.journal || !save.room.game) {
        this.set({ error: 'The moves of this game are not kept on this device, so it cannot be replayed.' });
        return Promise.resolve();
      }
      const replay = makeReplay(save.room, save.journal, { savedAt: save.savedAt, app: save.app });
      return this.openReplay({ kind: 'save', replay, report: null });
    } catch (e) {
      this.set({ error: saveErrorMessage(e, 'device') });
      return Promise.resolve();
    }
  }

  /** Remove a save and its stored moves, without a word (an untouched solo game). */
  private forget(key: string, code: string): void {
    this.deps.saves.remove(key);
    this.deps.saves.remove(journalKey(code));
  }

  deleteSave(key: string): void {
    const text = this.deps.saves.get(key);
    this.deps.saves.remove(key);
    if (text !== null) {
      try { this.deps.saves.remove(journalKey(parseSaveFile(text).room.code)); } catch { /* an unreadable save has no journal to find */ }
    }
    this.refreshSaves();
  }

  /** Open a save from this device's list in the resume screen. */
  resumeStored(key: string): void {
    const text = this.deps.saves.get(key);
    if (text === null) { this.refreshSaves(); return; }
    try {
      const save = parseSaveFile(text);
      this.openResume(this.withJournal(save, readJournal(this.deps.saves, save.room.code)), 'device');
    } catch (e) {
      this.set({ error: saveErrorMessage(e, 'device') });
    }
  }

  /**
   * The save with the moves that lead to it, for the replay tool: the save file's own journal,
   * or one kept on this device (a save link carries none). Each candidate is replayed to the
   * saved position first; a journal that does not lead there is not used.
   */
  private withJournal(save: SaveEnvelope, ...candidates: (JournalData | null | undefined)[]): SaveEnvelope {
    const { journal: own, ...rest } = save;
    const game = save.room.game;
    if (!game) return rest;
    const fit = (list: (JournalData | null | undefined)[]): JournalData | null => {
      for (const j of list) {
        const fits = j ? journalMatches(j, game, save.room.seq) : null;
        if (fits) return fits;
      }
      return null;
    };
    const journal = fit([own, ...candidates]) ?? fit(findJournals(this.deps.saves, game.seed));
    return journal ? { ...rest, journal } : rest;
  }

  /** A pasted link (whole address, `#save=…` part or bare text), or a save file's text. */
  async loadSaveText(text: string, source: 'link' | 'file'): Promise<void> {
    const t = text.trim();
    if (!t) {
      this.set({ error: source === 'file' ? 'That file is empty.' : 'Paste a save link first, or choose a save file.' });
      return;
    }
    try {
      let save: SaveEnvelope;
      if (t.startsWith('{')) save = parseSaveFile(t);
      else {
        const at = t.indexOf('#');
        save = await unpackLink(at >= 0 ? t.slice(at) : t);
      }
      this.openResume(save, source);
    } catch (e) {
      this.set({ error: saveErrorMessage(e, source) });
    }
  }

  private openResume(loaded: SaveEnvelope, source: ResumeSetup['source']): void {
    const save = source === 'device' ? loaded : this.withJournal(loaded);
    const seats = save.room.seats.filter(s => s.kind === 'human').map(s => ({ index: s.index, name: s.name, color: s.color }));
    const mine = cleanName(this.state.name).toLowerCase();
    const match = seats.find(s => s.name.trim().toLowerCase() === mine && mine.length > 0);
    this.set({
      resume: {
        save, source, summary: saveSummary(save), sameRules: sameRules(save), seats,
        chosen: match ? match.index : seats.length === 1 ? seats[0]!.index : null,
      },
      error: null,
    });
  }

  chooseResumeSeat(index: number): void {
    const r = this.state.resume;
    if (!r || !r.seats.some(s => s.index === index)) return;
    this.set({ resume: { ...r, chosen: index } });
  }

  cancelResume(): void {
    this.set({ resume: null, error: null, saves: listSaves(this.deps.saves) });
  }

  /** Host the chosen save under a new room code; the game waits until the host continues it. */
  async hostResume(): Promise<void> {
    const r = this.state.resume;
    if (!r) return;
    if (r.chosen === null) { this.set({ error: 'Choose which player you are first.' }); return; }
    await this.hostSave(r.save, r.chosen);
  }

  private async hostSave(save: SaveEnvelope, seat: number): Promise<void> {
    const name = save.room.seats[seat]?.name || cleanName(this.state.name) || 'Host';
    // A game with one player and bots needs nobody else: it resumes on this device, with no
    // network (so it also works offline). Anything else is hosted for the others to join.
    const solo = isSoloSave(save);
    const kind: TransportKind = solo ? 'solo' : this.state.transportKind;
    if (this.needsConnection(kind, 'Hosting a saved game with other players')) return;
    await this.connect('Opening the saved game…', null, () => OnlineRoom.host({
      ...this.options(kind, name), resume: save, seat,
    }), solo);
  }

  /** True (with the error shown) when `kind` needs the internet and this device is offline. */
  private needsConnection(kind: TransportKind, what: string): boolean {
    if (kind !== 'internet' || !this.deps.isOffline?.()) return false;
    this.set({ error: `${what} needs an internet connection, and this device is offline. Play solo vs bots works without one.` });
    return true;
  }

  /** A game is on screen and running: the screen should stay on (see wakeLock.ts). */
  get wantsScreenOn(): boolean {
    return this.screen === 'game' && !this.room?.game?.gameOver;
  }

  /** After the room was lost: host the last room this device holds, as a resumed game. */
  async hostFromMyCopy(): Promise<void> {
    const online = this.state.online;
    const room = online?.client.room ?? null;
    const seat = online?.client.seat ?? null;
    if (!online || !room || seat === null) return;
    this.detach();
    online.leave();
    this.set({ online: null });
    if (room.phase === 'lobby' || !room.game) { await this.host(); return; }
    const journal = online.client.journalCurrent ? online.client.journal : null;
    const save = toSave(room, { savedAt: this.sched.now(), app: this.deps.appVersion }, { journal });
    await this.hostSave(save, seat);
  }
}
