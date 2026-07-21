import { useEffect, useState } from "react";
import styles from "./ShareCards.module.css";

const SITE = "thepit.biz";

// Whole dollars render clean ($50); fractional keep cents ($12.34).
function formatAmount(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d)
    ? `$${d.toLocaleString("en-US")}`
    : `$${d.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

type Card = {
  id: string;
  /** Poster in /public — 2160x2880 (3:4), copy baked in. */
  src: string;
  /** Describes the poster for screen readers. */
  alt: string;
  // Text used when sharing via the native share sheet; the amount is dynamic
  // even though the image is static.
  shareText: (amount: string) => string;
};

const CARDS: Card[] = [
  {
    id: "crisis",
    src: "/pit-social-01.png",
    alt: "Poster: I'm in the midst of an existential crisis. I just threw money into The Pit. It didn't help. Like at all.",
    shareText: (a) =>
      `I'm in the midst of an existential crisis. I just threw ${a} into The Pit. It didn't help. Like at all.`,
  },
  {
    id: "death",
    src: "/pit-social-02.png",
    alt: "Poster: Am I running from, or towards, death? idk but I just threw money into The Pit.",
    shareText: (a) =>
      `Am I running from, or towards, death? idk but I just threw ${a} into The Pit.`,
  },
  {
    id: "cripto",
    src: "/pit-social-03.png",
    alt: "Poster: The Pit. Faster than cripto.",
    shareText: (a) => `I just threw ${a} into The Pit. Faster than cripto.`,
  },
];

export function ShareCards({ amountCents }: { amountCents: number }) {
  const [loadedCount, setLoadedCount] = useState(0);
  const [canShareFiles, setCanShareFiles] = useState(false);

  const amount = formatAmount(amountCents);
  const ready = loadedCount >= CARDS.length;

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

  // Fetch the poster as a File so it can be downloaded or handed to the
  // native share sheet.
  async function fileFor(card: Card): Promise<File> {
    const res = await fetch(card.src);
    if (!res.ok) throw new Error(`Failed to fetch ${card.src}`);
    const blob = await res.blob();
    return new File([blob], `the-pit-${card.id}.png`, { type: "image/png" });
  }

  async function download(card: Card) {
    try {
      const file = await fileFor(card);
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* fetch failed — nothing to save */
    }
  }

  async function share(card: Card) {
    try {
      const file = await fileFor(card);
      await navigator.share({
        files: [file],
        text: card.shareText(amount),
        url: `https://${SITE}/`,
      });
    } catch (err) {
      // Dismissing the sheet rejects with AbortError — that's a choice, not a
      // failure; don't answer it with a surprise download.
      if (err instanceof DOMException && err.name === "AbortError") return;
      download(card);
    }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.prompt}>proof, for the timeline:</p>
      <div className={styles.grid} data-ready={ready}>
        {CARDS.map((card) => (
          <figure key={card.id} className={styles.card}>
            <img
              src={card.src}
              alt={card.alt}
              className={styles.image}
              loading="eager"
              onLoad={() => setLoadedCount((n) => n + 1)}
              // A failed image still counts, so the grid never stays hidden.
              onError={() => setLoadedCount((n) => n + 1)}
            />
            <figcaption className={styles.actions}>
              {/* With a native share sheet (iOS/Android), the sheet's "Save
                  Image" is the only route into the photo library — <a download>
                  would strand the file in the Files app. Without one (desktop),
                  a plain download is the right behavior. */}
              {canShareFiles ? (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => share(card)}
                >
                  save / share
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => download(card)}
                >
                  download
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      {canShareFiles && (
        <p className={styles.hint}>or long-press a card to save it to your photos</p>
      )}
    </div>
  );
}
