import { useState, type ReactNode } from "react";
import styles from "./Faq.module.css";

// ─── Add / edit FAQs here ───────────────────────────────────────────────────
// Each entry renders as one accordion row. Answers may contain plain text or inline links.
const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "What is The Pit?",
    a: "A pit to throw your money into.",
  },
  // {
  //   q: "Where does my money go?",
  //   a: "Into the void. There are no refunds — only throw in what you're comfortable losing.",
  // },
  {
    q: "Why?",
    a: "Why, indeed?",
  },
  {
    q: "Is it lucky to throw money into The Pit?",
    a: "No.",
  },
  // {
  //   q: "Is my payment secure?",
  //   a: "Payments are handled by Stripe's hosted checkout. We never see your card details.",
  // },
  // {
  //   q: "Do I have to leave a name or message?",
  //   a: "Nope — both are optional. Leave them blank to post anonymously.",
  // },
  // {
  //   q: "What is the point of this?",
  //   a: "The Pit is a little moment of shared experience, a reminder of the passage of time and the impermanence of all things. It's a place to reflect on the past, acknowledge the present, and contemplate the future.",
  // },
  // {
  //   q: "What if I have a problem?",
  //   a: (
  //     <>
  //       If you have any issues with the site or your payment, please contact us
  //       at <a href="mailto:thepitdotbiz@gmail.com">thepitdotbiz@gmail.com</a>.
  //     </>
  //   ),
  // },
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
