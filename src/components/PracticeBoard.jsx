// src/components/PracticeBoard.jsx
// The practice-day board — the job to be done: "who do I hold out today."
//
// Three labelled sections with counts, not a colour-coded list. Readiness is
// never carried by colour alone (ready-green and at-risk-red are only ΔE 5.2
// apart under deuteranopia, and this audience is mostly male athletes/coaches),
// so each athlete shows a number and each section a written heading.
import { useState, useEffect, useCallback } from "react";
import { Sparkline, readColor } from "./ReadinessChart";

const FETCH_LIMIT = 200;   // server cap; the SQL sorts at-risk first so page 1 is the triage list

const L = {
  lab: { fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
         letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)" },
  btnGhost: { padding: "0.55rem 0.9rem", borderRadius: "var(--r)",
         border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
         color: "var(--ivory)", cursor: "pointer", fontFamily: "'Inter',sans-serif",
         fontSize: "0.65rem", letterSpacing: "1.2px", textTransform: "uppercase" },
};

// Sections are defined by rule, not by hue. The heading IS the meaning.
const SECTIONS = [
  { key: "hold", title: "Hold", accent: "#C0695E",
    blurb: "No check-in for 3+ days, or readiness under 5. Talk to these athletes before they train.",
    test: a => a.daysSinceCheckIn === null || a.daysSinceCheckIn >= 3 ||
               (a.readiness !== null && a.readiness < 5) },
  { key: "caution", title: "Train with caution", accent: "#F0C040",
    blurb: "Readiness 5 to 7.5. Modify load, watch them warm up.",
    test: a => a.readiness !== null && a.readiness >= 5 && a.readiness < 7.5 },
  { key: "go", title: "Full go", accent: "#4BAE71",
    blurb: "Readiness 7.5 and above. Cleared for full session.",
    test: a => a.readiness !== null && a.readiness >= 7.5 },
];

export default function PracticeBoard({ teamId, getFreshToken, shout, apiBase = "", onSelect }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [sparks, setSparks]   = useState({});
  const [nudging, setNudging] = useState(false);

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

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams({ limit: String(FETCH_LIMIT), offset: "0" });
      if (teamId) p.set("team_id", teamId);
      const d = await call(`coach-roster?${p.toString()}`);
      const r = d.roster || [];
      setRows(r);
      setTotal(d.page?.total || r.length);
      const ids = r.map(a => a.athlete_id);
      if (ids.length) {
        try {
          const t = await call(`coach-trends?ids=${ids.slice(0, FETCH_LIMIT).join(",")}&days=14`);
          setSparks(t.series || {});
        } catch (_) { /* sparklines are decoration */ }
      }
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [call, teamId]);

  useEffect(() => { load(); }, [teamId]); // eslint-disable-line

  const grouped = SECTIONS.map(s => ({ ...s, list: rows.filter(s.test) }));
  const unknown = rows.filter(a => !SECTIONS.some(s => s.test(a)));

  const nudgeHold = async () => {
    setNudging(true);
    try {
      const d = await call("coach-nudge", {
        method: "POST",
        body: JSON.stringify({ action: "send_stale", team_id: teamId, days: 3 }),
      });
      shout(d.sentCount ? `Nudged ${d.sentCount} athlete${d.sentCount === 1 ? "" : "s"}`
                        : "Nobody to nudge — all current", "◆");
    } catch (e) { shout(e.message, "!"); }
    finally { setNudging(false); }
  };

  const holdCount = grouped.find(g => g.key === "hold")?.list.length || 0;

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph">
          <div className="pt">Practice <em>Day</em></div>
          <button style={L.btnGhost} onClick={load} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        <div className="pb">
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.6 }}>
            Everyone on the roster, sorted by who needs a conversation before they train.
          </p>
          {holdCount > 0 && (
            <button style={{ ...L.btnGhost, marginTop: "1rem" }} onClick={nudgeHold} disabled={nudging}>
              {nudging ? "Sending…" : `Email the ${holdCount} overdue`}
            </button>
          )}
          {total > FETCH_LIMIT && (
            <p style={{ ...L.lab, marginTop: "0.9rem", color: "#D4854A" }}>
              Showing the {FETCH_LIMIT} highest-priority of {total} — at-risk athletes are always first
            </p>
          )}
        </div>
      </div>

      {err && (
        <div className="panel" style={{ marginBottom: "1.1rem" }}>
          <div className="pb" style={{ color: "#C0695E", fontSize: "0.8rem" }}>{err}</div>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          Loading…</div></div>
      )}

      {grouped.map(sec => (
        <div key={sec.key} className="panel" style={{ marginBottom: "1.1rem" }}>
          <div className="ph" style={{ borderLeft: `3px solid ${sec.accent}` }}>
            <div>
              <div className="pt">{sec.title}</div>
              <div style={{ ...L.lab, marginTop: "0.35rem" }}>{sec.blurb}</div>
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.8rem",
                          fontWeight: 700, color: "var(--ivory)" }}>
              {sec.list.length}
            </div>
          </div>
          <div className="pb" style={{ paddingTop: sec.list.length ? "0.75rem" : "1.25rem" }}>
            {sec.list.length === 0
              ? <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Nobody in this group.</div>
              : sec.list.map(a => (
                  <div key={a.athlete_id} onClick={() => onSelect?.(a)}
                       style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                                gap: "1rem", padding: "0.65rem 0", cursor: "pointer", flexWrap: "wrap",
                                borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ minWidth: 0, flex: "1 1 160px" }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.9rem",
                                    fontWeight: 600, color: "var(--ivory)" }}>{a.name}</div>
                      <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                        {[a.position, a.sport].filter(Boolean).join(" · ") || "—"}
                        {a.flags?.length > 0 && <span style={{ color: sec.accent }}> · {a.flags.join(" · ")}</span>}
                      </div>
                    </div>
                    <Sparkline points={sparks[a.athlete_id] || []} w={60} h={20} />
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.15rem",
                                  fontWeight: 700, color: readColor(a.readiness), minWidth: "42px",
                                  textAlign: "right" }}>
                      {a.readiness ?? "—"}
                    </div>
                  </div>
                ))}
          </div>
        </div>
      ))}

      {unknown.length > 0 && (
        <div className="panel">
          <div className="ph"><div className="pt">Unclassified</div></div>
          <div className="pb" style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
            {unknown.length} athlete{unknown.length === 1 ? "" : "s"} with no readiness yet.
          </div>
        </div>
      )}
    </div>
  );
}
