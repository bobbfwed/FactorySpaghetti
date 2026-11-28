// The guide's pictures: the figure block renders the expected structure; every picture names only
// models in public/models/manifest.json and icons that exist;
// every staged scene is legal under the engine's rules; the cache draws each picture once and a
// picture that cannot be drawn falls back quietly.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { CONTROL_MODULE_MAX, FACTORY_RECIPES, MAX_CLAIMS_PER_BUILDING } from '../../../engine/config';
import { applyPlaceBelt, resolveDirectAdjacency } from '../../../engine/rules/flow';
import { isAdjacentToBoard, isCoordsOccupied, mineSecondaryCoord } from '../../../engine/rules/pieces';
import { canLoadMaterial } from '../../../engine/rules/recipes';
import type { GameState, Material } from '../../../engine/state';
import { ICON_NAMES } from '../../icons';
import { GUIDE } from '../content';
import { freeSpaces } from '../content/figures';
import { FigureCache, jobKey, modelPlan, type FigureJob, type FigureRenderer, type Rendered } from '../figures/jobs';
import { picIcon, renderFigure } from '../figures/render';
import { sceneState } from '../figures/scene';
import { OPTIONAL_MODELS, type CalloutAt, type FigureBlock, type FigModel, type Pic, type SceneSpec } from '../figures/types';
import type { Block } from '../types';
import type { VNode } from '../vdom';
import { textOf, walk } from '../vdom';

const manifest = JSON.parse(readFileSync(new URL('../../../../public/models/manifest.json', import.meta.url), 'utf8')) as { models: { name: string }[] };
const MODELS = new Set(manifest.models.map(m => m.name));

function figuresIn(blocks: readonly Block[]): FigureBlock[] {
  return blocks.flatMap(b => (b.k === 'figure' ? [b] : b.k === 'details' ? figuresIn(b.blocks) : []));
}
const FIGURES = GUIDE.topics.flatMap(t => figuresIn(t.blocks).map(f => ({ topic: t.id, f })));

function pics(f: FigureBlock): Pic[] {
  return f.show.kind === 'lineup' ? f.show.items.flatMap(it => ('pic' in it ? [it.pic] : [])) : [];
}

/** Every scene in a figure, with the markers placed on it. */
function scenes(f: FigureBlock): { scene: SceneSpec; marks: readonly CalloutAt[] }[] {
  if (f.show.kind === 'scene') return [{ scene: f.show.scene, marks: (f.show.callouts ?? []).map(c => c.at) }];
  return pics(f).flatMap(p => ('scene' in p ? [{ scene: p.scene, marks: [] }] : 'model' in p && p.orElse ? [{ scene: p.orElse, marks: [] }] : []));
}

function models(f: FigureBlock): FigModel[] {
  if (f.show.kind === 'recipe') return [f.show.factory, ...f.show.inputs.flat(), f.show.product];
  return pics(f).flatMap(p => ('model' in p ? [p.model] : []));
}

const find = (root: VNode, pred: (n: VNode) => boolean): VNode[] => {
  const out: VNode[] = [];
  walk(root, n => { if (pred(n)) out.push(n); });
  return out;
};
const byClass = (root: VNode, cls: string): VNode[] => find(root, n => (n.attrs?.class ?? '').split(' ').includes(cls));
const inline = (s: string): string[] => [s];

