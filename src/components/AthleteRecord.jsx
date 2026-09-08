// src/components/AthleteRecord.jsx
// My Record — the athlete's career, not the last 90 days.
//
// WHY THIS EXISTS
//   Every loader in src/lib/supabase.js filters to three months, so the person
//   who owns the data cannot see their own history. That bites hardest exactly
//   when it matters most: an athlete moving high school -> college -> pro,
//   whose record is the one asset that travels with them. A new coach inherits
//   a blank slate; four years of work evaporates on a roster change.
//
// SCALE
//   Nothing here loads a table. The timeline is ONE ROW PER MONTH from
//   athlete_history_summary() — a four-year career is 48 rows. Raw rows appear
//   only when the athlete opens a specific month/table, and then in pages of 50
//   with an exact server-side count. Team spans are unpaginated because one row
//   per team an athlete has ever belonged to is a handful over a whole career.
//
// READINESS
//   Computed with the SAME formula as _coach-auth.computeReadiness() and
//   coach_roster_page(). It is applied here rather than in SQL so there is no
//   third copy to drift — the rollup returns the raw components and the client
//   owns the arithmetic. avg_mood was added to the rollup for this reason; the
//   0.15 mood term is not optional.
import { useState, useEffect, useCallback } from "react";
import { readColor, readLabel, monthReadiness } from "./ReadinessChart";

const PAGE = 50;

// Mirrors LEVELS in CoachRoster.jsx / ROSTER_CAPS in coach-team.js.
const LEVEL_LABEL = {
  hs: "High School", college: "College", pro: "Professional", youth: "Club",
};

// The drill-downs an athlete can open on a month. Keys MUST match the TABLES
// whitelist in netlify/functions/athlete-history.js — anything else is refused
// server-side, which is the point of the whitelist.
const DETAIL = [
  { table: "check_ins",       label: "Check-ins",  cols: ["date", "recovery", "energy", "sleep", "soreness", "mood"] },
  { table: "workout_logs",    label: "Sessions",   cols: ["date", "exercise", "load", "sets", "rpe", "total_vol"] },
  { table: "benchmarks",      label: "Benchmarks", cols: ["date", "test", "value", "unit"] },
  { table: "weight_logs",     label: "Weight",     cols: ["date", "weight", "body_fat"] },
  { table: "nutrition_logs",  label: "Nutrition",  cols: ["date", "calories", "protein", "carbs", "fat"] },
];

