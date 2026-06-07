import styles from './Vortex.module.css';

// A vector-wireframe vortex: concentric polygon rings that shrink and twist
// toward a glowing core, with spokes connecting successive rings into spiraling
// tunnel walls. Pure geometry — computed once at render.
const CENTER = 500;
const MAX_R = 470;
const SIDES = 18; // vertices per ring
const SHRINK = 0.82; // each ring is this fraction of the previous
const TWIST_DEG = 9; // extra rotation per ring inward → the swirl

type Point = [number, number];

function ringPoints(radius: number, rotationDeg: number): Point[] {
  const rot = (rotationDeg * Math.PI) / 180;
  return Array.from({ length: SIDES }, (_, j): Point => {
    const a = rot + (j / SIDES) * Math.PI * 2;
    return [CENTER + radius * Math.cos(a), CENTER + radius * Math.sin(a)];
  });
}

export function Vortex() {
  const rings: { pts: Point[]; opacity: number }[] = [];
  for (let r = MAX_R, i = 0; r > 6; r *= SHRINK, i++) {
    rings.push({
      pts: ringPoints(r, i * TWIST_DEG),
      // Brighter at the rim, fading into the dark center.
      opacity: 0.16 + 0.62 * (r / MAX_R),
    });
  }

  return (
    <div className={styles.wrap} aria-hidden="true">
      <svg
        className={styles.vortex}
        viewBox="0 0 1000 1000"
        focusable="false"
      >
        <g>
          {/* Spokes: connect vertex j of each ring to the next ring inward. */}
          {rings.slice(0, -1).map((ring, idx) =>
            ring.pts.map(([x, y], j) => {
              const [nx, ny] = rings[idx + 1].pts[j];
              return (
                <line
                  key={`s${idx}-${j}`}
                  x1={x}
                  y1={y}
                  x2={nx}
                  y2={ny}
                  strokeWidth={1}
                  opacity={ring.opacity * 0.5}
                />
              );
            }),
          )}
          {/* The rings themselves. */}
          {rings.map((ring, idx) => (
            <polygon
              key={`r${idx}`}
              points={ring.pts.map((p) => p.join(',')).join(' ')}
              strokeWidth={1.4}
              opacity={ring.opacity}
            />
          ))}
          {/* Glowing core at the bottom of the pit. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={3.5}
            stroke="none"
            style={{ fill: 'var(--green-bright)' }}
          />
        </g>
      </svg>
    </div>
  );
}
