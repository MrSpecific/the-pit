import { useEffect, useRef, useState } from "react";
import styles from "./ShareCards.module.css";

const SIZE = 1080;
const SITE = "thepit.biz";
const FONT = '"Martian Mono", ui-monospace, "SF Mono", Menlo, monospace';

// Theme tokens mirrored from styles/global.css (canvas can't read CSS vars).
const C = {
  bg: "#050805",
  green: "#2bff88",
  bright: "#8dffbe",
  dim: "#4f8c66",
  text: "#b6f5cd",
  textDim: "#6f9c80",
};

const font = (weight: number, px: number) => `${weight} ${px}px ${FONT}`;

// Whole dollars render clean ($50); fractional keep cents ($12.34).
function formatAmount(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d)
    ? `$${d.toLocaleString("en-US")}`
    : `$${d.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function setTracking(ctx: CanvasRenderingContext2D, px: number) {
  // letterSpacing is widely supported (Safari 16.4+); degrade gracefully.
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${px}px`;
  }
}

function glowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { size: number; weight: number; color: string; blur?: number },
) {
  ctx.font = font(opts.weight, opts.size);
  ctx.fillStyle = opts.color;
  ctx.shadowColor = opts.color;
  ctx.shadowBlur = opts.blur ?? 0;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

// Shrinks the font until `text` fits within `maxWidth`.
function fitSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  maxWidth: number,
  startPx: number,
): number {
  let px = startPx;
  ctx.font = font(weight, px);
  while (ctx.measureText(text).width > maxWidth && px > 24) {
    px -= 4;
    ctx.font = font(weight, px);
  }
  return px;
}

function drawGrid(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(43, 255, 136, 0.05)";
  ctx.lineWidth = 1;
  for (let p = 0; p <= SIZE; p += 60) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
    ctx.stroke();
  }
}

