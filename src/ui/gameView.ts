// The text view of a game: compact and readable, not pretty. Header, seats, the moves this
// seat may make (from legalActions), operate-or-skip prompts, hand, log, and the game menu.
// The 3D table will replace it as the main game screen; this stays as a fallback.

import type { AppController } from '../app/controller';
import type { GameOption, OptionGroup } from '../app/gameText';
import { finalStandings, gameOverWords, operatePrompts, optionGroups, phaseWords, refusalText } from '../app/gameText';
import { setPreferredView, tableFailure } from './viewPref';
import type { PlayerId } from '../engine/state';
import { tesseractCount } from '../engine/rules/scoring';
import type { Room, Seat } from '../session/room';
import { activeSeat } from '../session/room';
import { CARD_NAME, CARD_TEXT } from '../play/words';
import type { Child } from './dom';
import { actionButton, append, h, morph } from './dom';
import type { IconName } from './icons';
import { COLORS, icon } from './icons';
import { askLeave, connectionBanner, messageStrip } from './common';
import type { View } from './menuView';
import { playtestItems } from './playtestMenu';
import { versionTag } from './version';
import { openGuide } from './guide/open';

const LOG_LINES = 15;

export function gameView(ctrl: AppController): View {
  const el = h('main', { class: 'screen game' });
  const ui = { menuOpen: false, expanded: new Set<string>() };
  const update = (): void => {
    const room = ctrl.room;
    if (!room || !room.game) { el.replaceChildren(); return; }
    const fresh = h('main', { class: 'screen game' });
    append(fresh, render(ctrl, room, ui, update));
    morph(el, fresh);
  };
  return { el, update };
}

interface UiState { menuOpen: boolean; expanded: Set<string> }

function seconds(ms: number | null): string {
  return ms === null ? '' : `${Math.ceil(ms / 1000)} s`;
}

function render(ctrl: AppController, room: Room, ui: UiState, redraw: () => void): Child[] {
  const g = room.game!;
  const me = ctrl.mySeat;
  const turn = activeSeat(g);
  const myTurn = turn !== null && turn === me && !g.gameOver;
  const turnName = turn === null ? '' : room.seats[turn]?.name ?? '';
  const turnText = g.gameOver ? 'Game over' : myTurn ? 'Your turn' : `${turnName}'s turn`;

  const menuItems = ui.menuOpen ? h('div', { class: 'game-menu tray', attrs: { role: 'menu' } },
    actionButton([icon('link'), 'Copy save link'], 'menu-item', () => ctrl.copySaveLink()),
    h('button', { class: 'menu-item', onclick: () => ctrl.downloadSave() }, icon('download'), 'Download save file (.fsgame)'),
    ctrl.canShare ? actionButton([icon('share'), 'Share save…'], 'menu-item', () => ctrl.shareSave()) : null,
    ...playtestItems(ctrl, () => { ui.menuOpen = false; redraw(); }, 'menu-item'),
    tableFailure() === null
      ? h('button', { class: 'menu-item', onclick: () => setPreferredView('table') }, icon('table'), 'Switch to the table view')
      : null,
    h('button', { class: 'menu-item', attrs: { 'data-guide-item': '1' }, onclick: () => { ui.menuOpen = false; redraw(); openGuide(); } }, icon('book'), 'Game guide'),
    h('button', {
      class: 'menu-item danger',
      onclick: () => {
        const solo = ctrl.state.solo;
        const text = solo ? 'Leave this solo game? It stays in your saved games.' : 'Leave the game? The others continue, and you can come back with the same room code.';
        if (g.gameOver || ctrl.state.online?.status !== 'online') ctrl.leave();
        else askLeave(ctrl, text);
      },
    }, icon('leave'), 'Leave game'),
    versionTag(ctrl.appVersion, 'version-line')) : null;

  const header = h('header', { class: 'gamebar tray' },
    h('div', { class: 'gb-code' }, h('span', { class: 'label', text: 'Room' }), h('b', { class: 'num', text: ctrl.state.online?.code ?? room.code })),
    h('div', { class: 'gb-round' }, h('span', { class: 'label', text: 'Round' }), h('b', { class: 'num', text: String(g.round) })),
    h('div', { class: 'gb-phase' },
      h('div', { class: `gb-turn${myTurn ? ' mine' : ''}`, style: turn !== null ? `--seat:${COLORS[room.seats[turn]!.color]}` : '' },
        turn !== null && !g.gameOver ? h('span', { class: 'sw' }) : null, turnText),
      h('div', { class: 'muted', text: g.gameOver ? '' : phaseWords(g) })),
    h('button', {
      class: 'btn btn-quiet icon-only', title: 'Game menu',
      attrs: { 'aria-label': 'Game menu', 'aria-expanded': String(ui.menuOpen) },
      onclick: () => { ui.menuOpen = !ui.menuOpen; redraw(); },
    }, icon('menu')));

  const failed = tableFailure();
  return [
    h('div', { class: 'gb-wrap' }, header, menuItems),
    connectionBanner(ctrl),
    failed ? h('div', { class: 'warn', attrs: { role: 'status' }, text: `The 3D table could not start on this device, so the game is shown as text. ${failed}` }) : null,
    ctrl.state.cannotStore ? h('div', { class: 'warn', attrs: { role: 'alert' }, text: 'This device cannot store the game; use Copy save link or Download save file in the game menu.' }) : null,
    h('div', { class: 'game-grid' },
      h('div', { class: 'col-main' },
        g.gameOver ? gameOverPanel(ctrl, room) : null,
        promptsBlock(ctrl, room),
        optionsBlock(ctrl, room, ui, redraw)),
      h('div', { class: 'col-side' },
        seatsBlock(ctrl, room),
        handBlock(room, me),
        logBlock(room))),
  ];
}

