// src/components/CoachRoster.jsx
// Coach Roster (Phase 0) — team creation, join code, roster with readiness,
// at-risk sorting, and one-tap nudge. Extracted component: App.jsx is already
// ~12k lines, so this lives on its own.
//
// Props:
//   authUser      — Supabase user object
//   getFreshToken — () => Promise<string>  (from lib/supabase)
//   shout         — (msg, icon) => void    toast helper from App
//   nativeShare   — ({title,text,url}) => Promise<bool>
//   apiBase       — API_BASE from App ("" on web, absolute on native)
import { useState, useEffect, useCallback } from "react";

const readColor = (r) =>
  r === null || r === undefined ? "#6B655C" : r >= 7.5 ? "#4BAE71" : r >= 5 ? "#F0C040" : "#C0695E";

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
  const [summary, setSummary]   = useState(null);
  const [noTeam, setNoTeam]     = useState(false);
  const [newName, setNewName]   = useState("");
  const [newSport, setNewSport] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeTeam, setActiveTeam] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const call = useCallback(async (path, opts = {}) => {
    const tok = await getFreshToken();
    const res = await fetch(`${apiBase}/.netlify/functions/${path}`, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, [getFreshToken, apiBase]);

  const load = useCallback(async (teamId = null) => {
    setLoading(true); setErr("");
    try {
      const q = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
      const d = await call(`coach-roster${q}`);
      setTeams(d.teams || []);
      setRoster(d.roster || []);
      setSummary(d.summary || null);
      setNoTeam(!!d.noTeam);
      if (!teamId && d.teams?.length && !activeTeam) setActiveTeam(d.teams[0].id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [call, activeTeam]);

  useEffect(() => { if (authUser?.id) load(); }, [authUser?.id]); // eslint-disable-line

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
      await load(d.team.id);
    } catch (e) { shout(e.message, "!"); }
    finally { setCreating(false); }
  };

  const shareCode = async (team) => {
    const text =
      `Join our team on Elite Athlete.\n\n` +
      `Team: ${team.name}\nCode: ${team.join_code}\n\n` +
      `1. Download Elite Athlete\n2. Open Profile → Join a Team\n3. Enter ${team.join_code}`;
    const ok = await nativeShare({ title: `${team.name} — team code`, text, url: "https://elite-athlete.app" });
    if (!ok) shout("Invite copied to clipboard", "◆");
  };

  const nudge = async (a) => {
    const first = (a.name || "").split(" ")[0] || "there";
    const why = a.daysSinceCheckIn === null
      ? "haven't logged your first check-in yet"
      : a.daysSinceCheckIn >= 3
        ? `haven't checked in for ${a.daysSinceCheckIn} days`
        : "readiness is down";
    const text = `${first} — you ${why}. Two minutes in Elite Athlete and I can see where you're at before practice. Get it in today.`;
    const ok = await nativeShare({ title: `Nudge ${a.name}`, text, url: "" });
    if (!ok) shout("Nudge copied — paste it in a text", "◆");
  };

  // ── NO TEAM YET ────────────────────────────────────────────────
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
      {/* ── HEADER + CODE ─────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph">
          <div className="pt">{team?.name || "My Team"} <em>Roster</em></div>
          <button style={L.btnGhost} onClick={() => load(activeTeam)} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        <div className="pb">
          {teams.length > 1 && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.1rem" }}>
              {teams.map(t => (
                <button key={t.id} onClick={() => { setActiveTeam(t.id); load(t.id); }}
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
              ].map(([k, v, c]) => (
                <div key={k}>
                  <div style={L.lab}>{k}</div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.5rem",
                                fontWeight: 700, color: c, marginTop: "0.2rem" }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {err && (
        <div className="panel" style={{ marginBottom: "1.1rem" }}>
          <div className="pb" style={{ color: "#C0695E", fontSize: "0.8rem" }}>{err}</div>
        </div>
      )}

      {/* ── ROSTER ────────────────────────────────────────────── */}
      {roster.length === 0 && !loading && (
        <div className="panel">
          <div className="pb" style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.6 }}>
            No athletes yet. Share code <strong style={{ color: "var(--gold-lt)", letterSpacing: "3px" }}>
            {team?.join_code}</strong> — they enter it under Profile → Join a Team.
          </div>
        </div>
      )}

      {roster.map(a => {
        const open = expanded === a.athlete_id;
        return (
          <div key={a.athlete_id} className="panel"
               style={{ marginBottom: "0.6rem",
                        borderLeft: `2px solid ${a.atRisk ? "#C0695E" : "rgba(255,255,255,0.05)"}` }}>
            <div onClick={() => setExpanded(open ? null : a.athlete_id)}
                 style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center",
                          justifyContent: "space-between", cursor: "pointer", gap: "1rem" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.95rem",
                              fontWeight: 600, color: "var(--ivory)" }}>{a.name}</div>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: "0.65rem",
                              color: "var(--muted)", marginTop: "0.25rem", letterSpacing: "0.5px" }}>
                  {[a.position, a.sport].filter(Boolean).join(" · ") || "—"}
                  {a.flags.length > 0 && (
                    <span style={{ color: "#C0695E" }}> · {a.flags.join(" · ")}</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.4rem", fontWeight: 700,
                              color: readColor(a.readiness), lineHeight: 1 }}>
                  {a.readiness ?? "—"}
                </div>
                <div style={{ ...L.lab, marginTop: "0.3rem" }}>Readiness</div>
              </div>
            </div>

            {open && (
              <div style={{ padding: "0 1.25rem 1.25rem", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                {a.lastCheckIn ? (
                  <>
                    <div style={{ ...L.lab, margin: "1rem 0 0.6rem" }}>
                      Last Check-In · {a.lastCheckIn.date}
                      {a.daysSinceCheckIn > 0 && ` (${a.daysSinceCheckIn}d ago)`}
                    </div>
                    <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
                      {[["Recovery", a.lastCheckIn.recovery], ["Energy", a.lastCheckIn.energy],
                        ["Sleep", a.lastCheckIn.sleep + "h"], ["Soreness", a.lastCheckIn.soreness],
                        ["Mood", a.lastCheckIn.mood]].map(([k, v]) => (
                        <div key={k}>
                          <div style={L.lab}>{k}</div>
                          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1rem",
                                        color: "var(--ivory)", marginTop: "0.15rem" }}>{v ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                    {a.lastCheckIn.notes && (
                      <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.9rem",
                                  lineHeight: 1.5, fontStyle: "italic" }}>"{a.lastCheckIn.notes}"</p>
                    )}
                  </>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "1rem" }}>
                    No check-ins logged yet.
                  </p>
                )}
                <div style={{ marginTop: "1.1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button style={L.btnGhost} onClick={(e) => { e.stopPropagation(); nudge(a); }}>
                    Nudge Athlete
                  </button>
                  <span style={{ ...L.lab, alignSelf: "center" }}>
                    {a.checkInCount} check-in{a.checkInCount === 1 ? "" : "s"} total
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {loading && (
        <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          Loading roster…</div></div>
      )}
    </div>
  );
}
