// Guard against a second tap landing on a control that has just changed under the finger.
//
// The interface redraws in place (morph keeps the same <button> at the same position and swaps
// its label and handler), so a quick double tap on "Roll" could press "Done with actions" with
// the second tap. Every control that sends or commits a move carries an action key (what
// pressing it means). A press is ignored when the key at that position changed less than
// PRESS_WINDOW_MS ago; for the strict controls (primary button, confirm, prompt answers) also
// when the displayed game state advanced less than PRESS_WINDOW_MS ago. Pressing the same,
// unchanged control twice (buying two belts) is allowed. Pure: time is passed in.

export const PRESS_WINDOW_MS = 350;

/** What a position last showed, and since when. */
export interface Seen { readonly key: string; readonly since: number }

/** After a redraw: the control at a position now shows `key`. Keeps the old record if unchanged. */
export function observe(prev: Seen | undefined, key: string, now: number): Seen {
  return prev && prev.key === key ? prev : { key, since: now };
}

export interface PressContext {
  /** Primary button, confirm, prompt answers: also wait out a change of the displayed state. */
  strict: boolean;
  /** When the displayed game state last changed. */
  stateChangedAt: number;
  windowMs?: number;
}

/** May a press on the control showing `key` (last observed as `seen`) go through at `now`? */
export function allowPress(seen: Seen | undefined, key: string, now: number, ctx: PressContext): boolean {
  const w = ctx.windowMs ?? PRESS_WINDOW_MS;
  if (!seen || seen.key !== key) return false;
  if (now - seen.since < w) return false;
  if (ctx.strict && now - ctx.stateChangedAt < w) return false;
  return true;
}
