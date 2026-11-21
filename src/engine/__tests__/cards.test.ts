import { describe, it, expect } from 'vitest';
import { applyAction } from '../reducer';
import type { GameState, Player, BoardPiece, Buffer } from '../state';
import type { CardType, Material } from '../config';
import { INVENTORY_CAP } from '../config';
import { reachActionsPhase, freeAdjacentCoord } from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Patch an arbitrary subset of GameState fields.
function patch(state: GameState, overrides: Partial<GameState>): GameState {
  return { ...state, ...overrides };
}

// Patch one player's fields.
function patchPlayer(state: GameState, id: number, overrides: Partial<Player>): GameState {
  return patch(state, {
    players: state.players.map((p, i) => (i === id ? { ...p, ...overrides } : p)),
  });
}

// Produce a state in actions phase with 5 ore in the active player's inventory.
// Completes the S7 interactive setup first.
function actionsState(): GameState {
  const s = reachActionsPhase(42, 2);
  const activePid = s.turnOrder[s.activePlayerIndex]!;
  return patchPlayer(s, activePid, {
    inventory: { ore: 5, plate: 0, sphere: 0, tesseract: 0 },
    powerTokens: 6,
  });
}

// Give the active player (index 0 in players array by convention) a specific card in hand.
function giveCard(state: GameState, card: CardType): GameState {
  const pid = state.turnOrder[state.activePlayerIndex]!;
  return patchPlayer(state, pid, {
    hand: [...state.players[pid]!.hand, card],
  });
}

// Put a specific card at the top of the deck.
function topDeck(state: GameState, card: CardType): GameState {
  return patch(state, { cardDeck: [card, ...state.cardDeck] });
}

// Add a board piece.
function addBoardPiece(state: GameState, piece: BoardPiece): GameState {
  return patch(state, { board: [...state.board, piece] });
}

function makeBuffer(slots: (Material | null)[]): Buffer {
  return { slots, teleporterOwner: null };
}

function plateFact(id: string, coord: { q: number; r: number }, overrides: Partial<BoardPiece> = {}): BoardPiece {
  return {
    id,
    type: 'plateFact',
    coord,
    rotation: 0,
    claims: [],
    input: makeBuffer([null]),
    output: makeBuffer([null]),
    ...overrides,
  };
}

// ── BUY_CARD ──────────────────────────────────────────────────────────────────

describe('BUY_CARD', () => {
  it('adds non-play-on-draw card to hand and deducts cost', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = topDeck(s, 'embezzlement');
    // mineCount = 1 → cost = 2. Give player exactly 2 ore.
    s = patchPlayer(s, pid, { inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } });

    const r = applyAction(s, { type: 'BUY_CARD' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.players[pid]!.hand).toContain('embezzlement');
    expect(ns.players[pid]!.inventory.ore).toBe(0);
    expect(ns.cardDeck[0]).not.toBe('embezzlement');
  });

  it('rejects when cannot afford', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = topDeck(s, 'embezzlement');
    s = patchPlayer(s, pid, { inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 } });

    const r = applyAction(s, { type: 'BUY_CARD' });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('CANNOT_AFFORD');
  });

  it('rejects when deck is empty', () => {
    let s = actionsState();
    s = patch(s, { cardDeck: [] });

    const r = applyAction(s, { type: 'BUY_CARD' });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('DECK_EMPTY');
  });
});

// ── mineInspection (play-on-draw) ─────────────────────────────────────────────

describe('mineInspection', () => {
  it('resolves immediately: active player gains 1 plate per mine', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = topDeck(s, 'mineInspection');
    s = patchPlayer(s, pid, { inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 }, powerTokens: 5 });
    // cost = mineCount+1 = 2; give 2 ore
    s = patchPlayer(s, pid, { inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } });

    const r = applyAction(s, { type: 'BUY_CARD' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    // Card should NOT be in hand (play-on-draw)
    expect(ns.players[pid]!.hand).not.toContain('mineInspection');
    // Should be in discard
    expect(ns.cardDiscard).toContain('mineInspection');
    // mineCount = 1 → +1 plate. Paid 2 ore for card.
    expect(ns.players[pid]!.inventory.plate).toBe(1);
    expect(ns.players[pid]!.inventory.ore).toBe(0);
  });
});

// ── solarFlare (play-on-draw) ─────────────────────────────────────────────────

describe('solarFlare', () => {
  it('resolves immediately: all players gain 2 power tokens', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = topDeck(s, 'solarFlare');
    s = patchPlayer(s, pid, { inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 }, powerTokens: 1 });
    // Set both players to 1 power token
    const otherPid = s.turnOrder.find(id => id !== pid)!;
    s = patchPlayer(s, otherPid, { powerTokens: 1 });

    const r = applyAction(s, { type: 'BUY_CARD' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.players[pid]!.powerTokens).toBe(3);
    expect(ns.players[otherPid]!.powerTokens).toBe(3);
    expect(ns.cardDiscard).toContain('solarFlare');
  });
});

