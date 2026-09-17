// ─────────────────────────────────────────────────────────────
// src/lib/tiers.test.js
// Characterisation tests for the tier logic every gated screen depends on.
// These document what the code ACTUALLY does today — including one branch
// that turns out to be unreachable (see the beta_elite case) — so that a
// future edit to the precedence order has to break a test to land.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { getUserTier, canAccess, TIER_ORDER, TIER_INFO, STRIPE_PRICES } from './tiers.js';

describe('getUserTier', () => {
  it('treats a missing subscription as free', () => {
    expect(getUserTier(null)).toBe('free');
    expect(getUserTier(undefined)).toBe('free');
  });

  it('treats an empty subscription row as free', () => {
    expect(getUserTier({})).toBe('free');
    expect(getUserTier({ plan_name: null })).toBe('free');
  });

  it.each([
    ['coach_annual',   'coach'],
    ['Coach Pro',      'coach'],
    ['elite',          'elite'],
    ['elite_annual',   'elite'],
    ['athlete',        'athlete'],
    ['athlete_annual', 'athlete'],
  ])('maps plan_name %j to %j', (plan_name, expected) => {
    expect(getUserTier({ plan_name })).toBe(expected);
  });

  it('is case-insensitive on plan_name', () => {
    expect(getUserTier({ plan_name: 'ELITE_ANNUAL' })).toBe('elite');
    expect(getUserTier({ plan_name: 'Athlete' })).toBe('athlete');
  });

  it('grants beta_elite full elite access', () => {
    // NOTE: this passes via the `plan.includes('elite')` branch, not the
    // explicit `plan === 'beta_elite'` branch below it — 'beta_elite'
    // contains 'elite', so that later branch is unreachable. The behaviour
    // is correct either way; the line is redundant. Asserted here so the
    // guarantee survives if anyone ever removes the dead branch.
    expect(getUserTier({ plan_name: 'beta_elite' })).toBe('elite');
  });

  describe('precedence: earlier checks win', () => {
    it('prefers coach over elite', () => {
      expect(getUserTier({ plan_name: 'coach_elite' })).toBe('coach');
    });
    it('prefers elite over athlete', () => {
      expect(getUserTier({ plan_name: 'elite_athlete' })).toBe('elite');
    });
    it('prefers a named plan over the legacy active fallback', () => {
      expect(getUserTier({ plan_name: 'athlete', status: 'active' })).toBe('athlete');
    });
  });

  describe('legacy paid accounts', () => {
    it('treats an active subscription with an unrecognised plan as elite', () => {
      expect(getUserTier({ plan_name: 'legacy_pro', status: 'active' })).toBe('elite');
      expect(getUserTier({ plan_name: null, status: 'active' })).toBe('elite');
    });
    it('does not grant access when the subscription is not active', () => {
      expect(getUserTier({ plan_name: 'legacy_pro', status: 'canceled' })).toBe('free');
      expect(getUserTier({ plan_name: 'legacy_pro', status: 'past_due' })).toBe('free');
    });
  });
});

describe('canAccess', () => {
  const TIERS = ['free', 'athlete', 'elite', 'coach'];

  it.each(TIERS)('tier %s can reach its own level and everything below', (userTier) => {
    for (const required of TIERS) {
      const expected = TIER_ORDER[userTier] >= TIER_ORDER[required];
      expect(canAccess(userTier, required)).toBe(expected);
    }
  });

  it('gates the full matrix as expected', () => {
    expect(canAccess('free',    'athlete')).toBe(false);
    expect(canAccess('athlete', 'elite')).toBe(false);
    expect(canAccess('elite',   'coach')).toBe(false);
    expect(canAccess('coach',   'coach')).toBe(true);
    expect(canAccess('elite',   'athlete')).toBe(true);
  });

  it('treats an unknown user tier as free rather than throwing', () => {
    expect(canAccess('bogus', 'free')).toBe(true);
    expect(canAccess('bogus', 'athlete')).toBe(false);
    expect(canAccess(undefined, 'elite')).toBe(false);
  });

  it('treats an unknown required tier as ungated', () => {
    expect(canAccess('free', 'bogus')).toBe(true);
  });
});

describe('TIER_INFO / STRIPE_PRICES integrity', () => {
  // A typo'd price key does not fail the build and does not fail until a
  // real user clicks Buy, where redirectToCheckout throws "price ID not
  // configured". Catch it here instead.
  it.each(Object.keys(TIER_INFO))('every price key on %s exists in STRIPE_PRICES', (tier) => {
    const info = TIER_INFO[tier];
    for (const period of ['monthly', 'annual']) {
      if (!info[period]) continue; // Coach Pro is annual-only: monthly is null
      expect(Object.keys(STRIPE_PRICES)).toContain(info[period].key);
    }
  });

  it('keeps Coach Pro annual-only, since Stripe forbids mixed intervals', () => {
    expect(TIER_INFO.coach.monthly).toBeNull();
    expect(TIER_INFO.coach.annualOnly).toBe(true);
    expect(TIER_INFO.coach.annual).toBeTruthy();
  });

  it('marks Coach Pro web-only so iOS never shows an outbound purchase', () => {
    expect(TIER_INFO.coach.webOnlyPurchase).toBe(true);
  });
});