function gameOverPanel(ctrl: AppController, room: Room): HTMLElement {
  const order = finalStandings(room);
  return h('section', { class: 'tray panel over' },
    h('h2', { text: 'Game over' }),
    h('p', { class: 'over-words', text: gameOverWords(room) }),
    h('ol', { class: 'standings' }, order.map(o => h('li', null,
      h('span', { class: 'sw', style: `background:${COLORS[room.seats[o.seat]!.color]}` }), h('b', { text: room.seats[o.seat]!.name }),
      h('span', { class: 'muted', text: ` · ${o.tesseracts} Tesseract${o.tesseracts === 1 ? '' : 's'} · ${o.points} points` })))),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-gold btn-lg', onclick: () => ctrl.backToMenu() }, 'Back to menu'),
      h('button', { class: 'btn btn-dark btn-lg', onclick: () => { void ctrl.watchThisGame(); } }, icon('replay'), 'Watch this game again'),
      h('button', { class: 'btn btn-quiet btn-lg', onclick: () => ctrl.downloadReplay() }, icon('download'), 'Save replay')));
}

function promptsBlock(ctrl: AppController, room: Room): HTMLElement | null {
  const g = room.game!;
  const me = ctrl.mySeat;
  const prompts = operatePrompts(room);
  if (prompts.length === 0 && !ctrl.state.moveError) return null;
  const active = activeSeat(g);
  const left = ctrl.msLeft(room.opDeadline);
  const busy = !!ctrl.state.online?.client.pending;
  const mine = prompts.filter(p => p.seat === me);
  const others = prompts.filter(p => p.seat !== me);
  return h('section', { class: 'prompts', attrs: { 'aria-live': 'polite' } },
    ctrl.state.moveError ? h('div', { class: 'error', attrs: { role: 'alert' } },
      h('span', { text: refusalText(ctrl.state.moveError) }),
      h('button', { class: 'x', title: 'Dismiss', attrs: { 'aria-label': 'Dismiss' }, onclick: () => ctrl.dismissError() }, icon('cross'))) : null,
    mine.map(p => h('div', { class: 'prompt tray' },
      h('div', { class: 'prompt-text' },
        h('b', { text: `Your ${p.label} was activated by the roll.` }),
        h('span', { class: 'muted', text: ` Operate: ${p.cost}` }),
        p.seat !== active && left !== null ? h('span', { class: 'countdown', text: `${seconds(left)} left, then it operates if it can` }) : null),
      h('div', { class: 'row' },
        actionButton('Operate', 'btn btn-gold btn-lg', () => ctrl.act(p.operate), { disabled: busy }),
        actionButton('Skip', 'btn btn-dark btn-lg', () => ctrl.act(p.skip), { disabled: busy })))),
    others.map(p => h('div', { class: 'prompt-other' },
      h('span', { class: 'sw', style: `background:${COLORS[room.seats[p.seat]!.color]}` }),
      h('span', { text: `${room.seats[p.seat]?.name ?? 'A player'} is choosing whether to operate the ${p.label}` }),
      p.seat !== active && left !== null ? h('span', { class: 'countdown', text: seconds(left) }) : null)));
}

