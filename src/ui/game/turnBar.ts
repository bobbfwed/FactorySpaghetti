// The turn bar (the rulebook's four steps with the current one lit), the primary button and the
// confirm bar (✓ confirm, ✕ cancel, ⟳ rotate) that floats beside the piece being placed.

import type { PlayView } from '../../play';
import type { Child } from '../dom';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { activePlayer, seatHex, seatName } from './context';
import { countdownText } from './pieces';
import { piecesExhausted } from '../../engine';
import { W } from '../../play/words';

/** Once no piece is left to draw, until the game ends: the round being played is the last. */
export function finalRoundNote(ctx: Ctx, cls = 'tg-final'): HTMLElement | null {
  if (ctx.game.gameOver || !piecesExhausted(ctx.game)) return null;
  return h('span', { class: cls, attrs: { role: 'note' } }, icon('flag', undefined, 'ic small'), h('span', { text: W.finalRound }));
}

const STEPS = ['Place a piece', 'Roll', 'Actions', 'Place meeple'] as const;

/** The state shown instead of the four steps outside a normal turn. */
function stateChip(ctx: Ctx): string | null {
  const v = ctx.view;
  if (ctx.game.gameOver) return 'Game over';
  if (ctx.game.phase === 'setupClaimPF' || ctx.game.phase === 'setupClaimPP') return 'Setup';
  if (ctx.game.phase === 'roundEnd') return 'End of round';
  if (v.stepIndex === null) return null;
  return null;
}

function whose(ctx: Ctx): HTMLElement | null {
  const g = ctx.game;
  if (g.gameOver) return null;
  const a = activePlayer(g);
  if (a === null) return null;
  const mine = a === ctx.me;
  return h('span', { class: `tg-whose${mine ? ' mine' : ''}`, style: `--seat:${seatHex(ctx.room, a)}` },
    h('span', { class: 'sw' }), mine ? 'Your turn' : `${seatName(ctx.room, a)}'s turn`);
}

function steps(ctx: Ctx, compact: boolean): HTMLElement {
  const chip = stateChip(ctx);
  const a = activePlayer(ctx.game);
  const other = a !== ctx.me && !ctx.game.gameOver;
  const color = seatHex(ctx.room, a);
  if (chip) {
    return h('div', { class: 'tg-steps' }, h('span', { class: `tg-step now${other ? ' other' : ''}`, style: `--seat:${color}` }, chip));
  }
  const idx = ctx.view.stepIndex ?? 0;
  // With the pieces gone, step 1 has nothing to place: the turn starts at the roll.
  const noPieces = piecesExhausted(ctx.game);
  return h('div', { class: 'tg-steps', attrs: { 'aria-label': `Step ${idx} of 4` } }, STEPS.map((label, i) => {
    const n = i + 1;
    const skipped = n === 1 && noPieces && idx !== 1;
    const cls = skipped ? ' skipped' : n < idx ? ' done' : n === idx ? ` now${other ? ' other' : ''}` : '';
    if (compact && n !== idx) return null;
    return h('span', {
      class: `tg-step${cls}`, style: `--seat:${color}`,
      attrs: n === idx ? { 'aria-current': 'step' } : skipped ? { title: `${label}: ${W.noPiecesLeft}` } : {},
    }, h('span', { class: 'n', text: String(n) }), skipped ? `${label} (${W.noPiecesLeft})` : label);
  }));
}

function roundEndClock(ctx: Ctx): Child {
  const d = ctx.room.roundEndDeadline;
  // The host ends an idle round-end turn by itself; any move restarts the clock.
  if (d === null || ctx.game.gameOver) return null;
  const mine = activePlayer(ctx.game) === ctx.me;
  return countdownText(ctx.ctrl, d, mine ? 'No move for ' : 'Ends by itself in ', 'tg-countdown', mine ? ' and it ends by itself' : '');
}

/** Desktop turn bar. */
export function turnBar(ctx: Ctx): HTMLElement {
  return h('div', { class: 'tray tg-turnbar', attrs: { role: 'status', 'aria-live': 'polite' } },
    whose(ctx),
    steps(ctx, false),
    finalRoundNote(ctx),
    h('span', { class: 'tg-instr', text: ctx.view.instruction, title: ctx.view.instruction }),
    roundEndClock(ctx),
    h('span', { class: 'tg-round' }, 'Round ', h('span', { class: 'num', text: String(ctx.game.round) })));
}

/** Phone: the step chip, progress dots and round number, then the instruction. */
export function stepLine(ctx: Ctx): Child[] {
  const idx = ctx.view.stepIndex ?? 0;
  const dots = stateChip(ctx) ? null : h('span', { class: 'tg-dots', attrs: { 'aria-hidden': 'true' } },
    [1, 2, 3, 4].map(n => h('i', { class: n === idx ? 'on' : n < idx ? 'done' : '' })));
  return [
    h('div', { class: 'tg-stepline' }, steps(ctx, true), dots,
      h('span', { class: 'tg-round' }, 'Round ', h('b', { text: String(ctx.game.round) }))),
    finalRoundNote(ctx, 'tg-final phone'),
    h('div', { class: 'tg-instr2', attrs: { role: 'status', 'aria-live': 'polite' } },
      whose(ctx), h('span', { text: ctx.view.instruction }), roundEndClock(ctx)),
  ];
}

