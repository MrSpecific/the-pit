import { useEffect, useRef } from 'react';
import styles from './Vortex.module.css';

// A vector-wireframe funnel, rendered as a real 3D perspective projection.
//
// Rings live in 3D: each shrinks and sinks further down the funnel's axis
// toward a throat, so projecting them to 2D gives genuine depth (a flat,
// CSS-tilted plane can't). Spokes thread each vertex from the rim to the throat
// — the funnel walls. The whole funnel spins about its axis; because every ring
// shares one spin angle, the spokes stay welded to the rings. Points are
// recomputed per frame and written straight to the DOM (no React re-render).
const CX = 500; // projection center (viewBox units)
const CY = 360;
const SIDES = 18; // vertices per ring / number of spokes
const RINGS = 30;
const R_MAX = 410; // mouth radius, local units
const SHRINK = 0.88; // ring radius shrinks by this each step inward
const DEPTH = 1500; // how far the throat sits down the axis
const WELL_EXP = 2.2; // >1 curves the profile — flat brim, steep plunge (gravity well)
const TWIST = -0.16; // negative → spokes angle backwards into the well
const HEIGHT_VAR = 22; // per-vertex depth wobble — larger at the rim, ~0 at the throat
const PITCH = (58 * Math.PI) / 180; // view tilt — look down into the pit
const FOCAL = 900; // perspective focal length
const CAM_DIST = 820; // camera distance to the mouth
const SPIN_PERIOD = 70; // seconds per revolution

type Vec3 = { x: number; y: number; z: number };

// Deterministic per-vertex pseudo-random in [-1, 1), for the height wobble.
const noise = (k: number, j: number) => {
  const n = Math.sin(k * 12.9898 + j * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
};

// Funnel geometry in local space (before spin / view-tilt / projection).
const LOCAL: Vec3[][] = [];
const RING_OPACITY: number[] = [];
for (let k = 0; k < RINGS; k++) {
  const f = SHRINK ** k; // 1 at the rim → 0 toward the throat
  const r = R_MAX * f;
  const y = DEPTH * (1 - f) ** WELL_EXP; // gravity-well curve: flat brim → steep plunge
  const amp = HEIGHT_VAR * f; // wobble fades from the rim inward
  const ring: Vec3[] = [];
  for (let j = 0; j < SIDES; j++) {
    const a = (j / SIDES) * Math.PI * 2 + k * TWIST;
    ring.push({ x: r * Math.cos(a), y: y + amp * noise(k, j), z: r * Math.sin(a) });
  }
  LOCAL.push(ring);
  RING_OPACITY.push(0.2 + 0.6 * f); // bright rim, fading into the depths
}
const THROAT: Vec3 = { x: 0, y: DEPTH, z: 0 };

const COS_P = Math.cos(PITCH);
const SIN_P = Math.sin(PITCH);

function project(p: Vec3, cosT: number, sinT: number): [number, number] {
  // Spin about the funnel axis (Y).
  const x1 = p.x * cosT + p.z * sinT;
  const z1 = -p.x * sinT + p.z * cosT;
  // Tilt the view about X so we look down into the funnel.
  const y2 = p.y * COS_P - z1 * SIN_P;
  const z2 = p.y * SIN_P + z1 * COS_P;
  // Perspective projection.
  const s = FOCAL / (z2 + CAM_DIST);
  return [CX + x1 * s, CY + y2 * s];
}

const fmt = (pts: [number, number][]) =>
  pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function frame(theta: number) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const proj = LOCAL.map((ring) => ring.map((p) => project(p, cosT, sinT)));
  const throat = project(THROAT, cosT, sinT);
  const rings = proj.map(fmt);
  const spokes: string[] = [];
  for (let j = 0; j < SIDES; j++) {
    const line: [number, number][] = [];
    for (let k = 0; k < RINGS; k++) line.push(proj[k][j]);
    line.push(throat);
    spokes.push(fmt(line));
  }
  return { rings, spokes, throat };
}

const INITIAL = frame(0);

export function Vortex() {
  const ringEls = useRef<(SVGPolygonElement | null)[]>([]);
  const spokeEls = useRef<(SVGPolylineElement | null)[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const theta = (((now - start) / 1000) * (Math.PI * 2)) / SPIN_PERIOD;
      const { rings, spokes } = frame(theta);
      for (let k = 0; k < RINGS; k++)
        ringEls.current[k]?.setAttribute('points', rings[k]);
      for (let j = 0; j < SIDES; j++)
        spokeEls.current[j]?.setAttribute('points', spokes[j]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={styles.wrap} aria-hidden="true">
      <svg className={styles.vortex} viewBox="0 0 1000 1000" focusable="false">
        <g className={styles.spokes}>
          {INITIAL.spokes.map((points, j) => (
            <polyline
              key={j}
              ref={(el) => {
                spokeEls.current[j] = el;
              }}
              points={points}
              strokeWidth={1}
            />
          ))}
        </g>

        {INITIAL.rings.map((points, k) => (
          <polygon
            key={k}
            ref={(el) => {
              ringEls.current[k] = el;
            }}
            points={points}
            strokeWidth={1.4}
            opacity={RING_OPACITY[k]}
          />
        ))}

        {/* Glowing throat at the bottom of the funnel. */}
        <circle
          cx={INITIAL.throat[0]}
          cy={INITIAL.throat[1]}
          r={3.5}
          stroke="none"
          style={{ fill: 'var(--green-bright)' }}
        />
      </svg>
    </div>
  );
}