// Vignette + scanlines, drawn last so they sit over the content — the CRT look.
function drawOverlay(ctx: CanvasRenderingContext2D) {
  const g = ctx.createRadialGradient(
    SIZE / 2,
    SIZE / 2,
    SIZE * 0.2,
    SIZE / 2,
    SIZE / 2,
    SIZE * 0.72,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.82)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = "rgba(0,0,0,0.12)";
  for (let y = 0; y < SIZE; y += 4) ctx.fillRect(0, y, SIZE, 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type Design = {
  id: string;
  label: string;
  // Text used when sharing via the native share sheet.
  shareText: (amount: string) => string;
  draw: (ctx: CanvasRenderingContext2D, amount: string) => void;
};

const DESIGNS: Design[] = [
  {
    id: "void",
    label: "The Void",
    shareText: (a) => `I threw ${a} into The Pit and I still feel nothing.`,
    draw: (ctx, amount) => {
      drawGrid(ctx);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";

      setTracking(ctx, 22);
      glowText(ctx, "THE PIT", SIZE / 2, 210, {
        size: 40,
        weight: 600,
        color: C.dim,
      });

      setTracking(ctx, 0);
      const amtSize = fitSize(ctx, amount, 700, 900, 300);
      glowText(ctx, amount, SIZE / 2, 560, {
        size: amtSize,
        weight: 700,
        color: C.bright,
        blur: 46,
      });

      setTracking(ctx, 16);
      glowText(ctx, "INTO THE VOID", SIZE / 2, 660, {
        size: 40,
        weight: 500,
        color: C.green,
        blur: 12,
      });

      setTracking(ctx, 2);
      glowText(ctx, "…and I still", SIZE / 2, 830, {
        size: 52,
        weight: 400,
        color: C.text,
      });
      glowText(ctx, "feel nothing.", SIZE / 2, 900, {
        size: 52,
        weight: 400,
        color: C.text,
      });

      setTracking(ctx, 8);
      glowText(ctx, SITE, SIZE / 2, 1010, {
        size: 28,
        weight: 500,
        color: C.dim,
      });
      drawOverlay(ctx);
    },
  },
  {
    id: "receipt",
    label: "Receipt",
    shareText: (a) =>
      `Transaction complete: ${a} swallowed by The Pit. Refund denied. Feelings: none.`,
    draw: (ctx, amount) => {
      drawGrid(ctx);
      const m = 110;
      const w = SIZE - m * 2;

      ctx.fillStyle = "rgba(4,7,4,0.7)";
      roundRect(ctx, m, m, w, SIZE - m * 2, 6);
      ctx.fill();
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 2;
      ctx.shadowColor = C.green;
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      setTracking(ctx, 4);
      glowText(ctx, "// THE PIT", m + 60, m + 90, {
        size: 34,
        weight: 600,
        color: C.green,
        blur: 10,
      });
      ctx.textAlign = "right";
      glowText(ctx, "REC# VOID", SIZE - m - 60, m + 90, {
        size: 26,
        weight: 400,
        color: C.dim,
      });

      // Divider.
      ctx.strokeStyle = "rgba(50,255,130,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m + 60, m + 130);
      ctx.lineTo(SIZE - m - 60, m + 130);
      ctx.stroke();

      const rows: [string, string][] = [
        ["AMOUNT", amount],
        ["STATUS", "SWALLOWED"],
        ["REFUND", "DENIED"],
        ["FEELINGS", "NONE"],
      ];
      setTracking(ctx, 2);
      let y = m + 240;
      for (const [k, v] of rows) {
        ctx.textAlign = "left";
        glowText(ctx, k, m + 60, y, {
          size: 34,
          weight: 400,
          color: C.textDim,
        });
        ctx.textAlign = "right";
        glowText(ctx, v, SIZE - m - 60, y, {
          size: 40,
          weight: 600,
          color: C.bright,
          blur: 12,
        });
        y += 110;
      }

      // Bottom stamp.
      ctx.strokeStyle = "rgba(50,255,130,0.4)";
      ctx.beginPath();
      ctx.moveTo(m + 60, SIZE - m - 190);
      ctx.lineTo(SIZE - m - 60, SIZE - m - 190);
      ctx.stroke();

      ctx.textAlign = "center";
      setTracking(ctx, 2);
      glowText(ctx, "and I still feel nothing", SIZE / 2, SIZE - m - 120, {
        size: 34,
        weight: 400,
        color: C.text,
      });
      setTracking(ctx, 8);
      glowText(ctx, SITE, SIZE / 2, SIZE - m - 60, {
        size: 26,
        weight: 500,
        color: C.dim,
      });
      drawOverlay(ctx);
    },
  },
  {
    id: "certificate",
    label: "Certificate",
    shareText: (a) =>
      `Certified Void Donor: I surrendered ${a} to nothing at all. ${SITE}`,
    draw: (ctx, amount) => {
      drawGrid(ctx);
      // Double border.
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 2;
      ctx.shadowColor = C.green;
      ctx.shadowBlur = 14;
      ctx.strokeRect(70, 70, SIZE - 140, SIZE - 140);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(50,255,130,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(90, 90, SIZE - 180, SIZE - 180);

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";

      setTracking(ctx, 14);
      glowText(ctx, "CERTIFIED", SIZE / 2, 280, {
        size: 46,
        weight: 600,
        color: C.green,
        blur: 12,
      });
      glowText(ctx, "VOID DONOR", SIZE / 2, 350, {
        size: 46,
        weight: 600,
        color: C.green,
        blur: 12,
      });

      setTracking(ctx, 1);
      glowText(ctx, "for willingly surrendering", SIZE / 2, 500, {
        size: 34,
        weight: 400,
        color: C.textDim,
      });

      setTracking(ctx, 0);
      const amtSize = fitSize(ctx, amount, 700, 760, 200);
      glowText(ctx, amount, SIZE / 2, 660, {
        size: amtSize,
        weight: 700,
        color: C.bright,
        blur: 40,
      });

      setTracking(ctx, 1);
      glowText(ctx, "to nothing at all,", SIZE / 2, 770, {
        size: 34,
        weight: 400,
        color: C.textDim,
      });
      glowText(ctx, "and feeling nothing in return.", SIZE / 2, 820, {
        size: 34,
        weight: 400,
        color: C.textDim,
      });

      setTracking(ctx, 8);
      glowText(ctx, "THE PIT", SIZE / 2, 960, {
        size: 30,
        weight: 600,
        color: C.dim,
      });
      glowText(ctx, SITE, SIZE / 2, 1010, {
        size: 26,
        weight: 500,
        color: C.dim,
      });
      drawOverlay(ctx);
    },
  },
];

export function ShareCards({ amountCents }: { amountCents: number }) {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const [ready, setReady] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);

  const amount = formatAmount(amountCents);

  useEffect(() => {
    // Probe file-sharing support (mobile share sheets, mostly).
    try {
      const probe = new File(["x"], "x.png", { type: "image/png" });
      setCanShareFiles(
        typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [probe] }),
      );
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Martian Mono must be loaded before we paint, or the canvas falls back to
    // a system mono and the layout drifts.
    const weights = [400, 500, 600, 700];
    Promise.all(
      weights.map((w) => document.fonts.load(`${w} 100px "Martian Mono"`)),
    )
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        DESIGNS.forEach((d, i) => {
          const canvas = canvasRefs.current[i];
          const ctx = canvas?.getContext("2d");
          if (ctx) d.draw(ctx, amount);
        });
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [amount]);

  function download(i: number) {
    const canvas = canvasRefs.current[i];
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `the-pit-${DESIGNS[i].id}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  function share(i: number) {
    const canvas = canvasRefs.current[i];
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `the-pit-${DESIGNS[i].id}.png`, {
        type: "image/png",
      });
      try {
        await navigator.share({
          files: [file],
          text: DESIGNS[i].shareText(amount),
          url: `https://${SITE}/`,
        });
      } catch {
        // User dismissed the sheet, or it failed — fall back to a download.
        download(i);
      }
    }, "image/png");
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.prompt}>proof, for the timeline:</p>
      <div className={styles.grid} data-ready={ready}>
        {DESIGNS.map((d, i) => (
          <figure key={d.id} className={styles.card}>
            <canvas
              ref={(el) => {
                canvasRefs.current[i] = el;
              }}
              width={SIZE}
              height={SIZE}
              className={styles.canvas}
              role="img"
              aria-label={`${d.label} share card: ${amount} into The Pit`}
            />
            <figcaption className={styles.actions}>
              {canShareFiles && (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => share(i)}
                >
                  share
                </button>
              )}
              <button
                type="button"
                className={styles.action}
                onClick={() => download(i)}
              >
                download
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