describe('the figure block', () => {
  it('renders a line-up: a box per 3D picture with its job, shape and label, flat pictures, signs and the caption', () => {
    const f: FigureBlock = {
      k: 'figure', alt: 'Ore becomes a Plate', caption: 'A caption.',
      show: { kind: 'lineup', items: [{ pic: { model: 'ore' }, label: 'Ore', value: 'Value 1' }, { sign: '→' }, { pic: { flat: { k: 'die', n: 3 } }, label: 'Die' }, { pic: { model: 'mine-1' }, label: 'Mine', wide: true }] },
    };
    const node = renderFigure(f, inline);
    expect(node.tag).toBe('figure');
    const list = find(node, n => n.tag === 'ul')[0]!;
    expect(list.attrs?.['aria-label']).toBe('Ore becomes a Plate');
    const boxes = byClass(node, 'g-pic');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.attrs?.role).toBe('img');
    expect(boxes[0]!.attrs?.['aria-label']).toBe('Ore');
    expect(boxes[0]!.attrs?.['data-icon']).toBe('ore');
    expect(boxes[0]!.attrs?.style).toMatch(/aspect-ratio: \d+ \/ \d+/);
    const job = JSON.parse(boxes[0]!.attrs!['data-fig']!) as FigureJob;
    expect(job).toMatchObject({ t: 'model', model: 'ore' });
    const wide = JSON.parse(boxes[1]!.attrs!['data-fig']!) as FigureJob;
    expect(wide.w).toBe(job.w * 2);
    expect(find(node, n => n.tag === 'flat')).toHaveLength(1);
    expect(byClass(node, 'g-sign').map(textOf)).toEqual(['→']);
    expect(byClass(node, 'g-pval').map(textOf)).toEqual(['Value 1']);
    expect(find(node, n => n.tag === 'figcaption').map(textOf)).toEqual(['A caption.']);
  });

  it('renders a scene with its alt text, markers to place and a legend with each marker once', () => {
    const f: FigureBlock = {
      k: 'figure', alt: 'A Mine', caption: 'The Mine.',
      show: {
        kind: 'scene', scene: { pieces: [{ id: 'm', type: 'mine', q: 0, r: 0 }], aspect: 2 },
        callouts: [{ mark: '1', at: { piece: 'm', slot: 0 }, text: 'One' }, { mark: '✗', at: { piece: 'm', slot: 1 }, text: 'No' }, { mark: '✗', at: { piece: 'm', point: 3 }, text: 'No' }],
      },
    };
    const node = renderFigure(f, inline);
    const [box] = byClass(node, 'g-pic');
    expect(box!.attrs?.role).toBe('img');
    expect(box!.attrs?.['aria-label']).toBe('A Mine');
    expect(JSON.parse(box!.attrs!['data-marks']!)).toEqual(['1', '✗', '✗']);
    const job = JSON.parse(box!.attrs!['data-fig']!) as Extract<FigureJob, { t: 'scene' }>;
    expect(job.marks).toHaveLength(3);
    expect(job.w / job.h).toBeCloseTo(2, 1);
    const legend = find(node, n => n.tag === 'ol')[0]!;
    expect(legend.children).toHaveLength(2);
    expect(byClass(legend, 'no')).toHaveLength(1);
  });

  it('renders a recipe: the factory and one row per set of inputs, each row described in words', () => {
    const f: FigureBlock = { k: 'figure', alt: 'Sphere Factory', show: { kind: 'recipe', factory: 'tile-sphere-factory', name: 'Sphere Factory', inputs: [['ore', 'plate'], ['plate', 'plate']], product: 'sphere' } };
    const node = renderFigure(f, inline);
    const rows = find(node, n => n.tag === 'li');
    expect(rows.map(r => r.attrs?.['aria-label'])).toEqual(['Ore + Plate → Sphere', 'Plate + Plate → Sphere']);
    expect(byClass(node, 'g-mini')).toHaveLength(6);
    expect(find(node, n => n.tag === 'figcaption')).toHaveLength(0);
  });
});

describe('the guide\'s pictures', () => {
  it('has pictures in every topic that describes things on the table', () => {
    const withPictures = new Set(FIGURES.map(x => x.topic));
    for (const id of ['goal', 'table', 'screen', 'starting', 'turn', 'step-place', 'step-roll', 'step-actions', 'step-meeple', 'round-end',
      'claiming', 'production', 'factories', 'moving', 'belts', 'teleporters', 'bank', 'cards', 'mines', 'bonuses', 'winning']) {
      expect(withPictures, id).toContain(id);
    }
    const sceneCount = new Set(FIGURES.filter(x => x.f.show.kind === 'scene').map(x => x.f)).size;
    expect(sceneCount).toBeGreaterThanOrEqual(6);
    expect(sceneCount).toBeLessThanOrEqual(10);
  });

  it('gives every picture alt text, and a caption unless it is a single card or a recipe', () => {
    for (const { topic, f } of FIGURES) {
      expect(f.alt.length, topic).toBeGreaterThan(5);
      const named = f.show.kind === 'recipe' || (f.show.kind === 'lineup' && f.show.items.length === 1);
      if (!named) expect(f.caption?.length ?? 0, `${topic}: ${f.alt}`).toBeGreaterThan(10);
    }
  });

  it('names only models in public/models and icons that exist', () => {
    const bad: string[] = [];
    for (const { topic, f } of FIGURES) {
      for (const m of models(f)) if (!MODELS.has(m) && !OPTIONAL_MODELS.has(m)) bad.push(`${topic}: model ${m}`);
      const icons = [...pics(f).map(picIcon), f.show.kind === 'scene' ? f.show.icon : undefined].filter(Boolean) as string[];
      for (const i of icons) if (!(ICON_NAMES as string[]).includes(i)) bad.push(`${topic}: icon ${i}`);
      for (const p of pics(f)) if ('model' in p && OPTIONAL_MODELS.has(p.model) && !p.orElse && !p.icon) bad.push(`${topic}: ${p.model} has no stand-in`);
    }
    expect(bad).toEqual([]);
  });

  it('shows every factory\'s recipes exactly as the engine has them', () => {
    const recipes = FIGURES.flatMap(x => (x.f.show.kind === 'recipe' ? [x.f.show] : []));
    expect(recipes).toHaveLength(3);
    for (const r of recipes) {
      const type = ({ 'tile-plate-factory': 'plateFact', 'tile-sphere-factory': 'sphereFact', 'tile-tesseract-factory': 'tesseractFact' } as const)[r.factory as 'tile-plate-factory'];
      expect(r.inputs).toEqual(FACTORY_RECIPES[type]!.inputs);
      expect(r.product).toBe(FACTORY_RECIPES[type]!.product);
    }
  });
});

