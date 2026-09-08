// src/components/ShareManager.jsx
// The athlete's control panel for recruiting shares: issue a link to a named
// coach, see whether it has been opened, revoke it.
//
// WHY THIS SITS BESIDE THE PDF AND THE EMAIL BUTTON
//   Those push a snapshot out and it is gone: no expiry, no revocation, no
//   update when the athlete improves, and no idea whether anyone opened it.
//   A share is the same information as a link the athlete still controls, and
//   it carries the training record the PDF cannot prove.
//
// THE LINK IS SHOWN ONCE
//   share-manage `list` deliberately does not return the token, so this panel
//   can display a URL only immediately after creating it. That is why the new
//   link gets its own persistent block with a copy button rather than a toast
//   that can be missed. Lost link = revoke and re-issue.
import { useState, useEffect, useCallback, useRef } from "react";

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

const STATUS_COLOR = { active: "#4BAE71", expired: "var(--muted)", revoked: "#C0695E" };

// QR is BUNDLED, not fetched from a CDN.
//
// It used to be a script tag pointing at cdn.jsdelivr.net, justified by "the
// CSP in netlify.toml allows script-src from cdn.jsdelivr.net". That reasoning
// only ever covered the WEBSITE. This screen also ships inside the iOS and
// Android apps, where netlify.toml governs nothing, and two things follow:
//
//   APP REVIEW - Apple guideline 2.5.2 requires an app to be self-contained
//     and not download or execute code at runtime. Pulling a JS library from a
//     CDN on demand is exactly that pattern, and it is a rejection risk on a
//     submission that has to land.
//
//   OFFLINE - an athlete at a camp with no signal opened Recruiting and got no
//     QR code and no explanation. "The link still works" is no comfort when the
//     coach is standing in front of them waiting to scan.
//
// The original objection to an npm dependency was that every build machine
// then has to run npm install, and a missing module is a hard build failure.
// That is true, and it is the better failure: it stops the build on a laptop
// instead of failing silently in front of a recruiter.
import QRCode from "qrcode";

