// Every player-facing string the play controller produces, in rulebook words.
// Kept in one module so the wording can be reviewed (and later translated) in one place.
// Never put internal names here (phase names, action type names, piece or card ids).

import type { CardType, Material, PieceType } from '../engine/config';
import { INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, POWER_TOKEN_CAP } from '../engine/config';
import { moduleBelowFloor } from '../engine';
import { BUILDING_NAME, CARD_NAME, MATERIAL_NAME } from '../session/describe';

export { CARD_NAME, MATERIAL_NAME };

/** "Plate Factory", "Power Plant", "Mine", "blank tile". */
export function pieceName(type: PieceType): string {
  return BUILDING_NAME[type];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** "Ore", "Plates", "Spheres", "Tesseracts" (Ore has no plural). */
export const materialPlural = (m: Material): string => (m === 'ore' ? MATERIAL_NAME[m] : `${MATERIAL_NAME[m]}s`);
/** "2 Ore", "1 Plate", "3 Spheres". */
export const amountOf = (n: number, m: Material): string => `${n} ${n === 1 ? MATERIAL_NAME[m] : materialPlural(m)}`;
export const units = (n: number): string => plural(n, 'upgrade', 'upgrades');
const tokens = (n: number): string => plural(n, 'Power Token', 'Power Tokens');

export function materialList(mats: readonly Material[]): string {
  return mats.length === 0 ? 'nothing' : mats.map(m => MATERIAL_NAME[m]).join(' + ');
}

const VALUE_ORDER: readonly Material[] = ['tesseract', 'sphere', 'plate', 'ore'];

/** "a Sphere", "an Ore", "2 Spheres". */
export function someOf(n: number, m: Material): string {
  if (n !== 1) return amountOf(n, m);
  return m === 'ore' ? 'an Ore' : `a ${MATERIAL_NAME[m]}`;
}

/** "a, b and c". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** A handful of materials in words, largest first: "a Sphere and a Plate", "2 Spheres", "an Ore". */
export function supplyWords(mats: readonly Material[]): string {
  const n = new Map<Material, number>();
  for (const m of mats) n.set(m, (n.get(m) ?? 0) + 1);
  return andList(VALUE_ORDER.filter(m => n.has(m)).map(m => someOf(n.get(m)!, m)));
}

// ── Card rules text (from RULES.md; matches what the engine does) ─────────────

export const CARD_TEXT: Record<CardType, string> = {
  scoutingDrone: 'Look through the stacks, choose a piece and place it on the board now.',
  shortSale: 'Claim an unclaimed building (or add to one you hold a claim on) with your lowest Control Module that is not below the number of Mines.',
  embezzlement: 'Take 1 Sphere from the bank.',
  sinkHole: 'Remove an unclaimed board piece (not a Mine). Belts on it go back to their owners.',
  overstockSupplies: 'Draw 3 pieces and place them next to the board. Played as soon as it is drawn.',
  netSurplusSellOff: 'Each other player gives you 3 Power Tokens (or all they have), until you reach 10.',
  changingPriorities: 'Move one of your Control Modules to another building: an unclaimed one, or one you hold a claim on.',
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
  gameOverWinner: (name: string, how: string): string => `The game is over. ${name} wins${how}.`,
  gameOverTie: (names: string, how: string): string => `The game is over. Shared win${how}: ${names}.`,
  /** How the game ended, after the winner's name. */
  gameOverHow: (reason: 'tesseracts' | 'boardExhausted' | null): string => (reason === 'tesseracts' ? ' with 4 Tesseracts'
    : reason === 'boardExhausted' ? ' on points (the pieces ran out, the last round was finished and material value was counted)' : ''),
  /** Shown all through the last round, once no piece is left to draw. */
  finalRound: 'The pieces have run out: this is the final round.',
  noPiecesLeft: 'none left',
  gameOverNone: 'The game is over.',

  // Waiting (someone else's turn)
  waitingSetup: (name: string): string => `${name} is choosing a starting building.`,
  waitingPlace: (name: string): string => `${name} is placing a board piece.`,
  waitingRoll: (name: string): string => `${name} is about to roll the dice.`,
  waitingActions: (name: string): string => `${name} is taking actions.`,
  waitingMeeple: (name: string): string => `${name} is placing their meeple.`,
  waitingDraw: (name: string): string => `${name} is choosing a stack to draw from.`,
  waitingDrew: (name: string, what: string): string => `${name} drew a ${what} and is placing it.`,
  drawPick: 'Choose a stack to draw from. The piece you draw must be placed.',
  drawFirst: 'First choose a stack to draw from: tap one of the glowing stacks.',
  notDrawnPile: (n: number): string => `You drew from stack ${n}: place that piece.`,
  pileNotNow: 'Pieces are drawn only in step 1, Place a piece.',
  /** A Leverage card played as soon as it was drawn, said on the table (n: Overstock pieces drawn). */
  playOnDraw: (card: 'overstockSupplies' | 'mineInspection' | 'solarFlare' | string, name: string, n: number, you: boolean): string => {
    const effect: Record<string, string> = {
      overstockSupplies: you ? `place ${n} board pieces` : `${name} places ${n} board pieces`,
      mineInspection: you ? 'take 1 Plate from the bank for each Mine in play' : `${name} takes 1 Plate from the bank for each Mine in play`,
      solarFlare: 'every player gets 2 Power Tokens',
    };
    const title = CARD_NAME[card as CardType] ?? card;
    return `${you ? '' : `${name} bought a Leverage card. `}${title} is played as soon as it is drawn: ${effect[card] ?? 'it takes effect at once'}.`;
  },
  playOnDrawRule: (names: readonly string[]): string =>
    `Some Leverage cards are played as soon as they are drawn and never go to a hand: ${names.join(', ')}.`,
  pileTopPlace: (what: string): string => `The ${what} on top of this stack is yours to place: tap a glowing space next to the board.`,
  waitingRoundEnd: (name: string): string => `End of the round: ${name} may use free upgrades and the building their meeple stands on.`,

  // Setup
  setupPF: 'Choose your starting Plate Factory: tap a glowing one, then confirm.',
  setupPP: 'Choose your starting Power Plant: tap a glowing one, then confirm.',
  setupConfirm: (building: string, module: number): string => `Claim this ${building} with your Control Module ${module}?`,

  // Step 1
  placePickStack: 'Place a board piece: pick one of the glowing stacks.',
  placePickCell: (what: string): string => `Place the ${what}: tap a glowing space next to the board.`,
  placeTurnConfirm: (what: string): string => `Turn the ${what} if you like, then confirm.`,
  mineDropped: 'A Mine has dropped: tap a glowing space for its larger half (either half may touch the board), then turn it.',
  minePick: 'Place the Mine: tap a glowing space for its larger half (either half may touch the board), then turn it.',
  minePlaceConfirm: 'Turn the Mine if you like, then confirm.',

  // Step 2
  rollNow: 'Roll the dice: one die for each Mine in play.',
  rollNoPieces: 'The pieces have run out, so there is no piece to place: roll the dice (one die for each Mine in play).',
  rollLabel: (n: number): string => `Roll ${n} ${n === 1 ? 'die' : 'dice'}`,

  // Step 3
  actionsIdle: 'Take any actions you want, then press Done with actions.',
  actionsDone: 'Done with actions',
  overstockPlace: (i: number, n: number, what: string): string => `Overstock Supplies: place piece ${i} of ${n} (a ${what}) next to the board.`,
  pendingMine: 'Decide how to run your activated building (or whether to skip it).',
  pendingMineMany: (n: number): string => `Decide on your ${n} activated buildings.`,

  // Step 4
  meeplePlace: 'Place your meeple: tap one of your glowing buildings or a Mine point. Every turn ends with this step.',
  meepleConfirm: (where: string): string => `Place your meeple on the ${where}?`,
  /** A Mine point: what it gives ("2 Ore", "3 Control Module upgrades") at the end of the round. */
  meepleConfirmGain: (where: string, gain: string): string => `Place your meeple on the ${where} to gain ${gain} at the end of the round?`,
  meepleGainMaterial: (n: number, m: Material): string => amountOf(n, m),
  meepleGainUpgrades: (n: number): string => plural(n, 'Control Module upgrade', 'Control Module upgrades'),
  /** The limit (6 of each material) would cut the Mine's reward, as things stand now. */
  meepleGainCut: (m: Material, have: number, fits: number): string => (fits <= 0
    ? ` You already hold ${INVENTORY_CAP} ${materialPlural(m)}, so it would be lost unless you spend some first.`
    : ` You hold ${amountOf(have, m)}, so only ${fits} ${fits === 1 ? 'fits' : 'fit'} under your limit of ${INVENTORY_CAP}.`),
  meepleSlotDetail: (gain: string): string => `Gain ${gain} at the end of the round`,
  meepleDone: 'Your meeple is placed. End your turn.',
  meepleDoneCards: 'Your meeple is placed. You may still play a Leverage card; then end your turn.',
  endTurn: 'End turn',
  noMeepleSpot: 'There is nowhere to place your meeple. End your turn.',

  // Round end
  roundEndIdle: "End of the round: you may use your free upgrades (one per Mine, on one building), Mine credits, and your meeple's building. Nothing to do? Finish the round-end turn.",
  roundEndDone: 'Finish round-end turn',

  // Selections
  selectionGone: 'That choice is no longer possible, so it was put back.',
  routeStopped: 'The rest of the belt route could not be laid, so it was stopped.',
  confirmHint: 'Confirm to place it.',

  // Primary button reasons
  decideFirst: 'First decide on your activated building.',
  othersDeciding: (names: string): string => `Waiting for ${names} to decide on an activated building.`,
  overstockFirst: 'Place the Overstock Supplies pieces first.',
  meepleFirst: 'Place your meeple first: tap a glowing building or Mine point.',
  unspentPI: (n: number): string => `You still have ${units(n)} from Production Increase; they can be spent until your turn ends.`,

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
  price: (n: number): string => `Price ${n}, paid from your materials with change`,
  /** The teleporter's price: teleporters on the board + 1. */
  teleporterPrice: (n: number): string => `Price ${n} (teleporters on the board + 1), paid from your materials with change`,
  cardPriceDetail: (n: number, deck: number, discard: number): string =>
    `Price ${n}, paid from your materials with change · ${deck} in the deck${discard > 0 ? `, ${discard} in the discard pile (shuffled into a new deck when the deck runs out)` : ''} · some cards are played as soon as they are drawn`,
  /** What a purchase paid with change leaves (" · You keep 1 Plate and 2 Ore"); `lost`: change that did not fit under the limit. */
  payKeep: (kept: string, lost: number): string =>
    ` · You keep ${kept}${lost > 0 ? `; ${lost} of the change is lost (limit of ${INVENTORY_CAP} each)` : ''}`,
  /** Right after a purchase paid with change: "Paid 3. You keep 1 Plate and 2 Ore." */
  paidKeep: (price: number, kept: string, lost: number): string =>
    `Paid ${price}. You keep ${kept}.${lost > 0 ? ` ${lost} of the change is lost (limit of ${INVENTORY_CAP} each).` : ''}`,
  noBelts: 'No belts in your supply. Buy one first.',
  noBeltPoint: 'There is no free connection point for a belt.',
  cantAfford: (cost: number, worth: number): string => `Costs ${cost}; your materials are worth ${worth}.`,
  deckEmpty: 'No Leverage cards are left: the deck and the discard pile are both empty.',
  /** The deck was empty when a card was bought: the discard pile became a new deck. */
  reshuffled: (n: number): string => `The Leverage deck was empty, so the discard pile (${n} ${n === 1 ? 'card' : 'cards'}) was shuffled into a new deck.`,
  deckFinishFirst: 'Confirm or cancel what you are doing first, then tap the deck to buy a Leverage card.',
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
  /** "Exchange 1 Sphere for 2 Plates and 1 Ore?" */
  exchangeAsk: (give: Material, gets: readonly (readonly [Material, number])[]): string =>
    `Exchange 1 ${MATERIAL_NAME[give]} for ${gets.map(([m, n]) => amountOf(n, m)).join(' and ')}?`,
  /** The limit would cut what comes back: say how much arrives. */
  exchangeCut: (m: Material, n: number, arriving: number): string => (arriving <= 0
    ? ` You already hold ${INVENTORY_CAP} ${materialPlural(m)}, so the ${amountOf(n, m)} would be lost.`
    : ` Only ${arriving} of the ${amountOf(n, m)} ${arriving === 1 ? 'fits' : 'fit'} under your limit of ${INVENTORY_CAP}; the rest is lost.`),
  exchangeConfirm: 'Exchange',
  exchangeSelection: (give: Material): string => `Exchange 1 ${MATERIAL_NAME[give]}`,
  exchangeInvDetail: (give: Material, gets: string): string => `Tap to exchange 1 ${MATERIAL_NAME[give]} for ${gets}`,
  totalValue: (n: number): string => `Total Value: ${n}`,

  // Teleporter
  teleporterPick: 'Tap the buffer of one of your buildings for the teleporter.',
  teleporterConfirm: (buffer: string, building: string): string =>
    `Place a teleporter on the ${buffer} of this ${building}? You cannot take it back; it returns to you only if you lose your last claim on this building.`,
  teleporterWhich: 'Which buffer gets the teleporter?',
  bufferName: (b: 'input' | 'output'): string => (b === 'input' ? 'input' : 'output'),
  teleporterOn: (b: 'input' | 'output'): string => `Teleporter on the ${b === 'input' ? 'input' : 'output'}`,
  teleporterDetail: (price: number): string => `Price ${price}, paid from your materials with change`,

  // Belts
  beltPickStart: 'Tap a glowing connection point where the belts should start.',
  beltPickEnd: 'Tap where the belts should end: the shortest route between the two points is shown, even if you cannot lay it all yet.',
  beltStart: 'Belt start point',
  noRoute: 'No belt route connects those two points.',
  routeBlocked: 'That route cannot be laid right now.',
  routeNeedsBuy: (cost: number, have: number): string => `This route needs ${plural(cost, 'belt', 'belts')}; you have ${have}.`,
  routeBuy: (need: number): string => `Buy ${plural(need, 'belt', 'belts')} and lay the route`,
  routeBuyDetail: (need: number): string => `Price ${need}, paid from your materials with change`,
  routeCantBuy: (need: number): string => `You cannot afford ${plural(need, 'more belt', 'more belts')}.`,
  routeCancel: 'Cancel this route',
  routeCancelDetail: 'Nothing on the board changes',
  routeDropRest: 'Drop the rest of the route',
  routeDropRestDetail: 'The belts already laid stay on the board',
  routeTakeBack: 'Take back this route',
  routeTakeBackDetail: (n: number): string =>
    `The ${n === 1 ? 'belt' : `${n} belts`} of this route laid this turn ${n === 1 ? 'goes' : 'go'} back to your supply`,
  routeRefused: 'This route cannot be laid now.',
  routeRestRefused: 'The rest of this route cannot be laid now.',
  routeTotals: (n: number, have: number, buy: number, short: number): string =>
    `Route: ${plural(n, 'belt', 'belts')}. You have ${have}${buy > 0 ? `, can buy ${buy} more now` : ''}${short > 0 ? `, ${short} short` : ''}.`,
  routePlaceAll: (n: number): string => `Place ${plural(n, 'belt', 'belts')}`,
  routePlaceOwn: (n: number): string => `Place ${n} from inventory`,
  routeBuyPlace: (m: number, total: number): string => `Buy ${m} and place ${total}`,
  routeOwnDetail: 'From the belts in your supply',
  routeNothingNow: 'You have no belts and cannot buy one now: keep the plan for a later turn.',
  routeNoSupply: (n: number, buy: number): string =>
    `Route: ${plural(n, 'belt', 'belts')}. No belts in your supply${buy > 0 ? `; you can buy ${buy} now` : ''}.`,
  routeLater: 'Keep the plan for a later turn',
  routeLaterDetail: 'It is offered again when you next press Lay a belt',
  layBeltFirst: 'To lay belts, press Lay a belt first, then tap where they should start.',
  routeContinue: (k: number): string => `Continue your planned route (${plural(k, 'belt', 'belts')} left)`,
  routeContinueDetail: 'The route you planned earlier on this device',
  planGone: 'Your planned route can no longer be laid, so it was dropped.',
  routeDone: 'Your planned route is complete.',
  removeBelt: 'Take back this belt',
  removeBeltToBank: 'Return this belt to the bank',
  bankRemoveBelt: 'Remove a belt',
  bankRemoveBeltDetail: 'One you laid this turn comes back to your belts; an older one goes back to the bank',
  noBeltToRemove: 'You have no belt that can be removed now.',
  removePick: 'Tap one of your glowing belts. One you laid this turn comes back to your belts; an older one goes back to the bank.',
  removeConfirm: 'You laid this belt this turn, so it comes back to your belts. Press Take back this belt.',
  removeConfirmBank: 'This belt goes back to the bank; placing a belt there again means buying one. Press Return this belt to the bank.',
  removeSelection: 'Removing belts',
  noBeltEndsHere: 'No belt can end here.',
  bufferNoBelt: "A belt cannot end on a building's input or output; it ends on the tile next to it.",
  meepleChoose: 'Place your meeple',
  meepleChooseWhy: 'Tap a glowing building or Mine point; your turn ends when you confirm.',
  noMeepleSpotEnd: 'No place for your meeple: end turn',
  removeBeltDetail: 'Laid this turn: it comes back to your belts. Laid earlier: it goes back to the bank',
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
  oldModule: (n: number, mines = 1): string => `Control Module ${W.moduleNumber(n, mines)}`,
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
  // Control Modules below the number of Mines in play (they can never be rolled).
  /** "4", or "1 (cannot be rolled)" for a module below the number of Mines in play. */
  moduleNumber: (n: number, mines: number): string => (moduleBelowFloor(n, mines) ? `${n} (cannot be rolled)` : String(n)),
  /** A list of module numbers, each marked when it cannot be rolled: "1 (cannot be rolled), 4". */
  moduleNumbers: (ns: readonly number[], mines: number): string => ns.map(n => W.moduleNumber(n, mines)).join(', '),
  /** The tray's label for a skipped module (screen readers). */
  moduleSkippedLabel: (n: number, mines: number): string => `Control Module ${n}: skipped, a ${n} cannot be rolled with ${mines} Mines in play`,
  /** Said when a skipped module in the tray is tapped. */
  moduleSkipped: (n: number, mines: number): string =>
    `Control Module ${n} is skipped: a ${n} cannot be rolled with ${mines} Mines in play, so it can no longer be placed or chosen as an upgrade.`,
  /** In the menu of my building that holds modules that cannot be rolled. `runs`: another module of mine there still can be. */
  moduleSkippedOnBuilding: (ns: readonly number[], mines: number, runs: boolean): string => {
    const one = ns.length === 1;
    const which = one ? `Control Module ${ns[0]}` : `Control Modules ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
    return `${which} cannot be rolled with ${mines} Mines in play. `
      + (runs ? `Upgrade ${one ? 'it' : 'them'} to use ${one ? 'it' : 'them'} again.` : `Upgrade ${one ? 'it' : 'them'} to make this building run again.`);
  },

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
  promptHint: 'Decide on your activated building.',
  /** What the host does when an off-turn decision is not answered in time (it never supplies anything). */
  promptTimeout: 'When the time runs out, it runs only if it can without your materials; otherwise it is skipped.',

  // Supplying a building through your teleporter on its input
  /** "The Tesseract Factory needs a Sphere and a Plate to run." */
  supplyNeeds: (building: string, needs: string): string => `The ${building} needs ${needs} to run.`,
  /** Several recipes fit: "needs one of: a Plate and an Ore; or 2 Plates." */
  supplyNeedsOneOf: (building: string, options: readonly string[]): string =>
    `The ${building} needs one of these to run: ${options.join('; or ')}.`,
  supplyPlantAsk: 'Your Power Plant runs. Provide a material for more Power Tokens?',
  /** "Provide a Sphere and a Plate". */
  provide: (what: string): string => `Provide ${what}`,
  runAsIs: 'Run it with what is in it',
  /** A Power Plant's plain run: "Run it as it is (+1 Power Token)". */
  runPlantAsIs: (gain: number): string => `Run it as it is (+${tokens(gain)})`,
  plantGain: (gain: number, nominal: number): string =>
    `+${tokens(gain)}${gain < nominal ? ` (your limit is ${POWER_TOKEN_CAP})` : ''}`,
  supplyYouHold: 'Your materials',
  supplyInput: 'Its input',
  supplyLacking: 'You do not hold the materials for any of these.',
  supplyPlantNothing: 'You hold no Ore, Plate or Sphere to provide, so it runs as it is.',
  supplyPlantFull: `You already have ${POWER_TOKEN_CAP} Power Tokens, so it cannot run: skip it.`,
  supplyNoPower: (need: number, have: number): string => `It needs ${tokens(need)} to run; you have ${have}. Skip it.`,
  supplyHowTo: 'Your teleporter is on its input: choose what to hand over from your materials. Nothing is taken unless you choose it.',

  // Cards
  playCard: (name: string): string => `Play ${name}?`,
  cardsMaxed: `You have already played ${MAX_CARDS_PLAYED_PER_TURN} Leverage cards this turn.`,
  cardOwnTurnOnly: 'Leverage cards are played in the four steps of your own turn, not in the setup or the round-end turns.',
  droneBeforeDraw: 'In step 1, Scouting Drone can be played only before you draw a piece.',
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
  rdConfirm: (buffer: string, building: string): string =>
    `Place a free teleporter on the ${buffer} of this ${building}? You cannot take it back; it returns to you only if you lose your last claim on this building.`,
  dronePile: 'Scouting Drone: choose a piece from the stacks',
  droneItem: (stack: number, what: string): string => `Stack ${stack}: ${what}`,
  /** The same piece type is offered more than once from one stack: tell them apart by position. */
  droneItemAt: (stack: number, pos: number, what: string): string => `Stack ${stack}: ${what} (piece ${pos})`,
  droneInstruction: 'Scouting Drone: choose a piece from the list.',
  piInstruction: (left: number): string => `Production Increase: tap a glowing building to claim or upgrade (${units(left)} left).`,
  piDone: 'Done with Production Increase',
  piDoneStep: 'Done with Production Increase: back to this step',
  piSpend: 'Spend Production Increase',
  piSpendDetail: (n: number): string => `${units(n)} left this turn`,
  piSpending: 'Tap a glowing building to claim or upgrade it.',
  piDoneDetail: 'Any upgrades left stay available until your turn ends',
  cardCount: (name: string, n: number): string => (n > 1 ? `${name} ×${n}` : name),

  // Meeple
  resourcePoint: 'Mine resource point',
  upgradePoint: 'Mine upgrade point',
  meepleWhich: 'Which Mine point?',
  meepleOffTarget: 'Your meeple can go only on a glowing building or Mine point: tap one of them.',

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