/** Everything the rules say about a staged scene; returns the problems found. */
function sceneProblems(spec: SceneSpec, marks: readonly CalloutAt[]): string[] {
  const out: string[] = [];
  let s: GameState;
  try { s = sceneState(spec); } catch (e) { return [`does not build: ${String(e)}`]; }
  const cells = new Map<string, string>();
  for (const p of s.board) {
    const own = [p.coord, ...(p.type === 'mine' ? [mineSecondaryCoord(p.coord, p.rotation ?? 0)] : [])];
    for (const c of own) {
      const k = `${c.q},${c.r}`;
      if (cells.has(k)) out.push(`${p.id} overlaps ${cells.get(k)}`);
      cells.set(k, p.id);
    }
  }
  if (s.board.length > 1) {
    for (const p of s.board) {
      const others = s.board.filter(o => o !== p);
      const own = [p.coord, ...(p.type === 'mine' ? [mineSecondaryCoord(p.coord, p.rotation ?? 0)] : [])];
      if (!own.some(c => isAdjacentToBoard(c, others))) out.push(`${p.id} touches no other piece`);
    }
  }
  const used = new Map<number, Set<number>>();
  for (const p of s.board) {
    if (p.claims.length && (p.type === 'blank' || p.type === 'mine')) out.push(`${p.id}: a ${p.type} cannot be claimed`);
    for (const c of p.claims) {
      if (c.controlModule < 1 || c.controlModule > CONTROL_MODULE_MAX) out.push(`${p.id}: no Control Module ${c.controlModule}`);
      const mine = used.get(c.ownerId) ?? new Set();
      if (mine.has(c.controlModule)) out.push(`${p.id}: player ${c.ownerId} has only one module ${c.controlModule}`);
      mine.add(c.controlModule);
      used.set(c.ownerId, mine);
    }
    const per = new Map<number, number>();
    for (const c of p.claims) per.set(c.ownerId, (per.get(c.ownerId) ?? 0) + 1);
    for (const [pl, n] of per) if (n > MAX_CLAIMS_PER_BUILDING) out.push(`${p.id}: player ${pl} has ${n} modules on it`);
    // Inputs: each material could have gone in, one after another; outputs hold the product.
    if (p.input && p.type !== 'mine') {
      let slots: (Material | null)[] = p.input.slots.map(() => null);
      for (const m of p.input.slots) {
        if (!m) continue;
        if (!canLoadMaterial(p.type, slots, m)) out.push(`${p.id}: ${m} cannot be in its input`);
        const i = slots.indexOf(null);
        slots = slots.map((x, j) => (j === i ? m : x));
      }
      if (p.input.slots.some(Boolean) && !p.claims.length) out.push(`${p.id}: only a claimed building receives material`);
    }
    if (p.output && p.type !== 'mine') {
      for (const m of p.output.slots) if (m && m !== FACTORY_RECIPES[p.type]?.product) out.push(`${p.id}: makes no ${m}`);
    }
    for (const b of [p.input, p.output]) {
      if (b?.teleporters.some(o => o != null && !p.claims.some(c => c.ownerId === o))) out.push(`${p.id}: teleporter on a building its owner has not claimed`);
    }
  }
  // Meeples: on a Mine point (one each) or on a building of their own.
  const spots = new Set<string>();
  for (const pl of s.players) {
    if (!pl.meepleOnPieceId) continue;
    const p = s.board.find(x => x.id === pl.meepleOnPieceId);
    if (!p) { out.push(`meeple on missing piece ${pl.meepleOnPieceId}`); continue; }
    if (p.type === 'mine') {
      const k = `${p.id}:${pl.meepleSlotIndex}`;
      if (spots.has(k)) out.push(`two meeples on ${k}`);
      spots.add(k);
    } else if (!p.claims.some(c => c.ownerId === pl.id)) out.push(`meeple of ${pl.id} on a building it has not claimed`);
  }
  // Belts: each one laid through the engine, in order; the illegal examples refused for the stated reason.
  let st: GameState = { ...s, belts: [] };
  for (const [i, b] of s.belts.entries()) {
    const spec_ = spec.belts?.[i];
    const r = applyPlaceBelt({ ...st, activePlayerIndex: st.turnOrder.indexOf(b.ownerId), mineBeltPlacedThisTurn: false }, { type: 'PLACE_BELT', pieceId: b.pieceId, fromPoint: b.fromPoint, toPoint: b.toPoint });
    if (spec_?.illegal) {
      if (r.ok || r.error.code !== spec_.illegal) out.push(`belt ${b.id} should be refused with ${spec_.illegal}`);
      st = { ...st, belts: [...st.belts, b] };
    } else if (!r.ok) {
      out.push(`belt ${b.id}: ${r.error.code}`);
    } else {
      st = { ...r.state, players: st.players };
    }
  }
  // Settled: moving material again changes nothing.
  if (spec.settled !== false) {
    const after = resolveDirectAdjacency(s);
    if (JSON.stringify(after.board) !== JSON.stringify(s.board)) out.push('material would still move');
  }
  // Glowing spaces are exactly where a piece may go; a previewed piece sits on one.
  const glowCells = (spec.glow?.at ?? []).filter((g): g is { q: number; r: number } => 'q' in g);
  for (const g of glowCells) if (isCoordsOccupied(g, s.board) || !isAdjacentToBoard(g, s.board)) out.push(`glow on (${g.q},${g.r}) where no piece can go`);
  if (glowCells.length && glowCells.length !== freeSpaces(spec.pieces ?? []).length) out.push('not every free space glows');
  if (spec.ghost && !glowCells.some(g => g.q === spec.ghost!.q && g.r === spec.ghost!.r)) out.push('the previewed piece is not on a glowing space');
  // Markers point at things that exist.
  for (const m of marks) {
    if ('q' in m) continue;
    const p = s.board.find(x => x.id === m.piece);
    if (!p) { out.push(`marker on missing piece ${m.piece}`); continue; }
    if ('buffer' in m && !(m.buffer === 'input' ? p.input : p.output)) out.push(`${p.id} has no ${m.buffer}`);
    if ('slot' in m && !('teleporter' in m) && p.type !== 'mine') out.push(`${p.id} has no meeple point`);
    if ('belt' in m && !s.belts.filter(b => b.pieceId === p.id)[m.belt]) out.push(`${p.id} has no belt ${m.belt}`);
    if ('teleporter' in m && (m.teleporter === 'input' ? p.input : p.output)?.teleporters[m.slot ?? 0] == null) out.push(`${p.id} has no teleporter on its ${m.teleporter}`);
    if ('point' in m && (m.point < 0 || m.point >= (p.type === 'mine' ? 24 : 12))) out.push(`${p.id} has no point ${m.point}`);
  }
  return out;
}