const L = {
  lab:   { fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
           letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)" },
  btn:   { padding: "0.7rem 1.1rem", borderRadius: "var(--r)", border: "none",
           background: "linear-gradient(135deg,#BFA16A,#8B6520)", color: "#0D0D0D",
           cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: "0.72rem",
           fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" },
  btnGhost: { padding: "0.5rem 0.85rem", borderRadius: "var(--r)",
           border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
           color: "var(--ivory)", cursor: "pointer", fontFamily: "'Inter',sans-serif",
           fontSize: "0.62rem", letterSpacing: "1.2px", textTransform: "uppercase" },
  num:   { fontFamily: "'DM Sans',sans-serif", fontWeight: 700, lineHeight: 1 },
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// month arrives as a bare 'YYYY-MM-DD'. new Date() on that parses as UTC and
// can slide to the previous month west of Greenwich, so split it by hand.
const monthLabel = (m) => {
  const [y, mo] = String(m).split("-");
  return `${MONTHS[Number(mo) - 1]} ${y}`;
};
const dayLabel = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

export default function AthleteRecord({ getFreshToken, shout, apiBase = "", sport }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [months, setMonths]   = useState([]);
  const [teams, setTeams]     = useState([]);
  const [open, setOpen]       = useState(null);   // month string being drilled into
  const [detail, setDetail]   = useState(null);   // { table, rows, total, offset, hasMore }
  const [detailBusy, setDetailBusy] = useState(false);

  const call = useCallback(async (body) => {
    const tok = await getFreshToken();
    const res = await fetch(`${apiBase}/.netlify/functions/athlete-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    return d;
  }, [getFreshToken, apiBase]);

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true); setErr("");
      try {
        // Two independent reads, so one failing does not blank the other. Team
        // history is the nicer-to-have; the months are the record itself.
        const [sum, tm] = await Promise.all([
          call({ action: "summary" }),
          call({ action: "teams" }).catch(() => ({ teams: [] })),
        ]);
        if (dead) return;
        setMonths(sum.active || []);
        setTeams(tm.teams || []);
      } catch (e) {
        if (!dead) setErr(e.message);
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [call]);

  // Raw rows for one month and one table. Server-side window + limit/offset +
  // exact count; the month bounds are computed here so the request is narrow.
  const loadDetail = async (month, table, offset = 0, append = false) => {
    setDetailBusy(true);
    try {
      const [y, mo] = month.split("-").map(Number);
      const from = new Date(Date.UTC(y, mo - 1, 1)).toISOString();
      const to   = new Date(Date.UTC(y, mo, 0, 23, 59, 59)).toISOString();
      const d = await call({ action: "page", table, from, to, limit: PAGE, offset });
      setDetail(prev => ({
        table, total: d.total, offset: d.offset, hasMore: d.hasMore,
        rows: append && prev?.table === table ? [...prev.rows, ...d.rows] : d.rows,
      }));
    } catch (e) { shout?.(e.message, "!"); }
    finally { setDetailBusy(false); }
  };

  const toggleMonth = (m) => {
    if (open === m.month) { setOpen(null); setDetail(null); return; }
    setOpen(m.month); setDetail(null);
  };

  // ── CAREER SPANS ─────────────────────────────────────────────
  const Spans = () => {
    if (teams.length === 0) return null;
    return (
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph"><div className="pt">Career <em>Timeline</em></div></div>
        <div className="pb">
          {teams.map(t => (
            <div key={t.membership_id}
                 style={{ display: "flex", alignItems: "baseline", gap: "0.9rem", flexWrap: "wrap",
                          padding: "0.7rem 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0,
                             background: t.current ? "#4BAE71" : "rgba(255,255,255,0.22)" }} />
              <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.95rem",
                             fontWeight: 600, color: "var(--ivory)" }}>{t.name}</span>
              {t.level && <span style={{ ...L.lab }}>{LEVEL_LABEL[t.level] || t.level}</span>}
              <span style={{ fontSize: "0.72rem", color: "var(--muted)", flex: 1, minWidth: "140px" }}>
                {dayLabel(t.joined_at)} — {t.current ? "present" : dayLabel(t.left_at)}
                {t.position ? ` · ${t.position}` : ""}
              </span>
            </div>
          ))}
          <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.8rem", lineHeight: 1.55 }}>
            Your record stays yours. Leaving a team ends the span — it does not delete anything above or below.
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
      Building your record…</div></div>;
  }

  if (err) {
    return <div className="panel"><div className="pb">
      <div style={{ color: "#C0695E", fontSize: "0.85rem" }}>{err}</div>
      <button style={{ ...L.btnGhost, marginTop: "0.9rem" }} onClick={() => window.location.reload()}>Retry</button>
    </div></div>;
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <Spans />

      {months.length === 0 ? (
        <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.6 }}>
          Nothing logged yet. Every check-in, session and benchmark you record from here on becomes part of a
          record that follows you — school to college to whatever comes next.
        </div></div>
      ) : (
        <>
          <div style={{ ...L.lab, marginBottom: "0.7rem" }}>
            {months.length} active month{months.length === 1 ? "" : "s"} · newest first
          </div>

          {months.map(m => {
            const r = monthReadiness(m, sport);
            const isOpen = open === m.month;
            return (
              <div key={m.month} className="panel" style={{ marginBottom: "0.6rem" }}>
                <div onClick={() => toggleMonth(m)}
                     style={{ padding: "1rem 1.25rem", cursor: "pointer", display: "flex",
                              alignItems: "center", justifyContent: "space-between",
                              gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 150px" }}>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.95rem",
                                  fontWeight: 600, color: "var(--ivory)" }}>
                      {monthLabel(m.month)}
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.3rem",
                                  letterSpacing: "0.4px" }}>
                      {[
                        m.check_ins      ? `${m.check_ins} check-in${m.check_ins === 1 ? "" : "s"}` : null,
                        m.sessions       ? `${m.sessions} session${m.sessions === 1 ? "" : "s"}`    : null,
                        m.benchmarks     ? `${m.benchmarks} benchmark${m.benchmarks === 1 ? "" : "s"}` : null,
                        m.nutrition_days ? `${m.nutrition_days} nutrition day${m.nutrition_days === 1 ? "" : "s"}` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>

                  {Number(m.total_volume) > 0 && (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={L.lab}>Volume</div>
                      <div style={{ ...L.num, fontSize: "1rem", color: "var(--ivory)", marginTop: "0.25rem" }}>
                        {Number(m.total_volume).toLocaleString()}
                      </div>
                    </div>
                  )}

                  <div style={{ textAlign: "right", flexShrink: 0, minWidth: "72px" }}>
                    <div style={{ ...L.num, fontSize: "1.4rem", color: readColor(r) }}>{r ?? "—"}</div>
                    {/* Text label, never colour alone. */}
                    <div style={{ ...L.lab, marginTop: "0.3rem" }}>{readLabel(r)}</div>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: "0 1.25rem 1.25rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap",
                                  paddingTop: "0.9rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      {DETAIL.map(d => (
                        <button key={d.table}
                          style={{ ...L.btnGhost,
                                   borderColor: detail?.table === d.table ? "var(--gold)" : "rgba(255,255,255,0.14)",
                                   color: detail?.table === d.table ? "var(--gold-lt)" : "var(--ivory)" }}
                          onClick={() => loadDetail(m.month, d.table, 0, false)}>
                          {d.label}
                        </button>
                      ))}
                    </div>

                    {detailBusy && !detail && (
                      <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginTop: "0.9rem" }}>Loading…</div>
                    )}

                    {detail && (
                      <div style={{ marginTop: "1rem" }}>
                        {detail.rows.length === 0 ? (
                          <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                            Nothing recorded that month.
                          </div>
                        ) : (
                          <>
                            {/* Wide tables scroll inside their own box — the page must never scroll sideways. */}
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse",
                                              fontSize: "0.74rem", minWidth: "420px" }}>
                                <thead>
                                  <tr>
                                    {(DETAIL.find(d => d.table === detail.table)?.cols || []).map(c => (
                                      <th key={c} style={{ ...L.lab, textAlign: "left", padding: "0.4rem 0.6rem 0.5rem 0",
                                                           borderBottom: "1px solid rgba(255,255,255,0.1)",
                                                           whiteSpace: "nowrap" }}>
                                        {c.replace(/_/g, " ")}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.rows.map(row => (
                                    <tr key={row.id}>
                                      {(DETAIL.find(d => d.table === detail.table)?.cols || []).map(c => (
                                        <td key={c} style={{ padding: "0.45rem 0.6rem 0.45rem 0",
                                                             borderBottom: "1px solid rgba(255,255,255,0.04)",
                                                             color: "var(--ivory2)", whiteSpace: "nowrap" }}>
                                          {row[c] === null || row[c] === undefined || row[c] === "" ? "—" : String(row[c])}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.9rem",
                                          marginTop: "0.8rem", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
                                {detail.rows.length} of {detail.total}
                              </span>
                              {detail.hasMore && (
                                <button style={L.btnGhost} disabled={detailBusy}
                                  onClick={() => loadDetail(m.month, detail.table, detail.rows.length, true)}>
                                  {detailBusy ? "Loading…" : "Load more"}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
