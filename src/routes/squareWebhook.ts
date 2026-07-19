import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { verifySquareSignature } from '../lib/square';
import { getSupabaseAdmin } from '../lib/supabase';

export const squareWebhook = new Hono<AppEnv>();

/** The slices of Square's event envelope we actually read. */
interface SquareEvent {
  event_id?: string;
  type?: string;
  data?: {
    object?: {
      payment?: {
        id?: string;
        order_id?: string;
        status?: string;
        amount_money?: { amount?: number };
      };
      refund?: {
        payment_id?: string;
        status?: string;
        amount_money?: { amount?: number };
      };
    };
  };
}

/**
 * POST /api/webhooks/square
 *
 * The Square mirror of the Stripe webhook: source of truth for payments made
 * through the fallback processor. Subscribe this URL to `payment.updated`,
 * `refund.created`, and `refund.updated` in the Square Developer dashboard.
 *
 * Signature verification hashes the notification URL + raw body, so the
 * subscription's URL must exactly match what this Worker sees for `c.req.url`
 * (https://thepit.biz/api/webhooks/square).
 */
squareWebhook.post('/', async (c) => {
  const rawBody = await c.req.text();
  const valid = await verifySquareSignature(
    c.env,
    c.req.url,
    rawBody,
    c.req.header('x-square-hmacsha256-signature'),
  );
  if (!valid) {
    console.error('Square webhook signature verification failed');
    return c.json({ error: 'Invalid signature' }, 400);
  }

  let event: SquareEvent;
  try {
    event = JSON.parse(rawBody) as SquareEvent;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!event.event_id) {
    return c.json({ error: 'Missing event_id' }, 400);
  }

  const supabase = getSupabaseAdmin(c.env);

  // Idempotency: same ledger as Stripe. The column holds either provider's
  // event id — Square's UUIDs can't collide with Stripe's "evt_..." ids.
  const { error: dedupeError } = await supabase
    .from('webhook_events')
    .insert({ stripe_event_id: event.event_id, type: `square:${event.type}` });

  if (dedupeError) {
    return c.json({ received: true, deduped: true });
  }

  switch (event.type) {
    case 'payment.updated': {
      const payment = event.data?.object?.payment;
      if (payment?.status === 'COMPLETED' && payment.order_id) {
        // Publish the message. amount_money is what Square actually charged.
        // Guard on paid = false: later payment.updated deliveries (e.g. after
        // a refund) must not resurrect or overwrite a published row.
        await supabase
          .from('messages')
          .update({
            paid: true,
            paid_at: new Date().toISOString(),
            amount_cents: payment.amount_money?.amount ?? undefined,
            // Stored so a later refund event can find this message.
            square_payment_id: payment.id ?? null,
          })
          .eq('square_order_id', payment.order_id)
          .eq('paid', false);
      }
      break;
    }

    case 'refund.created':
    case 'refund.updated': {
      const refund = event.data?.object?.refund;
      if (refund?.status === 'COMPLETED' && refund.payment_id) {
        const refundedCents = refund.amount_money?.amount ?? 0;
        const { data: msg } = await supabase
          .from('messages')
          .select('id, amount_cents')
          .eq('square_payment_id', refund.payment_id)
          .maybeSingle();
        if (msg) {
          // Full refund un-publishes the message (RLS hides refunded_at rows);
          // a partial refund leaves it up but reflects the net amount kept.
          const update =
            refundedCents >= msg.amount_cents
              ? { refunded_at: new Date().toISOString() }
              : { amount_cents: msg.amount_cents - refundedCents };
          await supabase.from('messages').update(update).eq('id', msg.id);
        }
      }
      break;
    }

    default:
      break;
  }

  return c.json({ received: true });
});