describe('the staged scenes', () => {
  const all = FIGURES.flatMap(({ topic, f }) => scenes(f).map(x => ({ topic, ...x })));

  it('are all legal under the engine\'s rules', () => {
    expect(all.length).toBeGreaterThan(6);
    const bad = all.flatMap(({ topic, scene, marks }) => sceneProblems(scene, marks).map(p => `${topic}: ${p}`));
    expect(bad).toEqual([]);
  });

  it('catch an illegal scene (the checks themselves work)', () => {
    const spec: SceneSpec = {
      pieces: [
        { id: 'a', type: 'blank', q: 0, r: 0, claims: [[0, 3]] },
        { id: 'f', type: 'sphereFact', q: 5, r: 5, claims: [[0, 3]], input: ['ore', 'ore'] },
      ],
      belts: [{ piece: 'a', a: 0, b: 1 }],
      meeples: [{ player: 1, piece: 'f' }],
    };
    const p = sceneProblems(spec, [{ piece: 'a', buffer: 'input' }]).join('\n');
    for (const expected of ['touches no other piece', 'cannot be claimed', 'only one module 3', 'ore cannot be in its input', 'POINTS_TOO_CLOSE', 'meeple of 1', 'a has no input']) {
      expect(p).toContain(expected);
    }
  });

  it('builds the real starting board for the set-up picture, with every player\'s two first claims', () => {
    const s = sceneState({ setup: { seed: 7, players: 3, claims: true } });
    expect(s.board.filter(p => p.type === 'mine')).toHaveLength(1);
    expect(s.board.flatMap(p => p.claims)).toHaveLength(6);
    expect(s.board.flatMap(p => p.claims.map(c => `${p.type}:${c.controlModule}`)).sort()).toEqual(
      ['plateFact:3', 'plateFact:3', 'plateFact:3', 'powerPlant:2', 'powerPlant:2', 'powerPlant:2']);
  });
});

