// The room lobby (mock-up 05), and the same screen in "resuming" mode for a held saved game.
// Rebuilt whole on every change: it has buttons only, no text fields.

import type { BotSpeed } from '../session/pacing';
import { botSpeedOf } from '../session/pacing';
import type { AppController } from '../app/controller';
import { GRACE_STEPS, OPERATE_STEPS, ROUND_END_STEPS, botChoices, botKindOf, canRemovePlayer, colorChoices, durationWords, lobbyInfo, stepValue } from '../app/lobby';
import type { Room, RoomSettings, Seat } from '../session/room';
import { roundLabel } from '../session/rounds';
import type { Child } from './dom';
import { actionButton, append, h, morph } from './dom';
import { COLORS, COLOR_NAME, icon } from './icons';
import { connectionBanner, messageStrip, topBar } from './common';
import { askConfirm } from './confirmDialog';
import { removePlayerButton } from './removePlayer';
import type { View } from './menuView';

export function lobbyView(ctrl: AppController): View {
  const el = h('main', { class: 'screen lobby' });
  const update = (): void => {
    const room = ctrl.room;
    if (!room) { el.replaceChildren(); return; }
    const fresh = h('main', { class: 'screen lobby' });
    append(fresh, render(ctrl, room));
    morph(el, fresh);
    syncSelects(el);
  };
  return { el, update };
}

/**
 * A kept <select> shows what the player last picked, not what its `selected` attributes now
 * say; set it to the room's value (data-value) after every redraw.
 */
function syncSelects(root: HTMLElement): void {
  for (const sel of root.querySelectorAll<HTMLSelectElement>('select[data-value]')) {
    const want = sel.getAttribute('data-value')!;
    if (sel.value !== want) sel.value = want;
  }
}

/** The host's choice of bot kind for a bot seat: every bot in the registry, Smart Bot first. */
function botKindSelect(ctrl: AppController, s: Seat): HTMLElement {
  const choices = botChoices(s);
  const cur = choices.find(c => c.current)!;
  const sel = h('select', {
    class: 'bot-kind-select',
    attrs: { 'aria-label': `Kind of bot for ${s.name}`, 'data-value': cur.id, 'data-bot-kind': String(s.index) },
    onchange: () => { void ctrl.setBotKind(s.index, sel.value); },
  }, choices.map(c => h('option', { value: c.id, ...(c.current ? { attrs: { selected: '' } } : {}) }, c.label)));
  sel.value = cur.id;
  return sel;
}

function render(ctrl: AppController, room: Room): Child[] {
  const me = ctrl.mySeat;
  const info = lobbyInfo(room, me);
  const resuming = info.resuming;
  const solo = ctrl.state.solo;
  if (solo && !resuming) return soloSetup(ctrl, room, info);
  const title = resuming ? `Saved game · ${room.game ? roundLabel(room.game).toLowerCase() : 'round 0'}` : solo ? 'Solo game' : 'Room lobby';
  return [
    topBar(ctrl, title),
    connectionBanner(ctrl),
    h('div', { class: 'lobby-grid' },
      roomPanel(ctrl, room, resuming, solo),
      h('section', { class: 'tray panel seats-panel' },
        h('h2', { text: resuming ? 'Saved seats' : 'Seats' }),
        messageStrip(ctrl),
        h('div', { class: 'seats' }, room.seats.map(s => seatCard(ctrl, room, s, info.isHost, resuming))),
        resuming ? waitingList(ctrl, room, info.isHost) : settingsBlock(ctrl, room.settings, info.isHost),
        footer(ctrl, room, info))),
  ];
}

