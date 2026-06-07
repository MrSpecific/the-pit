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
 * signature, then update the order.
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
      const orderId = session.metadata?.order_id;
      if (orderId) {
        await supabase
          .from('orders')
          .update({
            status: 'paid',
            stripe_payment_intent_id:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : null,
          })
          .eq('id', orderId);
      }
      break;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      if (orderId) {
        await supabase.from('orders').update({ status: 'failed' }).eq('id', orderId);
      }
      break;
    }

    // Add more as you need them: charge.refunded, payment_intent.payment_failed, etc.
    default:
      break;
  }

  return c.json({ received: true });
});