// ── overstockSupplies (play-on-draw) ─────────────────────────────────────────

describe('overstockSupplies', () => {
  it('draws 3 pieces into overstockPieces', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = topDeck(s, 'overstockSupplies');
    s = patchPlayer(s, pid, { inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } });

    const r = applyAction(s, { type: 'BUY_CARD' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.overstockPieces.length).toBe(3);
    expect(ns.cardDiscard).toContain('overstockSupplies');
  });

  it('END_ACTIONS blocked while overstock pieces remain', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = topDeck(s, 'overstockSupplies');
    s = patchPlayer(s, pid, { inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } });

    const buyR = applyAction(s, { type: 'BUY_CARD' });
    expect(buyR.ok).toBe(true);
    const ns = (buyR as { ok: true; state: GameState }).state;

    const endR = applyAction(ns, { type: 'END_ACTIONS' });
    expect(endR.ok).toBe(false);
    expect((endR as { ok: false; error: { code: string } }).error.code).toBe('OVERSTOCK_PENDING');
  });
});

// ── 2-card-per-turn limit ─────────────────────────────────────────────────────

describe('card play limit', () => {
  it('allows playing 2 cards; rejects a 3rd', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = patchPlayer(s, pid, {
      hand: ['embezzlement', 'embezzlement', 'embezzlement'] as CardType[],
      inventory: { ore: 5, plate: 5, sphere: 5, tesseract: 0 },
    });

    const r1 = applyAction(s, { type: 'PLAY_CARD', cardType: 'embezzlement' });
    expect(r1.ok).toBe(true);
    const s1 = (r1 as { ok: true; state: GameState }).state;

    const r2 = applyAction(s1, { type: 'PLAY_CARD', cardType: 'embezzlement' });
    expect(r2.ok).toBe(true);
    const s2 = (r2 as { ok: true; state: GameState }).state;

    const r3 = applyAction(s2, { type: 'PLAY_CARD', cardType: 'embezzlement' });
    expect(r3.ok).toBe(false);
    expect((r3 as { ok: false; error: { code: string } }).error.code).toBe('CARD_LIMIT_REACHED');
  });

  it('rejects playing a play-on-draw card from hand', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = patchPlayer(s, pid, { hand: ['overstockSupplies'] as CardType[] });

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'overstockSupplies' });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('PLAY_ON_DRAW');
  });
});

// ── embezzlement ──────────────────────────────────────────────────────────────

describe('embezzlement', () => {
  it('grants +1 sphere to active player', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'embezzlement');
    const prevSpheres = s.players[pid]!.inventory.sphere;

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'embezzlement' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.players[pid]!.inventory.sphere).toBe(prevSpheres + 1);
    expect(ns.players[pid]!.hand).not.toContain('embezzlement');
    expect(ns.cardsPlayedThisTurn).toBe(1);
  });
});

// ── scoutingDrone ─────────────────────────────────────────────────────────────

describe('scoutingDrone', () => {
  it('picks a piece from a stack and places it on the board', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'scoutingDrone');

    // Stack 0 is available and has pieces; place the piece from index 0.
    const preBoardLen = s.board.length;
    const r = applyAction(s, {
      type: 'PLAY_CARD',
      cardType: 'scoutingDrone',
      stackIndex: 0,
      pieceIndex: 0,
      coord: freeAdjacentCoord(s),
      rotation: 0,
    });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.board.length).toBe(preBoardLen + 1);
  });

  it('rejects picking from a locked stack', () => {
    let s = actionsState();
    s = giveCard(s, 'scoutingDrone');

    const r = applyAction(s, {
      type: 'PLAY_CARD',
      cardType: 'scoutingDrone',
      stackIndex: 1, // locked until mine 2
      pieceIndex: 0,
      coord: { q: -1, r: 0 },
    });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('STACK_LOCKED');
  });
});

// ── shortSale ─────────────────────────────────────────────────────────────────

describe('shortSale', () => {
  it('claims a building with lowest valid module for free', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'shortSale');

    // Add an unclaimed plateFact adjacent to mine-1 at (0,0)
    const unclaimed = plateFact('pf-1', { q: 1, r: 0 });
    s = addBoardPiece(s, unclaimed);

    const preModules = [...s.players[pid]!.controlModules];
    const r = applyAction(s, {
      type: 'PLAY_CARD',
      cardType: 'shortSale',
      pieceId: 'pf-1',
    });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    const claimed = ns.board.find(p => p.id === 'pf-1')!;
    expect(claimed.claims.some(c => c.ownerId === pid)).toBe(true);
    // Player spent no resources (shortSale is free)
    expect(ns.players[pid]!.inventory).toEqual(s.players[pid]!.inventory);
    // One module should be consumed
    expect(ns.players[pid]!.controlModules.length).toBe(preModules.length - 1);
  });
});

