// The hand in the desktop bottom panel: worked out after each render from the room the hand
// section has, so a card never covers the "Hand · N" header, another section, or another card's
// name.
//
//   row     whole cards side by side, scaled to the height under the header, no overlap;
//   strips  each card as its title strip (the gold band with its name), in a grid;
//   button  the section shows a "Show all" button that opens the whole hand;
//   act     the section is too narrow even for that: the button sits in the action column.

/** The printed card at full size in the panel (game.css .tg-card). */
const CARD_W = 112, CARD_H = 156;
const GAP = 6;
/** A title strip: two lines of the name at 12 px. */
const STRIP_H = 40, STRIP_GAP = 4, STRIP_MIN_W = 104;
/** The smallest section that still takes the in-section button. */
const BUTTON_MIN_W = 104;

export type HandFit = 'row' | 'strips' | 'button' | 'act' | 'empty';

export interface HandFitResult {
  mode: HandFit;
  /** Card size in row mode, columns in strips mode. */
  cardW?: number; cardH?: number; scale?: number; cols?: number;
}

/** Pure: which layout fits `n` cards in a `w` × `h` area (h is the room under the header). */
export function chooseHandFit(n: number, w: number, h: number): HandFitResult {
  if (n === 0) return { mode: 'empty' };
  const ch = Math.min(CARD_H, Math.floor(h));
  const scale = ch / CARD_H;
  const cw = Math.floor(CARD_W * scale);
  if (ch >= 110 && n * cw + (n - 1) * GAP <= w) return { mode: 'row', cardW: cw, cardH: ch, scale };
  const rows = Math.max(1, Math.floor((h + STRIP_GAP) / (STRIP_H + STRIP_GAP)));
  const cols = Math.ceil(n / rows);
  const sw = (w - (cols - 1) * GAP) / cols;
  if (sw >= STRIP_MIN_W) return { mode: 'strips', cols };
  if (w >= BUTTON_MIN_W) return { mode: 'button' };
  return { mode: 'act' };
}

/** Apply the fitting layout to the bottom panel `yours` (no-op when there is no hand section). */
export function fitHand(yours: HTMLElement | null): HandFit | null {
  if (!yours) return null;
  const sec = yours.querySelector<HTMLElement>('.tg-sec.handsec');
  const hand = sec?.querySelector<HTMLElement>('.tg-hand');
  if (!sec || !hand) return null;
  if (sec.offsetParent === null) { yours.dataset.hand = 'act'; return 'act'; } // hidden by the layout (narrow touch screens)
  const label = sec.querySelector<HTMLElement>(':scope > .label');
  const cs = getComputedStyle(sec);
  const gap = parseFloat(cs.rowGap) || 6;
  const w = sec.clientWidth;
  const hAvail = sec.clientHeight - (label?.offsetHeight ?? 0) - gap;
  const n = hand.querySelectorAll(':scope > .tg-li').length;
  const fit = chooseHandFit(n, w, hAvail);
  yours.dataset.hand = fit.mode;
  hand.classList.remove('fan', 'row', 'strips');
  if (fit.mode === 'row') {
    hand.classList.add('row');
    hand.style.setProperty('--cw', `${fit.cardW}px`);
    hand.style.setProperty('--ch', `${fit.cardH}px`);
    hand.style.setProperty('--cs', String(fit.scale));
  } else if (fit.mode === 'strips') {
    hand.classList.add('strips');
    hand.style.setProperty('--cols', String(fit.cols));
  }
  return fit.mode;
}
