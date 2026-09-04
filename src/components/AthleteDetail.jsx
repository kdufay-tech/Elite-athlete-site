// src/components/AthleteDetail.jsx
// One athlete, in depth: readiness trend with a team reference, component
// breakdown, check-in compliance, coach-private notes.
//
// Phase 0 answered "what is she today." This answers "what has she been doing
// for a month" — the question that makes a coach open the app twice a day.
import { useState, useEffect, useCallback } from "react";
import { ReadinessLineChart, ComplianceChart, readColor, readLabel } from "./ReadinessChart";

const RANGES = [
  { d: 7,  label: "7D"  },
  { d: 30, label: "30D" },
  { d: 90, label: "90D" },
];

const lab = {
  fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
  letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)",
};
const btnGhost = {
  padding: "0.45rem 0.85rem", borderRadius: "var(--r)",
  border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
  color: "var(--ivory)", cursor: "pointer", fontFamily: "'Inter',sans-serif",
  fontSize: "0.65rem", letterSpacing: "1.2px", textTransform: "uppercase",
};

const COMPONENTS = [
  { key: "recovery", label: "Recovery", suffix: "",  invert: false },
  { key: "sleep",    label: "Sleep",    suffix: "h", invert: false },
  { key: "energy",   label: "Energy",   suffix: "",  invert: false },
  { key: "mood",     label: "Mood",     suffix: "",  invert: false },
  { key: "soreness", label: "Soreness", suffix: "",  invert: true },
];