function roomPanel(ctrl: AppController, room: Room, resuming: boolean, solo: boolean): HTMLElement {
  const code = ctrl.state.online?.code ?? room.code;
  const me = ctrl.mySeat;
  const members: Child[] = [];
  for (const s of room.seats) {
    if (s.kind !== 'human') continue;
    const notes: string[] = [];
    if (s.index === me) notes.push('this device');
    if (s.index === room.hostSeat) notes.push('host');
    notes.push(s.connected ? (resuming ? 'back' : 'connected') : resuming ? 'not back yet' : 'not connected');
    members.push(h('div', { class: 'row' }, h('span', { class: `dot ${s.connected ? 'on' : 'off'}` }), h('b', { text: s.name }), ` · ${notes.join(' · ')}`));
  }
  for (const w of room.waiting) {
    members.push(h('div', { class: 'row' }, h('span', { class: 'dot on' }), h('b', { text: w.name }), ' · waiting for a seat'));
  }
  const open = room.seats.filter(s => s.kind === 'open').length;
  if (open > 0) members.push(h('div', { class: 'row' }, h('span', { class: 'dot' }), open === 1 ? '1 seat open' : `${open} seats open`));

  return h('section', { class: 'tray panel room-panel' },
    h('h2', { text: 'Room code' }),
    h('div', { class: 'codes', attrs: { 'aria-label': `Room code ${code.split('').join(' ')}` } }, code.split('').map(c => h('span', { class: 'ch', text: c }))),
    solo ? h('p', { class: 'hint', text: 'This game runs only on this device, against bots. Nobody else can join it.' })
      : h('div', { class: 'btns' },
        actionButton([icon('link'), 'Copy invite link'], 'btn btn-gold btn-lg', () => ctrl.copyInvite()),
        resuming ? actionButton([icon('copy'), 'Copy save link'], 'btn btn-quiet btn-lg', () => ctrl.copySaveLink()) : null),
    solo ? null : h('p', { class: 'hint' }, 'Friends open the invite link, or choose ', h('b', { text: 'Join a game' }), ' and type ', h('code', { text: code }), '.',
      resuming ? ' Returning players get their seat back by using the same name as in the saved game.' : ''),
    h('div', { class: 'members' }, h('div', { class: 'label', text: 'In the room' }), members));
}

function seatCard(ctrl: AppController, room: Room, s: Seat, isHost: boolean, resuming: boolean): HTMLElement {
  const me = ctrl.mySeat;
  const mine = s.index === me;
  const color = COLORS[s.color];
  const nameLine: Child[] = [];
  let meta = COLOR_NAME[s.color];
  let state: HTMLElement | null = null;
  const controls: Child[] = [];

  if (s.kind === 'open') {
    nameLine.push(h('span', { class: 'muted', text: 'Open seat' }));
    meta += ' · waiting for a player';
    if (isHost) controls.push(actionButton([icon('bot'), 'Add bot'], 'btn btn-quiet', () => ctrl.seatToBot(s.index)));
  } else if (s.kind === 'bot') {
    nameLine.push(h('span', { text: s.name }), icon('bot', undefined, 'ic small muted'));
    // Everyone sees which kind of bot plays the seat; only the host can change it.
    meta += ` · ${botKindOf(s).label}`;
    state = h('span', { class: 'state bot', text: 'Bot · ready' });
    if (isHost) controls.push(botKindSelect(ctrl, s));
    if (isHost && !resuming && !ctrl.state.solo) controls.push(actionButton('Open seat', 'btn btn-quiet', () => ctrl.openSeat(s.index)));
  } else {
    nameLine.push(h('span', { text: s.name }));
    if (s.index === room.hostSeat) nameLine.push(h('span', { class: 'tagh' }, icon('crown'), 'HOST'));
    if (mine) meta += ' · you';
    if (resuming) {
      const botPlays = !s.connected && s.autopilot; // removed by the host: a bot plays until they rejoin
      meta += s.connected ? ' · back' : botPlays ? ' · a bot plays until they rejoin' : ' · not back yet';
      state = s.connected ? h('span', { class: 'state ready' }, icon('check'), 'Back')
        : h('span', { class: botPlays ? 'state bot' : 'state wait', text: botPlays ? 'Bot plays' : 'Away' });
      if (isHost && !s.connected && !mine) controls.push(actionButton([icon('bot'), 'Give to a bot'], 'btn btn-quiet', () => ctrl.seatToBot(s.index)));
      // A player who came back can still be removed before the game continues (a bot plays their seat).
      if (s.connected && !mine && canRemovePlayer(room, me, s.index)) controls.push(removePlayerButton(ctrl, s.index, 'btn btn-quiet'));
    } else {
      if (!mine) meta += s.connected ? ' · connected' : ' · not connected';
      state = s.ready ? h('span', { class: 'state ready' }, icon('check'), 'Ready') : h('span', { class: 'state wait', text: 'Not ready' });
    }
    if (isHost && !mine && !resuming) {
      controls.push(h('button', {
        class: 'btn btn-quiet',
        onclick: () => askConfirm({
          question: `Remove ${s.name} from the room?`, confirmLabel: 'Remove',
          // Gone already (left, or the seat changed): nothing to ask.
          stillValid: () => {
            const r = ctrl.room;
            const t = r?.seats[s.index];
            return !!r && r.phase === 'lobby' && ctrl.mySeat === r.hostSeat && t?.kind === 'human' && t.name === s.name;
          },
          onConfirm: () => ctrl.kick(s.index),
        }),
      }, 'Remove'));
    }
  }

  const card = h('div', { class: `seatcard well${s.kind === 'open' ? ' open' : ''}${mine ? ' mine' : ''}`, style: `--seat:${color}` },
    h('span', { class: 'bar' }),
    h('span', { class: 'av' }, icon('meeple', s.kind === 'open' ? undefined : s.color)),
    h('div', { class: 'who' }, h('div', { class: 'nm' }, nameLine), h('div', { class: 'meta' }, h('span', { text: meta }), state)),
    controls.length ? h('div', { class: 'seat-controls' }, controls) : null);

  if (mine && !resuming && room.phase === 'lobby') {
    const swatches = colorChoices(room, s.index).map(c => h('button', {
      class: `swatch${c.mine ? ' on' : ''}`, style: `--sw:${COLORS[c.color]}`, disabled: !c.free,
      title: c.mine ? `${COLOR_NAME[c.color]} (yours)` : c.free ? `Play ${COLOR_NAME[c.color].toLowerCase()}` : `${COLOR_NAME[c.color]} is taken`,
      attrs: { 'aria-label': `Colour ${COLOR_NAME[c.color]}`, 'aria-pressed': String(c.mine) },
      onclick: () => { if (!c.mine) void ctrl.setColor(c.color); },
    }));
    return h('div', { class: 'seat-wrap' }, card, h('div', { class: 'swatches' }, h('span', { class: 'label', text: 'Your colour' }), swatches));
  }
  return card;
}

