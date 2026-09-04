// src/components/TeamPrograms.jsx
// Programs a coach builds and pushes to the team.
//
// A team-wide assignment fans out to one row per athlete server-side, so
// per-athlete start dates and status can diverge later without duplicating the
// program. Assignment targets are always resolved from the coach's OWN roster
// in coach-program.js — a coach can never assign to someone else's athlete.
import { useState, useEffect, useCallback } from "react";

const L = {
  lab: { fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
         letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)" },
  btn: { padding: "0.7rem 1.1rem", borderRadius: "var(--r)", border: "none",
         background: "linear-gradient(135deg,#BFA16A,#8B6520)", color: "#0D0D0D",
         cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: "0.72rem",
         fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" },
  btnGhost: { padding: "0.55rem 0.9rem", borderRadius: "var(--r)",
         border: "1px solid rgba(255,255,255,0.14)", background: "transparent",
         color: "var(--ivory)", cursor: "pointer", fontFamily: "'Inter',sans-serif",
         fontSize: "0.65rem", letterSpacing: "1.2px", textTransform: "uppercase" },
  input: { width: "100%", background: "transparent", border: "none",
         borderBottom: "1px solid rgba(255,255,255,0.1)", color: "var(--ivory)",
         fontFamily: "'Inter',sans-serif", fontSize: "0.9rem", padding: "0.7rem 0.15rem",
         outline: "none" },
  select: { width: "100%", background: "var(--smoke)", border: "1px solid rgba(255,255,255,0.1)",
         color: "var(--ivory)", fontFamily: "'Inter',sans-serif", fontSize: "0.85rem",
         padding: "0.6rem", borderRadius: "var(--r)", outline: "none" },
};

const WK_TYPES  = ["", "strength", "power", "speed", "conditioning", "hypertrophy", "recovery"];
const WK_FOCUS  = ["", "upper", "lower", "full body", "posterior chain", "core", "position-specific"];

export default function TeamPrograms({ teamId, teamName, getFreshToken, shout, apiBase = "" }) {
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [programs, setPrograms] = useState([]);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [assignees, setAssignees] = useState({});
  const [busy, setBusy]         = useState(false);

  const [form, setForm] = useState({ name: "", sport: "", wk_type: "", wk_focus: "", weeks: 4 });

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
      const d = await call("coach-program", { method: "POST", body: JSON.stringify({ action: "list" }) });
      setPrograms(d.programs || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [call]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  const create = async () => {
    if (!form.name.trim()) { shout("Program name required", "!"); return; }
    setCreating(true);
    try {
      await call("coach-program", {
        method: "POST",
        body: JSON.stringify({ action: "create", ...form, name: form.name.trim(), team_id: teamId }),
      });
      setForm({ name: "", sport: "", wk_type: "", wk_focus: "", weeks: 4 });
      setShowNew(false);
      shout("Program created", "◆");
      await load();
    } catch (e) { shout(e.message, "!"); }
    finally { setCreating(false); }
  };

  const assignAll = async (p) => {
    setBusy(true);
    try {
      const d = await call("coach-program", {
        method: "POST",
        body: JSON.stringify({ action: "assign", id: p.id, team_id: teamId }),
      });
      shout(`Assigned to ${d.assigned} athlete${d.assigned === 1 ? "" : "s"}`, "◆");
      await load();
      if (expanded === p.id) await loadAssignees(p.id);
    } catch (e) { shout(e.message, "!"); }
    finally { setBusy(false); }
  };

  const loadAssignees = async (id) => {
    try {
      const d = await call("coach-program", { method: "POST", body: JSON.stringify({ action: "assignees", id }) });
      setAssignees(prev => ({ ...prev, [id]: d.assignees || [] }));
    } catch (e) { shout(e.message, "!"); }
  };

  const unassign = async (programId, athleteId) => {
    setBusy(true);
    try {
      await call("coach-program", {
        method: "POST",
        body: JSON.stringify({ action: "unassign", id: programId, athlete_ids: [athleteId] }),
      });
      await loadAssignees(programId);
      await load();
    } catch (e) { shout(e.message, "!"); }
    finally { setBusy(false); }
  };

  const archive = async (p) => {
    setBusy(true);
    try {
      await call("coach-program", { method: "POST", body: JSON.stringify({ action: "archive", id: p.id }) });
      shout(`"${p.name}" archived`, "◆");
      await load();
    } catch (e) { shout(e.message, "!"); }
    finally { setBusy(false); }
  };

  const toggle = async (p) => {
    if (expanded === p.id) { setExpanded(null); return; }
    setExpanded(p.id);
    if (!assignees[p.id]) await loadAssignees(p.id);
  };

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="ph">
          <div className="pt">Team <em>Programs</em></div>
          <button style={L.btnGhost} onClick={() => setShowNew(s => !s)}>
            {showNew ? "Cancel" : "+ New"}
          </button>
        </div>
        <div className="pb">
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.6 }}>
            Build a block, then push it to {teamName || "the team"}. Athletes see assigned
            programs in their own app.
          </p>

          {showNew && (
            <div style={{ marginTop: "1.4rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <label style={L.lab}>Program name</label>
                <input style={L.input} value={form.name} maxLength={120}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Fall Camp — Block A" />
              </div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div style={{ flex: "1 1 150px" }}>
                  <label style={L.lab}>Type</label>
                  <select style={{ ...L.select, marginTop: "0.4rem" }} value={form.wk_type}
                          onChange={e => setForm(f => ({ ...f, wk_type: e.target.value }))}>
                    {WK_TYPES.map(t => <option key={t} value={t}>{t || "Select type"}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 1 150px" }}>
                  <label style={L.lab}>Focus</label>
                  <select style={{ ...L.select, marginTop: "0.4rem" }} value={form.wk_focus}
                          onChange={e => setForm(f => ({ ...f, wk_focus: e.target.value }))}>
                    {WK_FOCUS.map(t => <option key={t} value={t}>{t || "Select focus"}</option>)}
                  </select>
                </div>
                <div style={{ flex: "0 1 110px" }}>
                  <label style={L.lab}>Weeks</label>
                  <input type="number" min="1" max="52" style={L.input} value={form.weeks}
                    onChange={e => setForm(f => ({ ...f, weeks: parseInt(e.target.value, 10) || 1 }))} />
                </div>
              </div>
              <button style={{ ...L.btn, opacity: creating ? 0.5 : 1 }} disabled={creating} onClick={create}>
                {creating ? "Creating…" : "Create Program ◆"}
              </button>
            </div>
          )}
        </div>
      </div>

      {err && (
        <div className="panel" style={{ marginBottom: "1.1rem" }}>
          <div className="pb" style={{ color: "#C0695E", fontSize: "0.8rem" }}>{err}</div>
        </div>
      )}

      {loading && programs.length === 0 && (
        <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          Loading programs…</div></div>
      )}

      {!loading && programs.length === 0 && (
        <div className="panel"><div className="pb" style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.6 }}>
          No programs yet. Create one and assign it to the whole team in two taps.</div></div>
      )}

      {programs.map(p => (
        <div key={p.id} className="panel" style={{ marginBottom: "0.6rem",
             opacity: p.active ? 1 : 0.5 }}>
          <div onClick={() => toggle(p)}
               style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center",
                        justifyContent: "space-between", gap: "1rem", cursor: "pointer", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 200px" }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.95rem",
                            fontWeight: 600, color: "var(--ivory)" }}>
                {p.name}{!p.active && " · archived"}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                {[p.wk_type, p.wk_focus, `${p.weeks} week${p.weeks === 1 ? "" : "s"}`]
                  .filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.3rem",
                            fontWeight: 700, color: "var(--gold-lt)" }}>{p.assigned_count ?? 0}</div>
              <div style={L.lab}>Assigned</div>
            </div>
          </div>

          {expanded === p.id && (
            <div style={{ padding: "0 1.25rem 1.25rem", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "1rem 0" }}>
                {p.active && (
                  <button style={L.btnGhost} disabled={busy} onClick={(e) => { e.stopPropagation(); assignAll(p); }}>
                    Assign to whole team
                  </button>
                )}
                <button style={L.btnGhost} disabled={busy} onClick={(e) => { e.stopPropagation(); archive(p); }}>
                  {p.active ? "Archive" : "Archived"}
                </button>
              </div>

              <div style={L.lab}>Assigned athletes</div>
              {(assignees[p.id] || []).length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "0.5rem" }}>
                  Nobody assigned yet.
                </div>
              ) : (
                <div style={{ marginTop: "0.5rem" }}>
                  {(assignees[p.id] || []).map(a => (
                    <div key={a.athlete_id} style={{ display: "flex", justifyContent: "space-between",
                           alignItems: "center", gap: "1rem", padding: "0.5rem 0",
                           borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <div>
                        <div style={{ fontSize: "0.85rem", color: "var(--ivory)" }}>{a.name}</div>
                        <div style={{ ...L.lab, marginTop: "0.15rem" }}>
                          {a.position || "—"} · starts {a.starts_on}
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); unassign(p.id, a.athlete_id); }}
                        disabled={busy}
                        style={{ background: "none", border: "none", color: "var(--muted)",
                                 fontSize: "0.6rem", letterSpacing: "1px", textTransform: "uppercase",
                                 cursor: "pointer", textDecoration: "underline" }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