describe('drawing pictures', () => {
  const job = (model: FigModel): FigureJob => ({ t: 'model', model, w: 150, h: 112 });
  const fake = (out: (j: FigureJob) => Rendered | null | Promise<Rendered | null>): FigureRenderer & { calls: FigureJob[]; disposed: number } => {
    const r = {
      calls: [] as FigureJob[], disposed: 0,
      render: async (j: FigureJob): Promise<Rendered | null> => { r.calls.push(j); return out(j); },
      dispose: (): void => { r.disposed++; },
    };
    return r;
  };

  it('draws each picture once, one at a time, with one renderer', async () => {
    const r = fake(j => ({ url: `blob:${jobKey(j)}`, marks: [] }));
    const make = vi.fn(async () => r);
    const cache = new FigureCache(make);
    const [a, b, c] = await Promise.all([cache.get(job('ore')), cache.get(job('ore')), cache.get(job('plate'))]);
    expect(a).toBe(b);
    expect(c?.url).toContain('plate');
    expect(await cache.get(job('ore'))).toBe(a);
    expect(r.calls.map(j => (j as { model: string }).model)).toEqual(['ore', 'plate']);
    expect(make).toHaveBeenCalledTimes(1);
    expect(cache.renders).toBe(2);
  });

  it('falls back quietly: no WebGL, a failing model, or a throwing renderer give null, never an error or a log line', async () => {
    const spies = (['log', 'warn', 'error'] as const).map(k => vi.spyOn(console, k));
    const none = new FigureCache(async () => null);
    expect(await none.get(job('ore'))).toBeNull();
    const failing = new FigureCache(async () => fake(j => { if ((j as { model: string }).model === 'plate') throw new Error('lost'); return null; }));
    expect(await failing.get(job('plate'))).toBeNull();
    expect(await failing.get(job('ore'))).toBeNull();
    const broken = new FigureCache(async () => { throw new Error('no context'); });
    expect(await broken.get(job('ore'))).toBeNull();
    for (const s of spies) { expect(s).not.toHaveBeenCalled(); s.mockRestore(); }
  });

  it('draws a model the manifest lists, a stand-in scene for one it does not, and the icon without either', () => {
    const tp: Extract<FigureJob, { t: 'model' }> = { t: 'model', model: 'teleporter', w: 150, h: 112, orElse: { pieces: [{ id: 'f', type: 'plateFact', q: 0, r: 0, claims: [[0, 3]], tpOut: 0 }] } };
    expect(modelPlan(tp, new Set(['teleporter']))).toBe('model');
    expect(modelPlan(tp, MODELS.has('teleporter') ? new Set() : MODELS)).toBe('orElse');
    expect(modelPlan({ t: 'model', model: 'teleporter', w: 150, h: 112 }, new Set())).toBe('none');
    expect(picIcon({ model: 'teleporter' })).toBe('teleporter');
  });

  it('gives the WebGL context back after a quiet spell or when the guide closes, and draws again after', async () => {
    const timers: (() => void)[] = [];
    const r = fake(() => ({ url: 'blob:x', marks: [] }));
    const make = vi.fn(async () => r);
    const cache = new FigureCache(make, { setTimer: (fn): number => { timers.push(fn); return timers.length; }, clearTimer: (): void => undefined });
    await cache.get(job('ore'));
    await Promise.resolve();
    expect(timers.length).toBeGreaterThan(0);
    timers[timers.length - 1]!();
    await new Promise(res => setTimeout(res, 0));
    expect(r.disposed).toBe(1);
    await cache.get(job('plate'));
    expect(make).toHaveBeenCalledTimes(2);
    cache.release();
    await new Promise(res => setTimeout(res, 0));
    expect(r.disposed).toBe(2);
  });
});
