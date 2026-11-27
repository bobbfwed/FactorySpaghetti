// The game guide's content model. Content is plain data (see content/), turned into DOM by
// render.ts. Text strings may carry two kinds of inline markup, read by inline.ts:
//   **bold**                 bold text
//   [[topic|link text]]      a link to another topic
//   [[topic#anchor|text]]    a link to a heading (or card) inside a topic
// Nothing else is parsed: no HTML, no markdown library.

import type { FigureBlock } from './figures/types';

/** A small picture from the interface's own icon set. */
export type GuideIcon = 'ore' | 'plate' | 'sphere' | 'tess' | 'power' | 'card' | 'mine' | 'belt' | 'teleporter' | 'meeple' | 'dice' | 'exchange' | 'book';

export type Block =
  /** A paragraph. */
  | { readonly k: 'p'; readonly t: string }
  /** A sub-heading; `id` makes it a link target ("topic#id"). */
  | { readonly k: 'h'; readonly t: string; readonly id?: string }
  /** A numbered list. */
  | { readonly k: 'steps'; readonly items: readonly string[] }
  /** A bulleted list. */
  | { readonly k: 'list'; readonly items: readonly string[] }
  /** A small table; wide tables scroll inside their own box. */
  | { readonly k: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly caption?: string }
  /** A boxed note: a tip, an example, or a warning. */
  | { readonly k: 'note'; readonly t: string; readonly tone?: 'tip' | 'example' | 'warn' }
  /** A row of small pictures with labels. */
  | { readonly k: 'icons'; readonly items: readonly { readonly icon: GuideIcon; readonly label: string }[] }
  /** "How exactly does this work?": collapsed until the reader opens it. */
  | { readonly k: 'details'; readonly title?: string; readonly blocks: readonly Block[] }
  /** One rule as it was and as it is now. */
  | { readonly k: 'change'; readonly title: string; readonly before: string; readonly now: string; readonly beforeLabel?: string; readonly nowLabel?: string }
  /** A picture drawn from the game's own pieces (figures/types.ts). */
  | FigureBlock;

export interface Topic {
  /** Unique, used in links ("belts", "cards#sinkHole"). */
  readonly id: string;
  readonly title: string;
  /** One line for the table of contents. */
  readonly summary: string;
  readonly blocks: readonly Block[];
  /** Related topics, listed at the end of the page. */
  readonly see?: readonly string[];
}

/** A group of topics in the table of contents. */
export interface Section {
  readonly title: string;
  readonly topics: readonly string[];
}

export interface Guide {
  readonly sections: readonly Section[];
  readonly topics: readonly Topic[];
}

/** One rule change in a release, written for players. */
export interface RuleChange {
  readonly title: string;
  readonly before: string;
  readonly now: string;
  /** Where the guide explains the rule as it is now. */
  readonly see?: string;
}

/** One release of the game. New releases go at the top of the list. */
export interface Release {
  /** "0.1.2" */
  readonly version: string;
  readonly summary: string;
  readonly rules: readonly RuleChange[];
  /** Interface changes worth knowing, one line each. */
  readonly interface?: readonly string[];
}

/** One way this version plays differently from the printed rulebook. */
export interface PrintedDifference {
  readonly title: string;
  readonly printed: string;
  readonly here: string;
  readonly see?: string;
}

export interface PrintedGroup {
  /** Link target inside the "printed" topic. */
  readonly id: string;
  readonly subject: string;
  readonly items: readonly PrintedDifference[];
}
