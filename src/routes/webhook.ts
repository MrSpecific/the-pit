import { Hono } from 'hono';
import type Stripe from 'stripe';
import type { AppEnv } from '../types';
import { getStripe, getWebhookCryptoProvider } from '../lib/stripe';
import { getSupabaseAdmin } from '../lib/supabase';

export const webhook = new Hono<AppEnv>();

/**
 * POST /api/webhooks/stripe
 *
 * The source of truth for payment state. Stripe calls this; we verify the
 * signature, then publish (or discard) the message.
 *
 * Two Workers-specific requirements:
 *   - Read the RAW body (`c.req.text()`); never let JSON parsing run first.
 *   - Verify with `constructEventAsync` + a SubtleCrypto provider, because the
 *     Workers runtime has no Node `crypto`.
 */
webhook.post('/', async (c) => {
  const stripe = getStripe(c.env);
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
      undefined,
      getWebhookCryptoProvider(),
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  const supabase = getSupabaseAdmin(c.env);

  // Idempotency: Stripe retries deliveries. Record the event id first; if it's
  // a duplicate the unique constraint trips and we ack without reprocessing.
  const { error: dedupeError } = await supabase
    .from('webhook_events')
    .insert({ stripe_event_id: event.id, type: event.type });

  if (dedupeError) {
    return c.json({ received: true, deduped: true });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const messageId = session.metadata?.message_id;
      if (messageId) {
        // Publish the message. amount_total is the authoritative amount Stripe
        // actually charged, so record that rather than the requested amount.
        await supabase
          .from('messages')
          .update({
            paid: true,
            paid_at: new Date().toISOString(),
            amount_cents: session.amount_total ?? undefined,
            // Stored so a later charge.refunded can find this message.
            stripe_payment_intent_id:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : null,
          })
          .eq('id', messageId);
      }
      break;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const messageId = session.metadata?.message_id;
      if (messageId) {
        // The customer never paid; drop the pending row so it can't linger.
        // (Guard on paid = false so a late expiry can't delete a paid message.)
        await supabase
          .from('messages')
          .delete()
          .eq('id', messageId)
          .eq('paid', false);
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId =
        typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
      if (paymentIntentId) {
        // A full refund un-publishes the message (RLS hides refunded_at rows).
        // A partial refund leaves it up but reflects the net amount kept.
        const update = charge.refunded
          ? { refunded_at: new Date().toISOString() }
          : { amount_cents: charge.amount - charge.amount_refunded };
        await supabase
          .from('messages')
          .update(update)
          .eq('stripe_payment_intent_id', paymentIntentId);
      }
      break;
    }

    // Add more as you need them: payment_intent.payment_failed, etc.
    default:
      break;
  }

  return c.json({ received: true });
});
