import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "./lib/supabase";
import { Vortex, type VortexHandle } from "./components/Vortex";
import { Faq } from "./components/Faq";
import { ShareCards } from "./components/ShareCards";
import { useAudio } from "./lib/audio";
import { MESSAGE_COLUMNS, type PitMessage } from "./types";
import styles from "./App.module.css";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Whole-dollar formatter for the running total headline.
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Dev-only preview: `?preview=success` (optionally `&amount=<dollars>`) forces
// the post-checkout success state — share cards included — with no real Stripe
// round-trip. Returns the amount in cents, or null (always null in prod builds).
const PREVIEW_AMOUNT_CENTS: number | null = (() => {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") !== "success") return null;
  const dollars = Number(params.get("amount"));
  return Math.round(
    (Number.isFinite(dollars) && dollars > 0 ? dollars : 50) * 100,
  );
})();

const NAME_MAX = 80;
const MSG_MAX = 500;
const SUGGESTED = [1, 5, 10, 20, 50, 100]; // dollar quick-picks
const PAGE_SIZE = 20; // feed rows fetched per page

// Animates a displayed number toward `target` (ease-out). Counts up from 0 on
// load and from the current value on each live increment.
function useCountUp(target: number, duration = 1400): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const v = Math.round(from + (target - from) * eased);
      fromRef.current = v;
      setValue(v);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

