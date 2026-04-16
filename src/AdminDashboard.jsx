import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

const ADMIN_EMAIL = 'admin@eliteathlete.com';

export default function AdminDashboard({ user }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  // Login form state (shown when not signed in as admin)
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // Once user is confirmed as admin, fetch data
  useEffect(() => {
    if (user?.email === ADMIN_EMAIL) fetchData();
  }, [user]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginErr('');
    setLoginBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // user prop will update via parent's onAuthChange → re-render → fetchData fires
    } catch (err) {
      setLoginErr(err.message || 'Sign in failed');
    } finally {
      setLoginBusy(false);
    }
  }

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');
      const res = await fetch('/.netlify/functions/admin-data', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Function returned ' + res.status);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  // ── NOT SIGNED IN → show login form ─────────────────────────
  if (!user) {
    return (
      <div style={s.root}>
        <div style={s.loginWrap}>
          <div style={s.loginBox}>
            <div style={s.eyebrow}>Elite Athlete</div>
            <div style={s.title}>Admin Access</div>
            <form onSubmit={handleLogin} style={{ marginTop: 28 }}>
              <input
                type="email" placeholder="Email" value={email} required
                onChange={e => setEmail(e.target.value)}
                style={s.input}
              />
              <input
                type="password" placeholder="Password" value={password} required
                onChange={e => setPassword(e.target.value)}
                style={{ ...s.input, marginTop: 12 }}
              />
              {loginErr && <div style={s.loginErr}>{loginErr}</div>}
              <button type="submit" disabled={loginBusy} style={s.btnSubmit}>
                {loginBusy ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── WRONG ACCOUNT → deny ─────────────────────────────────────
  if (user.email !== ADMIN_EMAIL) {
    return (
      <div style={s.root}>
        <div style={s.loginWrap}>
          <div style={s.loginBox}>
            <div style={{ color: '#555', letterSpacing: 2, fontSize: 12, marginBottom: 16 }}>ACCESS DENIED</div>
            <div style={{ color: '#333', fontSize: 13 }}>Signed in as {user.email}</div>
            <button onClick={handleLogout} style={{ ...s.btnSubmit, marginTop: 20, background: 'transparent', border: '1px solid #333' }}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ADMIN ─────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.eyebrow}>Elite Athlete</div>
          <div style={s.title}>Admin Dashboard</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={fetchData} style={s.btnGold}>↺ Refresh</button>
          <button onClick={handleLogout} style={s.btnGhost}>Sign Out</button>
        </div>
      </div>

      <div style={s.inner}>
        {loading && <div style={s.center}>Loading...</div>}
        {error   && <div style={{ ...s.center, color: '#e74c3c' }}>{error}</div>}
        {data && <>
          <div style={s.grid}>
            <StatCard label="MRR"           value={`$${data.mrr}`}        sub="monthly recurring revenue" gold />
            <StatCard label="Subscribers"   value={data.totalSubscribers} sub="active Elite members" />
            <StatCard label="Monthly Plans" value={data.monthlyCount}     sub="× $9.99 / mo" />
            <StatCard label="Waitlist"      value={data.waitlistCount}    sub="coach waitlist signups" />
          </div>

          <Section title="Active Subscribers" count={data.subscribers.length}>
            {data.subscribers.length === 0 ? <Empty text="No active subscribers yet." /> :
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead><tr>{['Name','Email','Sport','Position','Plan','Interval','Renews'].map(h =>
                    <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>{data.subscribers.map((sub, i) => (
                    <tr key={sub.id} style={{ background: i % 2 === 0 ? '#0D0D0D' : '#111' }}>
                      <td style={s.td}>{sub.name}</td>
                      <td style={{ ...s.td, color: '#C9A84C', fontSize: 13 }}>{sub.email}</td>
                      <td style={s.td}>{sub.sport}</td>
                      <td style={s.td}>{sub.position}</td>
                      <td style={s.td}>{sub.plan_name}</td>
                      <td style={s.td}><Badge val={sub.billing_interval} /></td>
                      <td style={{ ...s.td, color: '#555', fontSize: 12 }}>
                        {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            }
          </Section>

          <Section title="Coach Waitlist" count={data.waitlist.length}>
            {data.waitlist.length === 0 ? <Empty text="No waitlist signups yet." /> :
              <table style={s.table}>
                <thead><tr>{['Email','Signed Up'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>{data.waitlist.map((w, i) => (
                  <tr key={w.id} style={{ background: i % 2 === 0 ? '#0D0D0D' : '#111' }}>
                    <td style={{ ...s.td, color: '#C9A84C' }}>{w.email}</td>
                    <td style={{ ...s.td, color: '#555', fontSize: 12 }}>
                      {new Date(w.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            }
          </Section>
        </>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, gold }) {
  return (
    <div style={{ background:'#111', borderRadius:12, padding:'22px 24px', border:`1px solid ${gold?'#C9A84C44':'#ffffff0f'}` }}>
      <div style={{ fontSize:10, letterSpacing:3, color:gold?'#C9A84C':'#444', textTransform:'uppercase', marginBottom:10 }}>{label}</div>
      <div style={{ fontSize:34, fontWeight:700, color:gold?'#C9A84C':'#fff', lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:12, color:'#3a3a3a', marginTop:8 }}>{sub}</div>
    </div>
  );
}
function Section({ title, count, children }) {
  return (
    <div style={{ marginBottom:40 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
        <h2 style={{ fontSize:12, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'#fff', margin:0 }}>{title}</h2>
        <span style={{ fontSize:11, background:'#C9A84C1a', color:'#C9A84C', padding:'2px 10px', borderRadius:20, fontWeight:600 }}>{count}</span>
      </div>
      <div style={{ background:'#111', border:'1px solid #ffffff08', borderRadius:12, overflow:'hidden' }}>{children}</div>
    </div>
  );
}
function Empty({ text }) {
  return <div style={{ padding:32, textAlign:'center', color:'#333', fontSize:14 }}>{text}</div>;
}
function Badge({ val }) {
  const yr = val === 'year';
  return <span style={{ fontSize:10, padding:'3px 8px', borderRadius:4, letterSpacing:1, textTransform:'uppercase', background:yr?'#C9A84C1a':'#ffffff0a', color:yr?'#C9A84C':'#666' }}>{yr?'Annual':'Monthly'}</span>;
}

const s = {
  root:      { minHeight:'100vh', background:'#0D0D0D', color:'#fff', fontFamily:"'Rajdhani','Inter',sans-serif", paddingBottom:60 },
  loginWrap: { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh' },
  loginBox:  { background:'#111', border:'1px solid #C9A84C22', borderRadius:16, padding:'40px 36px', width:320, textAlign:'center' },
  header:    { background:'#111', borderBottom:'1px solid #C9A84C1a', padding:'20px 32px', display:'flex', alignItems:'center', justifyContent:'space-between' },
  eyebrow:   { fontSize:10, letterSpacing:4, color:'#C9A84C', textTransform:'uppercase', marginBottom:4 },
  title:     { fontSize:22, fontWeight:700, letterSpacing:1 },
  inner:     { maxWidth:1100, margin:'0 auto', padding:'36px 24px' },
  grid:      { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:44 },
  center:    { textAlign:'center', color:'#444', paddingTop:80, fontSize:15 },
  table:     { width:'100%', borderCollapse:'collapse', fontSize:14 },
  th:        { padding:'12px 16px', textAlign:'left', fontSize:10, letterSpacing:2, color:'#333', textTransform:'uppercase', borderBottom:'1px solid #ffffff08', fontWeight:600 },
  td:        { padding:'14px 16px', borderBottom:'1px solid #ffffff04', color:'#bbb' },
  input:     { width:'100%', background:'#0D0D0D', border:'1px solid #ffffff15', borderRadius:8, padding:'11px 14px', color:'#fff', fontSize:14, fontFamily:'inherit', boxSizing:'border-box', outline:'none' },
  loginErr:  { color:'#e74c3c', fontSize:12, marginTop:10, textAlign:'left' },
  btnSubmit: { width:'100%', marginTop:18, background:'#C9A84C', border:'none', borderRadius:8, padding:'12px', color:'#0D0D0D', fontSize:14, fontWeight:700, letterSpacing:1, cursor:'pointer', fontFamily:'inherit' },
  btnGold:   { background:'transparent', border:'1px solid #C9A84C44', color:'#C9A84C', padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, letterSpacing:1, fontFamily:'inherit' },
  btnGhost:  { background:'transparent', border:'1px solid #ffffff12', color:'#555', padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, fontFamily:'inherit' },
};
