import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import styles from "./Vortex.module.css";

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
const R_MAX = 440; // mouth radius, local units
const SHRINK = 0.88; // ring radius shrinks by this each step inward
const DEPTH = 1500; // how far the throat sits down the axis
const WELL_EXP = 2.2; // >1 curves the profile — flat brim, steep plunge (gravity well)
const TWIST = -0.16; // negative → spokes angle backwards into the well
const HEIGHT_VAR = 0; // per-vertex depth wobble — larger at the rim, ~0 at the throat
const PITCH = (58 * Math.PI) / 180; // view tilt — look down into the pit
const FOCAL = 900; // perspective focal length
const CAM_DIST = 820; // camera distance to the mouth
const SPIN_PERIOD = 70; // seconds per revolution

// Amount-drop animation: a paid amount fades in near the rim, spirals inward
// and down the funnel wall (shrinking with perspective) until it reaches the
// throat and fades out — "sucked into the pit".
const DROP_LIFETIME = 10200; // ms from rim to throat
const DROP_TURNS = 2.8; // revolutions while falling
const DROP_FONT = 10; // label size (viewBox units) at the rim

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
    ring.push({
      x: r * Math.cos(a),
      y: y + amp * noise(k, j),
      z: r * Math.sin(a),
    });
  }
  LOCAL.push(ring);
  RING_OPACITY.push(0.2 + 0.6 * f); // bright rim, fading into the depths
}
const THROAT: Vec3 = { x: 0, y: DEPTH, z: 0 };

const COS_P = Math.cos(PITCH);
const SIN_P = Math.sin(PITCH);

// Project a local 3D point to screen + return the perspective scale, so callers
// (the drop labels) can size themselves with the same foreshortening.
function projectScaled(
  p: Vec3,
  cosT: number,
  sinT: number,
): [number, number, number] {
  const x1 = p.x * cosT + p.z * sinT;
  const z1 = -p.x * sinT + p.z * cosT;
  const y2 = p.y * COS_P - z1 * SIN_P;
  const z2 = p.y * SIN_P + z1 * COS_P;
  const s = FOCAL / (z2 + CAM_DIST);
  return [CX + x1 * s, CY + y2 * s, s];
}

function project(p: Vec3, cosT: number, sinT: number): [number, number] {
  const [x, y] = projectScaled(p, cosT, sinT);
  return [x, y];
}

const fmt = (pts: [number, number][]) =>
  pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

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

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export type VortexHandle = { drop: (amountCents: number) => void };

type Drop = { id: number; label: string; baseAngle: number; start: number };

export const Vortex = forwardRef<VortexHandle>(function Vortex(_props, ref) {
  const ringEls = useRef<(SVGPolygonElement | null)[]>([]);
  const spokeEls = useRef<(SVGPolylineElement | null)[]>([]);
  const dropEls = useRef<Map<number, SVGTextElement | null>>(new Map());
  const dropsRef = useRef<Drop[]>([]);
  const reduceRef = useRef(false);
  const idRef = useRef(0);
  const [drops, setDrops] = useState<Drop[]>([]);

  // Mirror state into a ref so the rAF loop sees the current list without
  // re-subscribing.
  useEffect(() => {
    dropsRef.current = drops;
  }, [drops]);

  useImperativeHandle(
    ref,
    () => ({
      drop(amountCents: number) {
        if (reduceRef.current) return; // respect reduced motion
        const id = ++idRef.current;
        setDrops((prev) => [
          ...prev,
          {
            id,
            label: usd.format(amountCents / 100),
            baseAngle: Math.random() * Math.PI * 2,
            start: performance.now(),
          },
        ]);
      },
    }),
    [],
  );

  useEffect(() => {
    reduceRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceRef.current) return;

    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const theta = (((now - start) / 1000) * (Math.PI * 2)) / SPIN_PERIOD;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const { rings, spokes } = frame(theta);
      for (let k = 0; k < RINGS; k++)
        ringEls.current[k]?.setAttribute("points", rings[k]);
      for (let j = 0; j < SIDES; j++)
        spokeEls.current[j]?.setAttribute("points", spokes[j]);

      // Advance any in-flight amount labels along the funnel wall.
      if (dropsRef.current.length) {
        const done: number[] = [];
        for (const d of dropsRef.current) {
          const t = (now - d.start) / DROP_LIFETIME;
          const el = dropEls.current.get(d.id);
          if (t >= 1) {
            done.push(d.id);
            continue;
          }
          if (!el) continue;
          const e = t * t; // ease-in: slow circling, then sucked into the throat
          const r = R_MAX * (1 - e);
          const f = r / R_MAX;
          const y = DEPTH * (1 - f) ** WELL_EXP; // ride the gravity-well profile
          const ang = d.baseAngle + DROP_TURNS * Math.PI * 2 * t;
          const [sx, sy, s] = projectScaled(
            { x: r * Math.cos(ang), y, z: r * Math.sin(ang) },
            cosT,
            sinT,
          );
          // Fade in at the start, fade out as it nears the throat.
          const op =
            t < 0.06 ? t / 0.06 : t > 0.82 ? Math.max(0, (1 - t) / 0.18) : 1;
          el.setAttribute("x", sx.toFixed(1));
          el.setAttribute("y", sy.toFixed(1));
          el.setAttribute("font-size", (DROP_FONT * s).toFixed(1));
          el.setAttribute("opacity", op.toFixed(2));
        }
        if (done.length)
          setDrops((prev) => prev.filter((d) => !done.includes(d.id)));
      }

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
          style={{ fill: "var(--green-bright)" }}
        />

        {/* Amounts spiralling down into the pit. */}
        {drops.map((d) => (
          <text
            key={d.id}
            ref={(el) => {
              if (el) dropEls.current.set(d.id, el);
              else dropEls.current.delete(d.id);
            }}
            className={styles.amount}
            x={CX}
            y={CY}
            textAnchor="middle"
            opacity={0}
          >
            {d.label}
          </text>
        ))}
      </svg>
    </div>
  );
});