/** "No limit" for a timer that is switched off (0). */
const timerWords = (ms: number): string => (ms <= 0 ? 'No limit' : durationWords(ms));
/** When the stand-in bot comes: "at once" (0) or "after 90 s". */
const graceWords = (ms: number): string => (ms <= 0 ? 'At once' : `After ${durationWords(ms)}`);

function stepControl(label: string, value: number, steps: readonly number[], editable: boolean, set: (v: number) => unknown, words: (ms: number) => string = timerWords): HTMLElement {
  return h('span', { class: 'step2', attrs: { role: 'group', 'aria-label': label } },
    editable ? actionButton('−', 'stepbtn', () => set(stepValue(steps, value, -1)), { disabled: value <= steps[0]!, title: `Less (${label})` }) : null,
    h('span', { class: 'val', text: words(value) }),
    editable ? actionButton('+', 'stepbtn', () => set(stepValue(steps, value, 1)), { disabled: value >= steps[steps.length - 1]!, title: `More (${label})` }) : null);
}

function stepper(label: string, sub: string, value: number, steps: readonly number[], editable: boolean, set: (v: number) => unknown): HTMLElement {
  return h('div', { class: 'set' },
    h('div', { class: 'k' }, label, h('small', { text: sub })),
    h('div', { class: 'v' }, stepControl(label, value, steps, editable, set)));
}

const BOT_SPEED_HINT: Record<BotSpeed, string> = {
  normal: 'Bots wait until each move can be seen on the table',
  fast: 'Bots move quickly; some moves are not shown',
  instant: 'Bots move at once',
};

