// How the version is shown to players: a large "major.minor" and a small ".patch" with the
// patch number padded to two digits (0.1.1 shows "0.1" and ".01"). The build's commit hash
// (the part after "+") is not shown; save files, replays and reports keep the full string.

import { h } from './dom';

export interface VersionDisplay {
  /** The large part: "0.1", or the whole label when it is not a version number ("dev"). */
  big: string;
  /** The small part: ".01", ".12", or "" when there is none. */
  small: string;
  /** The whole label as one line of text: "0.1.01". */
  text: string;
}

export function versionDisplay(full: string): VersionDisplay {
  const label = full.trim();
  const plus = label.indexOf('+');
  const bare = plus >= 0 ? label.slice(0, plus) : label;
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(bare);
  if (!m) {
    const big = bare || 'dev';
    return { big, small: '', text: big };
  }
  const big = `${Number(m[1])}.${Number(m[2])}`;
  const small = `.${String(Number(m[3])).padStart(2, '0')}${m[4]}`;
  return { big, small, text: big + small };
}

/**
 * The version as shown: "Version" and a large "0.1" with a small ".01" after it. The start
 * menu shows it under the title; the game menus show it small (`cls` 'version-line').
 */
export function versionTag(version: string, cls = 'version-tag'): HTMLElement {
  const v = versionDisplay(version);
  return h('p', { class: cls, attrs: { 'data-version': v.text } },
    h('span', { class: 'v-label', text: 'Version' }), ' ',
    h('b', { class: 'v-big', text: v.big }),
    v.small ? h('small', { class: 'v-small', text: v.small }) : null);
}
