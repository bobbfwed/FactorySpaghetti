// Your area: the Control Module tray, meeple, Power Tokens, belts, teleporters, materials,
// Tesseract progress and your hand. Desktop shows it as a panel along the bottom; the phone shows
// a bottom sheet (collapsed: turn, instruction, materials strip, primary button; pulled up: tabs
// Tray · Cards · Log · Rules).

import type { PlayerId } from '../../engine/state';
import { MAX_CARDS_PLAYED_PER_TURN, POWER_TOKEN_CAP } from '../../engine/config';
import { tesseractCount } from '../../engine/rules/scoring';
import { BUILDING_NAME, MATERIAL_NAME } from '../../session/describe';
import type { Child } from '../dom';
import { h } from '../dom';
import { icon } from '../icons';
import { bankRows } from './bank';
import type { Ctx, SheetTab } from './context';
import { seatColor, seatHex, seatName } from './context';
import { MATERIAL_ICON, MATERIAL_LIST, cardFace, count, materialWell, moduleTray, pips, sectionHead } from './pieces';
import { promptList } from './prompts';
import { BONUS_NAME } from './rules';
import { cachedBonuses, cachedLog, cachedRules } from './memo';
import { primaryButton, stepLine, undoBeltsButton } from './turnBar';

function meepleWords(ctx: Ctx): string {
  const p = ctx.game.players[ctx.me!]!;
  if (p.meepleOnPieceId === null) return 'in your supply';
  const piece = ctx.game.board.find(b => b.id === p.meepleOnPieceId);
  if (!piece) return 'on the board';
  if (piece.type === 'mine') return p.meepleSlotIndex === 1 ? 'on a Mine upgrade point' : 'on a Mine resource point';
  return `on your ${BUILDING_NAME[piece.type]}`;
}

/** Upgrade currencies available now, e.g. "2 end-of-round". */
function upgrades(ctx: Ctx): string {
  const g = ctx.game;
  const p = g.players[ctx.me!]!;
  const parts: string[] = [];
  if (g.productionIncreaseBudget > 0 && ctx.view.myTurn) parts.push(`${g.productionIncreaseBudget} Production Increase`);
  if (p.freeUpgradesRemaining > 0) parts.push(`${p.freeUpgradesRemaining} end-of-round`);
  if (p.freeActionCredits > 0) parts.push(`${p.freeActionCredits} Mine credits`);
  return parts.length ? parts.join(' · ') : '0';
}

function bonusChips(ctx: Ctx): Child {
  const p = ctx.game.players[ctx.me!]!;
  const held = (Object.keys(p.bonusTesseracts) as (keyof typeof p.bonusTesseracts)[]).filter(k => p.bonusTesseracts[k]);
  if (held.length === 0) return null;
  return h('div', { class: 'tg-bonuschips' }, held.map(k => h('span', { class: 'tg-bonuschip', title: 'Bonus card: counts as a Tesseract' }, icon('tess', undefined, 'ic small'), BONUS_NAME[k])));
}

function beltButton(ctx: Ctx, cls: string): HTMLElement {
  const p = ctx.game.players[ctx.me!]!;
  const it = ctx.view.bank.find(b => b.id === 'bank:placeBelt');
  const color = seatColor(ctx.room, ctx.me);
  return h('button', {
    class: `${cls} well tg-beltbtn${it?.enabled ? ' lit' : ''}`,
    title: it ? (it.enabled ? `${it.label}: tap, then tap a glowing connection point` : it.reason ?? it.label) : 'Belts',
    attrs: { 'aria-label': `Belts: ${p.beltsRemaining}. ${it?.enabled ? 'Tap to lay a belt' : it?.reason ?? ''}`, 'aria-disabled': String(!it?.enabled), 'data-item': 'bank:placeBelt' },
    onclick: () => ctx.play.choose('bank:placeBelt'),
  }, icon('belt', color), h('span', { class: 'nm', text: it?.enabled ? 'Lay a belt' : 'Belts' }), h('span', { class: 'num', text: String(p.beltsRemaining) }));
}

function components(ctx: Ctx, cls: string): Child[] {
  const p = ctx.game.players[ctx.me!]!;
  const color = seatColor(ctx.room, ctx.me);
  return [
    h('div', { class: `${cls} well`, attrs: { 'aria-label': `Power Tokens: ${p.powerTokens} of ${POWER_TOKEN_CAP}` } },
      icon('power'), h('span', { class: 'nm', text: 'Power Tokens' }), h('span', { class: 'num' }, String(p.powerTokens), h('small', { text: `/${POWER_TOKEN_CAP}` }))),
    beltButton(ctx, cls),
    h('div', { class: `${cls} well`, attrs: { 'aria-label': `Teleporters left: ${p.teleportersRemaining}` } },
      icon('teleporter', color), h('span', { class: 'nm', text: 'Teleporters' }), h('span', { class: 'num', text: String(p.teleportersRemaining) })),
  ];
}

