// ─────────────────────────────────────────────────────────────
// netlify/functions/revenuecat-webhook.js
// Receives RevenueCat webhook events and syncs the Supabase
// `subscriptions` table. Writes `plan_name` + `status` so that
// getUserTier() in src/lib/stripe.js resolves the tier correctly.
//
// Env vars required (Netlify):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (falls back to SUPABASE_SERVICE_KEY)
//   REVENUECAT_WEBHOOK_SECRET   (the value after "Bearer " in RevenueCat)
// ─────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';

// Map App Store product IDs -> plan_name string getUserTier() understands.
// getUserTier checks: plan.includes('coach') | 'elite' | 'athlete'.
// Confirm these product IDs against App Store Connect / RevenueCat.
const PRODUCT_TO_PLAN = {
  'app.eliteathlete.athlete.monthly': 'athlete',
  'app.eliteathlete.athlete.annual':  'athlete_annual',
  'app.eliteathlete.elite.monthly':   'elite',
  'app.eliteathlete.elite.annual':    'elite_annual',
  'app.eliteathlete.coach.monthly':   'coach',
  'app.eliteathlete.coach.annual':    'coach_annual',
};

const ACTIVE_TYPES = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE',
  'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED',
]);
const INACTIVE_TYPES = new Set([
  'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED', 'REFUND',
]);

export default async (req) => {
  // ── Auth: must match the Bearer token configured in RevenueCat ──
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  const event = body?.event;
  if (!event) return new Response('No event', { status: 400 });

  const userId = event.app_user_id;
  if (!userId) return new Response('No app_user_id', { status: 200 });

  // Decide active/inactive; ignore non-subscription event types.
  let status;
  if (ACTIVE_TYPES.has(event.type)) status = 'active';
  else if (INACTIVE_TYPES.has(event.type)) status = 'inactive';
  else return new Response('Ignored', { status: 200 }); // TEST, TRANSFER, etc.

  const productId = event.product_id || '';
  const planName =
    PRODUCT_TO_PLAN[productId] ||
    (event.entitlement_ids && event.entitlement_ids[0]) ||
    'elite';

  const periodEnd = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : null;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  const { error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        plan_name: planName,
        status,
        current_period_end: periodEnd,
        platform: 'ios',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('Supabase upsert failed:', error);
    return new Response('DB error', { status: 500 });
  }
  return new Response('OK', { status: 200 });
};
