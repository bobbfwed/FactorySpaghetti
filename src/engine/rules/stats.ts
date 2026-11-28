// Per-player stat rows for the live all-player readout and the end-of-game stats screen.
// Pure & derived from state (plus the three cumulative counters on Player.stats). Kept in
// the engine so the client just renders — no game logic in the UI.

import type { GameState, PlayerId, Material } from '../state';
import { CONTROL_MODULE_MAX, bonusesEnabled } from '../config';
import { tesseractCount, resourcePoints } from './scoring';
import { longestBeltChain } from './beltWeaver';

export interface PlayerStatsRow {
  readonly playerId: PlayerId;
  readonly tesseracts: number;          // real Tesseracts in inventory
  readonly bonusTesseracts: number;     // count of face-up bonus Tesseracts
  readonly totalTesseracts: number;     // toward the 4-Tesseract win (real + bonuses)
  readonly bonuses: { readonly investor: boolean; readonly beltWeaver: boolean; readonly factoryEmpire: boolean };
  readonly ore: number;
  readonly plate: number;
  readonly sphere: number;
  readonly resourcePoints: number;      // total inventory value (tiebreak metric)
  readonly beltsUsed: number;           // belts currently placed on the board
  readonly buildingsClaimed: number;    // distinct pieces this player has a claim on
  readonly modulesUsed: number;         // Control Modules placed (not in tray)
  readonly longestBelt: number;         // longest continuous belt chain (Belt Weaver metric)
  readonly cardsPurchased: number;
  readonly cardsPlayed: number;
  readonly modulesUpgraded: number;
}

export function playerStats(state: GameState): PlayerStatsRow[] {
  return state.players.map((p): PlayerStatsRow => {
    const id = p.id;
    const bonusCount = bonusesEnabled
      ? (p.bonusTesseracts.investor ? 1 : 0) + (p.bonusTesseracts.beltWeaver ? 1 : 0) + (p.bonusTesseracts.factoryEmpire ? 1 : 0)
      : 0;
    let beltsUsed = 0;
    for (const b of state.belts) if (b.ownerId === id) beltsUsed++;
    let buildingsClaimed = 0;
    for (const piece of state.board) {
      if (piece.type === 'mine' || piece.type === 'blank') continue;
      if (piece.claims.some(c => c.ownerId === id)) buildingsClaimed++;
    }
    const mat = (m: Material): number => p.inventory[m];
    return {
      playerId: id,
      tesseracts: p.inventory.tesseract,
      bonusTesseracts: bonusCount,
      totalTesseracts: tesseractCount(state, id),
      bonuses: { ...p.bonusTesseracts },
      ore: mat('ore'),
      plate: mat('plate'),
      sphere: mat('sphere'),
      resourcePoints: resourcePoints(p),
      beltsUsed,
      buildingsClaimed,
      modulesUsed: CONTROL_MODULE_MAX - p.controlModules.length,
      longestBelt: longestBeltChain(state, id),
      cardsPurchased: p.stats.cardsPurchased,
      cardsPlayed: p.stats.cardsPlayed,
      modulesUpgraded: p.stats.modulesUpgraded,
    };
  });
}