function handCards(ctx: Ctx, fan: boolean): HTMLElement {
  const hand = ctx.view.hand;
  if (hand.length === 0) {
    return h('div', { class: 'tg-hand empty' }, h('p', { class: 'muted', text: 'No Leverage cards. Buy them from the bank in step 3.' }));
  }
  const n = hand.length;
  return h('div', { class: `tg-hand${fan ? ' fan' : ' grid'}`, style: `--n:${n}`, attrs: { role: 'list', 'aria-label': 'Your hand' } }, hand.map((c, i) => {
    const mid = (n - 1) / 2;
    const style = fan ? `--i:${i};--rot:${((i - mid) * Math.min(6, 18 / n)).toFixed(1)}deg` : '';
    const cnt = c.count ?? 1;
    // The list item carries the role; the card inside stays a button.
    return h('div', { class: 'tg-li', style, attrs: { role: 'listitem' } }, h('button', {
      class: `tg-handcard${c.enabled ? ' playable' : ''}`,
      title: c.enabled ? `${c.label}: tap to read and play` : `${c.label}: ${c.reason ?? ''}`,
      attrs: { 'data-card': c.card, 'data-act': `card:${c.card}`, 'aria-label': `${c.label}. ${c.text}${c.enabled ? '' : ` ${c.reason ?? ''}`}` },
      onclick: () => { ctx.ui.card = c.card; ctx.redraw(); },
    }, cardFace(c.card, { count: cnt, off: !c.enabled })));
  }));
}

/** Desktop: the panel along the bottom. */
export function yourPanel(ctx: Ctx): HTMLElement | null {
  if (ctx.me === null) return null;
  const g = ctx.game;
  const p = g.players[ctx.me]!;
  const color = seatColor(ctx.room, ctx.me);
  return h('div', { class: 'tg-yours tray', style: `--seat:${seatHex(ctx.room, ctx.me)}`, attrs: { 'aria-label': 'Your area' } },
    h('div', { class: 'tg-sec who' },
      h('div', { class: 'tg-who' }, h('span', { class: 'sw' }), h('span', { class: 'nm', text: seatName(ctx.room, ctx.me) }), h('span', { class: 'muted', text: 'you' })),
      h('div', { class: 'tg-kv2' }, h('span', { text: 'Tesseracts' }), pips(tesseractCount(g, ctx.me as PlayerId))),
      bonusChips(ctx),
      h('div', { class: 'tg-kv2' }, icon('meeple', color), h('span', { text: 'Meeple' }), h('span', { class: 'v', text: meepleWords(ctx) })),
      h('div', { class: 'tg-kv2' }, h('span', { text: 'Upgrades' }), h('span', { class: 'v', text: upgrades(ctx) })),
      ctx.view.myTurn ? h('div', { class: 'tg-kv2' }, h('span', { text: 'Leverage cards played' }), h('span', { class: 'v num', text: `${g.cardsPlayedThisTurn} / ${MAX_CARDS_PLAYED_PER_TURN}` })) : null),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec' }, h('span', { class: 'label', text: 'Control Modules' }), moduleTray(ctx.view.tray, color, id => ctx.play.choose(id), 'desk', ctx.view.instruction)),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec comps' }, components(ctx, 'tg-comp')),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec mats' }, h('div', { class: 'tg-mats' }, MATERIAL_LIST.map(m => materialWell(m, p.inventory[m])))),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec handsec' }, h('span', { class: 'label', text: `Hand · ${p.hand.length}` }), handCards(ctx, true)),
    h('div', { class: 'tg-act' }, autoplayNote(ctx), undoBeltsButton(ctx), primaryButton(ctx)));
}

function autoplayNote(ctx: Ctx): Child {
  if (ctx.game.gameOver) return null;
  const seat = ctx.me === null ? undefined : ctx.room.seats[ctx.me];
  if (seat?.autopilot) {
    return h('button', { class: 'btn btn-dark tg-auto', onclick: () => { void ctx.ctrl.takeSeatBack(); } }, icon('bot'), 'Take my seat back');
  }
  if (ctx.ctrl.state.autoplay) {
    return h('button', { class: 'btn btn-dark tg-auto on', title: 'A bot on this device is making your moves', onclick: () => ctx.ctrl.toggleAutoplay() }, icon('bot'), 'Autoplay on · stop');
  }
  return null;
}

// ── Phone sheet ─────────────────────────────────────────────────────────────

function strip(ctx: Ctx): HTMLElement {
  const p = ctx.game.players[ctx.me!]!;
  const color = seatColor(ctx.room, ctx.me);
  return h('div', { class: 'tg-strip well', attrs: { 'aria-label': 'Your materials' } },
    MATERIAL_LIST.map(m => count(MATERIAL_ICON[m], p.inventory[m], MATERIAL_NAME[m], undefined, p.inventory[m] === 0 ? 'zero' : '')),
    h('span', { class: 'sep' }),
    count('power', p.powerTokens, 'Power Tokens'),
    count('card', p.hand.length, 'Leverage cards'),
    count('belt', p.beltsRemaining, 'Belts', color));
}