export function App() {
  const [messages, setMessages] = useState<PitMessage[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(""); // dollars, as typed
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0); // total cents fed to the pit
  // Post-checkout state, seeded from the Stripe redirect path.
  const [checkout, setCheckout] = useState<null | "success" | "cancel">(() => {
    if (PREVIEW_AMOUNT_CENTS !== null) return "success";
    const p = window.location.pathname;
    return p === "/checkout/success"
      ? "success"
      : p === "/checkout/cancel"
        ? "cancel"
        : null;
  });
  const [confirmed, setConfirmed] = useState<{ amount: number } | null>(
    PREVIEW_AMOUNT_CENTS !== null ? { amount: PREVIEW_AMOUNT_CENTS } : null,
  );
  const animatedTotal = useCountUp(total);
  const audio = useAudio();

  const vortex = useRef<VortexHandle>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  // Ids we've already shown, so realtime fires the pit animation only for
  // genuinely new arrivals (not the initial load or in-place updates).
  const knownIds = useRef<Set<string>>(new Set());
  // Mirror of `messages` for the paginator's cursor (avoids stale closures).
  const messagesRef = useRef<PitMessage[]>([]);
  const loadingMore = useRef(false);
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Load the first page, then subscribe for new paid messages. A row is
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
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(error.message);
          return;
        }
        const rows = (data ?? []) as PitMessage[];
        rows.forEach((m) => knownIds.current.add(m.id));
        setMessages(rows);
        setHasMore(rows.length === PAGE_SIZE);

        // Seed the pit with the most recent amounts, staggered with a large
        // semi-random gap so arrivals feel organic rather than synchronized.
        let delay = 600;
        rows.slice(0, 8).forEach((m) => {
          timers.push(
            setTimeout(() => {
              if (!active) return;
              vortex.current?.drop(m.amount_cents);
              audio.blip(); // no-op unless the visitor has enabled sound
            }, delay),
          );
          delay += 1800 + Math.random() * 3800;
        });
      });

    // Full running total across all paid, non-refunded messages.
    client.rpc("pit_total").then(({ data, error }) => {
      if (active && !error) setTotal(Number(data) || 0);
    });

    const channel = client
      .channel("public:messages")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload) => {
          console.debug(
            "[the-pit] realtime change:",
            payload.eventType,
            payload.new,
          );
          const row = payload.new as
            | (PitMessage & { paid?: boolean; refunded_at?: string | null })
            | null;
          const old = payload.old as {
            id?: string;
            amount_cents?: number;
          } | null;
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
            // (The feed entry animates itself in via CSS on mount.)
            if (!knownIds.current.has(id)) {
              knownIds.current.add(id);
              vortex.current?.drop((row as PitMessage).amount_cents);
              audio.blip();
              setTotal((t) => t + (row as PitMessage).amount_cents);
            }
          } else {
            knownIds.current.delete(id);
            // Refund/removal — pull its amount back out of the running total.
            const amt = row?.amount_cents ?? old?.amount_cents;
            if (amt) setTotal((t) => Math.max(0, t - amt));
          }
          setMessages((prev) => {
            if (!visible) return prev.filter((m) => m.id !== id);
            if (prev.some((m) => m.id === id))
              return prev.map((m) => (m.id === id ? (row as PitMessage) : m));
            return [row as PitMessage, ...prev];
          });
        },
      )
      .subscribe((status, err) => {
        // Surface the channel lifecycle: SUBSCRIBED means we're listening.
        // CHANNEL_ERROR / TIMED_OUT means the subscription itself failed
        // (realtime auth, RLS, or the table not in the publication) — in that
        // case no postgres_changes ever arrive, silently, without this log.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[the-pit] realtime subscribe failed:", status, err);
        } else {
          console.debug("[the-pit] realtime status:", status);
        }
      });

    return () => {
      active = false;
      timers.forEach(clearTimeout);
      // Remove synchronously so a remount (React StrictMode double-invokes
      // effects in dev) gets a fresh channel. Deferring this would let the next
      // mount reuse the same still-subscribed channel by topic, and adding the
      // postgres_changes listener to it again throws. The one-time "WebSocket
      // closed before connection established" warning this can print in dev is
      // harmless and never happens in production (no double-invoke there).
      client.removeChannel(channel);
    };
  }, []);

  // Infinite scroll: fetch the next page using the oldest loaded paid_at as a
  // cursor (robust against realtime items prepended at the top).
  const loadMore = useCallback(async () => {
    if (!supabase || loadingMore.current) return;
    const list = messagesRef.current;
    const cursor = list.length ? list[list.length - 1].created_at : null;
    if (!cursor) return;
    loadingMore.current = true;
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("paid", true)
      .lt("created_at", cursor)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    loadingMore.current = false;
    if (error || !data) return;
    const rows = data as PitMessage[];
    rows.forEach((m) => knownIds.current.add(m.id));
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...rows.filter((m) => !seen.has(m.id))];
    });
    if (rows.length < PAGE_SIZE) setHasMore(false);
  }, []);

  // Callback ref on the bottom sentinel: (re)wire the observer whenever it
  // mounts/unmounts (it's only rendered while there's more to load).
  const sentinel = useCallback(
    (node: HTMLDivElement | null) => {
      observer.current?.disconnect();
      if (!node) return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) loadMore();
        },
        { rootMargin: "300px" },
      );
      observer.current.observe(node);
    },
    [loadMore],
  );

  // Focus the amount when the form opens — without scrolling the page (the
  // default focus-into-view jump looks like a glitch in the centered hero).
  useEffect(() => {
    if (formOpen) amountInput.current?.focus({ preventScroll: true });
  }, [formOpen]);

  // On the success page, poll for the (now paid) message to confirm it landed
  // and show the actual amount. Stripe redirects carry ?session_id=...; Square
  // redirects carry ?mid=<message id> (Square has no session-id template). The
  // webhook may lag a few seconds, so we retry briefly.
  useEffect(() => {
    if (checkout !== "success" || !supabase) return;
    const client = supabase;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const messageId = params.get("mid");
    if (!sessionId && !messageId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const poll = async () => {
      let query = client
        .from("messages")
        .select("amount_cents")
        .eq("paid", true);
      query = sessionId
        ? query.eq("stripe_session_id", sessionId)
        : query.eq("id", messageId);
      const { data } = await query.maybeSingle();
      if (!active) return;
      if (data) {
        setConfirmed({
          amount: (data as { amount_cents: number }).amount_cents,
        });
        return;
      }
      if (++tries < 20) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 600);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [checkout]);

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

  // Leave the post-checkout view and clean the Stripe redirect out of the URL.
  function throwMore() {
    setCheckout(null);
    setConfirmed(null);
    window.history.replaceState({}, "", "/");
    setFormOpen(true);
  }

  function viewFeed() {
    setCheckout(null);
    window.history.replaceState({}, "", "/");
    document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <>
      <section className={styles.hero}>
        <Vortex ref={vortex} />

        <div className={styles.heroContent}>
          <header className={styles.header}>
            {/* <p className={styles.kicker}>throw your money</p>
            <span className={styles.kicker}>into</span> */}
            {/* <h1 className={styles.title} data-text="The Pit">
              The Pit
            </h1> */}
            <button
              type="button"
              className={styles.tagline}
              onClick={() => setFormOpen(true)}
            >
              how much will <span className={styles.italic}>you</span> throw in
              the pit?
              <span className={styles.cursor} aria-hidden="true" />
            </button>
          </header>

          {checkout ? (
            <div
              className={`${styles.checkoutPanel} ${
                confirmed ? styles.checkoutPanelWide : ""
              }`}
              role="status"
            >
              {checkout === "success" ? (
                <>
                  <div className={styles.checkoutMark} aria-hidden="true">
                    ✓
                  </div>
                  <h2 className={styles.checkoutTitle}>
                    {confirmed
                      ? `${usd.format(confirmed.amount / 100)} is in the pit`
                      : "into the pit"}
                  </h2>
                  <p className={styles.checkoutText}>
                    {confirmed
                      ? "Your money is gone. The Pit is satisfied."
                      : "Confirming your offering — it'll drop in any second now."}
                    {!confirmed && (
                      <span className={styles.cursor} aria-hidden="true" />
                    )}
                  </p>
                  <div className={styles.checkoutActions}>
                    {/* <button
                      type="button"
                      className={styles.openButton}
                      onClick={viewFeed}
                    >
                      [ view the feed ]
                    </button> */}
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={throwMore}
                    >
                      throw more
                    </button>
                  </div>
                  {confirmed && <ShareCards amountCents={confirmed.amount} />}
                </>
              ) : (
                <>
                  <h2 className={styles.checkoutTitle}>checkout canceled</h2>
                  <p className={styles.checkoutText}>
                    You weren't charged. The void remains hungry.
                  </p>
                  <div className={styles.checkoutActions}>
                    <button
                      type="button"
                      className={styles.openButton}
                      onClick={throwMore}
                    >
                      [ try again ]
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : !formOpen ? (
            <button
              type="button"
              className={`${styles.openButton} ${styles.throwCorner}`}
              aria-expanded={false}
              aria-label="Throw money"
              title="Throw money"
              onClick={() => setFormOpen(true)}
            >
              $
            </button>
          ) : (
            <>
              <div
                className={styles.overlay}
                onClick={() => setFormOpen(false)}
                aria-hidden="true"
              />
              <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.formHeader}>
                  {/* <span className={styles.formTitle}>// burn money</span> */}
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
                      ref={amountInput}
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
                  {submitting
                    ? "Redirecting…"
                    : "THROW YOUR MONEY INTO THE PIT"}
                </button>
                <p className={styles.warning}>
                  Don't do it, nothing will happen.
                </p>
              </form>
            </>
          )}
        </div>

        {/* <a className={styles.scrollHint} href="#feed">
          ▼ the feed
        </a> */}
      </section>

      <section id="feed" className={styles.feedSection}>
        <p className={styles.feedTotal}>
          <span className={styles.feedTotalAmount}>
            {usdWhole.format(animatedTotal / 100)}
          </span>{" "}
          fed to the pit so far…
        </p>
        <h2 className={styles.feedHeading}>// the pit feed</h2>
        {messages.length === 0 ? (
          <p className={styles.empty}>Nothing in the pit yet.</p>
        ) : (
          <>
            <ul className={styles.feed}>
              {messages.map((m, i) => (
                <li
                  key={m.id}
                  className={styles.entry}
                  // Stagger the first dozen so the initial feed cascades in;
                  // paginated/live items (higher index) animate immediately.
                  style={{ animationDelay: `${i < 12 ? i * 45 : 0}ms` }}
                >
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
            {hasMore && (
              <div
                ref={sentinel}
                className={styles.sentinel}
                aria-hidden="true"
              >
                loading…
              </div>
            )}
          </>
        )}
      </section>

      <button
        type="button"
        className={styles.audioToggle}
        onClick={audio.toggle}
        aria-pressed={audio.enabled}
        aria-label={audio.enabled ? "Mute sound" : "Play sound"}
        title={audio.enabled ? "Mute" : "Play sound"}
      >
        <span className={styles.audioIcon} aria-hidden="true">
          {audio.enabled ? "❚❚" : "▶"}
        </span>
        sound
      </button>

      <Faq />
    </>
  );
}