function count(name: IconName, n: number, label: string, cls = ''): HTMLElement {
  return h('span', { class: `count ${cls}`, title: label, attrs: { 'aria-label': `${label}: ${n}` } }, icon(name), h('span', { class: 'num', text: String(n) }));
}

function seatState(ctrl: AppController, room: Room, s: Seat): Child[] {
  const g = room.game!;
  const out: Child[] = [];
  const active = activeSeat(g);
  if (s.kind === 'bot') out.push(h('span', { class: 'tag' }, icon('bot'), 'bot'));
  else if (s.autopilot) out.push(h('span', { class: 'tag' }, icon('bot'), 'bot is playing'));
  else if (!s.connected) {
    let away = 'away';
    if (room.settings.awayPolicy === 'bot' && s.awaySince !== null && !room.hold) {
      const left = ctrl.msLeft(s.awaySince + room.settings.awayGraceMs);
      if (left !== null && left > 0) away = `away · bot in ${seconds(left)}`;
    }
    out.push(h('span', { class: 'tag warn', text: away }));
  }
  if (!g.gameOver) {
    const owes = g.pendingFactoryOps.some(e => e.ownerId === s.index);
    if (owes && s.index !== active && room.opDeadline !== null) out.push(h('span', { class: 'countdown', text: seconds(ctrl.msLeft(room.opDeadline)) }));
    else if (owes) out.push(h('span', { class: 'tag', text: 'choosing' }));
    if (s.index === active && room.roundEndDeadline !== null) out.push(h('span', { class: 'countdown', text: seconds(ctrl.msLeft(room.roundEndDeadline)) }));
  }
  return out;
}

function seatsBlock(ctrl: AppController, room: Room): HTMLElement {
  const g = room.game!;
  const me = ctrl.mySeat;
  const active = activeSeat(g);
  return h('section', { class: 'seat-rows', attrs: { 'aria-label': 'Players' } },
    room.seats.map(s => {
      const p = g.players[s.index]!;
      const inv = p.inventory;
      const isTurn = s.index === active && !g.gameOver;
      return h('div', { class: `seat-row tray${isTurn ? ' turn' : ''}`, style: `--seat:${COLORS[s.color]}` },
        h('span', { class: 'stripe' }),
        h('div', { class: 'sr-body' },
          h('div', { class: 'sr-top' },
            h('b', { class: 'sr-name', text: s.name }),
            s.index === me ? h('span', { class: 'you', text: 'you' }) : null,
            s.index === room.hostSeat ? icon('crown', undefined, 'ic small gold') : null,
            isTurn ? h('span', { class: 'turn-tag', text: 'turn' }) : null,
            h('span', { class: 'sr-state' }, seatState(ctrl, room, s))),
          h('div', { class: 'counts' },
            count('tess', tesseractCount(g, s.index as PlayerId), 'Tesseracts (of 4)', 'tess'),
            count('ore', inv.ore, 'Ore'),
            count('plate', inv.plate, 'Plates'),
            count('sphere', inv.sphere, 'Spheres'),
            count('power', p.powerTokens, 'Power Tokens'),
            count('card', p.hand.length, 'Cards in hand'))));
    }));
}

function optionButton(ctrl: AppController, o: GameOption, cls: string, busy: boolean): HTMLButtonElement {
  return actionButton(o.label, cls, () => ctrl.act(o.action), { disabled: busy });
}

function groupBody(ctrl: AppController, grp: OptionGroup, busy: boolean): Child[] {
  const big = grp.id === 'roll' || grp.id === 'end';
  const cls = big ? 'btn btn-gold btn-lg opt-big' : 'opt';
  const subs = new Map<string, GameOption[]>();
  const plain: GameOption[] = [];
  for (const o of grp.options) {
    if (o.sub === undefined) plain.push(o);
    else subs.set(o.sub, [...(subs.get(o.sub) ?? []), o]);
  }
  return [
    plain.length ? h('div', { class: 'opts' }, plain.map(o => optionButton(ctrl, o, cls, busy))) : null,
    [...subs].map(([sub, opts]) => h('div', { class: 'sub' },
      h('div', { class: 'sub-title', text: sub }),
      h('div', { class: 'opts' }, opts.map(o => optionButton(ctrl, o, cls, busy))))),
  ];
}

