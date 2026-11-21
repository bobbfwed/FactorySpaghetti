import type { CardType } from '../../engine/config';

export interface CardInfo {
  title: string;
  description: string;
  playOnDraw?: true;
}

export const CARD_INFO: Record<CardType, CardInfo> = {
  scoutingDrone: {
    title: 'Scouting Drone',
    description: 'Peek at up to 5 pieces in any stack, draw one, and place it immediately.',
  },
  shortSale: {
    title: 'Short Sale',
    description: 'Claim any building for free using one of your Control Modules (≥ mine count). No ore payment.',
  },
  embezzlement: {
    title: 'Embezzlement',
    description: 'Take all ore from any single buffer slot on the board into your inventory.',
  },
  sinkHole: {
    title: 'Sink Hole',
    description: 'Permanently remove an unclaimed, empty board piece.',
  },
  overstockSupplies: {
    title: 'Overstock Supplies',
    description: 'Draw 3 pieces from stack 1 and place each immediately.',
    playOnDraw: true,
  },
  netSurplusSellOff: {
    title: 'Net Surplus Sell-Off',
    description: 'Convert all your ore into power tokens at 1:1.',
  },
  changingPriorities: {
    title: 'Changing Priorities',
    description: 'Move one of your in-play Control Modules from one building to another.',
  },
  productionIncrease: {
    title: 'Production Increase',
    description: 'Gain 4 bonus Claim / Upgrade actions this turn (at most 1 of them may be a Claim).',
  },
  mineInspection: {
    title: 'Mine Inspection',
    description: 'Collect ore from every mine ore-output point not blocked by a belt or occupied buffer.',
    playOnDraw: true,
  },
  personalJetPack: {
    title: 'Personal Jet Pack',
    description: 'Place your meeple on any building this turn, ignoring normal proximity rules.',
  },
  assetForfeiture: {
    title: 'Asset Forfeiture',
    description: "Remove all belt tokens owned by one chosen opponent.",
  },
  rdTaxWriteOff: {
    title: 'R&D Tax Write-Off',
    description: 'Place a teleporter on one of your owned building buffers for free (no ore cost).',
  },
  solarFlare: {
    title: 'Solar Flare',
    description: 'Discard all materials from every buffer on the board.',
    playOnDraw: true,
  },
};
