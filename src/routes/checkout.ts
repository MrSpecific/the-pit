import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getStripe } from "../lib/stripe";
import { createSquarePaymentLink, isSquareConfigured } from "../lib/square";
import { getSupabaseAdmin } from "../lib/supabase";
import { redact } from "../lib/contentFilter";

export const checkout = new Hono<AppEnv>();

// Pay-what-you-want bounds. Stripe rejects charges under ~$0.50; we set a $1.00
// floor and a sane ceiling to keep obvious abuse out. Adjust to taste.
const MIN_AMOUNT_CENTS = 100; // $1.00
const MAX_AMOUNT_CENTS = 1_000_000; // $10,000.00
const MAX_NAME_LEN = 80;
const MAX_MESSAGE_LEN = 500;
const CURRENCY = "usd";
const ITEM_NAME = "Throw your money into The Pit";

/**
 * POST /api/checkout
 *
 * Body: { name: string; message: string; amountCents: number; provider?: "square" }
 *
 * Flow:
 *   1. Validate the name, message, and chosen amount.
 *   2. Insert the message as `paid = false` (hidden by RLS until paid).
 *   3. Create a hosted checkout for that amount — Stripe by default; if Stripe
 *      throws (outage, account issue, bad key) fall back to Square when it's
 *      configured. `provider: "square"` skips Stripe entirely (for testing).
 *   4. Return the hosted checkout URL for the client to redirect to.
 *
 * The message only becomes public later, when the verified webhook flips it to
 * paid — never here, and never on the client's say-so.
 */
checkout.post("/", async (c) => {
  const body = await c.req.json<{
    name?: string;
    message?: string;
    amountCents?: number;
    provider?: string;
  }>();

  // 1. Validate. Name and message are optional; only the amount is required.
  const name = (body.name ?? "").trim();
  const message = (body.message ?? "").trim();
  const amountCents = body.amountCents;

  if (name.length > MAX_NAME_LEN) {
    return c.json(
      { error: `Name is too long (max ${MAX_NAME_LEN} chars).` },
      400,
    );
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return c.json(
      { error: `Message is too long (max ${MAX_MESSAGE_LEN} chars).` },
      400,
    );
  }
  if (
    typeof amountCents !== "number" ||
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

  // Redact slurs / hate speech before anything is stored — the feed is public
  // and read straight from the DB, so the raw term must never be persisted.
  // (Swear words are intentionally left intact; see lib/contentFilter.ts.)
  const safeName = redact(name);
  const safeMessage = redact(message);

  const supabase = getSupabaseAdmin(c.env);

  // 2. Create the pending (unpaid) message.
  const { data: pending, error: insertError } = await supabase
    .from("messages")
    .insert({
      name: safeName,
      message: safeMessage,
      amount_cents: amountCents,
      currency: CURRENCY,
    })
    .select("id")
    .single();

  if (insertError || !pending) {
    return c.json({ error: "Could not create message" }, 500);
  }

  const origin = new URL(c.req.url).origin;

  // 3. Create the hosted checkout: Stripe first, Square as the fallback.
  const wantSquare = body.provider === "square" && isSquareConfigured(c.env);

  if (!wantSquare) {
    try {
      const stripe = getStripe(c.env);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        // Request card explicitly rather than relying on the account's dynamic
        // payment-method config (which errors if nothing compatible is activated).
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: CURRENCY,
              unit_amount: amountCents,
              product_data: { name: ITEM_NAME },
            },
          },
        ],
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/checkout/cancel`,
        metadata: { message_id: pending.id },
      });

      // 4. Save the session id for reconciliation, then hand back the URL.
      await supabase
        .from("messages")
        .update({ stripe_session_id: session.id })
        .eq("id", pending.id);

      return c.json({ url: session.url, messageId: pending.id });
    } catch (err) {
      // Without a configured fallback, rethrow so onError returns the 500 —
      // same behavior as before Square existed.
      if (!isSquareConfigured(c.env)) throw err;
      console.error("Stripe checkout failed, falling back to Square:", err);
    }
  }

  // 3b. Square fallback. Square's redirect has no {SESSION_ID}-style template,
  // so the success URL carries the message id (`mid`) for the client's
  // "did it land?" poll. Square has no cancel URL; an abandoned link just
  // leaves the row unpaid and invisible.
  const { url, orderId } = await createSquarePaymentLink(c.env, {
    idempotencyKey: pending.id,
    amountCents,
    currency: CURRENCY,
    itemName: ITEM_NAME,
    referenceId: pending.id,
    redirectUrl: `${origin}/checkout/success?provider=square&mid=${pending.id}`,
  });

  await supabase
    .from("messages")
    .update({ provider: "square", square_order_id: orderId })
    .eq("id", pending.id);

  return c.json({ url, messageId: pending.id, provider: "square" });
});