// ── sinkHole ──────────────────────────────────────────────────────────────────

describe('sinkHole', () => {
  it('removes an unclaimed board piece and returns its belts', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'sinkHole');

    // Add an unclaimed blank piece
    const blank: BoardPiece = {
      id: 'blank-1', type: 'blank', coord: { q: -1, r: 0 }, rotation: 0,
      claims: [], input: null, output: null,
    };
    s = addBoardPiece(s, blank);
    // Add a fake belt on it owned by player
    s = patch(s, {
      belts: [{ id: 'belt-1', ownerId: pid, pieceId: 'blank-1', fromPoint: 0, toPoint: 6 }],
    });
    const prevBeltsRemaining = s.players[pid]!.beltsRemaining;

    const r = applyAction(s, {
      type: 'PLAY_CARD',
      cardType: 'sinkHole',
      pieceId: 'blank-1',
    });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.board.find(p => p.id === 'blank-1')).toBeUndefined();
    expect(ns.belts.find(b => b.id === 'belt-1')).toBeUndefined();
    // Belt returned to player
    expect(ns.players[pid]!.beltsRemaining).toBe(prevBeltsRemaining + 1);
  });

  it('rejects sinking a claimed piece', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'sinkHole');

    const claimed = plateFact('pf-claimed', { q: 1, r: 0 }, {
      claims: [{ ownerId: pid, controlModule: 3 }],
    });
    s = addBoardPiece(s, claimed);

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'sinkHole', pieceId: 'pf-claimed' });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('PIECE_CLAIMED');
  });
});

// ── netSurplusSellOff ─────────────────────────────────────────────────────────

describe('netSurplusSellOff', () => {
  it('collects power tokens from clockwise players (up to 3 each)', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    const otherPid = s.turnOrder.find(id => id !== pid)!;
    s = giveCard(s, 'netSurplusSellOff');
    s = patchPlayer(s, pid, { powerTokens: 0 });
    s = patchPlayer(s, otherPid, { powerTokens: 5 });

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'netSurplusSellOff' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    // Active player gains 3 tokens
    expect(ns.players[pid]!.powerTokens).toBe(3);
    // Other player loses 3
    expect(ns.players[otherPid]!.powerTokens).toBe(2);
  });
});

// ── changingPriorities ────────────────────────────────────────────────────────

describe('changingPriorities', () => {
  it('moves a control module from one building to another', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'changingPriorities');

    // Add two claimed factories
    const pf1 = plateFact('pf-a', { q: 1, r: 0 }, {
      claims: [{ ownerId: pid, controlModule: 5 }],
    });
    const pf2 = plateFact('pf-b', { q: -1, r: 0 }, {
      claims: [],
    });
    s = addBoardPiece(s, pf1);
    s = addBoardPiece(s, pf2);

    const r = applyAction(s, {
      type: 'PLAY_CARD',
      cardType: 'changingPriorities',
      pieceId: 'pf-a',
      toPieceId: 'pf-b',
      controlModule: 5,
    });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.board.find(p => p.id === 'pf-a')!.claims.length).toBe(0);
    expect(ns.board.find(p => p.id === 'pf-b')!.claims[0]?.controlModule).toBe(5);
  });
});

// ── productionIncrease ────────────────────────────────────────────────────────

describe('productionIncrease', () => {
  it('grants a 4-unit upgrade budget', () => {
    let s = actionsState();
    s = giveCard(s, 'productionIncrease');

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'productionIncrease' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.productionIncreaseBudget).toBe(4);
    expect(ns.productionIncreaseClaimedThisTurn).toBe(false);
  });
});

// ── personalJetPack ───────────────────────────────────────────────────────────

describe('personalJetPack', () => {
  it('collects output buffer materials into inventory regardless of meeple', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'personalJetPack');

    // Add an owned factory with a plate in output buffer
    const pf = plateFact('pf-jet', { q: 1, r: 0 }, {
      claims: [{ ownerId: pid, controlModule: 3 }],
      output: makeBuffer(['plate']),
    });
    s = addBoardPiece(s, pf);
    s = patchPlayer(s, pid, { inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 } });

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'personalJetPack' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.players[pid]!.inventory.plate).toBe(1);
    // Output buffer cleared
    const pf2 = ns.board.find(p => p.id === 'pf-jet')!;
    expect(pf2.output!.slots[0]).toBeNull();
  });

  it('does not exceed INVENTORY_CAP', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'personalJetPack');

    const pf = plateFact('pf-cap', { q: 1, r: 0 }, {
      claims: [{ ownerId: pid, controlModule: 3 }],
      output: makeBuffer(['plate']),
    });
    s = addBoardPiece(s, pf);
    // Inventory already capped
    s = patchPlayer(s, pid, { inventory: { ore: 0, plate: INVENTORY_CAP, sphere: 0, tesseract: 0 } });

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'personalJetPack' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    expect(ns.players[pid]!.inventory.plate).toBe(INVENTORY_CAP);
    // Material stays in buffer (cap overflow)
    expect(ns.board.find(p => p.id === 'pf-cap')!.output!.slots[0]).toBe('plate');
  });
});

