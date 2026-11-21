// Public interface of the 3D table (milestone N5: read-only table with picking hooks; N8: animated
// transitions and the pure playback queue / transition planner that drive them).

export type { PlayerColor, Target, Ghost, Table, TableOptions, TableStats, ViewInsets, RouteTier, RouteSegment, Preview } from './types';
export { revealedStack } from './layout';
export { PLAYER_COLOR_HEX } from './types';
export { createTable } from './table';
export type { AnimStep, StepBody, TransitionPlan, Carried, SoundName } from './transition';
export { planTransition, isTableStep, soundOf } from './transition';
export type { AnimSpeed, PlayCommand, PlayItem, Stamp } from './playback';
export { Playback, snapReason, SPEED_FACTOR, LAG_CAP_MS, URGENT_CAP_MS } from './playback';
