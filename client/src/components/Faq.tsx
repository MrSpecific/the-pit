import { useState } from "react";
import styles from "./Faq.module.css";

// ─── Add / edit FAQs here ───────────────────────────────────────────────────
// Each entry renders as one accordion row. Answers may contain plain text.
const FAQS: { q: string; a: string }[] = [
  {
    q: "What is The Pit?",
    a: "The pit accepts your tribute. Leave your name and a message for posterity, if you like.",
  },
  {
    q: "Where does my money go?",
    a: "Into the void. There are no refunds — only throw in what you're comfortable losing.",
  },
  {
    q: "Is my payment secure?",
    a: "Payments are handled by Stripe's hosted checkout. We never see your card details.",
  },
  {
    q: "Do I have to leave a name or message?",
    a: "Nope — both are optional. Leave them blank to post anonymously.",
  },
];
// ─────────────────────────────────────────────────────────────────────────────

const EyeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export function Faq() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="FAQ">
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>// faq</span>
            <button
              type="button"
              className={styles.close}
              onClick={() => setOpen(false)}
              aria-label="Close FAQ"
              title="Close"
            >
              [×]
            </button>
          </div>
          <div className={styles.items}>
            {FAQS.map((item) => (
              <details key={item.q} className={styles.item}>
                <summary className={styles.question}>{item.q}</summary>
                <p className={styles.answer}>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        aria-label={open ? "Close FAQ" : "Open FAQ"}
        title="FAQ"
      >
        <EyeIcon />
        faq
      </button>
    </>
  );
}
