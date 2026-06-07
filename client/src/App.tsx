import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { Vortex } from "./components/Vortex";
import { MESSAGE_COLUMNS, type PitMessage } from "./types";
import styles from "./App.module.css";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function App() {
  const [messages, setMessages] = useState<PitMessage[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(""); // dollars, as typed
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Load the existing feed, then subscribe for new paid messages. A row is
  // inserted hidden (paid = false) and only becomes visible — to this query and
  // to realtime — once the webhook flips it to paid, so we react to that.
  // Skipped until Supabase is configured (supabase is null otherwise).
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;

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
        setMessages((data ?? []) as PitMessage[]);
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
        setError(data.error ?? `Request failed (${res.status}). Please try again.`);
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
        <Vortex />

        <div className={styles.heroContent}>
          <header className={styles.header}>
            <p className={styles.kicker}>pay what you want</p>
            <span className={styles.kicker}>to</span>
            <h1 className={styles.title}>The Pit</h1>
            <p className={styles.tagline}>
              drop a message into the void
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
              [ drop a message ]
            </button>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.formHeader}>
                <span className={styles.formTitle}>// new message</span>
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

              <div className={styles.field}>
                <label className={styles.label} htmlFor="name">
                  Name
                </label>
                <input
                  id="name"
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  autoComplete="off"
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="message">
                  Message
                </label>
                <textarea
                  id="message"
                  className={styles.textarea}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={500}
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="amount">
                  Amount
                </label>
                <div className={styles.amount}>
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
                    required
                  />
                </div>
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
                {submitting ? "Redirecting…" : "Pay & post"}
              </button>
            </form>
          )}
        </div>

        <a className={styles.scrollHint} href="#feed">
          ▼ the feed
        </a>
      </section>

      <section id="feed" className={styles.feedSection}>
        <h2 className={styles.feedHeading}>// the feed</h2>
        {messages.length === 0 ? (
          <p className={styles.empty}>Nothing in the pit yet.</p>
        ) : (
          <ul className={styles.feed}>
            {messages.map((m) => (
              <li key={m.id} className={styles.entry}>
                <div className={styles.entryHead}>
                  <span className={styles.entryName}>{m.name}</span>
                  <span className={styles.entryAmount}>
                    {usd.format(m.amount_cents / 100)}
                  </span>
                </div>
                <p className={styles.entryBody}>{m.message}</p>
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
