import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getStripe } from '../lib/stripe';
import { getSupabaseAdmin } from '../lib/supabase';

export const checkout = new Hono<AppEnv>();

// Pay-what-you-want bounds. Stripe rejects charges under ~$0.50; we set a $1.00
// floor and a sane ceiling to keep obvious abuse out. Adjust to taste.
const MIN_AMOUNT_CENTS = 100; // $1.00
const MAX_AMOUNT_CENTS = 1_000_000; // $10,000.00
const MAX_NAME_LEN = 80;
const MAX_MESSAGE_LEN = 500;
const CURRENCY = 'usd';

/**
 * POST /api/checkout
 *
 * Body: { name: string; message: string; amountCents: number }
 *
 * Flow:
 *   1. Validate the name, message, and chosen amount.
 *   2. Insert the message as `paid = false` (hidden by RLS until paid).
 *   3. Create a Stripe Checkout Session for that amount, stashing the message
 *      id in metadata.
 *   4. Return the hosted Checkout URL for the client to redirect to.
 *
 * The message only becomes public later, when the verified webhook flips it to
 * paid — never here, and never on the client's say-so.
 */
checkout.post('/', async (c) => {
  const body = await c.req.json<{
    name?: string;
    message?: string;
    amountCents?: number;
  }>();

  // 1. Validate. Name and message are optional; only the amount is required.
  const name = (body.name ?? '').trim();
  const message = (body.message ?? '').trim();
  const amountCents = body.amountCents;

  if (name.length > MAX_NAME_LEN) {
    return c.json({ error: `Name is too long (max ${MAX_NAME_LEN} chars).` }, 400);
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return c.json(
      { error: `Message is too long (max ${MAX_MESSAGE_LEN} chars).` },
      400,
    );
  }
  if (
    typeof amountCents !== 'number' ||
    !Number.isInteger(amountCents) ||
    amountCents < MIN_AMOUNT_CENTS ||
    amountCents > MAX_AMOUNT_CENTS
  ) {
    return c.json(
      {
        error: `Amount must be a whole number of cents between ${MIN_AMOUNT_CENTS} and ${MAX_AMOUNT_CENTS}.`,
      },
      400,
    );
  }

  const stripe = getStripe(c.env);
  const supabase = getSupabaseAdmin(c.env);

  // 2. Create the pending (unpaid) message.
  const { data: pending, error: insertError } = await supabase
    .from('messages')
    .insert({ name, message, amount_cents: amountCents, currency: CURRENCY })
    .select('id')
    .single();

  if (insertError || !pending) {
    return c.json({ error: 'Could not create message' }, 500);
  }

  // 3. Create the Stripe Checkout Session for the chosen amount.
  const origin = new URL(c.req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // Request card explicitly rather than relying on the account's dynamic
    // payment-method config (which errors if nothing compatible is activated).
    payment_method_types: ['card'],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: amountCents,
          product_data: { name: 'A message in The Pit' },
        },
      },
    ],
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancel`,
    metadata: { message_id: pending.id },
  });

  // 4. Save the session id for reconciliation, then hand back the URL.
  await supabase
    .from('messages')
    .update({ stripe_session_id: session.id })
    .eq('id', pending.id);

  return c.json({ url: session.url, messageId: pending.id });
});