export default function ShareManager({ getFreshToken, shout, nativeShare, apiBase = "" }) {
  const [shares, setShares]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail]     = useState("");
  const [label, setLabel]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [fresh, setFresh]     = useState(null);   // the one link we can still show
  const [qrFailed, setQrFailed] = useState(false);
  const qrRef = useRef(null);

  const call = useCallback(async (body) => {
    const tok = await getFreshToken();
    const res = await fetch(`${apiBase}/.netlify/functions/share-manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    return d;
  }, [getFreshToken, apiBase]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setShares((await call({ action: "list" })).shares || []); }
    catch (e) { shout?.(e.message, "!"); }
    finally { setLoading(false); }
  }, [call, shout]);

  useEffect(() => { load(); }, [load]);

  // Draw the QR for the freshly-created link. A coach standing in front of the
  // athlete at a camp scans it; nobody reads a 43-character token aloud.
  useEffect(() => {
    if (!fresh?.url) return;
    let dead = false;
    setQrFailed(false);
    if (!qrRef.current) return;                 // canvas not mounted yet
    QRCode.toCanvas(qrRef.current, fresh.url, {
      width: 148, margin: 1,
      color: { dark: "#0D0D0D", light: "#F2EFE7" },
    }).catch(() => { if (!dead) setQrFailed(true); });
    return () => { dead = true; };
  }, [fresh?.url]);

  const create = async () => {
    if (!email.trim()) { shout?.("Enter a coach or scout email", "!"); return; }
    setBusy(true);
    try {
      const d = await call({
        action: "create",
        recipient_email: email.trim(),
        recipient_label: label.trim() || null,
      });
      setFresh({ url: `${window.location.origin}/s/${d.token}`, email: d.recipient_email });
      setEmail(""); setLabel("");
      await load();
    } catch (e) { shout?.(e.message, "!"); }
    finally { setBusy(false); }
  };

  const revoke = async (s) => {
    if (!window.confirm(`Revoke access for ${s.recipient_label || s.recipient_email}? Their link stops working immediately.`)) return;
    try {
      await call({ action: "revoke", id: s.id });
      shout?.("Access revoked", "◆");
      await load();
    } catch (e) { shout?.(e.message, "!"); }
  };

  const shareLink = async (url) => {
    const r = await nativeShare?.({ title: "My Elite Athlete profile", text: url, url });
    if (r === "copied") shout?.("Link copied", "◆");
    else if (!r || r === "failed") {
      try { await navigator.clipboard.writeText(url); shout?.("Link copied", "◆"); }
      catch { shout?.("Copy the link above", "!"); }
    }
  };

  return (
    <div className="panel">
      <div className="ph"><div className="pt">Share with a <em>Coach</em></div></div>
      <div className="pb">
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: "1.2rem" }}>
          Sends a private link to one coach. They enter this email to open it, so forwarding it
          does nothing. Unlike the PDF, it stays current as you train — and includes your training
          record, not just your numbers. Expires in 90 days, or revoke it any time.
        </div>

        <div className="f">
          <label className="fl">Coach or Scout Email</label>
          <input type="email" className="fi" autoComplete="email" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} inputMode="email"
            placeholder="coach@university.edu" value={email}
            onChange={e => setEmail(e.target.value)} style={{ fontSize: "0.82rem" }}/>
        </div>
        <div className="f">
          <label className="fl">Label (optional — just for you)</label>
          <input type="text" className="fi" placeholder="Coach Smith, State U"
            value={label} onChange={e => setLabel(e.target.value)} style={{ fontSize: "0.82rem" }}/>
        </div>
        <button className="bg" style={{ width: "100%", padding: "0.75rem", opacity: busy ? 0.6 : 1 }}
          disabled={busy} onClick={create}>
          {busy ? "Creating…" : "Create Share Link ◆"}
        </button>

        {/* Shown once. `list` never returns the token again. */}
        {fresh && (
          <div style={{ marginTop: "1.25rem", padding: "1rem", borderRadius: "var(--r)",
                        border: "1px solid rgba(191,161,106,0.35)", background: "rgba(191,161,106,0.06)" }}>
            <div style={lab}>Send this to {fresh.email}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--gold-lt)", wordBreak: "break-all",
                          margin: "0.5rem 0 0.8rem", fontFamily: "monospace" }}>
              {fresh.url}
            </div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", flex: "1 1 160px" }}>
                <button style={btnGhost} onClick={() => shareLink(fresh.url)}>Copy / Share</button>
                <button style={btnGhost} onClick={() => setFresh(null)}>Done</button>
              </div>
              {!qrFailed && (
                <div style={{ textAlign: "center" }}>
                  <canvas ref={qrRef} style={{ borderRadius: "8px", display: "block" }}/>
                  <div style={{ ...lab, marginTop: "0.4rem" }}>Scan to open</div>
                </div>
              )}
            </div>
            <div style={{ fontSize: "0.66rem", color: "var(--muted)", marginTop: "0.8rem", lineHeight: 1.5 }}>
              This link is only shown now. If you lose it, revoke this share and create a new one.
            </div>
          </div>
        )}

        {shares.length > 0 && (
          <div style={{ marginTop: "1.5rem", paddingTop: "1.1rem",
                        borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={lab}>Your Shares ({shares.length})</div>
            {shares.map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem",
                    flexWrap: "wrap", padding: "0.7rem 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                  <div style={{ fontSize: "0.82rem", color: "var(--ivory)" }}>
                    {s.recipient_label || s.recipient_email}
                  </div>
                  <div style={{ fontSize: "0.64rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                    {s.recipient_label ? `${s.recipient_email} · ` : ""}
                    {s.view_count > 0
                      ? `Opened ${s.view_count}× · last ${new Date(s.last_viewed_at).toLocaleDateString()}`
                      : "Not opened yet"}
                  </div>
                </div>
                <span style={{ ...lab, color: STATUS_COLOR[s.status] || "var(--muted)" }}>
                  {s.status}
                </span>
                {s.status === "active" && (
                  <button style={btnGhost} onClick={() => revoke(s)}>Revoke</button>
                )}
              </div>
            ))}
          </div>
        )}

        {loading && shares.length === 0 && (
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "1rem" }}>Loading…</div>
        )}
      </div>
    </div>
  );
}
