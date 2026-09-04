// src/components/ReadinessChart.jsx
// Readiness visualisation primitives: Sparkline and ReadinessLineChart.
//
// DESIGN NOTES (these are deliberate, not stylistic preference)
//
// 1. Readiness is NEVER encoded by colour alone. Validating the app's palette
//    against the dark chart surface: ready #4BAE71 vs at-risk #C0695E is ΔE 5.2
//    under deuteranopia — below the 6.0 floor. ~8% of men have red-green CVD and
//    this audience is mostly male athletes and coaches. So the line is brand gold,
//    the NUMBER is always shown, and status rides on text. Colour reinforces; it
//    never carries meaning by itself.
// 2. Readiness and compliance are two scales, so they are two stacked charts
//    sharing an x-axis — never a dual-axis plot, which invents a correlation.
// 3. Status bands are low-opacity background zones. Position does the work.
// 4. Two series (athlete + team) get a legend AND direct labels.
// 5. Hand-rolled SVG: no chart library, so nothing is added to the bundle.
import { useState, useRef } from "react";

const GOLD   = "#C19830";
const REF    = "#6B655C";   // recessive grey for the team reference
const INK    = "var(--ivory)";
const MUTED  = "var(--muted)";
const GRID   = "rgba(255,255,255,0.05)";

export const readColor = (r) =>
  r === null || r === undefined ? "#6B655C" : r >= 7.5 ? "#4BAE71" : r >= 5 ? "#F0C040" : "#C0695E";

export const readLabel = (r) =>
  r === null || r === undefined ? "No data" : r >= 7.5 ? "Prime" : r >= 5 ? "Caution" : "At risk";

const lab = {
  fontFamily: "'Inter',sans-serif", fontSize: "0.55rem", fontWeight: 700,
  letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--ivory2)",
};

// ── SPARKLINE ────────────────────────────────────────────────────────
// One athlete, ~14 days, inside a roster row. No axes, no legend, no hover —
// it is a scan aid; the row is the hit target. 40 of these read fine where a
// 40-series line chart would be unreadable spaghetti.
export function Sparkline({ points = [], w = 72, h = 22, color = GOLD }) {
  const vals = points.map(p => p.r).filter(v => v !== null && v !== undefined);
  if (vals.length === 0) {
    return <div style={{ width: w, height: h, ...lab, display: "flex", alignItems: "center" }}>—</div>;
  }
  if (vals.length === 1) {
    return (
      <svg width={w} height={h} role="img" aria-label={`Readiness ${vals[0]}`}>
        <circle cx={w - 3} cy={h / 2} r="3" fill={color} />
      </svg>
    );
  }
  const min = 0, max = 10;                       // fixed scale: 6.0 always sits in the same place
  const x = i => (i / (points.length - 1)) * (w - 6) + 3;
  const y = v => h - 3 - ((v - min) / (max - min)) * (h - 6);
  const d = points.map((p, i) =>
    p.r === null || p.r === undefined ? null : `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`
  ).filter(Boolean).join(" ");
  const last = points[points.length - 1];
  return (
    <svg width={w} height={h} role="img"
         aria-label={`Readiness trend, latest ${last?.r ?? "none"}`}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      {last?.r !== null && last?.r !== undefined && (
        <circle cx={x(points.length - 1)} cy={y(last.r)} r="2.5" fill={color} />
      )}
    </svg>
  );
}

