// The replay viewer: the 3D table, read-only, stepping through a verified replay. Step back and
// forward, play and pause at a chosen speed, a slider over the move numbers, jumps to the next
// roll and the next turn, the current move in the rulebook's words, and every player's
// materials, Power Tokens, Tesseracts and hand at that point. A rules-problem report shows its
// note and opens at the reported position. Without WebGL each step is shown as text.
//
// Stepping is instant: the replay keeps a state every few moves (see ReplayCursor), so going
// back recomputes at most a handful of moves.

import type { AppController, ReplayScreen } from '../app/controller';
import { finalStandings, gameOverWords, phaseWords, pieceLabel } from '../app/gameText';
import type { Action } from '../engine/actions';
import type { GameState, PlayerId } from '../engine/state';
import { resourcePoints, tesseractCount } from '../engine/rules/scoring';
import { CARD_NAME } from '../play/words';
import type { ReplayCursor, ReplayFile, ReplayPlayer } from '../session/replay';
import { actorOf } from '../session/replay';
import type { Room } from '../session/room';
import { activeSeat, defaultSettings, newLobbyRoom, openSeat } from '../session/room';
import { describeAction, MATERIAL_NAME } from '../session/describe';
import { rulesFingerprint } from '../session/save';
import type { PlayerColor, Table, ViewInsets } from '../table/types';
import type { Child } from './dom';
import { h, morph } from './dom';
import type { IconName } from './icons';
import { COLORS, icon } from './icons';
import { messageStrip } from './common';
import type { View } from './menuView';
import { preferredView, tableFailed, tableFailure } from './viewPref';

/** Moves per second for each speed choice. */
const SPEEDS: readonly { label: string; perSecond: number }[] = [
  { label: 'Slow', perSecond: 1 },
  { label: 'Normal', perSecond: 3 },
  { label: 'Fast', perSecond: 8 },
  { label: 'Very fast', perSecond: 20 },
];

const PHONE_MAX_W = 760;
const isPhone = (): boolean => window.innerWidth < PHONE_MAX_W || window.innerHeight < 520;

/** A room-shaped wrapper of a replayed state, so the game's own wording helpers can be used. */
function asRoom(r: ReplayFile, g: GameState): Room {
  const base = newLobbyRoom(r.code || 'ROOM', r.players[0]?.name ?? 'Host', { ...defaultSettings(), playerCount: g.playerCount });
  return {
    ...base, phase: g.gameOver ? 'finished' : 'playing', game: g,
    seats: r.players.map(p => ({ ...openSeat(p.seat, p.color), kind: p.bot ? 'bot' as const : 'human' as const, name: p.name, botId: p.bot })),
  };
}

interface Local {
  pos: number;
  playing: boolean;
  speed: number;
  /** Phone: the players panel shows each hand. */
  hands: boolean;
  /** The "different rules" notice was accepted. */
  rulesOk: boolean;
  /** The report panel is folded away. */
  reportFolded: boolean;
  cursor: ReplayCursor | null;
}

