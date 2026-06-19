// ─────────────────────────────────────────────────────────────
// src/components/IOSPaywall.jsx
// Apple StoreKit / RevenueCat paywall (iOS only)
// Athlete + Elite purchasable · Coach Pro = waitlist (matches web)
// Rendered only on iOS by CheckoutModal.jsx
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { TIER_INFO } from '../lib/stripe';

// Map RevenueCat package identifier  ->  { tierKey, billing }
// These identifiers must match the package IDs in your RevenueCat
// "default" offering. Adjust the left-hand strings if yours differ.
const PKG_MAP = {
  athlete_monthly: { tierKey: 'athlete', billing: 'monthly' },
  athlete_annual:  { tierKey: 'athlete', billing: 'annual'  },
  elite_monthly:   { tierKey: 'elite',   billing: 'monthly' },
  elite_annual:    { tierKey: 'elite',   billing: 'annual'  },
  // RevenueCat default aliases, in case your offering uses them:
  $rc_monthly:     { tierKey: 'athlete', billing: 'monthly' },
  $rc_annual:      { tierKey: 'athlete', billing: 'annual'  },
};

const DISPLAY_ORDER = ['athlete_annual', 'athlete_monthly', 'elite_annual', 'elite_monthly'];

export default function IOSPaywall({ plan, onClose, onSuccess, userId, userEmail }) {
  const initialTier = plan?.tierKey || 'elite';
  const isCoach = initialTier === 'coach';

  const [packages, setPackages] = useState([]);
  const [loading, setLoading]   = useState(!isCoach);
  const [purchasing, setPurchasing] = useState(null);
  const [error, setError]       = useState('');

  // Coach Pro waitlist state (mirrors PayModal)
  const [waitEmail, setWaitEmail] = useState(userEmail || '');
  const [waitSent,  setWaitSent]  = useState(false);

  useEffect(() => {
    if (isCoach) return;
    let mounted = true;
    (async () => {
      try {
        if (userId) await Purchases.logIn({ appUserID: userId });
        const offerings = await Purchases.getOfferings();
        const avail = offerings?.current?.availablePackages || [];
        if (!avail.length) throw new Error('No subscriptions available right now.');
        // keep only Athlete/Elite, sort into display order
        const filtered = avail
          .filter(p => PKG_MAP[p.identifier] && PKG_MAP[p.identifier].tierKey !== 'coach')
          .sort((a, b) => DISPLAY_ORDER.indexOf(a.identifier) - DISPLAY_ORDER.indexOf(b.identifier));
        if (mounted) setPackages(filtered.length ? filtered : avail);
      } catch (e) {
        if (mounted) setError(e.message || 'Failed to load subscriptions.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [isCoach, userId]);

  const buy = async (pkg) => {
    setError('');
    setPurchasing(pkg.identifier);
    try {
      const res = await Purchases.purchasePackage({ aPackage: pkg });
      const active = res?.customerInfo?.entitlements?.active || {};
      if (Object.keys(active).length > 0) {
        const map = PKG_MAP[pkg.identifier] || {};
        const planName = map.billing === 'annual'
          ? `${map.tierKey}_annual`
          : map.tierKey; // matches getUserTier()/PayModal planName convention
        onSuccess?.(planName);
      }
    } catch (e) {
      if (!e?.userCancelled) setError(e.message || 'Purchase failed.');
    } finally {
      setPurchasing(null);
    }
  };

  const restore = async () => {
    setError('');
    setPurchasing('restore');
    try {
      const info = await Purchases.restorePurchases();
      const active = info?.customerInfo?.entitlements?.active || {};
      if (Object.keys(active).length > 0) onSuccess?.('elite');
      else setError('No active purchases found to restore.');
    } catch (e) {
      setError(e.message || 'Restore failed.');
    } finally {
      setPurchasing(null);
    }
  };

  const joinWaitlist = async () => {
    if (!waitEmail.includes('@')) { setError('Please enter a valid email.'); return; }
    setPurchasing('waitlist');
    try {
      await fetch('/.netlify/functions/coach-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: waitEmail }),
      }).catch(() => {});
      setWaitSent(true);
    } finally {
      setPurchasing(null);
    }
  };

  // tier label for a package
  const labelFor = (pkg) => {
    const map = PKG_MAP[pkg.identifier] || {};
    const tier = (map.tierKey || '').replace(/^\w/, c => c.toUpperCase());
    const cadence = map.billing === 'annual' ? 'Annual' : 'Monthly';
    return { tier, cadence };
  };

  return (
    <div className="pmbg" onClick={onClose}>
      <div className="pm" onClick={e => e.stopPropagation()}>
        <div className="pmh">
          <div>
            <div style={{fontFamily:"'Cormorant SC',serif",fontSize:'1.55rem',fontWeight:600,letterSpacing:'3px',color:'var(--ivory)'}}>
              {isCoach ? 'Join Waitlist' : 'Choose Membership'}
            </div>
            <div style={{color:'var(--gold)',fontSize:'0.62rem',letterSpacing:'2px',marginTop:'0.22rem'}}>
              Excellence · Performance · Legacy
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:'1.5rem',cursor:'pointer',lineHeight:1}}>×</button>
        </div>

        <div className="pmb">
          {/* ── COACH PRO WAITLIST (matches web) ── */}
          {isCoach ? (
            waitSent ? (
              <div style={{textAlign:'center',padding:'1.5rem 0'}}>
                <div style={{fontSize:'2.5rem',marginBottom:'0.5rem'}}>✅</div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:'1.25rem',color:'var(--gold)',marginBottom:'0.5rem'}}>You're on the list</div>
                <div style={{fontSize:'0.8rem',color:'var(--muted)'}}>We'll email you first when Coach Pro launches in Q3 2026.</div>
              </div>
            ) : (
              <div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:'1rem',color:'var(--ivory2)',marginBottom:'1rem',lineHeight:1.65}}>
                  Coach Pro is launching Q3 2026. Join the waitlist for early access and founding member pricing.
                </div>
                <div className="f">
                  <label className="fl">Your Email</label>
                  <input className="fi" placeholder="coach@school.edu" value={waitEmail} onChange={e => setWaitEmail(e.target.value)} />
                </div>
                {error && <div style={{fontSize:'0.68rem',color:'#E08080',marginBottom:'0.75rem'}}>⚠ {error}</div>}
                <button className="bg" style={{width:'100%',padding:'0.9rem',fontSize:'0.68rem',letterSpacing:'2.5px',opacity:purchasing?0.7:1}} onClick={joinWaitlist} disabled={!!purchasing}>
                  {purchasing === 'waitlist' ? 'Joining…' : 'Join Coach Pro Waitlist'}
                </button>
              </div>
            )
          ) : (
            <>
              {loading && (
                <div style={{textAlign:'center',padding:'2rem 0',color:'var(--muted)',fontSize:'0.85rem'}}>Loading plans…</div>
              )}

              {error && !loading && (
                <div style={{background:'rgba(192,105,94,0.1)',border:'1px solid rgba(192,105,94,0.3)',borderRadius:'var(--r)',padding:'0.7rem 1rem',marginBottom:'1rem',fontSize:'0.78rem',color:'#E08080'}}>
                  ⚠ {error}
                </div>
              )}

              {!loading && packages.map(pkg => {
                const { tier, cadence } = labelFor(pkg);
                const price = pkg.product?.priceString || '';
                const busy = purchasing === pkg.identifier;
                return (
                  <button
                    key={pkg.identifier}
                    onClick={() => buy(pkg)}
                    disabled={!!purchasing}
                    style={{
                      width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',
                      padding:'0.95rem 1.1rem',marginBottom:'0.6rem',cursor:'pointer',
                      background:'rgba(191,161,106,0.04)',
                      border:'1px solid rgba(191,161,106,0.18)',borderRadius:'var(--r)',
                      color:'var(--ivory)',textAlign:'left',opacity:busy?0.6:1,transition:'all 0.15s',
                    }}
                  >
                    <span style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                      <span style={{fontFamily:"'Cormorant SC',serif",fontSize:'1.05rem',letterSpacing:'2px',fontWeight:600}}>{tier}</span>
                      <span style={{fontSize:'0.62rem',color:'var(--muted)',letterSpacing:'1px'}}>{cadence}</span>
                    </span>
                    <span style={{fontFamily:"'Cormorant SC',serif",fontSize:'1.2rem',color:'var(--gold)',letterSpacing:'1px'}}>
                      {busy ? '…' : price}
                    </span>
                  </button>
                );
              })}

              {!loading && (
                <button
                  onClick={restore}
                  disabled={!!purchasing}
                  style={{width:'100%',background:'none',border:'none',color:'var(--gold-lt,var(--gold))',fontSize:'0.72rem',letterSpacing:'1px',cursor:'pointer',padding:'0.6rem',marginTop:'0.2rem'}}
                >
                  {purchasing === 'restore' ? 'Restoring…' : 'Restore Purchases'}
                </button>
              )}

              {/* Apple-required disclosures */}
              <p style={{fontSize:'0.6rem',lineHeight:1.6,color:'var(--muted)',marginTop:'1rem',textAlign:'center',letterSpacing:'0.3px'}}>
                Payment is charged to your Apple ID at confirmation of purchase.
                Subscriptions renew automatically unless auto-renew is turned off at
                least 24 hours before the end of the current period. Your account is
                charged for renewal within 24 hours before the end of the current period.
                Manage or cancel anytime in your App Store account settings.
                {' '}
                <a href="https://elite-athlete.app/terms-of-service.html" style={{color:'var(--muted)',textDecoration:'underline'}}>Terms of Use</a>
                {' · '}
                <a href="https://elite-athlete.app/privacy-policy.html" style={{color:'var(--muted)',textDecoration:'underline'}}>Privacy Policy</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
