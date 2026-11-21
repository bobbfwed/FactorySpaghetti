// Every player-facing string the play controller produces, in rulebook words.
// Kept in one module so the wording can be reviewed (and later translated) in one place.
// Never put internal names here (phase names, action type names, piece or card ids).

import type { CardType, Material, PieceType } from '../engine/config';
import { MAX_CARDS_PLAYED_PER_TURN } from '../engine/config';
import { BUILDING_NAME, CARD_NAME, MATERIAL_NAME } from '../session/describe';

export { CARD_NAME, MATERIAL_NAME };

/** "Plate Factory", "Power Plant", "Mine", "blank tile". */
export function pieceName(type: PieceType): string {
  return BUILDING_NAME[type];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const units = (n: number): string => plural(n, 'upgrade', 'upgrades');
const tokens = (n: number): string => plural(n, 'Power Token', 'Power Tokens');

export function materialList(mats: readonly Material[]): string {
  return mats.length === 0 ? 'nothing' : mats.map(m => MATERIAL_NAME[m]).join(' + ');
}

// ── Card rules text (from RULES.md; matches what the engine does) ─────────────

export const CARD_TEXT: Record<CardType, string> = {
  scoutingDrone: 'Look through the stacks, choose a piece and place it on the board now.',
  shortSale: 'Claim a building with your lowest Control Module that is not below the number of mines.',
  embezzlement: 'Take 1 Sphere from the bank.',
  sinkHole: 'Remove an unclaimed board piece (not a Mine). Belts on it go back to their owners.',
  overstockSupplies: 'Draw 3 pieces and place them next to the board. Played as soon as it is drawn.',
  netSurplusSellOff: 'Each other player gives you 3 Power Tokens (or all they have), until you reach 10.',
  changingPriorities: 'Move one of your Control Modules from one building to another.',
  productionIncrease: 'Spend 4 upgrades this turn on claims and upgrades (at most one claim).',
  mineInspection: 'Take 1 Plate from the bank for each Mine in play. Played as soon as it is drawn.',
  personalJetPack: 'Collect the output of all your factories into your materials.',
  assetForfeiture: 'Take every Plate from every output buffer on the board (up to your limit).',
  rdTaxWriteOff: 'Place a teleporter on one of your buildings for free.',
  solarFlare: 'Every player gets 2 Power Tokens. Played as soon as it is drawn.',
};

// ── Steps and instructions ────────────────────────────────────────────────────

export const W = {
  // Inert / over
  spectating: 'You are watching this game.',
  noGame: 'No game in progress.',
  gameOverWinner: (name: string): string => `The game is over. ${name} wins.`,
  gameOverTie: (names: string): string => `The game is over. Shared win: ${names}.`,
  gameOverNone: 'The game is over.',

  // Waiting (someone else's turn)
  waitingSetup: (name: string): string => `${name} is choosing a starting building.`,
  waitingPlace: (name: string): string => `${name} is placing a board piece.`,
  waitingRoll: (name: string): string => `${name} is about to roll the dice.`,
  waitingActions: (name: string): string => `${name} is taking actions.`,
  waitingMeeple: (name: string): string => `${name} is placing their meeple.`,
  waitingRoundEnd: (name: string): string => `${name} is taking their round-end turn.`,

  // Setup
  setupPF: 'Choose your starting Plate Factory: tap a glowing one, then confirm.',
  setupPP: 'Choose your starting Power Plant: tap a glowing one, then confirm.',
  setupConfirm: (building: string, module: number): string => `Claim this ${building} with your Control Module ${module}?`,

  // Step 1
  placePickStack: 'Place a board piece: pick one of the glowing stacks.',
  placePickCell: (what: string): string => `Place the ${what}: tap a glowing space next to the board.`,
  placeTurnConfirm: (what: string): string => `Turn the ${what} if you like, then confirm.`,
  mineDropped: 'A Mine has dropped: tap a glowing space for it.',
  minePlaceConfirm: 'Turn the Mine if you like, then confirm.',

  // Step 2
  rollNow: 'Roll the dice.',
  rollLabel: (n: number): string => `Roll ${n} ${n === 1 ? 'die' : 'dice'}`,

  // Step 3
  actionsIdle: 'Take any actions you want, then press Done with actions.',
  actionsDone: 'Done with actions',
  overstockPlace: (i: number, n: number, what: string): string => `Overstock Supplies: place piece ${i} of ${n} (a ${what}) next to the board.`,
  pendingMine: 'Decide whether to run your activated factory.',
  pendingMineMany: (n: number): string => `Decide whether to run your ${n} activated factories.`,

  // Step 4
  meeplePlace: 'Place your meeple on one of your buildings or on a Mine point.',
  meepleConfirm: (where: string): string => `Place your meeple on the ${where}?`,
  meepleDone: 'Your meeple is placed. End your turn.',
  endTurn: 'End turn',
  noMeepleSpot: 'There is nowhere to place your meeple. End your turn.',

  // Round end
  roundEndIdle: 'Your round-end turn: use your meeple\'s building, claim or upgrade, then finish.',
  roundEndDone: 'Finish round-end turn',

  // Selections
  selectionGone: 'That choice is no longer possible, so it was put back.',
  routeStopped: 'The rest of the belt route could not be laid, so it was stopped.',
  confirmHint: 'Confirm to place it.',

  // Primary button reasons
  decideFirst: 'First decide whether to run your activated factory.',
  othersDeciding: (names: string): string => `Waiting for ${names} to decide on an activated factory.`,
  overstockFirst: 'Place the Overstock Supplies pieces first.',
  meepleFirst: 'Place your meeple first.',
  unspentPI: (n: number): string => `You still have ${units(n)} from Production Increase; they are lost when you finish.`,

  // Generic reasons
  notYourTurn: 'It is not your turn.',
  onlyActions: 'Only during your actions step.',
  onlyActionsOrRoundEnd: 'Only during your actions step or your round-end turn.',
  nothingHere: 'Nothing to do there right now.',
  notLit: 'That is not one of the glowing choices.',

  // Bank
  bankPlaceBelt: 'Lay a belt',
  bankPlaceBeltDetail: (n: number): string => `${plural(n, 'belt', 'belts')} in your supply`,
  bankBuyBelt: 'Buy a belt',
  bankBuyCard: 'Buy a Leverage card',
  bankBuyMine: 'Buy a Mine',
  bankTeleporter: 'Place a teleporter',
  bankExchange: 'Exchange materials',
  bankExchangeDetail: 'Break one material down into smaller ones',
  bankUndoBelts: 'Take back this turn\'s belts',
  bankUndoDetail: (n: number): string => `${plural(n, 'belt', 'belts')} placed this turn`,
  price: (n: number): string => `Price ${n}, paid from your materials (change in Ore)`,
  priceExact: (n: number): string => `Price ${n}, paid exactly from your materials`,
  cardPriceDetail: (n: number, left: number): string => `Price ${n}, paid from your materials · ${left} left in the deck`,
  noBelts: 'No belts in your supply. Buy one first.',
  noBeltPoint: 'There is no free connection point for a belt.',
  cantAfford: (cost: number, worth: number): string => `Costs ${cost}; your materials are worth ${worth}.`,
  cantPayExact: (cost: number): string => `Costs exactly ${cost}; exchange materials to make that amount first.`,
  deckEmpty: 'The Leverage deck is empty.',
  allMinesIn: 'All Mines are already in play.',
  mineDropPending: 'A dropped Mine must be placed first.',
  noTeleporters: 'You have placed all your teleporters.',
  noFreeBuffer: 'None of your buildings has a buffer without a teleporter.',
  nothingToExchange: 'You have no Plate, Sphere or Tesseract to break down.',
  noBeltsThisTurn: 'You have not placed a belt this turn.',

  // Exchange
  exchangeTitle: 'Break one material down',
  exchangeLabel: (give: Material, gets: string): string => `Break 1 ${MATERIAL_NAME[give]} into ${gets}`,
  exchangeNone: (give: Material): string => `You have no ${MATERIAL_NAME[give]}.`,
  exchangeOverflow: (mats: string): string => `You are near your limit of 6 ${mats}; the extra is lost.`,

  // Teleporter
  teleporterPick: 'Tap the buffer of one of your buildings for the teleporter.',
  teleporterConfirm: (buffer: string, building: string): string => `Place a teleporter on the ${buffer} of this ${building}? Teleporters are permanent.`,
  teleporterWhich: 'Which buffer gets the teleporter?',
  bufferName: (b: 'input' | 'output'): string => (b === 'input' ? 'input' : 'output'),
  teleporterOn: (b: 'input' | 'output'): string => `Teleporter on the ${b === 'input' ? 'input' : 'output'}`,
  teleporterDetail: (price: number): string => `Price ${price}, paid exactly · permanent`,

  // Belts
  beltPickStart: 'Tap a glowing connection point to start the belt.',
  beltPickEnd: 'Tap a second point: on the same tile for one belt, or on another tile to lay a route.',
  beltStart: 'Belt start point',
  noRoute: 'No belt route connects those two points.',
  routeBlocked: 'That route cannot be laid right now.',
  routeNeedsBuy: (cost: number, have: number): string => `This route needs ${plural(cost, 'belt', 'belts')}; you have ${have}.`,
  routeBuy: (need: number): string => `Buy ${plural(need, 'belt', 'belts')} and lay the route`,
  routeBuyDetail: (need: number): string => `Price ${need}, paid from your materials`,
  routeCantBuy: (need: number): string => `You cannot afford ${plural(need, 'more belt', 'more belts')}.`,
  routeCancel: 'Do not lay it',
  removeBelt: 'Pick up this belt',
  removeBeltDetail: 'It goes back to your supply',
  yourBelt: 'Your belt',

  // Building menu
  menuClaim: 'Claim with a Control Module',
  menuUpgrade: 'Upgrade a Control Module',
  payPI: (left: number): string => `Production Increase pays: ${units(left)} left`,
  payEndOfRound: (left: number): string => `End-of-round upgrades pay: ${left} left, all on one building`,
  payMineCredit: (left: number): string => `Mine credits pay: ${left} left`,
  payFreeClaim: (left: number): string => `Free claim from the Mine: ${left} credits`,
  menuUpgradeEndOfRound: 'Upgrade with end-of-round upgrades',
  menuUpgradeMineCredit: 'Upgrade with Mine credits',
  menuClaimFree: 'Claim with your free claim',
  menuLoad: (m: Material): string => `Load 1 ${MATERIAL_NAME[m]} into the input`,
  menuRun: 'Run it',
  menuCollect: 'Collect the output',
  collectDetail: (what: string): string => `Moves ${what} into your materials`,
  moduleTrayTitle: 'Choose a Control Module',
  pickOld: 'Which Control Module do you upgrade?',
  oldModule: (n: number): string => `Control Module ${n}`,
  claimOn: (building: string): string => `Claim the ${building}: tap a glowing Control Module.`,
  upgradeOn: (building: string, old: number): string => `Upgrade Control Module ${old} on the ${building}: tap a glowing Control Module.`,
  moduleCost: (n: number): string => units(n),
  free: 'free',
  menuSubtitleModules: (mods: string): string => `Control Modules: ${mods}`,
  menuSubtitleNone: 'Unclaimed',
  menuInput: (s: string): string => `Input: ${s}`,
  menuOutput: (s: string): string => `Output: ${s}`,
  empty: 'empty',
  teleporterMark: ' (teleporter)',
  modulesOf: (name: string, mods: string): string => `${name}: ${mods}`,

  // Run / operate
  runDetail: (power: number, consumed: string, product: Material): string =>
    power > 0 ? `Pay ${tokens(power)}, use ${consumed}, make 1 ${MATERIAL_NAME[product]}`
      : `Use ${consumed}, make 1 ${MATERIAL_NAME[product]}`,
  runPowerPlant: (gain: number, consumed: string): string =>
    consumed === 'nothing' ? `Gain ${tokens(gain)}` : `Use ${consumed}, gain ${tokens(gain)}`,
  alreadyRan: 'You have already run this building this round.',
  powerFull: 'You already have 10 Power Tokens.',
  outputFull: 'Its output buffer is full; collect it first.',
  loadFirst: 'Load its inputs first.',
  badRecipe: 'Its inputs do not make a valid recipe.',
  needPower: (need: number, have: number): string => `Needs ${tokens(need)}; you have ${have}.`,
  inventoryFull: (m: string): string => `You already hold 6 ${m}.`,

  // Prompts (operate or skip)
  promptTitle: (building: string, module: number, total: number): string =>
    `Your ${building} (Control Module ${module}) was activated by a roll of ${total}`,
  promptRun: 'Run it',
  promptSkip: 'Skip',
  promptSkipDetail: 'Keep your Power Tokens and materials',
  promptRunUnknown: 'Run it with what is in its input',
  promptCannotRun: 'Its output buffer is already full, so it cannot run now; skip it.',
  promptHint: 'Decide on your activated factory.',

  // Cards
  playCard: (name: string): string => `Play ${name}?`,
  cardsMaxed: `You have already played ${MAX_CARDS_PLAYED_PER_TURN} Leverage cards this turn.`,
  cardOnlyActions: 'Leverage cards can be played only during your actions step.',
  cardNoModule: (floor: number): string => `You have no Control Module of ${floor} or more left.`,
  cardNoTarget: 'There is nothing this card can be used on right now.',
  cardNoTeleporters: 'You have no teleporters left.',
  shortSalePick: (module: number): string => `Short Sale: tap a building to claim it with your Control Module ${module}.`,
  shortSaleConfirm: (building: string, module: number): string => `Claim this ${building} with Control Module ${module}?`,
  sinkHolePick: 'Sink Hole: tap an unclaimed piece to remove it.',
  sinkHoleConfirm: (what: string): string => `Remove this ${what} from the board?`,
  cpPickFrom: 'Changing Priorities: tap the building to move a Control Module from.',
  cpPickTo: 'Now tap the building to move it to.',
  cpPickModule: 'Which Control Module moves?',
  cpConfirm: (module: number, from: string, to: string): string => `Move Control Module ${module} from the ${from} to the ${to}?`,
  rdPick: 'R&D Tax Write-Off: tap the buffer of one of your buildings for a free teleporter.',
  rdConfirm: (buffer: string, building: string): string => `Place a free teleporter on the ${buffer} of this ${building}? Teleporters are permanent.`,
  dronePile: 'Scouting Drone: choose a piece from the stacks',
  droneItem: (stack: number, pos: number, what: string): string => `Stack ${stack}, piece ${pos}: ${what}`,
  droneInstruction: 'Scouting Drone: choose a piece from the list.',
  piInstruction: (left: number): string => `Production Increase: tap a glowing building to claim or upgrade (${units(left)} left).`,
  piDone: 'Done with Production Increase',
  piDoneDetail: 'Any upgrades left stay available until your turn ends',
  cardCount: (name: string, n: number): string => (n > 1 ? `${name} ×${n}` : name),

  // Meeple
  resourcePoint: 'Mine resource point',
  upgradePoint: 'Mine upgrade point',
  meepleWhich: 'Which Mine point?',

  // Why-not hints
  notYourBuilding: 'That building is not yours.',
  notAdjacent: 'Pieces must go next to the board.',
  stackLocked: 'That stack is still covered by its Mine.',
  stackEmpty: 'That stack is empty.',
  notYourBelt: 'That belt is not yours.',
  pointNotFree: 'That connection point cannot take a belt right now.',
} as const;

/** Wording for a stack, 0-based index in. */
export const stackName = (i: number): string => `stack ${i + 1}`;

/** Default display name for a seat. */
export const playerName = (id: number): string => `Player ${id + 1}`;

/** Selection kinds' default labels. */
export const selectionLabel = {
  tile: (what: string, stack: number): string => `${what} from stack ${stack + 1}`,
  mine: 'Mine',
  overstock: (what: string): string => `Overstock piece: ${what}`,
  drone: (what: string): string => `Scouting Drone piece: ${what}`,
  card: (name: string): string => name,
  building: (what: string): string => what,
  belt: 'Belt',
  teleporter: 'Teleporter',
  meeple: 'Meeple',
} as const;
