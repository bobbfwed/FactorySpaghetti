// How the version is shown to players: a large "major.minor" and a small ".patch" with the
// patch number padded to two digits (0.1.1 shows "0.1" and ".01"). The build's commit hash
// (the part after "+") is not shown; save files, replays and reports keep the full string.

import { RULES_VERSION } from '../engine/config';
import { h } from './dom';
import { versionDisplay } from '../session/versionText';

export { versionDisplay };
export type { VersionDisplay } from '../session/versionText';


/**
 * The version as shown: "Version" and a large "0.1" with a small ".01" after it, then "· Rules v0.70" (the rules version, from config). The start
 * menu shows it under the title; the game menus show it small (`cls` 'version-line').
 */
export function versionTag(version: string, cls = 'version-tag', rules: string = RULES_VERSION): HTMLElement {
  const v = versionDisplay(version);
  return h('p', { class: cls, attrs: { 'data-version': v.text, 'data-rules': rules } },
    h('span', { class: 'v-label', text: 'Version' }), ' ',
    h('b', { class: 'v-big', text: v.big }),
    v.small ? h('small', { class: 'v-small', text: v.small }) : null,
    h('span', { class: 'v-sep', text: ' · ', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'v-rules', text: `Rules v${rules}` }));
}

/** The same line as plain text: "Version 0.1.01 · Rules v0.70". */
export function versionLineText(version: string, rules: string = RULES_VERSION): string {
  return `Version ${versionDisplay(version).text} · Rules v${rules}`;
}