function settingsBlock(ctrl: AppController, st: RoomSettings, isHost: boolean): HTMLElement {
  const cfg = (patch: Partial<RoomSettings>): Promise<boolean> => ctrl.configure(patch);
  const seg = <T extends string | number>(items: { v: T; label: string }[], cur: T, set: (v: T) => unknown, name: string): HTMLElement =>
    h('span', { class: 'seg', attrs: { role: 'group', 'aria-label': name } }, items.map(it => isHost
      ? actionButton(it.label, it.v === cur ? 'on' : '', () => (it.v === cur ? undefined : set(it.v)), { title: `${name}: ${it.label}` })
      : h('span', { class: it.v === cur ? 'on' : '', text: it.label })));
  return h('div', { class: `settings${isHost ? '' : ' readonly'}` },
    h('div', { class: 'set' },
      h('div', { class: 'k' }, 'Players'),
      h('div', { class: 'v' }, seg([2, 3, 4].map(n => ({ v: n as 2 | 3 | 4, label: String(n) })), st.playerCount, v => cfg({ playerCount: v }), 'Players'))),
    h('div', { class: 'set' },
      h('div', { class: 'k' }, 'Bot speed', h('small', { text: BOT_SPEED_HINT[botSpeedOf(st)] })),
      h('div', { class: 'v' }, seg([
        { v: 'instant' as const, label: 'Instant' }, { v: 'fast' as const, label: 'Fast' }, { v: 'normal' as const, label: 'Normal' },
      ], botSpeedOf(st), v => ctrl.setBotSpeed(v), 'Bot speed'))),
    stepper('Operate timer', 'Time to answer an off-turn operate-or-skip prompt', st.factoryOpTimeoutMs, OPERATE_STEPS, isHost, v => cfg({ factoryOpTimeoutMs: v })),
    stepper('Round-end timer', 'An idle round-end turn ends after this', st.roundEndTimeoutMs, ROUND_END_STEPS, isHost, v => cfg({ roundEndTimeoutMs: v })),
    h('div', { class: 'set wide' },
      h('div', { class: 'k' }, 'If a player drops', h('small', {
        text: st.awayPolicy === 'bot'
          ? (st.awayGraceMs > 0
            ? `Their seat keeps its pieces; after ${durationWords(st.awayGraceMs)} a bot plays it until they come back`
            : 'Their seat keeps its pieces; a bot plays it at once until they come back')
          : 'Nobody plays their seat: the game waits until they come back',
      })),
      h('div', { class: 'v' },
        seg([{ v: 'bot' as const, label: 'A bot takes over' }, { v: 'wait' as const, label: 'Wait for the player' }], st.awayPolicy, v => cfg({ awayPolicy: v }), 'If a player drops'),
        st.awayPolicy === 'bot' ? stepControl('When the bot takes over', st.awayGraceMs, GRACE_STEPS, isHost, v => cfg({ awayGraceMs: v }), graceWords) : null)),
    isHost ? null : h('p', { class: 'hint wide', text: 'Only the host can change these settings.' }));
}

/**
 * A solo game's set-up: nothing about rooms, codes or ready flags (nobody else joins). Players,
 * bot speed, your colour, and Start.
 */
