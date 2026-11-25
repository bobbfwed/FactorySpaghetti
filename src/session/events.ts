// What a move caused on the table, worked out by comparing the state before and after.
// Ported from the prototype's roll narration (GameSession.computeRollEvents).

import type { Action } from '../engine/actions';
import type { GameState, PlayerId } from '../engine/state';
import type { Material } from '../engine/config';
import { PLAY_ON_DRAW_CARDS } from '../engine/config';
import { factoryOperatePowerCost } from '../engine/rules/production';
import { nextCardDrawn } from '../engine/rules/cards';
import type { TableEvent } from './room';

const MATS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

export function moveEvents(before: GameState, after: GameState, action: Action, seat: number): TableEvent[] {
  switch (action.type) {
    case 'ROLL_DICE':
      return rollEvents(before, after, action.rolls, seat);
    case 'PLACE_PIECE':
    case 'PLACE_OVERSTOCK_PIECE':
    case 'PLACE_MINE':
    case 'BUY_MINE':
    case 'PLAY_CARD': {
      const out: TableEvent[] = [];
      if (action.type === 'PLAY_CARD') out.push({ kind: 'cardPlayed', seat, card: action.cardType });
      const known = new Set(before.board.map(p => p.id));
      for (const p of after.board) {
        if (!known.has(p.id)) out.push({ kind: 'piecePlaced', seat, pieceId: p.id, building: p.type });
      }
      return out;
    }
    case 'DRAW_PIECE': {
      const top = before.stacks[action.stackIndex]?.pieces[0];
      return top ? [{ kind: 'pieceDrawn', seat, stack: action.stackIndex, pieceId: top.id, building: top.type }] : [];
    }
    case 'BUY_CARD': {
      const card = nextCardDrawn(before);
      return [{ kind: 'cardBought', seat, card, playedOnDraw: card !== null && PLAY_ON_DRAW_CARDS.has(card) }];
    }
    case 'OPERATE_BUILDING':
      return operateEvents(before, after, action.pieceId, (action.ownerId ?? seat) as PlayerId);
    case 'SKIP_FACTORY_ROLL': {
      const piece = before.board.find(p => p.id === action.pieceId);
      return piece ? [{ kind: 'skipped', seat, pieceId: piece.id, building: piece.type }] : [];
    }
    case 'COLLECT_OUTPUT': {
      const b = before.players[seat];
      const a = after.players[seat];
      if (!a || !b) return [];
      const materials: Material[] = [];
      for (const m of MATS) for (let i = b.inventory[m]; i < a.inventory[m]; i++) materials.push(m);
      return [{ kind: 'collected', seat, pieceId: action.pieceId, materials }];
    }
    default:
      return [];
  }
}

function operateEvents(before: GameState, after: GameState, pieceId: string, operator: PlayerId): TableEvent[] {
  const piece = before.board.find(p => p.id === pieceId);
  const b = before.players[operator];
  const a = after.players[operator];
  if (!piece || !a || !b) return [];
  let product: Material | null = null;
  let teleported = false;
  for (const m of MATS) {
    if (a.inventory[m] > b.inventory[m]) { product = m; teleported = true; }
  }
  if (!product) {
    const afterPiece = after.board.find(p => p.id === pieceId);
    const beforeSlots = piece.output?.slots ?? [];
    afterPiece?.output?.slots.forEach((s, i) => {
      if (s !== null && beforeSlots[i] === null) product = s;
    });
  }
  return [{
    kind: 'operated', seat: operator, pieceId, building: piece.type,
    product, powerChange: a.powerTokens - b.powerTokens, teleported,
  }];
}

function rollEvents(before: GameState, after: GameState, rolls: readonly number[], seat: number): TableEvent[] {
  const total = rolls.reduce((x, y) => x + y, 0);
  const out: TableEvent[] = [{ kind: 'roll', seat, dice: [...rolls], total }];

  for (const beforePiece of before.board) {
    const afterPiece = after.board.find(p => p.id === beforePiece.id);
    if (!afterPiece) continue;
    const owners = new Set<PlayerId>();
    for (const c of beforePiece.claims) if (c.controlModule === total) owners.add(c.ownerId);

    for (const owner of owners) {
      const base = { kind: 'activated' as const, seat: owner, pieceId: beforePiece.id, building: beforePiece.type };
      const awaiting = after.pendingFactoryOps.some(e => e.pieceId === beforePiece.id && e.ownerId === owner);
      if (beforePiece.type === 'powerPlant' && awaiting) {
        // A Power Plant with its owner's teleporter on an empty input: they choose what to supply.
        out.push({ ...base, outcome: 'awaiting-choice', amount: 0 });
        continue;
      }
      if (beforePiece.type === 'powerPlant') {
        const gained = (after.players[owner]?.powerTokens ?? 0) - (before.players[owner]?.powerTokens ?? 0);
        out.push(gained > 0
          ? { ...base, outcome: 'power', amount: gained }
          : { ...base, outcome: 'power-capped', amount: 0 });
        continue;
      }
      if (!beforePiece.output) continue;
      if (awaiting) {
        out.push({ ...base, outcome: 'awaiting-choice', amount: factoryOperatePowerCost(afterPiece) });
      } else if (beforePiece.output.slots.some(s => s !== null)) {
        out.push({ ...base, outcome: 'output-full', amount: 0 });
      } else if (!afterPiece.input || afterPiece.input.slots.some(s => s === null)) {
        out.push({ ...base, outcome: 'input-missing', amount: 0 });
      } else {
        out.push({ ...base, outcome: 'no-power', amount: factoryOperatePowerCost(afterPiece) });
      }
    }
  }
  return out;
}