const TABS: { id: SheetTab; label: string }[] = [
  { id: 'tray', label: 'Tray' }, { id: 'cards', label: 'Cards' }, { id: 'log', label: 'Log' }, { id: 'rules', label: 'Rules' },
];

function tabContent(ctx: Ctx): Child {
  const g = ctx.game;
  switch (ctx.ui.sheetTab) {
    case 'tray': {
      if (ctx.me === null) return h('p', { class: 'muted', text: 'You are watching this game.' });
      const p = g.players[ctx.me]!;
      const color = seatColor(ctx.room, ctx.me);
      return h('div', { class: 'tg-traytab' },
        h('div', { class: 'tg-trayrow' },
          h('div', null, sectionHead('Control Modules'), moduleTray(ctx.view.tray, color, id => ctx.play.choose(id), 'phone', ctx.view.instruction)),
          h('div', { class: 'side' }, sectionHead('Components'), components(ctx, 'tg-comp'),
            h('div', { class: 'tg-mats' }, MATERIAL_LIST.map(m => materialWell(m, p.inventory[m], 'tg-mat small'))))),
        h('div', { class: 'tg-kvs' },
          h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Tesseracts' }), h('span', { class: 'v' }, pips(tesseractCount(g, ctx.me as PlayerId)))),
          h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Meeple' }), h('span', { class: 'v', text: meepleWords(ctx) })),
          h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Upgrades' }), h('span', { class: 'v', text: upgrades(ctx) })),
          ctx.view.myTurn ? h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Leverage cards played this turn' }), h('span', { class: 'v', text: `${g.cardsPlayedThisTurn} / ${MAX_CARDS_PLAYED_PER_TURN}` })) : null),
        bonusChips(ctx),
        g.gameOver ? null : h('div', null, sectionHead('Bank', h('span', { class: 'muted', text: 'prices in material value' })), bankRows(ctx)));
    }
    case 'cards':
      return h('div', null, sectionHead(handTitle(ctx),
        h('span', { class: 'muted', text: 'Tap a card to read and play' })), ctx.me === null ? null : handCards(ctx, false));
    case 'log': return cachedLog(ctx);
    case 'rules': return h('div', null, cachedRules(ctx), h('h3', { text: 'Bonus Tesseracts' }), cachedBonuses(ctx));
  }
}

function handTitle(ctx: Ctx): string {
  const n = ctx.me === null ? 0 : ctx.game.players[ctx.me]?.hand.length ?? 0;
  return `Your hand · ${n} ${n === 1 ? 'card' : 'cards'}`;
}

/** Phone: the bottom sheet. */
export function phoneSheet(ctx: Ctx): HTMLElement {
  // A phone held sideways shows the sheet as a full-height panel on the right, always open.
  const open = ctx.ui.sheetOpen || ctx.landscape;
  const toggle = (): void => { ctx.ui.sheetOpen = !ctx.ui.sheetOpen; if (!ctx.ui.sheetOpen) ctx.ui.sheetUserClosed = true; ctx.redraw(); };
  const cards = ctx.view.hand.length;
  const grab = ctx.landscape ? null : h('button', {
    class: 'tg-grab', title: open ? 'Pull down' : 'Pull up for your tray, cards, log and rules',
    attrs: { 'aria-expanded': String(open), 'aria-label': open ? 'Close your tray' : 'Open your tray, cards, log and rules', 'data-grab': '1' },
    onclick: toggle,
  }, h('span', { class: 'bar' }));
  return h('div', { class: `tg-sheet tray${open ? ' open' : ''}`, attrs: { 'aria-label': 'Your area' } },
    grab,
    ctx.landscape ? stepLine(ctx) : null,
    promptList(ctx),
    open
      ? [
        h('div', { class: 'tg-tabs well', attrs: { role: 'tablist' } }, TABS.map(t => h('button', {
          class: ctx.ui.sheetTab === t.id ? 'on' : '',
          attrs: { role: 'tab', 'aria-selected': String(ctx.ui.sheetTab === t.id), 'data-tab': t.id },
          onclick: () => { ctx.ui.sheetTab = t.id; ctx.redraw(); },
        }, t.label, t.id === 'cards' && cards > 0 ? h('span', { class: 'badge', text: String(ctx.game.players[ctx.me ?? 0]?.hand.length ?? cards) }) : null))),
        h('div', { class: 'tg-sheetbody', attrs: { role: 'tabpanel' } }, tabContent(ctx)),
      ]
      : [stepLine(ctx), ctx.me !== null ? strip(ctx) : null],
    ctx.me !== null ? h('div', { class: 'tg-sheetact' }, autoplayNote(ctx), undoBeltsButton(ctx), primaryButton(ctx)) : null);
}