export function replayView(ctrl: AppController): View {
  const root = h('div', { class: 'rv' });
  const canvas = h('canvas', { class: 'rv-canvas', attrs: { 'aria-label': 'The game table at this move. Drag to move, pinch or scroll to zoom.' } });
  const hud = h('div', { class: 'rv-hud' });
  root.append(canvas, hud);

  const local: Local = { pos: 0, playing: false, speed: 1, hands: false, rulesOk: false, reportFolded: false, cursor: null };
  let table: Table | null = null;
  let tableStarting = false;
  let textMode = preferredView() === 'text' || tableFailure() !== null;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let shownKey = '';
  let boardSize = -1;
  let userCamera = false;
  let insetsKey = '';
  let queued = 0;
  const offs: (() => void)[] = [];

  canvas.addEventListener('pointermove', (e) => { if (e.buttons) userCamera = true; });
  canvas.addEventListener('wheel', () => { userCamera = true; }, { passive: true });

  const screen = (): ReplayScreen | null => ctrl.state.replay;

  // ── Moving through the replay ───────────────────────────────────────────────
  function goTo(pos: number | null): void {
    const c = local.cursor;
    if (!c || pos === null) return;
    local.pos = c.clamp(pos);
    if (local.pos >= c.length) stop();
    schedule();
  }

  function play(): void {
    const c = local.cursor;
    if (!c) return;
    if (local.pos >= c.length) local.pos = 0; // play again from the start
    local.playing = true;
    restartTimer();
    schedule();
  }

  function stop(): void {
    local.playing = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function restartTimer(): void {
    if (timer) clearInterval(timer);
    timer = null;
    if (!local.playing) return;
    timer = setInterval(() => {
      const c = local.cursor;
      if (!c || local.pos >= c.length) { stop(); schedule(); return; }
      local.pos++;
      if (local.pos >= c.length) stop();
      schedule();
    }, 1000 / SPEEDS[local.speed]!.perSecond);
  }

  function schedule(): void {
    if (queued || disposed) return;
    queued = requestAnimationFrame(render);
  }

  // ── The table ───────────────────────────────────────────────────────────────
  async function startTable(players: readonly ReplayPlayer[]): Promise<void> {
    if (table || tableStarting || textMode) return;
    tableStarting = true;
    try {
      const mod = await import('../table');
      if (disposed) return;
      const t = await mod.createTable(canvas);
      if (disposed) { t.dispose(); return; }
      table = t;
      t.setPlayerColors(players.map(p => p.color as PlayerColor));
      shownKey = '';
      insetsKey = '';
      offs.push(t.onPick(() => undefined));
      schedule();
    } catch (err) {
      if (disposed) return;
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('The 3D table could not start', err);
      tableFailed(/webgl/i.test(msg) ? 'This browser or device does not offer WebGL (3D graphics).' : `The table could not be loaded (${msg}).`);
      textMode = true;
      schedule();
    } finally {
      tableStarting = false;
    }
  }

  function syncTable(state: GameState): void {
    if (!table) return;
    const key = `${local.pos}`;
    if (key === shownKey) return;
    shownKey = key;
    table.setGame(state);
    if (state.board.length !== boardSize) {
      boardSize = state.board.length;
      if (!userCamera) table.recenter();
    }
  }

  function measure(): void {
    if (!table) return;
    const W = window.innerWidth, H = window.innerHeight;
    const rect = (sel: string): DOMRect | null => {
      const el = hud.querySelector<HTMLElement>(sel);
      const r = el?.getBoundingClientRect();
      return r && r.height > 0 ? r : null;
    };
    const top = Math.max(rect('.rv-top')?.bottom ?? 60, rect('.rv-notes')?.bottom ?? 0, isPhone() ? rect('.rv-players')?.bottom ?? 0 : 0) + 8;
    const bottom = H - (rect('.rv-controls')?.top ?? H) + 8;
    const side = !isPhone() ? rect('.rv-players') : null;
    const insets: ViewInsets = { top, bottom, left: 12, right: side ? W - side.left + 8 : 12 };
    const key = `${Math.round(insets.top / 4)}:${Math.round(insets.bottom / 4)}:${Math.round(insets.right / 4)}`;
    if (key === insetsKey) return;
    const first = insetsKey === '';
    insetsKey = key;
    table.setViewport(insets, { minTilePx: isPhone() ? 40 : 0 });
    if (first || !userCamera) table.recenter();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────
  function render(): void {
    queued = 0;
    if (disposed) return;
    const s = screen();
    if (!s) return;
    if (s.cursor && local.cursor !== s.cursor) {
      local.cursor = s.cursor;
      // A report opens at the reported position; anything else at the start.
      local.pos = s.kind === 'report' ? s.cursor.length : 0;
      local.rulesOk = s.cursor.sameRules;
    }
    const c = local.cursor;
    if (c && !textMode) void startTable(c.replay.players);
    root.classList.toggle('text-mode', textMode);
    root.classList.toggle('phone', isPhone());
    const fresh = h('div', { class: 'rv-hud' }, ...hudParts(s, c));
    morph(hud, fresh);
    // A kept slider or menu keeps its own value; set it to what is shown.
    const slider = hud.querySelector<HTMLInputElement>('.rv-slider');
    if (slider && slider.value !== String(local.pos)) slider.value = String(local.pos);
    const speed = hud.querySelector<HTMLSelectElement>('.rv-speed-sel');
    if (speed && speed.value !== String(local.speed)) speed.value = String(local.speed);
    if (c) {
      const state = c.stateAt(local.pos);
      measure();
      syncTable(state);
    }
  }

  function hudParts(s: ReplayScreen, c: ReplayCursor | null): Child[] {
    const replay = s.replay;
    const title = s.kind === 'report' ? 'Rules problem report' : s.kind === 'this-game' ? 'This game, again' : 'Replay';
    const top = h('header', { class: 'rv-top tray' },
      h('button', { class: 'btn btn-quiet icon-only', title: 'Back', attrs: { 'aria-label': 'Close the replay', 'data-close': '1' }, onclick: () => { stop(); ctrl.closeReplay(); } }, icon('leave')),
      h('div', { class: 'rv-title' },
        h('b', { text: title }),
        h('span', { class: 'muted', text: `Room ${replay.code} · ${replay.players.map(p => p.name).join(', ')}` })),
      c ? h('div', { class: 'rv-where' }, ...whereText(c)) : null,
      // Phone: the hands are folded away to leave room for the table.
      c && isPhone() ? h('button', {
        class: `btn ${local.hands ? 'btn-gold' : 'btn-dark'} icon-only rv-hands-btn`, title: local.hands ? 'Hide the hands' : 'Show every hand',
        attrs: { 'aria-label': local.hands ? 'Hide the hands' : 'Show every hand', 'aria-pressed': String(local.hands) },
        onclick: () => { local.hands = !local.hands; schedule(); },
      }, icon('card')) : null);

    if (s.status === 'checking' || !c) {
      return [top, h('div', { class: 'rv-center tray panel', attrs: { role: 'status' } },
        h('div', { class: 'busy' }, h('span', { class: 'spinner' }), `Checking every move with the rules… ${Math.round(s.progress * 100)}%`))];
    }
    if (!local.rulesOk) {
      return [top, h('div', { class: 'rv-center tray panel', attrs: { role: 'alertdialog', 'aria-label': 'Different rules' } },
        h('h2', { text: 'Made with different rules' }),
        h('p', { class: 'warn', text: `This replay was recorded by a version of the game with different rule settings (rules ${replay.rules}, this version ${rulesFingerprint()}). It is checked against the rules of this version, so moves may be refused or play out differently from the original game.` }),
        h('div', { class: 'row end' },
          h('button', { class: 'btn btn-quiet btn-lg', onclick: () => { stop(); ctrl.closeReplay(); } }, 'Back'),
          h('button', { class: 'btn btn-gold btn-lg', attrs: { 'data-continue': '1' }, onclick: () => { local.rulesOk = true; schedule(); } }, 'Watch it anyway')))];
    }

    const state = c.stateAt(local.pos);
    const room = asRoom(replay, state);
    return [
      top,
      notices(s, c),
      playersPanel(replay, state),
      h('div', { class: 'rv-main' },
        textMode ? textBoard(c, state) : null,
        local.pos === c.length && state.gameOver ? standings(room) : null),
      controls(c),
    ];
  }

  function whereText(c: ReplayCursor): Child[] {
    const state = c.stateAt(local.pos);
    return [
      h('span', { class: 'num', text: `Move ${c.seqAt(local.pos)}` }),
      h('span', { class: 'muted', text: ` of ${c.seqAt(c.length)}` }),
      h('span', { class: 'muted rv-round', text: ` · Round ${state.round}` }),
    ];
  }

  function notices(s: ReplayScreen, c: ReplayCursor): HTMLElement | null {
    const parts: Child[] = [messageStrip(ctrl)];
    if (c.refused) {
      const r = c.refused;
      const at = r.index - 1;
      const before = c.stateAt(at);
      let line: string;
      try { line = describeAction(before, r.action, nameOf(c.replay, actorOf(before, r.action))); } catch { line = `a ${r.action.type} move`; }
      parts.push(h('div', { class: 'error rv-refused', attrs: { role: 'alert' } },
        h('span', null, h('b', { text: `The replay stops at move ${r.seq}. ` }),
          `The rules refused it: “${line}”. `, h('code', { text: r.error.code }), ` ${r.error.message}`),
        local.pos !== c.length ? h('button', { class: 'btn btn-dark', onclick: () => goTo(c.length) }, 'Go there') : null));
    }
    if (!c.sameRules) {
      parts.push(h('div', { class: 'warn rv-rules', text: `Different rule settings: recorded with rules ${c.replay.rules}, shown with ${rulesFingerprint()}.` }));
    }
    if (c.dice.status === 'mismatch') {
      parts.push(h('div', { class: 'warn rv-dice', text: `The dice in this file do not match the seeded dice of this game (first at move ${c.dice.firstMismatch}). The file may have been edited.` }));
    }
    if (c.partial) {
      parts.push(h('div', { class: 'note rv-partial', text: `The early moves of this game were not recorded on the device that made this file, so the replay starts at move ${c.firstSeq}. Its dice cannot be checked.` }));
    }
    if (s.report) parts.push(reportPanel(s, c));
    return h('div', { class: 'rv-notes' }, parts);
  }

  function reportPanel(s: ReplayScreen, c: ReplayCursor): HTMLElement {
    const rep = s.report!;
    const who = rep.reporter.name || 'A player';
    const when = new Date(rep.createdAt).toLocaleString();
    if (local.reportFolded) {
      return h('button', { class: 'btn btn-dark rv-report-pill', onclick: () => { local.reportFolded = false; schedule(); } }, icon('flag'), `${who}'s report`);
    }
    const lr = rep.lastRefused;
    let refusedLine: Child = null;
    if (lr) {
      const pos = lr.seq - c.firstSeq;
      let what = `a ${lr.action.type} move`;
      if (pos >= 0 && pos <= c.length) {
        const st = c.stateAt(pos);
        try { what = `“${describeAction(st, lr.action, who)}”`; } catch { /* keep the plain words */ }
      }
      refusedLine = h('p', { class: 'rv-rep-refused' }, h('b', { text: 'Last refused move: ' }),
        `at move ${lr.seq}, ${what} — `, h('code', { text: lr.error.code }), ` ${lr.error.message}`);
    }
    const seat = rep.reporter.seat;
    const end = rep.room.room.game ?? c.stateAt(c.length);
    const legal = rep.legalActions;
    return h('section', { class: 'rv-report tray panel' },
      h('div', { class: 'rv-rep-head' },
        icon('flag', undefined, 'ic gold'),
        h('b', { text: `${who} reported a rules problem` }),
        h('span', { class: 'muted', text: ` · ${when} · version ${rep.app}` }),
        h('button', { class: 'x', title: 'Fold the report away', attrs: { 'aria-label': 'Fold the report away' }, onclick: () => { local.reportFolded = true; schedule(); } }, icon('chevron'))),
      h('p', { class: 'rv-note', text: rep.note || '(No note was written.)' }),
      s.matchesReport === false ? h('p', { class: 'warn', text: 'The replay does not end at the reported position; the report’s own snapshot of the room is the reliable one.' }) : null,
      refusedLine,
      seat !== null ? h('details', { class: 'rv-legal' },
        h('summary', { text: `${legal.length} move${legal.length === 1 ? '' : 's'} the rules allowed ${who} at that point` }),
        h('ul', null, legal.slice(0, 300).map(a => h('li', { text: safeLine(end, a, who) })))) : null);
  }

  function playersPanel(replay: ReplayFile, state: GameState): HTMLElement {
    const turn = state.gameOver ? null : activeSeat(state);
    const phone = isPhone();
    return h('aside', { class: `rv-players tray${phone ? ' compact' : ''}`, attrs: { 'aria-label': 'Players at this move' } },
      replay.players.map(p => {
        const pl = state.players[p.seat];
        if (!pl) return null;
        const inv = pl.inventory;
        return h('div', { class: `rv-pl${p.seat === turn ? ' turn' : ''}`, style: `--seat:${COLORS[p.color]}` },
          h('div', { class: 'rv-pl-top' },
            h('span', { class: 'sw' }),
            h('b', { class: 'rv-pl-name', text: p.name }),
            p.bot ? icon('bot', undefined, 'ic small') : null,
            p.seat === turn ? h('span', { class: 'turn-tag', text: 'turn' }) : null),
          h('div', { class: 'counts' },
            count('tess', tesseractCount(state, p.seat as PlayerId), 'Tesseracts (of 4)', 'tess'),
            count('ore', inv.ore, 'Ore'),
            count('plate', inv.plate, 'Plates'),
            count('sphere', inv.sphere, 'Spheres'),
            count('power', pl.powerTokens, 'Power Tokens'),
            count('card', pl.hand.length, 'Leverage cards in hand'),
            h('span', { class: 'count pts', title: 'Points', attrs: { 'aria-label': `Points: ${resourcePoints(pl)}` } },
              h('span', { class: 'num', text: String(resourcePoints(pl)) }), h('span', { class: 'muted', text: 'pts' }))),
          !phone || local.hands
            ? h('div', { class: 'rv-hand muted', text: pl.hand.length ? pl.hand.map(card => CARD_NAME[card]).join(', ') : 'No cards' })
            : null);
      }),
    );
  }

  function textBoard(c: ReplayCursor, state: GameState): HTMLElement {
    const names = c.replay.players.map(p => p.name);
    const failed = tableFailure();
    const buildings = state.board.filter(p => p.type !== 'blank' && p.type !== 'mine');
    const slots = (b: { slots: readonly (string | null)[] } | null): string =>
      b ? b.slots.map(m => (m ? MATERIAL_NAME[m as keyof typeof MATERIAL_NAME] : '—')).join(', ') : '';
    const turn = activeSeat(state);
    return h('section', { class: 'rv-text tray panel' },
      failed ? h('p', { class: 'warn', text: `The 3D table could not start on this device, so the replay is shown as text. ${failed}` }) : null,
      h('p', null, h('b', { text: state.gameOver ? 'Game over' : phaseWords(state) }),
        turn !== null && !state.gameOver ? ` · ${names[turn] ?? ''}'s turn` : '',
        state.lastRoll ? ` · last roll ${state.lastRoll.join(' + ')}` : ''),
      h('p', { class: 'muted', text: `${state.mineCount} Mine${state.mineCount === 1 ? '' : 's'} · ${state.board.length} pieces on the board · ${state.belts.length} belts` }),
      h('ul', { class: 'rv-buildings' }, buildings.map(b => h('li', null,
        h('span', { text: pieceLabel(state, b.id, names, null) }),
        b.input || b.output ? h('span', { class: 'muted', text: ` · in: ${slots(b.input)} · out: ${slots(b.output)}` }) : null))));
  }

  function standings(room: Room): HTMLElement {
    const rows = finalStandings(room);
    return h('section', { class: 'rv-over tray panel', attrs: { 'aria-label': 'Final standings' } },
      h('div', { class: 'label gold', text: 'Game over' }),
      h('p', { class: 'rv-over-words', text: gameOverWords(room) }),
      h('ol', { class: 'rv-standings' }, rows.map(r => {
        const seat = room.seats[r.seat]!;
        return h('li', { class: r.won ? 'won' : '', style: `--seat:${COLORS[seat.color]}` },
          h('span', { class: 'sw' }), h('b', { text: seat.name }),
          h('span', { class: 'muted', text: ` · ${r.tesseracts} Tesseract${r.tesseracts === 1 ? '' : 's'} · ${r.points} points` }));
      })));
  }

  function controls(c: ReplayCursor): HTMLElement {
    const actor = c.actorAt(local.pos);
    const player = actor === null ? undefined : c.replay.players[actor];
    const atStart = local.pos <= 0, atEnd = local.pos >= c.length;
    const slider = h('input', {
      type: 'range', class: 'rv-slider',
      attrs: {
        min: '0', max: String(c.length), step: '1', 'aria-label': 'Move number',
        'aria-valuetext': `Move ${c.seqAt(local.pos)} of ${c.seqAt(c.length)}`,
      },
      oninput: (e) => { stop(); goTo(Number((e.target as HTMLInputElement).value)); },
    });
    slider.value = String(local.pos);
    const btn = (name: IconName, label: string, fn: () => void, disabled: boolean, extra = ''): HTMLButtonElement =>
      h('button', {
        class: `btn ${extra.includes('btn-gold') ? '' : 'btn-dark '}icon-only rv-b ${extra}`, title: label, disabled,
        attrs: { 'aria-label': label }, onclick: fn,
      }, icon(name));
    const nextRoll = c.nextRoll(local.pos);
    const nextTurn = c.nextTurn(local.pos);
    return h('footer', { class: 'rv-controls tray' },
      h('div', { class: 'rv-line', attrs: { 'aria-live': 'polite' } },
        h('span', { class: 'sw', style: player ? `background:${COLORS[player.color]}` : 'background:#5d5a55' }),
        h('span', { class: 'num rv-mv', text: local.pos === 0 ? 'Start' : `${c.seqAt(local.pos)}.` }),
        h('span', { class: 'rv-line-text', text: c.lineAt(local.pos) })),
      h('div', { class: 'rv-slider-row' }, slider),
      h('div', { class: 'rv-buttons' },
        h('div', { class: 'rv-transport', attrs: { role: 'toolbar', 'aria-label': 'Step through the moves' } },
          btn('toStart', 'Back to the start', () => { stop(); goTo(0); }, atStart),
          btn('stepBack', 'One move back', () => { stop(); goTo(local.pos - 1); }, atStart, 'rv-back'),
          local.playing
            ? btn('pause', 'Pause', () => { stop(); schedule(); }, false, 'btn-gold rv-play')
            : btn('play', 'Play', () => play(), c.length === 0, 'btn-gold rv-play'),
          btn('stepFwd', 'One move forward', () => { stop(); goTo(local.pos + 1); }, atEnd, 'rv-fwd'),
          btn('toEnd', 'To the last move', () => { stop(); goTo(c.length); }, atEnd)),
        h('div', { class: 'rv-jumps' },
          h('button', { class: 'btn btn-dark rv-j', disabled: nextRoll === null, attrs: { 'data-next-roll': '1' }, onclick: () => { stop(); goTo(nextRoll); } }, icon('dice'), 'Next roll'),
          h('button', { class: 'btn btn-dark rv-j', disabled: nextTurn === null, attrs: { 'data-next-turn': '1' }, onclick: () => { stop(); goTo(nextTurn); } }, icon('stepFwd'), 'Next turn'),
          h('label', { class: 'rv-speed' },
            h('span', { class: 'label', text: 'Speed' }),
            speedSelect()))));
  }

  function speedSelect(): HTMLSelectElement {
    const sel = h('select', {
      class: 'rv-speed-sel', attrs: { 'aria-label': 'Playing speed' },
      onchange: (e) => { local.speed = Number((e.target as HTMLSelectElement).value); restartTimer(); schedule(); },
    }, SPEEDS.map((sp, i) => h('option', { value: String(i), text: isPhone() ? sp.label : `${sp.label} · ${sp.perSecond}/s` })));
    sel.value = String(local.speed);
    return sel;
  }

  // ── Keys and window ─────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const c = local.cursor;
    if (!c) return;
    if (e.key === 'ArrowRight') { stop(); goTo(local.pos + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { stop(); goTo(local.pos - 1); e.preventDefault(); }
    else if (e.key === 'Home') { stop(); goTo(0); e.preventDefault(); }
    else if (e.key === 'End') { stop(); goTo(c.length); e.preventDefault(); }
    else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { if (local.playing) { stop(); schedule(); } else play(); e.preventDefault(); }
    else if (e.key === 'Escape') { stop(); ctrl.closeReplay(); }
  }

  function onResize(): void {
    table?.resize();
    insetsKey = '';
    schedule();
  }

  return {
    el: root,
    update: schedule,
    mounted(): void {
      document.documentElement.classList.add('rv-active');
      window.addEventListener('keydown', onKey);
      window.addEventListener('resize', onResize);
      (window as unknown as { __replay?: unknown }).__replay = {
        get pos(): number { return local.pos; },
        get length(): number { return local.cursor?.length ?? -1; },
        get table(): Table | null { return table; },
        get textMode(): boolean { return textMode; },
        goTo,
        state: (): GameState | null => local.cursor?.stateAt(local.pos) ?? null,
      };
      render();
    },
    unmounted(): void {
      disposed = true;
      stop();
      if (queued) cancelAnimationFrame(queued);
      document.documentElement.classList.remove('rv-active');
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      for (const off of offs) off();
      table?.dispose();
      table = null;
    },
  };
}

function count(name: IconName, n: number, label: string, cls = ''): HTMLElement {
  return h('span', { class: `count ${cls}`, title: label, attrs: { 'aria-label': `${label}: ${n}` } }, icon(name), h('span', { class: 'num', text: String(n) }));
}

function nameOf(r: ReplayFile, seat: number): string {
  return r.players[seat]?.name ?? `Seat ${seat + 1}`;
}

/** A legal move in words; never throws (the move came from a file). */
function safeLine(s: GameState, a: Action, who: string): string {
  try {
    return describeAction(s, a, who).replace(`${who} `, '').replace(/^./, ch => ch.toUpperCase());
  } catch {
    return a.type;
  }
}
