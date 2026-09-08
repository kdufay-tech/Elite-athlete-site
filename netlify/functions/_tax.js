// ─────────────────────────────────────────────────────────────
// netlify/functions/_tax.js
// One switch for Stripe Tax, off until the Stripe account can actually
// calculate tax.
//
// WHY A FLAG RATHER THAN JUST TURNING IT ON
//   Stripe Tax refuses to calculate until the account has an origin address
//   and at least one registration. Ship automatic_tax:true before that and
//   every checkout fails - the switch has to be flipped in the dashboard and
//   in the code at the same moment, and only an env var can do that without a
//   redeploy at the exact time it matters.
//
// WHAT WAS WRONG BEFORE (audited 2026-09-08)
//   No automatic_tax anywhere, so $0 tax was collected on every subscription.
//   The prices are set to tax_behavior "Exclusive", which sounds like tax was
//   being added on top - but Exclusive only means "add tax to this price IF
//   tax is calculated". Nothing calculated it, so the setting was inert.
//
// THE TWO TRAPS THIS FILE EXISTS TO KEEP TOGETHER
//   1. Checkout REJECTS a session that has automatic_tax on and reuses an
//      existing `customer` unless customer_update.address is also set. Turning
//      tax on without it breaks checkout for every returning customer.
//   2. billing_address_collection 'auto' only asks for an address when the
//      payment method demands it, and cards usually do not - so Stripe would
//      have no location to tax. It must become 'required' at the same time.
//
//   Both live in taxCheckoutFields() so they cannot be enabled apart.
//
// TAX IDS
//   tax_id_collection lets a school enter an exemption/VAT number at checkout
//   and have Stripe apply the exemption itself. Coach Pro is sold to schools,
//   which are commonly exempt; without this each one is charged tax on $899
//   and has to be refunded and marked exempt by hand. The field only appears
//   for business buyers, so individual athletes never see it.
//
// SEATS
//   The per-athlete seat subscription is created directly against
//   /v1/subscriptions in _seat-sync.js, NOT through Checkout, so it needs its
//   own automatic_tax. Miss it and the $899 is taxed while the $4.99/athlete
//   is not - wrong on every monthly invoice, quietly.
// ─────────────────────────────────────────────────────────────

/** Flip STRIPE_TAX_ENABLED=true in Netlify only after Stripe Tax is configured. */
export const TAX_ENABLED = process.env.STRIPE_TAX_ENABLED === 'true';

/**
 * Fields to merge into a Checkout Session payload. Empty when tax is off, so
 * behaviour is byte-for-byte unchanged until the flag is set.
 * @param {boolean} reusingCustomer - true when payload.customer is being set.
 */
export function taxCheckoutFields(reusingCustomer) {
  if (!TAX_ENABLED) return {};
  return {
    automatic_tax: { enabled: true },
    // Stripe Tax needs a location. 'auto' would often collect nothing.
    billing_address_collection: 'required',
    // Lets an exempt school identify itself instead of being refunded later.
    tax_id_collection: { enabled: true },
    // REQUIRED whenever `customer` is set, or Checkout rejects the session.
    ...(reusingCustomer ? { customer_update: { address: 'auto', name: 'auto' } } : {}),
  };
}

/** Form fields for a direct /v1/subscriptions create. Empty when tax is off. */
export function taxSubscriptionFields() {
  return TAX_ENABLED ? { 'automatic_tax[enabled]': 'true' } : {};
}