function soloSetup(ctrl: AppController, room: Room, info: ReturnType<typeof lobbyInfo>): Child[] {
  const st = room.settings;
  const me = ctrl.mySeat;
  const seg = <T extends string | number>(items: { v: T; label: string }[], cur: T, set: (v: T) => unknown, name: string): HTMLElement =>
    h('span', { class: 'seg', attrs: { role: 'group', 'aria-label': name } }, items.map(it =>
      actionButton(it.label, it.v === cur ? 'on' : '', () => (it.v === cur ? undefined : set(it.v)), { title: `${name}: ${it.label}` })));
  const swatches = me === null ? [] : colorChoices(room, me).map(c => h('button', {
    class: `swatch${c.mine ? ' on' : ''}`, style: `--sw:${COLORS[c.color]}`, disabled: !c.free,
    title: c.mine ? `${COLOR_NAME[c.color]} (yours)` : `Play ${COLOR_NAME[c.color].toLowerCase()}`,
    attrs: { 'aria-label': `Colour ${COLOR_NAME[c.color]}`, 'aria-pressed': String(c.mine) },
    onclick: () => { if (!c.mine) void ctrl.setColor(c.color); },
  }));
  const bots = room.seats.filter(s => s.kind === 'bot');
  return [
    topBar(ctrl, 'Solo game'),
    h('section', { class: 'tray panel solo-setup' },
      h('h1', { text: 'Game set-up' }),
      messageStrip(ctrl),
      h('div', { class: 'settings' },
        h('div', { class: 'set' },
          h('div', { class: 'k' }, 'Players', h('small', { text: 'You and the bots' })),
          h('div', { class: 'v' }, seg([2, 3, 4].map(n => ({ v: n as 2 | 3 | 4, label: String(n) })), st.playerCount, v => ctrl.configure({ playerCount: v }), 'Players'))),
        h('div', { class: 'set' },
          h('div', { class: 'k' }, 'Bot speed', h('small', { text: BOT_SPEED_HINT[botSpeedOf(st)] })),
          h('div', { class: 'v' }, seg([
            { v: 'instant' as const, label: 'Instant' }, { v: 'fast' as const, label: 'Fast' }, { v: 'normal' as const, label: 'Normal' },
          ], botSpeedOf(st), v => ctrl.setBotSpeed(v), 'Bot speed'))),
        h('div', { class: 'set wide' },
          h('div', { class: 'k' }, 'Your colour'),
          h('div', { class: 'v swatches' }, swatches)),
        // Each opponent, and which kind of bot plays it.
        bots.map(b => h('div', { class: 'set wide bot-set', attrs: { 'data-bot-seat': String(b.index) } },
          h('div', { class: 'k' }, h('span', { class: 'sw', style: `--seat:${COLORS[b.color]}` }), ' ', h('b', { text: b.name, style: `color:${COLORS[b.color]}` }),
            h('small', { text: `${COLOR_NAME[b.color]} · computer player` })),
          h('div', { class: 'v' }, botKindSelect(ctrl, b))))),
      h('div', { class: 'row end' },
        h('button', { class: 'btn btn-quiet btn-lg', onclick: () => ctrl.leave() }, 'Back'),
        actionButton([icon('play'), 'Start'], 'btn btn-gold btn-xl', () => ctrl.start(), { disabled: !info.canStart }))),
  ];
}

function waitingList(ctrl: AppController, room: Room, isHost: boolean): HTMLElement | null {
  if (room.waiting.length === 0) {
    return ctrl.mySeat === null ? null : h('p', { class: 'hint', text: 'Players who join with the name of a saved seat get that seat back. Anyone else waits here until the host gives them a seat.' });
  }
  const free = room.seats.filter(s => !(s.kind === 'human' && s.connected));
  return h('div', { class: 'waiting' },
    h('div', { class: 'label', text: 'Waiting for a seat' }),
    room.waiting.map(w => h('div', { class: 'wait-row well' },
      h('b', { text: w.name }),
      isHost
        ? h('div', { class: 'assign' }, h('span', { class: 'muted', text: 'Assign to seat:' }),
          free.map(s => actionButton(s.name || `Seat ${s.index + 1}`, 'btn btn-quiet', () => ctrl.assign(w.id, s.index), { title: `Give ${w.name} the seat of ${s.name}` })))
        : h('span', { class: 'muted', text: 'waiting for the host' }))));
}

function footer(ctrl: AppController, room: Room, info: ReturnType<typeof lobbyInfo>): HTMLElement {
  const me = ctrl.mySeat;
  const mySeat = me === null ? undefined : room.seats[me];
  const buttons: Child[] = [];
  let status: Child = info.needs;
  if (info.resuming) {
    if (me === null) status = 'You are waiting for a seat. The host can give you one of the saved seats.';
    if (info.isHost) buttons.push(actionButton([icon('play'), 'Continue game'], 'btn btn-gold btn-xl', () => ctrl.continueGame(), { disabled: !info.canStart }));
  } else {
    status = [h('b', { text: `${info.readyCount} of ${room.seats.length}` }), ' seats ready · ', info.needs];
    if (mySeat?.kind === 'human' && !ctrl.state.solo) {
      buttons.push(mySeat.ready
        ? actionButton('Not ready', 'btn btn-quiet btn-xl', () => ctrl.setReady(false))
        : actionButton([icon('check'), 'Ready'], info.isHost ? 'btn btn-dark btn-xl' : 'btn btn-gold btn-xl', () => ctrl.setReady(true)));
    }
    if (info.isHost) buttons.push(actionButton([icon('play'), 'Start'], 'btn btn-gold btn-xl', () => ctrl.start(), { disabled: !info.canStart }));
  }
  return h('div', { class: 'footer' }, h('div', { class: 'status', attrs: { 'aria-live': 'polite' } }, status), h('div', { class: 'footer-btns' }, buttons));
}
