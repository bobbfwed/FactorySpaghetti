// The guide viewer's navigation as pure state transitions. A stack of pages: the first is
// always the table of contents; Back pops (and closes the guide from the contents); Close empties it.
// Each page remembers its scroll position, so Back returns to where the reader was.

export interface GuidePage {
  /** null = the table of contents. */
  readonly topic: string | null;
  /** A heading inside the topic to scroll to when the page opens. */
  readonly anchor: string | null;
  /** Scroll position to restore when the page is shown again. */
  readonly scroll: number;
}

export interface GuideState {
  readonly open: boolean;
  readonly stack: readonly GuidePage[];
}

export type GuideEvent =
  | { readonly type: 'open'; readonly topic?: string | null; readonly anchor?: string | null }
  | { readonly type: 'go'; readonly topic: string | null; readonly anchor?: string | null }
  | { readonly type: 'back' }
  | { readonly type: 'close' }
  | { readonly type: 'scroll'; readonly y: number };

export const CLOSED: GuideState = { open: false, stack: [] };

const page = (topic: string | null, anchor: string | null = null): GuidePage => ({ topic, anchor, scroll: 0 });
const CONTENTS = page(null);

export function currentPage(s: GuideState): GuidePage | null {
  return s.stack[s.stack.length - 1] ?? null;
}

export function reduce(s: GuideState, e: GuideEvent): GuideState {
  switch (e.type) {
    case 'open': {
      if (s.open) return e.topic ? reduce(s, { type: 'go', topic: e.topic, anchor: e.anchor ?? null }) : s;
      return { open: true, stack: e.topic ? [CONTENTS, page(e.topic, e.anchor ?? null)] : [CONTENTS] };
    }
    case 'go': {
      if (!s.open) return reduce(s, { type: 'open', topic: e.topic, anchor: e.anchor ?? null });
      const cur = currentPage(s);
      const anchor = e.anchor ?? null;
      // Following a link to the page already shown (without a heading) changes nothing.
      if (cur && cur.topic === e.topic && anchor === null && cur.anchor === null) return s;
      return { open: true, stack: [...s.stack, page(e.topic, anchor)] };
    }
    case 'back': {
      if (!s.open) return s;
      const stack = s.stack.slice(0, -1);
      return stack.length === 0 ? CLOSED : { open: true, stack };
    }
    case 'close':
      return CLOSED;
    case 'scroll': {
      const cur = currentPage(s);
      if (!s.open || !cur || cur.scroll === e.y) return s;
      // The anchor has done its job once the reader scrolls: Back restores the scroll position.
      return { open: true, stack: [...s.stack.slice(0, -1), { ...cur, scroll: e.y, anchor: null }] };
    }
  }
}
