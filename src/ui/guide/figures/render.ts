// Turns a figure block into a page description (VNodes), like the other guide blocks. A 3D picture
// is an empty box of fixed shape carrying its job (data-fig) and fallback icon (data-icon); the
// viewer fills it later (figures/mount.ts). A flat picture is a 'flat' node the DOM step builds.

import type { VChild, VNode } from '../vdom';
import { v } from '../vdom';
import type { FigureJob } from './jobs';
import { BIG_SCALE, ITEM_H, ITEM_W, SCENE_W, modelIcon } from './jobs';
import type { Material } from '../../../engine/config';
import type { Callout, FigIcon, FigureBlock, LineupItem, Pic, PlayExample, SceneSpec } from './types';

const MATERIAL_WORD: Record<Material, string> = { ore: 'Ore', plate: 'Plate', sphere: 'Sphere', tesseract: 'Tesseract' };

type Inline = (src: string) => VChild[];

const sceneSize = (s: SceneSpec): { w: number; h: number } => ({ w: SCENE_W, h: Math.round(SCENE_W / (s.aspect ?? 16 / 9)) });

/** The 3D job of a line-up picture (null for a flat picture). */
export function picJob(pic: Pic, wide = false, big = false): FigureJob | null {
  // A big picture (whole tiles and Mines, where details matter) is drawn 1.5 times larger.
  const k = big ? BIG_SCALE : 1;
  const w = Math.round((wide ? ITEM_W * 2 : ITEM_W) * k);
  const h = Math.round(ITEM_H * k);
  if ('flat' in pic) return null;
  if ('scene' in pic) return { t: 'scene', scene: pic.scene, w, h };
  return {
    t: 'model', model: pic.model, w, h,
    ...(pic.color ? { color: pic.color } : {}),
    ...(pic.numeral !== undefined ? { numeral: pic.numeral } : {}),
    ...(pic.yaw !== undefined ? { yaw: pic.yaw } : {}),
    ...(pic.orElse ? { orElse: pic.orElse } : {}),
  };
}

export function picIcon(pic: Pic): FigIcon | undefined {
  if ('flat' in pic) return undefined;
  if (pic.icon) return pic.icon;
  return 'model' in pic ? modelIcon(pic.model) : undefined;
}

/** An empty picture box of the job's shape, to be drawn into by the viewer. */
function box(job: FigureJob, label: string, icon: FigIcon | undefined, color: string | undefined, extra: Record<string, string> = {}): VNode {
  return v('div', {
    class: `g-pic${job.t === 'scene' && job.w === SCENE_W ? ' g-scene' : ''}`,
    role: 'img',
    'aria-label': label,
    style: `aspect-ratio: ${job.w} / ${job.h}`,
    'data-fig': JSON.stringify(job),
    ...(icon ? { 'data-icon': icon } : {}),
    ...(color ? { 'data-color': color } : {}),
    ...extra,
  });
}

function item(it: LineupItem, inline: Inline): VNode {
  if ('sign' in it) return v('li', { class: 'g-sign', 'aria-hidden': 'true' }, it.sign);
  const pic = it.pic;
  const job = picJob(pic, it.wide, it.big);
  const plain = it.label.replace(/\*\*/g, '');
  const picture = job
    ? box(job, plain, picIcon(pic), 'model' in pic ? pic.color : undefined)
    : v('div', { class: 'g-flat' }, v('flat', { data: JSON.stringify((pic as { flat: unknown }).flat), label: plain }));
  return v('li', { class: `g-litem${it.wide ? ' wide' : ''}${it.big ? ' big' : ''}${job ? '' : ' flat'}` },
    picture,
    it.label ? v('span', { class: 'g-plabel' }, inline(it.label)) : null,
    it.value ? v('span', { class: 'g-pval' }, inline(it.value)) : null);
}

/** The legend under a scene: each marker once, with its explanation. */
function legend(callouts: readonly Callout[], inline: Inline): VNode | null {
  const seen = new Set<string>();
  const rows = callouts.filter(c => (seen.has(c.mark) ? false : (seen.add(c.mark), true)));
  if (!rows.length) return null;
  return v('ol', { class: 'g-legend' }, rows.map(c => v('li', null, v('span', { class: `g-mark${markTone(c.mark)}`, 'aria-hidden': 'true' }, c.mark), v('span', null, inline(c.text)))));
}

/**
 * An animated example: the picture (filled and played by figures/playMount.ts), the side panel,
 * the controls, and every step's caption in a numbered list from the start (the order, like the
 * printed rulebook shows it). Without the player the list and the captions still read on their own.
 */
