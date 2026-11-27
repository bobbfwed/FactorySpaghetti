// How a Control Module on a building is coloured: the owner's colour with a near-black numeral,
// or, when its number is below the number of Mines in play (moduleBelowFloor: it can never be
// rolled), greyed out: the owner's colour mixed strongly toward grey, so whose it is still shows,
// with a dimmed numeral. Both are per-instance colours, so a greyed module costs no draw call.

import * as THREE from 'three';
import { moduleBelowFloor } from '../engine/rules/modules';

/** The grey a skipped module's face is mixed toward. */
export const SKIPPED_GREY = new THREE.Color(0x8c8c8c);
/** How far toward grey a skipped module's face goes (0 = owner's colour, 1 = grey). */
export const SKIPPED_MIX = 0.72;
/** The numeral of a live module (the atlas is white; this colour tints it). */
export const NUMERAL_LIVE = new THREE.Color(0x111111);
/** The numeral of a skipped module: dimmed, still readable on the grey face. */
export const NUMERAL_SKIPPED = new THREE.Color(0x4a4a4a);

/** Face and numeral colours of Control Module `module` owned by a player of colour `owner`. */
export function moduleColors(owner: THREE.Color, module: number, mineCount: number): { face: THREE.Color; numeral: THREE.Color } {
  if (!moduleBelowFloor(module, mineCount)) return { face: owner, numeral: NUMERAL_LIVE };
  return { face: owner.clone().lerp(SKIPPED_GREY, SKIPPED_MIX), numeral: NUMERAL_SKIPPED };
}
