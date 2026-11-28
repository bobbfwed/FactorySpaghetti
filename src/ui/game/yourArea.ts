// Your area: the Control Module tray, meeple, Power Tokens, belts, teleporters, materials,
// Tesseract progress and your hand. Desktop shows it as a panel along the bottom; the phone shows
// a bottom sheet (collapsed: turn, instruction, materials strip, primary button; pulled up: tabs
// Tray · Cards · Log · Rules).

import type { PlayerId } from '../../engine/state';
import { MAX_CARDS_PLAYED_PER_TURN, POWER_TOKEN_CAP } from '../../engine/config';
import { tesseractCount } from '../../engine/rules/scoring';
import { BUILDING_NAME, MATERIAL_NAME } from '../../session/describe';
import { W } from '../../play/words';
import type { Child } from '../dom';
import { h } from '../dom';
import { icon } from '../icons';
import { bankRows } from './bank';
import type { Ctx, SheetTab } from './context';
import { seatColor, seatHex, seatName } from './context';
import { MATERIAL_ICON, MATERIAL_LIST, cardFace, count, materialWell, moduleTray, pips, sectionHead, totalValue } from './pieces';
import { promptList } from './prompts';
import { storageStrip } from './feedback';
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

/** "Spend Production Increase": its upgrades can be spent in any step of the turn it was played in. */
function piButton(ctx: Ctx): Child {
  const it = ctx.view.bank.find(b => b.id === 'bank:pi');
  if (!it || !it.enabled) return null;
  return h('button', {
    class: 'btn btn-dark tg-pibtn', title: `${it.label}: ${it.detail ?? ''}`,
    attrs: { 'data-item': it.id, 'data-act': it.id, 'aria-label': `${it.label}, ${it.detail ?? ''}` },
    // The buildings to tap are on the table: the phone's sheet makes way for them.
    onclick: () => { if (ctx.phone) ctx.ui.sheetOpen = false; ctx.play.choose(it.id); },
  }, h('span', { text: it.label }), h('small', { text: it.detail ?? '' }));
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

/** Remove a belt: its own mode, beside Lay a belt (my removable belts light up). */
function removeBeltButton(ctx: Ctx): HTMLElement {
  const it = ctx.view.bank.find(b => b.id === 'bank:removeBelt');
  const on = ctx.view.selection?.label === W.removeSelection;
  return h('button', {
    class: `well tg-rmbelt${it?.enabled ? '' : ' off'}${on ? ' on' : ''}`,
    title: it ? (it.enabled ? it.detail ?? it.label : it.reason ?? it.label) : 'Remove a belt',
    attrs: { 'aria-label': `Remove a belt${it?.enabled ? '' : `. ${it?.reason ?? ''}`}`, 'aria-disabled': String(!it?.enabled), 'data-item': 'bank:removeBelt', 'data-act': 'bank:removeBelt' },
    onclick: () => ctx.play.choose('bank:removeBelt'),
  }, h('span', { class: 'tx', text: 'Remove' }));
}

/**
 * Teleporters: like Lay a belt, a button that is lit when a teleporter can be placed now (the bank's
 * "Place a teleporter"); pressed when it cannot, it says why.
 */
function teleporterButton(ctx: Ctx, cls: string): HTMLElement {
  const p = ctx.game.players[ctx.me!]!;
  const it = ctx.view.bank.find(b => b.id === 'bank:teleporter');
  const color = seatColor(ctx.room, ctx.me);
  const say = it ? (it.enabled ? `${it.label}: tap, then tap the buffer of one of your buildings` : it.reason ?? it.label) : 'Teleporters';
  return h('button', {
    class: `${cls} well tg-tpbtn${it?.enabled ? ' lit' : ''}`,
    title: say,
    attrs: { 'aria-label': `Teleporters left: ${p.teleportersRemaining}. ${it?.enabled ? 'Tap to place a teleporter' : it?.reason ?? ''}`, 'aria-disabled': String(!it?.enabled), 'data-item': 'bank:teleporter' },
    onclick: () => ctx.play.choose('bank:teleporter'),
  }, icon('teleporter', color), h('span', { class: 'nm', text: it?.enabled ? 'Place a teleporter' : 'Teleporters' }), h('span', { class: 'num', text: String(p.teleportersRemaining) }));
}

function components(ctx: Ctx, cls: string): Child[] {
  const p = ctx.game.players[ctx.me!]!;
  return [
    h('div', { class: `${cls} well`, attrs: { 'aria-label': `Power Tokens: ${p.powerTokens} of ${POWER_TOKEN_CAP}` } },
      icon('power'), h('span', { class: 'nm', text: 'Power Tokens' }), h('span', { class: 'num' }, String(p.powerTokens), h('small', { text: `/${POWER_TOKEN_CAP}` }))),
    h('div', { class: 'tg-beltrow' }, beltButton(ctx, cls), removeBeltButton(ctx)),
    teleporterButton(ctx, cls),
  ];
}

/** My materials: Plate, Sphere and Tesseract are buttons that offer to break one down. */
function materialWells(ctx: Ctx, cls?: string): HTMLElement[] {
  const p = ctx.game.players[ctx.me!]!;
  return MATERIAL_LIST.map(m => {
    const item = ctx.view.inventory.find(i => i.id === `inv:${m}`);
    return materialWell(m, p.inventory[m], cls, item ? { item, choose: id => ctx.play.choose(id) } : undefined);
  });
}

function handCards(ctx: Ctx, fan: boolean): HTMLElement {
  const hand = ctx.view.hand;
  if (hand.length === 0) {
    return h('div', { class: 'tg-hand empty' }, h('p', { class: 'muted', text: 'No Leverage cards. Buy them from the bank in step 3.' }));
  }
  // In the bottom panel the layout (whole cards, title strips or a button) is chosen after the
  // render from the room there is: see handFit.ts.
  return h('div', { class: `tg-hand${fan ? ' fan' : ' grid'}`, attrs: { role: 'list', 'aria-label': 'Your hand' } }, hand.map((c) => {
    const cnt = c.count ?? 1;
    // The list item carries the role; the card inside stays a button.
    return h('div', { class: 'tg-li', attrs: { role: 'listitem' } }, h('button', {
      class: `tg-handcard${c.enabled ? ' playable' : ''}`,
      title: c.enabled ? `${c.label}: tap to read and play` : `${c.label}: ${c.reason ?? ''}`,
      attrs: { 'data-card': c.card, 'data-act': `card:${c.card}`, 'aria-label': `${c.label}. ${c.text}${c.enabled ? '' : ` ${c.reason ?? ''}`}` },
      onclick: () => { ctx.ui.card = c.card; ctx.redraw(); },
    }, cardFace(c.card, { count: cnt, off: !c.enabled })));
  }));
}

/** Desktop, narrow touch screens: the whole hand in a panel above your area. */
export function handPopover(ctx: Ctx): HTMLElement | null {
  if (!ctx.ui.handOpen || ctx.me === null || ctx.phone) return null;
  return h('div', { class: 'tg-handpop tray', attrs: { role: 'dialog', 'aria-label': 'Your hand' } },
    h('div', { class: 'hd' }, h('b', { text: handTitle(ctx) }),
      h('button', { class: 'x round small', title: 'Close', attrs: { 'aria-label': 'Close' }, onclick: () => { ctx.ui.handOpen = false; ctx.redraw(); } }, icon('cross'))),
    handCards(ctx, false));
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
      piButton(ctx),
      ctx.view.myTurn ? h('div', { class: 'tg-kv2' }, h('span', { text: 'Leverage cards played' }), h('span', { class: 'v num', text: `${g.cardsPlayedThisTurn} / ${MAX_CARDS_PLAYED_PER_TURN}` })) : null),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec' }, h('span', { class: 'label', text: 'Control Modules' }), moduleTray(ctx.view.tray, color, id => ctx.play.choose(id), 'desk', ctx.view.instruction)),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec comps' }, components(ctx, 'tg-comp')),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec mats' }, h('div', { class: 'tg-mats' }, materialWells(ctx)), totalValue(ctx.view.totalValue ?? 0)),
    h('div', { class: 'vr' }),
    h('div', { class: 'tg-sec handsec' }, h('span', { class: 'label', text: `Hand · ${p.hand.length}` }), handCards(ctx, true),
      // Shown when the cards do not fit here even as title strips (handFit.ts).
      p.hand.length > 0 ? h('button', {
        class: `btn btn-dark tg-handopen${ctx.ui.handOpen ? ' on' : ''}`, attrs: { 'aria-expanded': String(ctx.ui.handOpen), 'data-handopen': '1' },
        onclick: () => { ctx.ui.handOpen = !ctx.ui.handOpen; ctx.redraw(); },
      }, icon('card'), h('span', { text: `Show all ${p.hand.length}` })) : null),
    h('div', { class: 'tg-act' }, autoplayNote(ctx), undoBeltsButton(ctx),
      // Where the fanned hand does not fit (narrow touch screens) this button opens the whole hand.
      h('button', {
        class: `btn btn-dark tg-handbtn${ctx.ui.handOpen ? ' on' : ''}`, attrs: { 'aria-expanded': String(ctx.ui.handOpen), 'data-handbtn': '1' },
        onclick: () => { ctx.ui.handOpen = !ctx.ui.handOpen; ctx.redraw(); },
      }, icon('card'), `Hand · ${p.hand.length}`),
      primaryButton(ctx)));
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
  const worth = ctx.view.totalValue ?? 0;
  return h('div', { class: 'tg-strip well', attrs: { 'aria-label': 'Your materials' } },
    MATERIAL_LIST.map(m => count(MATERIAL_ICON[m], p.inventory[m], MATERIAL_NAME[m], undefined, p.inventory[m] === 0 ? 'zero' : '')),
    // The total value, short: "= 11" right after the four materials (the Tray tab spells it out).
    h('span', { class: 'tg-count tg-striptotal', title: W.totalValue(worth), attrs: { 'aria-label': W.totalValue(worth) } }, h('span', { class: 'num', text: `= ${worth}` })),
    h('span', { class: 'sep' }),
    count('power', p.powerTokens, 'Power Tokens'),
    count('card', p.hand.length, 'Leverage cards'),
    count('belt', p.beltsRemaining, 'Belts', color));
}

