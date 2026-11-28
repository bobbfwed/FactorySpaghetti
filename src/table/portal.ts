// The glowing portal on a Teleporter's +X end: a wavy, swirling rainbow disc over the model's round
// recess, with a soft halo just past the rim. It is light, not paint: unlit, the same brightness in
// sun or shadow, and not tone-mapped. The printed piece has a plain swirl relief there; the glow is
// the owner's decision of 2026-11-27 so the portal reads at a glance. The body stays the owner's
// colour (the disc covers only the recess).
//
// One quad, placed in the Teleporter's own model space (layout.ts PORTAL), so it takes exactly the
// same instance matrix as the Teleporter: one InstancedMesh draws every portal on the table in one
// draw call, and the pop-in animation scales it with its Teleporter. A single `uTime` uniform moves
// every swirl; each portal starts at its own phase (from where it stands), so they do not pulse in
// step. The guide's still pictures and the gallery use the same material with a fixed time.

import * as THREE from 'three';
import { PORTAL } from './layout';

/** The time (seconds) used for still pictures and when the player prefers reduced motion. */
export const PORTAL_STILL_TIME = 2.4;
/** How far past the recess's rim the halo reaches, as a share of its radius. */
export const PORTAL_HALO = 1.22;
/** How far in front of the end face the disc floats (mm, model units): no fighting with the face. */
const LIFT = 0.06;

/** What decides whether the portals are redrawn by themselves (table.ts, a few frames a second). */
export interface PortalLoop {
  readonly portals: number;
  /** The page is visible. */
  readonly visible: boolean;
  /** The swirl is to move (the player's setting, or the device's reduced-motion preference). */
  readonly swirl: boolean;
  readonly disposed: boolean;
  readonly contextLost: boolean;
  /** Something covers the whole table (the game guide): nothing of it can be seen. */
  readonly covered: boolean;
}

export function portalsRun(s: PortalLoop): boolean {
  return s.portals > 0 && s.visible && s.swirl && !s.disposed && !s.contextLost && !s.covered;
}

/**
 * The portal quad in the Teleporter's model space: a square facing +X, centred on the recess,
 * large enough for the halo. Its uv runs from -PORTAL_HALO to +PORTAL_HALO across, in units of the
 * recess radius (1 = the rim).
 */
export function portalGeometry(): THREE.BufferGeometry {
  const half = PORTAL.radius * PORTAL_HALO;
  const g = new THREE.PlaneGeometry(half * 2, half * 2, 1, 1);
  // The plane faces +Z; turn it to face +X (its local +X becomes -Z, so the swirl turns the same
  // way whichever side the camera is on; no matter, the swirl has no handedness to keep).
  g.rotateY(Math.PI / 2);
  g.translate(PORTAL.faceX + LIFT, PORTAL.centreY, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 - 1) * PORTAL_HALO, (uv.getY(i) * 2 - 1) * PORTAL_HALO);
  uv.needsUpdate = true;
  return g;
}

const VERTEX = /* glsl */ `
varying vec2 vP;
varying float vSeed;
uniform float uTime;
void main() {
  vP = uv;
  vec4 p = vec4(position, 1.0);
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  m = m * instanceMatrix;
#endif
  // Each portal starts at its own phase, from where it stands on the table.
  vec3 at = m[3].xyz;
  vSeed = fract(sin(dot(at.xz, vec2(12.9898, 78.233))) * 43758.5453) * 40.0;
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vP;
varying float vSeed;
uniform float uTime;
const float TAU = 6.2831853;
vec3 rainbow(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  float r = length(vP);
  if (r > ${PORTAL_HALO.toFixed(3)}) discard;
  float a = atan(vP.y, vP.x);
  float t = uTime + vSeed;
  // A spiral coordinate: the angle, twisted more towards the centre, slowly turning.
  float s = a / TAU + 0.55 * log(r + 0.06) - 0.09 * t;
  // Soft wavy bands along the spiral arms, wobbling in and out.
  float wob = 0.18 * sin(r * 11.0 - t * 1.1) + 0.08 * sin(a * 3.0 + t * 0.7);
  float bands = 0.5 + 0.5 * sin(TAU * (3.0 * s + wob));
  // Hues flow round and along the spiral; luminous rather than inky (a little white in every hue).
  vec3 hue = rainbow(s + 0.25 * r + 0.03 * t);
  vec3 lit = mix(hue, vec3(1.0), 0.28);
  // Bright arms over a softer glow between them.
  vec3 c = lit * (0.62 + 0.5 * bands);
  // A white-hot centre fading out into the swirl.
  c += vec3(1.0, 0.97, 0.9) * exp(-r * r * 9.0) * 1.1;
  // A bright rim, then the halo fading out past it.
  float rim = smoothstep(0.8, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
  c = mix(c, mix(hue, vec3(1.0), 0.55), rim * 0.6);
  if (r <= 1.0) {
    float edge = 1.0 - smoothstep(0.975, 1.0, r);
    gl_FragColor = vec4(min(c, vec3(1.0)) * edge, edge);
  } else {
    float k = (r - 1.0) / (${(PORTAL_HALO - 1).toFixed(3)});
    float glow = (1.0 - k) * (1.0 - k) * 0.7;
    // Additive: alpha 0, so the halo brightens the owner's colour round the rim instead of hiding it.
    gl_FragColor = vec4(mix(rainbow(s + 0.25), vec3(1.0), 0.3) * glow, 0.0);
  }
}
`;

/**
 * The portal's material: unlit, drawn after the opaque pieces, over the end face (premultiplied
 * blending: opaque inside the rim, additive in the halo). Set `uniforms.uTime.value` to animate.
 */
export function portalMaterial(time = PORTAL_STILL_TIME): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'teleporter-portal',
    uniforms: { uTime: { value: time } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
}
