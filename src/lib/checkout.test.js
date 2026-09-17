// ─────────────────────────────────────────────────────────────
// src/lib/checkout.test.js
// @stripe/stripe-js is mocked throughout: these tests must never touch
// Stripe's CDN, and the point of importing from '/pure' is that importing
// the module has no side effect at all.
//
// checkout.js memoises the Stripe promise in module scope, so every test
// resets the module registry and re-imports to get a clean cache.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadStripe } = vi.hoisted(() => ({ loadStripe: vi.fn() }));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe }));

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  loadStripe.mockReset();
});

describe('module import', () => {
  it('does not load Stripe merely by being imported', async () => {
    // This is the whole reason lib/checkout.js exists. The default
    // @stripe/stripe-js entry injects js.stripe.com on import; '/pure'
    // does not. If someone swaps the import back, this fails.
    await import('./checkout.js');
    await settle();
    expect(loadStripe).not.toHaveBeenCalled();
  });
});

describe('getStripe', () => {
  it('memoises a successful load', async () => {
    const stripe = { id: 'stripe' };
    loadStripe.mockResolvedValue(stripe);

    const { getStripe } = await import('./checkout.js');
    await expect(getStripe()).resolves.toBe(stripe);
    await expect(getStripe()).resolves.toBe(stripe);

    expect(loadStripe).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejection', async () => {
    // getStripe() used to store whatever loadStripe returned, including a
    // rejected promise — so a single transient failure permanently broke
    // this path for the rest of the page session. Cheap to guard, and the
    // fallback is rare enough that nobody would notice it rotting.
    loadStripe
      .mockRejectedValueOnce(new Error('CDN unreachable'))
      .mockResolvedValueOnce({ id: 'stripe' });

    const { getStripe } = await import('./checkout.js');
    await expect(getStripe()).rejects.toThrow('CDN unreachable');
    await expect(getStripe()).resolves.toEqual({ id: 'stripe' });

    expect(loadStripe).toHaveBeenCalledTimes(2);
  });

  it('surfaces the original error to the caller', async () => {
    const boom = new Error('blocked by client');
    loadStripe.mockRejectedValue(boom);

    const { getStripe } = await import('./checkout.js');
    await expect(getStripe()).rejects.toBe(boom);
  });
});

// ─────────────────────────────────────────────────────────────
// Architectural guards. The unit tests above mock '@stripe/stripe-js/pure',
// so they can NOT notice someone swapping the import back to the default
// entry — the mock would simply stop applying and they would still pass.
// These scan the real source instead, and guard the two invariants the
// whole boot-time fix rests on.
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir = 'src', out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(js|jsx)$/.test(p) && !p.endsWith('.test.js')) out.push(p);
  }
  return out;
}

describe('module boundaries', () => {
  const files = sourceFiles();

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never imports the side-effectful @stripe/stripe-js entry', () => {
    // The default entry appends <script src="js.stripe.com/v3"> on import,
    // with no loadStripe() call. Only '@stripe/stripe-js/pure' is allowed.
    const offenders = files.filter((f) =>
      /from\s+['"]@stripe\/stripe-js['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('never imports lib/checkout statically', () => {
    // A single static import anywhere in the graph pulls checkout — and so
    // Stripe — back into the main chunk and back onto every page load.
    // Use `await import('.../lib/checkout')` at the point of use instead.
    const offenders = files.filter((f) =>
      /^\s*import\s[^\n]*from\s+['"][^'"]*lib\/checkout(\.js)?['"]/m.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps lib/tiers free of any import at all', () => {
    // tiers.js is imported statically by App.jsx on the first render path.
    // It must stay dependency-free so it can never drag anything into boot.
    const tiers = readFileSync('src/lib/tiers.js', 'utf8');
    expect(tiers).not.toMatch(/^\s*import\s/m);
  });
});
