// src/components/CoachRoster.jsx
// Coach Roster — team creation, join code, paginated roster with readiness and
// 14-day sparklines, at-risk sorting, nudge, and tap-through to athlete detail.
//
// SCALE: the roster is paginated server-side (coach_roster_page) and the summary
// is computed over the WHOLE roster (coach_roster_summary), so a 500-athlete pro
// squad returns one page of rows and an at-risk count that is actually true —
// not a page-local one that quietly understates risk.
//
// CHARTS: a sparkline per row rather than one multi-line chart. The categorical
// colour ceiling is 8 series; a 40-athlete team would need 40 hues. The roster is
// already a vertical list, which makes it a natural small-multiples grid.
import { useState, useEffect, useCallback } from "react";
import AthleteDetail from "./AthleteDetail";
import PracticeBoard from "./PracticeBoard";
import TeamPrograms from "./TeamPrograms";
import { Sparkline, readColor, readLabel } from "./ReadinessChart";

const PAGE = 50;
const SPARK_DAYS = 14;

// Mirrors ROSTER_CAPS in netlify/functions/coach-team.js. A cap is also a
// monthly spend ceiling: every active athlete is $4.99/month on top of the
// $899/year subscription. Keep the two in step.
const LEVELS = [
  { v: "hs",      label: "High School",              cap: 55  },
  { v: "college", label: "College",                  cap: 150 },
  { v: "pro",     label: "Professional",             cap: 250 },
  { v: "youth",   label: "Youth / multi-grade club", cap: 500 },
];
const capFor = lv => (LEVELS.find(l => l.v === lv)?.cap ?? 55);
const SEAT_COST = 4.99;

