// Where each player sits round the table, for their default view. Pure, no Three.js.
//
// Players sit round the real table in turn order, going clockwise (seen from above), and each
// looks at the board from their own side. Seat 0 looks from the bottom of the default view
// (camera azimuth 0, looking towards -Z); the next seat clockwise looks from the left side
// (azimuth -90 degrees, which is what the camera's azimuth means: see camera.ts apply). Three or
// four players use the four sides of the table; two players sit opposite each other.

/** Camera azimuth (radians, 0 to 2 pi) of seat k of n round the table. */
export function seatAzimuth(seat: number, seatCount: number): number {
  if (!Number.isFinite(seat) || seat < 0 || seatCount < 2) return 0;
  const step = seatCount === 2 ? Math.PI : Math.PI / 2;
  const a = -Math.round(seat) * step;
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}

/**
 * The seat (0 to n-1) round the table of player `me`: their place in the cyclic turn order counted
 * from player 0 (the turn order is shuffled at setup and only turns round after that, so this
 * never changes during a game). null for a spectator or a player not in the turn order.
 */
export function tableSeat(turnOrder: ReadonlyArray<number>, me: number | null): number | null {
  if (me === null) return null;
  const n = turnOrder.length;
  const i = turnOrder.indexOf(me);
  if (i < 0 || n === 0) return null;
  const zero = Math.max(0, turnOrder.indexOf(0));
  return (i - zero + n) % n;
}
