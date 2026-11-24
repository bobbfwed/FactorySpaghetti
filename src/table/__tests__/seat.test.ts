// Each player's default view is from their own side of the table, seated in turn order clockwise.

import { describe, it, expect } from 'vitest';
import { seatAzimuth, tableSeat } from '../seat';
import { CameraRig } from '../camera';

const deg = (r: number): number => Math.round((r * 180) / Math.PI);

describe('seatAzimuth', () => {
  it('three or four players use the four sides of the table, going clockwise', () => {
    expect([0, 1, 2, 3].map(k => deg(seatAzimuth(k, 4)))).toEqual([0, 270, 180, 90]);
    expect([0, 1, 2].map(k => deg(seatAzimuth(k, 3)))).toEqual([0, 270, 180]);
  });

  it('two players sit opposite each other', () => {
    expect([0, 1].map(k => deg(seatAzimuth(k, 2)))).toEqual([0, 180]);
  });

  it('anything else looks from the default side', () => {
    expect(seatAzimuth(-1, 4)).toBe(0);
    expect(seatAzimuth(Number.NaN, 4)).toBe(0);
    expect(seatAzimuth(0, 1)).toBe(0);
  });

  it('the next seat sits clockwise of the one before, seen from above', () => {
    // The camera of seat k, seen from above (x right, z down): turning from seat k to seat k+1
    // must be a clockwise turn, which on that screen frame is a positive cross product.
    for (const n of [3, 4]) {
      for (let k = 0; k < n - 1; k++) {
        const a = seatAzimuth(k, n), b = seatAzimuth(k + 1, n);
        const pa = { x: Math.sin(a), z: Math.cos(a) }, pb = { x: Math.sin(b), z: Math.cos(b) };
        expect(pa.x * pb.z - pa.z * pb.x).toBeGreaterThan(0);
      }
    }
  });

  it('the camera sits on that side: seat 1 of 4 looks from the left of the default view', () => {
    const rig = new CameraRig();
    rig.setSize(800, 600);
    rig.turnTo(seatAzimuth(1, 4), false);
    rig.camera.updateMatrixWorld();
    expect(rig.camera.position.x).toBeLessThan(-1000);
    expect(Math.abs(rig.camera.position.z)).toBeLessThan(1);
  });
});

describe('tableSeat', () => {
  it('is the place in the cyclic turn order counted from player 0, the same every round', () => {
    const order = [2, 0, 3, 1];
    expect([0, 1, 2, 3].map(p => tableSeat(order, p))).toEqual([0, 2, 3, 1]);
    // The order turns round each round; nobody changes seat.
    const next = [0, 3, 1, 2];
    expect([0, 1, 2, 3].map(p => tableSeat(next, p))).toEqual([0, 2, 3, 1]);
  });

  it('a spectator, or someone not in the game, has no seat', () => {
    expect(tableSeat([0, 1], null)).toBeNull();
    expect(tableSeat([0, 1], 3)).toBeNull();
  });
});