// ── LINE CHART ───────────────────────────────────────────────────────
export function ReadinessLineChart({
  series = [], reference = [], height = 200, showBands = true,
  label = "Readiness", refLabel = "Team avg",
}) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);

  const pts = series.filter(p => p.r !== null && p.r !== undefined);
  if (!pts.length) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center",
                    color: MUTED, fontSize: "0.8rem" }}>
        No check-ins in this range yet.
      </div>
    );
  }

  const VB_W = 720, VB_H = height;
  const PAD = { t: 14, r: 44, b: 22, l: 30 };
  const iw = VB_W - PAD.l - PAD.r;
  const ih = VB_H - PAD.t - PAD.b;

  // Fixed 0–10 domain: a coach compares across athletes and weeks, so the
  // gridlines must mean the same thing every time. An auto-scaled y-axis would
  // make a flat athlete look dramatic.
  const yOf = v => PAD.t + ih - (v / 10) * ih;
  const xOf = i => PAD.l + (series.length <= 1 ? iw / 2 : (i / (series.length - 1)) * iw);

  const path = (arr) => arr.map((p, i) =>
    p.r === null || p.r === undefined ? null
      : `${i === 0 || arr[i - 1]?.r === null ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.r).toFixed(1)}`
  ).filter(Boolean).join(" ");

  const hasRef = reference.some(p => p.r !== null && p.r !== undefined);
  const fmtDate = d => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
    if (!m) return d;
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const onMove = (e) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX ?? e.touches?.[0]?.clientX) - r.left) / r.width * VB_W;
    let best = 0, bd = Infinity;
    series.forEach((_, i) => { const d = Math.abs(xOf(i) - px); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };

  const hp = hover !== null ? series[hover] : null;
  const hr = hover !== null ? reference[hover] : null;

  return (
    <div>
      {/* Legend — two series, so identity is never colour-alone */}
      <div style={{ display: "flex", gap: "1.1rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ ...lab, display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ width: 14, height: 2, background: GOLD, display: "inline-block" }} />{label}
        </span>
        {hasRef && (
          <span style={{ ...lab, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ width: 14, height: 2, background: REF, display: "inline-block" }} />{refLabel}
          </span>
        )}
      </div>

      <div ref={wrapRef} style={{ position: "relative", width: "100%" }}
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}
           onTouchStart={onMove} onTouchMove={onMove}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%"
             style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }} role="img"
             aria-label={`${label} over time, ${pts.length} points`}>

          {/* Status bands: position carries the meaning, colour only reinforces */}
          {showBands && (
            <g>
              <rect x={PAD.l} y={yOf(10)}  width={iw} height={yOf(7.5) - yOf(10)}  fill="#4BAE71" opacity="0.055" />
              <rect x={PAD.l} y={yOf(7.5)} width={iw} height={yOf(5)   - yOf(7.5)} fill="#F0C040" opacity="0.055" />
              <rect x={PAD.l} y={yOf(5)}   width={iw} height={yOf(0)   - yOf(5)}   fill="#C0695E" opacity="0.055" />
            </g>
          )}

          {/* Recessive grid + y labels */}
          {[0, 2.5, 5, 7.5, 10].map(v => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={yOf(v)} y2={yOf(v)} stroke={GRID} strokeWidth="1" />
              <text x={PAD.l - 6} y={yOf(v) + 3} textAnchor="end"
                    fill="var(--ivory2)" fontSize="9" fontFamily="Inter,sans-serif">{v}</text>
            </g>
          ))}

          {/* Team reference first, so the athlete's own line sits on top */}
          {hasRef && (
            <path d={path(reference)} fill="none" stroke={REF} strokeWidth="1.5"
                  strokeDasharray="4 3" strokeLinecap="round" opacity="0.75" />
          )}

          <path d={path(series)} fill="none" stroke={GOLD} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />

          {/* Markers only when the series is short enough to not turn to noise */}
          {series.length <= 45 && series.map((p, i) =>
            p.r === null || p.r === undefined ? null : (
              <circle key={i} cx={xOf(i)} cy={yOf(p.r)} r="3.5" fill={GOLD}
                      stroke="var(--charcoal)" strokeWidth="1.5" />
            ))}

          {/* Direct label on the final value */}
          {(() => {
            const li = [...series].reverse().findIndex(p => p.r !== null && p.r !== undefined);
            if (li === -1) return null;
            const i = series.length - 1 - li;
            return (
              <text x={xOf(i) + 8} y={yOf(series[i].r) + 4} fill={INK}
                    fontSize="13" fontWeight="700" fontFamily="'DM Sans',sans-serif">
                {series[i].r}
              </text>
            );
          })()}

          {/* x labels: first, middle, last only — never a label per point */}
          {[0, Math.floor((series.length - 1) / 2), series.length - 1]
            .filter((v, i, a) => a.indexOf(v) === i && v >= 0)
            .map(i => (
              <text key={i} x={xOf(i)} y={VB_H - 6} textAnchor="middle"
                    fill="var(--ivory2)" fontSize="9" fontFamily="Inter,sans-serif">
                {fmtDate(series[i]?.d)}
              </text>
            ))}

          {/* Crosshair */}
          {hover !== null && series[hover] && (
            <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD.t} y2={PAD.t + ih}
                  stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
          )}
        </svg>

        {/* Tooltip */}
        {hp && (
          <div style={{
            position: "absolute", left: `${(xOf(hover) / VB_W) * 100}%`, top: 0,
            transform: "translate(-50%,-100%)", pointerEvents: "none",
            background: "var(--smoke)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "var(--r)", padding: "0.5rem 0.7rem", whiteSpace: "nowrap", zIndex: 5,
          }}>
            <div style={lab}>{fmtDate(hp.d)}</div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "1.05rem",
                          fontWeight: 700, color: readColor(hp.r), marginTop: "0.15rem" }}>
              {hp.r ?? "—"} <span style={{ fontSize: "0.7rem", color: MUTED, fontWeight: 400 }}>
                {readLabel(hp.r)}
              </span>
            </div>
            {hr?.r !== null && hr?.r !== undefined && (
              <div style={{ fontSize: "0.68rem", color: MUTED, marginTop: "0.15rem" }}>
                Team avg {hr.r}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── COMPLIANCE CHART ─────────────────────────────────────────────────
// Separate chart, shared x-axis with the readiness chart above it. Two scales
// on one plot would be a dual-axis chart, which is the classic way to invent a
// correlation that isn't in the data.
export function ComplianceChart({ team = [], height = 96 }) {
  const pts = team.filter(p => p.compliance !== null && p.compliance !== undefined);
  if (!pts.length) return null;

  const VB_W = 720, VB_H = height;
  const PAD = { t: 10, r: 44, b: 18, l: 30 };
  const iw = VB_W - PAD.l - PAD.r, ih = VB_H - PAD.t - PAD.b;
  const xOf = i => PAD.l + (team.length <= 1 ? iw / 2 : (i / (team.length - 1)) * iw);
  const bw = Math.max(2, Math.min(14, iw / Math.max(team.length, 1) - 2));

  return (
    <div>
      <div style={{ ...lab, marginBottom: "0.4rem" }}>Check-in compliance</div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%"
           style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="Daily check-in compliance">
        {[0, 50, 100].map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={PAD.t + ih - (v / 100) * ih}
                  y2={PAD.t + ih - (v / 100) * ih} stroke={GRID} strokeWidth="1" />
            <text x={PAD.l - 6} y={PAD.t + ih - (v / 100) * ih + 3} textAnchor="end"
                  fill="var(--ivory2)" fontSize="9" fontFamily="Inter,sans-serif">{v}%</text>
          </g>
        ))}
        {team.map((p, i) => {
          const v = p.compliance ?? 0;
          const h = (v / 100) * ih;
          return (
            <rect key={i} x={xOf(i) - bw / 2} y={PAD.t + ih - h} width={bw} height={Math.max(h, 0)}
                  rx="2" fill={GOLD} opacity={v === 0 ? 0.18 : 0.75}>
              <title>{`${p.d}: ${v}% (${p.checkedIn}/${p.rosterSize})`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
