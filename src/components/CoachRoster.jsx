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
import { Sparkline, readColor, readLabel } from "./ReadinessChart";

const PAGE = 50;
const SPARK_DAYS = 14;

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
        body: JSON.stringify({ action: "create", name: newName.trim(), sport: newSport.trim() || null }),
      });
      shout(`Team created — code ${d.team.join_code}`, "◆");
      setNewName(""); setNewSport("");
      setActiveTeam(d.team.id);
      await load({ teamId: d.team.id, offset: 0 });
    } catch (e) { shout(e.message, "!"); }
    finally { setCreating(false); }
  };

  const shareCode = async (team) => {
    const text =
      `Join our team on Elite Athlete.\n\nTeam: ${team.name}\nCode: ${team.join_code}\n\n` +
      `1. Download Elite Athlete\n2. Open Profile → Join a Team\n3. Enter ${team.join_code}`;
    const ok = await nativeShare({ title: `${team.name} — team code`, text, url: "https://elite-athlete.app" });
    if (!ok) shout("Invite copied to clipboard", "◆");
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

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div style={L.lab}>Join Code</div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.6rem", fontWeight: 700,
                            letterSpacing: "6px", color: "var(--gold-lt)", marginTop: "0.3rem" }}>
                {team?.join_code}
              </div>
            </div>
            <button style={L.btn} onClick={() => shareCode(team)}>Share Invite</button>
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
        </div>
      </div>

      {/* ── SEARCH (server-side; never filters a client-side full list) ── */}
      {(page.total > 10 || search) && (
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

      {roster.length === 0 && !loading && (
        <div className="panel">
          <div className="pb" style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.6 }}>
            {search
              ? <>No athlete matches "{search}".</>
              : <>No athletes yet. Share code <strong style={{ color: "var(--gold-lt)", letterSpacing: "3px" }}>
                  {team?.join_code}</strong> — they enter it under Profile → Join a Team.</>}
          </div>
        </div>
      )}

      {/* ── ROSTER ROWS ───────────────────────────────────────── */}
      {roster.map(a => (
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
            </div>
          </div>
        </div>
      ))}

      {/* ── PAGINATION ────────────────────────────────────────── */}
      {page.hasMore && (
        <div className="panel">
          <div className="pb" style={{ textAlign: "center" }}>
            <button style={L.btnGhost} disabled={loading}
              onClick={() => load({ offset: roster.length, append: true })}>
              {loading ? "Loading…" : `Load more (${roster.length} of ${page.total})`}
            </button>
          </div>
        </div>
      )}

      {!page.hasMore && page.total > PAGE && (
        <div style={{ ...L.lab, textAlign: "center", padding: "0.75rem" }}>
          All {page.total} athletes shown
        </div>
      )}

      {loading && roster.length === 0 && (
        <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          Loading roster…</div></div>
      )}
    </div>
  );
}
