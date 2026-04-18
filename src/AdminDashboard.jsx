import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { sendEmail } from './lib/email';

const ADMIN_EMAIL = 'admin@eliteathlete.com';

export default function AdminDashboard() {
  const [adminUser,   setAdminUser]   = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [loginErr,    setLoginErr]    = useState('');
  const [loginBusy,   setLoginBusy]   = useState(false);
  const [testEmail,   setTestEmail]   = useState('');
  const [testMsg,     setTestMsg]     = useState(null);
  const [testBusy,    setTestBusy]    = useState(false);
  const [newCode,     setNewCode]     = useState('');
  const [newLabel,    setNewLabel]    = useState('');
  const [newMaxUses,  setNewMaxUses]  = useState('');
  const [codeMsg,     setCodeMsg]     = useState(null);
  const [codeBusy,    setCodeBusy]    = useState(false);
  // ── Beta Invite Email Flow state ──
  const [betaEmails,      setBetaEmails]      = useState('');
  const [betaCodeType,    setBetaCodeType]    = useState('ATHLETE2026');
  const [betaSending,     setBetaSending]     = useState(false);
  const [betaSendResults, setBetaSendResults] = useState(null);
  const [betaSendProgress, setBetaSendProgress] = useState('');
  const [adminTab, setAdminTab] = useState('overview');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email === ADMIN_EMAIL) setAdminUser(session.user);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (adminUser?.email === ADMIN_EMAIL) fetchData();
  }, [adminUser]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginErr(''); setLoginBusy(true);
    try {
      const { data: { user }, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (user?.email !== ADMIN_EMAIL) {
        await supabase.auth.signOut();
        throw new Error('This account does not have admin access.');
      }
      setAdminUser(user);
    } catch (err) {
      setLoginErr(err.message || 'Sign in failed');
    } finally { setLoginBusy(false); }
  }

  async function fetchData() {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');
      const res = await fetch('/.netlify/functions/admin-data', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Function returned ' + res.status);
      setData(await res.json());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setAdminUser(null); setData(null); setEmail(''); setPassword('');
  }

  async function callAction(action, extraBody = {}) {
    setTestBusy(true); setTestMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email: testEmail, ...extraBody }),
      });
      const json = await res.json();
      setTestMsg({ text: json.message || json.error, ok: res.ok });
      if (res.ok) fetchData();
    } catch(err) { setTestMsg({ text: err.message, ok: false }); }
    finally { setTestBusy(false); }
  }

  async function createBetaCode() {
    if (!newCode.trim()) return;
    setCodeBusy(true); setCodeMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_beta_code', code: newCode.trim().toUpperCase(), label: newLabel || newCode, max_uses: newMaxUses ? parseInt(newMaxUses) : null }),
      });
      const json = await res.json();
      setCodeMsg({ text: json.message || json.error, ok: res.ok });
      if (res.ok) { setNewCode(''); setNewLabel(''); setNewMaxUses(''); fetchData(); }
    } catch(err) { setCodeMsg({ text: err.message, ok: false }); }
    finally { setCodeBusy(false); }
  }

  async function toggleCode(code_id, active) {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/.netlify/functions/admin-action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_beta_code', code_id, active }),
    });
    fetchData();
  }

  // ── Beta Invite Email Flow ──
  async function sendBetaInvites() {
    const emailList = betaEmails
      .split(/[,;\n]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (!emailList.length) return;

    setBetaSending(true);
    setBetaSendResults(null);
    const results = { sent: 0, failed: 0, errors: [] };
    const betaDays = betaCodeType === 'COACH2026' ? '45' : '30';
    const betaTier = betaCodeType === 'COACH2026' ? 'Coach' : 'Athlete';

    for (let i = 0; i < emailList.length; i++) {
      const addr = emailList[i];
      setBetaSendProgress(`Sending ${i + 1} of ${emailList.length}...`);
      try {
        if (i > 0) await new Promise(r => setTimeout(r, 1200));
        await sendEmail({
          toEmail: addr,
          fromName: 'Elite Athlete',
          subject: `You're Invited to Elite Athlete Beta — ${betaTier} Access`,
          message: `You have been selected for exclusive beta access to Elite Athlete — The Premier Athletic Platform.\n\nYour Beta Access Code: ${betaCodeType}\nAccess Duration: ${betaDays} days of full premium access\nActivation Link: https://the-elite-athlete.netlify.app\n\nHOW TO ACTIVATE:\n1. Visit https://the-elite-athlete.netlify.app\n2. Create your account (email + password)\n3. Enter your beta code: ${betaCodeType}\n4. Select your sport and position\n5. Your personalized dashboard loads instantly\n\nWHAT YOU GET:\n• Sport & position-specific meal plans\n• Periodized training programs for your position\n• Injury recovery protocols with rehab guidance\n• AI-powered coaching\n• 180+ supplement recommendations\n• Progress tracking, journals & calendar\n• PDF export and email delivery for all plans\n${betaCodeType === 'COACH2026' ? '\nAS A COACH:\n• Share this code with your entire roster\n• Each athlete gets their own account\n• Full data export to track athlete progress\n' : ''}\nThis is a limited beta — your feedback will shape the future of Elite Athlete.\n\nQuestions? Visit: https://the-elite-athlete.netlify.app/report-bug.html\n\n— The Elite Athlete Team\nEngineered for Champions`,
          replyTo: 'noreply@elite-athlete.app',
        });
        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${addr}: ${err?.text || err?.message || 'Failed'}`);
      }
    }

    setBetaSending(false);
    setBetaSendProgress('');
    setBetaSendResults(results);
    if (results.sent > 0) setBetaEmails('');
  }

  if (!authChecked) return (
    <div style={{...s.root,display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>
      <div style={{color:'#C9A84C',fontSize:12,letterSpacing:4}}>LOADING…</div>
    </div>
  );

  if (!adminUser) return (
    <div style={s.root}>
      <div style={s.loginWrap}>
        <div style={s.loginBox}>
          <div style={s.eyebrow}>Elite Athlete</div>
          <div style={s.title}>Admin Access</div>
          <form onSubmit={handleLogin} style={{marginTop:28}}>
            <input type="email" placeholder="Email" value={email} required
              onChange={e=>setEmail(e.target.value)} style={s.input} />
            <input type="password" placeholder="Password" value={password} required
              onChange={e=>setPassword(e.target.value)} style={{...s.input,marginTop:12}} />
            {loginErr && <div style={s.loginErr}>{loginErr}</div>}
            <button type="submit" disabled={loginBusy} style={s.btnSubmit}>
              {loginBusy ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.eyebrow}>Elite Athlete</div>
          <div style={s.title}>Admin Dashboard</div>
        </div>
        <div style={{display:'flex',gap:12}}>
          <button onClick={fetchData} style={s.btnGold}>↺ Refresh</button>
          <button onClick={handleLogout} style={s.btnGhost}>Sign Out</button>
        </div>
      </div>
      <div style={s.inner}>
        {loading && <div style={s.center}>Loading...</div>}
        {error && <div style={{...s.center,color:'#e74c3c'}}>{error}</div>}
        {data && <>
          {/* ── Stat Cards (always visible) ── */}
          <div style={s.grid}>
            <StatCard label="MRR" value={`$${data.mrr}`} sub="monthly recurring revenue" gold />
            <StatCard label="Subscribers" value={data.totalSubscribers} sub="paid Elite members" />
            <StatCard label="Beta Users" value={data.betaCount} sub={`${data.betaCount - data.betaExpired} active`} blue />
            <StatCard label="Waitlist" value={data.waitlistCount} sub="coach waitlist signups" />
          </div>

          {/* ── Navigation Tiles ── */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10,marginBottom:40}}>
            {[
              ['overview','◆','Overview'],
              ['beta','β','Beta Users'],
              ['codes','⌘','Codes & Invites'],
              ['subscribers','$','Subscribers'],
              ['waitlist','✉','Waitlist'],
              ['feedback','★','Feedback'],
            ].map(([key,icon,label])=>(
              <button key={key} onClick={()=>setAdminTab(key)} style={{
                background: adminTab===key ? '#C9A84C12' : '#111',
                border: adminTab===key ? '1.5px solid #C9A84C' : '1px solid #ffffff0a',
                borderRadius:10, padding:'18px 12px', cursor:'pointer', fontFamily:'inherit', textAlign:'center',
                transition:'all 0.2s',
              }}>
                <div style={{fontSize:22,marginBottom:6,opacity:adminTab===key?1:0.4}}>{icon}</div>
                <div style={{fontSize:10,letterSpacing:2,textTransform:'uppercase',color:adminTab===key?'#C9A84C':'#555',fontWeight:600}}>{label}</div>
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ── */}
          {adminTab === 'overview' && <>
            <div style={{marginBottom:40,background:'#111',border:'1px solid #C9A84C22',borderRadius:12,padding:'24px 28px'}}>
              <div style={{fontSize:12,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#C9A84C',marginBottom:16}}>◆ Test Access — Grant / Revoke Elite</div>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                <input type="email" placeholder="user@email.com" value={testEmail}
                  onChange={e=>{setTestEmail(e.target.value);setTestMsg(null);}}
                  style={{...s.input,width:280,flex:'0 0 auto'}} />
                <button onClick={()=>callAction('grant')} disabled={testBusy||!testEmail} style={s.btnGold}>{testBusy?'...':'Grant Elite'}</button>
                <button onClick={()=>callAction('revoke')} disabled={testBusy||!testEmail} style={{...s.btnGhost,borderColor:'#e74c3c44',color:'#e74c3c99'}}>{testBusy?'...':'Revoke'}</button>
              </div>
              {testMsg && <div style={{marginTop:12,fontSize:13,color:testMsg.ok?'#C9A84C':'#e74c3c'}}>{testMsg.ok?'✓':'✗'} {testMsg.text}</div>}
              <div style={{marginTop:10,fontSize:11,color:'#333'}}>Grant writes an active subscription row directly to Supabase. User must refresh their app to see updated access.</div>
            </div>
            <div style={{...s.grid,gridTemplateColumns:'repeat(4,1fr)'}}>
              <StatCard label="Monthly Plans" value={data.monthlyCount} sub="× $9.99 / mo" />
              <StatCard label="Active Beta" value={data.betaCount - data.betaExpired} sub="still in window" />
              <StatCard label="Beta Expired" value={data.betaExpired} sub="conversion opportunity" />
              <StatCard label="Beta Codes" value={data.betaCodes?.length||0} sub="invite codes" />
            </div>
          </>}

          {/* ── BETA USERS TAB ── */}
          {adminTab === 'beta' && (
            <Section title="Beta Users" count={data.betaCount}>
              {!data.betaUsers?.length ? <Empty text="No beta users yet." /> :
                <div style={{overflowX:'auto'}}>
                  <table style={s.table}><thead><tr>
                    {['Email','Sport','Code','Days Left','Expires','Status'].map(h=><th key={h} style={s.th}>{h}</th>)}
                  </tr></thead><tbody>
                    {data.betaUsers.map((u,i)=>(
                      <tr key={u.id} style={{background:i%2===0?'#0D0D0D':'#111'}}>
                        <td style={{...s.td,color:'#C9A84C',fontSize:13}}>{u.email}</td>
                        <td style={s.td}>{u.sport}</td>
                        <td style={{...s.td,fontFamily:'monospace',fontSize:12}}>{u.stripe_customer_id?.replace('beta_','')}</td>
                        <td style={{...s.td,color:u.expired?'#e74c3c':u.days_left<=7?'#f39c12':'#4BAE71',fontWeight:700}}>{u.expired?'—':u.days_left}</td>
                        <td style={{...s.td,color:'#555',fontSize:12}}>{u.beta_expires_at?new Date(u.beta_expires_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'}</td>
                        <td style={s.td}><span style={{fontSize:10,padding:'3px 8px',borderRadius:4,letterSpacing:1,textTransform:'uppercase',background:u.expired?'rgba(231,76,60,0.15)':'rgba(75,174,113,0.15)',color:u.expired?'#e74c3c':'#4BAE71'}}>{u.expired?'Expired':'Active'}</span></td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              }
            </Section>
          )}

          {/* ── CODES & INVITES TAB ── */}
          {adminTab === 'codes' && <>
            <div style={{marginBottom:40,background:'#111',border:'1px solid #ffffff08',borderRadius:12,padding:'24px 28px'}}>
              <div style={{fontSize:12,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#C9A84C',marginBottom:20}}>◆ Beta Codes</div>
              {data.betaCodes?.length > 0 && (
                <table style={{...s.table,marginBottom:24}}><thead><tr>
                  {['Code','Label','Uses','Max','Days','Status',''].map(h=><th key={h} style={s.th}>{h}</th>)}
                </tr></thead><tbody>
                  {data.betaCodes.map((c,i)=>(
                    <tr key={c.id} style={{background:i%2===0?'#0D0D0D':'#111'}}>
                      <td style={{...s.td,fontFamily:'monospace',color:'#C9A84C',letterSpacing:2}}>{c.code}</td>
                      <td style={s.td}>{c.label}</td>
                      <td style={{...s.td,fontWeight:700}}>{c.uses}</td>
                      <td style={{...s.td,color:'#555'}}>{c.max_uses??'∞'}</td>
                      <td style={s.td}>{c.duration_days}</td>
                      <td style={s.td}><Badge val={c.active?'active':'inactive'}/></td>
                      <td style={s.td}><button onClick={()=>toggleCode(c.id,!c.active)} style={{background:'transparent',border:'1px solid #333',borderRadius:4,color:'#666',padding:'3px 10px',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>{c.active?'Deactivate':'Activate'}</button></td>
                    </tr>
                  ))}
                </tbody></table>
              )}
              <div style={{borderTop:'1px solid #ffffff08',paddingTop:20}}>
                <div style={{fontSize:11,letterSpacing:2,color:'#444',textTransform:'uppercase',marginBottom:12}}>Create New Code</div>
                <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
                  <div><div style={{fontSize:10,color:'#333',marginBottom:4}}>CODE *</div><input style={{...s.input,width:160,fontFamily:'monospace',letterSpacing:2}} placeholder="LAUNCH2026" value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())}/></div>
                  <div><div style={{fontSize:10,color:'#333',marginBottom:4}}>LABEL</div><input style={{...s.input,width:200}} placeholder="Campaign label" value={newLabel} onChange={e=>setNewLabel(e.target.value)}/></div>
                  <div><div style={{fontSize:10,color:'#333',marginBottom:4}}>MAX USES</div><input style={{...s.input,width:100}} type="number" placeholder="∞" value={newMaxUses} onChange={e=>setNewMaxUses(e.target.value)}/></div>
                  <button onClick={createBetaCode} disabled={codeBusy||!newCode} style={s.btnGold}>{codeBusy?'…':'+ Create'}</button>
                </div>
                {codeMsg && <div style={{marginTop:10,fontSize:13,color:codeMsg.ok?'#C9A84C':'#e74c3c'}}>{codeMsg.ok?'✓':'✗'} {codeMsg.text}</div>}
              </div>
            </div>

            <div style={{marginBottom:40,background:'#111',border:'1px solid #C9A84C22',borderRadius:12,padding:'24px 28px'}}>
              <div style={{fontSize:12,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#C9A84C',marginBottom:20}}>◆ Beta Invite Email Flow</div>
              <div style={{display:'flex',gap:10,marginBottom:18}}>
                {[['ATHLETE2026','Athlete · 30 days'],['COACH2026','Coach · 45 days']].map(([code,label])=>(
                  <button key={code} onClick={()=>setBetaCodeType(code)} style={{
                    flex:1, padding:'12px 16px', borderRadius:8, cursor:'pointer', fontFamily:'inherit', fontSize:13, fontWeight:600, letterSpacing:1,
                    border: betaCodeType===code ? '2px solid #C9A84C' : '1px solid #ffffff12',
                    background: betaCodeType===code ? '#C9A84C12' : '#0D0D0D',
                    color: betaCodeType===code ? '#C9A84C' : '#555',
                  }}>{code}<div style={{fontSize:10,fontWeight:400,letterSpacing:0,marginTop:4,opacity:0.7}}>{label}</div></button>
                ))}
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,letterSpacing:2,color:'#444',textTransform:'uppercase',marginBottom:6}}>Email Addresses (comma, semicolon, or newline separated)</div>
                <textarea value={betaEmails} onChange={e=>setBetaEmails(e.target.value)}
                  placeholder={"coach@university.edu, athlete1@gmail.com\nathlete2@gmail.com"} rows={5}
                  style={{width:'100%',background:'#0D0D0D',border:'1px solid #ffffff15',borderRadius:8,padding:12,color:'#fff',fontSize:13,fontFamily:'monospace',resize:'vertical',boxSizing:'border-box',outline:'none',lineHeight:1.6}} />
                <div style={{fontSize:11,color:'#333',marginTop:4}}>
                  {betaEmails.split(/[,;\n]+/).filter(e=>e.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())).length} valid email(s) detected
                </div>
              </div>
              <button onClick={sendBetaInvites} disabled={betaSending||!betaEmails.trim()}
                style={{width:'100%',padding:'14px 24px',borderRadius:8,border:'none',fontFamily:'inherit',background:betaSending?'#333':'#C9A84C',color:'#0D0D0D',fontWeight:700,fontSize:14,letterSpacing:2,cursor:betaSending?'not-allowed':'pointer',textTransform:'uppercase',opacity:(!betaEmails.trim()&&!betaSending)?0.4:1}}>
                {betaSending ? betaSendProgress||'Sending...' : `Send ${betaCodeType} Invites`}
              </button>
              {betaSendResults && (
                <div style={{marginTop:16,padding:16,background:'#0D0D0D',borderRadius:8,border:'1px solid #ffffff08'}}>
                  <div style={{fontSize:14,color:'#4BAE71',marginBottom:4}}>✓ Sent: {betaSendResults.sent}</div>
                  {betaSendResults.failed>0 && <>
                    <div style={{fontSize:14,color:'#e74c3c',marginBottom:8}}>✗ Failed: {betaSendResults.failed}</div>
                    {betaSendResults.errors.map((err,i)=><div key={i} style={{fontSize:11,color:'#e74c3c88',marginBottom:2}}>{err}</div>)}
                  </>}
                </div>
              )}
            </div>
          </>}

          {/* ── SUBSCRIBERS TAB ── */}
          {adminTab === 'subscribers' && (
            <Section title="Active Subscribers" count={data.subscribers.length}>
              {!data.subscribers.length ? <Empty text="No active subscribers yet." /> :
                <div style={{overflowX:'auto'}}><table style={s.table}>
                  <thead><tr>{['Name','Email','Sport','Position','Plan','Interval','Renews'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>{data.subscribers.map((sub,i)=>(
                    <tr key={sub.id} style={{background:i%2===0?'#0D0D0D':'#111'}}>
                      <td style={s.td}>{sub.name}</td>
                      <td style={{...s.td,color:'#C9A84C',fontSize:13}}>{sub.email}</td>
                      <td style={s.td}>{sub.sport}</td>
                      <td style={s.td}>{sub.position}</td>
                      <td style={s.td}>{sub.plan_name}</td>
                      <td style={s.td}><Badge val={sub.billing_interval}/></td>
                      <td style={{...s.td,color:'#555',fontSize:12}}>{sub.current_period_end?new Date(sub.current_period_end).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              }
            </Section>
          )}

          {/* ── WAITLIST TAB ── */}
          {adminTab === 'waitlist' && (
            <Section title="Coach Waitlist" count={data.waitlist.length}>
              {!data.waitlist.length ? <Empty text="No waitlist signups yet." /> :
                <table style={s.table}>
                  <thead><tr>{['Email','Signed Up'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>{data.waitlist.map((w,i)=>(
                    <tr key={w.id} style={{background:i%2===0?'#0D0D0D':'#111'}}>
                      <td style={{...s.td,color:'#C9A84C'}}>{w.email}</td>
                      <td style={{...s.td,color:'#555',fontSize:12}}>{new Date(w.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                    </tr>
                  ))}</tbody>
                </table>
              }
            </Section>
          )}

          {/* ── FEEDBACK TAB ── */}
          {adminTab === 'feedback' && (
            <Section title="Beta Feedback" count={data.feedback?.length||0}>
              {!data.feedback?.length ? <Empty text="No feedback yet." /> :
                <div style={{overflowX:'auto'}}><table style={s.table}>
                  <thead><tr>{['Email','Category','Rating','Message','Date'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>{data.feedback.map((f,i)=>(
                    <tr key={f.id} style={{background:i%2===0?'#0D0D0D':'#111',verticalAlign:'top'}}>
                      <td style={{...s.td,color:'#C9A84C',fontSize:12,whiteSpace:'nowrap'}}>{f.email}</td>
                      <td style={s.td}><span style={{fontSize:10,padding:'3px 8px',borderRadius:4,letterSpacing:1,textTransform:'uppercase',background:'rgba(255,255,255,0.06)',color:'#888'}}>{f.category}</span></td>
                      <td style={{...s.td,color:'#C9A84C',letterSpacing:1}}>{f.rating?'★'.repeat(f.rating)+'☆'.repeat(5-f.rating):'—'}</td>
                      <td style={{...s.td,color:'#ccc',maxWidth:360,fontSize:13,lineHeight:1.5}}>{f.message}</td>
                      <td style={{...s.td,color:'#555',fontSize:11,whiteSpace:'nowrap'}}>{new Date(f.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              }
            </Section>
          )}
        </>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, gold, blue }) {
  const accent = gold?'#C9A84C':blue?'#60a5fa':'#fff';
  const border = gold?'#C9A84C44':blue?'#60a5fa22':'#ffffff0f';
  return (
    <div style={{background:'#111',borderRadius:12,padding:'22px 24px',border:`1px solid ${border}`}}>
      <div style={{fontSize:10,letterSpacing:3,color:gold?'#C9A84C':blue?'#60a5fa':'#444',textTransform:'uppercase',marginBottom:10}}>{label}</div>
      <div style={{fontSize:34,fontWeight:700,color:accent,lineHeight:1}}>{value}</div>
      <div style={{fontSize:12,color:'#3a3a3a',marginTop:8}}>{sub}</div>
    </div>
  );
}
function Section({ title, count, children }) {
  return (
    <div style={{marginBottom:40}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
        <h2 style={{fontSize:12,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#fff',margin:0}}>{title}</h2>
        <span style={{fontSize:11,background:'#C9A84C1a',color:'#C9A84C',padding:'2px 10px',borderRadius:20,fontWeight:600}}>{count}</span>
      </div>
      <div style={{background:'#111',border:'1px solid #ffffff08',borderRadius:12,overflow:'hidden'}}>{children}</div>
    </div>
  );
}
function Empty({ text }) { return <div style={{padding:32,textAlign:'center',color:'#333',fontSize:14}}>{text}</div>; }
function Badge({ val }) {
  const yr = val==='year';
  return <span style={{fontSize:10,padding:'3px 8px',borderRadius:4,letterSpacing:1,textTransform:'uppercase',background:yr?'#C9A84C1a':'#ffffff0a',color:yr?'#C9A84C':'#666'}}>{yr?'Annual':'Monthly'}</span>;
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
  input:     { width:'100%', background:'#0D0D0D', border:'1px solid #ffffff15', borderRadius:8, padding:'9px 12px', color:'#fff', fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' },
  loginErr:  { color:'#e74c3c', fontSize:12, marginTop:10, textAlign:'left' },
  btnSubmit: { width:'100%', marginTop:18, background:'#C9A84C', border:'none', borderRadius:8, padding:'12px', color:'#0D0D0D', fontSize:14, fontWeight:700, letterSpacing:1, cursor:'pointer', fontFamily:'inherit' },
  btnGold:   { background:'transparent', border:'1px solid #C9A84C44', color:'#C9A84C', padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, letterSpacing:1, fontFamily:'inherit' },
  btnGhost:  { background:'transparent', border:'1px solid #ffffff12', color:'#555', padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, fontFamily:'inherit' },
};