// ── assetForfeiture ───────────────────────────────────────────────────────────

describe('assetForfeiture', () => {
  it('sweeps all plates from all output buffers to active player', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    const otherPid = s.turnOrder.find(id => id !== pid)!;
    s = giveCard(s, 'assetForfeiture');

    // Two plate factories on board with plates in output
    const pf1 = plateFact('pf-af1', { q: 1, r: 0 }, {
      claims: [{ ownerId: pid, controlModule: 3 }],
      output: makeBuffer(['plate']),
    });
    const pf2 = plateFact('pf-af2', { q: -1, r: 0 }, {
      claims: [{ ownerId: otherPid, controlModule: 4 }],
      output: makeBuffer(['plate']),
    });
    s = addBoardPiece(s, pf1);
    s = addBoardPiece(s, pf2);
    s = patchPlayer(s, pid, { inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 } });

    const r = applyAction(s, { type: 'PLAY_CARD', cardType: 'assetForfeiture' });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    // Active player gained 2 plates
    expect(ns.players[pid]!.inventory.plate).toBe(2);
    // Both output buffers cleared
    expect(ns.board.find(p => p.id === 'pf-af1')!.output!.slots[0]).toBeNull();
    expect(ns.board.find(p => p.id === 'pf-af2')!.output!.slots[0]).toBeNull();
  });
});

// ── rdTaxWriteOff ─────────────────────────────────────────────────────────────

describe('rdTaxWriteOff', () => {
  it('places a free teleporter on an owned building', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = giveCard(s, 'rdTaxWriteOff');

    const pf = plateFact('pf-rd', { q: 1, r: 0 }, {
      claims: [{ ownerId: pid, controlModule: 3 }],
    });
    s = addBoardPiece(s, pf);
    const prevTeleporters = s.players[pid]!.teleportersRemaining;

    const r = applyAction(s, {
      type: 'PLAY_CARD',
      cardType: 'rdTaxWriteOff',
      pieceId: 'pf-rd',
      bufferType: 'output',
    });
    expect(r.ok).toBe(true);
    const ns = (r as { ok: true; state: GameState }).state;
    const piece = ns.board.find(p => p.id === 'pf-rd')!;
    expect(piece.output!.teleporterOwner).toBe(pid);
    expect(ns.players[pid]!.teleportersRemaining).toBe(prevTeleporters - 1);
    expect(ns.globalTeleporterCount).toBe(s.globalTeleporterCount + 1);
  });

  it('rejects placing on a building you do not own', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    const otherPid = s.turnOrder.find(id => id !== pid)!;
    s = giveCard(s, 'rdTaxWriteOff');

    const pf = plateFact('pf-rd-other', { q: 1, r: 0 }, {
      claims: [{ ownerId: otherPid, controlModule: 3 }],
    });
    s = addBoardPiece(s, pf);

    const r = applyAction(s, {
      type: 'PLAY_CARD',
      cardType: 'rdTaxWriteOff',
      pieceId: 'pf-rd-other',
      bufferType: 'output',
    });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('NOT_OWNER');
  });
});

// ── PLACE_OVERSTOCK_PIECE ─────────────────────────────────────────────────────

describe('PLACE_OVERSTOCK_PIECE', () => {
  it('places one overstock piece on the board', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = topDeck(s, 'overstockSupplies');
    s = patchPlayer(s, pid, { inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } });

    // Buy the card (play-on-draw → draws 3 pieces)
    const buyR = applyAction(s, { type: 'BUY_CARD' });
    expect(buyR.ok).toBe(true);
    let ns = (buyR as { ok: true; state: GameState }).state;
    expect(ns.overstockPieces.length).toBe(3);

    const preBoardLen = ns.board.length;
    const placeR = applyAction(ns, {
      type: 'PLACE_OVERSTOCK_PIECE',
      coord: freeAdjacentCoord(ns),
      rotation: 0,
    });
    expect(placeR.ok).toBe(true);
    ns = (placeR as { ok: true; state: GameState }).state;
    expect(ns.board.length).toBe(preBoardLen + 1);
    expect(ns.overstockPieces.length).toBe(2);
  });
});
