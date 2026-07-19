import type { Env } from '../types';

/**
 * Square client for the Workers runtime.
 *
 * Square's REST API is plain JSON over fetch, so unlike Stripe there's no SDK
 * (or Node-runtime shim) needed — we call the two endpoints we use directly.
 * Square is the FALLBACK processor: checkout only routes here when Stripe
 * fails (or when explicitly requested), and only if these env vars are set.
 */

// Pin the API version so Square's behavior doesn't shift under us when the
// account's default version changes. Bump deliberately.
const SQUARE_VERSION = '2026-07-15';

function squareBaseUrl(env: Env): string {
  return env.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

export function isSquareConfigured(env: Env): boolean {
  return Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

/**
 * Create a hosted checkout page (Square Payment Link) for an ad-hoc amount —
 * the Square analog of a Stripe Checkout Session.
 *
 * We pass a full `order` (not `quick_pay`) so we can stamp the message id on
 * it as `reference_id`; the returned `order_id` is what the payment webhook
 * later uses to find the message.
 */
export async function createSquarePaymentLink(
  env: Env,
  opts: {
    /** Used as Square's idempotency key; the message id is a natural fit. */
    idempotencyKey: string;
    amountCents: number;
    currency: string;
    itemName: string;
    /** Stamped on the order as reference_id for reconciliation. */
    referenceId: string;
    /** Where the buyer lands after paying. Square has no cancel URL. */
    redirectUrl: string;
  },
): Promise<{ url: string; orderId: string }> {
  const res = await fetch(`${squareBaseUrl(env)}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'content-type': 'application/json',
      'square-version': SQUARE_VERSION,
    },
    body: JSON.stringify({
      idempotency_key: opts.idempotencyKey,
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        reference_id: opts.referenceId,
        line_items: [
          {
            name: opts.itemName,
            quantity: '1',
            base_price_money: {
              amount: opts.amountCents,
              currency: opts.currency.toUpperCase(),
            },
          },
        ],
      },
      checkout_options: { redirect_url: opts.redirectUrl },
    }),
  });

  if (!res.ok) {
    throw new Error(`Square CreatePaymentLink failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    payment_link?: { url?: string; order_id?: string };
  };
  const url = data.payment_link?.url;
  const orderId = data.payment_link?.order_id;
  if (!url || !orderId) {
    throw new Error('Square CreatePaymentLink returned no url/order_id');
  }
  return { url, orderId };
}

/**
 * Verify a Square webhook signature.
 *
 * Square signs HMAC-SHA256(signature key, notification URL + raw body) and
 * base64-encodes it into the `x-square-hmacsha256-signature` header. The URL
 * must match the subscription's notification URL byte-for-byte, so the
 * subscription in the Square dashboard must point at exactly the URL this
 * Worker sees (https://thepit.biz/api/webhooks/square).
 *
 * `crypto.subtle.verify` does the comparison in constant time.
 */
export async function verifySquareSignature(
  env: Env,
  notificationUrl: string,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader || !env.SQUARE_WEBHOOK_SIGNATURE_KEY) return false;

  let signature: Uint8Array;
  try {
    signature = Uint8Array.from(atob(signatureHeader), (ch) => ch.charCodeAt(0));
  } catch {
    return false; // header wasn't valid base64
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(notificationUrl + rawBody),
  );
}
