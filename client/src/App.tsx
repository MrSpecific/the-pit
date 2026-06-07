import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from './lib/supabase';
import { MESSAGE_COLUMNS, type PitMessage } from './types';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function App() {
  const [messages, setMessages] = useState<PitMessage[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState(''); // dollars, as typed
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the existing feed, then subscribe for new paid messages. A row is
  // inserted hidden (paid = false) and only becomes visible — to this query and
  // to realtime — once the webhook flips it to paid, so we react to that.
  useEffect(() => {
    let active = true;

    supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('paid', true)
      .order('paid_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(error.message);
          return;
        }
        setMessages((data ?? []) as PitMessage[]);
      });

    const channel = supabase
      .channel('public:messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as (PitMessage & { paid?: boolean }) | null;
          if (!row || row.paid !== true) return;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    const amountCents = Math.round(dollars * 100);

    setSubmitting(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, message, amountCents }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Something went wrong.');
        setSubmitting(false);
        return;
      }
      // Hand off to Stripe's hosted Checkout.
      window.location.href = data.url;
    } catch {
      setError('Network error — please try again.');
      setSubmitting(false);
    }
  }

  // Minimal handling of the Stripe redirect targets (success_url / cancel_url).
  const path = window.location.pathname;
  const banner =
    path === '/checkout/success'
      ? 'Payment received — your message appears below once Stripe confirms it.'
      : path === '/checkout/cancel'
        ? 'Checkout canceled. You were not charged.'
        : null;

  return (
    <main>
      <h1>The Pit</h1>
      <p>Pay what you want to drop a message into the pit.</p>

      {banner && (
        <p role="status">
          {banner} <a href="/">Back</a>
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <p>
          <label htmlFor="name">Name</label>
          <br />
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
          />
        </p>
        <p>
          <label htmlFor="message">Message</label>
          <br />
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            required
          />
        </p>
        <p>
          <label htmlFor="amount">Amount (USD)</label>
          <br />
          <input
            id="amount"
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Redirecting…' : 'Pay & post'}
        </button>
      </form>

      <h2>The feed</h2>
      {messages.length === 0 ? (
        <p>Nothing in the pit yet.</p>
      ) : (
        <ul>
          {messages.map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong> — {usd.format(m.amount_cents / 100)}
              <br />
              {m.message}
              <br />
              <small>
                {new Date(m.paid_at ?? m.created_at).toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
