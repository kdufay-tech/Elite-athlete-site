// src/components/CoachAthleteHistory.jsx
// An athlete's longer record, as their CURRENT coach is allowed to see it.
//
// THE RULE (set 2026-09-08, enforced server-side in coach-history.js and
// structurally inside coach_athlete_history())
//   within tenure   -> full detail: monthly counts, and raw rows on request
//   before tenure   -> monthly summary ONLY: readiness and training volume.
//                      No counts, no raw rows. The server returns nulls; this
//                      component does not have the data to leak even if it
//                      wanted to.
//   after departure -> nothing. The endpoint 403s on a non-active membership.
//
// The case that matters is a transfer. A new coach should see enough to know
// what they inherited, and no more than that. Showing the pre-tenure months
// as present-but-limited is deliberate: hiding them entirely would make an
// athlete's history look like it started the day they joined, which is its own
// kind of lie.
//
// SCALE: one row per month from a SQL rollup, raw rows only on demand in pages
// of 50 with an exact server-side count. Nothing here loads a table.
import { useState, useEffect, useCallback } from "react";
import { readColor, readLabel, monthReadiness } from "./ReadinessChart";

const PAGE = 50;

// Performance data only. Mirrors the TABLES whitelist in coach-history.js -
// journal_entries and progress_notes are deliberately absent there, so they can
// never be requested from here.
const DETAIL = [
  { table: "check_ins",      label: "Check-ins",  cols: ["date", "recovery", "energy", "sleep", "soreness", "mood"] },
  { table: "workout_logs",   label: "Sessions",   cols: ["date", "exercise", "load", "sets", "rpe", "total_vol"] },
  { table: "benchmarks",     label: "Benchmarks", cols: ["date", "test", "value", "unit"] },
  { table: "weight_logs",    label: "Weight",     cols: ["date", "weight", "body_fat"] },
  { table: "nutrition_logs", label: "Nutrition",  cols: ["date", "calories", "protein", "carbs", "fat"] },
];

