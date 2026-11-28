// A move from another browser, rebuilt from the known fields of its type and nothing else. The
// host applies and stores only the rebuilt move, so a modified client cannot slip extra data into
// the journal (which every device keeps and every save file carries), and a field it is not
// entitled to set (who operates a building) is decided by the host, not taken on trust.
//
// Kept in step with the engine by a test: every move legalActions offers, over many games,
// rebuilds to itself. A new action type or field the normaliser does not know fails that test.

import type { Action } from '../engine/actions';
import type { CardType, Material } from '../engine/config';
import { CARD_COUNTS, MATERIAL_VALUES } from '../engine/config';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

const CARDS = new Set(Object.keys(CARD_COUNTS));
const MATERIALS = new Set(Object.keys(MATERIAL_VALUES));

/** Thrown inside the field readers; caught by normalizeAction. */
class Reject extends Error {}
const no = (): never => { throw new Reject(); };

const int = (x: unknown, lo: number, hi: number): number =>
  (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : no());
const str = (x: unknown): string => (typeof x === 'string' && x.length > 0 && x.length <= 64 ? x : no());
const bool = (x: unknown): boolean => (typeof x === 'boolean' ? x : no());
const coord = (x: unknown): { q: number; r: number } =>
  (isObj(x) ? { q: int(x.q, -1000, 1000), r: int(x.r, -1000, 1000) } : no());
const stack = (x: unknown): 0 | 1 | 2 => int(x, 0, 2) as 0 | 1 | 2;
const rotation = (x: unknown): number => int(x, 0, 5);
const module = (x: unknown): number => int(x, 0, 99);
const point = (x: unknown): number => int(x, 0, 99);
const seat = (x: unknown): number => int(x, 0, 3);
const buffer = (x: unknown): 'input' | 'output' => (x === 'input' || x === 'output' ? x : no());
/** Which input of a building a teleporter goes on (#55): 0 to 2 (a Tesseract Factory has three). */
const inputIndex = (x: unknown): number => int(x, 0, 2);
const material = (x: unknown): Material => (typeof x === 'string' && MATERIALS.has(x) ? x as Material : no());
const card = (x: unknown): CardType => (typeof x === 'string' && CARDS.has(x) ? x as CardType : no());
const dice = (x: unknown): number[] =>
  (Array.isArray(x) && x.length <= 3 ? x.map(d => int(d, 1, 6)) : no());
/** What a building is supplied through its input teleporter: at most 3 materials (a Tesseract Factory's input). */
const supply = (x: unknown): Material[] =>
  (Array.isArray(x) && x.length <= 3 ? x.map(material) : no());

/** Copy the optional fields that are present (not undefined), each through its reader. */
function opt(src: Obj, readers: Record<string, (x: unknown) => unknown>): Obj {
  const out: Obj = {};
  for (const [k, read] of Object.entries(readers)) if (src[k] !== undefined) out[k] = read(src[k]);
  return out;
}

/** The move rebuilt from its known fields, or null if it is not a well-formed engine move. */
export function normalizeAction(raw: unknown): Action | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  const a = raw;
  try {
    switch (a.type) {
      case 'SETUP_CLAIM': return { type: 'SETUP_CLAIM', pieceId: str(a.pieceId) };
      case 'DRAW_PIECE': return { type: 'DRAW_PIECE', stackIndex: stack(a.stackIndex) };
      case 'PLACE_PIECE': return { type: 'PLACE_PIECE', stackIndex: stack(a.stackIndex), coord: coord(a.coord), ...opt(a, { rotation }) };
      case 'ROLL_DICE': return { type: 'ROLL_DICE', rolls: dice(a.rolls) };
      case 'END_ACTIONS': return { type: 'END_ACTIONS' };
      case 'END_TURN': return { type: 'END_TURN' };
      case 'BUY_BELT': return { type: 'BUY_BELT' };
      case 'BUY_CARD': return { type: 'BUY_CARD' };
      case 'UNDO_BELTS': return { type: 'UNDO_BELTS' };
      case 'PLACE_MEEPLE': return { type: 'PLACE_MEEPLE', pieceId: str(a.pieceId), ...opt(a, { slotIndex: x => int(x, 0, 1) }) };
      case 'PLACE_BELT': return { type: 'PLACE_BELT', pieceId: str(a.pieceId), fromPoint: point(a.fromPoint), toPoint: point(a.toPoint) };
      case 'REMOVE_BELT': return { type: 'REMOVE_BELT', beltId: str(a.beltId) };
      case 'PLACE_TELEPORTER':
        return { type: 'PLACE_TELEPORTER', pieceId: str(a.pieceId), bufferType: buffer(a.bufferType), ...opt(a, { inputIndex }) };
      case 'CLAIM_BUILDING':
        return {
          type: 'CLAIM_BUILDING', pieceId: str(a.pieceId), controlModule: module(a.controlModule),
          ...opt(a, { fromProductionIncrease: bool, fromFreeClaim: bool }),
        };
      case 'UPGRADE_BUILDING':
        return {
          type: 'UPGRADE_BUILDING', pieceId: str(a.pieceId), oldModule: module(a.oldModule), newModule: module(a.newModule),
          ...opt(a, { freeCredits: x => int(x, 0, 99), fromProductionIncrease: bool, fromMineCredit: bool }),
        };
      case 'BUY_MINE': return { type: 'BUY_MINE', coord: coord(a.coord), ...opt(a, { rotation }) };
      case 'PLACE_MINE': return { type: 'PLACE_MINE', coord: coord(a.coord), ...opt(a, { rotation }) };
      case 'PLACE_OVERSTOCK_PIECE': return { type: 'PLACE_OVERSTOCK_PIECE', coord: coord(a.coord), ...opt(a, { rotation }) };
      case 'PLAY_CARD':
        return {
          type: 'PLAY_CARD', cardType: card(a.cardType),
          ...opt(a, {
            stackIndex: stack, pieceIndex: x => int(x, 0, 200), coord, rotation, pieceId: str, toPieceId: str,
            controlModule: module, bufferType: buffer, inputIndex,
          }),
        } as Action;
      case 'SKIP_FACTORY_ROLL': return { type: 'SKIP_FACTORY_ROLL', pieceId: str(a.pieceId), ...opt(a, { ownerId: seat }) } as Action;
      case 'OPERATE_BUILDING': return { type: 'OPERATE_BUILDING', pieceId: str(a.pieceId), ...opt(a, { ownerId: seat, supply }) } as Action;
      case 'EXCHANGE_MATERIALS': return { type: 'EXCHANGE_MATERIALS', give: material(a.give) };
      case 'LOAD_BUILDING_INPUT': return { type: 'LOAD_BUILDING_INPUT', pieceId: str(a.pieceId), material: material(a.material) };
      case 'COLLECT_OUTPUT': return { type: 'COLLECT_OUTPUT', pieceId: str(a.pieceId) };
      default: return null;
    }
  } catch (e) {
    if (e instanceof Reject) return null;
    throw e;
  }
}
