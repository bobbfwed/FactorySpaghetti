// The guide's inline markup: **bold** and [[target|text]] links (target = "topic" or
// "topic#anchor"). Everything else is plain text. Pure: no DOM.

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'link'; readonly target: string; readonly text: string };

const TOKEN = /\*\*(.+?)\*\*|\[\[([^\]|]+)\|([^\]]+)\]\]/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'text', text: src.slice(last, i) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else out.push({ kind: 'link', target: m[2]!.trim(), text: m[3]! });
    last = i + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

/** Every link target in a piece of text. */
export function linkTargets(src: string): string[] {
  return parseInline(src).flatMap(p => (p.kind === 'link' ? [p.target] : []));
}

/** The text without markup (for search, titles, and checks). */
export function plainText(src: string): string {
  return parseInline(src).map(p => p.text).join('');
}

/** "belts#rules" → { topic: 'belts', anchor: 'rules' }. */
export function splitTarget(target: string): { topic: string; anchor: string | null } {
  const i = target.indexOf('#');
  return i < 0 ? { topic: target, anchor: null } : { topic: target.slice(0, i), anchor: target.slice(i + 1) || null };
}