function renderPlay(b: FigureBlock, ex: PlayExample, inline: Inline): VNode {
  const aspect = ex.aspect ?? 16 / 9;
  const h = Math.round(SCENE_W / aspect);
  const btn = (pc: string, label: string, text: string): VNode =>
    v('button', { class: `btn btn-dark g-pbtn g-p${pc}`, type: 'button', 'data-pc': pc, 'aria-label': label }, text);
  return v('figure', { class: 'g-fig g-play', 'data-play': JSON.stringify(ex) },
    v('div', { class: 'g-pic g-scene g-playpic', role: 'img', 'aria-label': b.alt, style: `aspect-ratio: ${SCENE_W} / ${h}` }),
    ex.side ? v('div', { class: 'g-pside', 'aria-hidden': 'true' }) : null,
    v('div', { class: 'g-pbar', role: 'group', 'aria-label': 'Example controls', hidden: '' },
      btn('primary', 'Play the example', 'Play'), btn('prev', 'Previous step', 'Previous'), btn('next', 'Next step', 'Next')),
    v('ol', { class: 'g-psteps' }, ex.steps.map((s, i) => v('li', { class: 'g-pstep', 'data-step': String(i) },
      v('span', { class: 'g-pnum', 'aria-hidden': 'true' }, String(i + 1)),
      v('span', { class: 'g-ptext' }, inline(s.caption),
        legendOf(s.callouts, i).length ? v('span', { class: 'g-pmarks' }, legendOf(s.callouts, i).map(c => v('span', { class: 'g-pmark' },
          v('span', { class: `g-mark${markTone(c.mark)}`, 'aria-hidden': 'true' }, c.mark), ' ', inline(c.text)))) : null)))),
    b.caption ? v('figcaption', { class: 'g-figcap' }, inline(b.caption)) : null,
    v('div', { class: 'g-sr', 'aria-live': 'polite' }));
}

/** A step's markers that need a word under its caption: one numbered as the step itself needs none. */
function legendOf(callouts: readonly Callout[] | undefined, i: number): readonly Callout[] {
  return (callouts ?? []).filter(c => c.mark !== String(i + 1));
}

/** ✓ and ✗ markers are drawn green and red. */
export const markTone = (mark: string): string => (mark === '✓' ? ' ok' : mark === '✗' ? ' no' : '');

export function renderFigure(b: FigureBlock, inline: Inline): VNode {
  const caption = b.caption ? v('figcaption', { class: 'g-figcap' }, inline(b.caption)) : null;
  if (b.show.kind === 'lineup') {
    return v('figure', { class: 'g-fig g-fig-lineup' },
      v('ul', { class: 'g-lineup', 'aria-label': b.alt }, b.show.items.map(it => item(it, inline))),
      caption);
  }
  if (b.show.kind === 'recipe') {
    const r = b.show;
    const mini = (m: Material): VNode => box(picJob({ model: m })!, '', modelIcon(m), undefined, { class: 'g-pic g-mini', 'aria-hidden': 'true', role: 'presentation' });
    return v('figure', { class: 'g-fig g-recipe' },
      v('div', { class: 'g-rhead' },
        box(picJob({ model: r.factory })!, r.name, picIcon({ model: r.factory }), undefined),
        v('div', { class: 'g-rname' }, v('b', null, r.name), r.note ? v('span', { class: 'g-pval' }, inline(r.note)) : null)),
      v('ul', { class: 'g-rrows', 'aria-label': b.alt }, r.inputs.map(set => v('li', { 'aria-label': `${set.map(m => MATERIAL_WORD[m]).join(' + ')} → ${MATERIAL_WORD[r.product]}` },
        set.flatMap((m, i) => (i ? [v('span', { class: 'g-sign', 'aria-hidden': 'true' }, '+'), mini(m)] : [mini(m)])),
        v('span', { class: 'g-sign g-arrow', 'aria-hidden': 'true' }, '→'),
        mini(r.product)))),
      caption);
  }
  if (b.show.kind === 'play') return renderPlay(b, b.show.play, inline);
  const { scene, callouts = [] } = b.show;
  const { w, h } = sceneSize(scene);
  const job: FigureJob = { t: 'scene', scene, w, h, ...(callouts.length ? { marks: callouts.map(c => c.at) } : {}) };
  return v('figure', { class: 'g-fig g-fig-scene' },
    box(job, b.alt, b.show.icon, undefined, callouts.length ? { 'data-marks': JSON.stringify(callouts.map(c => c.mark)) } : {}),
    legend(callouts, inline),
    caption);
}
