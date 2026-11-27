// Control Modules below the claim floor. One die is rolled per Mine in play, so with `mineCount`
// Mines the lowest total is `mineCount`: a module numbered below it can never be rolled. Such a
// module can no longer be placed or chosen as an upgrade (the claim floor, RULES.md), and it is
// skipped when counting what a claim costs. One already on a building stays there. Pure, no IO;
// the interface uses it to grey these modules out.

/** True when Control Module `module` is below the claim floor with `mineCount` Mines in play. */
export function moduleBelowFloor(module: number, mineCount: number): boolean {
  return module < mineCount;
}
