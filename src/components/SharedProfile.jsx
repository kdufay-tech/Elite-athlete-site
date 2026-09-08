// src/components/SharedProfile.jsx
// The PUBLIC recruiter view of an athlete's shared profile. Rendered at
// /s/<token> before any auth gate - a college coach has no Elite Athlete
// account and will not create one to look at a single athlete.
//
// THREE STEPS
//   email -> the coach enters the address the athlete sent it to; a 6-digit
//            code is mailed there. A forwarded link alone is worthless.
//   code  -> exchanged for a 24-hour viewer session.
//   view  -> the recruiting card plus the monthly record.
//
// The session is kept in sessionStorage keyed by token, so a refresh inside
// the 24 hours does not force the coach to re-verify. sessionStorage rather
// than localStorage on purpose: closing the browser should end it, and a
// shared or library machine should not retain access to someone's athlete.
//
// STYLING IS SELF-CONTAINED. This page renders outside the app's normal
// chrome for someone who has never seen the product, so it does not depend on
// the App CSS block being present.
import { useState, useEffect, useCallback } from "react";
import { readColor, readLabel, monthReadiness } from "./ReadinessChart";

const GOLD = "#BFA16A";
const GOLD_LT = "#D4AF37";
const INK = "#0a0908";

const S = {
  page:  { background: INK, minHeight: "100dvh", padding: "2rem 1rem",
           fontFamily: "'Inter',system-ui,sans-serif", color: "#EDE8DF" },
  shell: { maxWidth: "760px", margin: "0 auto" },
  brand: { fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: "0.72rem",
           letterSpacing: "6px", fontWeight: 700, color: GOLD, textAlign: "center",
           textTransform: "uppercase", marginBottom: "2rem" },
  card:  { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
           borderRadius: "14px", padding: "1.5rem", marginBottom: "1rem" },
  lab:   { fontSize: "0.55rem", fontWeight: 700, letterSpacing: "2.5px",
           textTransform: "uppercase", color: "rgba(237,232,223,0.55)" },
  h1:    { fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: "1.6rem",
           fontWeight: 700, margin: "0 0 0.35rem", color: "#fff" },
  input: { width: "100%", background: "transparent", border: "none",
           borderBottom: "1px solid rgba(255,255,255,0.18)", color: "#EDE8DF",
           fontSize: "1rem", padding: "0.75rem 0.15rem", outline: "none",
           fontFamily: "inherit" },
  btn:   { width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none",
           background: `linear-gradient(135deg,${GOLD},#8B6520)`, color: "#0D0D0D",
           fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: "0.74rem",
           fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase",
           cursor: "pointer", marginTop: "1.25rem" },
  muted: { color: "rgba(237,232,223,0.55)", fontSize: "0.8rem", lineHeight: 1.6 },
  num:   { fontFamily: "'DM Sans',system-ui,sans-serif", fontWeight: 700, lineHeight: 1 },
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthLabel = (m) => {
  const [y, mo] = String(m).split("-");
  return `${MONTHS[Number(mo) - 1]} ${y}`;
};

const inches = (h) => {
  const n = Number(h);
  if (!n) return null;
  return n > 12 ? `${Math.floor(n / 12)}'${Math.round(n % 12)}"` : `${n}"`;
};

export default function SharedProfile({ token }) {
  const [step, setStep]   = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState("");
  const [data, setData]   = useState(null);

  const key = `ea_share_${token}`;

  const call = useCallback(async (body) => {
    const res = await fetch(`/.netlify/functions/share-view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...body }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Something went wrong");
    return d;
  }, [token]);

  const loadView = useCallback(async (session) => {
    try {
      const d = await call({ action: "view", session });
      setData(d); setStep("view");
    } catch {
      // Session dead or revoked - drop it and start over rather than
      // leaving the coach staring at a broken page.
      try { sessionStorage.removeItem(key); } catch { /* private mode */ }
      setStep("email");
      setMsg("That session expired. Enter your email to get a new code.");
    }
  }, [call, key]);

  // Resume an existing session on refresh.
  useEffect(() => {
    let s = null;
    try { s = sessionStorage.getItem(key); } catch { /* private mode */ }
    if (s) { setBusy(true); loadView(s).finally(() => setBusy(false)); }
  }, [key, loadView]);

  const requestCode = async () => {
    if (!email.trim()) { setMsg("Enter the email this was sent to"); return; }
    setBusy(true); setMsg("");
    try {
      await call({ action: "request_code", email: email.trim() });
      setStep("code");
      // Deliberately the same message whether or not the address matched -
      // the endpoint does not reveal it, and neither does this screen.
      setMsg("If that address has access, a 6-digit code is on its way. It expires in 10 minutes.");
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code.trim())) { setMsg("Enter the 6-digit code"); return; }
    setBusy(true); setMsg("");
    try {
      const d = await call({ action: "verify_code", code: code.trim() });
      try { sessionStorage.setItem(key, d.session); } catch { /* private mode */ }
      await loadView(d.session);
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  // ── GATE ───────────────────────────────────────────────────
  if (step !== "view") {
    return (
      <div style={S.page}>
        <div style={{ ...S.shell, maxWidth: "420px", paddingTop: "6vh" }}>
          <div style={S.brand}>Elite Athlete</div>
          <div style={S.card}>
            <h1 style={{ ...S.h1, fontSize: "1.15rem" }}>
              {step === "email" ? "Athlete profile shared with you" : "Enter your code"}
            </h1>
            <p style={{ ...S.muted, margin: "0 0 1.25rem" }}>
              {step === "email"
                ? "This profile was shared with a specific email address. Enter it and we'll send a one-time code."
                : "Check your inbox. The code expires in 10 minutes."}
            </p>

            {step === "email" ? (
              <input style={S.input} type="email" inputMode="email" autoComplete="email"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder="coach@university.edu"
                value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && requestCode()} />
            ) : (
              <input style={{ ...S.input, letterSpacing: "10px", fontSize: "1.4rem", textAlign: "center" }}
                inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                placeholder="000000"
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={e => e.key === "Enter" && verify()} />
            )}

            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy}
              onClick={step === "email" ? requestCode : verify}>
              {busy ? "Working…" : step === "email" ? "Send me a code" : "View profile"}
            </button>

            {msg && <p style={{ ...S.muted, marginTop: "1rem", fontSize: "0.75rem" }}>{msg}</p>}

            {step === "code" && (
              <button
                style={{ background: "none", border: "none", color: GOLD, cursor: "pointer",
                         fontSize: "0.7rem", marginTop: "0.9rem", padding: 0, fontFamily: "inherit" }}
                onClick={() => { setStep("email"); setCode(""); setMsg(""); }}>
                Use a different email
              </button>
            )}
          </div>
          <p style={{ ...S.muted, textAlign: "center", fontSize: "0.68rem" }}>
            Shared by the athlete. They can revoke access at any time.
          </p>
        </div>
      </div>
    );
  }

  // ── PROFILE ────────────────────────────────────────────────
  const a = data.athlete || {};
  const facts = [
    ["Sport", [a.sport, a.position].filter(Boolean).join(" · ") || null],
    ["Height", inches(a.height)],
    ["Weight", a.weight ? `${a.weight} lbs` : null],
    ["Age", a.age || null],
    ["GPA", a.gpa ? `${a.gpa}${a.gpa_scale ? ` / ${a.gpa_scale}` : ""}` : null],
    ["Class of", a.graduation_year || null],
    ["School", a.high_school || null],
  ].filter(([, v]) => v);

  // Best value per test, most recent first.
  const bestByTest = {};
  for (const b of (data.benchmarks || [])) {
    if (!bestByTest[b.test]) bestByTest[b.test] = b;
  }
  const bests = Object.values(bestByTest).slice(0, 12);

  return (
    <div style={S.page}>
      <div style={S.shell}>
        <div style={S.brand}>Elite Athlete</div>

        <div style={S.card}>
          <div style={S.lab}>Recruiting Profile</div>
          <h1 style={S.h1}>{a.name}</h1>
          <div style={{ ...S.muted, fontSize: "0.85rem" }}>
            {[a.position, a.sport].filter(Boolean).join(" · ")}
          </div>

          {facts.length > 0 && (
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
              {facts.map(([k, v]) => (
                <div key={k}>
                  <div style={S.lab}>{k}</div>
                  <div style={{ ...S.num, fontSize: "1.05rem", color: "#fff", marginTop: "0.2rem" }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {a.film && (
            <div style={{ marginTop: "1.5rem" }}>
              <div style={S.lab}>Film</div>
              {/* rel=noopener because this URL is athlete-supplied. */}
              <a href={/^https?:\/\//i.test(a.film) ? a.film : `https://${a.film}`}
                 target="_blank" rel="noopener noreferrer nofollow"
                 style={{ color: GOLD_LT, fontSize: "0.85rem", wordBreak: "break-all" }}>
                {a.film}
              </a>
            </div>
          )}
        </div>

        {bests.length > 0 && (
          <div style={S.card}>
            <div style={S.lab}>Performance Tests</div>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
              {bests.map(b => (
                <div key={b.test} style={{ minWidth: "96px" }}>
                  <div style={S.lab}>{b.test}</div>
                  <div style={{ ...S.num, fontSize: "1.2rem", color: "#fff", marginTop: "0.2rem" }}>
                    {b.value}<span style={{ fontSize: "0.7rem", color: "rgba(237,232,223,0.55)" }}> {b.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The point of the whole feature: development a coach can verify,
            rather than self-reported numbers. */}
        {(data.months || []).length > 0 && (
          <div style={S.card}>
            <div style={S.lab}>Training Record</div>
            <p style={{ ...S.muted, fontSize: "0.72rem", margin: "0.5rem 0 1.1rem" }}>
              Month by month, from the athlete's own logged training. Readiness combines recovery,
              sleep, energy, mood and soreness.
            </p>
            {data.months.map(m => {
              const r = monthReadiness(m, a.sport);
              return (
                <div key={m.month}
                     style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: "1rem", flexWrap: "wrap", padding: "0.7rem 0",
                              borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ minWidth: 0, flex: "1 1 130px" }}>
                    <div style={{ fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: "0.9rem",
                                  fontWeight: 600, color: "#fff" }}>{monthLabel(m.month)}</div>
                    <div style={{ fontSize: "0.64rem", color: "rgba(237,232,223,0.5)", marginTop: "0.22rem" }}>
                      {[
                        m.sessions   ? `${m.sessions} session${m.sessions === 1 ? "" : "s"}` : null,
                        m.check_ins  ? `${m.check_ins} check-in${m.check_ins === 1 ? "" : "s"}` : null,
                        m.benchmarks ? `${m.benchmarks} test${m.benchmarks === 1 ? "" : "s"}` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  {Number(m.total_volume) > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div style={S.lab}>Volume</div>
                      <div style={{ ...S.num, fontSize: "0.95rem", color: "#fff", marginTop: "0.2rem" }}>
                        {Number(m.total_volume).toLocaleString()}
                      </div>
                    </div>
                  )}
                  <div style={{ textAlign: "right", minWidth: "64px" }}>
                    <div style={{ ...S.num, fontSize: "1.2rem", color: readColor(r) }}>{r ?? "—"}</div>
                    {/* Text label, never colour alone. */}
                    <div style={{ ...S.lab, marginTop: "0.22rem" }}>{readLabel(r)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ ...S.muted, textAlign: "center", fontSize: "0.66rem", marginTop: "1.5rem" }}>
          Shared with {data.shared_with} · access ends {new Date(data.expires_at).toLocaleDateString()}
          <br/>The athlete can revoke this at any time.
        </p>
      </div>
    </div>
  );
}
