// src/components/JoinTeam.jsx
// Athlete-side team membership: enter a coach's join code, see current teams, leave.
import { useState, useEffect, useCallback } from "react";

export default function JoinTeam({ authUser, getFreshToken, shout, apiBase = "" }) {
  const [code, setCode]       = useState("");
  const [busy, setBusy]       = useState(false);
  const [teams, setTeams]     = useState([]);
  const [loaded, setLoaded]   = useState(false);

  const call = useCallback(async (payload) => {
    const tok = await getFreshToken();
    const res = await fetch(`${apiBase}/.netlify/functions/coach-team`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, [getFreshToken, apiBase]);

  const refresh = useCallback(async () => {
    try { const d = await call({ action: "mine" }); setTeams(d.memberships || []); }
    catch (_) { /* silent — panel just shows the join field */ }
    finally { setLoaded(true); }
  }, [call]);

  useEffect(() => { if (authUser?.id) refresh(); }, [authUser?.id]); // eslint-disable-line

  const join = async () => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) { shout("Enter your team code", "!"); return; }
    setBusy(true);
    try {
      const d = await call({ action: "join", code: c });
      shout(d.already ? `Already on ${d.team.name}` : `Joined ${d.team.name}`, "◆");
      setCode("");
      await refresh();
    } catch (e) { shout(e.message, "!"); }
    finally { setBusy(false); }
  };

  const leave = async (teamId, name) => {
    setBusy(true);
    try { await call({ action: "leave", team_id: teamId }); shout(`Left ${name}`, "◆"); await refresh(); }
    catch (e) { shout(e.message, "!"); }
    finally { setBusy(false); }
  };

  const lab = { fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
                letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)" };

  return (
    <div className="panel" style={{ marginTop: "1.1rem" }}>
      <div className="ph"><div className="pt">My <em>Team</em></div></div>
      <div className="pb">
        {loaded && teams.length > 0 && (
          <div style={{ marginBottom: "1.4rem" }}>
            {teams.map(t => (
              <div key={t.team_id} style={{ display: "flex", alignItems: "center",
                     justifyContent: "space-between", gap: "1rem", padding: "0.7rem 0",
                     borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.95rem",
                                fontWeight: 600, color: "var(--ivory)" }}>{t.name}</div>
                  {t.sport && <div style={{ ...lab, marginTop: "0.2rem" }}>{t.sport}</div>}
                </div>
                <button onClick={() => leave(t.team_id, t.name)} disabled={busy}
                  style={{ background: "none", border: "none", color: "var(--muted)",
                           fontSize: "0.65rem", letterSpacing: "1.2px", textTransform: "uppercase",
                           cursor: "pointer", textDecoration: "underline" }}>Leave</button>
              </div>
            ))}
          </div>
        )}

        <p style={{ color: "var(--muted)", fontSize: "0.78rem", lineHeight: 1.55, marginBottom: "1rem" }}>
          {teams.length > 0
            ? "Joining another team? Enter the code your coach gave you."
            : "Your coach can see your readiness and check-ins once you join. Enter the code they gave you."}
        </p>

        <label style={lab}>Team Code</label>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", marginTop: "0.4rem" }}>
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123" maxLength={10} autoCapitalize="characters" autoCorrect="off"
            onKeyDown={e => e.key === "Enter" && join()}
            style={{ flex: 1, background: "transparent", border: "none",
                     borderBottom: "1px solid rgba(255,255,255,0.1)", color: "var(--ivory)",
                     fontFamily: "'DM Sans',sans-serif", fontSize: "1.1rem", letterSpacing: "4px",
                     padding: "0.6rem 0.15rem", outline: "none" }} />
          <button onClick={join} disabled={busy}
            style={{ padding: "0.65rem 1.1rem", borderRadius: "var(--r)", border: "none",
                     background: busy ? "rgba(168,130,42,0.3)" : "linear-gradient(135deg,#BFA16A,#8B6520)",
                     color: "#0D0D0D", cursor: busy ? "not-allowed" : "pointer",
                     fontFamily: "'DM Sans',sans-serif", fontSize: "0.7rem", fontWeight: 700,
                     letterSpacing: "1.5px", textTransform: "uppercase" }}>
            {busy ? "…" : "Join"}
          </button>
        </div>
      </div>
    </div>
  );
}
