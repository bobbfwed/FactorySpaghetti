// A tiny description of DOM, so the guide's pages can be built (and tested) as plain data and
// turned into elements in one place. Text always becomes text nodes; the only markup inserted
// is the interface's own constant icon SVG.

import type { IconName } from '../icons';
import { icon } from '../icons';

export interface VNode {
  readonly tag: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: readonly VChild[];
}
export type VChild = VNode | string;

/** Anything that may be passed as children: nothing, a child, or (nested) lists of them. */
export type VArg = VChild | null | false | undefined | readonly VArg[];

function flatten(args: readonly VArg[], out: VChild[]): void {
  for (const c of args) {
    if (c === null || c === false || c === undefined) continue;
    if (Array.isArray(c)) flatten(c as readonly VArg[], out);
    else out.push(c as VChild);
  }
}

export function v(tag: string, attrs: Record<string, string> | null, ...children: VArg[]): VNode {
  const kids: VChild[] = [];
  flatten(children, kids);
  return { tag, ...(attrs ? { attrs } : {}), children: kids };
}

/** A small icon from the interface's icon set. */
export const vIcon = (name: IconName): VNode => ({ tag: 'icon', attrs: { name } });

export function toDom(node: VChild): Node {
  if (typeof node === 'string') return document.createTextNode(node);
  if (node.tag === 'icon') return icon((node.attrs?.name ?? 'book') as IconName, undefined, 'ic');
  const el = document.createElement(node.tag);
  for (const [k, val] of Object.entries(node.attrs ?? {})) el.setAttribute(k, val);
  for (const c of node.children ?? []) el.appendChild(toDom(c));
  if (node.tag === 'button' && !el.hasAttribute('type')) el.setAttribute('type', 'button');
  return el;
}

/** Depth-first walk over a tree (for tests and lookups). */
export function walk(node: VChild, fn: (n: VNode) => void): void {
  if (typeof node === 'string') return;
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}

/** All text in a tree, joined. */
export function textOf(node: VChild): string {
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(textOf).join('');
}
