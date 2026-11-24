// Orthographic "isometric" camera looking down at the table, with animated moves.
// State: a target point on the table, an azimuth (turns in 60-degree steps), an elevation
// (45 degrees, or 90 for top-down) and a scale in millimetres per CSS pixel.

import * as THREE from 'three';
import { VIEW_ELEVATION, type Bounds } from './layout';

const DIST = 4000;
export const ISO_ELEVATION = VIEW_ELEVATION;
const TOP_ELEVATION = Math.PI / 2 - 1e-4;
const MIN_SCALE = 0.04;
const MAX_SCALE = 6;

interface View { tx: number; tz: number; az: number; el: number; scale: number }

interface Tween { from: View; to: View; start: number; dur: number }

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, DIST * 3);
  private view: View = { tx: 0, tz: 0, az: 0, el: ISO_ELEVATION, scale: 1 };
  private tween: Tween | null = null;
  private width = 1;
  private height = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor() { this.apply(); }

  get azimuth(): number { return this.view.az; }
  /** Millimetres of table per CSS pixel. */
  get scale(): number { return this.view.scale; }
  get targetAzimuth(): number { return this.tween ? this.tween.to.az : this.view.az; }
  get elevation(): number { return this.view.el; }
  get animating(): boolean { return this.tween !== null; }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.apply();
  }

  /** Advance the animation; returns true while still moving. */
  update(now: number): boolean {
    if (!this.tween) return false;
    const t = Math.min(1, (now - this.tween.start) / this.tween.dur);
    const k = ease(t);
    const a = this.tween.from, b = this.tween.to;
    this.view = {
      tx: a.tx + (b.tx - a.tx) * k,
      tz: a.tz + (b.tz - a.tz) * k,
      az: a.az + (b.az - a.az) * k,
      el: a.el + (b.el - a.el) * k,
      scale: a.scale * Math.pow(b.scale / a.scale, k),
    };
    if (t >= 1) {
      this.view = { ...b, az: normAngle(b.az) };
      this.tween = null;
    }
    this.apply();
    return this.tween !== null;
  }

  private animateTo(to: Partial<View>, dur = 420): void {
    const from = { ...this.view };
    const target = { ...(this.tween ? this.tween.to : this.view), ...to };
    this.tween = { from, to: target, start: performance.now(), dur };
  }

  rotateBy(steps: number): void {
    // Positive steps turn the table clockwise as seen from above (the camera moves anticlockwise).
    this.animateTo({ az: this.targetAzimuth - steps * Math.PI / 3 });
  }

  /** Look from azimuth `az` (radians), the short way round when animated. */
  turnTo(az: number, animate: boolean): void {
    const from = this.targetAzimuth;
    const t = Math.PI * 2;
    let d = ((az - from) % t + t) % t;
    if (d > Math.PI) d -= t;
    if (animate) this.animateTo({ az: from + d });
    else { this.tween = null; this.view = { ...this.view, az: normAngle(az) }; this.apply(); }
  }

  setTopDown(on: boolean): void {
    this.animateTo({ el: on ? TOP_ELEVATION : ISO_ELEVATION });
  }

  get topDown(): boolean { return (this.tween ? this.tween.to.el : this.view.el) > 1.4; }

  /** Screen area covered by HTML (CSS px from each edge); framing fits into the rest. */
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Framing never zooms out further than this (millimetres per CSS pixel). */
  private frameMaxScale = MAX_SCALE;

  setInsets(insets: { top: number; right: number; bottom: number; left: number }, maxScale = MAX_SCALE): void {
    const c = (v: number): number => Math.max(0, Number.isFinite(v) ? v : 0);
    this.insets = { top: c(insets.top), right: c(insets.right), bottom: c(insets.bottom), left: c(insets.left) };
    this.frameMaxScale = clamp(maxScale, MIN_SCALE, MAX_SCALE);
  }

  /**
   * Frame the given table area (a height `top` above the table is included for stacks), keeping
   * the rotation. `noZoomIn`: never closer than the camera is going to be already (automatic
   * re-frames only ever zoom out).
   */
  frame(b: Bounds, animate: boolean, top = 30, margin = 1.08, noZoomIn = false): void {
    const goal = this.tween ? this.tween.to : this.view;
    const fitted = this.fitView(b, goal.az, goal.el, top, margin, noZoomIn ? goal.scale : 0);
    if (animate) this.animateTo(fitted, 480);
    else { this.tween = null; this.view = fitted; this.apply(); }
  }

  /**
   * Whether area `b` (up to height `top`) lies inside the free part of the screen (the canvas less
   * the insets, less `marginPx`) with the camera where it is going (the end of any animation).
   */
  boxVisible(b: Bounds, top = 0, marginPx = 4): boolean {
    const v = this.tween ? this.tween.to : this.view;
    const { right, up } = axes(v.az, v.el);
    const ins = this.insets;
    const l = ins.left + marginPx, r = this.width - ins.right - marginPx;
    const t = ins.top + marginPx, btm = this.height - ins.bottom - marginPx;
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, top]) {
      const dx = x - v.tx, dz = z - v.tz;
      const sx = this.width / 2 + (dx * right.x + y * right.y + dz * right.z) / v.scale;
      const sy = this.height / 2 - (dx * up.x + y * up.y + dz * up.z) / v.scale;
      if (sx < l || sx > r || sy < t || sy > btm) return false;
    }
    return true;
  }

  /** Whether area `b` could be framed whole without zooming out past the framing limit. */
  boxFits(b: Bounds, top = 0, margin = 1.08): boolean {
    const v = this.tween ? this.tween.to : this.view;
    return this.fitScale(b, v.az, v.el, top, margin) <= this.frameMaxScale;
  }

  /** The free area between the insets, its size and the offset of its centre from the canvas centre. */
  private freeArea(): { freeW: number; freeH: number; offX: number; offY: number } {
    const ins = this.insets;
    // The free area between the insets; if panels leave less than 30 % of the canvas, a 30 % area
    // around the free area's own centre (kept on the canvas) is used instead.
    const span = (lo: number, hi: number, size: number): [number, number] => {
      const min = size * 0.3;
      if (hi - lo >= min) return [lo, hi];
      const a = clamp((lo + hi) / 2 - min / 2, 0, size - min);
      return [a, a + min];
    };
    const [fl, fr] = span(ins.left, this.width - ins.right, this.width);
    const [ft, fb] = span(ins.top, this.height - ins.bottom, this.height);
    // Where the free area's centre sits relative to the canvas centre (CSS px, y down).
    return { freeW: fr - fl, freeH: fb - ft, offX: (fl - (this.width - fr)) / 2, offY: (ft - (this.height - fb)) / 2 };
  }

  /** Box extent on screen (table mm along the camera's right and up axes) around the box centre. */
  private extent(b: Bounds, az: number, el: number, top: number): { minU: number; maxU: number; minV: number; maxV: number } {
    const { right, up } = axes(az, el);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, top]) {
      const dx = x - cx, dz = z - cz;
      const u = dx * right.x + y * right.y + dz * right.z;
      const v = dx * up.x + y * up.y + dz * up.z;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    return { minU, maxU, minV, maxV };
  }

  private fitScale(b: Bounds, az: number, el: number, top: number, margin: number): number {
    const { freeW, freeH } = this.freeArea();
    const e = this.extent(b, az, el, top);
    return Math.max((e.maxU - e.minU) / freeW, (e.maxV - e.minV) / freeH) * margin;
  }

  private fitView(b: Bounds, az: number, el: number, top: number, margin: number, minScale = 0): View {
    const { offX, offY } = this.freeArea();
    const { minU, maxU, minV, maxV } = this.extent(b, az, el, top);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const fit = this.fitScale(b, az, el, top, margin);
    // Never closer than minScale (an automatic re-frame does not zoom in), and the framing limit
    // never zooms in past where the camera already is either.
    const scale = clamp(Math.max(Math.min(fit, Math.max(this.frameMaxScale, minScale)), minScale), MIN_SCALE, MAX_SCALE);
    // Shift the target so the box centre lands in the middle of the free area: a move of d along
    // the ground "forward" direction shifts screen v by d * sin(el).
    const du = (minU + maxU) / 2 - offX * scale, dv = (minV + maxV) / 2 + offY * scale;
    const fwd = { x: -Math.sin(az), z: -Math.cos(az) };
    const rgt = { x: Math.cos(az), z: -Math.sin(az) };
    const s = Math.max(0.2, Math.sin(el));
    return { tx: cx + rgt.x * du + fwd.x * (dv / s), tz: cz + rgt.z * du + fwd.z * (dv / s), az, el, scale };
  }

  /** Pan so that the table point under screen point a moves to screen point b. */
  panPixels(ax: number, ay: number, bx: number, by: number): void {
    const p = this.groundAt(ax, ay), q = this.groundAt(bx, by);
    if (!p || !q) return;
    this.cancelTweenKeepingRotation();
    this.view.tx += p.x - q.x;
    this.view.tz += p.z - q.z;
    this.apply();
  }

  /** Zoom by factor (>1 zooms in) keeping the table point under (px, py) fixed on screen. */
  zoomAt(px: number, py: number, factor: number): void {
    const before = this.groundAt(px, py);
    this.cancelTweenKeepingRotation();
    this.view.scale = clamp(this.view.scale / factor, MIN_SCALE, MAX_SCALE);
    this.apply();
    const after = this.groundAt(px, py);
    if (before && after) {
      this.view.tx += before.x - after.x;
      this.view.tz += before.z - after.z;
      this.apply();
    }
  }

  private cancelTweenKeepingRotation(): void {
    // A user pan/zoom stops a framing animation but lets a rotation or tilt finish.
    if (this.tween) {
      const to = this.tween.to;
      this.tween = (to.az !== this.tween.from.az || to.el !== this.tween.from.el)
        ? { ...this.tween, from: { ...this.view }, to: { ...to, tx: this.view.tx, tz: this.view.tz, scale: this.view.scale }, start: performance.now() }
        : null;
    }
  }

  /** Point on the table plane (height y) under canvas-relative CSS pixel (px, py). */
  groundAt(px: number, py: number, y = 0): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1), this.camera);
    this.plane.constant = -y;
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  ray(px: number, py: number): THREE.Ray {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1), this.camera);
    return this.raycaster.ray.clone();
  }

  /** World point to canvas-relative CSS pixels. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height };
  }

  private apply(): void {
    const { tx, tz, az, el, scale } = this.view;
    const cam = this.camera;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    cam.position.set(tx + dir.x * DIST, dir.y * DIST, tz + dir.z * DIST);
    cam.up.set(-Math.sin(az), 0, -Math.cos(az)); // screen-up on the table; valid for every elevation
    cam.lookAt(tx, 0, tz);
    const hw = (this.width / 2) * scale, hh = (this.height / 2) * scale;
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
    cam.near = 1; cam.far = DIST * 3;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}

function axes(az: number, el: number): { right: THREE.Vector3; up: THREE.Vector3 } {
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  return { right, up };
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function normAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