/**
 * Phone, collapsed sheet, my actions step: the two ways in that otherwise hide in the pulled-up
 * sheet, one tap away: "Lay a belt" (the bank's own item, greyed with its reason when it cannot be
 * used) and "Tray & bank", which pulls the sheet up on the Tray tab.
 */
function quickRow(ctx: Ctx): HTMLElement | null {
  const v = ctx.view;
  if (ctx.me === null || ctx.landscape || !v.myTurn || v.step !== 'actions' || v.selection || v.choices || v.menu) return null;
  const p = ctx.game.players[ctx.me];
  const it = v.bank.find(b => b.id === 'bank:placeBelt');
  if (!p || !it) return null;
  const color = seatColor(ctx.room, ctx.me);
  return h('div', { class: 'tg-quick' },
    h('button', {
      class: `btn btn-dark tg-quickbelt${it.enabled ? ' lit' : ' off'}`,
      title: it.enabled ? `${it.label}: tap, then tap a glowing connection point` : it.reason ?? it.label,
      attrs: { 'aria-disabled': String(!it.enabled), 'data-item': 'bank:placeBelt', 'aria-label': `Lay a belt. Belts: ${p.beltsRemaining}.${it.enabled ? '' : ` ${it.reason ?? ''}`}` },
      onclick: () => ctx.play.choose('bank:placeBelt'),
    }, icon('belt', color), h('span', { text: 'Lay a belt' }), h('span', { class: 'num', text: String(p.beltsRemaining) })),
    h('button', {
      class: 'btn btn-dark tg-quicktray', attrs: { 'aria-label': 'Open your tray and the bank', 'data-quicktray': '1' },
      onclick: () => { ctx.ui.sheetOpen = true; ctx.ui.sheetTab = 'tray'; ctx.ui.menuOpen = false; ctx.ui.seat = null; ctx.redraw(); },
    }, h('span', { text: 'Tray & bank' }), icon('chevron', undefined, 'ic chev up')));
}

