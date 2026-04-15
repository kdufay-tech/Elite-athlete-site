// ─────────────────────────────────────────────────────────────
// src/components/PayModal.jsx
// 4-Tier checkout: Free · Athlete · Elite · Coach Pro
// Annual/Monthly toggle — annual is default
// ─────────────────────────────────────────────────────────────
import { useState } from 'react';
import { redirectToCheckout, validateCard, formatCardNumber, formatExpiry, TIER_INFO } from '../lib/stripe';

export default function PayModal({ plan, tab, setTab, onClose, onSuccess, userEmail, userId }) {
  // plan can be { tierKey:'elite' } (new) or legacy { name:'Elite', price:'$79' }
  const tierKey = plan?.tierKey
    || (plan?.name?.toLowerCase().includes('coach') ? 'coach'
      : plan?.name?.toLowerCase().includes('athlete') ? 'athlete' : 'elite');
  const info = TIER_INFO[tierKey] || TIER_INFO.elite;

  const [billing,    setBilling]    = useState('annual'); // annual default
  const [cardName,   setCardName]   = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry,     setExpiry]     = useState('');
  const [cvv,        setCvv]        = useState('');
  const [errors,     setErrors]     = useState({});
  const [loading,    setLoading]    = useState(false);
  const [apiError,   setApiError]   = useState('');
  const [waitEmail,  setWaitEmail]  = useState(userEmail || '');
  const [waitSent,   setWaitSent]   = useState(false);

  const billingInfo = billing === 'annual' ? info.annual : info.monthly;
  const priceKey    = billingInfo?.key;
  const planName    = billingInfo?.planName;

  const handleCheckout = async () => {
    setApiError('');
    if (tab === 'card') {
      const errs = validateCard({ number: cardNumber, expiry, cvv, name: cardName });
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;
    }
    setLoading(true);
    try {
      await redirectToCheckout({
        priceKey,
        planName,
        userEmail,
        userId,
        successUrl: `${window.location.origin}?payment=success&plan=${planName}`,
        cancelUrl:  `${window.location.origin}?payment=cancelled`,
      });
      onSuccess();
    } catch (err) {
      setApiError(err.message || 'Payment failed. Please try again.');
      console.error('Checkout error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWaitlist = async () => {
    if (!waitEmail.includes('@')) { setApiError('Please enter a valid email.'); return; }
    setLoading(true);
    try {
      await fetch('/.netlify/functions/coach-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: waitEmail }),
      }).catch(() => {});
      setWaitSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pmbg" onClick={onClose}>
      <div className="pm" onClick={e => e.stopPropagation()}>
        <div className="pmh">
          <div>
            <div style={{fontFamily:"'Cormorant SC',serif",fontSize:'1.55rem',fontWeight:600,letterSpacing:'3px',color:'var(--ivory)'}}>
              {info.waitlist ? 'Join Waitlist' : 'Secure Checkout'}
            </div>
            <div style={{color:'var(--gold)',fontSize:'0.62rem',letterSpacing:'2px',marginTop:'0.22rem'}}>
              {info.tier} · {info.label}
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:'1.5rem',cursor:'pointer',lineHeight:1}}>×</button>
        </div>

        <div className="pmb">
          {/* Security badge */}
          <div style={{background:'rgba(191,161,106,0.05)',border:'1px solid rgba(191,161,106,0.14)',borderRadius:'var(--r)',padding:'0.85rem 1rem',marginBottom:'1.25rem',display:'flex',gap:'0.7rem',alignItems:'center'}}>
            <span>🔒</span>
            <span style={{fontSize:'0.72rem',color:'var(--ivory2)',fontWeight:300}}>256-bit SSL · PCI DSS Compliant · Powered by Stripe</span>
          </div>

          {/* ── COACH PRO WAITLIST ── */}
          {info.waitlist ? (
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
                <div style={{fontSize:'0.68rem',color:'var(--muted)',letterSpacing:'1px',marginBottom:'0.5rem'}}>INCLUDES</div>
                <ul style={{marginBottom:'1.25rem',paddingLeft:'1.25rem'}}>
                  {info.features.map(f => <li key={f} style={{fontSize:'0.82rem',color:'var(--ivory2)',marginBottom:'0.3rem',fontWeight:300}}>{f}</li>)}
                </ul>
                <div style={{fontSize:'0.68rem',color:'var(--muted)',letterSpacing:'1px',marginBottom:'0.35rem'}}>PRICING</div>
                <div style={{fontSize:'0.88rem',color:'var(--gold)',marginBottom:'1.25rem'}}>
                  {info.monthly.price}/month + {info.perAthlete}
                  <span style={{color:'var(--muted)',marginLeft:'8px'}}>· or {info.annual.price}/year + $39.99/ath/yr</span>
                </div>
                <div className="f">
                  <label className="fl">Your Email</label>
                  <input className="fi" placeholder="coach@school.edu" value={waitEmail} onChange={e => setWaitEmail(e.target.value)} />
                </div>
                {apiError && <div style={{fontSize:'0.68rem',color:'#E08080',marginBottom:'0.75rem'}}>⚠ {apiError}</div>}
                <button className="bg" style={{width:'100%',padding:'0.9rem',fontSize:'0.68rem',letterSpacing:'2.5px',opacity:loading?0.7:1}} onClick={handleWaitlist} disabled={loading}>
                  {loading ? 'Joining…' : 'Join Coach Pro Waitlist'}
                </button>
              </div>
            )
          ) : (
            <>
              {/* ── BILLING TOGGLE — annual is default ── */}
              <div style={{display:'flex',background:'rgba(255,255,255,0.04)',borderRadius:'var(--r)',padding:'3px',marginBottom:'1.25rem',gap:'3px'}}>
                <button onClick={() => setBilling('annual')} style={{
                  flex:1,padding:'0.55rem',fontSize:'0.7rem',letterSpacing:'1px',
                  borderRadius:'calc(var(--r) - 2px)',border:'none',cursor:'pointer',transition:'all 0.15s',
                  background: billing==='annual' ? 'var(--gold)' : 'transparent',
                  color:       billing==='annual' ? '#0a0908'    : 'var(--muted)',
                  fontWeight:  billing==='annual' ? 700          : 400,
                }}>
                  Annual
                  {billing==='annual' && <span style={{fontSize:'0.58rem',marginLeft:'5px',opacity:0.85}}> · {info.annual.save}</span>}
                </button>
                <button onClick={() => setBilling('monthly')} style={{
                  flex:1,padding:'0.55rem',fontSize:'0.7rem',letterSpacing:'1px',
                  borderRadius:'calc(var(--r) - 2px)',border:'none',cursor:'pointer',transition:'all 0.15s',
                  background: billing==='monthly' ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color:       billing==='monthly' ? 'var(--ivory)' : 'var(--muted)',
                }}>
                  Monthly <span style={{fontSize:'0.58rem',opacity:0.6}}>(Flexible)</span>
                </button>
              </div>

              {/* ── PRICE DISPLAY ── */}
              <div style={{textAlign:'center',marginBottom:'1.25rem',padding:'0.75rem',background:'rgba(191,161,106,0.04)',borderRadius:'var(--r)',border:'1px solid rgba(191,161,106,0.12)'}}>
                <div style={{fontFamily:"'Cormorant SC',serif",fontSize:'2.5rem',fontWeight:600,color:'var(--gold)',letterSpacing:'2px',lineHeight:1.1}}>
                  {billingInfo?.price}
                </div>
                <div style={{fontSize:'0.65rem',color:'var(--muted)',letterSpacing:'1px',marginTop:'3px'}}>
                  {billing==='annual' ? 'billed annually' : 'billed monthly'}
                </div>
                {billing==='annual' && (
                  <div style={{fontSize:'0.65rem',color:'var(--gold-lt)',marginTop:'2px'}}>
                    {info.annual.moEquiv} · {info.annual.save}
                  </div>
                )}
              </div>

              {/* ── PAYMENT TABS ── */}
              <div className="ptabs">
                <button className={`ptab${tab==='card'?' on':''}`} onClick={() => setTab('card')}>💳 Credit Card</button>
                <button className={`ptab${tab==='paypal'?' on':''}`} onClick={() => setTab('paypal')}>🅿 PayPal</button>
              </div>

              {apiError && (
                <div style={{background:'rgba(192,105,94,0.1)',border:'1px solid rgba(192,105,94,0.3)',borderRadius:'var(--r)',padding:'0.7rem 1rem',marginBottom:'1rem',fontSize:'0.78rem',color:'#E08080'}}>
                  ⚠ {apiError}
                </div>
              )}

              {tab==='card' && (
                <div>
                  <div className="f">
                    <label className="fl">Cardholder Name</label>
                    <input className="fi" placeholder="John Smith" value={cardName} onChange={e => setCardName(e.target.value)} style={{borderColor:errors.name?'rgba(192,105,94,0.6)':undefined}} />
                    {errors.name && <div style={{fontSize:'0.65rem',color:'#E08080',marginTop:'0.25rem'}}>{errors.name}</div>}
                  </div>
                  <div className="f">
                    <label className="fl">Card Number</label>
                    <input className="fi" placeholder="4242 4242 4242 4242" maxLength="19"
                      value={cardNumber} onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                      style={{borderColor:errors.number?'rgba(192,105,94,0.6)':undefined,letterSpacing:'2px'}} />
                    {errors.number && <div style={{fontSize:'0.65rem',color:'#E08080',marginTop:'0.25rem'}}>{errors.number}</div>}
                  </div>
                  <div className="two">
                    <div className="f">
                      <label className="fl">Expiry</label>
                      <input className="fi" placeholder="MM / YY" maxLength="5"
                        value={expiry} onChange={e => setExpiry(formatExpiry(e.target.value))}
                        style={{borderColor:errors.expiry?'rgba(192,105,94,0.6)':undefined}} />
                      {errors.expiry && <div style={{fontSize:'0.65rem',color:'#E08080',marginTop:'0.25rem'}}>{errors.expiry}</div>}
                    </div>
                    <div className="f">
                      <label className="fl">CVV</label>
                      <input className="fi" placeholder="•••" type="password" maxLength="4"
                        value={cvv} onChange={e => setCvv(e.target.value.replace(/\D/g,''))}
                        style={{borderColor:errors.cvv?'rgba(192,105,94,0.6)':undefined}} />
                      {errors.cvv && <div style={{fontSize:'0.65rem',color:'#E08080',marginTop:'0.25rem'}}>{errors.cvv}</div>}
                    </div>
                  </div>
                  <button className="bg" style={{width:'100%',padding:'0.95rem',fontSize:'0.68rem',letterSpacing:'2.5px',opacity:loading?0.7:1,marginTop:'0.5rem'}}
                    onClick={handleCheckout} disabled={loading}>
                    {loading ? 'Redirecting to Stripe…' : `Confirm · ${billingInfo?.price}/${billing==='annual'?'year':'month'}`}
                  </button>
                </div>
              )}

              {tab==='paypal' && (
                <div>
                  <div style={{textAlign:'center',padding:'1rem 0 1.5rem',fontFamily:"'Cormorant Garamond',serif",fontSize:'1.05rem',fontStyle:'italic',color:'var(--ivory2)',lineHeight:1.65}}>
                    You'll be securely redirected to Stripe to complete payment of{' '}
                    <span style={{color:'var(--gold-lt)'}}>{billingInfo?.price}/{billing==='annual'?'year':'month'}</span>
                  </div>
                  <button className="ppb" onClick={handleCheckout} disabled={loading}>
                    {loading ? 'Redirecting…' : <><span style={{fontStyle:'italic',color:'#009CDE',fontSize:'1.2rem'}}>Pay</span><span style={{fontStyle:'italic',color:'#fff',fontSize:'1.2rem'}}>Pal</span> — Complete Secure Payment</>}
                  </button>
                  <p style={{textAlign:'center',fontSize:'0.62rem',color:'var(--muted)',marginTop:'0.9rem',letterSpacing:'1px'}}>Cancel anytime · No hidden fees · Powered by Stripe</p>
                </div>
              )}

              <div style={{display:'flex',justifyContent:'center',gap:'1.4rem',marginTop:'1.4rem',paddingTop:'1rem',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
                {['Visa','Mastercard','Amex','Discover','PayPal'].map(b => (
                  <span key={b} style={{fontSize:'0.58rem',color:'var(--muted)',letterSpacing:'1px'}}>{b}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