/** What the big button confirms while a choice waits for confirmation. */
export function confirmLabel(v: PlayView): string {
  if (v.confirmBar?.label) return v.confirmBar.label;
  if (v.ghost) return 'Confirm placement';
  switch (v.selection?.kind) {
    case 'meeple': return 'Confirm meeple';
    case 'belt': return 'Confirm belt';
    case 'teleporter': return 'Confirm teleporter';
    case 'card': return `Play ${v.selection.label}`;
    case 'building': return v.step === 'setup' ? 'Confirm claim' : 'Confirm';
    default: return 'Confirm';
  }
}

/**
 * The big button. One rule for the whole game: while a choice waits for confirmation (a
 * placement, the meeple, a belt, a card's targets) the big button is that confirmation, named
 * for what it confirms; the floating ✓ is a second way. Otherwise it is the step's next action;
 * when that cannot be pressed yet, the button says why. Off turn it says whom the game waits for.
 */
export function primaryButton(ctx: Ctx, cls = ''): HTMLElement | null {
  const v = ctx.view;
  const p = v.primary;
  if (v.confirmBar?.confirm && !v.menu && !v.choices) {
    const label = confirmLabel(v);
    return h('button', { class: `btn btn-gold btn-lg tg-primary ${cls}`, attrs: { 'data-primary': 'confirm', 'data-act': `confirm:${label}:${v.selection?.label ?? ''}`, 'data-strict': '1' }, onclick: () => ctx.play.confirm() },
      icon('check'), label);
  }
  if (p) {
    const why = !p.enabled && p.hint ? p.hint : null;
    return h('button', {
      class: `btn btn-gold btn-lg tg-primary${p.enabled ? '' : ' is-disabled'}${why ? ' has-why' : ''} ${cls}`,
      title: p.enabled ? p.label : p.hint ?? p.label,
      attrs: { 'aria-disabled': String(!p.enabled), 'data-primary': '1', 'data-act': `primary:${p.label}`, 'data-strict': '1' },
      onclick: () => ctx.play.primary(),
    }, h('span', { class: 'lbl', text: p.label }), why ? h('small', { class: 'why', text: why }) : null);
  }
  if (ctx.game.gameOver) return null;
  const a = activePlayer(ctx.game);
  const text = ctx.me === null ? 'Watching'
    : a !== ctx.me ? `Waiting for ${seatName(ctx.room, a)}` : v.selection ? v.selection.label : 'Your turn';
  return h('div', { class: `btn btn-lg tg-primary tg-wait ${cls}`, attrs: { 'aria-live': 'polite' } }, text);
}

/** "Take back this turn's belts" when it is possible. */
export function undoBeltsButton(ctx: Ctx): HTMLElement | null {
  const it = ctx.view.bank.find(b => b.id === 'bank:undoBelts');
  if (!it || !it.enabled) return null;
  return h('button', { class: 'btn btn-dark tg-undo', title: it.detail ?? it.label, attrs: { 'data-act': it.id }, onclick: () => ctx.play.choose(it.id) }, icon('undo'), 'Undo belts');
}

/** ✕ ⟳ ✓ beside the ghost (or the last touched piece); docked when there is nothing to point at. */
export function confirmBar(ctx: Ctx, anchor: string | null): HTMLElement | null {
  const v = ctx.view;
  const cb = v.confirmBar;
  if (!cb || v.menu || v.choices) return null;
  if (!cb.confirm && !cb.rotate && !cb.cancel) return null;
  const attrs: Record<string, string> = { role: 'toolbar', 'aria-label': 'Confirm or cancel' };
  if (anchor) { attrs['data-anchor'] = anchor; attrs['data-place'] = 'below'; }
  return h('div', { class: `tg-confirm${anchor ? ' anchored' : ' docked'}`, attrs },
    v.selection ? h('span', { class: 'tg-sel', text: v.selection.label }) : null,
    cb.cancel ? h('button', { class: 'round tg-cbtn', title: 'Cancel', attrs: { 'aria-label': 'Cancel', 'data-confirm': 'cancel' }, onclick: () => ctx.play.cancel() }, icon('cross')) : null,
    cb.rotate ? h('button', { class: 'round tg-cbtn', title: 'Turn it', attrs: { 'aria-label': 'Turn it', 'data-confirm': 'rotate' }, onclick: () => ctx.play.rotate(1) }, icon('rotate')) : null,
    cb.confirm ? h('button', { class: 'round tg-cbtn ok', title: 'Confirm', attrs: { 'aria-label': 'Confirm', 'data-confirm': 'ok', 'data-act': `confirm:${v.selection?.label ?? ''}`, 'data-strict': '1' }, onclick: () => ctx.play.confirm() }, icon('check')) : null);
}
