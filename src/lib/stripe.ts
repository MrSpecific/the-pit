import Stripe from 'stripe';
import type { Env } from '../types';

/**
 * Stripe client configured for the Workers runtime.
 *
 * `createFetchHttpClient()` makes Stripe use the runtime's `fetch` instead of
 * Node's http module (absent on Workers). Per-request creation is fine.
 */
export function getStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    // apiVersion is intentionally omitted so the installed SDK's pinned version
    // is used. Pin it here once you set a version in your Stripe dashboard,
    // e.g. apiVersion: '2025-xx-xx'.
  });
}

/**
 * SubtleCrypto-based provider for verifying webhook signatures.
 *
 * Workers has no Node `crypto`, so the synchronous `constructEvent` throws.
 * Signature verification must use WebCrypto via `constructEventAsync` together
 * with this provider (see routes/webhook.ts).
 */
export function getWebhookCryptoProvider(): Stripe.CryptoProvider {
  return Stripe.createSubtleCryptoProvider();
}
