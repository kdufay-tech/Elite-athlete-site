import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

const ADMIN_EMAIL = 'kiszo@taratechent.com';
const NAV = [
  ['overview','Overview'],
  ['subscribers','Subscribers'],
  ['invites','Invites'],
  ['betausers','Beta Users'],
  ['betacodes','Beta Codes'],
  ['waitlist','Waitlist'],
  ['feedback','Feedback'],
  ['marketing','Marketing'],
  ['coachops','Coach Ops'],
  ['contacts','Contacts'],
  ['manual','Manual'],
];

export default function AdminDashboard({ user }) {
  const [data, setData]         = useState(null);
  const [page, setPage] = useState('overview');
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

  // Shared session cache -- prevents concurrent lock conflicts
  let _sessionCache = null;
  let _sessionExpiry = 0;
  async function getAdminSession() {
    const now = Date.now();
    if (_sessionCache && now < _sessionExpiry) return _sessionCache;
    const { data: { session } } = await supabase.auth.getSession();
    _sessionCache = session;
    _sessionExpiry = now + 50000;
    return session;
  }

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const session = await getAdminSession();
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

  // ── INVITE SYSTEM ─────────────────────────────────────────────
  const [inviteEmails,   setInviteEmails]   = useState('');
  const [inviteType,     setInviteType]     = useState('athlete');
  const [inviteMsg,      setInviteMsg]      = useState(null);
  const [inviteBusy,     setInviteBusy]     = useState(false);
  const [inviteProgress, setInviteProgress] = useState(null);
  const [inviteConfirm,  setInviteConfirm]  = useState(false);
  const [inviteTemplate, setInviteTemplate] = useState('generic');
  const [csvDragOver,    setCsvDragOver]    = useState(false);
  const [followupBusy,   setFollowupBusy]   = useState(false);
  const [followupMsg,    setFollowupMsg]     = useState(null);
  const [followupDays,   setFollowupDays]    = useState(5);
  const [reminderBusy,   setReminderBusy]   = useState(false);
  const [reminderMsg,    setReminderMsg]     = useState(null);

  // ── LIST MANAGEMENT ──────────────────────────────────────────
  const [inviteSearch,   setInviteSearch]   = useState('');
  const [inviteFilter,   setInviteFilter]   = useState('all');
  const [invitePage,     setInvitePage]     = useState(0);
  const [userSearch,     setUserSearch]     = useState('');
  const [userFilter,     setUserFilter]     = useState('all');
  const [userPage,       setUserPage]       = useState(0);
  const [deletingId,     setDeletingId]     = useState(null);
  const PAGE_SIZE = 25;

  async function deleteInvite(id, email) {
    if (!window.confirm(`Delete invite for ${email}?`)) return;
    setDeletingId(id);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'delete_invite', id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchData();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  }

  const [selectedInvites, setSelectedInvites] = useState(new Set());
  const [bulkDeleting,    setBulkDeleting]    = useState(false);

  async function bulkDeleteInvites() {
    if (!selectedInvites.size) return;
    if (!window.confirm(`Delete ${selectedInvites.size} invite${selectedInvites.size===1?'':'s'}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'bulk_delete_invites', ids: [...selectedInvites] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSelectedInvites(new Set());
      await fetchData();
    } catch (err) {
      alert('Bulk delete failed: ' + err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  const [selectedUsers,   setSelectedUsers]   = useState(new Set());
  const [bulkUserBusy,    setBulkUserBusy]    = useState(false);
  const [revokingUserId,  setRevokingUserId]  = useState(null);

  async function revokeUser(userId, email) {
    if (!window.confirm(`Revoke beta access for ${email}? They will lose access immediately.`)) return;
    setRevokingUserId(userId);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke_beta_user', user_id: userId, email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchData();
    } catch(err) {
      alert('Revoke failed: ' + err.message);
    } finally {
      setRevokingUserId(null);
    }
  }

  // ── TEST ACCESS ───────────────────────────────────────────────
  const [testEmail, setTestEmail]   = useState('');
  const [testMsg,   setTestMsg]     = useState(null);
  const [testBusy,  setTestBusy]    = useState(false);

  // ── ADD BETA TESTER ───────────────────────────────────────────
  const [betaEmail,    setBetaEmail]    = useState('');
  const [betaType,     setBetaType]     = useState('athlete');
  const [betaMsg,      setBetaMsg]      = useState(null);
  const [betaBusy,     setBetaBusy]     = useState(false);
  const [betaBulkMode, setBetaBulkMode] = useState(false);
  const [bulkEmails,   setBulkEmails]   = useState('');
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total, results }
  const [bulkConfirm,  setBulkConfirm]  = useState(false);

  // ── BETA CODE CREATION ────────────────────────────────────────
  const [newCode,     setNewCode]     = useState('');
  const [newLabel,    setNewLabel]    = useState('');
  const [newMaxUses,  setNewMaxUses]  = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [codeMsg,     setCodeMsg]     = useState(null);
  const [codeBusy,    setCodeBusy]    = useState(false);
  const [newPwd,      setNewPwd]      = useState("");
  const [pwdMsg,      setPwdMsg]      = useState(null);
  const [showPwd,     setShowPwd]     = useState(false);

  async function callAction(action, extraBody = {}) {
    setTestBusy(true);
    setTestMsg(null);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email: testEmail, ...extraBody }),
      });
      const json = await res.json();
      setTestMsg({ text: json.message || json.error, ok: res.ok });
      if (res.ok) fetchData();
    } catch(err) {
      setTestMsg({ text: err.message, ok: false });
    } finally {
      setTestBusy(false);
    }
  }

  // Parse raw textarea/input into clean unique email list
  function parseEmails(raw) {
    return [...new Set(
      raw.split(/[\n,;]+/)
        .map(e => e.trim().toLowerCase())
        .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    )];
  }

  function parseCSV(text) {
    const emails = [];
    const lines = text.split(/[\r\n]+/);
    for (const line of lines) {
      const cols = line.split(/[,;\t]/);
      for (const col of cols) {
        const clean = col.replace(/['"\s]/g,'').toLowerCase();
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) emails.push(clean);
      }
    }
    return [...new Set(emails)];
  }

  function handleCSVFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseCSV(e.target.result);
      if (parsed.length) {
        setInviteEmails(prev => {
          const existing = parseEmails(prev);
          const merged = [...new Set([...existing, ...parsed])];
          return merged.join('\n');
        });
      }
    };
    reader.readAsText(file);
  }

  const INVITE_TEMPLATES = {
    generic:        { label: 'Generic Beta Invite',       desc: 'Standard invite - works for any athlete type' },
    coach_college:  { label: 'College Coach',             desc: 'S&C coordinators, Directors of Athletic Performance at colleges' },
    coach_pro:      { label: 'Pro Team Staff',            desc: 'NFL / NBA / MLS / NHL performance department contacts' },
    athlete_mfp:    { label: 'MFP User (Competitor)',     desc: 'MyFitnessPal users - position-specificity angle' },
    athlete_strava: { label: 'Strava / TrainingPeaks',    desc: 'Competitor users - team sport vs endurance angle' },
  };

  async function grantBetaSingle(email, session) {
    const res = await fetch('/.netlify/functions/admin-action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'grant_beta', email, beta_type: betaType }),
    });
    const json = await res.json();
    return { email, ok: res.ok, msg: json.message || json.error || '' };
  }

  async function grantBeta() {
    const emails = betaBulkMode ? parseEmails(bulkEmails) : parseEmails(betaEmail);
    if (!emails.length) { setBetaMsg({ text: 'No valid emails found.', ok: false }); return; }
    setBetaBusy(true); setBetaMsg(null); setBulkProgress({ done: 0, total: emails.length, results: [] }); setBulkConfirm(false);
    try {
      const session = await getAdminSession();
      const results = [];
      for (let i = 0; i < emails.length; i++) {
        const r = await grantBetaSingle(emails[i], session);
        results.push(r);
        setBulkProgress({ done: i + 1, total: emails.length, results: [...results] });
      }
      const granted  = results.filter(r => r.ok).length;
      const failed   = results.filter(r => !r.ok).length;
      setBetaMsg({ text: `✓ ${granted} granted · ${failed > 0 ? `✗ ${failed} failed` : '0 failed'}`, ok: failed === 0, results });
      if (granted > 0) { setBetaEmail(''); setBulkEmails(''); fetchData(); }
    } catch(err) { setBetaMsg({ text: err.message, ok: false }); }
    finally { setBetaBusy(false); setBulkProgress(null); setBulkConfirm(false); }
  }

  async function sendInvites() {
    const emails = parseEmails(inviteEmails);
    if (!emails.length) { setInviteMsg({ text: 'No valid emails found.', ok: false }); return; }
    setInviteBusy(true); setInviteMsg(null); setInviteConfirm(false);
    const CHUNK = 5;
    const allResults = [];
    let totalSent = 0, totalFailed = 0;
    try {
      const session = await getAdminSession();
      setInviteProgress({ done: 0, total: emails.length, results: [] });
      for (let i = 0; i < emails.length; i += CHUNK) {
        const chunk = emails.slice(i, i + CHUNK);
        const res = await fetch('/.netlify/functions/send-beta-invite', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: chunk, beta_type: inviteType, template: inviteTemplate }),
        });
        let json;
        try { json = await res.json(); }
        catch(e) { json = { ok: false, error: `HTTP ${res.status}`, results: chunk.map(e => ({ email: e, ok: false, msg: `HTTP ${res.status}` })) }; }
        const chunkResults = json.results || [];
        allResults.push(...chunkResults);
        totalSent   += chunkResults.filter(r => r.ok).length;
        totalFailed += chunkResults.filter(r => !r.ok).length;
        setInviteProgress({ done: allResults.length, total: emails.length, results: allResults });
        setInviteMsg({ text: `${totalSent} sent · ${totalFailed} failed (${allResults.length}/${emails.length} processed)`, ok: totalSent > 0, results: allResults });
      }
      setInviteMsg({ text: `Done: ${totalSent} sent · ${totalFailed} failed`, ok: totalSent > 0, results: allResults });
      if (totalSent > 0) { setInviteEmails(''); fetchData(); }
    } catch(err) { setInviteMsg({ text: err.message, ok: false }); }
    finally { setInviteBusy(false); setInviteProgress(null); setInviteConfirm(false); }
  }

  async function resendInvite(inviteId) {
    setInviteBusy(true);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend_invite', invite_id: inviteId }),
      });
      const json = await res.json();
      setInviteMsg({ text: json.message || json.error, ok: res.ok });
      if (res.ok) fetchData();
    } catch(err) { setInviteMsg({ text: err.message, ok: false }); }
    finally { setInviteBusy(false); }
  }

  async function runFollowup() {
    setFollowupBusy(true); setFollowupMsg(null);
    try {
      const session = await getAdminSession();
      fetch('/.netlify/functions/beta-followup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ followup_days: followupDays }),
      }).then(r=>r.json()).then(data=>{
        setFollowupMsg({ text: data.message||`Follow-up complete: ${data.sent||0} sent, ${data.failed||0} failed`, ok: data.ok!==false });
        setFollowupBusy(false);
      }).catch(err=>{setFollowupMsg({text:err.message,ok:false});setFollowupBusy(false);});
    } catch(err) { setFollowupMsg({ text: err.message, ok: false }); setFollowupBusy(false); }
  }

  async function runExpiryReminders() {
    setReminderBusy(true); setReminderMsg(null);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/beta-expiry-reminder', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      setReminderMsg({ ...json, ok: res.ok });
      if (res.ok) fetchData();
    } catch(err) { setReminderMsg({ error: err.message, ok: false }); }
    finally { setReminderBusy(false); }
  }

  async function syncBetaUses() {
    setCodeBusy(true); setCodeMsg(null);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_beta_uses' }),
      });
      const json = await res.json();
      setCodeMsg({ text: json.message || json.error, ok: res.ok });
      if (res.ok) fetchData();
    } catch(err) { setCodeMsg({ text: err.message, ok: false }); }
    finally { setCodeBusy(false); }
  }

  async function createBetaCode() {
    if (!newCode.trim()) return;
    setCodeBusy(true); setCodeMsg(null);
    try {
      const session = await getAdminSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_beta_code', code: newCode.trim().toUpperCase(), label: newLabel || newCode, max_uses: newMaxUses ? parseInt(newMaxUses) : null, duration_days: newDuration ? parseInt(newDuration) : null }),
      });
      const json = await res.json();
      setCodeMsg({ text: json.message || json.error, ok: res.ok });
      if (res.ok) { setNewCode(''); setNewLabel(''); setNewMaxUses(''); setNewDuration(''); fetchData(); }
    } catch(err) { setCodeMsg({ text: err.message, ok: false }); }
    finally { setCodeBusy(false); }
  }

  async function changePassword() {
    if (newPwd.length < 8) { setPwdMsg({text:"Min 8 characters",ok:false}); return; }
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    if (error) setPwdMsg({text:error.message,ok:false});
    else { setPwdMsg({text:"Password updated!",ok:true}); setNewPwd(""); }
  }

  async function toggleCode(code_id, active) {
    const session = await getAdminSession();
    await fetch('/.netlify/functions/admin-action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_beta_code', code_id, active }),
    });
    fetchData();
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
            <div style={s.eyebrow}>Elite Athlete</div>
            <div style={s.title}>Admin Access</div>
            <form onSubmit={handleLogin} style={{ marginTop: 28 }}>
              <input type="email" placeholder="Admin Email" value={email} required onChange={e => setEmail(e.target.value)} style={s.input}/>
              <input type="password" placeholder="Password" value={password} required onChange={e => setPassword(e.target.value)} style={{ ...s.input, marginTop: 12 }}/>
              {loginErr && <div style={s.loginErr}>{loginErr}</div>}
              <button type="submit" disabled={loginBusy} style={s.btnSubmit}>{loginBusy ? "Signing in..." : "Sign In as Admin"}</button>
            </form>
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
        <button onClick={fetchData} style={{...s.btnGold,padding:"6px 12px",fontSize:12}}>↺</button>
      </div>
      <div style={{background:'#111',borderBottom:'1px solid #C9A84C1a',padding:'12px 16px 14px',display:'flex',flexDirection:'column',gap:8}}>
        <div style={{position:'relative'}}>
          <input type={showPwd?"text":"password"} placeholder="New admin password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...s.input,width:'100%',paddingRight:38,boxSizing:'border-box'}}/>
          <button onClick={()=>setShowPwd(p=>!p)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#888',fontSize:18,padding:0,lineHeight:1}}>
            {showPwd?'🙈':'👁'}
          </button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={changePassword} style={{...s.btnGold,flex:1,fontSize:13,padding:'8px'}}>Update Password</button>
          <button onClick={handleLogout} style={{...s.btnGhost,flex:1,fontSize:13,padding:'8px'}}>Sign Out</button>
        </div>
        {pwdMsg && <span style={{fontSize:11,color:pwdMsg.ok?'#4ade80':'#e74c3c'}}>{pwdMsg.text}</span>}
      </div>

      <div style={s.nav}>
        {NAV.map(([id,label]) => (
          <button key={id} onClick={()=>setPage(id)} style={page===id ? {...s.navBtn, ...s.navBtnOn} : s.navBtn}>{label}</button>
        ))}
      </div>
      <div style={s.inner}>
        {loading && <div style={s.center}>Loading...</div>}
        {error   && <div style={{ ...s.center, color: '#e74c3c' }}>{error}</div>}
        {data && <>
          {page === 'overview' && (<>
          {/* Paid stats */}
          <div style={s.grid}>
            <StatCard label="MRR"           value={`$${data.mrr}`}        sub="monthly recurring revenue" gold />
            <StatCard label="Subscribers"   value={data.totalSubscribers} sub="paid Elite members" />
            <StatCard label="Monthly Plans" value={data.monthlyCount}     sub="× $9.99 / mo" />
            <StatCard label="Waitlist"      value={data.waitlistCount}    sub="coach waitlist signups" />
          </div>

          </>)}
          {page === 'overview' && (<>
          {/* Beta stats */}
          <div style={{ ...s.grid, marginBottom:36 }}>
            <StatCard label="Beta Users"    value={data.betaCount}        sub="90-day free access" blue />
            <StatCard label="Active Beta"   value={data.betaCount - data.betaExpired} sub="still in window" />
            <StatCard label="Beta Expired"  value={data.betaExpired}      sub="conversion opportunity" />
            <StatCard label="Beta Codes"    value={data.betaCodes?.length || 0} sub="invite codes total" />
          </div>

          </>)}
          {page === 'invites' && (<>
          {/* ── INVITE SYSTEM ── */}
          <div style={{ marginBottom:24, background:'#111', border:'1px solid #C9A84C44', borderRadius:12, padding:'24px 28px' }}>
            <div style={{ fontSize:12, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'#C9A84C', marginBottom:6 }}>
              ◆ Send Beta Invite — Email Link (No Account Needed)
            </div>
            <div style={{ fontSize:12, color:'#555', marginBottom:16, lineHeight:1.6 }}>
              Sends a personal invite email with a unique signup link. Recipient creates account → beta access activates automatically. Athlete = 30 days · Coach = 45 days.
            </div>

                        {/* OUTREACH TEMPLATE */}
            <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase', marginBottom:8 }}>Outreach Template:</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8 }}>
              {Object.entries(INVITE_TEMPLATES).map(([key, tmpl]) => (
                <button key={key} onClick={() => setInviteTemplate(key)} style={{
                  padding:'5px 12px', borderRadius:6, fontSize:11, letterSpacing:1, cursor:'pointer',
                  border: inviteTemplate===key ? '1px solid #C9A84C88' : '1px solid rgba(255,255,255,0.08)',
                  background: inviteTemplate===key ? 'rgba(201,168,76,0.1)' : 'transparent',
                  color: inviteTemplate===key ? '#C9A84C' : '#555',
                }}>{tmpl.label}</button>
              ))}
            </div>
            <div style={{ fontSize:10, color:'#444', marginBottom:16, fontStyle:'italic' }}>
              {INVITE_TEMPLATES[inviteTemplate]?.desc}
            </div>

            {/* CSV IMPORT */}
            <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase', marginBottom:8 }}>Import Emails from CSV:</div>
            <div
              onDragOver={e => { e.preventDefault(); setCsvDragOver(true); }}
              onDragLeave={() => setCsvDragOver(false)}
              onDrop={e => { e.preventDefault(); setCsvDragOver(false); const f = e.dataTransfer.files[0]; if(f) handleCSVFile(f); }}
              onClick={() => document.getElementById('csv-upload-input').click()}
              style={{
                border: csvDragOver ? '2px dashed #C9A84C' : '2px dashed rgba(255,255,255,0.08)',
                borderRadius:8, padding:'12px 16px', textAlign:'center', cursor:'pointer',
                background: csvDragOver ? 'rgba(201,168,76,0.05)' : 'rgba(255,255,255,0.02)',
                marginBottom:14, transition:'all 0.2s',
              }}>
              <div style={{ fontSize:12, color: csvDragOver ? '#C9A84C' : '#555' }}>
                {csvDragOver ? 'Drop file here' : 'Drag and drop CSV  --  or click to browse'}
              </div>
              <div style={{ fontSize:10, color:'#3a3a3a', marginTop:4 }}>
                CSV, TXT, or any file with emails -- auto-parsed, duplicates removed, merged with list below
              </div>
            </div>
            <input id="csv-upload-input" type="file" accept=".csv,.txt,.tsv" style={{ display:'none' }}
              onChange={e => { if(e.target.files[0]) handleCSVFile(e.target.files[0]); e.target.value=''; }} />

            {/* Type selector */}
            <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase', alignSelf:'center' }}>Type:</div>
              {[['athlete','Athlete (30 days)'],['coach','Coach (45 days)']].map(([val,label]) => (
                <button key={val} onClick={() => setInviteType(val)}
                  style={{ ...s.btnGhost, fontSize:12, padding:'5px 14px',
                    border: inviteType===val ? '1px solid #C9A84C88' : '1px solid #ffffff12',
                    color: inviteType===val ? '#C9A84C' : '#555',
                    background: inviteType===val ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                  {label}
                </button>
              ))}
            </div>

            <textarea
              placeholder={'athlete@school.edu\ncoach@program.org\nplayer@team.com'}
              value={inviteEmails}
              onChange={e => { setInviteEmails(e.target.value); setInviteMsg(null); setInviteConfirm(false); }}
              rows={4}
              style={{ ...s.input, resize:'vertical', fontFamily:'monospace', fontSize:12, lineHeight:1.6 }}
            />

            {/* Preview + confirm */}
            {inviteEmails.trim() && (() => {
              const parsed = parseEmails(inviteEmails);
              return parsed.length > 0 ? (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:12, color:'#C9A84C66', letterSpacing:1, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <span>{parsed.length} valid email{parsed.length!==1?'s':''} -- will receive invite email with unique signup link</span>
                    <button onClick={() => { setInviteEmails(''); setInviteMsg(null); setInviteProgress(null); setInviteConfirm(false); }}
                      style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'#888', borderRadius:6, padding:'3px 10px', fontSize:10, cursor:'pointer', letterSpacing:1, whiteSpace:'nowrap' }}>
                      Clear All
                    </button>
                  </div>
                  {!inviteConfirm && !inviteBusy && (
                    <button onClick={() => setInviteConfirm(true)} style={{ ...s.btnGold, fontSize:12 }}>
                      Review & Send Invites
                    </button>
                  )}
                  {inviteConfirm && !inviteBusy && (
                    <div style={{ background:'rgba(201,168,76,0.05)', border:'1px solid #C9A84C22', borderRadius:8, padding:'14px 16px', marginTop:8 }}>
                      <div style={{ fontSize:11, color:'#C9A84C', letterSpacing:2, textTransform:'uppercase', marginBottom:10 }}>
                        Send {inviteType} invite to {parsed.length} email{parsed.length!==1?'s':''}?
                      </div>
                      <div style={{ maxHeight:100, overflowY:'auto', marginBottom:12 }}>
                        {parsed.map(e => <div key={e} style={{ fontSize:11, fontFamily:'monospace', color:'#888', lineHeight:1.8 }}>{e}</div>)}
                      </div>
                      <div style={{ display:'flex', gap:10 }}>
                        <button onClick={sendInvites} disabled={inviteBusy} style={{ ...s.btnGold, padding:'8px 20px' }}>
                          ✉ Send {parsed.length} Invite{parsed.length!==1?'s':''}
                        </button>
                        <button onClick={() => setInviteConfirm(false)} style={{ ...s.btnGhost, padding:'8px 14px' }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : <div style={{ marginTop:8, fontSize:11, color:'#e74c3c88' }}>No valid emails detected</div>;
            })()}

            {/* Progress */}
            {inviteBusy && (
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:11, color:'#C9A84C', letterSpacing:1, marginBottom:6 }}>Sending invites…</div>
                <div style={{ height:4, background:'#1a1a1a', borderRadius:2 }}>
                  <div style={{ height:'100%', background:'linear-gradient(90deg,#C9A84C,#e8c96a)', borderRadius:2, width:'100%', animation:'pulse 1.2s infinite' }} />
                </div>
              </div>
            )}

            {/* Result */}
            {inviteMsg && !inviteBusy && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontSize:13, fontWeight:700, color: inviteMsg.ok ? '#C9A84C' : '#f39c12', marginBottom: inviteMsg.results?.length ? 8 : 0 }}>
                  {inviteMsg.text}
                </div>
                {inviteMsg.results?.filter(r => !r.ok).length > 0 && (
                  <div style={{ marginTop:6 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6, flexWrap:'wrap', gap:8 }}>
                      <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase' }}>Failed ({inviteMsg.results.filter(r => !r.ok).length}):</div>
                      <div style={{ display:'flex', gap:8 }}>
                        <button onClick={() => navigator.clipboard.writeText(inviteMsg.results.filter(r => !r.ok).map(r => r.email).join('\n'))}
                          style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'#888', borderRadius:6, padding:'3px 10px', fontSize:10, cursor:'pointer', letterSpacing:1 }}>
                          Copy Emails
                        </button>
                        <button onClick={() => setInviteEmails(inviteMsg.results.filter(r => !r.ok).map(r => r.email).join('\n'))}
                          style={{ background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.2)', color:'#C9A84C', borderRadius:6, padding:'3px 10px', fontSize:10, cursor:'pointer', letterSpacing:1 }}>
                          Load into Field
                        </button>
                      </div>
                    </div>
                    <div style={{ maxHeight:200, overflowY:'auto', background:'rgba(0,0,0,0.2)', borderRadius:6, padding:'8px 10px' }}>
                      {inviteMsg.results.filter(r => !r.ok).map(r => (
                        <div key={r.email} style={{ fontSize:11, fontFamily:'monospace', color:'#e74c3c', lineHeight:1.8 }}>x {r.email} -- {r.msg}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          </>)}
          {page === 'invites' && (<>
          {/* Pending Invites Table */}
          {data.betaInvites?.length > 0 && (
            <Section title="Beta Invites" count={data.betaInviteCount}>
              <div style={{ display:'flex', gap:16, padding:'12px 16px 0', flexWrap:'wrap' }}>
                {[['Sent',data.invitesPending,'#C9A84C'],['Accepted',data.invitesAccepted,'#4BAE71']].map(([label,val,color]) => (
                  <div key={label} style={{ fontSize:11, color:'#555', letterSpacing:1 }}>
                    <span style={{ color, fontWeight:700, fontSize:14 }}>{val}</span> {label}
                  </div>
                ))}
              </div>
              {/* Search + Filter + Bulk Delete */}
              <div style={{ display:'flex', gap:10, padding:'12px 16px', flexWrap:'wrap', alignItems:'center' }}>
                <input value={inviteSearch} onChange={e=>{setInviteSearch(e.target.value);setInvitePage(0);}}
                  placeholder="Search email..." style={{ background:'#0D0D0D', border:'1px solid #ffffff18', borderRadius:6, color:'#fff', padding:'6px 12px', fontSize:12, width:220, fontFamily:'inherit' }} />
                {['all','pending','accepted','expired'].map(f=>(
                  <button key={f} onClick={()=>{setInviteFilter(f);setInvitePage(0);}} style={{ background: inviteFilter===f?'rgba(201,168,76,0.12)':'transparent', border: inviteFilter===f?'1px solid #C9A84C66':'1px solid #ffffff12', borderRadius:4, color: inviteFilter===f?'#C9A84C':'#555', padding:'5px 12px', fontSize:11, letterSpacing:1, textTransform:'uppercase', cursor:'pointer', fontFamily:'inherit' }}>{f}</button>
                ))}
                {selectedInvites.size > 0 && (
                  <button onClick={bulkDeleteInvites} disabled={bulkDeleting}
                    style={{ background:'rgba(231,76,60,0.15)', border:'1px solid rgba(231,76,60,0.4)', borderRadius:4, color:'#e74c3c', padding:'5px 14px', fontSize:11, letterSpacing:1, textTransform:'uppercase', cursor:'pointer', fontFamily:'inherit', marginLeft:'auto' }}>
                    {bulkDeleting ? 'Deleting…' : `✕ Delete ${selectedInvites.size} selected`}
                  </button>
                )}
              </div>
              <div style={{ overflowX:'auto' }}>
                {(() => {
                  const filtered = (data.betaInvites||[])
                    .filter(inv => inviteFilter==='all' || inv.status===inviteFilter)
                    .filter(inv => !inviteSearch || inv.email?.toLowerCase().includes(inviteSearch.toLowerCase()));
                  const pages = Math.ceil(filtered.length / PAGE_SIZE);
                  const page = Math.min(invitePage, Math.max(0, pages-1));
                  const rows = filtered.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);
                  return <>
                    <table style={s.table}><thead><tr>
                      <th style={{...s.th, width:32}}>
                        <input type="checkbox"
                          checked={rows.length > 0 && rows.every(r => selectedInvites.has(r.id))}
                          onChange={e => {
                            const next = new Set(selectedInvites);
                            rows.forEach(r => e.target.checked ? next.add(r.id) : next.delete(r.id));
                            setSelectedInvites(next);
                          }}
                          style={{ cursor:'pointer', accentColor:'#C9A84C' }} />
                      </th>
                      {['Email','Type','Days','Status','Sent','Accepted',''].map(h => <th key={h} style={s.th}>{h}</th>)}
                    </tr></thead><tbody>
                      {rows.map((inv, i) => (
                        <tr key={inv.id} style={{ background: selectedInvites.has(inv.id)?'rgba(201,168,76,0.06)':i%2===0?'#0D0D0D':'#111' }}>
                          <td style={{...s.td, width:32}}>
                            <input type="checkbox" checked={selectedInvites.has(inv.id)}
                              onChange={e => {
                                const next = new Set(selectedInvites);
                                e.target.checked ? next.add(inv.id) : next.delete(inv.id);
                                setSelectedInvites(next);
                              }}
                              style={{ cursor:'pointer', accentColor:'#C9A84C' }} />
                          </td>
                          <td style={{ ...s.td, color:'#C9A84C', fontSize:13 }}>{inv.email}</td>
                          <td style={s.td}><span style={{ fontSize:10, padding:'3px 8px', borderRadius:4, letterSpacing:1, textTransform:'uppercase', background: inv.beta_type==='coach'?'rgba(96,165,250,0.12)':'rgba(201,168,76,0.1)', color: inv.beta_type==='coach'?'#60a5fa':'#C9A84C' }}>{inv.beta_type}</span></td>
                          <td style={{ ...s.td, color:'#888' }}>{inv.duration_days}d</td>
                          <td style={s.td}><span style={{ fontSize:10, padding:'3px 8px', borderRadius:4, letterSpacing:1, textTransform:'uppercase', background: inv.status==='accepted'?'rgba(75,174,113,0.15)':inv.status==='expired'?'rgba(231,76,60,0.15)':'rgba(255,255,255,0.06)', color: inv.status==='accepted'?'#4BAE71':inv.status==='expired'?'#e74c3c':'#888' }}>{inv.status}</span></td>
                          <td style={{ ...s.td, color:'#555', fontSize:11 }}>{inv.sent_at ? new Date(inv.sent_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</td>
                          <td style={{ ...s.td, color:'#555', fontSize:11 }}>{inv.accepted_at ? new Date(inv.accepted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</td>
                          <td style={{...s.td, display:'flex', gap:6}}>
                            {(inv.status === 'sent' || inv.status === 'pending') && (
                              <button onClick={() => resendInvite(inv.id)} disabled={inviteBusy}
                                style={{ background:'transparent', border:'1px solid #333', borderRadius:4, color:'#666', padding:'3px 10px', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
                                Resend
                              </button>
                            )}
                            <button onClick={() => deleteInvite(inv.id, inv.email)} disabled={deletingId===inv.id}
                              style={{ background:'transparent', border:'1px solid rgba(231,76,60,0.3)', borderRadius:4, color:'#e74c3c', padding:'3px 8px', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
                              {deletingId===inv.id ? '…' : '✕'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody></table>
                    {pages > 1 && (
                      <div style={{ display:'flex', gap:8, justifyContent:'center', padding:'12px 0', alignItems:'center' }}>
                        <button onClick={()=>setInvitePage(p=>Math.max(0,p-1))} disabled={page===0} style={{ ...s.btnGhost, fontSize:11, padding:'4px 12px' }}>← Prev</button>
                        <span style={{ fontSize:11, color:'#555' }}>Page {page+1} of {pages} ({filtered.length} total)</span>
                        <button onClick={()=>setInvitePage(p=>Math.min(pages-1,p+1))} disabled={page===pages-1} style={{ ...s.btnGhost, fontSize:11, padding:'4px 12px' }}>Next →</button>
                      </div>
                    )}
                  </>;
                })()}
              </div>
            </Section>
          )}

          </>)}
          {page === 'marketing' && (<>
                    <TrancheMetricsPanel getSession={getAdminSession} />
                    <MarketingBlastSection getSession={getAdminSession} />
          </>)}
          {page === 'invites' && (<>
          {/* Day-N Follow-Up Panel */}
          <div style={{ ...s.card, border:'1px solid rgba(201,168,76,0.2)' }}>
            <div style={{ fontSize:11, color:'#C9A84C', letterSpacing:3, textTransform:'uppercase', marginBottom:6 }}>
              ◆ Day-5 Follow-Up — Auto Re-Engage Non-Responders
            </div>
            <div style={{ fontSize:12, color:'#555', marginBottom:16, lineHeight:1.6 }}>
              Sends a follow-up email to everyone who received an invite but hasn't signed up yet.
              Automatically runs daily at 9am UTC. Use manual trigger to run immediately.
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
              <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase' }}>Follow up after:</div>
              {[3,5,7].map(d => (
                <button key={d} onClick={() => setFollowupDays(d)} style={{
                  ...s.btnGhost, fontSize:12, padding:'5px 14px',
                  border: followupDays===d ? '1px solid #C9A84C88' : '1px solid #ffffff12',
                  color: followupDays===d ? '#C9A84C' : '#555',
                  background: followupDays===d ? 'rgba(201,168,76,0.06)' : 'transparent',
                }}>{d} days</button>
              ))}
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <button onClick={runFollowup} disabled={followupBusy} style={{ ...s.btnGold, opacity: followupBusy ? 0.6 : 1 }}>
                {followupBusy ? 'Sending…' : `Run Day-${followupDays} Follow-Up Now`}
              </button>
              <div style={{ fontSize:11, color:'#555', fontStyle:'italic' }}>
                Scheduled: daily 9am UTC · Only contacts who haven't signed up · Same invite link
              </div>
            </div>
            {followupMsg && (
              <div style={{ marginTop:10, fontSize:12, color: followupMsg.ok ? '#4BAE71' : '#e74c3c' }}>
                {followupMsg.ok ? '✓' : '✗'} {followupMsg.text}
              </div>
            )}
          </div>

          </>)}
          {page === 'invites' && (<>
          {/* Expiry Reminder Emails */}
          <div style={{ marginBottom:40, background:'#111', border:'1px solid rgba(201,168,76,0.2)', borderRadius:12, padding:'24px 28px' }}>
            <div style={{ fontSize:12, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'#C9A84C', marginBottom:6 }}>◆ Beta Expiry Reminders</div>
            <div style={{ fontSize:12, color:'#555', marginBottom:16, lineHeight:1.6 }}>
              Sends reminder emails to active beta users at 7 days, 3 days, and 0 days before expiry. Runs automatically daily at 10am UTC. Each reminder sent only once per user.
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <button onClick={runExpiryReminders} disabled={reminderBusy} style={{ ...s.btnGold, opacity: reminderBusy ? 0.6 : 1 }}>
                {reminderBusy ? 'Sending…' : 'Run Expiry Reminders Now'}
              </button>
            </div>
            {reminderMsg && (
              <div style={{ marginTop:10, fontSize:12, color: reminderMsg.ok ? '#4BAE71' : '#e74c3c' }}>
                {reminderMsg.ok ? `✓ Sent ${reminderMsg.sent?.length || 0} reminder${reminderMsg.sent?.length===1?'':'s'}, skipped ${reminderMsg.skipped?.length || 0}` : `✗ ${reminderMsg.error}`}
              </div>
            )}
          </div>

          </>)}
          {page === 'betausers' && (<>
          {/* Add Beta Tester by Email */}
          <div style={{ marginBottom: 24, background: '#111', border: '1px solid #C9A84C33', borderRadius: 12, padding: '24px 28px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, marginBottom:6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: '#C9A84C' }}>
                ◆ Add Beta Tester — Direct Email Invite
              </div>
              <button
                onClick={() => { setBetaBulkMode(m => !m); setBetaMsg(null); setBulkProgress(null); setBulkConfirm(false); }}
                style={{ ...s.btnGhost, fontSize: 11, padding: '4px 12px', letterSpacing: 1 }}
              >
                {betaBulkMode ? '← Single' : '⊞ Bulk'}
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#444', marginBottom: 16, lineHeight: 1.5 }}>
              {betaBulkMode
                ? 'Paste emails — one per line, or comma/semicolon separated. Athlete = 30 days · Coach = 45 days.'
                : 'User must have already created an account. Athlete = 30 days · Coach = 45 days.'}
            </div>

            {/* Type selector — shared for single + bulk */}
            <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase', alignSelf:'center' }}>Type:</div>
              {[['athlete','Athlete (30 days)'],['coach','Coach (45 days)']].map(([val,label]) => (
                <button key={val} onClick={() => setBetaType(val)}
                  style={{ ...s.btnGhost, fontSize:12, padding:'5px 14px',
                    border: betaType===val ? '1px solid #C9A84C88' : '1px solid #ffffff12',
                    color: betaType===val ? '#C9A84C' : '#555',
                    background: betaType===val ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                  {label}
                </button>
              ))}
            </div>

            {betaBulkMode ? (
              <>
                <textarea
                  placeholder={'athlete1@team.com\nathlete2@school.edu\ncoach@program.org'}
                  value={bulkEmails}
                  onChange={e => { setBulkEmails(e.target.value); setBetaMsg(null); setBulkConfirm(false); }}
                  rows={5}
                  style={{ ...s.input, resize:'vertical', fontFamily:'monospace', fontSize:12, lineHeight:1.6 }}
                />
                {/* Preview count */}
                {bulkEmails.trim() && (() => {
                  const parsed = parseEmails(bulkEmails);
                  return parsed.length > 0 ? (
                    <div style={{ marginTop:8, fontSize:12, color:'#C9A84C66', letterSpacing:1 }}>
                      {parsed.length} valid email{parsed.length!==1?'s':''} detected
                      {!bulkConfirm && !betaBusy && (
                        <button onClick={() => setBulkConfirm(true)}
                          style={{ ...s.btnGold, marginLeft:16, fontSize:11, padding:'4px 14px' }}>
                          Review & Confirm
                        </button>
                      )}
                    </div>
                  ) : <div style={{ marginTop:8, fontSize:11, color:'#e74c3c88' }}>No valid emails detected</div>;
                })()}

                {/* Confirmation step */}
                {bulkConfirm && !betaBusy && (() => {
                  const parsed = parseEmails(bulkEmails);
                  return (
                    <div style={{ marginTop:14, background:'rgba(201,168,76,0.05)', border:'1px solid #C9A84C22', borderRadius:8, padding:'14px 16px' }}>
                      <div style={{ fontSize:11, color:'#C9A84C', letterSpacing:2, textTransform:'uppercase', marginBottom:10 }}>
                        Confirm: Grant {betaType} beta to {parsed.length} email{parsed.length!==1?'s':''}?
                      </div>
                      <div style={{ maxHeight:120, overflowY:'auto', marginBottom:12 }}>
                        {parsed.map(e => (
                          <div key={e} style={{ fontSize:11, color:'#888', fontFamily:'monospace', lineHeight:1.8 }}>{e}</div>
                        ))}
                      </div>
                      <div style={{ display:'flex', gap:10 }}>
                        <button onClick={grantBeta} disabled={betaBusy}
                          style={{ ...s.btnGold, padding:'8px 20px' }}>
                          ✓ Grant {parsed.length} Beta Access{parsed.length!==1?'es':''}
                        </button>
                        <button onClick={() => setBulkConfirm(false)} style={{ ...s.btnGhost, padding:'8px 14px' }}>Cancel</button>
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="email" placeholder="tester@email.com" value={betaEmail}
                  autoComplete="off" inputMode="email"
                  onChange={e => { setBetaEmail(e.target.value); setBetaMsg(null); }}
                  style={{ ...s.input, flex: '1 1 200px', minWidth: 0 }}
                />
                <button onClick={grantBeta} disabled={betaBusy || !betaEmail.trim()}
                  style={{ ...s.btnGold, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
                  {betaBusy ? '…' : '+ Grant Beta'}
                </button>
              </div>
            )}

            {/* Progress bar during bulk operation */}
            {bulkProgress && (
              <div style={{ marginTop:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#C9A84C', marginBottom:6, letterSpacing:1 }}>
                  <span>Granting access…</span>
                  <span>{bulkProgress.done} / {bulkProgress.total}</span>
                </div>
                <div style={{ height:4, background:'#1a1a1a', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', background:'linear-gradient(90deg,#C9A84C,#e8c96a)', borderRadius:2,
                    width: `${Math.round((bulkProgress.done/bulkProgress.total)*100)}%`, transition:'width 0.3s ease' }} />
                </div>
                <div style={{ maxHeight:80, overflowY:'auto', marginTop:8 }}>
                  {bulkProgress.results.slice(-5).map(r => (
                    <div key={r.email} style={{ fontSize:11, fontFamily:'monospace', lineHeight:1.7,
                      color: r.ok ? '#4BAE71' : '#e74c3c' }}>
                      {r.ok ? '✓' : '✗'} {r.email} {!r.ok && `— ${r.msg}`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Final result */}
            {betaMsg && !bulkProgress && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontSize:13, color: betaMsg.ok ? '#C9A84C' : '#f39c12', fontWeight:700, marginBottom: betaMsg.results?.length ? 8 : 0 }}>
                  {betaMsg.text}
                </div>
                {betaMsg.results?.filter(r => !r.ok).length > 0 && (
                  <div style={{ marginTop:6 }}>
                    <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase', marginBottom:4 }}>Failed:</div>
                    {betaMsg.results.filter(r => !r.ok).map(r => (
                      <div key={r.email} style={{ fontSize:11, fontFamily:'monospace', color:'#e74c3c', lineHeight:1.8 }}>
                        ✗ {r.email} — {r.msg}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          </>)}
          {page === 'betausers' && (<>
          {/* Test Access Panel */}
          <div style={{ marginBottom: 40, background: '#111', border: '1px solid #C9A84C22', borderRadius: 12, padding: '24px 28px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: '#C9A84C', marginBottom: 16 }}>
              ◆ Test Access — Grant / Revoke Elite
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="email" placeholder="user@email.com" value={testEmail}
                onChange={e => { setTestEmail(e.target.value); setTestMsg(null); }}
                style={{ ...s.input, width: 280, flex: '0 0 auto' }}
              />
              <button onClick={() => callAction('grant')} disabled={testBusy || !testEmail} style={s.btnGold}>
                {testBusy ? '...' : 'Grant Elite'}
              </button>
              <button onClick={() => callAction('revoke')} disabled={testBusy || !testEmail} style={{ ...s.btnGhost, borderColor: '#e74c3c44', color: '#e74c3c99' }}>
                {testBusy ? '...' : 'Revoke'}
              </button>
            </div>
            {testMsg && (
              <div style={{ marginTop: 12, fontSize: 13, color: testMsg.ok ? '#C9A84C' : '#e74c3c' }}>
                {testMsg.ok ? '✓' : '✗'} {testMsg.text}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 11, color: '#333' }}>
              Grant writes an active subscription row directly to Supabase. User must refresh their app to see updated access.
            </div>
          </div>

          </>)}
          {page === 'betausers' && (<>
          {/* Beta Users Table */}
          <Section title="Beta Users" count={data.betaCount}>
            {!data.betaUsers?.length ? <Empty text="No beta users yet." /> :
              <>
                {/* Search + Filter + Bulk */}
                <div style={{ display:'flex', gap:10, padding:'12px 16px', flexWrap:'wrap', alignItems:'center' }}>
                  <input value={userSearch} onChange={e=>{setUserSearch(e.target.value);setUserPage(0);setSelectedUsers(new Set());}}
                    placeholder="Search email..." style={{ background:'#0D0D0D', border:'1px solid #ffffff18', borderRadius:6, color:'#fff', padding:'6px 12px', fontSize:12, width:200, fontFamily:'inherit', flex:'1 1 160px', minWidth:0 }} />
                  {['all','active','expired'].map(f=>(
                    <button key={f} onClick={()=>{setUserFilter(f);setUserPage(0);setSelectedUsers(new Set());}} style={{ background: userFilter===f?'rgba(201,168,76,0.12)':'transparent', border: userFilter===f?'1px solid #C9A84C66':'1px solid #ffffff12', borderRadius:4, color: userFilter===f?'#C9A84C':'#555', padding:'5px 12px', fontSize:11, letterSpacing:1, textTransform:'uppercase', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>{f}</button>
                  ))}
                  {selectedUsers.size > 0 && (
                    <div style={{ display:'flex', gap:8, alignItems:'center', marginLeft:'auto', flexWrap:'wrap' }}>
                      <span style={{ fontSize:11, color:'#C9A84C', letterSpacing:1, whiteSpace:'nowrap' }}>
                        {selectedUsers.size} selected
                      </span>
                      <button onClick={() => {
                        const emails = [...selectedUsers].map(id => data.betaUsers.find(u=>u.id===id)?.email).filter(Boolean).join('\n');
                        navigator.clipboard?.writeText(emails);
                        alert(`${selectedUsers.size} email${selectedUsers.size===1?'':'s'} copied to clipboard`);
                      }} style={{ ...s.btnGhost, fontSize:11, padding:'4px 10px', whiteSpace:'nowrap' }}>
                        📋 Copy Emails
                      </button>
                      <button onClick={async () => {
                        if (!window.confirm(`Revoke beta access for ${selectedUsers.size} user${selectedUsers.size===1?'':'s'}? They will lose access immediately.`)) return;
                        setBulkUserBusy(true);
                        const userIds = [...selectedUsers].map(id => data.betaUsers.find(u=>u.id===id)?.user_id).filter(Boolean);
                        try {
                          const session = await getAdminSession();
                          for (const uid of userIds) {
                            const u = data.betaUsers.find(x=>x.user_id===uid);
                            await fetch('/.netlify/functions/admin-action', {
                              method:'POST',
                              headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
                              body: JSON.stringify({action:'revoke_beta_user', user_id: uid, email: u?.email||uid}),
                            });
                          }
                          setSelectedUsers(new Set());
                          await fetchData();
                        } catch(err) { alert('Bulk revoke failed: '+err.message); }
                        finally { setBulkUserBusy(false); }
                      }} disabled={bulkUserBusy} style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:4, color:'#e74c3c', padding:'4px 10px', fontSize:11, cursor:bulkUserBusy?'not-allowed':'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                        {bulkUserBusy ? '…' : '✕ Revoke'}
                      </button>
                    </div>
                  )}
                </div>
                {(() => {
                  const filtered = (data.betaUsers||[])
                    .filter(u => userFilter==='all' || (userFilter==='expired'?u.expired:!u.expired))
                    .filter(u => !userSearch || u.email?.toLowerCase().includes(userSearch.toLowerCase()));
                  const pages = Math.ceil(filtered.length / PAGE_SIZE);
                  const page = Math.min(userPage, Math.max(0, pages-1));
                  const rows = filtered.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);
                  const allSelected = rows.length > 0 && rows.every(r => selectedUsers.has(r.id));
                  return <>
                    {/* Select all bar */}
                    {rows.length > 0 && (
                      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 16px', borderTop:'1px solid #ffffff08', borderBottom:'1px solid #ffffff08' }}>
                        <input type="checkbox" checked={allSelected}
                          onChange={e => {
                            const next = new Set(selectedUsers);
                            rows.forEach(r => e.target.checked ? next.add(r.id) : next.delete(r.id));
                            setSelectedUsers(next);
                          }}
                          style={{ cursor:'pointer', accentColor:'#C9A84C' }} />
                        <span style={{ fontSize:11, color:'#555', letterSpacing:1 }}>
                          {allSelected ? 'Deselect all on page' : `Select all ${rows.length} on page`}
                        </span>
                      </div>
                    )}
                    {/* Mobile cards */}
                    <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                      {rows.map((u,i) => (
                        <div key={u.id} onClick={() => {
                          const next = new Set(selectedUsers);
                          selectedUsers.has(u.id) ? next.delete(u.id) : next.add(u.id);
                          setSelectedUsers(next);
                        }} style={{ background: selectedUsers.has(u.id)?'rgba(201,168,76,0.07)':i%2===0?'#0D0D0D':'#111', padding:'12px 16px', cursor:'pointer', display:'flex', gap:12, alignItems:'flex-start' }}>
                          {/* Checkbox */}
                          <input type="checkbox" checked={selectedUsers.has(u.id)} readOnly
                            onClick={e=>e.stopPropagation()}
                            onChange={e => {
                              e.stopPropagation();
                              const next = new Set(selectedUsers);
                              e.target.checked ? next.add(u.id) : next.delete(u.id);
                              setSelectedUsers(next);
                            }}
                            style={{ cursor:'pointer', accentColor:'#C9A84C', marginTop:2, flexShrink:0 }} />
                          {/* Content */}
                          <div style={{ flex:1, minWidth:0 }}>
                            {/* Row 1: Email + Status */}
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                              <span style={{ color:'#C9A84C', fontSize:13, fontWeight:600, wordBreak:'break-all' }}>{u.email}</span>
                              <span style={{ fontSize:10, padding:'3px 8px', borderRadius:4, letterSpacing:1, textTransform:'uppercase', background:u.expired?'rgba(231,76,60,0.15)':'rgba(75,174,113,0.15)', color:u.expired?'#e74c3c':'#4BAE71', flexShrink:0 }}>
                                {u.expired?'Expired':'Active'}
                              </span>
                            </div>
                            {/* Row 2: Details */}
                            <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'center', justifyContent:'space-between' }}>
                              <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                                <span style={{ fontSize:11, color:'#666' }}>⚽ {u.sport || '—'}</span>
                                <span style={{ fontSize:11, color:'#666', fontFamily:'monospace' }}>{u.stripe_customer_id?.replace('beta_','') || '—'}</span>
                                <span style={{ fontSize:11, color: u.expired?'#e74c3c':u.days_left<=7?'#f39c12':'#4BAE71', fontWeight:700 }}>
                                  {u.expired ? 'Expired' : `${u.days_left}d left`}
                                </span>
                                <span style={{ fontSize:11, color:'#444' }}>
                                  Exp: {u.beta_expires_at ? new Date(u.beta_expires_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}
                                </span>
                              </div>
                              {!u.expired && (
                                <button
                                  onClick={e => { e.stopPropagation(); revokeUser(u.user_id, u.email); }}
                                  disabled={revokingUserId === u.user_id}
                                  style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:4, color:'#e74c3c', padding:'3px 10px', cursor:'pointer', fontSize:11, fontFamily:'inherit', whiteSpace:'nowrap', flexShrink:0 }}>
                                  {revokingUserId === u.user_id ? '…' : 'Revoke'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Pagination */}
                    {pages > 1 && (
                      <div style={{ display:'flex', gap:8, justifyContent:'center', padding:'12px 16px', alignItems:'center', flexWrap:'wrap' }}>
                        <button onClick={()=>setUserPage(p=>Math.max(0,p-1))} disabled={page===0} style={{ ...s.btnGhost, fontSize:11, padding:'6px 14px' }}>← Prev</button>
                        <span style={{ fontSize:11, color:'#555' }}>Page {page+1} of {pages} ({filtered.length} total)</span>
                        <button onClick={()=>setUserPage(p=>Math.min(pages-1,p+1))} disabled={page===pages-1} style={{ ...s.btnGhost, fontSize:11, padding:'6px 14px' }}>Next →</button>
                      </div>
                    )}
                  </>;
                })()}
              </>
            }
          </Section>

          </>)}
          {page === 'betacodes' && (<>
          {/* Beta Code Management */}
          <div style={{ marginBottom:40, background:'#111', border:'1px solid #ffffff08', borderRadius:12, padding:'24px 28px' }}>
            <div style={{ fontSize:12, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'#C9A84C', marginBottom:20, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
              <span>◆ Beta Codes</span>
              <button onClick={syncBetaUses} disabled={codeBusy} style={{...s.btnGhost, fontSize:11, padding:'5px 12px', letterSpacing:1}}>
                {codeBusy ? '…' : '↺ Sync Uses'}
              </button>
            </div>
            {/* Existing codes */}
            {data.betaCodes?.length > 0 && (
              <div style={{ overflowX:'auto' }}>
              <table style={{...s.table, marginBottom:24}}><thead><tr>
                {['Code','Label','Uses','Max Uses','Days','Status',''].map(h=><th key={h} style={s.th}>{h}</th>)}
              </tr></thead><tbody>
                {data.betaCodes.map((c,i)=>(
                  <tr key={c.id} style={{background:i%2===0?'#0D0D0D':'#111'}}>
                    <td style={{...s.td,fontFamily:'monospace',color:'#C9A84C',letterSpacing:2}}>{c.code}</td>
                    <td style={s.td}>{c.label}</td>
                    <td style={{...s.td,fontWeight:700}}>{c.uses}</td>
                    <td style={{...s.td,color:'#555'}}>{c.max_uses ?? '∞'}</td>
                    <td style={s.td}>{c.duration_days}</td>
                    <td style={s.td}><Badge val={c.active?'active':'inactive'} /></td>
                    <td style={s.td}>
                      <button onClick={()=>toggleCode(c.id,!c.active)} style={{background:'transparent',border:'1px solid #333',borderRadius:4,color:'#666',padding:'3px 10px',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>
                        {c.active?'Deactivate':'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody></table>
              </div>
            )}
            {/* Create new code */}
            <div style={{ borderTop:'1px solid #ffffff08', paddingTop:20 }}>
              <div style={{ fontSize:11, letterSpacing:2, color:'#444', textTransform:'uppercase', marginBottom:12 }}>Create New Code</div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
                <div><div style={{ fontSize:10, color:'#333', marginBottom:4, letterSpacing:1 }}>CODE *</div>
                  <input style={{...s.input,width:160,fontFamily:'monospace',letterSpacing:2}} placeholder="LAUNCH2026" value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())} /></div>
                <div><div style={{ fontSize:10, color:'#333', marginBottom:4, letterSpacing:1 }}>LABEL</div>
                  <input style={{...s.input,width:200}} placeholder="Campaign label" value={newLabel} onChange={e=>setNewLabel(e.target.value)} /></div>
                <div><div style={{ fontSize:10, color:'#333', marginBottom:4, letterSpacing:1 }}>MAX USES</div>
                  <input style={{...s.input,width:100}} type="number" placeholder="∞" value={newMaxUses} onChange={e=>setNewMaxUses(e.target.value)} /></div>
                <div><div style={{ fontSize:10, color:'#333', marginBottom:4, letterSpacing:1 }}>DAYS (blank=90)</div>
                  <input style={{...s.input,width:100}} type="number" placeholder="90" value={newDuration} onChange={e=>setNewDuration(e.target.value)} /></div>
                <button onClick={createBetaCode} disabled={codeBusy||!newCode} style={s.btnGold}>
                  {codeBusy?'…':'+ Create'}
                </button>
              </div>
              {codeMsg && <div style={{ marginTop:10, fontSize:13, color:codeMsg.ok?'#C9A84C':'#e74c3c' }}>{codeMsg.ok?'✓':'✗'} {codeMsg.text}</div>}
            </div>
          </div>

          </>)}
          {page === 'subscribers' && (<>
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

          </>)}
          {page === 'waitlist' && (<>
          <Section title="Coach Waitlist" count={data.waitlist?.length || 0}>
            {!data.waitlist?.length ? <Empty text="No waitlist signups yet." /> :
              <WaitlistTable waitlist={data.waitlist} getSession={getAdminSession} onRefresh={fetchData} />
            }
          </Section>

          </>)}
          {page === 'feedback' && (<>
          {/* Beta Feedback */}
          <Section title="Beta Feedback" count={data.feedback?.length || 0}>
            {!data.feedback?.length ? <Empty text="No feedback submitted yet." /> :
              <div style={{ overflowX:'auto' }}>
                <table style={s.table}>
                  <thead><tr>
                    {['Email','Category','Rating','Message','Date'].map(h=><th key={h} style={s.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>{data.feedback.map((f,i)=>(
                    <tr key={f.id} style={{ background: i%2===0?'#0D0D0D':'#111', verticalAlign:'top' }}>
                      <td style={{ ...s.td, color:'#C9A84C', fontSize:12, whiteSpace:'nowrap' }}>{f.email}</td>
                      <td style={s.td}>
                        <span style={{ fontSize:10, padding:'3px 8px', borderRadius:4, letterSpacing:1, textTransform:'uppercase',
                          background:'rgba(255,255,255,0.06)', color:'#888' }}>{f.category}</span>
                      </td>
                      <td style={{ ...s.td, color:'#C9A84C', letterSpacing:1 }}>
                        {f.rating ? '★'.repeat(f.rating) + '☆'.repeat(5-f.rating) : '—'}
                      </td>
                      <td style={{ ...s.td, color:'#ccc', maxWidth:360, fontSize:13, lineHeight:1.5 }}>{f.message}</td>
                      <td style={{ ...s.td, color:'#555', fontSize:11, whiteSpace:'nowrap' }}>
                        {new Date(f.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            }
          </Section>
          </>)}
          {page === 'coachops' && <CoachOpsPanel getSession={getAdminSession} />}
          {page === 'contacts' && <ContactsPanel getSession={getAdminSession} />}
          {page === 'manual' && <ManualPanel />}
        </>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, gold, blue }) {
  const accent = gold ? '#C9A84C' : blue ? '#60a5fa' : '#fff';
  const border = gold ? '#C9A84C44' : blue ? '#60a5fa22' : '#ffffff0f';
  return (
    <div style={{ background:'#111', borderRadius:12, padding:'22px 24px', border:`1px solid ${border}` }}>
      <div style={{ fontSize:10, letterSpacing:3, color:gold?'#C9A84C':blue?'#60a5fa':'#444', textTransform:'uppercase', marginBottom:10 }}>{label}</div>
      <div style={{ fontSize:34, fontWeight:700, color:accent, lineHeight:1 }}>{value}</div>
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
      <div style={{ background:'#111', border:'1px solid #ffffff08', borderRadius:12, overflowX:'auto', WebkitOverflowScrolling:'touch' }}>{children}</div>
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

function WaitlistTable({ waitlist, getSession, onRefresh }) {
  const PAGE_SIZE = 25;
  const [search, setSearch]     = useState('');
  const [page,   setPage]       = useState(0);
  const [selected, setSelected] = useState(new Set());

  const [deletingId,  setDeletingId]  = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function deleteWaitlist(id, email) {
    if (!window.confirm(`Remove ${email} from waitlist?`)) return;
    setDeletingId(id);
    try {
      const session = await getSession();
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_waitlist', id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      await onRefresh();
    } catch(err) { alert('Delete failed: ' + err.message); }
    finally { setDeletingId(null); }
  }

  async function bulkDeleteWaitlist() {
    if (!selected.size) return;
    if (!window.confirm(`Remove ${selected.size} entr${selected.size===1?'y':'ies'} from waitlist?`)) return;
    setBulkDeleting(true);
    try {
      const session = await getSession();
      const ids = [...selected];
      const res = await fetch('/.netlify/functions/admin-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_delete_waitlist', ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Bulk delete failed');
      setSelected(new Set());
      await onRefresh();
    } catch(err) { alert('Bulk delete failed: ' + err.message); }
    finally { setBulkDeleting(false); }
  }

  const filtered = waitlist.filter(w => !search || w.email?.toLowerCase().includes(search.toLowerCase()));
  const pages    = Math.ceil(filtered.length / PAGE_SIZE);
  const pg       = Math.min(page, Math.max(0, pages - 1));
  const rows     = filtered.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const allSel   = rows.length > 0 && rows.every(r => selected.has(r.id));

  return (
    <>
      {/* Search + actions */}
      <div style={{ display:'flex', gap:10, padding:'12px 16px', flexWrap:'wrap', alignItems:'center' }}>
        <input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);setSelected(new Set());}}
          placeholder="Search email..." style={{ background:'#0D0D0D', border:'1px solid #ffffff18', borderRadius:6, color:'#fff', padding:'6px 12px', fontSize:12, fontFamily:'inherit', flex:'1 1 160px', minWidth:0 }} />
        {selected.size > 0 && (
          <div style={{ display:'flex', gap:8, alignItems:'center', marginLeft:'auto', flexWrap:'wrap' }}>
            <span style={{ fontSize:11, color:'#C9A84C', letterSpacing:1, whiteSpace:'nowrap' }}>{selected.size} selected</span>
            <button onClick={() => {
              const emails = [...selected].map(id => waitlist.find(w=>w.id===id)?.email).filter(Boolean).join('\n');
              navigator.clipboard?.writeText(emails);
              alert(`${selected.size} email${selected.size===1?'':'s'} copied to clipboard`);
            }} style={{ background:'transparent', border:'1px solid #333', borderRadius:4, color:'#888', padding:'4px 10px', fontSize:11, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
              📋 Copy Emails
            </button>
            <button onClick={bulkDeleteWaitlist} disabled={bulkDeleting}
              style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:4, color:'#e74c3c', padding:'4px 10px', fontSize:11, cursor:bulkDeleting?'not-allowed':'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
              {bulkDeleting ? '…' : `✕ Delete ${selected.size}`}
            </button>
          </div>
        )}
      </div>
      {/* Select all bar */}
      {rows.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 16px', borderTop:'1px solid #ffffff08', borderBottom:'1px solid #ffffff08' }}>
          <input type="checkbox" checked={allSel}
            onChange={e => {
              const next = new Set(selected);
              rows.forEach(r => e.target.checked ? next.add(r.id) : next.delete(r.id));
              setSelected(next);
            }}
            style={{ cursor:'pointer', accentColor:'#C9A84C' }} />
          <span style={{ fontSize:11, color:'#555', letterSpacing:1 }}>
            {allSel ? 'Deselect all on page' : `Select all ${rows.length} on page`}
          </span>
          <span style={{ fontSize:11, color:'#333', marginLeft:'auto' }}>{filtered.length} total</span>
        </div>
      )}
      {/* Cards */}
      <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
        {rows.map((w, i) => (
          <div key={w.id} onClick={() => {
            const next = new Set(selected);
            selected.has(w.id) ? next.delete(w.id) : next.add(w.id);
            setSelected(next);
          }} style={{ background: selected.has(w.id)?'rgba(201,168,76,0.07)':i%2===0?'#0D0D0D':'#111', padding:'12px 16px', cursor:'pointer', display:'flex', gap:12, alignItems:'center' }}>
            <input type="checkbox" checked={selected.has(w.id)} readOnly
              onClick={e=>e.stopPropagation()}
              onChange={e => {
                e.stopPropagation();
                const next = new Set(selected);
                e.target.checked ? next.add(w.id) : next.delete(w.id);
                setSelected(next);
              }}
              style={{ cursor:'pointer', accentColor:'#C9A84C', flexShrink:0 }} />
            <div style={{ flex:1, minWidth:0, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
              <span style={{ color:'#C9A84C', fontSize:13, fontWeight:600, wordBreak:'break-all' }}>{w.email}</span>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:11, color:'#444', whiteSpace:'nowrap' }}>
                  {new Date(w.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                </span>
                <button onClick={e=>{e.stopPropagation();deleteWaitlist(w.id,w.email);}} disabled={deletingId===w.id}
                  style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:4, color:'#e74c3c', padding:'2px 8px', cursor:deletingId===w.id?'not-allowed':'pointer', fontSize:11, fontFamily:'inherit', whiteSpace:'nowrap', flexShrink:0 }}>
                  {deletingId===w.id ? '…' : '✕'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display:'flex', gap:8, justifyContent:'center', padding:'12px 16px', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={pg===0}
            style={{ background:'transparent', border:'1px solid #222', borderRadius:4, color: pg===0?'#333':'#666', padding:'6px 14px', fontSize:11, cursor: pg===0?'default':'pointer', fontFamily:'inherit' }}>← Prev</button>
          <span style={{ fontSize:11, color:'#555' }}>Page {pg+1} of {pages} ({filtered.length} total)</span>
          <button onClick={()=>setPage(p=>Math.min(pages-1,p+1))} disabled={pg===pages-1}
            style={{ background:'transparent', border:'1px solid #222', borderRadius:4, color: pg===pages-1?'#333':'#666', padding:'6px 14px', fontSize:11, cursor: pg===pages-1?'default':'pointer', fontFamily:'inherit' }}>Next →</button>
        </div>
      )}
    </>
  );
}


function TrancheMetricsPanel({ getSession }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  async function load() {
    setLoading(true); setErr(null);
    try {
      const session = await getSession();
      const res = await fetch('/.netlify/functions/coach-ops-metrics', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.tranches || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
  const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(undefined, { month:'short', day:'numeric' }); } catch { return s; } };
  const cell = { padding:'10px 12px', fontSize:12, color:'#ccc', borderBottom:'1px solid #ffffff08', whiteSpace:'nowrap' };
  const head = { padding:'10px 12px', fontSize:10, letterSpacing:1.5, color:'#B8962E', textTransform:'uppercase', textAlign:'left', borderBottom:'1px solid #B8962E22', whiteSpace:'nowrap' };
  const sportLabel = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Coaches';
  return (
    <div style={{ background:'#111', border:'1px solid #B8962E22', borderRadius:12, overflow:'hidden', marginBottom:24 }}>
      <div style={{ padding:'16px 20px', borderBottom:'1px solid #B8962E22', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <p style={{ margin:0, fontSize:10, letterSpacing:4, color:'#B8962E', textTransform:'uppercase' }}>Coach Ops</p>
          <p style={{ margin:0, fontSize:18, fontWeight:700, letterSpacing:1, color:'#fff' }}>Delivery &amp; Engagement</p>
        </div>
        <button onClick={load} disabled={loading} style={{ padding:'8px 18px', background:'transparent', border:'1px solid #B8962E44', borderRadius:8, color:'#B8962E', fontSize:12, cursor:loading?'not-allowed':'pointer', fontFamily:'inherit', letterSpacing:1 }}>{loading?'Loading…':'↻ Refresh'}</button>
      </div>
      <div style={{ padding:'16px 20px' }}>
        {err && <div style={{ padding:'12px 16px', borderRadius:8, marginBottom:16, background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.3)', color:'#e74c3c', fontSize:13 }}>{err}</div>}
        {!err && rows && rows.length === 0 && <div style={{ fontSize:13, color:'#666', padding:'12px 0' }}>No coach tranches yet.</div>}
        {!err && rows && rows.length > 0 && (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:820 }}>
              <thead><tr>
                <th style={head}>Tranche</th><th style={head}>Sent</th><th style={head}>Delivered</th><th style={head}>Opened</th>
                <th style={head}>Bounced</th><th style={head}>Spam</th><th style={head}>Unsub</th><th style={head}>Follow-ups 3/5/7</th>
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.blast_id}>
                    <td style={cell}><span style={{ color:'#fff', fontWeight:600 }}>{sportLabel(t.sport)}</span> <span style={{ color:'#666' }}>· {fmtDate(t.sent_at)}</span></td>
                    <td style={cell}>{t.recipients}</td>
                    <td style={cell}>{t.tracked ? <span>{t.delivered} <span style={{ color:'#27ae60' }}>({pct(t.delivered, t.recipients)})</span></span> : <span style={{ color:'#555' }}>pre-webhook</span>}</td>
                    <td style={cell}>{t.tracked ? <span>{t.opened} <span style={{ color:'#B8962E' }}>({pct(t.opened, t.delivered)})</span></span> : <span style={{ color:'#555' }}>—</span>}</td>
                    <td style={cell}>{t.tracked ? <span>{t.bounced} <span style={{ color:t.bounced>0?'#e67e22':'#555' }}>({pct(t.bounced, t.recipients)})</span></span> : <span style={{ color:'#555' }}>—</span>}</td>
                    <td style={cell}><span style={{ color:t.complained>0?'#e74c3c':'#555' }}>{t.complained}</span></td>
                    <td style={cell}>{t.unsubscribed}</td>
                    <td style={cell}><span style={{ color:'#888' }}>{t.followup_d3} / {t.followup_d5} / {t.followup_d7}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin:'14px 0 0', fontSize:11, color:'#555', lineHeight:1.6 }}>
          Open % is of delivered (industry standard). Bounce % is of sent. Tranches marked <em style={{ color:'#777' }}>pre-webhook</em> were sent before delivery tracking went live — their true numbers live in the Resend dashboard; every tranche from Basketball onward is fully tracked here. Hard bounces &amp; spam complaints auto-suppress from future sends.
        </p>
      </div>
    </div>
  );
}

function MarketingBlastSection({ getSession }) {
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState(null);
  const [testEmail,setTestEmail]=useState('');
  const [form,setForm]=useState({'subject':'Your Elite Athlete access is live — log in now',headline:'Built for YOUR Position.',subheadline:'You were one of the first. Here’s what we built for you.',bodyText:'We sent you an invite. The app is live.\n\nLog in right now and see exactly what Elite Athlete built for your sport and position — a personalized meal plan, a 16-week workout program, and an AI Coach that knows your game.\n\nThis isn’t a generic fitness app. Every sport. Every position. Built specifically for you.\n\nA defensive end gets a completely different program than a wide receiver. A point guard trains nothing like a center. A striker’s nutrition plan looks nothing like a goalkeeper’s. A defenseman recovers differently than a winger. Every volleyball position has its own protocol.\n\nFootball. Basketball. Soccer. Hockey. Volleyball. Your position. Your plan.\n\nPosition-specific nutrition. Position-specific training. AI coaching. Injury recovery. All in one place.\n\nThis is yours. Log in and claim it.',videoUrl:'',thumbnailUrl:'',ctaText:'Open Elite Athlete',ctaUrl:'https://elite-athlete.app',footerNote:"You're receiving this because we believe Elite Athlete can take your athletic performance to the next level.",audience:'all'});
  function update(k,v){setForm(f=>({...f,[k]:v}));}
  async function send(isTest){
    if(!form.subject||!form.headline||!form.bodyText||!form.ctaUrl){setMsg({ok:false,text:'Subject, headline, body text and CTA URL are required.'});return;}
    if(isTest&&!testEmail){setMsg({ok:false,text:'Enter a test email address.'});return;}
    if(!isTest&&!window.confirm('Send blast to all users? This cannot be undone.'))return;
    setBusy(true);setMsg(null);
    try{
      const session=await getSession();
      if(isTest){
        const res=await fetch('/.netlify/functions/marketing-blast',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({...form,testEmail})});
        const data=await res.json();
        setMsg({ok:data.ok,text:data.message||(data.error?`Error: ${data.error}`:'Unknown error')});
        return;
      }
      let page=0,totalSent=0,totalFailed=0,totalEmails=0,blastId=null;
      while(true){
        setMsg({ok:true,text:`Sending... page ${page+1} (${totalSent} sent so far)`});
        const res=await fetch('/.netlify/functions/marketing-blast',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({...form,page,...(blastId?{blastId}:{})})});
        const text=await res.text();
        let data;try{data=JSON.parse(text);}catch{throw new Error('Server error on page '+page);}
        if(!res.ok||data.error)throw new Error(data.error||'Send failed on page '+page);
        if(data.queued){setMsg({ok:true,text:data.message||`Queued ${(data.total||0).toLocaleString()} — sending in the background.`});return;}
        if(data.blastId)blastId=data.blastId;
        totalSent+=data.sent||0;totalFailed+=data.failed||0;totalEmails=data.total||totalEmails;
        if(!data.hasMore)break;
        page++;
        await new Promise(r=>setTimeout(r,500));
      }
      setMsg({ok:totalSent>0,text:`Blast complete: ${totalSent.toLocaleString()} sent · ${totalFailed} failed of ${totalEmails.toLocaleString()} total`});
    }catch(err){setMsg({ok:false,text:err.message});}
    finally{setBusy(false);}
  }
  const inp={width:'100%',background:'#0D0D0D',border:'1px solid #ffffff15',borderRadius:8,padding:'9px 12px',color:'#fff',fontSize:13,fontFamily:'inherit',boxSizing:'border-box',outline:'none'};
  const lbl={fontSize:11,letterSpacing:2,color:'#B8962E',textTransform:'uppercase',marginBottom:6,display:'block'};
  const fld={marginBottom:20};
  return(
    <div style={{background:'#111',border:'1px solid #B8962E22',borderRadius:12,overflow:'hidden',marginBottom:24}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid #B8962E22',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div><p style={{margin:0,fontSize:10,letterSpacing:4,color:'#B8962E',textTransform:'uppercase'}}>Marketing</p><p style={{margin:0,fontSize:18,fontWeight:700,letterSpacing:1,color:'#fff'}}>Email Blast</p></div>
        <span style={{fontSize:11,color:'#444',letterSpacing:1}}>Resend · Rich HTML · Video Email</span>
      </div>
      <div style={{padding:'24px 20px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <div>
            <div style={fld}><label style={lbl}>Audience</label><select value={form.audience} onChange={e=>update('audience',e.target.value)} style={{...inp,cursor:'pointer'}}><option value="invited">Invited — not signed up yet</option><option value="users">Signed Up Users</option><option value="all">Everyone</option></select></div>
            <div style={fld}><label style={lbl}>Subject Line *</label><input value={form.subject} onChange={e=>update('subject',e.target.value)} placeholder="Your position deserves better — watch this" style={inp}/></div>
            <div style={fld}><label style={lbl}>Headline *</label><input value={form.headline} onChange={e=>update('headline',e.target.value)} placeholder="Built for YOUR Position." style={inp}/></div>
            <div style={fld}><label style={lbl}>Subheadline (gold)</label><input value={form.subheadline} onChange={e=>update('subheadline',e.target.value)} placeholder="See what Elite Athlete does for a Defensive End." style={inp}/></div>
            <div style={fld}><label style={lbl}>Body Text *</label><textarea value={form.bodyText} onChange={e=>update('bodyText',e.target.value)} placeholder="Write your message here..." rows={6} style={{...inp,resize:'vertical',lineHeight:1.6}}/></div>
          </div>
          <div>
            <div style={fld}><label style={lbl}>YouTube / Video URL</label><input value={form.videoUrl} onChange={e=>update('videoUrl',e.target.value)} placeholder="https://youtu.be/your-video-id" style={inp}/><p style={{margin:'6px 0 0',fontSize:11,color:'#444'}}>YouTube thumbnails auto-generate. Leave blank for text-only.</p></div>
            <div style={fld}><label style={lbl}>Custom Thumbnail URL (optional)</label><input value={form.thumbnailUrl} onChange={e=>update('thumbnailUrl',e.target.value)} placeholder="https://... (overrides YouTube auto-thumb)" style={inp}/></div>
            <div style={fld}><label style={lbl}>CTA Button Text</label><input value={form.ctaText} onChange={e=>update('ctaText',e.target.value)} placeholder="Open Elite Athlete" style={inp}/></div>
            <div style={fld}><label style={lbl}>CTA Button URL *</label><input value={form.ctaUrl} onChange={e=>update('ctaUrl',e.target.value)} placeholder="https://elite-athlete.app" style={inp}/></div>
            <div style={fld}><label style={lbl}>Footer Note</label><input value={form.footerNote} onChange={e=>update('footerNote',e.target.value)} style={inp}/></div>
          </div>
        </div>
        {msg&&<div style={{padding:'12px 16px',borderRadius:8,marginBottom:20,background:msg.ok?'rgba(39,174,96,0.1)':'rgba(231,76,60,0.1)',border:`1px solid ${msg.ok?'rgba(39,174,96,0.3)':'rgba(231,76,60,0.3)'}`,color:msg.ok?'#27ae60':'#e74c3c',fontSize:13}}>{msg.text}</div>}
        <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div style={{flex:'1 1 220px'}}><label style={{...lbl,marginBottom:6}}>Test Email</label><input value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="your@email.com" style={inp}/></div>
          <button onClick={()=>send(true)} disabled={busy} style={{padding:'10px 24px',background:'transparent',border:'1px solid #B8962E44',borderRadius:8,color:'#B8962E',fontSize:13,cursor:busy?'not-allowed':'pointer',fontFamily:'inherit',letterSpacing:1,whiteSpace:'nowrap',flexShrink:0}}>{busy?'Sending…':'⚡ Send Test'}</button>
          <button onClick={()=>send(false)} disabled={busy} style={{padding:'10px 28px',background:busy?'#333':'#B8962E',border:'none',borderRadius:8,color:busy?'#666':'#0D0D0D',fontSize:13,fontWeight:700,cursor:busy?'not-allowed':'pointer',fontFamily:'inherit',letterSpacing:1,whiteSpace:'nowrap',flexShrink:0}}>{busy?'Sending…':'🚀 Send to All Users'}</button>
        </div>
      </div>
    </div>
  );
}

function CoachOpsPanel({ getSession }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState(null);
  const [drafting, setDrafting] = useState(null);
  const [draftMsg, setDraftMsg] = useState(null);
  const [dfStatus, setDfStatus] = useState('active');
  const [dfKind, setDfKind] = useState('all');
  const [savingMode, setSavingMode] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const session = await getSession();
      const res = await fetch('/.netlify/functions/coach-ops-data', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setD(json);
    } catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function runNow() {
    if (!window.confirm("Generate this week's growth digest now? This reads your KPIs and emails you the report. It sends nothing to users.")) return;
    setRunning(true);
    setMsg({ ok:true, text:'Generating digest - this takes about 10 seconds...' });
    let session;
    try { session = await getSession(); } catch (e) { setMsg({ ok:false, text:e.message }); setRunning(false); return; }
    const beforeId = d?.latest?.id || null;
    // Fire the run. Netlify can cut the browser's synchronous HTTP response
    // before the ~7s job finishes, so we ignore this response and poll the
    // saved snapshot instead. The function still completes server-side.
    fetch('/.netlify/functions/coach-ops-weekly', {
      method:'POST',
      headers:{ Authorization:`Bearer ${session.access_token}`, 'Content-Type':'application/json' },
      body:'{}',
    }).catch(() => {});
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const res = await fetch('/.netlify/functions/coach-ops-data', { headers:{ Authorization:`Bearer ${session.access_token}` } });
        const json = await res.json();
        if (json.latest && json.latest.id !== beforeId) {
          clearInterval(timer);
          setD(json);
          setRunning(false);
          setMsg({ ok:true, text:`Digest generated for week of ${json.latest.week_start} - emailed to you.` });
        } else if (tries >= 20) {
          clearInterval(timer);
          setRunning(false);
          setMsg({ ok:false, text:'Still generating - reload this tab in a moment to see the digest.' });
        }
      } catch (e) { /* keep polling */ }
    }, 3000);
  }
  async function generate(kind) {
    setDrafting(kind); setDraftMsg(null);
    let session;
    try { session = await getSession(); } catch (e) { setDrafting(null); setDraftMsg({ ok:false, text:e.message }); return; }
    const before = (d?.drafts || []).length;
    // Fire the drafting run; poll coach-ops-data for the new draft (Netlify may
    // cut the sync response before Claude finishes; the function still completes).
    fetch('/.netlify/functions/coach-ops-draft', {
      method:'POST',
      headers:{ Authorization:`Bearer ${session.access_token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ kind }),
    }).then(async r => { try { const j = await r.json(); if (j && j.error) { setDrafting(null); setDraftMsg({ ok:false, text:'Draft error: ' + j.error }); } } catch(_){} }).catch(() => {});
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const res = await fetch('/.netlify/functions/coach-ops-data', { headers:{ Authorization:`Bearer ${session.access_token}` } });
        const json = await res.json();
        if ((json.drafts || []).length > before) {
          clearInterval(timer); setD(json); setDrafting(null);
          setDraftMsg({ ok:true, text:'Draft ready - review it below.' });
        } else if (tries >= 15) {
          clearInterval(timer); setDrafting(null);
          setDraftMsg({ ok:false, text:'Still drafting - reload this tab in a moment.' });
        }
      } catch (e) { /* keep polling */ }
    }, 3000);
  }
  async function setMode(mode) {
    if (mode === 'auto' && !window.confirm('Switch Coach Ops to AUTOMATIC?\n\nOn its schedule the agent will generate, auto-approve, AND send emails to real recipients with no per-send review (up to 1000/day). Flip back to Manual anytime to stop everything. Continue?')) return;
    setSavingMode(true);
    try {
      const session = await getSession();
      const res = await fetch('/.netlify/functions/coach-ops-settings', { method:'POST', headers:{ Authorization:`Bearer ${session.access_token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ mode }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
      await load();
    } catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setSavingMode(false); }
  }
  async function runAuto() {
    if (!window.confirm('Run one automatic send cycle now?\n\nIt sends approved coach drafts to their folders, within the daily cap. Real emails go out.')) return;
    setSavingMode(true); setMsg({ ok:true, text:'Running auto cycle...' });
    try {
      const s = await getSession();
      const r = await fetch('/.netlify/functions/coach-ops-auto', { method:'POST', headers:{ Authorization:`Bearer ${s.access_token}`, 'Content-Type':'application/json' }, body:'{}' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      setMsg({ ok:true, text: j.skipped ? 'Skipped: not in automatic send mode.' : (j.capped ? `Daily cap reached (${j.sentToday}/${j.cap}).` : `Auto cycle sent ${j.totalSent || 0} email(s).`) });
      await load();
    } catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setSavingMode(false); }
  }
  const allDrafts = d?.drafts || [];
  const draftCounts = allDrafts.reduce((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
  const draftKinds = [...new Set(allDrafts.map(x=>x.kind))];
  const draftStatusOk = (s)=> dfStatus==='all' ? true : dfStatus==='active' ? (s==='pending'||s==='approved') : s===dfStatus;
  const filteredDrafts = allDrafts.filter(x => draftStatusOk(x.status) && (dfKind==='all' || x.kind===dfKind));
  const latest = d?.latest;
  const m = latest?.metrics || {};
  const stat = (label, val) => (
    <div style={{ background:'#0D0D0D', border:'1px solid #ffffff0f', borderRadius:10, padding:'14px 16px' }}>
      <div style={{ fontSize:10, letterSpacing:2, color:'#555', textTransform:'uppercase', marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color:'#fff' }}>{val}</div>
    </div>
  );
  return (
    <div style={{ marginBottom:40 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:16 }}>
        <div>
          <div style={{ fontSize:11, letterSpacing:3, color:'#B8962E', textTransform:'uppercase' }}>Coach Ops</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#fff' }}>Weekly Growth Digest</div>
        </div>
        <button onClick={runNow} disabled={running} style={{ background:'#C9A84C', border:'none', color:'#0D0D0D', fontWeight:700, padding:'10px 20px', borderRadius:8, cursor:running?'wait':'pointer', fontFamily:'inherit', letterSpacing:1, fontSize:13, opacity:running?0.6:1 }}>
          {running ? 'Generating...' : 'Run digest now'}
        </button>
      </div>
      <div style={{ fontSize:12, color:'#555', marginBottom:16, lineHeight:1.6 }}>
        Read-only weekly report. Scheduled Mondays 13:00 UTC. Reads your KPIs, asks Claude for a prioritized growth digest, saves a snapshot, and emails it to you. Sends nothing to users.
      </div>
      {msg && <div style={{ marginBottom:16, fontSize:13, color: msg.ok ? '#4BAE71' : '#e74c3c' }}>{msg.ok ? 'OK' : 'x'} {msg.text}</div>}
      {(() => {
        const auto = d?.settings?.mode === 'auto';
        return (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, background: auto?'#1a1206':'#0D0D0D', border:'1px solid '+(auto?'#C9A84C55':'#ffffff12'), borderRadius:10, padding:'12px 16px', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:12, color:'#fff', fontWeight:700 }}>Mode: {auto ? 'Automatic' : 'Manual'}</div>
              <div style={{ fontSize:11, color:'#777', marginTop:2 }}>{auto ? 'Agent generates, approves and sends on schedule. Kill switch: switch to Manual.' : 'You review, approve and send every draft. Nothing goes out on its own.'}</div>
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {auto && <button onClick={runAuto} disabled={savingMode} style={{ background:'transparent', color:'#C9A84C', border:'1px solid #C9A84C66', padding:'6px 14px', borderRadius:7, cursor: savingMode?'default':'pointer', fontFamily:'inherit', fontSize:12 }}>Run cycle now</button>}
              <button onClick={()=>setMode('manual')} disabled={savingMode||!auto} style={{ background: auto?'transparent':'#C9A84C', color: auto?'#888':'#0D0D0D', border:'1px solid '+(auto?'#ffffff20':'#C9A84C'), padding:'6px 14px', borderRadius:7, cursor: (savingMode||!auto)?'default':'pointer', fontFamily:'inherit', fontSize:12, fontWeight: auto?400:700 }}>Manual</button>
              <button onClick={()=>setMode('auto')} disabled={savingMode||auto} style={{ background: auto?'#C9A84C':'transparent', color: auto?'#0D0D0D':'#888', border:'1px solid '+(auto?'#C9A84C':'#ffffff20'), padding:'6px 14px', borderRadius:7, cursor: (savingMode||auto)?'default':'pointer', fontFamily:'inherit', fontSize:12, fontWeight: auto?700:400 }}>Automatic</button>
            </div>
          </div>
        );
      })()}
      {loading ? <div style={{ padding:32, textAlign:'center', color:'#333' }}>Loading...</div> :
       !latest ? <div style={{ padding:32, textAlign:'center', color:'#555', background:'#111', borderRadius:12, border:'1px solid #ffffff08' }}>No digest yet. Click "Run digest now" to generate your first weekly report.</div> :
       <>
         <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:20 }}>
           {stat('MRR', '$' + (m.mrr ?? 0).toLocaleString())}
           {stat('Paid subs', m.paidSubscribers ?? '-')}
           {stat('New this week', m.newPaidThisWeek ?? '-')}
           {stat('Beta active', m.betaActive ?? '-')}
           {stat('Invites accepted', (m.invitesAccepted ?? 0) + ' (' + (m.inviteAcceptRate ?? 0) + '%)')}
           {stat('Waitlist', m.waitlist ?? '-')}
         </div>
         <div style={{ background:'#111', border:'1px solid #C9A84C22', borderRadius:12, padding:'20px 24px', marginBottom:20 }}>
           <div style={{ fontSize:10, letterSpacing:2, color:'#B8962E', textTransform:'uppercase', marginBottom:10 }}>Digest - Week of {latest.week_start}</div>
           <div style={{ whiteSpace:'pre-line', color:'#ccc', fontSize:14, lineHeight:1.7 }}>{latest.digest}</div>
         </div>
         {d.snapshots?.length > 1 && (
           <div style={{ background:'#111', border:'1px solid #ffffff08', borderRadius:12, overflowX:'auto' }}>
             <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
               <thead><tr>{['Week','MRR','Paid','New','Beta active','Waitlist'].map(h => <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:10, letterSpacing:2, color:'#333', textTransform:'uppercase', borderBottom:'1px solid #ffffff08' }}>{h}</th>)}</tr></thead>
               <tbody>{d.snapshots.map((sn,i) => (
                 <tr key={sn.id} style={{ background:i%2===0?'#0D0D0D':'#111' }}>
                   <td style={{ padding:'10px 14px', color:'#C9A84C' }}>{sn.week_start}</td>
                   <td style={{ padding:'10px 14px', color:'#bbb' }}>${(sn.metrics?.mrr ?? 0).toLocaleString()}</td>
                   <td style={{ padding:'10px 14px', color:'#bbb' }}>{sn.metrics?.paidSubscribers ?? '-'}</td>
                   <td style={{ padding:'10px 14px', color:'#bbb' }}>{sn.metrics?.newPaidThisWeek ?? '-'}</td>
                   <td style={{ padding:'10px 14px', color:'#bbb' }}>{sn.metrics?.betaActive ?? '-'}</td>
                   <td style={{ padding:'10px 14px', color:'#bbb' }}>{sn.metrics?.waitlist ?? '-'}</td>
                 </tr>
               ))}</tbody>
             </table>
           </div>
         )}
       </>
      }
      {/* Phase 2 - Drafts / approval queue */}
      <div style={{ marginTop:36, borderTop:'1px solid #ffffff10', paddingTop:24 }}>
        <div style={{ fontSize:11, letterSpacing:3, color:'#B8962E', textTransform:'uppercase', marginBottom:6 }}>Drafts - Approval Queue</div>
        <div style={{ fontSize:12, color:'#555', marginBottom:14, lineHeight:1.6 }}>Generate drafts, then review, edit, and approve. Nothing sends until you click Send on an approved email draft.</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
          {[['reengagement','Re-engagement'],['coach_outreach','Coach outreach'],['content','Content'],['lifecycle','Lifecycle']].map(([k,label]) => (
            <button key={k} onClick={() => generate(k)} disabled={!!drafting}
              style={{ background:'transparent', border:'1px solid #C9A84C44', color:'#C9A84C', padding:'7px 14px', borderRadius:8, cursor: drafting?'wait':'pointer', fontFamily:'inherit', fontSize:12, letterSpacing:1, opacity: (drafting && drafting!==k) ? 0.5 : 1 }}>
              {drafting===k ? 'Drafting...' : '+ ' + label}
            </button>
          ))}
        </div>
        {draftMsg && <div style={{ marginBottom:14, fontSize:13, color: draftMsg.ok ? '#4BAE71' : '#e74c3c' }}>{draftMsg.ok ? 'OK' : 'x'} {draftMsg.text}</div>}
        {allDrafts.length > 0 && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
            {[['active','To review'],['pending','Pending'],['approved','Approved'],['sent','Sent'],['rejected','Rejected'],['all','All']].map(([k,label]) => {
              const n = k==='all' ? allDrafts.length : k==='active' ? ((draftCounts.pending||0)+(draftCounts.approved||0)) : (draftCounts[k]||0);
              const on = dfStatus===k;
              return <button key={k} onClick={()=>setDfStatus(k)} style={{ background:on?'#C9A84C':'transparent', color:on?'#0D0D0D':'#888', border:'1px solid '+(on?'#C9A84C':'#ffffff15'), padding:'5px 12px', borderRadius:20, cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:on?700:400 }}>{label}{n>0 && ' ('+n+')'}</button>;
            })}
            <select value={dfKind} onChange={e=>setDfKind(e.target.value)} style={{ background:'#0D0D0D', color:'#ccc', border:'1px solid #ffffff15', borderRadius:8, padding:'5px 10px', fontFamily:'inherit', fontSize:12, marginLeft:'auto' }}>
              <option value="all">All kinds</option>
              {draftKinds.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        )}
        {allDrafts.length === 0
          ? <div style={{ padding:24, textAlign:'center', color:'#444', background:'#111', borderRadius:12, border:'1px solid #ffffff08', fontSize:13 }}>No drafts yet. Use the buttons above to generate one.</div>
          : filteredDrafts.length === 0
          ? <div style={{ padding:20, textAlign:'center', color:'#555', background:'#111', borderRadius:12, border:'1px solid #ffffff08', fontSize:13 }}>No drafts in this view - try a different filter.</div>
          : <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {filteredDrafts.map(dft => <DraftCard key={dft.id} draft={dft} getSession={getSession} reload={load} />)}
            </div>}
      </div>
    </div>
  );
}

const MANUAL_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coach Ops Manual</title><style>
  :root{ --bg:#0D0D0D; --panel:#111; --gold:#C9A84C; --gold2:#B8962E; --ink:#e8e8e8; --mut:#8a8a8a; --dim:#555; --line:#ffffff14; --green:#4BAE71; --red:#e74c3c; }
  *{ box-sizing:border-box; } body{ margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.65; }
  .wrap{ max-width:920px; margin:0 auto; padding:32px 24px 96px; }
  .kicker{ font-size:11px; letter-spacing:4px; color:var(--gold); text-transform:uppercase; }
  h1{ font-size:30px; font-weight:800; margin:6px 0 8px; }
  .sub{ color:var(--mut); font-size:15px; }
  h2{ font-size:21px; margin:40px 0 6px; color:#fff; border-left:3px solid var(--gold); padding-left:12px; }
  h3{ font-size:16px; margin:24px 0 4px; color:var(--gold2); }
  p{ margin:10px 0; color:#d6d6d6; } ul,ol{ margin:10px 0; padding-left:22px; } li{ margin:6px 0; color:#d0d0d0; }
  code{ background:#000; border:1px solid var(--line); border-radius:5px; padding:1px 6px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; color:var(--gold); }
  .card{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 20px; margin:16px 0; }
  .warn{ border-left:3px solid var(--red); } .tag{ display:inline-block; font-size:10px; letter-spacing:1px; text-transform:uppercase; padding:2px 8px; border-radius:4px; background:#1c1c1c; border:1px solid var(--line); color:var(--gold); margin:0 4px 4px 0; }
  table{ width:100%; border-collapse:collapse; margin:14px 0; font-size:14px; } th,td{ text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th{ font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--dim); } td:first-child{ color:var(--gold); font-weight:600; }
  strong{ color:#fff; } .foot{ color:var(--dim); font-size:12px; margin-top:40px; border-top:1px solid var(--line); padding-top:18px; }
</style></head><body><div class="wrap">
<div class="kicker">Elite Athlete · Admin System</div>
<h1>Elite Athlete — Admin Manual</h1>
<div class="sub">Every tab in the admin dashboard, what it does, and the automations running behind it. Version 2.</div>
<div class="card"><strong>Navigation.</strong> The left rail switches pages: Overview, Subscribers, Invites, Beta Users, Beta Codes, Waitlist, Feedback, Marketing, Coach Ops, Contacts, and this Manual. Every email goes out as Elite Athlete &lt;support@elite-athlete.app&gt;, and every scheduled job runs on UTC time.</div>
<h2>1. Overview — the numbers</h2>
<p>Your at-a-glance scoreboard. Two rows of live stats. <strong>Paid:</strong> MRR (monthly recurring revenue), paid Elite subscribers, monthly plans, and coach-waitlist signups. <strong>Beta:</strong> total beta users (90-day free access), active beta (still in window), expired beta (conversion opportunities), and total beta codes. Read-only — it reflects the live database every time you open it.</p>

<h2>2. Subscribers</h2>
<p>Every active paid member in one table: name, email, sport, position, plan, billing interval, and renewal date. Read-only roster of who's paying.</p>

<h2>3. Invites — beta invitations &amp; follow-ups</h2>
<p>Send a personal beta-invite email carrying a unique signup link — the recipient needs no account first; access activates the moment they sign up. <strong>Athlete = 30 days · Coach = 45 days.</strong></p>
<ul>
<li><strong>Outreach template + Type</strong> — pick a template and set athlete or coach before sending.</li>
<li><strong>Import emails</strong> — drag a CSV/TXT/TSV (or paste). Duplicates are stripped and merged; review the parsed list, then Review &amp; Send.</li>
<li><strong>Beta Invites table</strong> — search, filter (all / pending / accepted / expired), Resend, delete, or bulk-delete. Header shows Sent vs Accepted counts.</li>
<li><strong>Day-N Follow-Up</strong> — re-emails everyone invited who hasn't signed up (choose 3 / 5 / 7 days). Runs automatically daily 09:00 UTC; the button runs it now.</li>
<li><strong>Beta Expiry Reminders</strong> — nudges active beta users at 7, 3, and 0 days before expiry. Runs daily 10:00 UTC; each reminder sends once per user.</li>
</ul>

<h2>4. Beta Users</h2>
<p>Everyone on 90-day free access. <strong>Add a tester</strong> directly by email, or work the table: search, filter (all / active / expired), copy selected emails, and grant or revoke access — one user or many at once. Revoking removes access immediately.</p>

<h2>5. Beta Codes</h2>
<p>Self-serve access codes (e.g. <code>ATHLETE2026</code>, <code>COACH2026</code>). Create one with an optional label, a max-uses cap (blank = unlimited), and a duration (blank = 90 days). Activate or deactivate any code, and <strong>Sync Uses</strong> to recount redemptions. A global 500-user beta cap applies across all codes.</p>

<h2>6. Waitlist</h2>
<p>Coach-waitlist signups captured from the marketing site. Review the list and pull names into Invites when you're ready to open coach access.</p>

<h2>7. Feedback</h2>
<p>In-app beta feedback: email, category, star rating, message, and date. Your fastest read on what's landing and what's breaking — mine it for testimonials and the next round of fixes.</p>

<h2>8. Marketing — broadcast blast</h2>
<p>Compose one branded email — headline, sub-headline, body, optional video thumbnail, CTA text and link — and send it to a whole audience: <strong>Invited</strong> (not signed up yet), <strong>Signed Up Users</strong>, or <strong>Everyone</strong>. Always <strong>Test to me</strong> first. This is the mass-announcement channel (launches, features). Coach Ops below is the targeted, personalized one.</p>

<h2>9. Coach Ops — the outreach engine</h2>
<p>Turns a pile of coach contacts into targeted, on-brand, personalized outreach — a human approves the words, the machine does the grind. Pipeline: import a list → sort into folders → generate level-aware drafts → approve → send to a folder → optionally let it run automatically.</p>
<h3>Weekly Growth Digest</h3>
<p>Top of the page. Every Monday 13:00 UTC the agent reads your live KPIs, asks Claude for a prioritized growth analysis, saves a snapshot, and emails it to you. Read-only. "Run digest now" generates one on demand.</p>
<h3>Drafts — the approval queue</h3>
<p>Where the agent writes outreach and you approve it. Nothing sends until you click Send on an approved email.</p>
<table><tr><th>Button</th><th>Produces</th></tr>
<tr><td>Re-engagement</td><td>One email to invited athletes not yet signed up.</td></tr>
<tr><td>Coach outreach</td><td>THREE emails — <span class="tag">coach_hs</span><span class="tag">coach_college</span><span class="tag">coach_pro</span> — one per level.</td></tr>
<tr><td>Content</td><td>Instagram caption, X post, SEO brief — for posting, not emailing.</td></tr>
<tr><td>Lifecycle</td><td>Day-1 activation + win-back emails to users.</td></tr></table>
<p>Filter tabs (To review / Pending / Approved / Sent / Rejected / All, with counts) and a kind dropdown keep the queue usable at any volume. On each card the subject and body are editable — <strong>Save edits</strong> (required before Approve unlocks), <strong>Test to me</strong>, <strong>Approve</strong>, <strong>Send to {audience}</strong>, <strong>Copy</strong> (content), <strong>Reject/Delete</strong>.</p>
<h3>Manual vs Automatic mode</h3>
<p><strong>Manual (default):</strong> you review, approve, and send everything. <strong>Automatic:</strong> daily 14:00 UTC the runner sends your <em>approved</em> coach drafts to their folders, personalized, up to the daily cap. Flipping back to Manual is the kill switch.</p>
<ul><li><strong>Cap: 1,000/day.</strong> Counts today's sends, stops at the cap, resumes tomorrow. No one is emailed twice.</li>
<li><strong>It sends, it does not write</strong> — only copy you already approved.</li>
<li><strong>Run cycle now</strong> triggers a cycle immediately when Automatic is on.</li></ul>
<div class="card warn"><strong>Before Automatic:</strong> send a small batch manually and confirm deliverability. Auto-blasting an unvalidated list wrecks sender reputation.</div>

<h2>10. Contacts — import &amp; folders</h2>
<p>Drop a <strong>CSV, Excel (.xlsx/.xls), or PDF</strong>; the engine maps common headers automatically (<code>Email Address</code>, <code>First Name</code>+<code>Last Name</code>, <code>School Name</code>, <code>ST</code>, <code>Sport</code>). Choose file → set defaults (State, Level, Sport, Region, Source) → Import. It normalizes state→code and level→hs/college/pro, auto-derives region from state, drops rows with no valid email, and dedupes on email. Contacts are filed by <strong>state, region, level, sport</strong>; folder tables show counts by region and state.</p>
<h3>Sending to a folder</h3>
<p>Pick a slice (Level / State / Region / Sport — each with <strong>All</strong>), Preview count, load an approved draft or write your own, Test to me, then Send to folder. It pages through every matching contact, personalizing each. The result line reads "N sent · M failed."</p>

<h2>11. Personalization</h2>
<p>Each contact is one row (email + name + school together), so a name can never land on the wrong address. Tokens, replaced per recipient:</p>
<table><tr><th>Token</th><th>Fills with</th><th>Fallback</th></tr>
<tr><td>{{FIRST_NAME}}</td><td>First name</td><td>(blank — greeting collapses cleanly)</td></tr>
<tr><td>{{LAST_NAME}}</td><td>Last name</td><td>(blank)</td></tr>
<tr><td>{{COACH_NAME}}</td><td>Full name</td><td>Coach</td></tr>
<tr><td>{{SCHOOL}}</td><td>School / program</td><td>your program</td></tr></table>
<p>Drafts greet with "Coach {{FIRST_NAME}},". When a row has no first name the send engine collapses it to a clean "Coach," — never a doubled "Coach Coach" or a raw token.</p>

<h2>12. Welcome emails — new-signup onboarding</h2>
<p>At signup, each person chooses <strong>Athlete</strong> or <strong>Coach</strong>. After they finish onboarding they automatically get a tailored welcome in the brand voice, with App Store / Google Play / Web links — the athlete version leads on "train like a pro before you go pro," the coach version on "run your program from signing day to draft day." Sent once per address, ever. Their role is saved to their profile for future targeting.</p>

<h2>13. Automations &amp; schedules</h2>
<p>What runs on its own, and when. All times UTC.</p>
<table><tr><th>Job</th><th>When</th><th>What it does</th></tr>
<tr><td>Welcome email</td><td>On signup (after onboarding)</td><td>Tailored athlete/coach welcome, once per address.</td></tr>
<tr><td>Invite follow-up</td><td>Daily 09:00</td><td>Re-emails invited non-responders.</td></tr>
<tr><td>Expiry reminders</td><td>Daily 10:00</td><td>Beta 7 / 3 / 0-day nudges.</td></tr>
<tr><td>Growth digest</td><td>Mon 13:00</td><td>KPI + growth analysis email to you.</td></tr>
<tr><td>Coach Ops auto-runner</td><td>Daily 14:00</td><td>Sends approved coach drafts to folders (cap 1,000/day) when Automatic is on.</td></tr></table>

<h2>14. Getting contact data</h2>
<p>Personal coach emails aren't centralized. <strong>Vendors</strong> sell verified, state/sport-filterable coach lists (BookYourData, SchoolDataLists, Averick, Education Data Lists) as CSV or Excel. <strong>Your own lists</strong> drop straight in. <strong>State associations</strong> (e.g. GHSA) give schools, ADs, coach names, and a general school email — usable as AD-addressed outreach.</p>

<h2>15. Best practices</h2>
<ul><li>Start small; watch bounces before scaling.</li><li>Validate lists before large sends.</li><li>Stay Manual until the voice is right.</li><li>Respect the 1,000/day warm-up pace.</li><li>Segment tightly — use the folders.</li><li>Always Test to me before any real send.</li></ul>
<div class="foot">Elite Athlete — Admin Manual · Version 2 · © 2026 Elite Athlete / Tara Tech Entertainment.</div>
</div></body></html>`;
function ManualPanel() {
  return (
    <div style={{ marginBottom:40 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:14 }}>
        <div>
          <div style={{ fontSize:11, letterSpacing:3, color:'#B8962E', textTransform:'uppercase' }}>Reference</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#fff' }}>Admin Manual</div>
        </div>
      </div>
      <iframe title="Coach Ops Manual" srcDoc={MANUAL_HTML} style={{ width:'100%', height:'78vh', border:'1px solid #ffffff14', borderRadius:12, background:'#0D0D0D' }} />
    </div>
  );
}

function ContactsPanel({ getSession }) {
  const [csv, setCsv] = useState('');
  const [parsedRows, setParsedRows] = useState(null);
  const [parseNote, setParseNote] = useState('');
  const [fileName, setFileName] = useState('');
  const [def, setDef] = useState({ state:'', level:'', sport:'', region:'', source:'' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState(null);
  const [folders, setFolders] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [sendF, setSendF] = useState({ level:'all', state:'all', region:'all', sport:'all' });
  const [sendCount, setSendCount] = useState(null);
  const [pickDraft, setPickDraft] = useState('');
  const [sSubject, setSSubject] = useState('');
  const [sBody, setSBody] = useState('');
  const [sMeta, setSMeta] = useState({});
  const [targetBlast, setTargetBlast] = useState('');
  const [engagedOnly, setEngagedOnly] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendMsg, setSendMsg] = useState(null);
  async function loadFolders() {
    try {
      const s = await getSession();
      const r = await fetch('/.netlify/functions/coach-contacts-import', { headers:{ Authorization:`Bearer ${s.access_token}` } });
      const j = await r.json();
      if (r.ok) setFolders(j.folders || []);
    } catch (_) {}
  }
  async function loadDrafts() {
    try {
      const s = await getSession();
      const r = await fetch('/.netlify/functions/coach-ops-data', { headers:{ Authorization:`Bearer ${s.access_token}` } });
      const j = await r.json();
      if (r.ok) setDrafts((j.drafts || []).filter(x => x.channel === 'email' && (x.status === 'approved' || x.status === 'pending')));
    } catch (_) {}
  }
  useEffect(() => { loadFolders(); loadDrafts(); }, []);
  async function previewCount() {
    setSendMsg(null); setSendCount('...');
    try {
      const s = await getSession();
      const qs = new URLSearchParams(sendF).toString();
      const r = await fetch('/.netlify/functions/coach-contacts-import?' + qs, { headers:{ Authorization:`Bearer ${s.access_token}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'count failed');
      setSendCount(j.count);
    } catch (e) { setSendCount(null); setSendMsg({ ok:false, text:e.message }); }
  }
  function choose(id) {
    setPickDraft(id);
    const dr = drafts.find(x => x.id === id);
    if (dr) { setSSubject(dr.subject || ''); setSBody(dr.body || ''); setSMeta(dr.meta || {}); }
  }
  function sendForm() {
    return { subject:sSubject, headline:(sMeta && sMeta.headline) || sSubject || 'Elite Athlete', subheadline:'', bodyText:sBody, ctaText:(sMeta && sMeta.cta_text) || 'Open Elite Athlete', ctaUrl:(sMeta && sMeta.cta_url) || 'https://elite-athlete.app' };
  }
  async function testSend() {
    if (!sSubject || !sBody) { setSendMsg({ ok:false, text:'Pick or write a subject and body first.' }); return; }
    setSendBusy(true); setSendMsg({ ok:true, text:'Sending test...' });
    try {
      const s = await getSession();
      const to = s && s.user && s.user.email;
      let merge = {};
      try {
        const qs = new URLSearchParams(sendF).toString();
        const cr = await fetch('/.netlify/functions/coach-contacts-import?' + qs, { headers:{ Authorization:`Bearer ${s.access_token}` } });
        const cj = await cr.json();
        if (cj && cj.sample) { const nm = (cj.sample.coach_name || '').trim(); const parts = nm.split(/\s+/).filter(Boolean); merge = { name: nm, first: parts[0] || '', last: parts.length>1 ? parts[parts.length-1] : '', school: cj.sample.school || '' }; }
      } catch (_) {}
      const r = await fetch('/.netlify/functions/marketing-blast', { method:'POST', headers:{ Authorization:`Bearer ${s.access_token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ ...sendForm(), audience:'contacts', level:sendF.level, state:sendF.state, region:sendF.region, sport:sendF.sport, testEmail: to, merge }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
      setSendMsg({ ok:true, text: j.message || (merge.first ? ('Test sent to ' + to + ' — previewed as ' + merge.first + (merge.school ? (' / ' + merge.school) : '')) : ('Test sent to ' + to)) }); setSendBusy(false);
    } catch (e) { setSendMsg({ ok:false, text:e.message }); setSendBusy(false); }
  }
  async function sendFolder() {
    if (!sSubject || !sBody) { setSendMsg({ ok:false, text:'Pick or write a subject and body first.' }); return; }
    const label = `level:${sendF.level} · state:${sendF.state} · region:${sendF.region} · sport:${sendF.sport}${engagedOnly ? ' · ENGAGED ONLY' : ''}`;
    if (!window.confirm(`Send this email to the coach folder (${label})?\n\nIt goes to real recipients and cannot be undone.`)) return;
    setSendBusy(true); setSendMsg({ ok:true, text:'Sending...' });
    try {
      const s = await getSession();
      const form = { ...sendForm(), audience:'contacts', level:sendF.level, state:sendF.state, region:sendF.region, sport:sendF.sport, ...(engagedOnly ? { engagedOnly:true } : {}) };
      // Optional: top up an existing tranche. Passing its blast ID makes marketing-blast
      // skip everyone already in it, so only NEW matching contacts (e.g. bounce replacements) get sent.
      let page = 0, sent = 0, failed = 0, total = 0, blastId = (targetBlast || '').trim() || null;
      while (true) {
        const r = await fetch('/.netlify/functions/marketing-blast', { method:'POST', headers:{ Authorization:`Bearer ${s.access_token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ ...form, page, ...(blastId ? { blastId } : {}) }) });
        const t = await r.text(); let dta; try { dta = JSON.parse(t); } catch { throw new Error('Server error on page ' + page); }
        if (!r.ok || dta.error) throw new Error(dta.error || ('Send failed on page ' + page));
        if (dta.queued) { setSendMsg({ ok:true, text: dta.message || ('Queued ' + (dta.total||0) + ' — sending in the background.') }); setSendBusy(false); return; }
        if (dta.blastId) blastId = dta.blastId;
        sent += dta.sent || 0; failed += dta.failed || 0; total = dta.total || total;
        if (!dta.hasMore) break; page++; await new Promise(rr => setTimeout(rr, 500));
      }
      setSendMsg({ ok:true, text:`Sent ${sent} · ${failed} failed (of ${total}).` }); setSendBusy(false);
    } catch (e) { setSendMsg({ ok:false, text:e.message }); setSendBusy(false); }
  }
  async function parseXlsx(file) {
    const XLSX = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const wb = XLSX.read(await file.arrayBuffer(), { type:'array' });
    let name = wb.SheetNames.find(n => /record/i.test(n));
    if (!name) { let best=wb.SheetNames[0], bn=-1; for (const n of wb.SheetNames) { const rows=XLSX.utils.sheet_to_csv(wb.Sheets[n]).split('\n').length; if (rows>bn){bn=rows;best=n;} } name=best; }
    return { csv: XLSX.utils.sheet_to_csv(wb.Sheets[name]), sheet: name };
  }
  async function parsePdf(file) {
    const pdfjs = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let p=1; p<=doc.numPages; p++) { const pg=await doc.getPage(p); const c=await pg.getTextContent(); text += c.items.map(i=>i.str).join(' ') + ' \n'; }
    const all = text.replace(/\s+/g, ' ');
    const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    const rows = []; const seen = new Set(); let m;
    while ((m = emailRe.exec(all))) {
      const email = m[0].toLowerCase(); if (seen.has(email)) continue; seen.add(email);
      const ctx = all.slice(Math.max(0, m.index-90), m.index);
      const caps = ctx.match(/[A-Z][a-zA-Z'.-]+/g) || [];
      const school = (ctx.match(/([A-Z][A-Za-z.'&-]+(?:\s+[A-Z][A-Za-z.'&-]+){0,4}\s+(?:High School|HS|Academy|School|Christian|Prep))/) || [])[1] || null;
      rows.push({ email, coach_name: caps.slice(-2).join(' ') || null, school });
    }
    return rows;
  }
  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFileName(f.name); setResult(null); setMsg(null); setCsv(''); setParsedRows(null); setParseNote('Reading file...');
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    try {
      if (ext === 'xlsx' || ext === 'xls') {
        const { csv, sheet } = await parseXlsx(f);
        setCsv(csv); setParseNote(`Excel parsed — sheet "${sheet}", ${Math.max(0, csv.split('\n').filter(Boolean).length-1)} rows.`);
      } else if (ext === 'pdf') {
        const rows = await parsePdf(f);
        setParsedRows(rows); setParseNote(`PDF parsed — ${rows.length} email(s) found. PDF extraction is best-effort; review the import summary and consider CSV/Excel when available.`);
      } else {
        const text = await f.text(); setCsv(text); setParseNote(`CSV loaded — ${Math.max(0, text.split('\n').filter(Boolean).length-1)} rows.`);
      }
    } catch (err) { setParseNote('Could not read that file: ' + (err.message || err)); }
  }
  async function runImport() {
    const hasRows = parsedRows && parsedRows.length;
    if (!csv && !hasRows) { setMsg({ ok:false, text:'Choose a CSV, Excel, or PDF file first.' }); return; }
    setBusy(true); setMsg({ ok:true, text:'Importing...' }); setResult(null);
    try {
      const s = await getSession();
      const payload = hasRows ? { rows: parsedRows, defaults: def } : { csv, defaults: def };
      const r = await fetch('/.netlify/functions/coach-contacts-import', { method:'POST', headers:{ Authorization:`Bearer ${s.access_token}`, 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      setResult(j.summary); setMsg({ ok:true, text:'Import complete.' });
      await loadFolders();
    } catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setBusy(false); }
  }
  const inp = { background:'#0D0D0D', border:'1px solid #ffffff15', borderRadius:8, padding:'8px 10px', color:'#fff', fontSize:13, fontFamily:'inherit', boxSizing:'border-box', width:'100%' };
  const lbl = { fontSize:10, letterSpacing:1.5, color:'#666', textTransform:'uppercase', marginBottom:4, display:'block' };
  // group folders by state for a compact overview
  const roll = (key) => {
    const g = {};
    folders.forEach(f => { const k = f[key] || '(none)'; g[k] = g[k] || { total:0, hs:0, college:0, pro:0 }; g[k].total += f.n; if (g[k][f.level] !== undefined) g[k][f.level] += f.n; });
    return Object.entries(g).sort((a,b)=>b[1].total-a[1].total);
  };
  const regionRows = roll('region');
  const stateRows = roll('state');
  const PRIORITY_STATES = ['GA','AL','NC','TX','CA','MA','FL','SC','IN','IL','MT','CO','WA','CT','PA'];
  const stateOptions = [...new Set([...stateRows.map(([k])=>k).filter(k=>k && k!=='(none)'), ...PRIORITY_STATES])];
  const folderTable = (title, rows, firstCol) => (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:11, letterSpacing:2, color:'#B8962E', textTransform:'uppercase', marginBottom:10 }}>{title}</div>
      {rows.length === 0
        ? <div style={{ padding:20, textAlign:'center', color:'#555', background:'#111', borderRadius:12, border:'1px solid #ffffff08', fontSize:13 }}>No contacts yet. Import a CSV above.</div>
        : <div style={{ background:'#111', border:'1px solid #ffffff08', borderRadius:12, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead><tr>{[firstCol,'Total','High School','College','Pro'].map(h => <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:10, letterSpacing:2, color:'#444', textTransform:'uppercase', borderBottom:'1px solid #ffffff08' }}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(([k,c],i) => (
                <tr key={k} style={{ background:i%2===0?'#0D0D0D':'#111' }}>
                  <td style={{ padding:'10px 14px', color:'#C9A84C', fontWeight:600 }}>{k}</td>
                  <td style={{ padding:'10px 14px', color:'#fff' }}>{c.total}</td>
                  <td style={{ padding:'10px 14px', color:'#bbb' }}>{c.hs||'-'}</td>
                  <td style={{ padding:'10px 14px', color:'#bbb' }}>{c.college||'-'}</td>
                  <td style={{ padding:'10px 14px', color:'#bbb' }}>{c.pro||'-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
    </div>
  );
  return (
    <div style={{ marginBottom:40 }}>
      <div style={{ fontSize:11, letterSpacing:3, color:'#B8962E', textTransform:'uppercase' }}>Contacts</div>
      <div style={{ fontSize:20, fontWeight:700, color:'#fff', marginBottom:6 }}>Import &amp; Folders</div>
      <div style={{ fontSize:12, color:'#555', marginBottom:18, lineHeight:1.6 }}>Drop any vendor or compiled CSV. The engine maps their columns to your schema, normalizes state/level/email, dedupes, and files each contact into its folder (state / region / level / sport). Set defaults below for fields the file does not include.</div>

      <div style={{ background:'#111', border:'1px solid #ffffff10', borderRadius:12, padding:'18px 20px', marginBottom:24 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
          <label style={{ background:'#C9A84C', color:'#0D0D0D', fontWeight:700, padding:'9px 16px', borderRadius:8, cursor:'pointer', fontSize:13 }}>
            Choose file<input type="file" accept=".csv,.xlsx,.xls,.pdf,text/csv" onChange={onFile} style={{ display:'none' }} />
          </label>
          <span style={{ fontSize:13, color:'#888' }}>{fileName || 'CSV, Excel (.xlsx) or PDF'}</span>
        </div>
        {parseNote && <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>{parseNote}</div>}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, marginBottom:14 }}>
          <div><label style={lbl}>Default state</label><input value={def.state} onChange={e=>setDef(d=>({...d,state:e.target.value}))} placeholder="GA" style={inp} /></div>
          <div><label style={lbl}>Default level</label>
            <select value={def.level} onChange={e=>setDef(d=>({...d,level:e.target.value}))} style={inp}>
              <option value="">—</option><option value="hs">High School</option><option value="college">College</option><option value="pro">Pro</option>
            </select>
          </div>
          <div><label style={lbl}>Default sport</label>
            <select value={def.sport} onChange={e=>setDef(d=>({...d,sport:e.target.value}))} style={inp}>
              <option value="">—</option>
              <option value="football">Football</option>
              <option value="basketball">Basketball</option>
              <option value="soccer">Soccer</option>
              <option value="volleyball">Volleyball</option>
              <option value="hockey">Hockey</option>
            </select>
          </div>
          <div><label style={lbl}>Default region</label>
            <select value={def.region} onChange={e=>setDef(d=>({...d,region:e.target.value}))} style={inp}>
              <option value="">All (auto by state)</option>
              <option value="Northeast">Northeast</option>
              <option value="Southeast">Southeast</option>
              <option value="Midwest">Midwest</option>
              <option value="Southwest">Southwest</option>
              <option value="West">West</option>
            </select>
          </div>
          <div><label style={lbl}>Source label</label><input value={def.source} onChange={e=>setDef(d=>({...d,source:e.target.value}))} placeholder="BookYourData GA HS" style={inp} /></div>
        </div>
        {(() => { const rdy = csv || (parsedRows && parsedRows.length); return (
        <button onClick={runImport} disabled={busy||!rdy} style={{ background: (busy||!rdy)?'#333':'#C9A84C', color:(busy||!rdy)?'#888':'#0D0D0D', border:'none', fontWeight:700, padding:'10px 22px', borderRadius:8, cursor:(busy||!rdy)?'default':'pointer', fontFamily:'inherit', fontSize:13 }}>{busy?'Importing...':'Import contacts'}</button>
        ); })()}
        {msg && <div style={{ marginTop:12, fontSize:13, color: msg.ok ? '#4BAE71' : '#e74c3c' }}>{msg.text}</div>}
        {result && (
          <div style={{ marginTop:14, fontSize:13, color:'#ccc', lineHeight:1.8 }}>
            <div><b style={{ color:'#4BAE71' }}>{result.inserted}</b> new contacts filed · {result.duplicatesSkipped} duplicates skipped · {result.skippedNoEmail} rows had no valid email (of {result.rowsInFile} rows).</div>
            <div style={{ color:'#888', marginTop:4 }}>Mapped columns: {result.mappedColumns.join(', ') || 'none'}.{result.unmappedHeaders.length ? ' Ignored: ' + result.unmappedHeaders.join(', ') + '.' : ''}</div>
          </div>
        )}
      </div>

      <div style={{ background:'#111', border:'1px solid #C9A84C22', borderRadius:12, padding:'18px 20px', marginBottom:24 }}>
        <div style={{ fontSize:11, letterSpacing:2, color:'#B8962E', textTransform:'uppercase', marginBottom:4 }}>Send to a folder</div>
        <div style={{ fontSize:12, color:'#555', marginBottom:14, lineHeight:1.6 }}>Pick a slice (any axis = All), preview the count, load an approved coach draft or write your own, test it to yourself, then send. Sends go to real coach contacts and cannot be undone.</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, marginBottom:12 }}>
          <div><label style={lbl}>Level</label><select value={sendF.level} onChange={e=>{setSendF(f=>({...f,level:e.target.value}));setSendCount(null);}} style={inp}><option value="all">All</option><option value="hs">High School</option><option value="college">College</option><option value="pro">Pro</option></select></div>
          <div><label style={lbl}>State</label><select value={sendF.state} onChange={e=>{setSendF(f=>({...f,state:e.target.value}));setSendCount(null);}} style={inp}><option value="all">All</option>{stateOptions.map(st=><option key={st} value={st}>{st}</option>)}</select></div>
          <div><label style={lbl}>Region</label><select value={sendF.region} onChange={e=>{setSendF(f=>({...f,region:e.target.value}));setSendCount(null);}} style={inp}><option value="all">All</option><option>Northeast</option><option>Southeast</option><option>Midwest</option><option>Southwest</option><option>West</option></select></div>
          <div><label style={lbl}>Sport</label><select value={sendF.sport} onChange={e=>{setSendF(f=>({...f,sport:e.target.value}));setSendCount(null);}} style={inp}><option value="all">All</option><option value="football">Football</option><option value="basketball">Basketball</option><option value="soccer">Soccer</option><option value="volleyball">Volleyball</option><option value="hockey">Hockey</option></select></div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
          <button onClick={previewCount} disabled={sendBusy} style={{ background:'transparent', border:'1px solid #ffffff20', color:'#ccc', padding:'7px 14px', borderRadius:8, cursor:'pointer', fontFamily:'inherit', fontSize:12 }}>Preview count</button>
          {sendCount !== null && <span style={{ fontSize:13, color:'#C9A84C' }}>{sendCount === '...' ? 'Counting...' : (sendCount + ' recipients')}</span>}
        </div>
        <div style={{ marginBottom:10 }}><label style={lbl}>Load an approved draft (optional)</label>
          <select value={pickDraft} onChange={e=>choose(e.target.value)} style={inp}>
            <option value="">— write my own below —</option>
            {drafts.map(d=><option key={d.id} value={d.id}>{(d.kind||'') + ' · ' + (d.audience||'') + ' · ' + (d.subject||'').slice(0,40)}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:10 }}><label style={lbl}>Top up existing blast — optional</label>
          <input value={targetBlast} onChange={e=>setTargetBlast(e.target.value)} placeholder="e.g. blast_1786487736666 — only NEW contacts in this folder get sent" style={inp} />
          <div style={{ fontSize:11, color:'#555', marginTop:4, lineHeight:1.5 }}>Leave blank for a fresh blast. Paste an existing blast ID to add only new/replacement contacts to it (already-sent addresses are skipped automatically).</div>
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, cursor:'pointer', fontSize:13, color:'#ccc' }}>
          <input type="checkbox" checked={engagedOnly} onChange={e=>setEngagedOnly(e.target.checked)} style={{ width:16, height:16, cursor:'pointer' }} />
          <span><b style={{ color:'#B8962E' }}>Engaged only</b> — send just to coaches who genuinely opened/clicked (real reads &gt;2 min after delivery; excludes scanner noise). For warm follow-on sends.</span>
        </label>
        <input value={sSubject} onChange={e=>setSSubject(e.target.value)} placeholder="Subject" style={{ ...inp, marginBottom:8 }} />
        <textarea value={sBody} onChange={e=>setSBody(e.target.value)} rows={6} placeholder="Email body" style={{ ...inp, lineHeight:1.6, resize:'vertical' }} />
        {sendMsg && <div style={{ marginTop:10, fontSize:13, color: sendMsg.ok ? '#4BAE71' : '#e74c3c' }}>{sendMsg.text}</div>}
        <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
          <button onClick={testSend} disabled={sendBusy||!sSubject||!sBody} style={{ background:'transparent', border:'1px solid #ffffff20', color:'#888', padding:'8px 16px', borderRadius:8, cursor:(sendBusy||!sSubject||!sBody)?'default':'pointer', fontFamily:'inherit', fontSize:12 }}>Test to me</button>
          <button onClick={sendFolder} disabled={sendBusy||!sSubject||!sBody} style={{ background:(sendBusy||!sSubject||!sBody)?'#333':'#C9A84C', color:(sendBusy||!sSubject||!sBody)?'#888':'#0D0D0D', border:'none', fontWeight:700, padding:'8px 18px', borderRadius:8, cursor:(sendBusy||!sSubject||!sBody)?'default':'pointer', fontFamily:'inherit', fontSize:12 }}>{sendBusy?'Working...':'Send to folder'}</button>
        </div>
      </div>

      {folderTable('Folders (by region)', regionRows, 'Region')}
      {folderTable('Folders (by state)', stateRows, 'State')}
    </div>
  );
}

function DraftCard({ draft, getSession, reload }) {
  const [subject, setSubject] = useState(draft.subject || '');
  const [bodyText, setBodyText] = useState(draft.body || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const isEmail = draft.channel === 'email';
  const dirty = subject !== (draft.subject || '') || bodyText !== (draft.body || '');
  const statusColor = { pending:'#C9A84C', approved:'#4BAE71', sent:'#60a5fa', rejected:'#e74c3c' }[draft.status] || '#888';
  async function action(a, extra = {}) {
    setBusy(true); setMsg(null);
    try {
      const s2 = await getSession();
      const res = await fetch('/.netlify/functions/coach-ops-draft-action', { method:'POST', headers:{ Authorization:`Bearer ${s2.access_token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ id: draft.id, action: a, ...extra }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
      await reload();
    } catch (e) { setMsg({ ok:false, text:e.message }); setBusy(false); }
  }
  async function sendEmail() {
    if (!window.confirm('Send this approved email to the "' + draft.audience + '" audience? It goes to real recipients and cannot be undone.')) return;
    setBusy(true); setMsg({ ok:true, text:'Sending...' });
    try {
      const s2 = await getSession();
      const form = { subject, headline: (draft.meta && draft.meta.headline) || subject || 'Elite Athlete', subheadline:'', bodyText, ctaText: (draft.meta && draft.meta.cta_text) || 'Open Elite Athlete', ctaUrl: (draft.meta && draft.meta.cta_url) || 'https://elite-athlete.app', audience: draft.audience };
      let page = 0, sent = 0, failed = 0, total = 0, blastId = null;
      while (true) {
        const res = await fetch('/.netlify/functions/marketing-blast', { method:'POST', headers:{ Authorization:`Bearer ${s2.access_token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ ...form, page, ...(blastId ? { blastId } : {}) }) });
        const text = await res.text(); let data; try { data = JSON.parse(text); } catch { throw new Error('Server error on page ' + page); }
        if (!res.ok || data.error) throw new Error(data.error || 'Send failed on page ' + page);
        if (data.queued) { setMsg({ ok:true, text: data.message || ('Queued ' + (data.total||0) + ' — sending in the background.') }); await action('mark_sent', { result: { sent:0, failed:0, total: data.total||0, queued:true } }); setBusy(false); return; }
        if (data.blastId) blastId = data.blastId;
        sent += data.sent || 0; failed += data.failed || 0; total = data.total || total;
        if (!data.hasMore) break;
        page++; await new Promise(r => setTimeout(r, 500));
      }
      await action('mark_sent', { result: { sent, failed, total } });
    } catch (e) { setMsg({ ok:false, text:e.message }); setBusy(false); }
  }
  async function testSend() {
    setBusy(true); setMsg({ ok:true, text:'Sending test...' });
    try {
      const s2 = await getSession();
      const to = s2?.user?.email;
      if (!to) throw new Error('Could not resolve your email from the session.');
      const form = { subject, headline: (draft.meta && draft.meta.headline) || subject || 'Elite Athlete', subheadline:'', bodyText, ctaText: (draft.meta && draft.meta.cta_text) || 'Open Elite Athlete', ctaUrl: (draft.meta && draft.meta.cta_url) || 'https://elite-athlete.app', testEmail: to };
      const res = await fetch('/.netlify/functions/marketing-blast', { method:'POST', headers:{ Authorization:`Bearer ${s2.access_token}`, 'Content-Type':'application/json' }, body: JSON.stringify(form) });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
      setMsg({ ok:true, text:'Test sent to ' + to }); setBusy(false);
    } catch (e) { setMsg({ ok:false, text:e.message }); setBusy(false); }
  }
  function copyOut() {
    try { navigator.clipboard.writeText((subject ? subject + '\n\n' : '') + bodyText); setMsg({ ok:true, text:'Copied to clipboard' }); } catch (e) { setMsg({ ok:false, text:'Copy failed' }); }
  }
  const tag = (t, c) => <span style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', padding:'2px 8px', borderRadius:4, background:'rgba(255,255,255,0.05)', color:c||'#888' }}>{t}</span>;
  return (
    <div style={{ background:'#111', border:'1px solid #ffffff10', borderRadius:12, padding:'16px 18px' }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
        {tag(draft.kind, '#C9A84C')}{tag(draft.channel)}{draft.audience && tag(draft.audience)}{tag(draft.status, statusColor)}
        {draft.meta && draft.meta.platform && draft.meta.platform !== 'null' && tag(draft.meta.platform, '#60a5fa')}
      </div>
      {draft.meta && draft.meta.rationale && <div style={{ fontSize:11, color:'#666', fontStyle:'italic', marginBottom:10 }}>{draft.meta.rationale}</div>}
      {(isEmail || draft.channel === 'seo') && (
        <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject / title"
          style={{ width:'100%', background:'#0D0D0D', border:'1px solid #ffffff15', borderRadius:8, padding:'8px 12px', color:'#fff', fontSize:13, fontFamily:'inherit', boxSizing:'border-box', marginBottom:8 }} />
      )}
      <textarea value={bodyText} onChange={e=>setBodyText(e.target.value)} rows={draft.channel==='social'?4:8}
        style={{ width:'100%', background:'#0D0D0D', border:'1px solid #ffffff15', borderRadius:8, padding:'8px 12px', color:'#ccc', fontSize:13, fontFamily:'inherit', boxSizing:'border-box', lineHeight:1.6, resize:'vertical' }} />
      {msg && <div style={{ marginTop:8, fontSize:12, color: msg.ok ? '#4BAE71' : '#e74c3c' }}>{msg.text}</div>}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
        {dirty && draft.status !== 'sent' && <button onClick={()=>action('update',{ subject, body: bodyText })} disabled={busy} style={btnGhostSm}>Save edits</button>}
        {draft.status === 'pending' && <button onClick={()=>action('approve')} disabled={busy||dirty} style={{...btnGoldSm, opacity: dirty?0.5:1}} title={dirty?'Save edits first':''}>Approve</button>}
        {isEmail && draft.status !== 'sent' && <button onClick={testSend} disabled={busy} style={btnGhostSm} title="Send a single copy to your own email">Test to me</button>}
        {draft.status === 'approved' && isEmail && <button onClick={sendEmail} disabled={busy} style={btnSendSm}>Send to {draft.audience}</button>}
        {(draft.channel==='social'||draft.channel==='seo') && <button onClick={copyOut} disabled={busy} style={btnGhostSm}>Copy</button>}
        {draft.status !== 'sent' && draft.status !== 'rejected' && <button onClick={()=>action('reject')} disabled={busy} style={btnGhostSm}>Reject</button>}
        <button onClick={()=>{ if(window.confirm('Delete this draft?')) action('delete'); }} disabled={busy} style={{...btnGhostSm, color:'#e74c3c88', borderColor:'#e74c3c33'}}>Delete</button>
        {draft.status==='sent' && draft.sent_at && <span style={{ fontSize:11, color:'#60a5fa', alignSelf:'center' }}>Sent {new Date(draft.sent_at).toLocaleString()}</span>}
      </div>
    </div>
  );
}
const btnGhostSm = { background:'transparent', border:'1px solid #ffffff15', color:'#888', padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:12, fontFamily:'inherit' };
const btnGoldSm  = { background:'transparent', border:'1px solid #C9A84C66', color:'#C9A84C', padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:12, fontFamily:'inherit' };
const btnSendSm  = { background:'#C9A84C', border:'none', color:'#0D0D0D', fontWeight:700, padding:'6px 14px', borderRadius:7, cursor:'pointer', fontSize:12, fontFamily:'inherit' };

const s = {
  nav:       { display:'flex', gap:6, flexWrap:'wrap', padding:'10px 16px', background:'#0D0D0D', borderBottom:'1px solid #C9A84C1a', position:'sticky', top:0, zIndex:5 },
  navBtn:    { background:'transparent', border:'1px solid #ffffff12', color:'#888', padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:12, letterSpacing:1, fontFamily:'inherit', textTransform:'uppercase', whiteSpace:'nowrap' },
  navBtnOn:  { background:'rgba(201,168,76,0.12)', border:'1px solid #C9A84C88', color:'#C9A84C' },
  root:      { minHeight:'100vh', background:'#0D0D0D', color:'#fff', fontFamily:"'Rajdhani','Inter',sans-serif", paddingBottom:60, overflowX:'hidden' },
  loginWrap: { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', padding:'16px' },
  loginBox:  { background:'#111', border:'1px solid #C9A84C22', borderRadius:16, padding:'40px 36px', width:'100%', maxWidth:360, textAlign:'center', boxSizing:'border-box' },
  header:    { background:'#111', borderBottom:'1px solid #C9A84C1a', padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 },
  eyebrow:   { fontSize:10, letterSpacing:4, color:'#C9A84C', textTransform:'uppercase', marginBottom:4 },
  title:     { fontSize:22, fontWeight:700, letterSpacing:1 },
  inner:     { maxWidth:1100, margin:'0 auto', padding:'28px 16px' },
  grid:      { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:36 },
  center:    { textAlign:'center', color:'#444', paddingTop:80, fontSize:15 },
  table:     { width:'100%', borderCollapse:'collapse', fontSize:14, minWidth:480 },
  th:        { padding:'12px 16px', textAlign:'left', fontSize:10, letterSpacing:2, color:'#333', textTransform:'uppercase', borderBottom:'1px solid #ffffff08', fontWeight:600, whiteSpace:'nowrap' },
  td:        { padding:'12px 16px', borderBottom:'1px solid #ffffff04', color:'#bbb', verticalAlign:'top' },
  input:     { width:'100%', background:'#0D0D0D', border:'1px solid #ffffff15', borderRadius:8, padding:'9px 12px', color:'#fff', fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' },
  loginErr:  { color:'#e74c3c', fontSize:12, marginTop:10, textAlign:'left' },
  btnSubmit: { width:'100%', marginTop:18, background:'#C9A84C', border:'none', borderRadius:8, padding:'12px', color:'#0D0D0D', fontSize:14, fontWeight:700, letterSpacing:1, cursor:'pointer', fontFamily:'inherit' },
  btnGold:   { background:'transparent', border:'1px solid #C9A84C44', color:'#C9A84C', padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, letterSpacing:1, fontFamily:'inherit', whiteSpace:'nowrap' },
  btnGhost:  { background:'transparent', border:'1px solid #ffffff12', color:'#555', padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, fontFamily:'inherit', whiteSpace:'nowrap' },
};