const L = {
  wrap:  { marginBottom: "1.5rem" },
  lab:   { fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
           letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)" },
  btn:   { padding: "0.7rem 1.1rem", borderRadius: "var(--r)", border: "none",
           background: "linear-gradient(135deg,#BFA16A,#8B6520)", color: "#0D0D0D",
           cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: "0.72rem",
           fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" },
  btnGhost: { padding: "0.55rem 0.9rem", borderRadius: "var(--r)",
           border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
           color: "var(--ivory)", cursor: "pointer", fontFamily: "'Inter',sans-serif",
           fontSize: "0.65rem", letterSpacing: "1.2px", textTransform: "uppercase" },
  input: { width: "100%", background: "transparent", border: "none",
           borderBottom: "1px solid rgba(255,255,255,0.1)", color: "var(--ivory)",
           fontFamily: "'Inter',sans-serif", fontSize: "0.9rem", padding: "0.8rem 0.15rem",
           outline: "none" },
};

export default function CoachRoster({ authUser, getFreshToken, shout, nativeShare, apiBase = "" }) {
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [teams, setTeams]       = useState([]);
  const [roster, setRoster]     = useState([]);
  const [page, setPage]         = useState({ limit: PAGE, offset: 0, total: 0, hasMore: false });
  const [summary, setSummary]   = useState(null);
  const [noTeam, setNoTeam]     = useState(false);
  const [newName, setNewName]   = useState("");
  const [newSport, setNewSport] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeTeam, setActiveTeam] = useState(null);
  const [search, setSearch]     = useState("");
  const [sparks, setSparks]     = useState({});
  const [selected, setSelected] = useState(null);
  const [view, setView]         = useState("roster");   // roster | practice | programs
  const [removing, setRemoving] = useState(null);
  const [newLevel, setNewLevel] = useState("hs");
  const [invites, setInvites]   = useState([]);
  const [invBusy, setInvBusy]   = useState(false);
  const [invCount, setInvCount] = useState(1);
  const [invLabels, setInvLabels] = useState("");
  const [showInvites, setShowInvites] = useState(false);
  const [manualShare, setManualShare] = useState("");

  const call = useCallback(async (path, opts = {}) => {
    const tok = await getFreshToken();
    const res = await fetch(`${apiBase}/.netlify/functions/${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, [getFreshToken, apiBase]);

  // Sparkline data comes down per PAGE, never for the whole roster.
  const loadSparks = useCallback(async (rows) => {
    const ids = rows.map(r => r.athlete_id).filter(Boolean);
    if (!ids.length) return;
    try {
      const d = await call(`coach-trends?ids=${ids.join(",")}&days=${SPARK_DAYS}`);
      setSparks(prev => ({ ...prev, ...(d.series || {}) }));
    } catch (_) { /* sparklines are decoration — never block the roster on them */ }
  }, [call]);

  const load = useCallback(async ({ teamId = activeTeam, offset = 0, q = search, append = false } = {}) => {
    setLoading(true); setErr("");
    try {
      const params = new URLSearchParams();
      if (teamId) params.set("team_id", teamId);
      if (q)      params.set("q", q);
      params.set("limit", String(PAGE));
      params.set("offset", String(offset));

      const d = await call(`coach-roster?${params.toString()}`);
      setTeams(d.teams || []);
      setNoTeam(!!d.noTeam);
      setSummary(d.summary || null);
      setPage(d.page || { limit: PAGE, offset, total: 0, hasMore: false });
      const rows = d.roster || [];
      setRoster(prev => (append ? [...prev, ...rows] : rows));
      if (!teamId && d.teams?.length && !activeTeam) setActiveTeam(d.teams[0].id);
      loadSparks(rows);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [call, activeTeam, search, loadSparks]);

  useEffect(() => { if (authUser?.id) load({}); }, [authUser?.id]); // eslint-disable-line

  // Debounced search so a coach typing into a 500-athlete roster doesn't fire
  // a request per keystroke.
  useEffect(() => {
    if (!authUser?.id || noTeam) return;
    const t = setTimeout(() => load({ offset: 0, q: search }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line

  const createTeam = async () => {
    if (!newName.trim()) { shout("Team name required", "!"); return; }
    setCreating(true);
    try {
      const d = await call("coach-team", {
        method: "POST",
        body: JSON.stringify({ action: "create", name: newName.trim(), sport: newSport.trim() || null, level: newLevel }),
      });
      shout(`Team created — code ${d.team.join_code}`, "◆");
      setNewName(""); setNewSport("");
      setActiveTeam(d.team.id);
      await load({ teamId: d.team.id, offset: 0 });
    } catch (e) { shout(e.message, "!"); }
    finally { setCreating(false); }
  };

  // ── INVITES ────────────────────────────────────────────────
  const loadInvites = async (teamId) => {
    if (!teamId) return;
    try {
      const d = await call("coach-team", {
        method: "POST",
        body: JSON.stringify({ action: "invite_list", team_id: teamId, status: "pending", limit: 100 }),
      });
      setInvites(d.invites || []);
    } catch (e) { /* non-fatal - the panel just stays empty */ }
  };

  const createInvites = async (team) => {
    setInvBusy(true);
    try {
      const labels = invLabels.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
      const d = await call("coach-team", {
        method: "POST",
        body: JSON.stringify({
          action: "invite_create", team_id: team.id,
          count: labels.length || Number(invCount) || 1,
          labels,
        }),
      });
      const n = (d.invites || []).length;
      shout(d.capped ? `Created ${n} - roster cap reached` : `${n} invite code${n === 1 ? "" : "s"} created`, "\u25C6");
      setInvLabels(""); setInvCount(1);
      await loadInvites(team.id);
    } catch (e) { shout(e.message, "!"); }
    finally { setInvBusy(false); }
  };

  const revokeInvite = async (inv, team) => {
    try {
      await call("coach-team", {
        method: "POST",
        body: JSON.stringify({ action: "invite_revoke", invite_id: inv.id }),
      });
      shout("Invite revoked", "\u25C6");
      await loadInvites(team.id);
    } catch (e) { shout(e.message, "!"); }
  };

  const shareInvite = async (inv, team) => {
    const text =
      `You're invited to join ${team.name} on Elite Athlete.\n\n` +
      `Your code: ${inv.code}\n\n` +
      `1. Download Elite Athlete\n2. Open Profile -> Join a Team\n3. Enter ${inv.code}\n\n` +
      `This code works once and expires in 14 days.`;
    const r = await nativeShare({ title: `${team.name} - invite`, text, url: "https://elite-athlete.app" });
    if (r === "copied") shout("Invite copied to clipboard", "\u25C6");
    else if (r === "failed") { setManualShare(text); }
  };

  const rotateCode = async (team) => {
    if (!window.confirm("Generate a new team code? The current code stops working immediately.")) return;
    try {
      const d = await call("coach-team", {
        method: "POST",
        body: JSON.stringify({ action: "rotate_code", team_id: team.id }),
      });
      shout(`New team code - ${d.join_code}`, "\u25C6");
      await load({ teamId: team.id, offset: 0 });
    } catch (e) { shout(e.message, "!"); }
  };

  const toggleOpenCode = async (team, enabled) => {
    try {
      await call("coach-team", {
        method: "POST",
        body: JSON.stringify({ action: "toggle_code", team_id: team.id, enabled }),
      });
      shout(enabled ? "Open team code is ON - anyone with it can join" : "Open team code is OFF", "\u25C6");
      await load({ teamId: team.id, offset: 0 });
    } catch (e) { shout(e.message, "!"); }
  };

  const shareCode = async (team) => {
    // coach-team.js queries teams with join_code_enabled=is.true, so sharing the
    // code while it is OFF hands the athlete something the server will reject
    // with "No team found with that code". Offer the one-step fix rather than
    // sharing a dead code - or hiding the button, which is what used to happen.
    if (!team?.join_code_enabled) {
      const ok = window.confirm(
        `The shared team code is currently OFF, so ${team?.join_code} will be rejected ` +
        `when an athlete enters it.\n\nTurn it on and share? Anyone holding the code can ` +
        `then join, and each athlete is $${SEAT_COST.toFixed(2)}/month.`
      );
      if (!ok) return;
      await toggleOpenCode(team, true);
    }
    const text =
      `Join our team on Elite Athlete.\n\nTeam: ${team.name}\nCode: ${team.join_code}\n\n` +
      `1. Download Elite Athlete\n2. Open Profile → Join a Team\n3. Enter ${team.join_code}`;
    const r = await nativeShare({ title: `${team.name} - team code`, text, url: "https://elite-athlete.app" });
    if (r === "copied") shout("Team code copied to clipboard", "\u25C6");
    else if (r === "failed") { setManualShare(text); }
  };

  const nudgeStale = async () => {
    try {
      const prev = await call("coach-nudge", {
        method: "POST", body: JSON.stringify({ action: "preview", team_id: activeTeam, days: 3 }),
      });
      if (!prev.wouldNudge?.length) { shout("Nobody is overdue — nothing to send", "◆"); return; }
      const d = await call("coach-nudge", {
        method: "POST", body: JSON.stringify({ action: "send_stale", team_id: activeTeam, days: 3 }),
      });
      shout(`Nudged ${d.sentCount} athlete${d.sentCount === 1 ? "" : "s"}`, "◆");
    } catch (e) { shout(e.message, "!"); }
  };

  const removeAthlete = async (a) => {
    setRemoving(a.athlete_id);
    try {
      await call("coach-team", {
        method: "POST",
        body: JSON.stringify({ action: "remove", team_id: a.team_id, athlete_id: a.athlete_id }),
      });
      shout(`${a.name} removed from the team`, "◆");
      await load({ offset: 0 });
    } catch (e) { shout(e.message, "!"); }
    finally { setRemoving(null); }
  };

  // ── ATHLETE DETAIL ───────────────────────────────────────────────
  if (selected) {
    return (
      <AthleteDetail
        athlete={selected} authUser={authUser} getFreshToken={getFreshToken}
        shout={shout} nativeShare={nativeShare} apiBase={apiBase}
        onBack={() => { setSelected(null); load({ offset: 0 }); }}
      />
    );
  }

  // ── NO TEAM YET ──────────────────────────────────────────────────
  if (!loading && (noTeam || teams.length === 0)) {
    return (
      <div className="panel" style={L.wrap}>
        <div className="ph"><div className="pt">My <em>Team</em></div></div>
        <div className="pb">
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
            Create your team, then share the join code with your athletes. Once they join,
            you'll see every athlete's readiness and check-in status here — at-risk first.
          </p>
          <div style={{ marginBottom: "1.1rem" }}>
            <label style={L.lab}>Team Name</label>
            <input style={L.input} value={newName} onChange={e => setNewName(e.target.value)}
                   placeholder="Luella HS Football" maxLength={80} />
          </div>
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={L.lab}>Sport (optional)</label>
            <input style={L.input} value={newSport} onChange={e => setNewSport(e.target.value)}
                   placeholder="football" maxLength={40} />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <div style={L.lab}>Level</div>
            <select style={{ ...L.input, cursor: "pointer" }} value={newLevel}
                    onChange={e => setNewLevel(e.target.value)}>
              {LEVELS.map(l => (
                <option key={l.v} value={l.v}>{l.label} — up to {l.cap} athletes</option>
              ))}
            </select>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.4rem", lineHeight: 1.5 }}>
              Sets your roster limit. Each active athlete is ${SEAT_COST.toFixed(2)}/month on top of your
              subscription — at {capFor(newLevel)} athletes that is ${(capFor(newLevel) * SEAT_COST).toFixed(2)}/month.
            </div>
          </div>
          <button style={{ ...L.btn, opacity: creating ? 0.5 : 1 }} disabled={creating} onClick={createTeam}>
            {creating ? "Creating…" : "Create Team ◆"}
          </button>
          {err && <p style={{ color: "#C0695E", fontSize: "0.75rem", marginTop: "1rem" }}>{err}</p>}
        </div>
      </div>
    );
  }

  const team = teams.find(t => t.id === activeTeam) || teams[0];

  return (
    <div style={L.wrap}>
      {/* ── HEADER + CODE + SUMMARY ───────────────────────────── */}
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph">
          <div className="pt">{team?.name || "My Team"} <em>Roster</em></div>
          <button style={L.btnGhost} onClick={() => load({ offset: 0 })} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        <div className="pb">
          {teams.length > 1 && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.1rem" }}>
              {teams.map(t => (
                <button key={t.id}
                  onClick={() => { setActiveTeam(t.id); setSparks({}); load({ teamId: t.id, offset: 0 }); }}
                  style={{ ...L.btnGhost,
                    borderColor: t.id === activeTeam ? "var(--gold)" : "rgba(255,255,255,0.14)",
                    color: t.id === activeTeam ? "var(--gold-lt)" : "var(--ivory)" }}>
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {/* ── ADDING ATHLETES ──────────────────────────────────
              Two ways in. Per-athlete invite codes are the default: single
              use, 14-day expiry, revocable. The shared open code is opt-in
              and off by default, because anyone holding it joins instantly
              and every athlete is $4.99/month. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <button style={L.btn}
              onClick={() => { setShowInvites(v => !v); if (!showInvites) loadInvites(team.id); }}>
              {showInvites ? "Hide Invites" : "Invite Athletes"}
            </button>
            <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
              {page.total ?? 0} of {capFor(team?.level)} athletes
              {" · "}${(((page.total ?? 0)) * SEAT_COST).toFixed(2)}/month in seats
            </div>
          </div>

          {/* MANUAL SHARE FALLBACK - shown only when both the share sheet and the
              clipboard were unavailable, so the coach can still copy the text by
              hand instead of a button that appears to do nothing. */}
          {manualShare && (
            <div style={{ marginTop: "1rem", padding: "1rem", borderRadius: "var(--r)",
                          border: "1px solid rgba(191,161,106,0.35)", background: "rgba(191,161,106,0.06)" }}>
              <div style={L.lab}>Copy this and send it yourself</div>
              <textarea readOnly value={manualShare} onFocus={e => e.target.select()}
                style={{ ...L.input, minHeight: "120px", marginTop: "0.5rem" }} />
              <button style={{ ...L.btnGhost, marginTop: "0.6rem" }} onClick={() => setManualShare("")}>
                Done
              </button>
            </div>
          )}

          {showInvites && (
            <div style={{ marginTop: "1.25rem", padding: "1.1rem", borderRadius: "var(--r)",
                          border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
              <div style={L.lab}>Create Invite Codes</div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", margin: "0.4rem 0 0.9rem", lineHeight: 1.55 }}>
                One code per athlete. Each works once and expires in 14 days.
                Names are optional — they only help you track who you sent which code to.
              </div>
              <textarea style={{ ...L.input, minHeight: "68px", resize: "vertical" }}
                placeholder="One name per line, or leave blank and choose a number below"
                value={invLabels} onChange={e => setInvLabels(e.target.value)} />
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.8rem" }}>
                {!invLabels.trim() && (
                  <>
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>How many?</span>
                    <input type="number" min="1" max="25" value={invCount}
                      onChange={e => setInvCount(e.target.value)}
                      style={{ ...L.input, width: "70px", textAlign: "center" }} />
                  </>
                )}
                <button style={{ ...L.btn, opacity: invBusy ? 0.6 : 1 }} disabled={invBusy}
                  onClick={() => createInvites(team)}>
                  {invBusy ? "Creating…" : "Create Codes"}
                </button>
              </div>

              {invites.length > 0 && (
                <div style={{ marginTop: "1.25rem" }}>
                  <div style={L.lab}>Outstanding Codes ({invites.length})</div>
                  {invites.map(inv => (
                    <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem",
                          flexWrap: "wrap", padding: "0.6rem 0",
                          borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.05rem", fontWeight: 700,
                                     letterSpacing: "3px", color: "var(--gold-lt)", minWidth: "104px" }}>
                        {inv.code}
                      </span>
                      <span style={{ fontSize: "0.78rem", color: "var(--ivory2)", flex: 1, minWidth: "110px" }}>
                        {inv.label || "—"}
                      </span>
                      <span style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
                        expires {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : "—"}
                      </span>
                      <button style={L.btnGhost} onClick={() => shareInvite(inv, team)}>Share</button>
                      <button style={L.btnGhost} onClick={() => revokeInvite(inv, team)}>Revoke</button>
                    </div>
                  ))}
                </div>
              )}

            </div>
          )}

          {/* ── SHARED TEAM CODE ─────────────────────────────────
              Sits OUTSIDE the invites panel. It used to be nested inside it,
              so a coach had to press "Invite Athletes" before the team code
              existed on screen at all. */}
          <div style={{ marginTop: "1.5rem", paddingTop: "1.1rem",
                        borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={L.lab}>Shared Team Code</div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", margin: "0.4rem 0 0.8rem", lineHeight: 1.55 }}>
              One code the whole squad can use — handy in a room together. Anyone who has it
              joins immediately and counts as a ${SEAT_COST.toFixed(2)}/month seat, so leave it
              off unless you are actively onboarding.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.3rem", fontWeight: 700,
                             letterSpacing: "5px",
                             color: team?.join_code_enabled ? "var(--gold-lt)" : "var(--muted)" }}>
                {team?.join_code}
              </span>
              <span style={{ fontSize: "0.62rem", letterSpacing: "1.5px", textTransform: "uppercase",
                             color: team?.join_code_enabled ? "#4BAE71" : "var(--muted)" }}>
                {team?.join_code_enabled ? "ON" : "OFF"}
              </span>
              <button style={L.btnGhost} onClick={() => toggleOpenCode(team, !team?.join_code_enabled)}>
                Turn {team?.join_code_enabled ? "off" : "on"}
              </button>
              <button style={L.btnGhost} onClick={() => rotateCode(team)}>New code</button>
              {/* Always rendered. Gating this on join_code_enabled meant a coach
                  with the code OFF saw no Share button at all and read it as broken. */}
              <button style={L.btnGhost} onClick={() => shareCode(team)}>Share</button>
            </div>
          </div>

          {summary && (
            <div style={{ display: "flex", gap: "1.75rem", flexWrap: "wrap", marginTop: "1.5rem",
                          paddingTop: "1.25rem", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              {[
                ["Athletes", summary.total, "var(--ivory)"],
                ["At Risk", summary.atRisk, summary.atRisk > 0 ? "#C0695E" : "#4BAE71"],
                ["Avg Readiness", summary.avgReadiness ?? "—", readColor(summary.avgReadiness)],
                ["Checked In Today", summary.checkedInToday, "var(--ivory)"],
                ["Never Checked In", summary.neverCheckedIn ?? 0,
                  (summary.neverCheckedIn ?? 0) > 0 ? "#D4854A" : "var(--ivory)"],
              ].map(([k, v, c]) => (
                <div key={k}>
                  <div style={L.lab}>{k}</div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.5rem",
                                fontWeight: 700, color: c, marginTop: "0.2rem" }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {summary?.atRisk > 0 && (
            <button style={{ ...L.btnGhost, marginTop: "1.1rem" }} onClick={nudgeStale}>
              Nudge everyone overdue
            </button>
          )}

          {/* View switcher */}
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "1.4rem",
                        paddingTop: "1.1rem", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {[["roster", "Roster"], ["practice", "Practice Day"], ["programs", "Programs"]].map(([k, t]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ ...L.btnGhost,
                  borderColor: view === k ? "var(--gold)" : "rgba(255,255,255,0.14)",
                  color: view === k ? "var(--gold-lt)" : "var(--ivory)" }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "practice" && (
        <PracticeBoard teamId={activeTeam} getFreshToken={getFreshToken} shout={shout}
                       apiBase={apiBase} onSelect={setSelected} />
      )}

      {view === "programs" && (
        <TeamPrograms teamId={activeTeam} teamName={team?.name} getFreshToken={getFreshToken}
                      shout={shout} apiBase={apiBase} />
      )}

      {/* ── SEARCH (server-side; never filters a client-side full list) ── */}
      {view === "roster" && (page.total > 10 || search) && (
        <div className="panel" style={{ marginBottom: "1.1rem" }}>
          <div className="pb" style={{ paddingTop: "1rem", paddingBottom: "1rem" }}>
            <label style={L.lab}>Find an athlete</label>
            <input style={L.input} value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Name or position" />
          </div>
        </div>
      )}

      {err && (
        <div className="panel" style={{ marginBottom: "1.1rem" }}>
          <div className="pb" style={{ color: "#C0695E", fontSize: "0.8rem" }}>{err}</div>
        </div>
      )}

      {view === "roster" && roster.length === 0 && !loading && (
        <div className="panel">
          <div className="pb" style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.6 }}>
            {search
              ? <>No athlete matches "{search}".</>
              : team?.join_code_enabled
                ? <>No athletes yet. Share code <strong style={{ color: "var(--gold-lt)", letterSpacing: "3px" }}>
                    {team?.join_code}</strong> — they enter it under Profile → Join a Team.</>
                /* The shared code is off, and coach-team.js rejects a join on a
                   disabled code. Naming it here would send athletes to a dead end. */
                : <>No athletes yet. Press <strong style={{ color: "var(--gold-lt)" }}>Invite Athletes</strong> above
                    to create a single-use code for each one — or turn the shared team code on.</>}
          </div>
        </div>
      )}

      {/* ── ROSTER ROWS ───────────────────────────────────────── */}
      {view === "roster" && roster.map(a => (
        <div key={a.athlete_id} className="panel"
             onClick={() => setSelected(a)}
             style={{ marginBottom: "0.6rem", cursor: "pointer",
                      borderLeft: `2px solid ${a.atRisk ? "#C0695E" : "rgba(255,255,255,0.05)"}` }}>
          <div style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center",
                        justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 180px" }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.95rem",
                            fontWeight: 600, color: "var(--ivory)" }}>{a.name}</div>
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.65rem",
                            color: "var(--muted)", marginTop: "0.25rem", letterSpacing: "0.5px" }}>
                {[a.position, a.sport].filter(Boolean).join(" · ") || "—"}
                {a.flags?.length > 0 && <span style={{ color: "#C0695E" }}> · {a.flags.join(" · ")}</span>}
              </div>
            </div>

            <div style={{ flexShrink: 0 }}>
              <Sparkline points={sparks[a.athlete_id] || []} />
            </div>

            <div style={{ textAlign: "right", flexShrink: 0, minWidth: "72px" }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.4rem", fontWeight: 700,
                            color: readColor(a.readiness), lineHeight: 1 }}>
                {a.readiness ?? "—"}
              </div>
              {/* Text label, never colour alone: ready-green and at-risk-red are
                  ΔE 5.2 apart under deuteranopia */}
              <div style={{ ...L.lab, marginTop: "0.3rem" }}>{readLabel(a.readiness)}</div>
              <button
                onClick={(e) => {
                  e.stopPropagation();   // row opens detail; this must not
                  if (window.confirm(`Remove ${a.name} from ${a.team_name}? Their own data is untouched — they simply leave the roster.`))
                    removeAthlete(a);
                }}
                disabled={removing === a.athlete_id}
                /* Was 0.55rem muted underlined text tucked under the readiness
                   number - present in the DOM, invisible in practice. */
                style={{ background: "none", border: "1px solid rgba(192,105,94,0.45)",
                         borderRadius: "6px", color: "#C0695E",
                         fontSize: "0.68rem", letterSpacing: "0.5px",
                         cursor: removing === a.athlete_id ? "default" : "pointer",
                         marginTop: "0.6rem", padding: "0.32rem 0.7rem",
                         opacity: removing === a.athlete_id ? 0.5 : 1, whiteSpace: "nowrap" }}>
                {removing === a.athlete_id ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* ── PAGINATION ────────────────────────────────────────── */}
      {view === "roster" && page.hasMore && (
        <div className="panel">
          <div className="pb" style={{ textAlign: "center" }}>
            <button style={L.btnGhost} disabled={loading}
              onClick={() => load({ offset: roster.length, append: true })}>
              {loading ? "Loading…" : `Load more (${roster.length} of ${page.total})`}
            </button>
          </div>
        </div>
      )}

      {view === "roster" && !page.hasMore && page.total > PAGE && (
        <div style={{ ...L.lab, textAlign: "center", padding: "0.75rem" }}>
          All {page.total} athletes shown
        </div>
      )}

      {view === "roster" && loading && roster.length === 0 && (
        <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          Loading roster…</div></div>
      )}
    </div>
  );
}
