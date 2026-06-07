import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getStripe } from '../lib/stripe';
import { getSupabaseAdmin } from '../lib/supabase';

export const checkout = new Hono<AppEnv>();

/**
 * POST /api/checkout
 *
 * Body: { items: { productId: string; quantity: number }[]; userId?: string }
 *
 * Flow:
 *   1. Look up the requested products server-side (trusted prices).
 *   2. Create a `pending` order in Supabase.
 *   3. Create a Stripe Checkout Session, stashing the order id in metadata.
 *   4. Return the hosted Checkout URL for the client to redirect to.
 *
 * The order is only marked `paid` later, by the verified webhook — never here,
 * and never on the client's say-so.
 */
checkout.post('/', async (c) => {
  const stripe = getStripe(c.env);
  const supabase = getSupabaseAdmin(c.env);

  const body = await c.req.json<{
    items: { productId: string; quantity: number }[];
    userId?: string;
  }>();

  if (!body.items?.length) {
    return c.json({ error: 'No items provided' }, 400);
  }

  // 1. Trusted product data — price always comes from the DB, never the client.
  const productIds = body.items.map((i) => i.productId);
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, price_cents, currency, stripe_price_id, active')
    .in('id', productIds)
    .eq('active', true);

  if (productsError || !products?.length) {
    return c.json({ error: 'Products not found' }, 400);
  }

  const productById = new Map(products.map((p) => [p.id, p]));

  // 2. Compute total and create a pending order.
  let amountCents = 0;
  const orderItems = body.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) throw new Error(`Unknown product ${item.productId}`);
    amountCents += product.price_cents * item.quantity;
    return {
      product_id: product.id,
      quantity: item.quantity,
      unit_price_cents: product.price_cents,
    };
  });

  const currency = products[0].currency ?? 'usd';

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      user_id: body.userId ?? null,
      status: 'pending',
      amount_cents: amountCents,
      currency,
    })
    .select('id')
    .single();

  if (orderError || !order) {
    return c.json({ error: 'Could not create order' }, 500);
  }

  await supabase
    .from('order_items')
    .insert(orderItems.map((oi) => ({ ...oi, order_id: order.id })));

  // 3. Create the Stripe Checkout Session.
  const origin = new URL(c.req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: body.items.map((item) => {
      const product = productById.get(item.productId)!;
      // Use a pre-created Stripe Price if you have one; otherwise build
      // price_data inline from the trusted DB value.
      return product.stripe_price_id
        ? { price: product.stripe_price_id, quantity: item.quantity }
        : {
            quantity: item.quantity,
            price_data: {
              currency,
              unit_amount: product.price_cents,
              product_data: { name: product.name },
            },
          };
    }),
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancel`,
    metadata: { order_id: order.id },
  });

  // 4. Save the session id for reconciliation, then hand back the URL.
  await supabase
    .from('orders')
    .update({ stripe_session_id: session.id })
    .eq('id', order.id);

  return c.json({ url: session.url, orderId: order.id });
});