function optionsBlock(ctrl: AppController, room: Room, ui: UiState, redraw: () => void): HTMLElement | null {
  const g = room.game!;
  if (g.gameOver) return null;
  const me = ctrl.mySeat;
  const mySeat = me === null ? undefined : room.seats[me];
  const busy = !!ctrl.state.online?.client.pending;
  const groups = optionGroups(room, me);
  const body: Child[] = [];

  if (me === null) {
    body.push(h('p', { class: 'muted', text: 'You do not have a seat in this game. The host can give you one.' }));
  } else if (!g.gameOver) {
    if (mySeat?.autopilot) {
      body.push(h('div', { class: 'note' }, h('span', { text: 'A bot is playing your seat. ' }),
        actionButton('Take my seat back', 'btn btn-gold', () => ctrl.takeSeatBack())));
    }
    body.push(h('div', { class: 'auto-row' },
      h('button', {
        class: `switch${ctrl.state.autoplay ? ' on' : ''}`, attrs: { role: 'switch', 'aria-checked': String(ctrl.state.autoplay) },
        onclick: () => ctrl.toggleAutoplay(),
      }, h('span', { class: 'knob' }), 'Autoplay my seat'),
      h('span', { class: 'muted', text: ctrl.state.autoplay ? 'A bot on this device makes your moves.' : '' })));
    if (groups.length === 0) {
      const turn = activeSeat(g);
      const waitingOn = g.pendingFactoryOps.length > 0 ? 'Waiting for operate-or-skip choices.'
        : turn === me ? (busy ? 'Sending your move…' : 'Nothing to do right now.') : `Waiting for ${room.seats[turn ?? 0]?.name ?? 'the next player'}.`;
      body.push(h('p', { class: 'muted waiting-line', text: waitingOn }));
    }
    for (const grp of groups) {
      const open = !grp.collapsed || ui.expanded.has(grp.id);
      const head = grp.collapsed
        ? h('button', {
          class: 'group-head toggle', attrs: { 'aria-expanded': String(open) },
          onclick: () => { if (open) ui.expanded.delete(grp.id); else ui.expanded.add(grp.id); redraw(); },
        }, h('span', { text: `${grp.title} — ${grp.options.length} ${grp.noun}` }), icon('chevron', undefined, `ic chev${open ? ' up' : ''}`))
        : h('div', { class: 'group-head', text: grp.title });
      body.push(h('div', { class: `group g-${grp.id}` }, head, open ? groupBody(ctrl, grp, busy) : null));
    }
  }
  return h('section', { class: 'tray panel options' },
    h('h2', { text: 'Your options' }),
    messageStrip(ctrl),
    body);
}

function handBlock(room: Room, me: number | null): HTMLElement | null {
  if (me === null) return null;
  const hand = room.game!.players[me]?.hand ?? [];
  return h('section', { class: 'tray panel hand' },
    h('h2', { text: `Your hand · ${hand.length} card${hand.length === 1 ? '' : 's'}` }),
    hand.length === 0 ? h('p', { class: 'muted', text: 'No Leverage cards. Buy them during step 3.' }) : null,
    h('div', { class: 'cards' }, hand.map(c => h('div', { class: 'card-row well' },
      h('b', { text: CARD_NAME[c] }),
      h('span', { class: 'muted', text: CARD_TEXT[c] })))));
}

function logBlock(room: Room): HTMLElement {
  const lines = room.log.slice(-LOG_LINES).reverse();
  return h('section', { class: 'tray panel log' },
    h('h2', { text: 'Log' }),
    h('ol', { class: 'log-lines' }, lines.map(e => {
      const s = e.seat === null ? undefined : room.seats[e.seat];
      return h('li', null, h('span', { class: 'sw', style: s ? `background:${COLORS[s.color]}` : 'background:#5d5a55' }), h('span', { text: e.text }));
    })));
}