export default function AthleteDetail({ athlete, authUser, getFreshToken, shout, nativeShare, apiBase = "", onBack }) {
  const [days, setDays]       = useState(30);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [data, setData]       = useState(null);
  const [team, setTeam]       = useState([]);
  const [notes, setNotes]     = useState([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showTable, setShowTable]   = useState(false);

  const call = useCallback(async (path, opts = {}) => {
    const tok = await getFreshToken();
    const res = await fetch(`${apiBase}/.netlify/functions/${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    return d;
  }, [getFreshToken, apiBase]);

  const load = useCallback(async (d) => {
    setLoading(true); setErr("");
    try {
      const [trend, teamTrend] = await Promise.all([
        call(`coach-trends?athlete_id=${encodeURIComponent(athlete.athlete_id)}&days=${d}`),
        call(`coach-trends?team_id=${encodeURIComponent(athlete.team_id)}&days=${d}`),
      ]);
      setData(trend);
      setTeam(teamTrend.team || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [call, athlete]);

  const loadNotes = useCallback(async () => {
    try {
      const d = await call("coach-notes", {
        method: "POST",
        body: JSON.stringify({ action: "list", athlete_id: athlete.athlete_id }),
      });
      setNotes(d.notes || []);
    } catch (_) { /* notes are secondary — never block the chart on them */ }
  }, [call, athlete]);

  useEffect(() => { load(days); }, [days]); // eslint-disable-line
  useEffect(() => { loadNotes(); }, [athlete.athlete_id]); // eslint-disable-line

  const addNote = async () => {
    const body = noteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      await call("coach-notes", {
        method: "POST",
        body: JSON.stringify({ action: "create", athlete_id: athlete.athlete_id, body }),
      });
      setNoteDraft("");
      await loadNotes();
      shout("Note saved", "◆");
    } catch (e) { shout(e.message, "!"); }
    finally { setSavingNote(false); }
  };

  const delNote = async (id) => {
    try {
      await call("coach-notes", { method: "POST", body: JSON.stringify({ action: "delete", id }) });
      await loadNotes();
    } catch (e) { shout(e.message, "!"); }
  };

  const nudge = async () => {
    try {
      const d = await call("coach-nudge", {
        method: "POST",
        body: JSON.stringify({ action: "send", athlete_ids: [athlete.athlete_id] }),
      });
      if (d.sentCount) shout(`Nudge emailed to ${athlete.name.split(" ")[0]}`, "◆");
      else shout(d.skipped?.[0]?.reason || "Not sent — already nudged today", "!");
    } catch (e) { shout(e.message, "!"); }
  };

  const series = data?.series || [];
  const stats  = data?.stats  || {};
  const last   = athlete.lastCheckIn;
  const rosterSize = team.reduce((m, t) => Math.max(m, Number(t.rosterSize || 0)), 0);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <button onClick={onBack} style={{ ...btnGhost, marginBottom: "0.6rem" }}>← Roster</button>
            <div className="pt">{athlete.name}</div>
            <div style={{ ...lab, marginTop: "0.35rem" }}>
              {[athlete.position, athlete.sport].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "2.6rem", fontWeight: 700,
                          lineHeight: 1, color: readColor(athlete.readiness) }}>
              {athlete.readiness ?? "—"}
            </div>
            {/* Text label, not colour alone — red/green are ΔE 5.2 under deuteranopia */}
            <div style={{ ...lab, marginTop: "0.3rem" }}>
              Readiness · {readLabel(athlete.readiness)}
            </div>
          </div>
        </div>
        <div className="pb" style={{ display: "flex", gap: "1.75rem", flexWrap: "wrap" }}>
          {[
            ["Last check-in", athlete.daysSinceCheckIn === null ? "Never"
              : athlete.daysSinceCheckIn === 0 ? "Today" : `${athlete.daysSinceCheckIn}d ago`],
            ["Total check-ins", athlete.checkInCount ?? 0],
            ["Best in range", stats.best ?? "—"],
            ["Worst in range", stats.worst ?? "—"],
            ["Trend", stats.trend === null || stats.trend === undefined ? "—"
              : `${stats.trend > 0 ? "+" : ""}${stats.trend}`],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={lab}>{k}</div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.15rem",
                            color: "var(--ivory)", marginTop: "0.2rem" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── READINESS TREND ────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph" style={{ flexWrap: "wrap", gap: "0.6rem" }}>
          <div className="pt">Readiness <em>Trend</em></div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {RANGES.map(r => (
              <button key={r.d} onClick={() => setDays(r.d)}
                style={{ ...btnGhost,
                  borderColor: days === r.d ? "var(--gold)" : "rgba(255,255,255,0.14)",
                  color: days === r.d ? "var(--gold-lt)" : "var(--ivory)" }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="pb">
          {loading
            ? <div style={{ color: "var(--muted)", fontSize: "0.8rem", padding: "2rem 0" }}>Loading…</div>
            : err
              ? <div style={{ color: "#C0695E", fontSize: "0.8rem" }}>{err}</div>
              : <>
                  {/* With a one-athlete roster the team average IS this athlete, so the
                      reference line sits exactly under the gold one and the legend
                      advertises a line you cannot see. Hide it until there's a real
                      comparison to make. */}
                  <ReadinessLineChart
                    series={series}
                    reference={rosterSize > 1 ? (data?.teamReference || []) : []}
                    label={athlete.name.split(" ")[0]}
                    refLabel="Team avg"
                    height={220}
                  />
                  <div style={{ marginTop: "1rem" }}>
                    <ComplianceChart team={team} />
                  </div>

                  {/* Table view — the accessibility backstop, and what a coach
                      screenshots for a parent or trainer */}
                  <button onClick={() => setShowTable(t => !t)}
                          style={{ ...btnGhost, marginTop: "1rem" }}>
                    {showTable ? "Hide table" : "View as table"}
                  </button>
                  {showTable && (
                    <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
                        <thead>
                          <tr>{["Date", "Readiness", "Band", "Team avg"].map(h => (
                            <th key={h} style={{ ...lab, textAlign: "left", padding: "0.4rem 0.6rem",
                                                 borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {series.filter(p => p.r !== null).map((p, i) => (
                            <tr key={i}>
                              <td style={{ padding: "0.4rem 0.6rem", color: "var(--muted)" }}>{p.d}</td>
                              <td style={{ padding: "0.4rem 0.6rem", color: "var(--ivory)", fontWeight: 600 }}>{p.r}</td>
                              <td style={{ padding: "0.4rem 0.6rem", color: "var(--muted)" }}>{readLabel(p.r)}</td>
                              <td style={{ padding: "0.4rem 0.6rem", color: "var(--muted)" }}>
                                {(data?.teamReference || []).find(t => t.d === p.d)?.r ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>}
        </div>
      </div>

      {/* ── COMPONENT BREAKDOWN ────────────────────────────────── */}
      {last && (
        <div className="panel" style={{ marginBottom: "1.1rem" }}>
          <div className="ph"><div className="pt">Latest <em>Components</em></div></div>
          <div className="pb" style={{ display: "flex", gap: "1.6rem", flexWrap: "wrap" }}>
            {COMPONENTS.map(c => (
              <div key={c.key} style={{ minWidth: "84px" }}>
                <div style={lab}>{c.label}</div>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.5rem", fontWeight: 700,
                              color: "var(--ivory)", marginTop: "0.15rem" }}>
                  {last[c.key] ?? "—"}{c.suffix}
                </div>
                {c.invert && <div style={{ ...lab, fontSize: "0.5rem" }}>lower is better</div>}
              </div>
            ))}
          </div>
          {last.notes && (
            <div className="pb" style={{ paddingTop: 0 }}>
              <div style={lab}>Athlete note</div>
              <p style={{ color: "var(--muted)", fontSize: "0.82rem", fontStyle: "italic",
                          marginTop: "0.35rem", lineHeight: 1.55 }}>"{last.notes}"</p>
            </div>
          )}
        </div>
      )}

      {/* ── COACH NOTES ────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph"><div className="pt">Coach <em>Notes</em></div></div>
        <div className="pb">
          <p style={{ ...lab, marginBottom: "0.6rem" }}>Private — the athlete never sees these</p>
          <textarea className="fi" value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
            placeholder="Tight hamstring in Tuesday's session — monitor before Friday."
            style={{ width: "100%", minHeight: "64px", background: "transparent",
                     border: "1px solid rgba(255,255,255,0.1)", borderRadius: "var(--r)",
                     color: "var(--ivory)", padding: "0.6rem", fontFamily: "'Inter',sans-serif",
                     fontSize: "0.85rem", outline: "none" }} />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
            <button onClick={addNote} disabled={savingNote || !noteDraft.trim()}
              style={{ padding: "0.6rem 1.1rem", borderRadius: "var(--r)", border: "none",
                       background: savingNote || !noteDraft.trim()
                         ? "rgba(168,130,42,0.3)" : "linear-gradient(135deg,#BFA16A,#8B6520)",
                       color: "#0D0D0D", cursor: savingNote ? "not-allowed" : "pointer",
                       fontFamily: "'DM Sans',sans-serif", fontSize: "0.7rem", fontWeight: 700,
                       letterSpacing: "1.5px", textTransform: "uppercase" }}>
              {savingNote ? "Saving…" : "Add Note"}
            </button>
            <button style={btnGhost} onClick={nudge}>Nudge Athlete</button>
          </div>

          {notes.length > 0 && (
            <div style={{ marginTop: "1.2rem" }}>
              {notes.map(n => (
                <div key={n.id} style={{ padding: "0.7rem 0",
                       borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                    <div style={{ ...lab }}>{new Date(n.created_at).toLocaleDateString("en-US",
                      { month: "short", day: "numeric", year: "numeric" })}</div>
                    <button onClick={() => delNote(n.id)}
                      style={{ background: "none", border: "none", color: "var(--muted)",
                               fontSize: "0.6rem", letterSpacing: "1px", textTransform: "uppercase",
                               cursor: "pointer", textDecoration: "underline" }}>Delete</button>
                  </div>
                  <p style={{ color: "var(--ivory)", fontSize: "0.85rem", marginTop: "0.3rem",
                              lineHeight: 1.55 }}>{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
