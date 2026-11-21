// The room lobby (mock-up 05), and the same screen in "resuming" mode for a held saved game.
// Rebuilt whole on every change: it has buttons only, no text fields.

import type { AppController } from '../app/controller';
import { GRACE_STEPS, OPERATE_STEPS, ROUND_END_STEPS, colorChoices, durationWords, lobbyInfo, stepValue } from '../app/lobby';
import type { Room, RoomSettings, Seat } from '../session/room';
import type { Child } from './dom';
import { actionButton, append, h, morph } from './dom';
import { COLORS, COLOR_NAME, icon } from './icons';
import { connectionBanner, messageStrip, topBar } from './common';
import type { View } from './menuView';

export function lobbyView(ctrl: AppController): View {
  const el = h('main', { class: 'screen lobby' });
  const update = (): void => {
    const room = ctrl.room;
    if (!room) { el.replaceChildren(); return; }
    const fresh = h('main', { class: 'screen lobby' });
    append(fresh, render(ctrl, room));
    morph(el, fresh);
  };
  return { el, update };
}

function render(ctrl: AppController, room: Room): Child[] {
  const me = ctrl.mySeat;
  const info = lobbyInfo(room, me);
  const resuming = info.resuming;
  const solo = ctrl.state.solo;
  const title = resuming ? `Saved game · round ${room.game?.round ?? 0}` : solo ? 'Solo game' : 'Room lobby';
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
    meta += ' · computer player';
    state = h('span', { class: 'state bot', text: 'Bot · ready' });
    if (isHost && !resuming && !ctrl.state.solo) controls.push(actionButton('Open seat', 'btn btn-quiet', () => ctrl.openSeat(s.index)));
  } else {
    nameLine.push(h('span', { text: s.name }));
    if (s.index === room.hostSeat) nameLine.push(h('span', { class: 'tagh' }, icon('crown'), 'HOST'));
    if (mine) meta += ' · you';
    if (resuming) {
      meta += s.connected ? ' · back' : ' · not back yet';
      state = s.connected ? h('span', { class: 'state ready' }, icon('check'), 'Back') : h('span', { class: 'state wait', text: 'Away' });
      if (isHost && !s.connected && !mine) controls.push(actionButton([icon('bot'), 'Give to a bot'], 'btn btn-quiet', () => ctrl.seatToBot(s.index)));
    } else {
      if (!mine) meta += s.connected ? ' · connected' : ' · not connected';
      state = s.ready ? h('span', { class: 'state ready' }, icon('check'), 'Ready') : h('span', { class: 'state wait', text: 'Not ready' });
    }
    if (isHost && !mine && !resuming) controls.push(actionButton('Remove', 'btn btn-quiet', () => {
      if (window.confirm(`Remove ${s.name} from the room?`)) return ctrl.kick(s.index);
      return undefined;
    }));
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

function stepControl(label: string, value: number, steps: readonly number[], editable: boolean, set: (v: number) => unknown): HTMLElement {
  return h('span', { class: 'step2', attrs: { role: 'group', 'aria-label': label } },
    editable ? actionButton('−', 'stepbtn', () => set(stepValue(steps, value, -1)), { disabled: value <= steps[0]!, title: `Less (${label})` }) : null,
    h('span', { class: 'val', text: durationWords(value) }),
    editable ? actionButton('+', 'stepbtn', () => set(stepValue(steps, value, 1)), { disabled: value >= steps[steps.length - 1]!, title: `More (${label})` }) : null);
}

function stepper(label: string, sub: string, value: number, steps: readonly number[], editable: boolean, set: (v: number) => unknown): HTMLElement {
  return h('div', { class: 'set' },
    h('div', { class: 'k' }, label, h('small', { text: sub })),
    h('div', { class: 'v' }, stepControl(label, value, steps, editable, set)));
}

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
    stepper('Operate timer', 'Time to answer an off-turn operate-or-skip prompt', st.factoryOpTimeoutMs, OPERATE_STEPS, isHost, v => cfg({ factoryOpTimeoutMs: v })),
    stepper('Round-end timer', 'An idle round-end turn ends after this', st.roundEndTimeoutMs, ROUND_END_STEPS, isHost, v => cfg({ roundEndTimeoutMs: v })),
    h('div', { class: 'set wide' },
      h('div', { class: 'k' }, 'If a player drops', h('small', {
        text: st.awayPolicy === 'bot'
          ? `Their seat keeps its pieces; ${st.awayGraceMs > 0 ? `after ${durationWords(st.awayGraceMs)} ` : ''}a bot plays until they reconnect`
          : 'The game waits for them to come back',
      })),
      h('div', { class: 'v' },
        seg([{ v: 'bot' as const, label: 'Bot takes over' }, { v: 'wait' as const, label: 'Wait' }], st.awayPolicy, v => cfg({ awayPolicy: v }), 'If a player drops'),
        st.awayPolicy === 'bot' ? stepControl('Grace time', st.awayGraceMs, GRACE_STEPS, isHost, v => cfg({ awayGraceMs: v })) : null)),
    isHost ? null : h('p', { class: 'hint wide', text: 'Only the host can change these settings.' }));
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
