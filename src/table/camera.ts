// Orthographic "isometric" camera looking down at the table, with animated moves.
// State: a target point on the table, an azimuth (turns in 60-degree steps), an elevation
// (45 degrees, or 90 for top-down) and a scale in millimetres per CSS pixel.

import * as THREE from 'three';
import type { Bounds } from './layout';

const DIST = 4000;
export const ISO_ELEVATION = Math.PI / 4;
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

  setTopDown(on: boolean): void {
    this.animateTo({ el: on ? TOP_ELEVATION : ISO_ELEVATION });
  }

  get topDown(): boolean { return (this.tween ? this.tween.to.el : this.view.el) > 1.4; }

  /** Frame the given table area (a height `top` above the table is included for stacks). */
  frame(b: Bounds, animate: boolean, top = 30, margin = 1.08): void {
    const goal = this.tween ? this.tween.to : this.view;
    const fitted = this.fitView(b, goal.az, goal.el, top, margin);
    if (animate) this.animateTo(fitted, 480);
    else { this.tween = null; this.view = fitted; this.apply(); }
  }

  private fitView(b: Bounds, az: number, el: number, top: number, margin: number): View {
    // Camera axes for this azimuth/elevation.
    const { right, up } = axes(az, el);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, top]) {
      const dx = x - cx, dz = z - cz;
      const u = dx * right.x + y * right.y + dz * right.z;
      const v = dx * up.x + y * up.y + dz * up.z;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const scale = clamp(Math.max((maxU - minU) / this.width, (maxV - minV) / this.height) * margin, MIN_SCALE, MAX_SCALE);
    // Shift the target so the box centre lands mid-screen: a move of d along the ground "forward"
    // direction shifts screen v by d * sin(el).
    const du = (minU + maxU) / 2, dv = (minV + maxV) / 2;
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