const lab = {
  fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
  letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)",
};
const btnGhost = {
  padding: "0.45rem 0.85rem", borderRadius: "var(--r)",
  border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
  color: "var(--ivory)", cursor: "pointer", fontFamily: "'Inter',sans-serif",
  fontSize: "0.62rem", letterSpacing: "1.2px", textTransform: "uppercase",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// 'YYYY-MM-DD' parsed by new Date() is treated as UTC and slides a month west
// of Greenwich, so split it by hand.
const monthLabel = (m) => {
  const [y, mo] = String(m).split("-");
  return `${MONTHS[Number(mo) - 1]} ${y}`;
};

export default function CoachAthleteHistory({ athlete, getFreshToken, shout, apiBase = "" }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [months, setMonths]   = useState([]);
  const [since, setSince]     = useState(null);
  const [open, setOpen]       = useState(null);
  const [detail, setDetail]   = useState(null);
  const [busy, setBusy]       = useState(false);

  const call = useCallback(async (body) => {
    const tok = await getFreshToken();
    const res = await fetch(`${apiBase}/.netlify/functions/coach-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ athlete_id: athlete.athlete_id, ...body }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    return d;
  }, [getFreshToken, apiBase, athlete.athlete_id]);

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true); setErr("");
      try {
        const d = await call({ action: "summary" });
        if (dead) return;
        setMonths(d.active || []);
        setSince(d.since || null);
      } catch (e) { if (!dead) setErr(e.message); }
      finally { if (!dead) setLoading(false); }
    })();
    return () => { dead = true; };
  }, [call]);

  const loadDetail = async (month, table, offset = 0, append = false) => {
    setBusy(true);
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
    finally { setBusy(false); }
  };

  if (loading) {
    return <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
      Loading record…</div></div>;
  }
  if (err) {
    return <div className="panel"><div className="pb" style={{ color: "#C0695E", fontSize: "0.82rem" }}>{err}</div></div>;
  }

  const sinceLabel = since
    ? new Date(since).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : null;

  return (
    <div className="panel" style={{ marginBottom: "1.1rem" }}>
      <div className="ph">
        <div className="pt">Longer <em>Record</em></div>
        {sinceLabel && <span style={lab}>On your roster since {sinceLabel}</span>}
      </div>
      <div className="pb">
        {months.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
            Nothing logged yet.
          </div>
        ) : (
          <>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", lineHeight: 1.55, marginBottom: "1rem" }}>
              Months before {sinceLabel || "they joined"} show readiness and training volume only —
              the detail from another program is theirs, not yours.
            </div>

            {months.map(m => {
              const r = monthReadiness(m, athlete.sport);
              const isOpen = open === m.month;
              const pre = !m.within_tenure;
              return (
                <div key={m.month}
                     style={{ borderBottom: "1px solid rgba(255,255,255,0.05)",
                              opacity: pre ? 0.72 : 1 }}>
                  <div
                    onClick={() => {
                      if (pre) return;               // nothing to open - server sends no rows
                      setOpen(isOpen ? null : m.month); setDetail(null);
                    }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                             gap: "1rem", flexWrap: "wrap", padding: "0.8rem 0",
                             cursor: pre ? "default" : "pointer" }}>
                    <div style={{ minWidth: 0, flex: "1 1 150px" }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.9rem",
                                    fontWeight: 600, color: "var(--ivory)" }}>
                        {monthLabel(m.month)}
                        {pre && (
                          <span style={{ ...lab, marginLeft: "0.6rem", color: "var(--muted)" }}>
                            before your program
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                        {pre
                          ? "Summary only"
                          : [
                              m.check_ins  ? `${m.check_ins} check-in${m.check_ins === 1 ? "" : "s"}` : null,
                              m.sessions   ? `${m.sessions} session${m.sessions === 1 ? "" : "s"}`    : null,
                              m.benchmarks ? `${m.benchmarks} benchmark${m.benchmarks === 1 ? "" : "s"}` : null,
                            ].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>

                    {Number(m.total_volume) > 0 && (
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={lab}>Volume</div>
                        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.95rem",
                                      fontWeight: 700, color: "var(--ivory)", marginTop: "0.2rem" }}>
                          {Number(m.total_volume).toLocaleString()}
                        </div>
                      </div>
                    )}

                    <div style={{ textAlign: "right", flexShrink: 0, minWidth: "68px" }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.25rem",
                                    fontWeight: 700, color: readColor(r), lineHeight: 1 }}>
                        {r ?? "—"}
                      </div>
                      {/* Text label, never colour alone. */}
                      <div style={{ ...lab, marginTop: "0.25rem" }}>{readLabel(r)}</div>
                    </div>
                  </div>

                  {isOpen && !pre && (
                    <div style={{ paddingBottom: "1rem" }}>
                      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                        {DETAIL.map(d => (
                          <button key={d.table}
                            style={{ ...btnGhost,
                                     borderColor: detail?.table === d.table ? "var(--gold)" : "rgba(255,255,255,0.14)",
                                     color: detail?.table === d.table ? "var(--gold-lt)" : "var(--ivory)" }}
                            onClick={() => loadDetail(m.month, d.table, 0, false)}>
                            {d.label}
                          </button>
                        ))}
                      </div>

                      {busy && !detail && (
                        <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: "0.8rem" }}>Loading…</div>
                      )}

                      {detail && (detail.rows.length === 0 ? (
                        <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginTop: "0.8rem" }}>
                          Nothing recorded that month.
                        </div>
                      ) : (
                        <div style={{ marginTop: "0.9rem" }}>
                          {/* Wide tables scroll in their own box; the page never scrolls sideways. */}
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse",
                                            fontSize: "0.72rem", minWidth: "420px" }}>
                              <thead>
                                <tr>
                                  {(DETAIL.find(d => d.table === detail.table)?.cols || []).map(c => (
                                    <th key={c} style={{ ...lab, textAlign: "left", whiteSpace: "nowrap",
                                                         padding: "0.35rem 0.6rem 0.45rem 0",
                                                         borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                                      {c.replace(/_/g, " ")}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {detail.rows.map(row => (
                                  <tr key={row.id}>
                                    {(DETAIL.find(d => d.table === detail.table)?.cols || []).map(c => (
                                      <td key={c} style={{ padding: "0.4rem 0.6rem 0.4rem 0", whiteSpace: "nowrap",
                                                           borderBottom: "1px solid rgba(255,255,255,0.04)",
                                                           color: "var(--ivory2)" }}>
                                        {row[c] === null || row[c] === undefined || row[c] === "" ? "—" : String(row[c])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem",
                                        marginTop: "0.7rem", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "0.64rem", color: "var(--muted)" }}>
                              {detail.rows.length} of {detail.total}
                            </span>
                            {detail.hasMore && (
                              <button style={btnGhost} disabled={busy}
                                onClick={() => loadDetail(m.month, detail.table, detail.rows.length, true)}>
                                {busy ? "Loading…" : "Load more"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
