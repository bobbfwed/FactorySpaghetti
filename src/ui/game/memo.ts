// Panels that are costly to build and rarely change (the 60-line log, the rules sheet, the bonus
// sheet) are built once per key and handed out as copies. The copy carries `data-keep="<key>"`,
// and morph leaves an element alone when its data-keep matches, so a redraw with unchanged
// inputs touches nothing. The content holds no event handlers (copies would not keep them).

import type { Ctx } from './context';
import { bonusSheet, logList, rulesSheet } from './rules';

const cache = new Map<string, { key: string; el: HTMLElement }>();

/** A copy of what `build` made for `key` (built again only when the key changes). */
export function cached(name: string, key: string, build: () => HTMLElement): HTMLElement {
  let c = cache.get(name);
  if (!c || c.key !== key) {
    c = { key, el: build() };
    cache.set(name, c);
  }
  const copy = c.el.cloneNode(true) as HTMLElement;
  copy.setAttribute('data-keep', `${name}:${key}`);
  return copy;
}

const seatsKey = (ctx: Ctx): string => ctx.room.seats.map(s => `${s.name}/${s.color}`).join(',');

export function cachedLog(ctx: Ctx): HTMLElement {
  const log = ctx.room.log;
  const last = log[log.length - 1];
  return cached('log', `${log.length}:${last?.seq ?? -1}:${last?.text ?? ''}:${seatsKey(ctx)}`, () => logList(ctx));
}

export function cachedRules(ctx: Ctx): HTMLElement {
  const g = ctx.game;
  const out = g.board.find(p => p.output && p.type !== 'mine')?.output?.slots.length ?? -1;
  return cached('rules', `${g.mineCount}:${g.globalTeleporterCount}:${out}`, () => rulesSheet(ctx));
}

export function cachedBonuses(ctx: Ctx): HTMLElement {
  const holders = ctx.game.players.map(p => Object.values(p.bonusTesseracts).map(Number).join('')).join('|');
  return cached('bonuses', `${holders}:${ctx.me}:${seatsKey(ctx)}`, () => bonusSheet(ctx));
}