const TABS: { id: SheetTab; label: string }[] = [
  { id: 'tray', label: 'Tray' }, { id: 'cards', label: 'Cards' }, { id: 'log', label: 'Log' }, { id: 'rules', label: 'Rules' },
];

function tabContent(ctx: Ctx): Child {
  const g = ctx.game;
  switch (ctx.ui.sheetTab) {
    case 'tray': {
      if (ctx.me === null) return h('p', { class: 'muted', text: 'You are watching this game.' });
      const color = seatColor(ctx.room, ctx.me);
      return h('div', { class: 'tg-traytab' },
        h('div', { class: 'tg-trayrow' },
          h('div', null, sectionHead('Control Modules'), moduleTray(ctx.view.tray, color, id => ctx.play.choose(id), 'phone', ctx.view.instruction)),
          h('div', { class: 'side' }, sectionHead('Components'), components(ctx, 'tg-comp'),
            h('div', { class: 'tg-mats' }, materialWells(ctx, 'tg-mat small')), totalValue(ctx.view.totalValue ?? 0))),
        // The bank right under your components (it is what the actions step uses), before the
        // read-only lines, so it is in view without scrolling on most phones.
        g.gameOver ? null : h('div', null, sectionHead('Bank', h('span', { class: 'muted', text: 'prices in material value' })), bankRows(ctx)),
        h('div', { class: 'tg-kvs' },
          h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Tesseracts' }), h('span', { class: 'v' }, pips(tesseractCount(g, ctx.me as PlayerId)))),
          h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Meeple' }), h('span', { class: 'v', text: meepleWords(ctx) })),
          h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Upgrades' }), h('span', { class: 'v', text: upgrades(ctx) })),
          piButton(ctx),
          ctx.view.myTurn ? h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: 'Leverage cards played this turn' }), h('span', { class: 'v', text: `${g.cardsPlayedThisTurn} / ${MAX_CARDS_PLAYED_PER_TURN}` })) : null),
        bonusChips(ctx));
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
  const toggle = (): void => {
    ctx.ui.sheetOpen = !ctx.ui.sheetOpen;
    if (!ctx.ui.sheetOpen) ctx.ui.sheetUserClosed = true;
    else { ctx.ui.menuOpen = false; ctx.ui.seat = null; } // one large panel at a time
    ctx.redraw();
  };
  const cards = ctx.view.hand.length;
  const grab = ctx.landscape ? null : h('button', {
    class: 'tg-grab', title: open ? 'Pull down' : 'Pull up for your tray, cards, log and rules',
    attrs: { 'aria-expanded': String(open), 'aria-label': open ? 'Close your tray' : 'Open your tray, cards, log and rules', 'data-grab': '1' },
    onclick: toggle,
  }, h('span', { class: 'bar' }));
  // Pulled up, the sheet covers part of the table; one tap on its handle (or on the table) puts it away.
  return h('div', { class: `tg-sheet tray${open ? ' open' : ''}`, attrs: { 'aria-label': 'Your area', ...(open && !ctx.landscape ? { 'data-dismiss': 'handle' } : {}) } },
    grab,
    storageStrip(ctx),
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
      : [stepLine(ctx), ctx.me !== null ? strip(ctx) : null, quickRow(ctx)],
    ctx.me !== null ? h('div', { class: 'tg-sheetact' }, autoplayNote(ctx), undoBeltsButton(ctx), primaryButton(ctx)) : null);
}
