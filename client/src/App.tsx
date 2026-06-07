import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { Vortex, type VortexHandle } from "./components/Vortex";
import { MESSAGE_COLUMNS, type PitMessage } from "./types";
import styles from "./App.module.css";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const NAME_MAX = 80;
const MSG_MAX = 500;
const SUGGESTED = [1, 5, 10, 20, 50, 100]; // dollar quick-picks

export function App() {
  const [messages, setMessages] = useState<PitMessage[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(""); // dollars, as typed
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const vortex = useRef<VortexHandle>(null);
  // Ids we've already shown, so realtime fires the pit animation only for
  // genuinely new arrivals (not the initial load or in-place updates).
  const knownIds = useRef<Set<string>>(new Set());

  // Load the existing feed, then subscribe for new paid messages. A row is
  // inserted hidden (paid = false) and only becomes visible — to this query and
  // to realtime — once the webhook flips it to paid, so we react to that.
  // Skipped until Supabase is configured (supabase is null otherwise).
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    client
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("paid", true)
      .order("paid_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(error.message);
          return;
        }
        const rows = (data ?? []) as PitMessage[];
        rows.forEach((m) => knownIds.current.add(m.id));
        setMessages(rows);

        // Seed the pit with the most recent amounts, staggered with a large
        // semi-random gap so arrivals feel organic rather than synchronized.
        let delay = 600;
        rows.slice(0, 5).forEach((m) => {
          timers.push(
            setTimeout(() => {
              if (active) vortex.current?.drop(m.amount_cents);
            }, delay),
          );
          delay += 1800 + Math.random() * 2800;
        });
      });

    const channel = client
      .channel("public:messages")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as
            | (PitMessage & { paid?: boolean; refunded_at?: string | null })
            | null;
          const old = payload.old as { id?: string } | null;
          const id = row?.id ?? old?.id;
          if (!id) return;
          // A row belongs in the feed only while it's paid and not refunded;
          // otherwise (refund, delete, un-publish) drop it.
          const visible =
            payload.eventType !== "DELETE" &&
            row?.paid === true &&
            !row.refunded_at;
          if (visible) {
            // First time we've seen this paid message → drop it into the pit.
            if (!knownIds.current.has(id)) {
              knownIds.current.add(id);
              vortex.current?.drop((row as PitMessage).amount_cents);
            }
          } else {
            knownIds.current.delete(id);
          }
          setMessages((prev) => {
            if (!visible) return prev.filter((m) => m.id !== id);
            if (prev.some((m) => m.id === id))
              return prev.map((m) => (m.id === id ? (row as PitMessage) : m));
            return [row as PitMessage, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      timers.forEach(clearTimeout);
      client.removeChannel(channel);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    const amountCents = Math.round(dollars * 100);

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, message, amountCents }),
      });
      // The server should return JSON, but on an unexpected failure it may not
      // — so parse defensively and fall back to the HTTP status.
      let data: { url?: string; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON response */
      }
      if (!res.ok || !data.url) {
        setError(
          data.error ?? `Request failed (${res.status}). Please try again.`,
        );
        setSubmitting(false);
        return;
      }
      // Hand off to Stripe's hosted Checkout.
      window.location.href = data.url;
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
    }
  }

  function randomizeAmount() {
    // A playful random pledge between $1.00 and $100000.00.
    setAmount((Math.random() * 99999 + 1).toFixed(2));
  }

  // Minimal handling of the Stripe redirect targets (success_url / cancel_url).
  const path = window.location.pathname;
  const banner =
    path === "/checkout/success"
      ? "Payment received — your message drops in below once Stripe confirms it."
      : path === "/checkout/cancel"
        ? "Checkout canceled. You were not charged."
        : null;

  return (
    <>
      <section className={styles.hero}>
        <Vortex ref={vortex} />

        <div className={styles.heroContent}>
          <header className={styles.header}>
            <p className={styles.kicker}>throw your money</p>
            <span className={styles.kicker}>into</span>
            <h1 className={styles.title}>The Pit</h1>
            <p className={styles.tagline}>
              how much money will <span className={styles.italic}>you</span>{" "}
              throw in the pit?
              <span className={styles.cursor} aria-hidden="true" />
            </p>
          </header>

          {banner && (
            <p className={styles.banner} role="status">
              {banner} <a href="/">[back]</a>
            </p>
          )}

          {!formOpen ? (
            <button
              type="button"
              className={styles.openButton}
              aria-expanded={false}
              onClick={() => setFormOpen(true)}
            >
              [ throw money ]
            </button>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.formHeader}>
                <span className={styles.formTitle}>// burn money</span>
                <button
                  type="button"
                  className={styles.minimize}
                  onClick={() => setFormOpen(false)}
                  aria-label="Minimize"
                  title="Minimize"
                >
                  [–]
                </button>
              </div>

              {/* Amount — the lead control. */}
              <div className={styles.amountField}>
                <label className={styles.label} htmlFor="amount">
                  How much?
                </label>
                <div className={styles.amountBig}>
                  <span className={styles.amountSign} aria-hidden="true">
                    $
                  </span>
                  <input
                    id="amount"
                    className={styles.amountInput}
                    type="number"
                    min="1"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className={styles.amountControls}>
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={styles.chip}
                      onClick={() => setAmount(String(s))}
                    >
                      ${s}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={randomizeAmount}
                  >
                    ⚲ random
                  </button>
                </div>
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="name">
                    Name <span className={styles.counter}>(optional)</span>
                  </label>
                  <span
                    className={`${styles.counter} ${
                      name.length >= NAME_MAX ? styles.counterMax : ""
                    }`}
                  >
                    {name.length}/{NAME_MAX}
                  </span>
                </div>
                <input
                  id="name"
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                />
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="message">
                    Message <span className={styles.counter}>(optional)</span>
                  </label>
                  <span
                    className={`${styles.counter} ${
                      message.length >= MSG_MAX ? styles.counterMax : ""
                    }`}
                  >
                    {message.length}/{MSG_MAX}
                  </span>
                </div>
                <textarea
                  id="message"
                  className={styles.textarea}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={MSG_MAX}
                />
              </div>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <button
                className={styles.submit}
                type="submit"
                disabled={submitting}
              >
                {submitting ? "Redirecting…" : "THROW YOUR MONEY INTO THE VOID"}
              </button>
            </form>
          )}
        </div>

        <a className={styles.scrollHint} href="#feed">
          ▼ the feed
        </a>
      </section>

      <section id="feed" className={styles.feedSection}>
        <h2 className={styles.feedHeading}>// the pit feed</h2>
        {messages.length === 0 ? (
          <p className={styles.empty}>Nothing in the pit yet.</p>
        ) : (
          <ul className={styles.feed}>
            {messages.map((m) => (
              <li key={m.id} className={styles.entry}>
                <div className={styles.entryHead}>
                  <span className={styles.entryName}>
                    {m.name || "anonymous"}
                  </span>
                  <span className={styles.entryAmount}>
                    {usd.format(m.amount_cents / 100)}
                  </span>
                </div>
                {m.message && <p className={styles.entryBody}>{m.message}</p>}
                <time className={styles.entryTime}>
                  {new Date(m.paid_at ?? m.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
