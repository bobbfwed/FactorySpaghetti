// Turns guide content into page descriptions (VNode trees). Pure: the viewer turns them into DOM.
// Links and navigation are buttons carrying data attributes ("data-go" = a link target,
// "data-nav" = back / close / contents); the viewer handles every click in one place.

import type { IconName } from '../icons';
import { parseInline, splitTarget } from './inline';
import type { Block, Guide, Topic } from './types';
import type { VChild, VNode } from './vdom';
import { v, vIcon } from './vdom';
import { findTopic, topicOrder } from './content';

export const DETAILS_TITLE = 'How exactly does this work?';

export function renderInline(src: string): VChild[] {
  return parseInline(src).map(p => {
    if (p.kind === 'text') return p.text;
    if (p.kind === 'bold') return v('b', null, p.text);
    return v('button', { class: 'g-link', type: 'button', 'data-go': p.target }, p.text);
  });
}

export function renderBlock(b: Block): VNode {
  switch (b.k) {
    case 'p':
      return v('p', null, renderInline(b.t));
    case 'h':
      return v('h2', { class: 'g-h', ...(b.id ? { 'data-anchor': b.id } : {}) }, renderInline(b.t));
    case 'steps':
      return v('ol', { class: 'g-steps' }, b.items.map(it => v('li', null, renderInline(it))));
    case 'list':
      return v('ul', { class: 'g-list' }, b.items.map(it => v('li', null, renderInline(it))));
    case 'table':
      return v('div', { class: 'g-tablewrap', role: 'region', tabindex: '0', 'aria-label': b.caption ?? b.head.join(', ') },
        v('table', { class: 'g-table' },
          b.caption ? v('caption', null, b.caption) : null,
          v('thead', null, v('tr', null, b.head.map(c => v('th', { scope: 'col' }, renderInline(c))))),
          v('tbody', null, b.rows.map(r => v('tr', null, r.map((c, i) => (i === 0 ? v('th', { scope: 'row' }, renderInline(c)) : v('td', null, renderInline(c)))))))));
    case 'note':
      return v('div', { class: `g-note ${b.tone ?? 'plain'}` },
        b.tone === 'example' ? v('span', { class: 'g-notelabel' }, 'Example') : b.tone === 'tip' ? v('span', { class: 'g-notelabel' }, 'Tip') : null,
        v('p', null, renderInline(b.t)));
    case 'icons':
      return v('ul', { class: 'g-icons' }, b.items.map(it => v('li', null, vIcon(it.icon as IconName), v('span', null, it.label))));
    case 'details':
      // Collapsed until opened: no "open" attribute.
      return v('details', { class: 'g-details' },
        v('summary', null, b.title ?? DETAILS_TITLE),
        v('div', { class: 'g-detailsbody' }, b.blocks.map(renderBlock)));
    case 'change':
      return v('div', { class: 'g-change' },
        v('div', { class: 'g-changetitle' }, renderInline(b.title)),
        v('div', { class: 'g-before' }, v('span', { class: 'g-lab' }, b.beforeLabel ?? 'Before'), v('span', null, renderInline(b.before))),
        v('div', { class: 'g-now' }, v('span', { class: 'g-lab' }, b.nowLabel ?? 'Now'), v('span', null, renderInline(b.now))));
  }
}

/** The table of contents: sections with each topic's title and one-line summary. */
export function renderContents(g: Guide): VNode {
  return v('div', { class: 'g-page g-contents' },
    v('h1', { class: 'g-title', tabindex: '-1' }, 'Game guide'),
    v('p', { class: 'g-lead' }, 'How to play Factory Spaghetti on this screen. Pick a topic; underlined words lead to other topics, and "How exactly does this work?" opens the fine print.'),
    g.sections.map(s => v('section', { class: 'g-sec' },
      v('h2', { class: 'g-sectitle' }, s.title),
      v('ul', { class: 'g-toc' }, s.topics.map(id => {
        const t = findTopic(id, g);
        if (!t) return null;
        return v('li', null, v('button', { class: 'g-tocitem', type: 'button', 'data-go': t.id },
          v('span', { class: 'g-toct' }, t.title), v('span', { class: 'g-tocs' }, t.summary)));
      })))));
}

/** A topic page: title, blocks, related topics, previous / next. */
export function renderTopic(g: Guide, t: Topic): VNode {
  const order = topicOrder(g);
  const i = order.indexOf(t.id);
  const prev = i > 0 ? findTopic(order[i - 1]!, g) : undefined;
  const next = i >= 0 && i < order.length - 1 ? findTopic(order[i + 1]!, g) : undefined;
  const section = g.sections.find(s => s.topics.includes(t.id));
  const see = (t.see ?? []).map(target => {
    const topic = findTopic(splitTarget(target).topic, g);
    return topic ? { target, title: topic.title } : null;
  }).filter((x): x is { target: string; title: string } => x !== null);
  return v('article', { class: 'g-page g-topic', 'data-topic': t.id },
    section ? v('div', { class: 'g-crumb' }, section.title) : null,
    v('h1', { class: 'g-title', tabindex: '-1' }, t.title),
    t.blocks.map(renderBlock),
    see.length ? v('div', { class: 'g-see' }, v('span', { class: 'g-lab' }, 'See also'),
      v('ul', null, see.map(s => v('li', null, v('button', { class: 'g-link', type: 'button', 'data-go': s.target }, s.title))))) : null,
    v('nav', { class: 'g-pager', 'aria-label': 'More topics' },
      prev ? v('button', { class: 'btn btn-dark g-prev', type: 'button', 'data-go': prev.id }, v('span', { class: 'g-dir' }, '← Previous'), v('span', { class: 'g-pt' }, prev.title)) : v('span', null),
      next ? v('button', { class: 'btn btn-dark g-next', type: 'button', 'data-go': next.id }, v('span', { class: 'g-dir' }, 'Next →'), v('span', { class: 'g-pt' }, next.title)) : v('span', null)),
    v('div', { class: 'g-tocback' }, v('button', { class: 'btn btn-quiet', type: 'button', 'data-nav': 'contents' }, vIcon('list'), 'All topics')));
}

/** The compact list of topics shown beside the page on wide screens. */
export function renderSideList(g: Guide, current: string | null): VNode {
  return v('nav', { class: 'g-side', 'aria-label': 'Topics' },
    v('button', { class: `g-sideitem g-sidehome${current === null ? ' on' : ''}`, type: 'button', 'data-nav': 'contents', ...(current === null ? { 'aria-current': 'page' } : {}) }, 'Contents'),
    g.sections.map(s => v('div', { class: 'g-sidesec' },
      v('div', { class: 'g-sidetitle' }, s.title),
      s.topics.map(id => {
        const t = findTopic(id, g);
        if (!t) return null;
        const on = id === current;
        return v('button', { class: `g-sideitem${on ? ' on' : ''}`, type: 'button', 'data-go': id, ...(on ? { 'aria-current': 'page' } : {}) }, t.title);
      }))));
}

/** The page for a stack entry: the contents (null) or a topic (unknown ids fall back to the contents). */
export function renderPage(g: Guide, topic: string | null): VNode {
  const t = topic === null ? undefined : findTopic(topic, g);
  return t ? renderTopic(g, t) : renderContents(g);
}
