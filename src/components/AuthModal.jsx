// ─────────────────────────────────────────────────────────────
// src/components/AuthModal.jsx
// Supabase email/password auth — Sign In & Sign Up
// ─────────────────────────────────────────────────────────────
import { useState } from 'react';
import { signIn, signUp, supabase } from '../lib/supabase';

export default function AuthModal({ onClose, onAuth }) {
  const [mode, setMode]           = useState('signin'); // 'signin' | 'signup' | 'reset'
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    // Password reset mode
    if (mode === 'reset') {
      if (!email) { setError('Enter your email address.'); return; }
      setLoading(true);
      try {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (e) throw e;
        setSuccess('Password reset link sent — check your email.');
      } catch (err) { setError(err.message || 'Failed to send reset email.'); }
      finally { setLoading(false); }
      return;
    }
    if (!email || !password) { setError('Email and password required.'); return; }
    if (mode === 'signup' && password !== confirm) { setError('Passwords do not match.'); return; }
    if (mode === 'signup' && password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const data = await signUp(email, password);
        if (data.user && !data.session) {
          setSuccess('Check your email to confirm your account, then sign in.');
        } else if (data.session) {
          onAuth(data.session.user); onClose();
        }
      } else {
        const data = await signIn(email, password);
        onAuth(data.user); onClose();
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  // Eye icon SVG — open (visible) and closed (hidden)
  const EyeIcon = ({ visible }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {visible ? (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </>
      )}
    </svg>
  );

  const pwField = (label, val, setVal, show, setShow, placeholder, key) => (
    <div className="f" key={key}>
      <label className="fl">{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="fi"
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          value={val}
          style={{ paddingRight: '2.5rem' }}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          style={{
            position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: show ? 'var(--gold)' : 'var(--muted)', padding: '0.2rem',
            display: 'flex', alignItems: 'center',
          }}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          <EyeIcon visible={show} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="pmbg" onClick={onClose}>
      <div className="pm" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="pmh">
          <div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: '1.4rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--ivory)' }}>
              {mode === 'signin' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Reset Password'}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '1.5px', marginTop: '0.25rem' }}>
              {mode === 'signin' ? 'Sign in to your Elite Athlete account' : mode === 'signup' ? 'Join the Premier Athletic Platform' : 'Enter your email to receive a reset link'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div className="pmb">
          {mode !== 'reset' && (
            <div className="ptabs" style={{ marginBottom: '1.6rem' }}>
              <button className={`ptab${mode === 'signin' ? ' on' : ''}`} onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}>Sign In</button>
              <button className={`ptab${mode === 'signup' ? ' on' : ''}`} onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}>Create Account</button>
            </div>
          )}
          {error && (
            <div style={{ background: 'rgba(192,105,94,0.1)', border: '1px solid rgba(192,105,94,0.3)', borderRadius: 'var(--r)', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#E08080' }}>
              ⚠ {error}
            </div>
          )}
          {success && (
            <div style={{ background: 'rgba(75,174,113,0.1)', border: '1px solid rgba(75,174,113,0.3)', borderRadius: 'var(--r)', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#4BAE71' }}>
              ✓ {success}
            </div>
          )}

          <div className="f">
            <label className="fl">Email Address</label>
            <input className="fi" type="email" placeholder="champion@example.com" value={email}
              onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          </div>

          {mode !== 'reset' && pwField('Password', password, setPassword, showPass, setShowPass,
            mode === 'signup' ? 'Minimum 8 characters' : '••••••••', 'pw')}

          {mode === 'signup' &&
            pwField('Confirm Password', confirm, setConfirm, showConf, setShowConf, 'Re-enter password', 'conf')}

          <button
            className="bg"
            style={{ width: '100%', padding: '0.95rem', fontSize: '0.68rem', letterSpacing: '2.5px', marginTop: '0.5rem', opacity: loading ? 0.7 : 1 }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
            {mode === 'signin' && (<>
              <button onClick={() => { setMode('reset'); setError(''); setSuccess(''); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit', textDecoration: 'underline' }}>Forgot password?</button>
              <span style={{ margin: '0 0.5rem' }}>·</span>
              <button onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit' }}>Create account</button>
            </>)}
            {mode === 'signup' && (<>Have an account? <button onClick={() => setMode('signin')} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit' }}>Sign in</button></>)}
            {mode === 'reset'  && (<button onClick={() => { setMode('signin'); setError(''); setSuccess(''); }} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit' }}>← Back to Sign In</button>)}
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--r)', padding: '0.65rem 1rem', marginTop: '1.25rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 300 }}>Secured by Supabase · 256-bit encryption · Your data is private</span>
          </div>
        </div>
      </div>
    </div>
  );
}
