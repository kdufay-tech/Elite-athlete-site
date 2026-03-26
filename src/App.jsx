import { useState, useEffect, useRef } from "react";
import { getSession, onAuthChange, signOut, saveProfile, loadProfile,
         saveJournalEntry, loadJournalEntries, deleteJournalEntry, saveProgressNote, loadProgressNotes,
         loadSubscription, saveCheckIn, loadCheckIns, saveWorkoutLog, loadWorkoutLogs,
         saveWeightEntry, loadWeightLogs, saveNutritionEntry, loadNutritionLogs,
         saveBenchmark, loadBenchmarks } from "./lib/supabase";
import { downloadMealPlanPDF, downloadWorkoutPDF, downloadProgressReportPDF, downloadJournalPDF, downloadRecoveryPDF, downloadAthleteReportCard } from "./lib/pdf";
import { emailMealPlan, emailProgressReport, emailInjuryProtocol, emailWorkoutPlan, emailRecoveryNutrition, sendEmail } from "./lib/email";
import AuthModal from "./components/AuthModal";
import PayModal from "./components/PayModal";
import { getUserTier, canAccess as tierCanAccess, TIER_INFO } from "./lib/stripe";

// ── SECURITY: sanitize user-supplied strings before injecting into document.write() popups
const sanitizeHtml = (str) => String(str || '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#039;');


// ─────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────
const SPORTS = {
  football:   { icon: "FB", label: "Football",   img: "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=800&q=80", positions: ["Quarterback","Running Back","Wide Receiver","Tight End","Offensive Lineman","Defensive End","Linebacker","Cornerback","Safety","Kicker"], injuries: ["ACL Tear","MCL Sprain","Hamstring Strain","Rotator Cuff","Concussion","Ankle Sprain","Turf Toe","Shoulder Dislocation"] },
  basketball: { icon: "BB", label: "Basketball", img: "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&q=80", positions: ["Point Guard","Shooting Guard","Small Forward","Power Forward","Center"], injuries: ["Ankle Sprain","Knee Tendinitis","Finger Dislocation","Achilles Strain","Back Spasm","Hip Flexor"] },
  soccer:     { icon: "SC", label: "Soccer",     img: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80", positions: ["Goalkeeper","Center Back","Full Back","Defensive Mid","Central Mid","Attacking Mid","Winger","Striker"], injuries: ["Groin Pull","Hamstring Tear","Knee Ligament","Shin Splints","Ankle Sprain","Calf Strain"] },
  hockey:     { icon: "HK", label: "Hockey",     img: "https://images.unsplash.com/photo-1515703407324-5f753afd8be8?w=800&q=80", positions: ["Goalie","Defenseman","Left Wing","Right Wing","Center"], injuries: ["Shoulder Separation","Hip Flexor","Knee MCL","Groin Strain","Concussion","Rib Fracture"] },
  volleyball: { icon: "VB", label: "Volleyball", img: "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=800&q=80", positions: ["Setter","Libero","Outside Hitter","Middle Blocker","Opposite Hitter","Right Side"], injuries: ["Patellar Tendinitis","Shoulder Impingement","Ankle Sprain","Finger Sprain","Lower Back"] },
};

// Each meal: { name, cal, p, c, f }  (kcal, protein g, carbs g, fat g)
// ── SPORT + POSITION NUTRITION PROFILES ─────────────────────
// Based on ISSN, NSCA, IOC certified sports nutrition guidelines

const SPORT_NUTRITION_PROFILES = {
  football: {
    base: {
      calMultiplier: 1.0, proteinGperLb: 1.0, carbsPercent: 0.45, fatPercent: 0.25,
      keyFoods: ["Lean Beef","Chicken Breast","Sweet Potatoes","Brown Rice","Eggs","Whole Milk","Quinoa","Broccoli"],
      recoveryFocus: "Anti-inflammatory omega-3s, collagen for joint health, creatine for power output",
      timing: "Pre-game: High carb 3-4hrs before. Post-game: Protein+carb within 30min",
      supplements: ["Creatine Monohydrate 5g/day","Beta-Alanine 3.2g/day","Omega-3 3g/day","Vitamin D3 5000IU"],
    },
    positions: {
      "Quarterback":      { calMultiplier: 0.95, proteinGperLb: 0.9,  note: "Lean muscle maintenance, omega-3 for mental clarity, agility over bulk. Avoid excessive mass gain." },
      "Running Back":     { calMultiplier: 1.05, proteinGperLb: 1.0,  note: "Explosive power, high carbs for repeated sprints, iron for endurance. Creatine essential." },
      "Wide Receiver":    { calMultiplier: 0.9,  proteinGperLb: 0.85, note: "Speed priority, lean body composition, high carbs for sprint-recovery cycles. Minimize bulk." },
      "Tight End":        { calMultiplier: 1.1,  proteinGperLb: 1.0,  note: "Hybrid strength-speed athlete, balanced macros, collagen for blocking and receiving joints." },
      "Offensive Lineman":{ calMultiplier: 1.4,  proteinGperLb: 1.1,  note: "Highest calorie needs (5000-6000+ kcal). Maximum mass and strength. Creatine critical. 6+ meals." },
      "Defensive End":    { calMultiplier: 1.2,  proteinGperLb: 1.05, note: "Explosive off-line strength, anti-inflammatory recovery, collagen for joint protection." },
      "Linebacker":       { calMultiplier: 1.15, proteinGperLb: 1.0,  note: "Strength-endurance hybrid, BCAAs for rapid recovery, high iron for sustained effort." },
      "Cornerback":       { calMultiplier: 0.9,  proteinGperLb: 0.9,  note: "Pure speed and agility, lean mass priority, high carbs for repeated sprint performance." },
      "Safety":           { calMultiplier: 0.95, proteinGperLb: 0.9,  note: "Cardio-endurance + strength blend, balanced macros, electrolyte and hydration focus." },
      "Kicker":           { calMultiplier: 0.85, proteinGperLb: 0.8,  note: "Lean body composition, hip flexor health critical, minimal bulk, precision over power." },
    }
  },
  basketball: {
    base: {
      calMultiplier: 1.0, proteinGperLb: 0.85, carbsPercent: 0.55, fatPercent: 0.20,
      keyFoods: ["Chicken","Wild Salmon","Oatmeal","Brown Rice","Bananas","Greek Yogurt","Berries","Nuts"],
      recoveryFocus: "Glycogen replenishment, hydration (2-4L lost per game), anti-inflammatory",
      timing: "Pre-game: Carb-rich 3hrs prior. During: Electrolytes. Post: Carb+protein within 45min",
      supplements: ["Beta-Alanine 3.2g/day","Electrolytes","Magnesium 400mg","Tart Cherry Extract"],
    },
    positions: {
      "Point Guard":    { calMultiplier: 0.95, proteinGperLb: 0.85, note: "Highest cardio demands of any position. Maximum carb loading, mental clarity foods (omega-3)." },
      "Shooting Guard": { calMultiplier: 0.95, proteinGperLb: 0.85, note: "Speed + shooting precision, lean mass, steady blood sugar for sustained focus." },
      "Small Forward":  { calMultiplier: 1.0,  proteinGperLb: 0.9,  note: "Versatile demands, balanced nutrition, both strength and endurance must be supported." },
      "Power Forward":  { calMultiplier: 1.1,  proteinGperLb: 1.0,  note: "Inside physical play, higher protein for muscle maintenance, anti-inflammatory essential." },
      "Center":         { calMultiplier: 1.2,  proteinGperLb: 1.05, note: "Maximum size and strength, highest calorie needs, creatine for post strength." },
    }
  },
  soccer: {
    base: {
      calMultiplier: 1.0, proteinGperLb: 0.75, carbsPercent: 0.60, fatPercent: 0.20,
      keyFoods: ["Pasta","Rice","Chicken","Salmon","Bananas","Eggs","Leafy Greens","Beets"],
      recoveryFocus: "Glycogen replenishment (7-9 miles run/game), iron for oxygen transport, hydration",
      timing: "Carb load 2 days before match. Light carbs day of. Recover within 30min post.",
      supplements: ["Iron (if deficient)","Vitamin C for iron absorption","Beta-Alanine","Beet Root Extract"],
    },
    positions: {
      "Goalkeeper":    { calMultiplier: 0.85, proteinGperLb: 0.85, note: "Explosive short bursts, reaction nutrition, lean mass, less cardiovascular than outfield." },
      "Center Back":   { calMultiplier: 1.0,  proteinGperLb: 0.9,  note: "Physical strength, aerial duels, anti-inflammatory, calcium for heading protection." },
      "Full Back":     { calMultiplier: 1.05, proteinGperLb: 0.8,  note: "Highest mileage on the pitch, maximum carb needs, iron critical for endurance." },
      "Defensive Mid": { calMultiplier: 1.1,  proteinGperLb: 0.85, note: "Covers most ground of any position, maximum carb loading, iron critical." },
      "Central Mid":   { calMultiplier: 1.05, proteinGperLb: 0.8,  note: "Box-to-box endurance, carb priority, magnesium for muscle cramp prevention." },
      "Attacking Mid": { calMultiplier: 0.95, proteinGperLb: 0.8,  note: "Lean composition for speed, steady blood sugar for creative decision-making." },
      "Winger":        { calMultiplier: 1.0,  proteinGperLb: 0.8,  note: "Sprint-recovery cycles, high carbs for repeated sprints, lean mass priority." },
      "Striker":       { calMultiplier: 0.95, proteinGperLb: 0.85, note: "Explosive acceleration, lean mass, creatine for final-third power bursts." },
    }
  },
  hockey: {
    base: {
      calMultiplier: 1.0, proteinGperLb: 0.9, carbsPercent: 0.50, fatPercent: 0.25,
      keyFoods: ["Chicken","Beef","Salmon","Oats","Rice","Eggs","Sweet Potato","Milk"],
      recoveryFocus: "Joint protection, bone density, short-burst anaerobic energy, shift recovery",
      timing: "Pre-game: Carb-rich 3hrs before, light snack 1hr. Post-game: Protein shake within 30min",
      supplements: ["Creatine 5g/day","Calcium + Vitamin D","Omega-3","B12"],
    },
    positions: {
      "Goalie":     { calMultiplier: 0.85, proteinGperLb: 0.85, note: "Explosive short bursts, flexibility nutrition, lean mass, mental clarity foods." },
      "Defenseman": { calMultiplier: 1.1,  proteinGperLb: 1.0,  note: "Board battle strength, anti-inflammatory critical, bone density nutrition." },
      "Left Wing":  { calMultiplier: 1.0,  proteinGperLb: 0.9,  note: "Speed on edges, balanced carb-protein, quick shift recovery nutrition." },
      "Right Wing": { calMultiplier: 1.0,  proteinGperLb: 0.9,  note: "Offensive speed, iron for 60-minute endurance, carbs for shift energy." },
      "Center":     { calMultiplier: 1.05, proteinGperLb: 0.9,  note: "Most ice time, face-off explosiveness, highest carb needs of all forwards." },
    }
  },
  volleyball: {
    base: {
      calMultiplier: 1.0, proteinGperLb: 0.85, carbsPercent: 0.50, fatPercent: 0.25,
      keyFoods: ["Chicken","Turkey","Salmon","Quinoa","Sweet Potato","Greek Yogurt","Almonds","Berries"],
      recoveryFocus: "Shoulder & knee joint health, explosive jump recovery, collagen synthesis",
      timing: "Light pre-match 2-3hrs before. Post: protein within 30 min for jump muscle repair.",
      supplements: ["Collagen Peptides 15g/day","Vitamin C 1000mg","Omega-3","Magnesium Glycinate"],
    },
    positions: {
      "Setter":          { calMultiplier: 0.9,  proteinGperLb: 0.8,  note: "Lean and agile, wrist and shoulder health critical, mental clarity, coordination foods." },
      "Libero":          { calMultiplier: 0.9,  proteinGperLb: 0.8,  note: "Defensive specialist, endurance over strength, high carbs for hustle, iron." },
      "Outside Hitter":  { calMultiplier: 1.0,  proteinGperLb: 0.9,  note: "Most attacks per set, shoulder collagen critical, power-endurance nutrition balance." },
      "Middle Blocker":  { calMultiplier: 1.05, proteinGperLb: 0.95, note: "Explosive blocking, tallest position, collagen for joint protection, quick anaerobic energy." },
      "Opposite Hitter": { calMultiplier: 1.0,  proteinGperLb: 0.9,  note: "Power offensive role, shoulder health, higher strength component than libero." },
      "Right Side":      { calMultiplier: 1.0,  proteinGperLb: 0.9,  note: "Hybrid offensive-blocking, balanced macros, shoulder and knee collagen protection." },
    }
  },
};

function getSportCalorieTarget(baseCals, sport, position, weight, height, age, goal) {
  // Harris-Benedict TDEE + sport-specific activity + goal adjustment
  // weight in lbs, height in inches, age in years
  const wLbs = parseFloat(weight) || 185;
  const hIn  = parseFloat(height) || 72;
  const ageY = parseFloat(age)    || 24;
  const wKg  = wLbs * 0.453592;
  const hCm  = hIn  * 2.54;

  // Harris-Benedict BMR (male formula — most athletes are male but applies generally)
  const bmr = 88.362 + (13.397 * wKg) + (4.799 * hCm) - (5.677 * ageY);

  // Sport-specific activity multipliers (NSCA-validated)
  const sportActivity = {
    football:   1.7,   // Heavy training + games
    basketball: 1.65,  // High-intensity intervals + games
    soccer:     1.75,  // Highest total distance of any team sport
    hockey:     1.65,  // Anaerobic bursts + game duration
    volleyball: 1.55,  // Moderate — interval explosive
  };

  // Position-specific adjustment within sport
  const sp = SPORT_NUTRITION_PROFILES[sport];
  const posMult = sp?.positions?.[position]?.calMultiplier ?? sp?.base?.calMultiplier ?? 1.0;

  // Activity-based TDEE
  const actFactor = sportActivity[sport] || 1.6;
  let tdee = bmr * actFactor * posMult;

  // Goal adjustment (ISSN recommendations)
  const goalAdjust = {
    "Weight Gain":       tdee * 1.15,   // +15% surplus for lean mass gain
    "Weight Loss":       tdee * 0.82,   // -18% deficit — preserves muscle at high training volume
    "Weight Maintenance": tdee,
  };

  const finalCals = goalAdjust[goal] || tdee;
  return Math.round(finalCals / 50) * 50; // Round to nearest 50
}

// ─────────────────────────────────────────────────────────────
// SUPPLEMENT STACKS — Sport + Position Specific
// Based on ISSN, NSCA, and peer-reviewed sports nutrition research
// Each supplement: { name, dose, timing, purpose, evidence, category }
// Categories: foundation | performance | recovery | cognitive | body_comp
// Evidence: A = strong RCT evidence | B = moderate | C = emerging
// ─────────────────────────────────────────────────────────────
const SUPPLEMENT_STACKS = {

  // ── UNIVERSAL FOUNDATION (all sports) ────────────────────
  _foundation: [
    { name:"Whey Protein Isolate", dose:"25–40g", timing:"Within 30 min post-training", purpose:"Muscle protein synthesis — the single most important recovery supplement", evidence:"A", category:"foundation", icon:"🥛" },
    { name:"Creatine Monohydrate", dose:"5g/day", timing:"Any time — consistency matters more than timing", purpose:"Increases phosphocreatine stores — improves power, sprint speed, and lean mass", evidence:"A", category:"performance", icon:"" },
    { name:"Omega-3 (EPA+DHA)", dose:"2–4g/day", timing:"With a meal containing fat", purpose:"Reduces muscle soreness, joint inflammation, and improves cardiovascular health", evidence:"A", category:"recovery", icon:"🐟" },
    { name:"Vitamin D3", dose:"2000–5000 IU/day", timing:"Morning with fat-containing meal", purpose:"Bone density, immune function, testosterone production, muscle fiber recruitment", evidence:"A", category:"foundation", icon:"" },
    { name:"Magnesium Glycinate", dose:"300–400mg", timing:"30–60 min before bed", purpose:"Sleep quality, muscle relaxation, reduces cramping, 60% of athletes are deficient", evidence:"A", category:"recovery", icon:"😴" },
    { name:"Zinc", dose:"25–30mg/day", timing:"With food (away from iron supplements)", purpose:"Testosterone production, immune function, wound healing — depleted heavily by sweat", evidence:"B", category:"foundation", icon:"" },
  ],

  football: {
    _base: [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training or with food", purpose:"Maximum power output — linemen, explosive athletes. #1 evidence-backed supplement in sport", evidence:"A", category:"performance", icon:"" },
      { name:"Beta-Alanine", dose:"3.2–4g/day (split doses)", timing:"Split into 2 doses to reduce tingling", purpose:"Increases muscle carnosine — delays fatigue in repeated high-intensity bursts", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen Peptides + Vitamin C", dose:"15g collagen + 250mg Vitamin C", timing:"30–45 min pre-training on joint days", purpose:"Tendon and ligament resilience — dramatically reduces soft tissue injury risk", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Electrolyte Mix", dose:"Per product (sodium, potassium, magnesium)", timing:"During training and games", purpose:"Prevents cramping, maintains hydration — 1-2% dehydration = 10-20% performance drop", evidence:"A", category:"foundation", icon:"💧" },
    ],
    "Quarterback": [
      { name:"Lion's Mane Mushroom", dose:"500–1000mg/day", timing:"Morning", purpose:"Cognitive performance, reaction time, focus — QBs live and die by mental processing speed", evidence:"B", category:"cognitive", icon:"🧠" },
      { name:"Omega-3 (high DHA)", dose:"3g/day (DHA-heavy formula)", timing:"With breakfast", purpose:"Brain and neural function — DHA is the dominant fatty acid in the brain", evidence:"A", category:"cognitive", icon:"🐟" },
      { name:"Rhodiola Rosea", dose:"400mg/day", timing:"Morning or pre-practice (not at night)", purpose:"Reduces cortisol response to stress — helps QBs stay calm under 4th quarter pressure", evidence:"B", category:"cognitive", icon:"" },
      { name:"L-Theanine + Caffeine", dose:"200mg L-Theanine + 100mg Caffeine", timing:"45–60 min pre-game", purpose:"Calm focus without jitters — the ideal pre-game cognitive stack for a QB", evidence:"B", category:"cognitive", icon:"" },
    ],
    "Offensive Lineman": [
      { name:"Creatine Monohydrate (loading)", dose:"20g/day for 5 days, then 5g/day", timing:"Loading phase: split into 4 doses. Maintenance: post-training", purpose:"Maximum strength and mass — the most critical supplement for a lineman", evidence:"A", category:"performance", icon:"" },
      { name:"HMB (Beta-Hydroxy Beta-Methylbutyrate)", dose:"3g/day", timing:"With meals, split 3×1g", purpose:"Preserves muscle mass during high training volume — linemen train heaviest", evidence:"B", category:"body_comp", icon:"W" },
      { name:"Tart Cherry Extract", dose:"480mg or 240ml juice 2x/day", timing:"Morning and evening", purpose:"Accelerates recovery between intense practice sessions — reduces DOMS by 24hrs", evidence:"B", category:"recovery", icon:"🍒" },
    ],
    "Defensive End": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"First-step explosion off the line — every millisecond matters on the pass rush", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"3–6mg/kg bodyweight", timing:"45–60 min pre-game/practice", purpose:"Maximizes explosive power, reaction time, and aggression — elite legal ergogenic", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"Pass rushers put extreme stress on wrists, elbows, and shoulders every rep", evidence:"B", category:"recovery", icon:"🦴" },
    ],
    "Running Back": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Explosive sprint speed and contact power — repeated burst athlete needs PCr system maxed", evidence:"A", category:"performance", icon:"" },
      { name:"Iron + Vitamin C", dose:"18mg iron + 500mg Vitamin C", timing:"Morning, away from calcium", purpose:"RBs run 15–20 carries/game — iron supports the oxygen delivery for repeated sprints", evidence:"B", category:"foundation", icon:"🩸" },
      { name:"BCAAs (2:1:1 ratio)", dose:"10g", timing:"During training or games", purpose:"Fuel for muscles during prolonged high-intensity activity — prevents central fatigue", evidence:"B", category:"performance", icon:"" },
    ],
    "Wide Receiver": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Route-running explosiveness and speed — first 10 yards of every route", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-game", purpose:"Reaction time and sprint speed — every WR needs to be the fastest version of themselves", evidence:"A", category:"performance", icon:"" },
      { name:"Electrolytes", dose:"Per product", timing:"Pre and during games", purpose:"WRs run 100+ routes per game — dehydration kills top-end speed", evidence:"A", category:"foundation", icon:"💧" },
    ],
    "Linebacker": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Sideline-to-sideline explosion — every pursuit requires max PCr output", evidence:"A", category:"performance", icon:"" },
      { name:"Beta-Alanine", dose:"3.2g/day", timing:"Split doses with food", purpose:"60-minute endurance in a power athlete — LBs play almost every defensive snap", evidence:"A", category:"performance", icon:"" },
      { name:"Tart Cherry", dose:"480mg 2x/day", timing:"Morning and evening", purpose:"LBs take more physical punishment than any position besides linemen — accelerate recovery", evidence:"B", category:"recovery", icon:"🍒" },
    ],
    "Cornerback": [
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-game", purpose:"Reaction time is everything for a CB — caffeine proven to improve first-step reaction", evidence:"A", category:"performance", icon:"" },
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Sprint speed and acceleration — CBs must match the WR's every move", evidence:"A", category:"performance", icon:"" },
      { name:"Magnesium Glycinate", dose:"400mg", timing:"Before bed", purpose:"Hip flexor and hamstring relaxation — prevents cramping during sprint-heavy games", evidence:"B", category:"recovery", icon:"😴" },
    ],
    "Safety": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Closing speed and collision power — safeties must be explosive over 40+ yards", evidence:"A", category:"performance", icon:"" },
      { name:"Omega-3", dose:"3g/day", timing:"With meals", purpose:"Safeties take the highest-speed collisions in football — omega-3 reduces brain inflammation", evidence:"A", category:"recovery", icon:"🐟" },
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-game", purpose:"Range and reaction speed across the whole field", evidence:"A", category:"performance", icon:"" },
    ],
    "Tight End": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Dual role demands — block like a lineman, run routes like a WR", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"TEs take blocking hits and catching hits every play — joint protection is critical", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Beta-Alanine", dose:"3.2g/day", timing:"Split doses", purpose:"Endurance for 60 snaps as both blocker and receiver", evidence:"A", category:"performance", icon:"" },
    ],
  },

  basketball: {
    _base: [
      { name:"Caffeine", dose:"200–300mg", timing:"60 min pre-game", purpose:"Improves sprint speed, reaction time, and shooting accuracy — #1 acute performance enhancer", evidence:"A", category:"performance", icon:"" },
      { name:"Electrolytes (High Sodium)", dose:"1000mg sodium, 300mg potassium", timing:"Pre-game and at halftime", purpose:"Players lose 2–4L sweat per game — sodium-led rehydration is essential", evidence:"A", category:"foundation", icon:"💧" },
      { name:"Tart Cherry Juice", dose:"240ml 2x/day", timing:"Morning and evening on game days", purpose:"Reduces post-game muscle soreness — critical for back-to-back game weeks", evidence:"B", category:"recovery", icon:"🍒" },
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Jump height, sprint speed, and strength — improves every physical metric in basketball", evidence:"A", category:"performance", icon:"" },
    ],
    "Point Guard": [
      { name:"Caffeine + L-Theanine", dose:"150mg caffeine + 200mg L-Theanine", timing:"60 min pre-game", purpose:"PGs need focus AND stamina — this combo gives energy without the jittery decision-making errors", evidence:"B", category:"cognitive", icon:"🧠" },
      { name:"Rhodiola Rosea", dose:"400mg", timing:"Morning", purpose:"Adapts the stress response — PGs face the most cognitive pressure of any position", evidence:"B", category:"cognitive", icon:"" },
      { name:"Iron + Vitamin C", dose:"Per need — test first", timing:"Morning", purpose:"PGs cover 5+ miles per game — iron-deficiency kills aerobic capacity", evidence:"A", category:"foundation", icon:"🩸" },
    ],
    "Center": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Post strength and rebounding power — the biggest supplement ROI for a Center", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"Knee and hip joint protection — Centers absorb massive contact loads every possession", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"HMB", dose:"3g/day", timing:"Split with meals", purpose:"Maintains muscle mass under heavy practice volume — Centers need size all season", evidence:"B", category:"body_comp", icon:"W" },
    ],
    "Power Forward": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Post-up strength, rebounding explosion, and sprint speed in transition", evidence:"A", category:"performance", icon:"" },
      { name:"Beta-Alanine", dose:"3.2g/day", timing:"Split doses", purpose:"High-low game requires both endurance and repeated explosive bursts", evidence:"A", category:"performance", icon:"" },
      { name:"Tart Cherry", dose:"480mg 2x/day", timing:"Morning and night", purpose:"PFs absorb physical contact every possession — accelerated recovery between games", evidence:"B", category:"recovery", icon:"🍒" },
    ],
    "Shooting Guard": [
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-game", purpose:"Shooting accuracy is the primary SG skill — caffeine proven to improve motor precision", evidence:"A", category:"performance", icon:"" },
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Off-the-dribble explosion and catch-and-shoot efficiency late in games", evidence:"A", category:"performance", icon:"" },
    ],
    "Small Forward": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Versatile position requires strength AND speed — creatine supports both", evidence:"A", category:"performance", icon:"" },
      { name:"Omega-3", dose:"3g/day", timing:"With meals", purpose:"SF plays 35+ minutes — omega-3 reduces systemic inflammation for consistent performance", evidence:"A", category:"recovery", icon:"🐟" },
    ],
  },

  soccer: {
    _base: [
      { name:"Beet Root Extract / Nitrates", dose:"300–600mg nitrate (≈ 500ml beet juice)", timing:"2–3 hrs pre-match", purpose:"Improves oxygen efficiency — reduces oxygen cost of running by 3–5%. Game-changer for 90 min", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"3–6mg/kg", timing:"60 min pre-match", purpose:"Endurance, sprint speed, technical skill under fatigue — proven in 90-minute match conditions", evidence:"A", category:"performance", icon:"" },
      { name:"Iron + Vitamin C", dose:"Test ferritin first — supplement if <30ng/mL", timing:"Morning, away from tea/coffee", purpose:"Iron is the oxygen-carrier — deficiency is the #1 cause of unexplained fatigue in soccer players", evidence:"A", category:"foundation", icon:"🩸" },
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Improves sprint performance in the final 15 minutes when PCr stores are depleted", evidence:"A", category:"performance", icon:"" },
    ],
    "Goalkeeper": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Explosive dive and jump reactions — GKs make 5–7 explosive explosive saves per game", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-match", purpose:"Reaction time for shot-stopping — 50ms faster reaction can save a goal", evidence:"A", category:"cognitive", icon:"" },
      { name:"Omega-3", dose:"3g/day", timing:"With meals", purpose:"Joint protection for repeated diving and landing — shoulder and knee health", evidence:"A", category:"recovery", icon:"🐟" },
    ],
    "Full Back": [
      { name:"Beet Root", dose:"400mg nitrate", timing:"2 hrs pre-match", purpose:"Full backs cover more ground than any position — nitrates reduce oxygen cost of running", evidence:"A", category:"performance", icon:"" },
      { name:"Iron", dose:"Per blood test results", timing:"Morning away from coffee", purpose:"Full backs develop the highest aerobic demands — iron-deficiency is the top limiting factor", evidence:"A", category:"foundation", icon:"🩸" },
      { name:"Electrolytes", dose:"High sodium formula", timing:"Pre-match and HT", purpose:"90+ minutes of high-intensity running depletes sodium aggressively", evidence:"A", category:"foundation", icon:"💧" },
    ],
    "Striker": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Explosive first step, jump for headers, and final-third power bursts", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-match", purpose:"Sprint speed and shooting power — strikers need to be fastest in the final third", evidence:"A", category:"performance", icon:"" },
      { name:"Beta-Alanine", dose:"3.2g/day", timing:"Split doses", purpose:"Strikers make 30–40 sprints per game — carnosine buffer delays sprint fatigue", evidence:"A", category:"performance", icon:"" },
    ],
    "Defensive Mid": [
      { name:"Beet Root", dose:"400mg nitrate", timing:"2 hrs pre-match", purpose:"Defensive mids cover the most distance — nitrates maximize aerobic efficiency", evidence:"A", category:"performance", icon:"" },
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Tackle explosiveness and box-to-box sprint speed late in matches", evidence:"A", category:"performance", icon:"" },
      { name:"Tart Cherry", dose:"480mg 2x/day", timing:"Morning and evening", purpose:"Defensive mids play every minute of every match — fastest recovery between games", evidence:"B", category:"recovery", icon:"🍒" },
    ],
    "Winger": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Wingers make 20+ sprints per match — PCr system must be maxed", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-match", purpose:"Top-end sprint speed and reaction at the byline", evidence:"A", category:"performance", icon:"" },
      { name:"Beet Root", dose:"400mg nitrate", timing:"2 hrs pre-match", purpose:"Sprint-recovery cycling efficiency over 90 minutes", evidence:"A", category:"performance", icon:"" },
    ],
    "Goalkeeper": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Explosive saves, jump reach, and distribution power", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-match", purpose:"Reaction time — 50ms faster is the difference between a save and a goal", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"Diving and landing on shoulders repeatedly — joint protection essential", evidence:"B", category:"recovery", icon:"🦴" },
    ],
  },

  hockey: {
    _base: [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Hockey is 45-second explosive shifts — PCr is the primary energy system. Creatine is non-negotiable", evidence:"A", category:"performance", icon:"" },
      { name:"Caffeine", dose:"3–5mg/kg", timing:"60 min pre-game", purpose:"Skating speed, shot power, and aggression — proven to improve on-ice performance metrics", evidence:"A", category:"performance", icon:"" },
      { name:"Vitamin D3 + Calcium", dose:"3000–5000 IU D3 + 1000mg Calcium", timing:"With fat-containing meal", purpose:"Indoor sport — vitamin D deficiency is almost universal in hockey players. Critical for bone density", evidence:"A", category:"foundation", icon:"" },
      { name:"B12", dose:"1000mcg", timing:"Morning", purpose:"Red blood cell production — critical for shift-by-shift oxygen delivery", evidence:"A", category:"foundation", icon:"🔴" },
    ],
    "Defenseman": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Board battles require maximum strength and power output every shift", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-skate", purpose:"Defensemen take slashes, hits, and falls on every shift — joint and bone resilience", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Omega-3", dose:"3g/day", timing:"With meals", purpose:"Reduces post-game inflammation — defensemen take the most physical punishment on the team", evidence:"A", category:"recovery", icon:"🐟" },
    ],
    "Center": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Faceoff explosiveness and the highest ice time of any forward position", evidence:"A", category:"performance", icon:"" },
      { name:"Beta-Alanine", dose:"3.2g/day", timing:"Split doses with food", purpose:"Centers play the most shifts — carnosine buffer extends high-quality shift duration", evidence:"A", category:"performance", icon:"" },
      { name:"Electrolytes", dose:"High sodium", timing:"Pre-game, between periods", purpose:"Full-speed shifts every 2 minutes for 60 minutes requires aggressive electrolyte replacement", evidence:"A", category:"foundation", icon:"💧" },
    ],
    "Goalie": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Butterfly saves require explosive lateral movement from deep hip abduction", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-skate", purpose:"Goalie pads + ice = constant hip and knee joint stress — collagen reduces cumulative damage", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Caffeine", dose:"200mg", timing:"60 min pre-game", purpose:"Reflex and reaction time — a goalie facing 30+ shots needs maximum neural alertness", evidence:"A", category:"cognitive", icon:"" },
    ],
  },

  volleyball: {
    _base: [
      { name:"Collagen Peptides + Vitamin C", dose:"15g + 1000mg", timing:"30–45 min pre-training", purpose:"Volleyball players make 200+ jumps per match — collagen rebuilds patellar tendon and shoulder connective tissue", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Jump height and attack power — improves vertical by 1–2cm within 4 weeks in most athletes", evidence:"A", category:"performance", icon:"" },
      { name:"Magnesium Glycinate", dose:"400mg", timing:"30 min before bed", purpose:"Sleep quality for recovery between practices, reduces muscle cramps from repetitive jumping", evidence:"A", category:"recovery", icon:"😴" },
      { name:"Tart Cherry Juice", dose:"480mg extract or 240ml juice 2x/day", timing:"Morning and evening", purpose:"Reduces DOMS from high-volume jump training — patellar tendon health", evidence:"B", category:"recovery", icon:"🍒" },
    ],
    "Outside Hitter": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Attack power and approach jump — outside hitters make the most attacks per set", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"Shoulder and patellar tendon — outside hitters place highest load on these structures", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Caffeine", dose:"150–200mg", timing:"60 min pre-match", purpose:"Attack timing and approach speed — caffeine improves explosive reaction time", evidence:"A", category:"performance", icon:"" },
    ],
    "Middle Blocker": [
      { name:"Creatine Monohydrate", dose:"5g/day", timing:"Post-training", purpose:"Block explosiveness — middle blockers make the fastest jump transitions on the court", evidence:"A", category:"performance", icon:"" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"Patellar tendinopathy is the #1 injury for middle blockers — prevention is essential", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Beta-Alanine", dose:"3.2g/day", timing:"Split doses", purpose:"Multiple consecutive transition blocks — carnosine buffer extends explosive output", evidence:"A", category:"performance", icon:"" },
    ],
    "Libero": [
      { name:"Omega-3", dose:"3g/day", timing:"With meals", purpose:"Constant diving creates shoulder and hip inflammation — omega-3 provides systemic anti-inflammatory protection", evidence:"A", category:"recovery", icon:"🐟" },
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"Liberos dive more than any other position — knee and shoulder joint protection", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Caffeine", dose:"150mg", timing:"60 min pre-match", purpose:"Reaction time for digs — libero's job is first touch off every opponent attack", evidence:"A", category:"cognitive", icon:"" },
    ],
    "Setter": [
      { name:"Collagen + Vitamin C", dose:"15g + 250mg", timing:"30 min pre-training", purpose:"Wrist and shoulder health — setters make 1000+ setting contacts per week", evidence:"B", category:"recovery", icon:"🦴" },
      { name:"Caffeine", dose:"150mg", timing:"60 min pre-match", purpose:"Decision-making speed and jump-set height — setters are the quarterbacks of volleyball", evidence:"A", category:"cognitive", icon:"" },
      { name:"Omega-3", dose:"3g/day", timing:"With meals", purpose:"Wrist joint health and anti-inflammatory for high-repetition motion", evidence:"A", category:"recovery", icon:"🐟" },
    ],
  },
};

// Returns a combined, deduplicated supplement stack for a given sport + position
function getSupplementStack(sport, position) {
  const foundation = SUPPLEMENT_STACKS._foundation || [];
  const sportBase  = SUPPLEMENT_STACKS[sport]?._base || [];
  const posStack   = SUPPLEMENT_STACKS[sport]?.[position] || [];
  // Deduplicate by name — position-specific overrides base
  const seen = new Set();
  return [...posStack, ...sportBase, ...foundation].filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

function getSportNutritionNote(sport, position) {
  const sp = SPORT_NUTRITION_PROFILES[sport];
  if (!sp) return null;
  return {
    base: sp.base, posNote: sp.positions?.[position]?.note || sp.base.recoveryFocus,
    supplements: sp.base.supplements, timing: sp.base.timing, keyFoods: sp.base.keyFoods,
    calMultiplier: sp.positions?.[position]?.calMultiplier ?? sp.base.calMultiplier,
  };
}


const MEAL_PLANS = {
  "Weight Gain": {
    3: [
      { id:"m1", label:"Meal 1 — Power Breakfast", time:"7:00 AM", emoji:"I",
        items:[
          {name:"6 Eggs Scrambled with Spinach & Feta",      cal:450, p:36, c:4,  f:32},
          {name:"Steel-Cut Oatmeal (2 cups) with Honey",     cal:380, p:12, c:72, f:6},
          {name:"Whole Milk Greek Yogurt Parfait & Granola",  cal:320, p:18, c:42, f:8},
          {name:"Sweet Potato Hash with Turkey Sausage",     cal:410, p:22, c:48, f:12},
        ]},
      { id:"m2", label:"Meal 2 — Elite Lunch", time:"1:00 PM", emoji:"III",
        items:[
          {name:"12 oz Grilled Chicken Breast",              cal:370, p:70, c:0,  f:8},
          {name:"Brown Rice (2½ cups) with Herbs",           cal:460, p:10, c:96, f:4},
          {name:"Steamed Broccoli, Asparagus & Avocado",     cal:280, p:8,  c:22, f:18},
          {name:"Olive Oil & Sea Salt Drizzle",              cal:120, p:0,  c:0,  f:14},
        ]},
      { id:"m3", label:"Meal 3 — Championship Dinner", time:"7:00 PM", emoji:"V",
        items:[
          {name:"10 oz Grass-Fed Ribeye",                    cal:680, p:62, c:0,  f:46},
          {name:"Quinoa Pilaf with Roasted Garlic (2 cups)", cal:440, p:16, c:78, f:8},
          {name:"Roasted Root Vegetables Medley",            cal:220, p:4,  c:44, f:4},
          {name:"Mass Gainer Shake (60g protein)",           cal:480, p:60, c:52, f:8},
        ]},
    ],
    5: [
      { id:"m1", label:"Meal 1 — Ignition Breakfast", time:"7:00 AM", emoji:"I",
        items:[
          {name:"4 Eggs Scrambled with Spinach",             cal:320, p:28, c:4,  f:22},
          {name:"Steel-Cut Oatmeal (1.5 cups) with Banana",  cal:340, p:10, c:64, f:5},
          {name:"Whole Milk Greek Yogurt (1 cup)",           cal:180, p:17, c:20, f:5},
        ]},
      { id:"m2", label:"Meal 2 — Mid-Morning Fuel", time:"10:00 AM", emoji:"II",
        items:[
          {name:"Mass Gainer Protein Shake (50g)",           cal:420, p:50, c:44, f:6},
          {name:"Mixed Nuts & Medjool Dates (1 handful)",    cal:280, p:6,  c:30, f:16},
        ]},
      { id:"m3", label:"Meal 3 — Elite Lunch", time:"1:00 PM", emoji:"III",
        items:[
          {name:"10 oz Grilled Chicken Breast",              cal:310, p:58, c:0,  f:7},
          {name:"Brown Rice (2 cups) with Herbs",            cal:360, p:8,  c:76, f:3},
          {name:"Steamed Broccoli & Whole Avocado",          cal:240, p:6,  c:18, f:16},
        ]},
      { id:"m4", label:"Meal 4 — Pre-Training Boost", time:"4:30 PM", emoji:"IV",
        items:[
          {name:"Peanut Butter Rice Cakes (3)",              cal:320, p:10, c:42, f:14},
          {name:"Cottage Cheese with Berries (1 cup)",       cal:200, p:24, c:18, f:4},
        ]},
      { id:"m5", label:"Meal 5 — Recovery Dinner", time:"7:30 PM", emoji:"V",
        items:[
          {name:"10 oz Grass-Fed Ribeye",                    cal:680, p:62, c:0,  f:46},
          {name:"Quinoa Pilaf (1.5 cups) with Garlic",       cal:330, p:12, c:58, f:6},
          {name:"Roasted Root Vegetables",                   cal:180, p:4,  c:36, f:3},
        ]},
    ],
    7: [
      { id:"m1", label:"Meal 1 — Wake-Up Protocol", time:"6:30 AM", emoji:"I",
        items:[
          {name:"3 Eggs Scrambled with Spinach",             cal:230, p:21, c:3,  f:15},
          {name:"Steel-Cut Oats (1 cup) with Honey",         cal:240, p:8,  c:48, f:4},
        ]},
      { id:"m2", label:"Meal 2 — Morning Stack", time:"9:00 AM", emoji:"II",
        items:[
          {name:"Mass Gainer Shake (40g protein)",           cal:380, p:40, c:40, f:5},
          {name:"Banana & Almond Butter",                    cal:270, p:6,  c:36, f:12},
        ]},
      { id:"m3", label:"Meal 3 — Midday Power", time:"12:00 PM", emoji:"III",
        items:[
          {name:"8 oz Chicken Breast, grilled",              cal:250, p:47, c:0,  f:6},
          {name:"Brown Rice (1.5 cups)",                     cal:270, p:6,  c:57, f:2},
          {name:"Mixed Greens & Olive Oil",                  cal:120, p:2,  c:8,  f:9},
        ]},
      { id:"m4", label:"Meal 4 — Afternoon Athlete", time:"3:00 PM", emoji:"IV",
        items:[
          {name:"Greek Yogurt Parfait & Granola",            cal:320, p:18, c:42, f:8},
          {name:"Mixed Nuts & Dried Fruit",                  cal:220, p:5,  c:22, f:13},
        ]},
      { id:"m5", label:"Meal 5 — Pre-Training", time:"5:30 PM", emoji:"💥",
        items:[
          {name:"Peanut Butter Rice Cakes (2)",              cal:215, p:7,  c:28, f:9},
          {name:"Whey Isolate Shake (30g)",                  cal:160, p:30, c:8,  f:2},
        ]},
      { id:"m6", label:"Meal 6 — Post-Training", time:"7:30 PM", emoji:"V",
        items:[
          {name:"10 oz Grass-Fed Ribeye",                    cal:680, p:62, c:0,  f:46},
          {name:"Quinoa Pilaf (1.5 cups)",                   cal:330, p:12, c:58, f:6},
          {name:"Steamed Asparagus & Broccoli",              cal:80,  p:6,  c:12, f:1},
        ]},
      { id:"m7", label:"Meal 7 — Night Recovery", time:"10:00 PM", emoji:"🌛",
        items:[
          {name:"Cottage Cheese (1 cup, slow protein)",      cal:180, p:24, c:10, f:5},
          {name:"Casein Protein Shake (30g)",                cal:160, p:30, c:6,  f:2},
        ]},
    ],
  },

  "Weight Loss": {
    3: [
      { id:"m1", label:"Meal 1 — Lean Breakfast", time:"7:30 AM", emoji:"I",
        items:[
          {name:"3 Egg White Omelette with Vegetables",      cal:180, p:22, c:8,  f:4},
          {name:"Steel-Cut Oats (¾ cup) with Blueberries",   cal:210, p:7,  c:40, f:3},
          {name:"Black Coffee or Green Tea",                 cal:5,   p:0,  c:1,  f:0},
        ]},
      { id:"m2", label:"Meal 2 — Performance Lunch", time:"12:30 PM", emoji:"III",
        items:[
          {name:"8 oz Wild Salmon, grilled",                 cal:330, p:46, c:0,  f:16},
          {name:"Large Arugula & Spinach Salad",             cal:60,  p:4,  c:8,  f:1},
          {name:"½ cup Brown Rice",                          cal:110, p:3,  c:22, f:1},
          {name:"Lemon-Herb Vinaigrette (1 tbsp)",           cal:45,  p:0,  c:2,  f:4},
        ]},
      { id:"m3", label:"Meal 3 — Lean Dinner", time:"7:00 PM", emoji:"V",
        items:[
          {name:"6 oz Turkey Breast, herb-crusted",          cal:195, p:36, c:0,  f:4},
          {name:"Cauliflower Rice Pilaf (2 cups)",           cal:110, p:4,  c:20, f:2},
          {name:"2 cups Steamed Vegetables",                 cal:80,  p:4,  c:16, f:0},
          {name:"Whey Isolate Shake (30g)",                  cal:160, p:30, c:8,  f:2},
        ]},
    ],
    5: [
      { id:"m1", label:"Meal 1 — Clean Start", time:"7:00 AM", emoji:"I",
        items:[
          {name:"3 Egg White Omelette with Peppers",         cal:150, p:20, c:6,  f:3},
          {name:"½ cup Steel-Cut Oats with Berries",         cal:175, p:6,  c:34, f:2},
        ]},
      { id:"m2", label:"Meal 2 — Mid-Morning", time:"10:00 AM", emoji:"II",
        items:[
          {name:"Apple with 1 tbsp Almond Butter",           cal:175, p:4,  c:26, f:8},
          {name:"Whey Isolate Shake (25g)",                  cal:130, p:25, c:5,  f:1},
        ]},
      { id:"m3", label:"Meal 3 — Precision Lunch", time:"1:00 PM", emoji:"III",
        items:[
          {name:"8 oz Grilled Wild Salmon",                  cal:330, p:46, c:0,  f:16},
          {name:"Large Mixed Greens Salad",                  cal:55,  p:3,  c:8,  f:1},
          {name:"½ cup Brown Rice",                          cal:110, p:3,  c:22, f:1},
        ]},
      { id:"m4", label:"Meal 4 — Afternoon Control", time:"4:00 PM", emoji:"IV",
        items:[
          {name:"Celery & Carrots with Hummus",              cal:120, p:4,  c:16, f:5},
          {name:"Cucumber Slices with Tzatziki",             cal:80,  p:4,  c:8,  f:3},
        ]},
      { id:"m5", label:"Meal 5 — Lean Dinner", time:"7:00 PM", emoji:"V",
        items:[
          {name:"6 oz Turkey Breast, herb-crusted",          cal:195, p:36, c:0,  f:4},
          {name:"Cauliflower Rice Pilaf",                    cal:110, p:4,  c:20, f:2},
          {name:"Steamed Broccoli & Zucchini",               cal:60,  p:4,  c:10, f:0},
        ]},
    ],
    7: [
      { id:"m1", label:"Meal 1 — Metabolic Ignite", time:"6:30 AM", emoji:"I",
        items:[
          {name:"2 Egg White Omelette + 1 Whole Egg",        cal:130, p:17, c:2,  f:5},
          {name:"Green Tea (no sugar)",                      cal:3,   p:0,  c:1,  f:0},
        ]},
      { id:"m2", label:"Meal 2 — Morning Control", time:"9:00 AM", emoji:"II",
        items:[
          {name:"½ cup Oats with Cinnamon",                  cal:155, p:5,  c:28, f:3},
          {name:"Whey Isolate (20g)",                        cal:105, p:20, c:3,  f:1},
        ]},
      { id:"m3", label:"Meal 3 — Lean Lunch", time:"12:00 PM", emoji:"III",
        items:[
          {name:"7 oz Grilled Salmon",                       cal:290, p:40, c:0,  f:14},
          {name:"Large Greens Salad with Lemon",             cal:55,  p:3,  c:8,  f:1},
        ]},
      { id:"m4", label:"Meal 4 — Afternoon Precision", time:"3:00 PM", emoji:"IV",
        items:[
          {name:"Apple + 1 tbsp Almond Butter",              cal:175, p:4,  c:26, f:8},
        ]},
      { id:"m5", label:"Meal 5 — Pre-Training", time:"5:30 PM", emoji:"💥",
        items:[
          {name:"Rice Cake with Turkey Slices",              cal:145, p:14, c:16, f:2},
          {name:"Whey Isolate Shake (25g)",                  cal:130, p:25, c:5,  f:1},
        ]},
      { id:"m6", label:"Meal 6 — Dinner", time:"7:30 PM", emoji:"V",
        items:[
          {name:"6 oz Turkey Breast",                        cal:195, p:36, c:0,  f:4},
          {name:"Cauliflower Rice (1.5 cups)",               cal:85,  p:3,  c:16, f:1},
          {name:"Steamed Vegetables",                        cal:60,  p:3,  c:10, f:0},
        ]},
      { id:"m7", label:"Meal 7 — Night Protocol", time:"9:30 PM", emoji:"🌛",
        items:[
          {name:"Nonfat Greek Yogurt (¾ cup)",               cal:100, p:15, c:9,  f:0},
          {name:"Cucumber Slices",                           cal:16,  p:1,  c:3,  f:0},
        ]},
    ],
  },

  "Weight Maintenance": {
    3: [
      { id:"m1", label:"Meal 1 — Balanced Breakfast", time:"7:30 AM", emoji:"I",
        items:[
          {name:"4 Eggs Any Style",                          cal:280, p:24, c:2,  f:20},
          {name:"1.5 cups Oatmeal with Honey",               cal:300, p:10, c:58, f:5},
          {name:"Mixed Fresh Berries",                       cal:70,  p:1,  c:16, f:0},
        ]},
      { id:"m2", label:"Meal 2 — Performance Lunch", time:"12:30 PM", emoji:"III",
        items:[
          {name:"10 oz Chicken or Salmon",                   cal:390, p:58, c:0,  f:16},
          {name:"1 cup Brown Rice or Quinoa",                cal:215, p:5,  c:44, f:2},
          {name:"Mixed Roasted Vegetables",                  cal:120, p:4,  c:22, f:3},
        ]},
      { id:"m3", label:"Meal 3 — Sustaining Dinner", time:"7:00 PM", emoji:"V",
        items:[
          {name:"8 oz Lean Protein of Choice",               cal:310, p:50, c:0,  f:11},
          {name:"Complex Carbohydrate (1.5 cups)",           cal:270, p:6,  c:56, f:2},
          {name:"2 cups Seasonal Vegetables",                cal:90,  p:4,  c:18, f:0},
          {name:"House Salad with Olive Oil",                cal:110, p:2,  c:8,  f:8},
        ]},
    ],
    5: [
      { id:"m1", label:"Meal 1 — Foundation Breakfast", time:"7:00 AM", emoji:"I",
        items:[
          {name:"4 Eggs Any Style",                          cal:280, p:24, c:2,  f:20},
          {name:"1 cup Oatmeal with Berries",                cal:230, p:8,  c:44, f:4},
        ]},
      { id:"m2", label:"Meal 2 — Mid-Morning", time:"10:00 AM", emoji:"II",
        items:[
          {name:"Protein Shake (40g)",                       cal:220, p:40, c:10, f:3},
          {name:"Handful Mixed Nuts",                        cal:180, p:5,  c:8,  f:16},
        ]},
      { id:"m3", label:"Meal 3 — Athlete Lunch", time:"1:00 PM", emoji:"III",
        items:[
          {name:"10 oz Chicken Breast",                      cal:310, p:58, c:0,  f:7},
          {name:"1 cup Brown Rice",                          cal:215, p:5,  c:44, f:2},
          {name:"Mixed Roasted Vegetables",                  cal:120, p:4,  c:22, f:3},
        ]},
      { id:"m4", label:"Meal 4 — Afternoon", time:"4:30 PM", emoji:"IV",
        items:[
          {name:"Seasonal Fruit",                            cal:90,  p:1,  c:22, f:0},
          {name:"Greek Yogurt (¾ cup)",                      cal:130, p:15, c:12, f:3},
        ]},
      { id:"m5", label:"Meal 5 — Balanced Dinner", time:"7:30 PM", emoji:"V",
        items:[
          {name:"8 oz Salmon or Lean Beef",                  cal:390, p:50, c:0,  f:20},
          {name:"Quinoa (1.5 cups)",                         cal:330, p:12, c:58, f:6},
          {name:"2 cups Seasonal Vegetables",                cal:90,  p:4,  c:18, f:0},
        ]},
    ],
    7: [
      { id:"m1", label:"Meal 1 — Rise Protocol", time:"6:30 AM", emoji:"I",
        items:[
          {name:"3 Eggs Scrambled",                          cal:210, p:18, c:2,  f:15},
          {name:"½ cup Oatmeal with Honey",                  cal:190, p:6,  c:36, f:3},
        ]},
      { id:"m2", label:"Meal 2 — Morning Fuel", time:"9:00 AM", emoji:"II",
        items:[
          {name:"Protein Shake (30g) + Banana",              cal:280, p:32, c:32, f:3},
        ]},
      { id:"m3", label:"Meal 3 — Midday", time:"12:00 PM", emoji:"III",
        items:[
          {name:"8 oz Chicken Breast",                       cal:250, p:47, c:0,  f:6},
          {name:"Brown Rice (1 cup)",                        cal:215, p:5,  c:44, f:2},
          {name:"Mixed Greens Salad",                        cal:55,  p:2,  c:8,  f:1},
        ]},
      { id:"m4", label:"Meal 4 — Afternoon", time:"3:00 PM", emoji:"IV",
        items:[
          {name:"Apple & Almond Butter",                     cal:175, p:4,  c:26, f:8},
        ]},
      { id:"m5", label:"Meal 5 — Pre-Training", time:"5:30 PM", emoji:"💥",
        items:[
          {name:"Rice Cakes (2) & Greek Yogurt",             cal:210, p:18, c:26, f:4},
        ]},
      { id:"m6", label:"Meal 6 — Dinner", time:"7:30 PM", emoji:"V",
        items:[
          {name:"8 oz Salmon",                               cal:390, p:46, c:0,  f:20},
          {name:"Quinoa (1 cup)",                            cal:220, p:8,  c:38, f:4},
          {name:"Steamed Vegetables",                        cal:80,  p:4,  c:14, f:0},
        ]},
      { id:"m7", label:"Meal 7 — Night", time:"9:30 PM", emoji:"🌛",
        items:[
          {name:"Casein or Greek Yogurt (1 cup)",            cal:180, p:24, c:14, f:4},
          {name:"Mixed Nuts (small handful)",                cal:120, p:3,  c:5,  f:10},
        ]},
    ],
  },
};

// ── 7-DAY VARIED MEAL PLANS ──────────────────────────────────
// Each day has unique meals for variety. Keyed by [mealType][mealFreq][dayIndex 0-6]
const WEEKLY_VARIETY = {
  // ── WEIGHT MAINTENANCE ─────────────────────────────────────
  "Weight Maintenance": {
    3: [
      // Mon — Full Body Strength
      [{label:"Breakfast",time:"7:30 AM",emoji:"I",items:[{name:"Smoked Salmon Eggs Benedict on Whole Grain",cal:480,p:34,c:32,f:22},{name:"Fresh Fruit Salad w/ Mint",cal:90,p:1,c:22,f:0}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Grilled Mahi-Mahi 10oz w/ Mango Salsa",cal:320,p:52,c:18,f:6},{name:"Cilantro Lime Brown Rice 1 cup",cal:215,p:5,c:44,f:2},{name:"Grilled Asparagus w/ Lemon Zest",cal:60,p:4,c:8,f:2}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Herb-Crusted Rack of Lamb 8oz",cal:420,p:48,c:0,f:24},{name:"Truffle Cauliflower Mash 1.5 cups",cal:130,p:5,c:22,f:4},{name:"Haricot Verts Almondine",cal:90,p:4,c:10,f:4}]}],
      // Tue — Cardio
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Acai Bowl w/ Granola, Banana & Honey",cal:420,p:12,c:72,f:10},{name:"2 Hardboiled Eggs",cal:140,p:12,c:1,f:10}]},
       {label:"Lunch",time:"12:30 PM",emoji:"III",items:[{name:"Korean BBQ Chicken Bowl 10oz",cal:380,p:52,c:24,f:10},{name:"Sesame Cucumber Noodle Salad",cal:120,p:4,c:18,f:4}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Wild Caught Halibut 8oz w/ Caper Butter",cal:310,p:46,c:0,f:12},{name:"Roasted Fingerling Potatoes 1 cup",cal:180,p:4,c:38,f:2},{name:"Sautéed Broccolini",cal:70,p:4,c:8,f:2}]}],
      // Wed — Strength Upper
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Chorizo & Egg Burrito (whole wheat)",cal:480,p:30,c:42,f:18},{name:"Pico de Gallo & Avocado",cal:100,p:2,c:8,f:7}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Grilled Chicken Caesar 10oz",cal:360,p:54,c:10,f:12},{name:"Quinoa & Roasted Pepper Salad",cal:220,p:8,c:40,f:4}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"NY Strip Steak 8oz w/ Chimichurri",cal:460,p:52,c:0,f:26},{name:"Roasted Sweet Potato Wedges",cal:180,p:4,c:38,f:2},{name:"Wilted Spinach w/ Garlic",cal:60,p:4,c:6,f:2}]}],
      // Thu — Strength Lower
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Overnight Oats w/ Chia, Almond Butter & Berries",cal:420,p:18,c:56,f:14},{name:"Collagen Coffee w/ MCT Oil",cal:80,p:8,c:0,f:6}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Shrimp & Avocado Grain Bowl",cal:380,p:36,c:36,f:12},{name:"Edamame & Wakame Side Salad",cal:120,p:8,c:10,f:4}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Bison Burger (no bun) 8oz",cal:380,p:48,c:0,f:20},{name:"Roasted Garlic Quinoa 1 cup",cal:220,p:8,c:38,f:4},{name:"Grilled Zucchini & Bell Pepper",cal:70,p:3,c:10,f:2}]}],
      // Fri — Cardio
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Shakshuka 3 Eggs w/ Feta & Sourdough",cal:420,p:26,c:36,f:18}]},
       {label:"Lunch",time:"12:30 PM",emoji:"III",items:[{name:"Vietnamese Pho Chicken 10oz",cal:340,p:46,c:28,f:8},{name:"Spring Rolls 2 (rice paper)",cal:140,p:6,c:24,f:3}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Atlantic Salmon 8oz w/ Dill & Caper",cal:390,p:46,c:0,f:20},{name:"Wild Rice Pilaf 1 cup",cal:220,p:6,c:44,f:2},{name:"Asparagus & Cherry Tomato Roast",cal:80,p:4,c:10,f:2}]}],
      // Sat — Active Recovery
      [{label:"Breakfast",time:"8:30 AM",emoji:"I",items:[{name:"Ricotta Pancakes 3 w/ Fresh Berries & Maple",cal:460,p:22,c:58,f:14},{name:"Turkey Bacon 3 strips",cal:105,p:12,c:0,f:6}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Mediterranean Mezze Plate: Falafel, Hummus, Pita",cal:440,p:18,c:58,f:14},{name:"Fattoush Salad",cal:120,p:4,c:18,f:4}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Lemon Herb Roast Chicken 10oz",cal:360,p:54,c:0,f:16},{name:"Rustic Roasted Vegetables 2 cups",cal:130,p:4,c:24,f:3},{name:"Pan Sauce & Fresh Herbs",cal:40,p:1,c:3,f:3}]}],
      // Sun — Rest
      [{label:"Brunch",time:"10:00 AM",emoji:"I",items:[{name:"Avocado Toast 2 slices w/ Poached Eggs & Microgreens",cal:440,p:22,c:36,f:22},{name:"Smoked Salmon 3oz",cal:100,p:16,c:0,f:4}]},
       {label:"Lunch",time:"2:00 PM",emoji:"III",items:[{name:"Thai Basil Tofu & Chicken Stir-fry 8oz",cal:320,p:40,c:18,f:10},{name:"Jasmine Rice ¾ cup",cal:160,p:3,c:35,f:0}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Slow-Braised Short Rib 8oz",cal:480,p:44,c:4,f:30},{name:"Cauliflower Gratin 1 cup",cal:160,p:6,c:14,f:9},{name:"Roasted Beets & Arugula",cal:80,p:2,c:14,f:2}]}],
    ],
    5: [
      // Mon
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Matcha Protein Smoothie Bowl w/ Granola",cal:360,p:28,c:44,f:10},{name:"2 Turkey Sausage Links",cal:120,p:14,c:0,f:7}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Whey Isolate Shake 35g + Creatine",cal:180,p:35,c:6,f:2},{name:"Handful Pistachios",cal:160,p:6,c:8,f:13}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Teriyaki Salmon Bowl 10oz",cal:420,p:48,c:28,f:14},{name:"Edamame & Pickled Ginger Side",cal:100,p:8,c:8,f:3}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Greek Yogurt 1 cup w/ Manuka Honey",cal:180,p:18,c:20,f:3}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Herb Butter Filet Mignon 7oz",cal:400,p:48,c:0,f:22},{name:"Roasted Garlic Asparagus",cal:60,p:4,c:8,f:2},{name:"Truffle Quinoa 1 cup",cal:220,p:8,c:38,f:4}]}],
      // Tue
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Southwest Scramble: 4 Eggs, Black Beans, Salsa",cal:380,p:30,c:28,f:16},{name:"Whole Grain Toast 1 slice",cal:80,p:3,c:15,f:1}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Banana & Almond Butter 2 tbsp",cal:270,p:6,c:36,f:12}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Thai Beef Salad 8oz w/ Lime Dressing",cal:360,p:44,c:12,f:14},{name:"Brown Rice ¾ cup",cal:160,p:4,c:34,f:1}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Cottage Cheese 1 cup & Fresh Peach",cal:190,p:24,c:18,f:4}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Sesame Ginger Mahi-Mahi 8oz",cal:300,p:46,c:8,f:8},{name:"Bok Choy & Mushroom Stir-fry",cal:80,p:4,c:10,f:3},{name:"Soba Noodles ¾ cup",cal:200,p:8,c:40,f:1}]}],
      // Wed
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Belgian Protein Waffle w/ Berries & Whipped Ricotta",cal:400,p:30,c:44,f:12}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Casein Pudding w/ Almonds & Cacao Nibs",cal:200,p:24,c:14,f:6}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Grilled Chicken Shawarma Bowl 10oz",cal:420,p:54,c:24,f:12},{name:"Tzatziki & Pita Chips",cal:140,p:6,c:18,f:5}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Apple & Cheddar w/ Walnuts",cal:220,p:8,c:24,f:11}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Pan-Seared Duck Breast 7oz",cal:380,p:44,c:0,f:22},{name:"Lentil & Roasted Veg Salad warm 1 cup",cal:200,p:10,c:32,f:4},{name:"Port Wine Reduction Sauce",cal:60,p:0,c:12,f:0}]}],
      // Thu
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Smoked Salmon Scramble 3 Eggs w/ Capers",cal:340,p:32,c:4,f:22},{name:"Rye Toast & Avocado ½",cal:200,p:4,c:20,f:12}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Whey + Collagen Shake 35g",cal:180,p:35,c:4,f:2},{name:"Brazil Nuts 6 pieces",cal:140,p:3,c:3,f:14}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Grilled Swordfish 10oz w/ Olive Tapenade",cal:360,p:52,c:2,f:16},{name:"Farro & Roasted Tomato Salad 1 cup",cal:220,p:8,c:42,f:3}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Medjool Dates 3 & Ricotta",cal:200,p:8,c:38,f:4}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Bison Meatballs w/ Marinara 8oz",cal:380,p:42,c:12,f:18},{name:"Zucchini Noodles 2 cups",cal:40,p:2,c:8,f:0},{name:"Parmesan & Fresh Basil",cal:60,p:4,c:0,f:4}]}],
      // Fri
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Peanut Butter Banana Overnight Oats",cal:400,p:18,c:56,f:12}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Protein Bar (20g+) & Espresso",cal:220,p:20,c:24,f:6}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Cajun Shrimp & Grits 8oz",cal:380,p:40,c:32,f:12},{name:"Collard Green Salad w/ Pecans",cal:120,p:4,c:10,f:8}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Mango Lassi Protein Smoothie",cal:220,p:20,c:28,f:4}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Herb-Crusted Salmon 8oz",cal:390,p:46,c:0,f:20},{name:"Roasted Rainbow Carrots & Fennel",cal:90,p:2,c:16,f:2},{name:"Lemon-Dill Quinoa 1 cup",cal:220,p:8,c:38,f:4}]}],
      // Sat
      [{label:"Breakfast",time:"8:00 AM",emoji:"I",items:[{name:"Eggs Florentine 2 w/ Hollandaise",cal:420,p:24,c:20,f:26},{name:"Smoked Turkey Hash 1 cup",cal:200,p:18,c:14,f:8}]},
       {label:"Mid-Morning",time:"10:30 AM",emoji:"II",items:[{name:"Fresh Pressed Green Juice + Collagen",cal:120,p:10,c:22,f:0}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Lamb Kofta Wrap 8oz w/ Harissa",cal:420,p:38,c:32,f:16},{name:"Tabbouleh 1 cup",cal:140,p:4,c:22,f:5}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Dark Chocolate 70% & Mixed Nuts",cal:200,p:5,c:16,f:14}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Grilled Lobster Tail 6oz w/ Drawn Butter",cal:280,p:32,c:0,f:16},{name:"Grilled Wagyu Burger 6oz",cal:360,p:36,c:0,f:24},{name:"Truffle Parmesan Fries baked",cal:220,p:6,c:36,f:7}]}],
      // Sun
      [{label:"Brunch",time:"10:00 AM",emoji:"I",items:[{name:"Crab Cake Eggs Benedict 2",cal:460,p:28,c:28,f:22},{name:"Fresh Melon & Berries",cal:80,p:1,c:20,f:0}]},
       {label:"Mid-Morning",time:"12:00 PM",emoji:"II",items:[{name:"Chamomile Protein Shake 30g",cal:160,p:30,c:6,f:2}]},
       {label:"Lunch",time:"2:30 PM",emoji:"III",items:[{name:"Roasted Chicken Thighs 10oz w/ Herbs de Provence",cal:380,p:46,c:0,f:20},{name:"Roasted Root Vegetable Medley",cal:160,p:4,c:34,f:2}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Coconut Yogurt & Passion Fruit",cal:160,p:8,c:22,f:6}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Slow Cooker Tuscan White Bean & Chicken 10oz",cal:360,p:44,c:28,f:8},{name:"Crusty Sourdough 1 slice",cal:120,p:4,c:22,f:1}]}],
    ],
    7: [
      // Mon
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Espresso + Collagen Peptides 10g",cal:50,p:9,c:0,f:0},{name:"Steel-Cut Oats ½ cup w/ Blueberries",cal:190,p:6,c:36,f:3}]},
       {label:"Morning Fuel",time:"8:30 AM",emoji:"II",items:[{name:"3 Egg White & Veggie Omelette",cal:150,p:22,c:6,f:4},{name:"Rye Toast 1 slice",cal:80,p:3,c:15,f:1}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Teriyaki Chicken Bowl 8oz",cal:360,p:46,c:28,f:8}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Whey Isolate 30g + Banana",cal:260,p:32,c:28,f:2}]},
       {label:"Pre-Training",time:"5:30 PM",emoji:"💥",items:[{name:"Rice Cakes 2 w/ Cashew Butter",cal:240,p:6,c:32,f:10}]},
       {label:"Post-Training",time:"7:30 PM",emoji:"V",items:[{name:"Grilled Salmon 7oz w/ Lemon Dill",cal:330,p:40,c:0,f:18},{name:"Quinoa 1 cup",cal:220,p:8,c:38,f:4}]},
       {label:"Night",time:"9:30 PM",emoji:"🌛",items:[{name:"Cottage Cheese ¾ cup & Walnuts",cal:190,p:22,c:10,f:8}]}],
      // Tue
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Matcha Latte w/ Oat Milk + Collagen",cal:80,p:8,c:8,f:2},{name:"Banana",cal:105,p:1,c:27,f:0}]},
       {label:"Morning Fuel",time:"8:30 AM",emoji:"II",items:[{name:"Greek Yogurt Bowl 1 cup w/ Granola",cal:280,p:18,c:36,f:6}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Bison & Veggie Stir-fry 8oz",cal:340,p:44,c:12,f:12},{name:"Brown Rice ¾ cup",cal:160,p:4,c:34,f:1}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Protein Bar & Green Tea",cal:200,p:20,c:22,f:5}]},
       {label:"Pre-Training",time:"5:30 PM",emoji:"💥",items:[{name:"Date Energy Balls 3 (homemade)",cal:180,p:5,c:32,f:6}]},
       {label:"Post-Training",time:"7:30 PM",emoji:"V",items:[{name:"Turkey Meatball Pasta 8oz",cal:440,p:42,c:44,f:10}]},
       {label:"Night",time:"9:30 PM",emoji:"🌛",items:[{name:"Casein Shake 30g",cal:160,p:30,c:6,f:2}]}],
      // Wed
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Cold Brew + MCT Oil",cal:60,p:0,c:0,f:7},{name:"Overnight Protein Oats ½ cup",cal:220,p:18,c:28,f:5}]},
       {label:"Morning Fuel",time:"8:30 AM",emoji:"II",items:[{name:"Smoked Turkey Avocado Toast 2 slices",cal:320,p:22,c:28,f:14}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Grilled Halibut 8oz w/ Mango Salsa",cal:300,p:46,c:16,f:6}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Whey Shake 30g & Apple",cal:230,p:31,c:24,f:2}]},
       {label:"Pre-Training",time:"5:30 PM",emoji:"💥",items:[{name:"Medjool Dates 3 & Almond Butter",cal:220,p:4,c:40,f:8}]},
       {label:"Post-Training",time:"7:30 PM",emoji:"V",items:[{name:"NY Strip 7oz w/ Garlic Herb Butter",cal:420,p:50,c:0,f:24},{name:"Roasted Broccoli & Sweet Potato",cal:160,p:5,c:30,f:2}]},
       {label:"Night",time:"9:30 PM",emoji:"🌛",items:[{name:"Greek Yogurt ¾ cup & Kiwi",cal:130,p:14,c:16,f:2}]}],
      // Thu
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Warm Lemon Water + Collagen 10g",cal:40,p:9,c:1,f:0},{name:"Oatmeal ½ cup w/ Chia Seeds",cal:200,p:8,c:36,f:5}]},
       {label:"Morning Fuel",time:"8:30 AM",emoji:"II",items:[{name:"Egg & Spinach Frittata 2 slices",cal:240,p:20,c:6,f:14}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Shrimp Taco Bowl 8oz",cal:360,p:38,c:28,f:12}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Collagen Latte & Almonds",cal:180,p:12,c:6,f:12}]},
       {label:"Pre-Training",time:"5:30 PM",emoji:"💥",items:[{name:"Whey + Dextrose Pre-Workout",cal:200,p:25,c:20,f:1}]},
       {label:"Post-Training",time:"7:30 PM",emoji:"V",items:[{name:"Herb Chicken Thighs 8oz",cal:340,p:44,c:0,f:18},{name:"Farro 1 cup & Roasted Tomatoes",cal:240,p:8,c:46,f:3}]},
       {label:"Night",time:"9:30 PM",emoji:"🌛",items:[{name:"Chamomile Tea & Casein 20g",cal:100,p:19,c:3,f:1}]}],
      // Fri
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Green Protein Smoothie: Spinach, Pea Protein, Banana",cal:240,p:22,c:34,f:3}]},
       {label:"Morning Fuel",time:"8:30 AM",emoji:"II",items:[{name:"Smoked Salmon Bagel Thin w/ Cream Cheese",cal:280,p:22,c:26,f:10}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Chicken & Quinoa Power Bowl 10oz",cal:420,p:52,c:32,f:10}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Fruit & Nut Bar Homemade",cal:190,p:6,c:28,f:8}]},
       {label:"Pre-Training",time:"5:30 PM",emoji:"💥",items:[{name:"Rice Cake w/ Honey & Sea Salt",cal:130,p:2,c:28,f:1}]},
       {label:"Post-Training",time:"7:30 PM",emoji:"V",items:[{name:"Grilled Swordfish 8oz w/ Salsa Verde",cal:340,p:50,c:4,f:14},{name:"Asparagus & Lemon 1 cup",cal:55,p:4,c:8,f:1}]},
       {label:"Night",time:"9:30 PM",emoji:"🌛",items:[{name:"Tart Cherry Juice 8oz + Magnesium",cal:120,p:0,c:28,f:0}]}],
      // Sat
      [{label:"Wake-Up",time:"7:30 AM",emoji:"I",items:[{name:"Protein French Toast 2 slices w/ Berries",cal:340,p:28,c:36,f:8}]},
       {label:"Morning Fuel",time:"10:00 AM",emoji:"II",items:[{name:"Collagen Coffee & Mixed Nuts",cal:180,p:12,c:4,f:14}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"BBQ Bison Ribs 8oz (slow cooked)",cal:400,p:44,c:8,f:20},{name:"Sweet Potato Salad 1 cup",cal:200,p:4,c:40,f:4}]},
       {label:"Afternoon",time:"3:30 PM",emoji:"IV",items:[{name:"Electrolyte Drink + Banana",cal:120,p:1,c:28,f:0}]},
       {label:"Pre-Training",time:"5:30 PM",emoji:"💥",items:[{name:"Pre-Workout Snack: Dates & Peanut Butter",cal:220,p:6,c:38,f:8}]},
       {label:"Post-Training",time:"7:30 PM",emoji:"V",items:[{name:"Surf & Turf: Shrimp 4oz + Filet 5oz",cal:420,p:56,c:0,f:20},{name:"Roasted Asparagus & Wild Mushrooms",cal:90,p:5,c:10,f:4}]},
       {label:"Night",time:"9:30 PM",emoji:"🌛",items:[{name:"Casein Pudding Bowl w/ Cacao",cal:180,p:28,c:12,f:4}]}],
      // Sun
      [{label:"Wake-Up",time:"8:30 AM",emoji:"I",items:[{name:"Açaí & Protein Smoothie Bowl",cal:360,p:24,c:48,f:10}]},
       {label:"Morning Fuel",time:"10:30 AM",emoji:"II",items:[{name:"Veggie Frittata 2 slices w/ Feta",cal:240,p:18,c:8,f:14}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Slow-Roasted Lamb Shoulder 8oz w/ Mint Gremolata",cal:420,p:48,c:2,f:24},{name:"Israeli Couscous & Roasted Veg 1 cup",cal:220,p:6,c:42,f:3}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Herbal Tea & Dark Chocolate 2 squares",cal:100,p:1,c:12,f:6}]},
       {label:"Pre-Dinner",time:"6:00 PM",emoji:"💥",items:[{name:"Bone Broth 1 cup + Collagen",cal:60,p:12,c:2,f:1}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Pistachio-Crusted Sea Bass 8oz",cal:360,p:46,c:8,f:16},{name:"Saffron Cauliflower Rice 1.5 cups",cal:100,p:4,c:16,f:2}]},
       {label:"Night",time:"9:30 PM",emoji:"🌛",items:[{name:"Magnesium Glycinate Drink & Casein",cal:120,p:18,c:6,f:2}]}],
    ],
  },

  // ── WEIGHT GAIN ─────────────────────────────────────────────
  "Weight Gain": {
    3: [
      [{label:"Breakfast",time:"7:30 AM",emoji:"I",items:[{name:"6-Egg Masala Omelette w/ Paneer",cal:540,p:44,c:10,f:34},{name:"Oatmeal 2 cups w/ Banana, Honey & Peanut Butter",cal:520,p:14,c:90,f:14}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Wagyu Beef Bowl 12oz w/ Chimichurri",cal:680,p:64,c:0,f:44},{name:"Brown Rice 2 cups w/ Herb Butter",cal:460,p:10,c:96,f:6},{name:"Roasted Cauliflower & Avocado",cal:240,p:5,c:18,f:18}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Rack of Lamb 12oz w/ Rosemary Jus",cal:720,p:70,c:0,f:46},{name:"Loaded Sweet Potato: Butter, Sour Cream",cal:380,p:7,c:66,f:12},{name:"Mass Gainer Shake 60g",cal:480,p:60,c:52,f:8}]}],
      [{label:"Breakfast",time:"7:30 AM",emoji:"I",items:[{name:"Steak & Egg Breakfast: 4oz Sirloin + 4 Eggs",cal:560,p:60,c:0,f:34},{name:"Hash Browns 1.5 cups",cal:300,p:5,c:54,f:10},{name:"Whole Milk 1 cup",cal:150,p:8,c:12,f:8}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Chicken Tikka Masala 12oz w/ Paneer",cal:620,p:58,c:24,f:32},{name:"Basmati Rice 2 cups",cal:420,p:8,c:90,f:2},{name:"Garlic Naan 2 pieces",cal:280,p:8,c:52,f:4}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Salmon Wellington 10oz w/ Dill Cream",cal:560,p:52,c:24,f:28},{name:"Truffle Mashed Potatoes 1.5 cups",cal:380,p:7,c:58,f:16},{name:"Mass Gainer 60g",cal:480,p:60,c:52,f:8}]}],
      [{label:"Breakfast",time:"7:30 AM",emoji:"I",items:[{name:"Protein Pancake Stack 5 w/ Bacon Maple",cal:680,p:44,c:72,f:22},{name:"Greek Yogurt 1 cup & Fresh Berries",cal:180,p:18,c:20,f:3}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Double Chicken Burrito Bowl 14oz",cal:720,p:64,c:68,f:18},{name:"Guacamole & Tortilla Chips 1 oz",cal:200,p:3,c:18,f:14}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Ribeye 12oz w/ Blue Cheese Butter",cal:800,p:72,c:0,f:54},{name:"Twice-Baked Potato w/ Cheese",cal:380,p:10,c:52,f:16},{name:"Mass Gainer 60g",cal:480,p:60,c:52,f:8}]}],
      [{label:"Breakfast",time:"7:30 AM",emoji:"I",items:[{name:"Eggs Benedict 3 w/ Canadian Bacon",cal:540,p:38,c:28,f:28},{name:"Home Fries 1.5 cups",cal:280,p:4,c:50,f:8},{name:"OJ Large",cal:140,p:2,c:34,f:0}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Korean BBQ Short Rib 12oz",cal:720,p:64,c:8,f:46},{name:"Japchae Noodles 1.5 cups",cal:320,p:8,c:60,f:6},{name:"Kimchi & Pickled Veg",cal:40,p:2,c:8,f:0}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Grilled Swordfish 10oz w/ Compound Butter",cal:420,p:56,c:0,f:22},{name:"Pasta Aglio e Olio 2 cups",cal:480,p:14,c:84,f:12},{name:"Mass Gainer 60g",cal:480,p:60,c:52,f:8}]}],
      [{label:"Breakfast",time:"7:30 AM",emoji:"I",items:[{name:"Full English Breakfast: 3 Eggs, Bacon, Sausage, Toast",cal:720,p:46,c:32,f:42}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Beef Tenderloin Sandwich 10oz w/ Aioli",cal:680,p:60,c:44,f:26},{name:"Sweet Potato Fries 1 cup",cal:240,p:4,c:48,f:6}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Chicken & Shrimp Pasta Carbonara 12oz",cal:720,p:62,c:60,f:26},{name:"Garlic Bread 2 slices",cal:200,p:5,c:28,f:8},{name:"Mass Gainer 60g",cal:480,p:60,c:52,f:8}]}],
      [{label:"Breakfast",time:"8:00 AM",emoji:"I",items:[{name:"Breakfast Burrito Massive: 5 Eggs, Steak, Cheese",cal:780,p:56,c:44,f:38}]},
       {label:"Lunch",time:"2:00 PM",emoji:"III",items:[{name:"BBQ Brisket 12oz Plate",cal:680,p:68,c:4,f:42},{name:"Cornbread 2 pieces & Coleslaw",cal:360,p:8,c:56,f:12}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Whole Lobster 2lb w/ Drawn Butter",cal:580,p:62,c:4,f:34},{name:"Loaded Baked Potato",cal:420,p:10,c:62,f:16},{name:"Mass Gainer 60g",cal:480,p:60,c:52,f:8}]}],
      [{label:"Brunch",time:"10:00 AM",emoji:"I",items:[{name:"Crab Omelette 4 Eggs w/ Béarnaise",cal:580,p:52,c:6,f:38},{name:"Brioche Toast 2 slices & Jam",cal:280,p:7,c:48,f:7}]},
       {label:"Lunch",time:"3:00 PM",emoji:"III",items:[{name:"Wagyu Burger Double Patty 12oz",cal:840,p:68,c:12,f:56},{name:"Truffle Parmesan Fries",cal:360,p:8,c:48,f:16}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Surf & Turf: 8oz Lobster + 8oz Filet",cal:720,p:84,c:0,f:38},{name:"Creamed Spinach & Truffle Mac",cal:440,p:14,c:46,f:22},{name:"Mass Gainer 60g",cal:480,p:60,c:52,f:8}]}],
    ],
    5: [
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"6 Egg Power Scramble w/ Steak Tips 4oz",cal:560,p:58,c:4,f:34},{name:"Steel-Cut Oats 1.5 cups w/ Honey",cal:340,p:10,c:64,f:5}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Mass Gainer 50g + Creatine",cal:420,p:50,c:44,f:6},{name:"Medjool Dates 4 & Mixed Nuts",cal:320,p:6,c:48,f:14}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Korean BBQ Chicken 12oz w/ Sesame",cal:440,p:66,c:12,f:14},{name:"Kimchi Fried Rice 1.5 cups",cal:380,p:10,c:72,f:8}]},
       {label:"Pre-Workout",time:"4:30 PM",emoji:"IV",items:[{name:"PB & Honey Rice Cakes 3",cal:360,p:10,c:50,f:14}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Ribeye 12oz w/ Herb Compound Butter",cal:780,p:72,c:0,f:52},{name:"Quinoa Pilaf 2 cups",cal:440,p:16,c:78,f:8},{name:"Roasted Root Veg",cal:180,p:4,c:38,f:2}]}],
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Protein Pancakes 4 w/ Whipped Ricotta",cal:520,p:36,c:60,f:14},{name:"Chicken Sausage Patties 3",cal:260,p:28,c:2,f:16}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Whole Milk Smoothie: Banana, PB, Oats, Whey",cal:620,p:40,c:72,f:18}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Pasta Bolognese 12oz Bison",cal:680,p:52,c:68,f:22},{name:"Caesar Salad large",cal:180,p:8,c:10,f:12}]},
       {label:"Pre-Workout",time:"4:30 PM",emoji:"IV",items:[{name:"Banana & Whey Isolate 40g",cal:300,p:42,c:28,f:2}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Smoked Brisket 12oz",cal:680,p:70,c:0,f:42},{name:"Sweet Potato Mash 1.5 cups",cal:300,p:6,c:66,f:2},{name:"Cornbread 1 piece",cal:180,p:4,c:28,f:6}]}],
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Egg & Chorizo Hash 5 Eggs",cal:580,p:44,c:18,f:36},{name:"Avocado Toast Whole Grain",cal:200,p:4,c:20,f:12}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Mass Gainer Shake 50g",cal:420,p:50,c:44,f:6},{name:"Peanut Butter Banana",cal:270,p:6,c:36,f:12}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Lamb Gyro Bowl 12oz",cal:560,p:56,c:28,f:24},{name:"Greek Salad w/ Feta",cal:160,p:6,c:10,f:11}]},
       {label:"Pre-Workout",time:"4:30 PM",emoji:"IV",items:[{name:"PB & Jelly Rice Cakes 3",cal:320,p:8,c:46,f:12}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Chilean Sea Bass 10oz w/ Miso Glaze",cal:440,p:54,c:12,f:20},{name:"Sushi Rice 1.5 cups",cal:320,p:6,c:70,f:0},{name:"Edamame 1 cup",cal:188,p:18,c:14,f:8}]}],
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Overnight French Toast Bake 3 slices",cal:560,p:30,c:66,f:18},{name:"Whey Shake 40g & Whole Milk",cal:340,p:44,c:14,f:10}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Trail Mix Power Blend 2oz",cal:320,p:8,c:32,f:18},{name:"Cottage Cheese 1 cup",cal:180,p:24,c:10,f:5}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Chicken Shawarma Wrap Double 12oz",cal:680,p:62,c:52,f:22}]},
       {label:"Pre-Workout",time:"4:30 PM",emoji:"IV",items:[{name:"Creatine + Dextrose + Banana Shake",cal:280,p:5,c:62,f:0}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Dry-Aged NY Strip 12oz",cal:760,p:72,c:0,f:50},{name:"Lobster Mac & Cheese 1 cup",cal:420,p:22,c:44,f:18}]}],
      [{label:"Breakfast",time:"6:30 AM",emoji:"I",items:[{name:"Smoked Salmon & Bagel w/ Full Cream Cheese",cal:520,p:36,c:52,f:18},{name:"3 Eggs Any Style",cal:210,p:18,c:2,f:15}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Whole Milk Mass Gainer 60g",cal:560,p:60,c:60,f:10}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"BBQ Pulled Pork Bowl 12oz",cal:620,p:56,c:36,f:24},{name:"Cornbread & Sweet Potato",cal:360,p:7,c:66,f:8}]},
       {label:"Pre-Workout",time:"4:30 PM",emoji:"IV",items:[{name:"Rice Cakes 3 & Honey & Almond Butter",cal:380,p:8,c:54,f:16}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Herb-Crusted Lamb Chops 12oz",cal:680,p:64,c:0,f:44},{name:"Roasted Garlic Mashed Potatoes 2 cups",cal:400,p:8,c:66,f:14}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Full Breakfast: 5 Eggs, Steak, Toast, Juice",cal:800,p:64,c:44,f:38}]},
       {label:"Mid-Morning",time:"10:30 AM",emoji:"II",items:[{name:"Mass Gainer Smoothie w/ Oats & Banana",cal:580,p:44,c:76,f:10}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Prime Rib Sandwich 12oz w/ Au Jus",cal:720,p:70,c:36,f:36}]},
       {label:"Pre-Workout",time:"4:30 PM",emoji:"IV",items:[{name:"Energy: Dates, Oats, Whey Ball 4 pieces",cal:400,p:20,c:58,f:10}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Porterhouse Steak 16oz",cal:960,p:88,c:0,f:64},{name:"Twice Baked Potato & Sour Cream",cal:400,p:10,c:58,f:16}]}],
      [{label:"Brunch",time:"10:00 AM",emoji:"I",items:[{name:"Wagyu Eggs Benedict 3 w/ Black Truffle",cal:720,p:48,c:28,f:44}]},
       {label:"Mid-Morning",time:"12:00 PM",emoji:"II",items:[{name:"Mass Gainer 50g & Whole Milk",cal:560,p:54,c:52,f:14}]},
       {label:"Lunch",time:"2:30 PM",emoji:"III",items:[{name:"Crab & Lobster Pasta 12oz w/ Cream Sauce",cal:680,p:52,c:58,f:24}]},
       {label:"Pre-Workout",time:"5:00 PM",emoji:"IV",items:[{name:"Banana PB Rice Cake Stack",cal:380,p:10,c:54,f:16}]},
       {label:"Dinner",time:"7:30 PM",emoji:"V",items:[{name:"Tomahawk Ribeye 16oz",cal:1000,p:88,c:0,f:68},{name:"Creamed Spinach & Truffle Mac 1 cup",cal:400,p:14,c:40,f:22}]}],
    ],
    7: [
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Mass Gainer Pre-Breakfast Shake 40g",cal:380,p:40,c:40,f:5},{name:"Banana",cal:105,p:1,c:27,f:0}]},
       {label:"Breakfast",time:"8:00 AM",emoji:"II",items:[{name:"6 Egg Cheese Omelette & Turkey Sausage 3",cal:520,p:50,c:4,f:32}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Double Chicken Breast 12oz Teriyaki",cal:440,p:70,c:16,f:8},{name:"Brown Rice 2 cups",cal:430,p:10,c:90,f:4}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Mass Gainer 40g & Almonds",cal:440,p:44,c:44,f:12}]},
       {label:"Pre-Workout",time:"5:30 PM",emoji:"💥",items:[{name:"PB Honey Rice Cakes 3",cal:360,p:10,c:50,f:14}]},
       {label:"Post-Workout",time:"7:30 PM",emoji:"V",items:[{name:"Ribeye 10oz",cal:680,p:62,c:0,f:46},{name:"Quinoa Pilaf 1.5 cups",cal:330,p:12,c:58,f:6}]},
       {label:"Night",time:"10:00 PM",emoji:"🌛",items:[{name:"Casein 30g & Whole Milk",cal:280,p:34,c:16,f:8}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Electrolyte + Mass Gainer 30g",cal:280,p:30,c:30,f:4}]},
       {label:"Breakfast",time:"8:00 AM",emoji:"II",items:[{name:"Protein Pancakes 5 w/ Berries & Syrup",cal:620,p:42,c:72,f:16}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Pasta Bolognese Bison 12oz",cal:680,p:52,c:68,f:22}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Trail Mix 2oz & Whole Milk Yogurt",cal:380,p:14,c:38,f:18}]},
       {label:"Pre-Workout",time:"5:30 PM",emoji:"💥",items:[{name:"Banana & Whey Isolate 40g",cal:300,p:42,c:28,f:2}]},
       {label:"Post-Workout",time:"7:30 PM",emoji:"V",items:[{name:"NY Strip 12oz w/ Garlic Butter",cal:720,p:68,c:0,f:46},{name:"Loaded Mashed Potatoes 1.5 cups",cal:380,p:8,c:52,f:16}]},
       {label:"Night",time:"10:00 PM",emoji:"🌛",items:[{name:"Cottage Cheese 1 cup & Pineapple",cal:220,p:26,c:22,f:4}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Mass Gainer Smoothie 40g",cal:380,p:40,c:40,f:5}]},
       {label:"Breakfast",time:"8:00 AM",emoji:"II",items:[{name:"Smoked Salmon Omelette 5 Eggs",cal:440,p:48,c:4,f:28},{name:"Avocado Toast 2 slices",cal:200,p:4,c:20,f:12}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Korean BBQ Beef Bowl 12oz",cal:560,p:60,c:24,f:24},{name:"Japchae 1 cup",cal:240,p:6,c:48,f:4}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"PB & Banana on Rice Cakes 2",cal:340,p:10,c:44,f:14}]},
       {label:"Pre-Workout",time:"5:30 PM",emoji:"💥",items:[{name:"Creatine + Dextrose + Electrolyte",cal:150,p:0,c:36,f:0}]},
       {label:"Post-Workout",time:"7:30 PM",emoji:"V",items:[{name:"Chilean Sea Bass 10oz Miso",cal:440,p:54,c:12,f:20},{name:"Sushi Rice 1.5 cups",cal:320,p:6,c:70,f:0}]},
       {label:"Night",time:"10:00 PM",emoji:"🌛",items:[{name:"Casein Pudding w/ Almonds",cal:240,p:28,c:16,f:8}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Whole Milk & Whey Shake 50g",cal:440,p:52,c:24,f:10}]},
       {label:"Breakfast",time:"8:00 AM",emoji:"II",items:[{name:"Steak & Egg Hash: 4oz Sirloin, 4 Eggs, Potatoes",cal:620,p:58,c:28,f:30}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"Lamb Kofta 12oz w/ Hummus & Pita",cal:640,p:56,c:40,f:26}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Mass Gainer 40g & Dates 4",cal:440,p:42,c:60,f:6}]},
       {label:"Pre-Workout",time:"5:30 PM",emoji:"💥",items:[{name:"Oatmeal Energy Ball 3 pieces",cal:240,p:8,c:36,f:8}]},
       {label:"Post-Workout",time:"7:30 PM",emoji:"V",items:[{name:"Wagyu Beef Strips 12oz",cal:720,p:68,c:0,f:48},{name:"Truffle Quinoa 1.5 cups",cal:330,p:12,c:58,f:6}]},
       {label:"Night",time:"10:00 PM",emoji:"🌛",items:[{name:"Whole Milk 2 cups & Casein 30g",cal:380,p:38,c:28,f:10}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Mass Gainer 40g + Creatine",cal:380,p:40,c:40,f:5}]},
       {label:"Breakfast",time:"8:00 AM",emoji:"II",items:[{name:"French Toast 4 slices w/ Eggs & Syrup",cal:640,p:32,c:80,f:20}]},
       {label:"Lunch",time:"12:00 PM",emoji:"III",items:[{name:"BBQ Pulled Pork 12oz",cal:560,p:56,c:20,f:28},{name:"Mac & Cheese 1 cup",cal:380,p:14,c:48,f:16}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"IV",items:[{name:"Smoothie: Whole Milk, Banana, Oats, PB, Whey",cal:560,p:36,c:66,f:16}]},
       {label:"Pre-Workout",time:"5:30 PM",emoji:"💥",items:[{name:"Rice Cakes 3 & Jam & PB",cal:340,p:8,c:52,f:12}]},
       {label:"Post-Workout",time:"7:30 PM",emoji:"V",items:[{name:"Herb Rack of Lamb 12oz",cal:720,p:68,c:0,f:46},{name:"Roasted Garlic Potato Gratin",cal:380,p:8,c:52,f:16}]},
       {label:"Night",time:"10:00 PM",emoji:"🌛",items:[{name:"Cottage Cheese 1.5 cups & Almonds",cal:300,p:34,c:14,f:12}]}],
      [{label:"Wake-Up",time:"7:00 AM",emoji:"I",items:[{name:"Whole Milk Mass Gainer 60g",cal:560,p:60,c:60,f:10}]},
       {label:"Breakfast",time:"9:00 AM",emoji:"II",items:[{name:"Full Breakfast: 5 Eggs, Bacon, Sausage, Toast, Beans",cal:780,p:52,c:44,f:38}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Smoked Brisket 12oz Plate",cal:680,p:68,c:4,f:42},{name:"Cornbread & Coleslaw",cal:300,p:6,c:46,f:10}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"PB Energy Balls 5 & Whole Milk",cal:480,p:20,c:52,f:20}]},
       {label:"Pre-Workout",time:"6:00 PM",emoji:"💥",items:[{name:"Pre-Workout Shake + Creatine",cal:120,p:5,c:24,f:0}]},
       {label:"Post-Workout",time:"7:30 PM",emoji:"V",items:[{name:"Surf & Turf: Lobster 6oz + Wagyu 8oz",cal:760,p:80,c:0,f:44}]},
       {label:"Night",time:"10:00 PM",emoji:"🌛",items:[{name:"Casein 30g + Whole Milk + PB",cal:380,p:36,c:20,f:16}]}],
      [{label:"Wake-Up",time:"8:00 AM",emoji:"I",items:[{name:"Mass Gainer Sunday Stack 60g",cal:560,p:60,c:60,f:10}]},
       {label:"Breakfast",time:"10:00 AM",emoji:"II",items:[{name:"Crab & Wagyu Eggs Benedict 3 w/ Truffle",cal:720,p:52,c:28,f:44}]},
       {label:"Lunch",time:"2:00 PM",emoji:"III",items:[{name:"Wagyu Burger Double 14oz Loaded",cal:900,p:76,c:20,f:58}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Mass Gainer Smoothie Tropical",cal:480,p:44,c:56,f:8}]},
       {label:"Pre-Workout",time:"6:00 PM",emoji:"💥",items:[{name:"Banana Stack & Honey",cal:180,p:2,c:44,f:0}]},
       {label:"Post-Workout",time:"7:30 PM",emoji:"V",items:[{name:"Tomahawk Ribeye 16oz",cal:1000,p:88,c:0,f:68},{name:"Creamed Spinach & Truffle Mac",cal:400,p:14,c:40,f:22}]},
       {label:"Night",time:"10:00 PM",emoji:"🌛",items:[{name:"Casein 40g + Whole Milk 2 cups",cal:440,p:44,c:30,f:12}]}],
    ],
  },

  // ── WEIGHT LOSS ─────────────────────────────────────────────
  "Weight Loss": {
    3: [
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Egg White Frittata 4 whites+1 whole w/ Roasted Veggies",cal:180,p:22,c:8,f:5},{name:"Blueberry Green Tea Smoothie",cal:110,p:4,c:22,f:1}]},
       {label:"Lunch",time:"12:30 PM",emoji:"III",items:[{name:"Grilled Wild Salmon 8oz w/ Herb Crust",cal:330,p:46,c:0,f:16},{name:"Shaved Fennel & Citrus Salad",cal:60,p:2,c:12,f:1},{name:"Steamed Broccolini",cal:40,p:3,c:6,f:0}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Turkey & Zucchini Meatballs 6oz",cal:210,p:28,c:6,f:9},{name:"Spiralized Zucchini w/ Marinara",cal:80,p:3,c:14,f:2},{name:"Whey Isolate Shake 25g",cal:130,p:25,c:5,f:1}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Smoked Salmon Avocado Egg White Bowl",cal:240,p:28,c:6,f:12}]},
       {label:"Lunch",time:"12:30 PM",emoji:"III",items:[{name:"Chicken Pho Soup 8oz",cal:260,p:38,c:16,f:5},{name:"Rice Paper Rolls 2 w/ Dipping Sauce",cal:120,p:6,c:18,f:2}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Herb-Baked Tilapia 7oz",cal:180,p:36,c:0,f:4},{name:"Cauliflower Rice Stir-fry 2 cups",cal:80,p:4,c:14,f:2},{name:"Whey Isolate 25g",cal:130,p:25,c:5,f:1}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Greek Yogurt Protein Bowl: Nonfat, Berries, Flax",cal:200,p:22,c:22,f:4}]},
       {label:"Lunch",time:"12:30 PM",emoji:"III",items:[{name:"Ahi Tuna Poke Bowl 7oz (no rice)",cal:220,p:38,c:8,f:5},{name:"Edamame & Cucumber Salad",cal:80,p:6,c:8,f:2}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Grilled Chicken Breast 6oz w/ Salsa Verde",cal:195,p:36,c:2,f:4},{name:"Roasted Asparagus & Cauliflower",cal:70,p:4,c:12,f:1},{name:"Whey Isolate 25g",cal:130,p:25,c:5,f:1}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Veggie Egg Muffins 4 (spinach, peppers, feta)",cal:200,p:20,c:6,f:10}]},
       {label:"Lunch",time:"12:30 PM",emoji:"III",items:[{name:"Shrimp & Avocado Lettuce Wraps 8oz",cal:220,p:38,c:6,f:7},{name:"Jicama Slaw w/ Lime",cal:60,p:1,c:12,f:0}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Baked Cod 7oz w/ Lemon Herb",cal:160,p:34,c:0,f:2},{name:"Roasted Brussels & Cauliflower Mash",cal:90,p:5,c:14,f:2},{name:"Whey Isolate 25g",cal:130,p:25,c:5,f:1}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Protein Smoothie: Spinach, Almond Milk, Pea Protein, Ginger",cal:200,p:22,c:18,f:4}]},
       {label:"Lunch",time:"12:30 PM",emoji:"III",items:[{name:"Turkey Breast & Arugula Wrap low-carb 8oz",cal:280,p:42,c:10,f:8}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Sea Bass 7oz w/ Tomato & Caper Sauce",cal:240,p:40,c:6,f:7},{name:"Steamed Vegetables Medley 2 cups",cal:70,p:4,c:12,f:1},{name:"Whey Isolate 25g",cal:130,p:25,c:5,f:1}]}],
      [{label:"Breakfast",time:"8:00 AM",emoji:"I",items:[{name:"Avocado & Smoked Salmon on 1 Slice Rye",cal:240,p:18,c:16,f:12}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Tuna Nicoise Salad 7oz (no potatoes)",cal:280,p:42,c:8,f:10}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Grilled Turkey Cutlet 6oz w/ Chimichurri",cal:200,p:36,c:2,f:5},{name:"Roasted Fennel & Zucchini",cal:60,p:2,c:10,f:2},{name:"Whey Isolate 25g",cal:130,p:25,c:5,f:1}]}],
      [{label:"Brunch",time:"10:00 AM",emoji:"I",items:[{name:"Shakshuka 2 Eggs in Spiced Tomato (no bread)",cal:200,p:14,c:16,f:8}]},
       {label:"Lunch",time:"2:00 PM",emoji:"III",items:[{name:"Grilled Salmon 7oz on Arugula & Radish",cal:320,p:40,c:4,f:16}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Herb Chicken 6oz & Steamed Broccoli",cal:220,p:40,c:8,f:4},{name:"Whey Isolate 25g",cal:130,p:25,c:5,f:1}]}],
    ],
    5: [
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"3 Egg White Omelette w/ Roasted Peppers & Feta",cal:160,p:22,c:6,f:5},{name:"½ cup Steel-Cut Oats w/ Cinnamon",cal:155,p:5,c:28,f:3}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Whey Isolate 25g & Cucumber Water",cal:130,p:25,c:5,f:1}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Ahi Tuna Poke Bowl 7oz over Cauliflower Rice",cal:280,p:40,c:12,f:8},{name:"Edamame ½ cup",cal:94,p:8,c:7,f:4}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Celery & Carrots w/ Tzatziki",cal:80,p:3,c:10,f:3}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Baked Lemon Herb Tilapia 7oz",cal:180,p:36,c:0,f:4},{name:"Roasted Broccoli & Asparagus",cal:70,p:5,c:10,f:2}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Greek Yogurt Parfait: Nonfat, Berries, Chia",cal:200,p:20,c:22,f:4}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Apple & 10 Almonds",cal:130,p:3,c:18,f:6}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Grilled Chicken Caesar 8oz (light dressing)",cal:300,p:48,c:8,f:8}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Protein Shake 20g Isolate & Water",cal:105,p:20,c:3,f:1}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Grilled Salmon 7oz w/ Dill",cal:290,p:40,c:0,f:14},{name:"Steamed Broccolini & Cauliflower",cal:60,p:4,c:10,f:1}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Veggie Smoothie: Kale, Cucumber, Protein, Ginger",cal:180,p:22,c:14,f:4}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Nonfat Cottage Cheese ½ cup & Strawberries",cal:100,p:14,c:8,f:1}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Shrimp Stir-fry 8oz w/ Vegetables, No Rice",cal:220,p:36,c:14,f:5}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Hard Boiled Eggs 2",cal:140,p:12,c:1,f:10}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Turkey Breast 6oz w/ Herb Crust",cal:195,p:36,c:0,f:4},{name:"Zucchini Noodles & Cherry Tomatoes",cal:60,p:3,c:10,f:1}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Egg White Muffins 3 w/ Sun-Dried Tomato",cal:160,p:18,c:6,f:6}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Whey Isolate 20g & Sparkling Water",cal:105,p:20,c:3,f:1}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Tuna Salad Stuffed Peppers 3 mini 7oz",cal:240,p:36,c:10,f:7}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Snap Peas & Hummus 2 tbsp",cal:100,p:4,c:12,f:4}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Baked Cod 7oz w/ Tomato Caper Sauce",cal:180,p:34,c:6,f:3},{name:"Roasted Cauliflower & Spinach",cal:70,p:4,c:10,f:2}]}],
      [{label:"Breakfast",time:"7:00 AM",emoji:"I",items:[{name:"Avocado & 2 Poached Eggs on Rye",cal:280,p:16,c:18,f:16}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"II",items:[{name:"Low-Sugar Protein Bar",cal:150,p:15,c:16,f:5}]},
       {label:"Lunch",time:"1:00 PM",emoji:"III",items:[{name:"Sashimi Plate 8oz (salmon, tuna, yellowtail)",cal:280,p:44,c:4,f:9}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Whey Isolate 20g & Matcha",cal:110,p:21,c:4,f:1}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Herb Chicken Thigh skinless 6oz",cal:195,p:36,c:0,f:5},{name:"Roasted Asparagus & Lemon",cal:44,p:3,c:7,f:1}]}],
      [{label:"Breakfast",time:"7:30 AM",emoji:"I",items:[{name:"Smoked Salmon Cucumber Rolls w/ Cream Cheese",cal:200,p:18,c:6,f:11}]},
       {label:"Mid-Morning",time:"10:30 AM",emoji:"II",items:[{name:"Nonfat Greek Yogurt ¾ cup",cal:100,p:15,c:9,f:0}]},
       {label:"Lunch",time:"1:30 PM",emoji:"III",items:[{name:"Grilled Sea Bass 7oz w/ Herb Oil",cal:240,p:40,c:0,f:9},{name:"Grilled Vegetable Stack",cal:80,p:3,c:12,f:2}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"IV",items:[{name:"Watermelon Cubes & Mint",cal:60,p:1,c:14,f:0}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Turkey Meatza (low carb pizza) 6oz",cal:220,p:28,c:8,f:9}]}],
      [{label:"Brunch",time:"10:00 AM",emoji:"I",items:[{name:"Superfood Protein Smoothie Bowl",cal:240,p:24,c:26,f:6}]},
       {label:"Mid-Morning",time:"12:00 PM",emoji:"II",items:[{name:"Whey Isolate 20g shake",cal:105,p:20,c:3,f:1}]},
       {label:"Lunch",time:"2:00 PM",emoji:"III",items:[{name:"Baked Salmon 7oz & Quinoa ½ cup",cal:340,p:42,c:22,f:12},{name:"Arugula Salad w/ Lemon",cal:40,p:2,c:6,f:1}]},
       {label:"Afternoon",time:"4:30 PM",emoji:"IV",items:[{name:"Mixed Berries 1 cup",cal:70,p:1,c:16,f:0}]},
       {label:"Dinner",time:"7:00 PM",emoji:"V",items:[{name:"Grilled Chicken 6oz & Steamed Veg",cal:210,p:38,c:10,f:4}]}],
    ],
    7: [
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Green Tea & Lemon Water",cal:5,p:0,c:1,f:0}]},
       {label:"Breakfast",time:"7:30 AM",emoji:"II",items:[{name:"2 Egg White + 1 Egg Scramble w/ Spinach",cal:130,p:17,c:2,f:5},{name:"½ cup Oats w/ Blueberries",cal:155,p:5,c:28,f:3}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"III",items:[{name:"Whey Isolate 20g",cal:105,p:20,c:3,f:1}]},
       {label:"Lunch",time:"12:30 PM",emoji:"IV",items:[{name:"Ahi Tuna Poke 7oz & Cucumber",cal:220,p:36,c:8,f:5}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"💥",items:[{name:"Apple & 8 Almonds",cal:120,p:3,c:18,f:5}]},
       {label:"Dinner",time:"6:00 PM",emoji:"V",items:[{name:"Grilled Salmon 7oz",cal:290,p:40,c:0,f:14},{name:"Steamed Broccoli 1.5 cups",cal:55,p:4,c:10,f:1}]},
       {label:"Night",time:"8:30 PM",emoji:"🌛",items:[{name:"Nonfat Greek Yogurt ½ cup",cal:65,p:10,c:6,f:0}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Warm Lemon Water & Collagen 5g",cal:25,p:4,c:1,f:0}]},
       {label:"Breakfast",time:"7:30 AM",emoji:"II",items:[{name:"Veggie Egg White Frittata slice",cal:120,p:16,c:4,f:4}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"III",items:[{name:"Cucumber Slices & Smoked Salmon 2oz",cal:90,p:12,c:2,f:4}]},
       {label:"Lunch",time:"12:30 PM",emoji:"IV",items:[{name:"Grilled Chicken 7oz & Arugula Bowl",cal:260,p:44,c:6,f:6}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"💥",items:[{name:"Whey Isolate 20g",cal:105,p:20,c:3,f:1}]},
       {label:"Dinner",time:"6:00 PM",emoji:"V",items:[{name:"Baked Cod 6oz w/ Lemon Caper",cal:160,p:30,c:2,f:3},{name:"Cauliflower Rice & Spinach",cal:60,p:3,c:10,f:1}]},
       {label:"Night",time:"8:30 PM",emoji:"🌛",items:[{name:"Herbal Tea & Casein 15g",cal:70,p:14,c:2,f:1}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Black Coffee & Electrolytes",cal:5,p:0,c:1,f:0}]},
       {label:"Breakfast",time:"7:30 AM",emoji:"II",items:[{name:"Smoked Salmon & Egg White Wrap",cal:200,p:26,c:8,f:7}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"III",items:[{name:"Low-Sugar Protein Bar",cal:150,p:15,c:16,f:5}]},
       {label:"Lunch",time:"12:30 PM",emoji:"IV",items:[{name:"Turkey Lettuce Wraps 6oz w/ Avocado",cal:220,p:32,c:6,f:9}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"💥",items:[{name:"Celery & Almond Butter 1 tbsp",cal:100,p:3,c:6,f:7}]},
       {label:"Dinner",time:"6:00 PM",emoji:"V",items:[{name:"Grilled Swordfish 7oz",cal:240,p:40,c:0,f:9},{name:"Roasted Asparagus 1 cup",cal:44,p:4,c:7,f:1}]},
       {label:"Night",time:"8:30 PM",emoji:"🌛",items:[{name:"Nonfat Cottage Cheese ½ cup",cal:80,p:12,c:5,f:1}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Matcha & Water",cal:10,p:1,c:1,f:0}]},
       {label:"Breakfast",time:"7:30 AM",emoji:"II",items:[{name:"Protein Smoothie: Kale, Ginger, Pea Protein",cal:180,p:22,c:14,f:4}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"III",items:[{name:"Hard Boiled Eggs 2",cal:140,p:12,c:1,f:10}]},
       {label:"Lunch",time:"12:30 PM",emoji:"IV",items:[{name:"Shrimp & Veggie Stir-fry 7oz",cal:180,p:28,c:10,f:4}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"💥",items:[{name:"Whey Isolate 20g & Sparkling Water",cal:105,p:20,c:3,f:1}]},
       {label:"Dinner",time:"6:00 PM",emoji:"V",items:[{name:"Herb Baked Chicken Breast 6oz",cal:195,p:36,c:0,f:4},{name:"Steamed Green Beans & Cauliflower",cal:55,p:3,c:9,f:1}]},
       {label:"Night",time:"8:30 PM",emoji:"🌛",items:[{name:"Chamomile Tea & Casein 15g",cal:70,p:14,c:2,f:1}]}],
      [{label:"Wake-Up",time:"6:00 AM",emoji:"I",items:[{name:"Sparkling Lemon Water",cal:5,p:0,c:1,f:0}]},
       {label:"Breakfast",time:"7:30 AM",emoji:"II",items:[{name:"Avocado & Egg White Toast 1 slice rye",cal:200,p:14,c:16,f:9}]},
       {label:"Mid-Morning",time:"10:00 AM",emoji:"III",items:[{name:"Whey Isolate Shake 20g",cal:105,p:20,c:3,f:1}]},
       {label:"Lunch",time:"12:30 PM",emoji:"IV",items:[{name:"Sashimi Plate 7oz w/ Ginger & Wasabi",cal:240,p:38,c:4,f:8}]},
       {label:"Afternoon",time:"3:00 PM",emoji:"💥",items:[{name:"Nonfat Greek Yogurt & Kiwi",cal:120,p:14,c:14,f:0}]},
       {label:"Dinner",time:"6:00 PM",emoji:"V",items:[{name:"Grilled Turkey Breast 6oz",cal:195,p:36,c:0,f:4},{name:"Roasted Broccoli & Carrots",cal:70,p:4,c:12,f:1}]},
       {label:"Night",time:"8:30 PM",emoji:"🌛",items:[{name:"Casein 15g & Cucumber",cal:75,p:14,c:3,f:1}]}],
      [{label:"Wake-Up",time:"7:00 AM",emoji:"I",items:[{name:"Green Detox Juice",cal:80,p:2,c:18,f:0}]},
       {label:"Breakfast",time:"8:30 AM",emoji:"II",items:[{name:"Smoked Salmon Cucumber Bites 3oz",cal:130,p:18,c:2,f:6}]},
       {label:"Mid-Morning",time:"10:30 AM",emoji:"III",items:[{name:"Whey Isolate 20g",cal:105,p:20,c:3,f:1}]},
       {label:"Lunch",time:"1:00 PM",emoji:"IV",items:[{name:"Grilled Sea Bass 7oz & Herb Salad",cal:240,p:40,c:4,f:8}]},
       {label:"Afternoon",time:"3:30 PM",emoji:"💥",items:[{name:"Watermelon & Mint",cal:60,p:1,c:14,f:0}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Turkey & Veggie Lettuce Boats 6oz",cal:200,p:30,c:8,f:6}]},
       {label:"Night",time:"9:00 PM",emoji:"🌛",items:[{name:"Tart Cherry Juice 4oz & Melatonin",cal:60,p:0,c:14,f:0}]}],
      [{label:"Wake-Up",time:"8:00 AM",emoji:"I",items:[{name:"Warm Lemon Ginger Water",cal:10,p:0,c:2,f:0}]},
       {label:"Breakfast",time:"9:30 AM",emoji:"II",items:[{name:"Superfood Smoothie Bowl: Acai, Protein, Berries",cal:220,p:20,c:26,f:5}]},
       {label:"Mid-Morning",time:"11:30 AM",emoji:"III",items:[{name:"Whey Isolate 20g",cal:105,p:20,c:3,f:1}]},
       {label:"Lunch",time:"1:30 PM",emoji:"IV",items:[{name:"Grilled Salmon 7oz & Quinoa ½ cup",cal:340,p:42,c:22,f:12}]},
       {label:"Afternoon",time:"4:00 PM",emoji:"💥",items:[{name:"Nonfat Greek Yogurt ½ cup",cal:65,p:10,c:6,f:0}]},
       {label:"Dinner",time:"6:30 PM",emoji:"V",items:[{name:"Herb Chicken 6oz & Steamed Veg",cal:210,p:38,c:10,f:4}]},
       {label:"Night",time:"9:00 PM",emoji:"🌛",items:[{name:"Chamomile Tea & Casein 15g",cal:70,p:14,c:2,f:1}]}],
    ],
  },
};

// ── MONTH-VARIED MEAL INDEX ───────────────────────────────────
// Rotates which day's variety plan maps to each day of week
// so meals differ month-to-month. Each month gets a unique offset.
// Prime multiplier ensures all 7 slots cycle before repeating.
function getMonthVariedIndex(dow, month) {
  const offsets = [0, 3, 1, 5, 2, 6, 4, 1, 5, 3, 6, 2]; // one per month Jan-Dec
  return (dow + offsets[month]) % 7;
}


// ── COMPREHENSIVE SPORT-SPECIFIC WORKOUT PROGRAMS ────────────
// Industry standard programs based on NSCA, CSCS, and sport science
// Structure: SPORT_WORKOUTS[sport][position][wkType][wkFocus]
// Each exercise: { name, sets, reps, rest, tempo, cues, muscles, load }

// ── SPORT/POSITION/INJURY-SPECIFIC RECOVERY PROTOCOLS ────────
// Based on NATA, APTA, and sports medicine clinical guidelines
// Structure: INJURY_PROTOCOLS[injuryName] → {phases, nutrition, pt, timeline, positionNotes}

const INJURY_PROTOCOLS = {

  // ════════════════════════════════════════════════════════════
  // UNIVERSAL INJURIES (appear across sports)
  // ════════════════════════════════════════════════════════════

  "ACL Tear": {
    fullName: "Anterior Cruciate Ligament Tear",
    severity: "Major — 9–12 months",
    surgeryRequired: "Usually — ACL Reconstruction (ACLR)",
    phases: [
      { ph:"Phase 1 — Immediate Post-Op", d:"Weeks 1–2", c:"#C0695E", items:[
        "PRICE: Protect, Rest, Ice (20min on/off), Compression, Elevation",
        "Crutches — non-weight bearing or toe-touch only",
        "Quad sets: tighten quad without moving knee — 3×30 reps daily",
        "Ankle pumps & straight leg raises to prevent blood clots",
        "Electrical stimulation (EMS) to quad — prevents muscle atrophy",
        "Swelling management: ice 6–8x daily, compression wrap",
        "Pain medication as prescribed — don't mask pain for exercise",
        "Sleep with leg elevated on 2 pillows — 24hrs",
      ]},
      { ph:"Phase 2 — Early Rehabilitation", d:"Weeks 3–6", c:"#9B8A3A", items:[
        "Partial weight bearing → full weight bearing with crutches",
        "Range of motion goal: 0–90° by week 4, 0–120° by week 6",
        "Seated knee extension (0–60° only — no full extension initially)",
        "Leg press (0–60°): light load, high reps — 3×20",
        "Stationary bike: low resistance, high seat — when 90° ROM achieved",
        "Hip abduction, adduction, extension with resistance bands",
        "Calf raises and hamstring curls — no knee load",
        "Balance: single-leg standing on stable surface 3×30sec",
      ]},
      { ph:"Phase 3 — Strength & Neuromuscular", d:"Months 3–6", c:"#3A6B9B", items:[
        "Leg press through full range: progressive loading 60–80% 1RM",
        "Lunges: bodyweight → weighted when pain-free",
        "Romanian Deadlift: hamstring strength critical for ACL protection",
        "Single-leg squat: bodyweight only until passing strength test",
        "Balance progression: stable → unstable surfaces (BOSU, foam)",
        "Bike → elliptical → pool running → treadmill walk → jog",
        "Sports agility: straight-line running when quad strength >70% symmetry",
        "Plyometric introduction: double-leg landing mechanics first",
      ]},
      { ph:"Phase 4 — Return to Sport", d:"Months 7–12", c:"#3A9B5A", items:[
        "Quad/hamstring symmetry must reach 90%+ before return",
        "Single-leg hop test: 90%+ limb symmetry index",
        "Full agility training: cuts, pivots, sport-specific drills",
        "Reactive agility and decision-making under fatigue",
        "Full practice participation without restriction",
        "Psychological clearance — fear of re-injury is common, address it",
        "Long-term: ACL re-tear risk remains elevated for 2 years — be cautious",
        "Preventive program (FIFA 11+, SPORTSMETRIC) ongoing after return",
      ]},
    ],
    nutrition: {
      acute: ["Protein 1.5–2.0g/lb to prevent muscle loss","Collagen 15g + Vitamin C 250mg 30min pre-PT","Tart Cherry Juice 8oz 2x/day — anti-inflammatory","Omega-3 3–4g/day — reduces post-surgical inflammation","Zinc 30mg — wound healing","Vitamin D3 5000IU — bone and muscle health"],
      recovery: ["Maintain caloric surplus if rebuilding muscle","Creatine 5g/day — dramatically reduces muscle loss during immobilization","Leucine-rich protein (whey) post-PT sessions","Turmeric/Curcumin 1500mg — joint inflammation","Magnesium Glycinate 400mg — sleep quality critical for healing"],
    },
    positionNotes: {
      "Quarterback": "Focus on non-throwing upper body maintenance. Return-to-throw protocol begins at Month 4. Mental preparation is critical.",
      "Running Back": "Highest re-tear risk position. Cutting/planting mechanics must be perfect before return. 12-month timeline recommended.",
      "Offensive Lineman": "Weight management critical — avoid gaining excessive fat. Pool-based conditioning from Week 3.",
      "Wide Receiver": "Sprint mechanics must be retrained — stride pattern changes after ACL. Add speed work at Month 8.",
      "Cornerback": "Backpedal and break mechanics testing required. Return only after passing reactive agility tests.",
      "Point Guard": "Crossover step and direction-change mechanics fully retested. Hardest position to return to after ACL.",
      "Center (Basketball)": "Post footwork and jump landing must be perfect before return. High re-injury risk with poor mechanics.",
      "Striker": "Cutting and shot mechanics fully assessed. FIFA 11+ prevention program mandatory on return.",
      "Goalkeeper": "Diving and lateral explosion movements tested last. Return 2 weeks after outfield players.",
    },
  },

  "MCL Sprain": {
    fullName: "Medial Collateral Ligament Sprain",
    severity: "Grade I: 1–2 weeks · Grade II: 4–8 weeks · Grade III: 8–12 weeks",
    surgeryRequired: "Rarely — conservative management preferred",
    phases: [
      { ph:"Phase 1 — Protection", d:"Days 1–7", c:"#C0695E", items:[
        "RICE Protocol aggressively — ice 20min every 2 hours",
        "Hinged knee brace — limits valgus stress on MCL",
        "Crutches for Grade II/III — offload medial compartment",
        "Straight leg raises and quad sets — maintain quad strength",
        "Grade I: gentle ROM within pain-free range immediately",
        "Grade II/III: ROM begins at Day 3–5 when swelling reduces",
        "No valgus stress — avoid crossing legs, pivoting, cutting",
        "NSAIDs (if no contraindications) for first 72 hours",
      ]},
      { ph:"Phase 2 — Strengthening", d:"Weeks 2–6", c:"#9B8A3A", items:[
        "Full weight-bearing when walking is pain-free",
        "Stationary bike: low resistance — ROM restoration",
        "Straight leg raises with progressive weight",
        "Hip abduction and adduction — dynamic MCL support",
        "Leg press: bilateral first, progressive to single-leg",
        "Step-ups and step-downs with controlled descent",
        "Pool walking/running when incision healed",
        "Target ROM: full extension and 120° flexion by Week 4",
      ]},
      { ph:"Phase 3 — Functional Return", d:"Weeks 6–12", c:"#3A9B5A", items:[
        "Jogging: straight-line only initially",
        "Progressive agility: figure-8, Z-drills, sport-specific",
        "Lateral movement: shuffles, cross-overs added week 8–10",
        "Brace: continue hinged brace for contact sports until Month 3",
        "Strength testing: leg press and single-leg squat symmetry >85%",
        "Full return: when all movements pain-free and strength restored",
        "Prevention: hip abductor strengthening ongoing — #1 MCL protection",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g + Vitamin C 250mg pre-PT","Omega-3 3g/day — ligament healing","Protein 1.2–1.5g/lb","Tart Cherry 8oz 2x/day"],
      recovery: ["Curcumin 1500mg — chronic inflammation","Zinc 30mg — connective tissue repair","Magnesium 400mg — muscle function"],
    },
    positionNotes: {
      "Offensive Lineman": "Bracing critical for return — MCL is highly vulnerable to block contact. Grade III: surgical consultation recommended.",
      "Defensive End": "Pass-rush plant mechanics must be retested. Lateral break step tested at Phase 3.",
      "Point Guard": "Crossover step mechanics tested. Lateral shuffle banded drill before full return.",
      "Center Back (Soccer)": "Heading challenges knee stability — add landing mechanics retraining.",
    },
  },

  "Hamstring Strain": {
    fullName: "Hamstring Muscle Strain (Biceps Femoris / Semimembranosus / Semitendinosus)",
    severity: "Grade I: 1–2 weeks · Grade II: 4–8 weeks · Grade III (tear): 3–6 months",
    surgeryRequired: "Only proximal avulsion (complete proximal tear) — rare",
    phases: [
      { ph:"Phase 1 — Acute Management", d:"Days 1–5", c:"#C0695E", items:[
        "PRICE: no ice directly on skin — wrap in cloth, 20min on/off",
        "NO stretching in first 48–72 hours — re-tears muscle fibers",
        "Active rest: walking only, no running, no hip flexion loading",
        "Isometric hamstring holds: prone, light contraction only",
        "Quad sets and ankle pumps — maintain circulation",
        "Grade II/III: crutches if walking is painful",
        "Compression shorts or hamstring sleeve 24hrs",
        "Sleep position: slight knee flexion reduces tension",
      ]},
      { ph:"Phase 2 — Graduated Loading", d:"Days 5–21", c:"#9B8A3A", items:[
        "Prone hamstring curl: extremely light — pain-free only",
        "Stiff-leg deadlift: bodyweight only, stop at first tightness",
        "Walking at increasing speeds — no running until pain-free walk",
        "Pool running: buoyancy reduces load — begins Day 7",
        "Bike: low resistance — gentle hamstring stimulus",
        "Nordic hamstring curl ECCENTRIC — begin at Week 3 (most evidence)",
        "Hip extension exercises: glute bridge progression",
        "Sprint mechanics drills: A-march, A-skip at slow speed",
      ]},
      { ph:"Phase 3 — Running Progression", d:"Weeks 3–8", c:"#3A6B9B", items:[
        "Jogging at 50% speed — completely pain-free",
        "Sprint progression: 60% → 75% → 90% → 100% over 2 weeks",
        "Nordic hamstring curl: full range, progressive load",
        "Sprint drills: A-skip, B-skip, bounds, wicket runs",
        "Change of direction: introduced at Week 6 when sprinting pain-free",
        "RETURN CRITERIA: sprint at 100% speed without pain or compensation",
        "High re-injury risk in first 8 weeks after return — be conservative",
        "Prevention: Nordic curls 2x/week ongoing — reduces re-injury 50%+",
      ]},
    ],
    nutrition: {
      acute: ["Protein 1.5g/lb urgently — muscle breakdown prevention","Collagen 15g + Vitamin C pre-PT — muscle fiber repair","Omega-3 3g/day","Tart Cherry 8oz 2x/day — reduces DOMS and inflammation","Adequate calories — muscle heals faster in slight surplus"],
      recovery: ["Creatine 5g/day — maintains muscle mass","BCAAs 5–10g pre/post session","Magnesium Glycinate — muscle cramp prevention","Curcumin 1500mg"],
    },
    positionNotes: {
      "Running Back": "Highest-risk position for hamstring re-tear. Return at 95% sprint speed minimum. Week 8 clearance recommended.",
      "Wide Receiver": "Route-running requires full sprint speed — 100% clearance mandatory. Test with 40-yard dash.",
      "Cornerback": "Back-pedal and break mechanics retested. Full sprint test before return.",
      "Winger (Soccer)": "Most common position for hamstring injury. Nordic program mandatory on return.",
      "Defensive Mid (Soccer)": "Long passing mechanics tested — hamstring activation different in kicking.",
      "Point Guard": "Drive acceleration tested — first step explosion requires pain-free hamstring.",
    },
  },

  "Rotator Cuff": {
    fullName: "Rotator Cuff Strain/Tear (Supraspinatus most common)",
    severity: "Partial tear: 6–12 weeks · Full tear: 4–6 months post-surgery",
    surgeryRequired: "Partial: usually no · Full thickness: arthroscopic repair recommended",
    phases: [
      { ph:"Phase 1 — Protection & Pain Control", d:"Weeks 1–4", c:"#C0695E", items:[
        "Sling immobilization — non-negotiable for surgical repair",
        "Ice 20min 4–6x daily for first 2 weeks",
        "Pendulum exercises: arm hangs free, small circles — gravity traction",
        "Elbow/wrist/hand ROM — prevent stiffness downstream",
        "Active-assisted shoulder elevation with other arm or pulley",
        "NO active shoulder movements against gravity — protects repair",
        "Scapular retraction and depression — no arm movement",
        "Sleep: semi-reclined position or on back — not on injured side",
      ]},
      { ph:"Phase 2 — Passive → Active ROM", d:"Weeks 4–12", c:"#9B8A3A", items:[
        "Active-assisted forward flexion to 90° — pain-free range",
        "External rotation with arm at side: towel roll under arm",
        "Isometric rotator cuff: press wall gently with forearm",
        "Side-lying external rotation: very light dumbbell (2–5lbs)",
        "Band external rotation: elbow at 90°, low resistance",
        "Sling discontinued typically Week 6 for daily activities",
        "Scapular stability: prone Y-T-W raises (no weight initially)",
        "Goal: 140° forward flexion, 40° external rotation by Week 8",
      ]},
      { ph:"Phase 3 — Strengthening", d:"Months 3–5", c:"#3A6B9B", items:[
        "Band external/internal rotation progressive resistance",
        "Prone Y, T, W raises with weight: 2.5→5→7.5lbs progression",
        "Side-lying external rotation: 5→10→15lbs over 6 weeks",
        "Lat pulldown: light weight, full ROM when pain-free",
        "Rows: face pulls and cable rows for rear deltoid/rhomboid",
        "Push-up: standard then weighted progressively",
        "Overhead press: LAST exercise introduced — high demand on cuff",
        "Serratus anterior: wall slides and push-up plus",
      ]},
      { ph:"Phase 4 — Sport Return", d:"Months 5–6+", c:"#3A9B5A", items:[
        "Throwing athletes: interval throwing program — long toss protocol",
        "QB: graduated throwing distance and velocity — Week by Week",
        "Volleyball: attack progression from set/tip → controlled spike → full power",
        "Full overhead strength testing before return to sport",
        "Return criteria: pain-free overhead ROM, strength 90% symmetry",
        "Ongoing: rotator cuff prehab 3x/week as prevention forever",
        "Modified mechanics review — technique change may reduce re-injury",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g + Vitamin C 250mg daily — tendon repair","Omega-3 4g/day — tendon healing and inflammation","Protein 1.2–1.5g/lb — prevent shoulder muscle atrophy","Vitamin D3 5000IU — musculoskeletal healing"],
      recovery: ["Curcumin 1500mg with BioPerine","Glycine 3g/day — collagen synthesis","Zinc 30mg","MSM 2–3g/day — joint health","Tart Cherry Extract — sleep quality for healing"],
    },
    positionNotes: {
      "Quarterback": "CAREER-CRITICAL. Non-throwing shoulder — accelerated protocol. Throwing shoulder — conservative. Biomechanics coach review mandatory on return.",
      "Wide Receiver": "Catch mechanics retested — high reach and contested catch movements tested last.",
      "Pitcher (general)": "Interval throwing program is strictly graduated. No shortcuts. 6-month minimum for full-thickness repair.",
      "Outside Hitter (Volleyball)": "Attack arm injury. Approach and arm-swing mechanics fully retrained. Swing speed built back gradually over 4 weeks.",
      "Setter (Volleyball)": "Setting motion tested early — lower shoulder load than attacking. Return to setting before blocking.",
    },
  },

  "Concussion": {
    fullName: "Traumatic Brain Injury / Concussion",
    severity: "Days to months — highly variable. Requires medical clearance.",
    surgeryRequired: "No — but neurological monitoring essential",
    phases: [
      { ph:"Phase 1 — Complete Rest", d:"24–48 hours post-injury", c:"#C0695E", items:[
        "ABSOLUTE REST — no screens, no reading, no bright lights",
        "Dark, quiet room for minimum 24 hours",
        "Sleep is the primary healer — do not disrupt",
        "Monitor for red flags: vomiting, severe headache, seizure → ER immediately",
        "No pain medications containing aspirin or ibuprofen (increases bleeding risk)",
        "Hydration: water only — no caffeine, no alcohol",
        "No driving, no sports, no school/work",
        "Symptom tracking every 6 hours — use SCAT5 scale",
      ]},
      { ph:"Phase 2 — Symptom-Limited Activity", d:"Days 3–7 (symptom-free)", c:"#9B8A3A", items:[
        "Light aerobic only — walk 10–15 min if no symptoms",
        "No resistance training — blood pressure increase worsens symptoms",
        "Neck strengthening: isometric holds (neck protects against future concussions)",
        "Vestibular rehab if dizziness present — specialist referral",
        "Cognitive rest: limit screens to 30min max — symptoms worsen with cognitive load",
        "Return to school/work gradually with accommodations first",
        "Sleep: 9–10 hours — sleep deprivation is enemy of concussion recovery",
        "No contact, no high-speed movement whatsoever",
      ]},
      { ph:"Phase 3 — Graduated Exertion", d:"Week 2+ (symptom-free)", c:"#3A6B9B", items:[
        "Step 1: Light aerobic (bike, walk) — no symptoms during or 24hrs after",
        "Step 2: Sport-specific exercise (no contact) — running, agility",
        "Step 3: Non-contact drills — full training intensity but no contact",
        "Step 4: Full contact practice — medical clearance required",
        "Step 5: Return to game — full clearance",
        "EACH STEP = minimum 24 hours. Symptoms → restart from Step 1",
        "Neuropsychological testing (ImPACT) — must return to baseline scores",
        "Second Impact Syndrome: second concussion before recovery = potentially fatal",
      ]},
      { ph:"Phase 4 — Clearance & Prevention", d:"Full return", c:"#3A9B5A", items:[
        "Written medical clearance from licensed physician mandatory",
        "Helmet fit reassessment — improper fit increases risk",
        "Neck strength training ongoing — stronger neck = less brain movement on impact",
        "Rule changes awareness — targeting rules, blocking rules",
        "History documentation — third concussion in career warrants serious discussion",
        "Post-concussion syndrome: symptoms >4 weeks require specialist referral",
        "Omega-3 supplementation — evidence suggests neuroprotective effect long-term",
      ]},
    ],
    nutrition: {
      acute: ["Omega-3 DHA 2–3g/day — primary brain anti-inflammatory","Creatine 5g/day — neuroprotective, improves cerebral energy","Magnesium Glycinate 400mg — reduces excitotoxicity","Blueberry/Antioxidant foods — reduce oxidative stress","Adequate hydration — brain is 75% water","NO alcohol — delays recovery significantly"],
      recovery: ["Continue Omega-3 for 3 months minimum","Zinc 30mg — neurotransmitter support","Vitamin D3 5000IU — neuroprotection","B-Complex vitamins — neural repair","Choline 500mg — acetylcholine synthesis for cognitive recovery"],
    },
    positionNotes: {
      "Quarterback": "Film study and cognitive processing tested before return. Decision-making speed critical.",
      "Linebacker": "Most vulnerable position. Third concussion warrants serious career conversation with medical staff.",
      "Defensive End": "Helmet-to-helmet contact mechanics review. Consider position adjustment if recurring.",
      "Center (Hockey)": "Faceoff position increases exposure. Neck strength program is non-negotiable.",
    },
  },

  "Ankle Sprain": {
    fullName: "Lateral Ankle Sprain (ATFL most common)",
    severity: "Grade I: 3–7 days · Grade II: 2–4 weeks · Grade III: 4–8 weeks",
    surgeryRequired: "Rarely — Grade III chronic instability may require Brostrom repair",
    phases: [
      { ph:"Phase 1 — POLICE Protocol", d:"Days 1–4", c:"#C0695E", items:[
        "P — Protection: ankle brace or taping, no barefoot walking",
        "OL — Optimal Loading: controlled weight-bearing as tolerated (not complete rest)",
        "I — Ice: 20min on/off, 6–8x daily — reduces swelling fastest",
        "C — Compression: elastic bandage figure-8 wrap 24hrs",
        "E — Elevation: foot above heart level when sitting/lying",
        "Alphabet ROM: trace alphabet with foot — maintains motion",
        "Calf raises: seated, pain-free — maintains Achilles health",
        "NO: forced inversion/eversion, hot tub, alcohol — all increase swelling",
      ]},
      { ph:"Phase 2 — Restoration", d:"Days 4–14", c:"#9B8A3A", items:[
        "Progressive weight-bearing: heel-toe gait pattern",
        "Resistance band eversion/dorsiflexion — peroneal strengthening",
        "Single-leg balance: eyes open 30sec → eyes closed 30sec",
        "Calf raises: standing, progressive load — prevents re-sprain",
        "Bike: low resistance, pain-free range",
        "Pool: water walking, buoyancy protects ankle",
        "Target: walk without limp before progressing",
        "BOSU balance board: gradual wobble progression",
      ]},
      { ph:"Phase 3 — Functional Return", d:"Weeks 2–6", c:"#3A9B5A", items:[
        "Jogging: straight-line only at first",
        "Agility ladder: controlled foot placement",
        "Lateral shuffles: week 3–4 when jogging pain-free",
        "Ankle brace or taping: continue for sport-return — up to 6 months",
        "Jump landing mechanics: two-foot → one-foot",
        "Sport-specific cutting: 45° then 90° then pivot",
        "Return criteria: hop test 90%+ symmetry, no pain, full ROM",
        "Prevention: proprioception training 3x/week — reduces re-sprain 70%",
      ]},
    ],
    nutrition: {
      acute: ["Bromelain (Pineapple enzyme) 500mg — reduces swelling","Collagen 15g + Vitamin C — ligament repair","Omega-3 3g/day","Tart Cherry 8oz — anti-inflammatory"],
      recovery: ["Zinc 30mg — tissue healing","Magnesium 400mg","Vitamin C 1000mg — collagen synthesis","Adequate protein 1g/lb"],
    },
    positionNotes: {
      "Wide Receiver": "Route-breaking and planting mechanics fully tested. Turf cleats vs grass cleats adjusted based on surface.",
      "Point Guard": "Crossover plant mechanics must be pain-free. Ankle brace for rest of season recommended.",
      "Cornerback": "Back-pedal break mechanics — most demanding ankle test. Return only when pass on all hop tests.",
      "Winger (Soccer)": "Cutting at speed tested in controlled environment. Cleat type reviewed.",
      "Libero (Volleyball)": "Dive and dig landing mechanics retested. Court-specific footwear assessed.",
    },
  },

  "Turf Toe": {
    fullName: "First MTP Joint Sprain (Plantar Plate / Hallux Valgus Mechanism)",
    severity: "Grade I: 3–14 days · Grade II: 2–6 weeks · Grade III: 6–12 weeks",
    surgeryRequired: "Grade III with instability: possible",
    phases: [
      { ph:"Phase 1 — Immobilization", d:"Days 1–7", c:"#C0695E", items:[
        "Stiff-soled shoe or walking boot — prevents big toe extension",
        "Toe taping: buddy tape to second toe, limit extension",
        "Ice 20min every 2–3 hours — significant swelling expected",
        "Crutches for Grade II/III: non-weight-bearing first 48hrs",
        "Elevation constantly when at rest",
        "NSAIDs as directed — joint inflammation responds well",
        "No push-off activities — this is the mechanism of injury",
        "Custom orthotics consultation for prevention on return",
      ]},
      { ph:"Phase 2 — ROM & Strength", d:"Weeks 2–6", c:"#9B8A3A", items:[
        "Gentle passive MTP extension: manually assist — pain-free range",
        "Towel scrunches: intrinsic foot strength",
        "Calf raises: progressive loading when toe extension pain-free",
        "Pool running: avoids push-off on hard surface",
        "Bike: low resistance — clip shoe avoids toe extension",
        "Avoid hills and stairs — increase big toe dorsiflexion stress",
        "Goal: 40° passive extension before return to sport",
        "Carbon fiber foot plate in shoe — reduces extension during sport",
      ]},
      { ph:"Phase 3 — Return to Play", d:"Weeks 6–12", c:"#3A9B5A", items:[
        "Straight-line running: heel-toe pattern first",
        "Cutting and pivoting: added progressively when pain-free",
        "Stiff-soled cleat: mandatory — avoid flexible cleats (accelerates injury)",
        "Tape every practice and game — ongoing",
        "Carbon fiber insert in all shoes — reduces risk of re-injury",
        "Return criteria: push-off pain-free at full speed",
        "High re-injury risk: turf toe becomes chronic without proper management",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g/day — plantar plate healing","Omega-3 3g/day","Bromelain 500mg — joint swelling","Vitamin C 1000mg"],
      recovery: ["MSM 2g/day — joint health","Glucosamine 1500mg — MTP joint cartilage","Zinc 30mg"],
    },
    positionNotes: {
      "Wide Receiver": "Route breaks require full push-off. Most impactful injury at this position. Full 6-week minimum recovery.",
      "Running Back": "Cutting and acceleration require big toe — 8-week conservative approach recommended.",
      "Defensive End": "Pass-rush first step requires full toe extension — do not rush return.",
    },
  },

  "Shoulder Dislocation": {
    fullName: "Glenohumeral Joint Dislocation (Anterior most common — 95%)",
    severity: "First-time: 6–12 weeks conservative · Recurrent: surgical stabilization",
    surgeryRequired: "First time: often no · Athletes under 25 with recurrence: Latarjet or Bankart repair recommended",
    phases: [
      { ph:"Phase 1 — Reduction & Protection", d:"Weeks 1–3", c:"#C0695E", items:[
        "Immediate reduction by medical professional — do not attempt yourself",
        "Sling immobilization: 3 weeks for first-time dislocation",
        "Ice: 20min on/off for 48–72 hours post-reduction",
        "Elbow, wrist, hand ROM to prevent stiffness",
        "Isometric rotator cuff: very gentle, sling on",
        "X-ray mandatory — rule out Hill-Sachs lesion, Bankart lesion",
        "NO: shoulder movement outside sling during Phase 1",
        "Shoulder stabilizer muscles begin neurological re-education",
      ]},
      { ph:"Phase 2 — Controlled Mobility", d:"Weeks 3–8", c:"#9B8A3A", items:[
        "Pendulum exercises: free-hanging, small circles",
        "Active-assisted forward flexion to 90°",
        "External rotation: arm at side only — NOT to end range initially",
        "Scapular stabilization: retraction, depression, push-up plus",
        "Isometric shoulder exercises in all planes",
        "Rotator cuff band work: ER/IR at side, low resistance",
        "Avoid: combined abduction + external rotation (apprehension position)",
        "Goal: full passive ROM by Week 8",
      ]},
      { ph:"Phase 3 — Strengthening & Stability", d:"Months 2–4", c:"#3A6B9B", items:[
        "Prone Y-T-W: progressive from no weight → 5lbs",
        "Lat pulldown and rows: build posterior capsule strength",
        "Push-up progression: wall → incline → floor → weighted",
        "Overhead press: introduced Month 3 when fully pain-free",
        "Sleeper stretch: posterior capsule tightness prevention",
        "Dynamic stability: ball-throwing against wall, increasing force",
        "Proprioception: closed-chain weight-shifting on unstable surfaces",
        "Avoid high external-rotation positions until Month 4",
      ]},
      { ph:"Phase 4 — Sport Return", d:"Months 4–6", c:"#3A9B5A", items:[
        "Contact sports: dynamic stabilization testing required",
        "Throwing athletes: interval throwing program — start 50ft, build to 90ft",
        "Sport-specific impact drills: progressive loading",
        "Recurrence prevention: continued rotator cuff maintenance forever",
        "High recurrence risk in young athletes: 70–80% re-dislocate without surgery",
        "Consider surgical stabilization if second dislocation occurs",
        "Shoulder brace: optional for contact sports return",
      ]},
    ],
    nutrition: {
      acute: ["Protein 1.5g/lb — shoulder muscle mass critical for stability","Collagen 15g daily — capsule and labrum support","Omega-3 4g/day","Vitamin D3 5000IU"],
      recovery: ["Magnesium — muscle function","Zinc 30mg — tissue healing","Creatine 5g/day — upper body muscle preservation","Curcumin 1500mg — chronic joint inflammation"],
    },
    positionNotes: {
      "Quarterback": "Throwing shoulder dislocation: career-altering. Bankart repair strongly recommended for any recurrence. Non-throwing side: more conservative.",
      "Wide Receiver": "Contested catch situations re-trained. Arm position in traffic reviewed with coach.",
      "Defensive End": "Pass-rush hand fighting mechanics reviewed. Surgical stabilization recommended for any recurrence.",
      "Outside Hitter (Volleyball)": "Arm-swing mechanics retrained. Attack approach sequencing reviewed.",
      "Goalkeeper (Soccer)": "Diving technique reviewed and modified if anterior position caused dislocation.",
    },
  },

  "Patellar Tendinitis": {
    fullName: "Patellar Tendinopathy / Jumper's Knee",
    severity: "Mild: 4–8 weeks · Moderate: 3–6 months · Chronic: 6–12 months",
    surgeryRequired: "Rarely — PRP injection or dry needling before considering surgery",
    phases: [
      { ph:"Phase 1 — Load Management", d:"Weeks 1–4", c:"#C0695E", items:[
        "REDUCE jumping volume 50–80% — not complete rest (worsens tendons)",
        "Isometric quad holds: 5×45sec at 60° bend — immediate pain relief",
        "Ice: 20min AFTER activity — not before (need tissue warm for loading)",
        "Tendon loading: heavy and slow — NOT explosive",
        "Identify and reduce aggravating movements: stairs, kneeling, jumping",
        "Patellar tendon strap: below kneecap — reduces tendon load",
        "Decline squat: 25° board, slow 4-count descent — #1 evidence-based treatment",
        "Avoid: stretching patellar tendon — worsens tendinopathy",
      ]},
      { ph:"Phase 2 — Tendon Loading", d:"Weeks 4–12", c:"#9B8A3A", items:[
        "Heavy slow resistance: leg press, squat, leg extension — 3×15, 3×12, 3×8 over weeks",
        "Decline squat progression: bodyweight → 10kg vest → 20kg vest",
        "No jumping — tendon needs compressive load tolerance first",
        "Pool running: cardiovascular without ground reaction force",
        "Bike: low resistance — minimal tendon load",
        "Total volume management: track weekly jump counts and reduce 20%",
        "Insert heel lift: 1cm heel raise in shoe — reduces tendon tension",
        "Monitor: Victorian Institute of Sport Assessment (VISA-P) score weekly",
      ]},
      { ph:"Phase 3 — Energy Storage", d:"Months 3–5", c:"#3A6B9B", items:[
        "Plyometric reintroduction: double-leg calf raises → skipping → bounding",
        "Box jumps: double leg, low height (6in) → progressive",
        "Sport-specific jump volumes: begin at 20% of normal",
        "Eccentric single-leg decline squat → reactive drop squats",
        "Pain monitoring: 3/10 during and MUST return to 0/10 within 24hrs",
        "Continue heavy slow loading 2x/week permanently",
        "KinésioCal: sport-specific activity grading system",
      ]},
      { ph:"Phase 4 — Full Sport Return", d:"Months 5–9", c:"#3A9B5A", items:[
        "Full jump volume with 0/10 pain during and after",
        "Reactive jumps: depth jumps, approach jumps, spike approaches",
        "Return criteria: VISA-P score >80/100",
        "Preventive loading: heavy slow resistance TWICE per week for life",
        "Volume management: track and periodize jump counts season-long",
        "PRP injection: consider if not responding by Month 6",
        "High recurrence: patellar tendinopathy has 30% annual recurrence without ongoing loading",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g + Vitamin C 30min pre-loading session — tendon repair evidence","Omega-3 4g/day — tendinopathy is partly inflammatory","Avoid: excess omega-6 oils (vegetable oil) — worsen tendon inflammation","Protein 1.2–1.5g/lb — maintain muscle without excessive load"],
      recovery: ["Curcumin 1500mg with BioPerine","Glycine 3–5g/day — collagen synthesis","MSM 2g/day — joint and tendon support","Vitamin D3 5000IU — tendon health"],
    },
    positionNotes: {
      "Middle Blocker (Volleyball)": "Highest-risk position. Block jump volume tracked and reduced. Consider position modification if chronic.",
      "Outside Hitter (Volleyball)": "Attack approach modified: softer landing mechanics. Floor type assessed — hard floors worsen tendinopathy.",
      "Point Guard": "Drive acceleration loads tendon. Crossover step mechanics modified to reduce knee-dominant loading.",
      "Center (Basketball)": "Post moves require explosive knee extension — progressive return ladder monitored.",
      "Striker (Soccer)": "Shooting mechanics reviewed — knee extension velocity in shooting loads tendon.",
    },
  },

  "Hip Flexor": {
    fullName: "Hip Flexor Strain (Iliopsoas / Rectus Femoris)",
    severity: "Grade I: 1–2 weeks · Grade II: 3–6 weeks · Grade III: 2–3 months",
    surgeryRequired: "Very rarely",
    phases: [
      { ph:"Phase 1 — Acute Management", d:"Days 1–7", c:"#C0695E", items:[
        "Rest from hip flexion loading — no sprinting, no kicking",
        "Ice: 20min on/off, anterior hip/groin region",
        "Gentle isometric: hip flexion against resistance at 0° (neutral)",
        "NO stretching hip flexors — tears fibers further in acute phase",
        "Walking: shortened stride, avoid knee drive",
        "Prone lying (hip extension): reduces hip flexor tension",
        "Side-lying hip abduction: non-painful hip strengthening",
        "Compression shorts: reduce swelling and support",
      ]},
      { ph:"Phase 2 — Strengthening", d:"Weeks 2–4", c:"#9B8A3A", items:[
        "Banded hip flexion: standing, light resistance",
        "Step-ups: gradual knee drive loading",
        "Bike: progressive resistance, pain-free",
        "Lunge: short stride, pain-free range — no deep hip extension yet",
        "Gentle hip flexor stretch: only when pain-free at Week 3+",
        "Core stability: dead bug, plank variations — no crunch",
        "Pool jogging: buoyancy reduces hip flexor demands",
        "A-march: drill — progressive speed",
      ]},
      { ph:"Phase 3 — Return to Sport", d:"Weeks 4–8", c:"#3A9B5A", items:[
        "Running progression: 50% → 75% → 100% speed",
        "Sprint mechanics drills: A-skip, B-skip, bounds",
        "Kicking reintroduction: slow-speed kicks → power progressively",
        "Hip flexor stretch: now full range — twice daily",
        "Return criteria: pain-free sprint and kick at full speed",
        "Prevention: hip flexor strengthening 2x/week ongoing",
        "Psoas release: massage/foam roll before training",
      ]},
    ],
    nutrition: {
      acute: ["Protein 1.2–1.5g/lb — muscle preservation","Collagen 15g daily","Omega-3 3g/day","Tart Cherry 8oz 2x/day"],
      recovery: ["Magnesium Glycinate 400mg — muscle spasm and cramp","Curcumin 1500mg","Zinc 30mg"],
    },
    positionNotes: {
      "Quarterback": "Drop-back footwork demands hip flexors. Retraining footwork mechanics during return.",
      "Striker (Soccer)": "Kicking mechanics reviewed — driving leg hip flexor most vulnerable.",
      "Running Back": "Knee drive acceleration requires full hip flexor. Sprint testing mandatory before return.",
    },
  },

  "Groin Strain": {
    fullName: "Adductor Muscle Strain (Adductor Longus most common)",
    severity: "Grade I: 1–2 weeks · Grade II: 3–8 weeks · Grade III: 2–4 months",
    surgeryRequired: "Rarely — chronic athletic pubalgia may require",
    phases: [
      { ph:"Phase 1 — Protection", d:"Days 1–7", c:"#C0695E", items:[
        "Rest from lateral movement and kicking immediately",
        "Ice: 20min every 2–3 hours, inner thigh",
        "Compression shorts or bandage: 24hr wear",
        "Crutches for Grade II/III: offload adductors",
        "Gentle isometric adductor squeeze: between knees — light",
        "NO: stretching (counter-intuitive but proven — worsens Grade I/II)",
        "Bike: low resistance, upright position — small ROM",
        "MRI: recommended for Grade III — rules out pubic bone stress",
      ]},
      { ph:"Phase 2 — Progressive Loading", d:"Weeks 2–6", c:"#9B8A3A", items:[
        "Copenhagen adductor exercise: knee on bench, side plank — begin light",
        "Adductor squeeze progressive: ball between knees, increasing force",
        "Lateral lunge: bodyweight, pain-free range of motion",
        "Side-lying hip adduction with ankle weight",
        "Lateral shuffle: slow, controlled — short range",
        "Pool: water jogging, lateral movement buoyed",
        "Hip abductor strength: critical balance — weak abductors = adductor overload",
        "Core stability: groin injury often includes core dysfunction",
      ]},
      { ph:"Phase 3 — Return to Sport", d:"Weeks 6–12", c:"#3A9B5A", items:[
        "Straight-line jogging → lateral movement → cutting → kicking",
        "Copenhagen plank: full load — most validated prevention exercise",
        "Sprint at 100%: test before return — compensated running worsens",
        "Kicking power: build progressively over 2 weeks",
        "Return criteria: pain-free kicking, full lateral movement",
        "Prevention: Copenhagen 2x/week reduced adductor injuries 31% in RCT",
        "High re-injury risk: do not rush Grade II return",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g + Vitamin C","Omega-3 3g/day","Tart Cherry 8oz 2x/day","Protein 1.2–1.5g/lb"],
      recovery: ["Magnesium Glycinate — muscle healing","Curcumin 1500mg","Zinc 30mg"],
    },
    positionNotes: {
      "Full Back (Soccer)": "Lateral pressing and overlapping runs — most exposed position. Return only at 100%.",
      "Defenseman (Hockey)": "Skating stride heavily loads adductors. Skating mechanics reviewed on return.",
      "Center (Hockey)": "Faceoff crouch position stresses groin. Faceoff mechanics modified if recurring.",
    },
  },

  "Knee Tendinitis": {
    fullName: "Patellar or Quadriceps Tendinopathy",
    severity: "4–12 weeks conservative · Chronic: 3–12 months",
    surgeryRequired: "Rarely",
    phases: [
      { ph:"Phase 1 — Load Reduction", d:"Weeks 1–3", c:"#C0695E", items:[
        "Identify and reduce: stairs, hills, jumping, kneeling",
        "Isometric quad hold: 5×45sec at 60° — provides immediate pain relief",
        "Patellar strap: reduces tendon load during activity",
        "NOT complete rest — tendons need load but managed load",
        "Ice after activity — not before",
        "Decline squat: 25° board, 4-count descent — evidence-based treatment",
      ]},
      { ph:"Phase 2 — Heavy Slow Resistance", d:"Weeks 3–8", c:"#9B8A3A", items:[
        "Leg press: 3×15 → 3×12 → 3×8 over weeks — heavy, slow",
        "Decline squat: progressive loading with vest",
        "Knee extension: heavy, full ROM, controlled",
        "No plyometrics — tendon needs compressive tolerance first",
        "Bike and swim: cardiovascular without impact",
        "Heel raise in shoe: 1cm insert reduces tendon tension",
      ]},
      { ph:"Phase 3 — Return to Full Load", d:"Weeks 8–16", c:"#3A9B5A", items:[
        "Plyometric reintroduction: progressive volume management",
        "Sport-specific: track jump counts and increase 10% per week",
        "Pain rule: 3/10 max during, 0/10 within 24hrs after",
        "Heavy slow loading: 2x/week permanently — prevents recurrence",
        "PRP: if not responding after 12 weeks",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g + Vitamin C pre-loading","Omega-3 4g/day","Avoid excess omega-6","Curcumin 1500mg"],
      recovery: ["Glycine 3g/day","MSM 2g/day","Vitamin D3 5000IU","Protein 1.2g/lb"],
    },
    positionNotes: {
      "Middle Blocker (Volleyball)": "Block count tracked. Hard floor — add knee sleeve and assess footwear.",
      "Power Forward (Basketball)": "Post play and rebounding load managed. Low-box work introduced first.",
    },
  },

  "Shin Splints": {
    fullName: "Medial Tibial Stress Syndrome (MTSS)",
    severity: "4–8 weeks · Stress fracture variant: 8–12 weeks with boot",
    surgeryRequired: "No — but compartment syndrome is a surgical emergency",
    phases: [
      { ph:"Phase 1 — Unload", d:"Weeks 1–3", c:"#C0695E", items:[
        "STOP running — every run worsens the injury",
        "Pool running and bike: maintain fitness pain-free",
        "Bone scan or MRI if not improving at 2 weeks — rule out stress fracture",
        "Ice: 20min after any weight-bearing activity",
        "Calf stretching: soleus and gastrocnemius — 3× daily",
        "Arch support: custom orthotics or over-counter insert — reduces tibial stress",
        "Assess footwear: running shoe should be <400 miles old",
        "Reduce training volume: this is an overuse injury — gradual increase needed",
      ]},
      { ph:"Phase 2 — Gradual Return", d:"Weeks 3–6", c:"#9B8A3A", items:[
        "Walk pain-free before running",
        "Return-to-run protocol: run/walk intervals 3x/week",
        "Calf strengthening: single-leg raises — reduces tibial loading",
        "Hip abductor strengthening: reduces tibial torque",
        "Run-walk: 1min run/1min walk → 2min run → 5min run progression",
        "Surface: grass or track — avoid concrete initially",
        "Tibial bone loading: impact should increase no more than 10% per week",
      ]},
      { ph:"Phase 3 — Full Return", d:"Weeks 6–10", c:"#3A9B5A", items:[
        "Continuous run: 20min without pain",
        "Sport-specific cutting and agility: progressive",
        "Full training return when 45min continuous run pain-free",
        "Prevention: calf program ongoing, 10% training increase rule",
        "Check: footwear, surface, weekly mileage — all three",
      ]},
    ],
    nutrition: {
      acute: ["Calcium 1000–1500mg/day — bone healing","Vitamin D3 5000IU — calcium absorption","Protein 1.2g/lb — bone matrix","Collagen 15g — periosteum repair"],
      recovery: ["Omega-3 3g/day","Magnesium — bone density","Zinc 30mg"],
    },
    positionNotes: {
      "Full Back (Soccer)": "Highest mileage position — return requires strict 10% rule. Footwear on natural vs turf assessed.",
      "Defensive Mid (Soccer)": "Volume management — track weekly sprint distances.",
    },
  },

  "Achilles Strain": {
    fullName: "Achilles Tendinopathy / Partial Tear",
    severity: "Tendinopathy: 6–12 weeks · Partial tear: 3–6 months · Full rupture: 6–12 months",
    surgeryRequired: "Full rupture: surgery vs conservative — evidence mixed but surgery preferred for athletes",
    phases: [
      { ph:"Phase 1 — Load Management", d:"Weeks 1–4", c:"#C0695E", items:[
        "Heel raise (1.5–2cm) in shoe — reduces Achilles tension immediately",
        "Eccentric calf raises: straight-leg on step — lower only (eccentric)",
        "NO: barefoot walking, flip-flops — increase Achilles load",
        "Ice: 20min after loading — not before",
        "Avoid: stretching acutely — tendons respond to load not stretch",
        "Bike: low resistance — Achilles loads minimally in pedaling",
        "Achilles tendon monitoring: pain >5/10 = too much load",
        "For rupture: boot immobilization Week 1–2, strict protocol",
      ]},
      { ph:"Phase 2 — Progressive Tendon Loading", d:"Weeks 4–12", c:"#9B8A3A", items:[
        "Heavy slow calf raise: seated (soleus) and standing (gastroc)",
        "Progression: 3×15 → 3×12 → 3×8 → add weight",
        "Single-leg calf raise: off step edge, full ROM",
        "Straight-line jogging: when calf raise 25+ reps pain-free",
        "Pool jogging: 3–4x/week supplemental conditioning",
        "Footwear: 10–12mm heel-to-toe drop (avoid minimalist shoes)",
        "Tendon stiffness in morning: expected — not an indicator of day's activity",
      ]},
      { ph:"Phase 3 — Plyometric Return", d:"Months 3–6", c:"#3A9B5A", items:[
        "Double-leg calf jump → single-leg jump → progressive",
        "Hopping: straight → lateral → sport-specific",
        "Sprint: slow build from jogging — Achilles loads 8x bodyweight at sprint",
        "Return criteria: single-leg calf raise 25+ reps, pain-free sprint",
        "Prevention: calf loading program 2x/week for career",
        "Full rupture return: 9–12 months minimum — no shortcuts",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g + Vitamin C 250mg pre-loading — most evidence for tendon injury","Omega-3 4g/day","Glycine 3g/day","Avoid omega-6 excess"],
      recovery: ["MSM 2g/day","Curcumin 1500mg","Vitamin D3 5000IU","Protein 1.2g/lb — calf mass restoration"],
    },
    positionNotes: {
      "Running Back": "Achilles rupture is career-altering. Return to cutting speed requires 12-month minimum for full tear.",
      "Wide Receiver": "Sprint speed restoration is key metric — test with 40-yard dash.",
      "Striker (Soccer)": "Shooting power requires full calf function. Load testing before return to shooting.",
    },
  },

  "Back Spasm": {
    fullName: "Lumbar Muscle Spasm / Lower Back Strain",
    severity: "Acute: 3–7 days · Chronic recurrence: ongoing management",
    surgeryRequired: "No — disc herniation may require if neurological symptoms present",
    phases: [
      { ph:"Phase 1 — Acute Relief", d:"Days 1–5", c:"#C0695E", items:[
        "Active rest: walking helps more than bed rest — move gently",
        "Ice first 48hrs: then heat for muscle spasm relief",
        "Positional relief: lying on side with pillow between knees",
        "Diaphragmatic breathing: relaxes paraspinals",
        "Knee-to-chest stretch: gentle — only if no nerve symptoms",
        "Cat-cow: gentle lumbar mobility",
        "AVOID: forward bending with load, prolonged sitting",
        "Red flags requiring ER: bowel/bladder changes, bilateral leg numbness",
      ]},
      { ph:"Phase 2 — Core Activation", d:"Days 5–21", c:"#9B8A3A", items:[
        "Dead bug: spine neutral, alternate arm-leg extension",
        "Bird dog: opposite arm-leg on all fours",
        "Glute bridge: activates glutes to offload lumbar",
        "McGill Big 3: curl-up, side plank, bird-dog — spine stability",
        "Pool therapy: water reduces spinal load 80%",
        "Walking: progress from 15min → 30min → 45min",
        "NO: sit-ups, crunches, deadlifts during Phase 2",
        "Hip flexor stretch: tight hip flexors increase lumbar lordosis",
      ]},
      { ph:"Phase 3 — Strength & Return", d:"Weeks 3–8", c:"#3A9B5A", items:[
        "Deadlift: Romanian → conventional with perfect form — start light",
        "Squat: goblet → barbell — spine neutral mandatory",
        "Plank progression: standard → weighted → dynamic",
        "Sport-specific movements: rotation, extension, landing",
        "Return to sport: when pain-free through full range of motion",
        "Prevention: McGill Big 3 daily, hip mobility work, deadlift form perfection",
        "Recurring spasms: MRI to rule out disc pathology",
      ]},
    ],
    nutrition: {
      acute: ["Magnesium Glycinate 400–600mg — muscle spasm direct relief","Omega-3 3g/day — disc and muscle inflammation","Turmeric 1000mg","Adequate hydration — discs are 80% water"],
      recovery: ["Vitamin D3 5000IU — back pain linked to deficiency","Protein 1.2g/lb — paraspinal muscle rebuilding","Collagen 15g — disc health"],
    },
    positionNotes: {
      "Offensive Lineman": "Heavy lifting demands neutral spine mastery. Deadlift and squat form reviewed before return to heavy loads.",
      "Quarterback": "Rotational demands — thoracic mobility and lumbar stability both needed. Throwing mechanics reviewed.",
      "Goalkeeper (Soccer)": "Diving mechanics reviewed. Lumbar rotation loading in goal kicks assessed.",
    },
  },

  "Finger Dislocation": {
    fullName: "Proximal Interphalangeal (PIP) Joint Dislocation",
    severity: "3–6 weeks for basic function · 3 months for full sport return",
    surgeryRequired: "Volar plate avulsion fracture: sometimes",
    phases: [
      { ph:"Phase 1 — Reduction & Splinting", d:"Weeks 1–3", c:"#C0695E", items:[
        "Reduction by medical professional — immediate",
        "Buddy taping to adjacent finger for 3–6 weeks",
        "Extension block splint: prevents full extension (protects volar plate)",
        "Active flexion: bend finger gently within splint comfort",
        "X-ray mandatory: rule out associated fracture",
        "Ice: 20min on/off for first 72 hours",
        "Elevation: hand above heart when possible",
      ]},
      { ph:"Phase 2 — ROM & Strength", d:"Weeks 3–8", c:"#9B8A3A", items:[
        "Gentle active extension: progressive, pain-free",
        "Putty grip exercises: strengthens intrinsic hand muscles",
        "Contrast baths: hot/cold alternating — reduces stiffness",
        "Buddy tape continued during any sport activity",
        "Pinch strength: progress from light → moderate",
        "Goal: full ROM by Week 6",
      ]},
      { ph:"Phase 3 — Return to Sport", d:"Weeks 6–12", c:"#3A9B5A", items:[
        "Buddy tape for all sport contact — up to 12 weeks",
        "Ball handling: light then progressive catching",
        "Contact: avoid direct jamming forces until Month 3",
        "Goal: full grip strength equal to uninjured side",
        "Stiffness: common — may persist 6–12 months, not a sign of failure",
      ]},
    ],
    nutrition: {
      acute: ["Collagen 15g + Vitamin C","Omega-3 3g/day","Bromelain 500mg — swelling"],
      recovery: ["Zinc 30mg","Vitamin C 1000mg","Protein adequate"],
    },
    positionNotes: {
      "Quarterback": "Grip and release mechanics assessed before return. Ball grip testing mandatory.",
      "Setter (Volleyball)": "Setting hand — conservative management. Lateral pass tested before overhead set.",
      "Point Guard": "Ball handling tested. Crossover dribble mechanics assessed.",
    },
  },

  "Rib Fracture": {
    fullName: "Rib Stress Fracture or Acute Fracture",
    severity: "4–8 weeks for non-contact return · 8–12 weeks for contact",
    surgeryRequired: "Rarely — flail chest is surgical emergency",
    phases: [
      { ph:"Phase 1 — Pain Management", d:"Weeks 1–3", c:"#C0695E", items:[
        "Breathing exercises: full deep breaths despite pain — prevents pneumonia",
        "Rib binder: reduces movement-related pain",
        "Ice: 20min on/off — thoracic area",
        "Sleep: side-lying on injured side (counterintuitive) — reduces movement",
        "No contact sport: rib fracture with pneumothorax is emergency",
        "Pain medication as prescribed — essential to breathe deeply",
        "Upper body exercise: no trunk rotation or compression",
        "CT scan: multiple fractures or mechanisms require imaging",
      ]},
      { ph:"Phase 2 — Cardiovascular Maintenance", d:"Weeks 3–6", c:"#9B8A3A", items:[
        "Stationary bike: seated, no trunk rotation — safe from Week 2",
        "Pool swimming: avoid breast stroke — breaststroke rotates ribs",
        "Light upper body: no pressing or pulling that engages core",
        "Walking: unlimited once pain-controlled",
        "Breathing: respiratory physio exercises — prevent scar tissue",
      ]},
      { ph:"Phase 3 — Return to Sport", d:"Weeks 6–12", c:"#3A9B5A", items:[
        "Non-contact: when pain-free at rest and with deep breathing",
        "Contact sport: rib must be clinically healed (typically 8 weeks)",
        "Rib protector pad: custom or commercial — for contact return",
        "Goalkeepers: diving mechanics assessed last",
        "Linemen: contact blocking return requires rib protector pad",
      ]},
    ],
    nutrition: {
      acute: ["Calcium 1500mg/day — bone healing","Vitamin D3 5000IU","Protein 1.5g/lb — rib bone matrix","Collagen 15g","Vitamin C 1000mg"],
      recovery: ["Magnesium 400mg — bone density","Zinc 30mg","Omega-3 3g/day"],
    },
    positionNotes: {
      "Defenseman (Hockey)": "Board battles — rib protector mandatory on return. Impact tolerance tested progressively.",
      "Offensive Lineman": "Blocking mechanics involve rib compression — full return delayed until 10–12 weeks.",
    },
  },
};

// ── POSITION-SPECIFIC INJURY RISK PROFILES ───────────────────
// Which injuries are most common/severe for each position
const POSITION_INJURY_RISK = {
  football: {
    "Quarterback":       { high: ["Rotator Cuff","Shoulder Dislocation","Ankle Sprain"], moderate: ["MCL Sprain","Hamstring Strain","Concussion"] },
    "Running Back":      { high: ["Hamstring Strain","Ankle Sprain","Concussion","ACL Tear"], moderate: ["Hip Flexor","Turf Toe"] },
    "Wide Receiver":     { high: ["Hamstring Strain","Ankle Sprain","Turf Toe","Concussion"], moderate: ["ACL Tear","Rotator Cuff"] },
    "Tight End":         { high: ["Ankle Sprain","Hamstring Strain","Shoulder Dislocation"], moderate: ["ACL Tear","MCL Sprain"] },
    "Offensive Lineman": { high: ["Ankle Sprain","Knee Tendinitis","Back Spasm","MCL Sprain"], moderate: ["Shoulder Dislocation","ACL Tear","Rib Fracture"] },
    "Defensive End":     { high: ["Shoulder Dislocation","Ankle Sprain","Hamstring Strain"], moderate: ["ACL Tear","Rotator Cuff","Back Spasm"] },
    "Linebacker":        { high: ["Concussion","Hamstring Strain","Ankle Sprain"], moderate: ["ACL Tear","Shoulder Dislocation","Back Spasm"] },
    "Cornerback":        { high: ["Hamstring Strain","Ankle Sprain","Concussion","ACL Tear"], moderate: ["Turf Toe","Hip Flexor"] },
    "Safety":            { high: ["Concussion","Hamstring Strain","Ankle Sprain"], moderate: ["ACL Tear","Shoulder Dislocation"] },
    "Kicker":            { high: ["Hip Flexor","Groin Strain","Hamstring Strain"], moderate: ["Back Spasm","Ankle Sprain"] },
  },
  basketball: {
    "Point Guard":    { high: ["Ankle Sprain","Hamstring Strain","Knee Tendinitis"], moderate: ["ACL Tear","Finger Dislocation"] },
    "Shooting Guard": { high: ["Ankle Sprain","Knee Tendinitis","Hamstring Strain"], moderate: ["Rotator Cuff","ACL Tear"] },
    "Small Forward":  { high: ["Ankle Sprain","ACL Tear","Knee Tendinitis"], moderate: ["Hamstring Strain","Back Spasm"] },
    "Power Forward":  { high: ["Ankle Sprain","ACL Tear","Patellar Tendinitis"], moderate: ["Back Spasm","Knee Tendinitis"] },
    "Center":         { high: ["Patellar Tendinitis","Ankle Sprain","Back Spasm"], moderate: ["ACL Tear","Knee Tendinitis","Finger Dislocation"] },
  },
  soccer: {
    "Goalkeeper":    { high: ["Shoulder Dislocation","Ankle Sprain","Finger Dislocation"], moderate: ["Knee Tendinitis","Back Spasm"] },
    "Center Back":   { high: ["Hamstring Strain","Ankle Sprain","Concussion"], moderate: ["ACL Tear","Groin Strain"] },
    "Full Back":     { high: ["Hamstring Strain","Groin Strain","Shin Splints"], moderate: ["ACL Tear","Ankle Sprain"] },
    "Defensive Mid": { high: ["Hamstring Strain","Groin Strain","Ankle Sprain"], moderate: ["ACL Tear","Shin Splints"] },
    "Central Mid":   { high: ["Hamstring Strain","Ankle Sprain","Groin Strain"], moderate: ["Knee Tendinitis","Shin Splints"] },
    "Attacking Mid": { high: ["Ankle Sprain","Hamstring Strain","ACL Tear"], moderate: ["Hip Flexor","Knee Tendinitis"] },
    "Winger":        { high: ["Hamstring Strain","Ankle Sprain","Groin Strain"], moderate: ["ACL Tear","Hip Flexor"] },
    "Striker":       { high: ["Hamstring Strain","Hip Flexor","Ankle Sprain"], moderate: ["ACL Tear","Groin Strain"] },
  },
  hockey: {
    "Goalie":     { high: ["Groin Strain","Hip Flexor","Shoulder Dislocation"], moderate: ["Ankle Sprain","Back Spasm"] },
    "Defenseman": { high: ["Shoulder Dislocation","Rib Fracture","MCL Sprain"], moderate: ["Concussion","Groin Strain"] },
    "Left Wing":  { high: ["Shoulder Dislocation","Concussion","Groin Strain"], moderate: ["Ankle Sprain","MCL Sprain"] },
    "Right Wing": { high: ["Shoulder Dislocation","Concussion","Groin Strain"], moderate: ["Ankle Sprain","MCL Sprain"] },
    "Center":     { high: ["Groin Strain","Concussion","Shoulder Dislocation"], moderate: ["Rib Fracture","Back Spasm"] },
  },
  volleyball: {
    "Setter":          { high: ["Patellar Tendinitis","Ankle Sprain","Rotator Cuff"], moderate: ["Finger Dislocation","Back Spasm"] },
    "Libero":          { high: ["Ankle Sprain","Knee Tendinitis","Back Spasm"], moderate: ["Patellar Tendinitis","Shoulder Dislocation"] },
    "Outside Hitter":  { high: ["Patellar Tendinitis","Ankle Sprain","Rotator Cuff"], moderate: ["ACL Tear","Back Spasm"] },
    "Middle Blocker":  { high: ["Patellar Tendinitis","Ankle Sprain","Knee Tendinitis"], moderate: ["Rotator Cuff","Back Spasm"] },
    "Opposite Hitter": { high: ["Patellar Tendinitis","Rotator Cuff","Ankle Sprain"], moderate: ["ACL Tear","Knee Tendinitis"] },
    "Right Side":      { high: ["Patellar Tendinitis","Ankle Sprain","Rotator Cuff"], moderate: ["Knee Tendinitis","Back Spasm"] },
  },
};


// ─────────────────────────────────────────────────────────────
// 16-WEEK POSITION-SPECIFIC PERIODIZATION PLANS
// Phase structure: Off-Season (Wks 1-4) | Pre-Season (Wks 5-10) | In-Season (Wks 11-14) | Peak (Wks 15-16)
// Each week: {phase, focus, intensity, volume, sessions, keyLifts[], notes}
// ─────────────────────────────────────────────────────────────

const PERIODIZATION_PLANS = {

  football: {
    "Defensive End": {
      label: "Defensive End",
      sport: "Football",
      description: "Pass rush dominance, explosive power off the line, and relentless motor — built over 16 weeks.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Anatomical Adaptation", intensity:"Low (60–65%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×10","Romanian Deadlift 3×12","DB Bench Press 4×10","Barbell Row 4×10","Farmer Carries 3×40m"], notes:"Build connective tissue tolerance. No max efforts. Focus on form and range of motion." },
        { week:2, phase:"Off-Season", focus:"Anatomical Adaptation", intensity:"Low-Mod (65–70%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Trap Bar Deadlift 3×10","Incline DB Press 4×10","Seated Row 4×10","Sled Push 4×20m"], notes:"Increase time under tension. Add unilateral work. 90-sec rest periods." },
        { week:3, phase:"Off-Season", focus:"Hypertrophy", intensity:"Mod (70–75%)", volume:"High", sessions:5, keyLifts:["Back Squat 5×8","Deadlift 4×8","Weighted Dips 4×8","Pendlay Row 4×8","Neck Harness 3×15"], notes:"Calorie surplus essential — target 500kcal over TDEE. Add neck and trap work." },
        { week:4, phase:"Off-Season", focus:"Hypertrophy Deload", intensity:"Low (55–60%)", volume:"Low", sessions:3, keyLifts:["Squat 3×8 @ 60%","Bench 3×8 @ 60%","Row 3×8 @ 60%","Core Circuit 3 rounds","Mobility 20min"], notes:"Deload week. Active recovery. Let adaptations set in. Sleep 9hrs minimum." },
        { week:5, phase:"Pre-Season", focus:"Max Strength", intensity:"High (80–87%)", volume:"Mod-High", sessions:5, keyLifts:["Back Squat 5×5","Bench Press 5×5","Deadlift 4×5","Weighted Pull-ups 4×5","Power Clean 4×4"], notes:"Primary goal: move heavy weight. 3-min rest between sets. Track all PRs." },
        { week:6, phase:"Pre-Season", focus:"Max Strength", intensity:"High (83–88%)", volume:"Mod", sessions:5, keyLifts:["Back Squat 5×4","Bench Press 5×4","Deadlift 4×4","Push Press 4×4","Hip Thrust 4×6"], notes:"Increase intensity 3–5%. Introduce accommodating resistance if available." },
        { week:7, phase:"Pre-Season", focus:"Explosive Power", intensity:"Mod-High (75–85%)", volume:"Mod", sessions:5, keyLifts:["Power Clean 5×4","Box Squat 5×3","Bench Throw (speed) 5×4","Med Ball Slam 4×6","Broad Jump 3×5"], notes:"Speed is the goal. Bar should move FAST. No grinding reps. Add plyometrics." },
        { week:8, phase:"Pre-Season", focus:"Explosive Power + Conditioning", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Hang Clean 5×4","Jump Squat 4×5","Speed Bench 5×5 @ 60%","Sprint 6×40yd","Sled Sprint 6×15m"], notes:"Introduce conditioning — 40-yd sprints twice/week. Mirror camp demands." },
        { week:9, phase:"Pre-Season", focus:"Sport-Specific Power", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Clean & Press 4×4","Quarter Squat Jump 5×5","Band Pull-Apart 4×20","Pass Rush Drill 4×5 reps","Hip Flexor Drive 4×8 each"], notes:"Pass rush mechanics — first-step explosion, hand fighting, dip and rip." },
        { week:10, phase:"Pre-Season", focus:"Pre-Camp Peak + Deload", intensity:"Mod (70%)", volume:"Low-Mod", sessions:4, keyLifts:["Squat 3×5 @ 70%","Bench 3×5 @ 70%","Power Clean 3×3 @ 70%","Sprint 4×20yd","Mobility 25min"], notes:"Taper before camp. Arrive fresh. No new exercises. Sleep and nutrition are king." },
        { week:11, phase:"In-Season", focus:"Strength Maintenance", intensity:"Mod-High (75–82%)", volume:"Low", sessions:2, keyLifts:["Back Squat 3×4","Bench Press 3×4","Deadlift 2×4","Power Clean 2×3","Core Circuit 2 rounds"], notes:"2 lifts max per week. Priority is recovery from games and practice. Never train day before game." },
        { week:12, phase:"In-Season", focus:"Strength Maintenance", intensity:"Mod-High (78–83%)", volume:"Low", sessions:2, keyLifts:["Front Squat 3×3","Push Press 3×4","Romanian Deadlift 3×5","Pull-ups 3×max","Sprint 2×20yd"], notes:"Maintain strength without accumulating fatigue. Monitor soreness carefully." },
        { week:13, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod (72–78%)", volume:"Low", sessions:2, keyLifts:["Box Jump 3×5","Speed Squat 3×3 @ 65%","Band Bench 4×6","Sled Push 3×15m","Mobility 20min"], notes:"Big game preparation — reduce volume further if injury risk is elevated." },
        { week:14, phase:"In-Season", focus:"Recovery + Maintenance", intensity:"Low-Mod (65–72%)", volume:"Low", sessions:2, keyLifts:["Goblet Squat 3×8","DB Bench 3×8","Cable Row 3×10","Foam Roll 15min","Stretch 15min"], notes:"Late season — preservation mode. Full tissue recovery is the priority." },
        { week:15, phase:"Peak", focus:"Championship Preparation", intensity:"Mod-High (78–83%)", volume:"Low", sessions:2, keyLifts:["Power Clean 3×3","Squat 3×3 @ 80%","Bench 3×3 @ 80%","Sprint 4×20yd","Visualization 10min"], notes:"Playoffs / championship. Trust the work done in weeks 1–10. Execute your assignments." },
        { week:16, phase:"Peak", focus:"Game Week Protocol", intensity:"Low (activation only)", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Jump Squat 3×3 (light)","Band Work 10min","Sprint Stride 4×15yd","Mental Prep"], notes:"Game week. One activation session only. Sleep 9hrs, hydrate, visualize every rep." },
      ]
    },
    "Quarterback": {
      label: "Quarterback",
      sport: "Football",
      description: "Arm strength, pocket mobility, elite core stability, and the conditioning to go 60 minutes.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Shoulder Health + Base Strength", intensity:"Low (60–65%)", volume:"High", sessions:4, keyLifts:["Band External Rotation 3×20","Face Pull 4×15","DB Shoulder Press 3×12","Core Plank Circuit 4 rounds","Hip Hinge Pattern 3×12"], notes:"Arm care first. No heavy overhead pressing. Build rotator cuff and scapular stability." },
        { week:2, phase:"Off-Season", focus:"Shoulder Health + Base Strength", intensity:"Low-Mod (65%)", volume:"High", sessions:4, keyLifts:["Landmine Press 4×10","Cable Row 4×12","Dead Bug 3×10 each","Pallof Press 3×12","RDL 4×10"], notes:"Add hip mobility work. QB mechanics require elite hip rotation." },
        { week:3, phase:"Off-Season", focus:"Core + Lower Body", intensity:"Mod (70%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Single-Leg RDL 3×10","Cable Chop 3×12 each","Hip Thrust 4×10","Box Step-Up 3×10"], notes:"Core rotation is your foundation — every throw starts in the hips." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low (55%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Face Pull 3×15","Core Circuit","Mobility","Throwing warm-up"], notes:"Deload and throwing sessions begin. Focus on mechanics over velocity." },
        { week:5, phase:"Pre-Season", focus:"Functional Strength", intensity:"Mod-High (75%)", volume:"Mod-High", sessions:5, keyLifts:["Trap Bar Deadlift 4×5","Push Press 4×5","Pull-ups 4×6","Landmine Rotation 4×8 each","Sprint 4×20yd"], notes:"Start pocket presence drills. Footwork patterns — hitch, slide, escape." },
        { week:6, phase:"Pre-Season", focus:"Rotational Power", intensity:"Mod-High (75–80%)", volume:"Mod", sessions:5, keyLifts:["Med Ball Rotational Throw 5×8","Hip Thrust 4×6","Band Resisted Throw 4×10","Single-Arm Cable Row 4×10","Agility Ladder 4 sets"], notes:"Medicine ball work is essential — builds throwing power without stressing shoulder." },
        { week:7, phase:"Pre-Season", focus:"Arm Velocity + Footwork", intensity:"Sport-specific", volume:"Mod", sessions:5, keyLifts:["Shoulder Circuit (4 exercises)","Ankle Stability Drill 3×10","5-7-step Drop Drill 6×","Core Anti-Rotation 3×12","Reactive Footwork Drills 10min"], notes:"3-step, 5-step, 7-step drop precision. Timing routes from week 7 onward." },
        { week:8, phase:"Pre-Season", focus:"Conditioning + Camp Prep", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Tempo Run 2mi","Agility Circuit 4 rounds","Squat 3×5 @ 70%","Arm Care Circuit","Throw 200+ balls"], notes:"Camp simulations. Work on 2-minute drill conditioning." },
        { week:9, phase:"Pre-Season", focus:"Pre-Camp Sharpening", intensity:"Mod (70%)", volume:"Mod", sessions:4, keyLifts:["Power Clean 3×3 @ 65%","Box Jump 3×4","Core Circuit 3 rounds","Mobility 20min","Route timing drill"], notes:"Everything sharp and ready. Arm feels alive. No fatigue heading into camp." },
        { week:10, phase:"Pre-Season", focus:"Pre-Camp Taper", intensity:"Low-Mod", volume:"Low", sessions:3, keyLifts:["Light lift 30min","Activation work","Throwing session","Film study 45min","Sleep priority"], notes:"Trust the process. Be mentally locked in. Rest is training." },
        { week:11, phase:"In-Season", focus:"Strength + Shoulder Preservation", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Face Pull 3×20","Squat 3×5 @ 65%","Core Circuit 2 rounds","Arm care 15min","Film 60min"], notes:"Arm care is weekly non-negotiable. Never skip shoulder recovery work." },
        { week:12, phase:"In-Season", focus:"Maintenance", intensity:"Mod (70–75%)", volume:"Low", sessions:2, keyLifts:["Deadlift 3×4 @ 70%","Push Press 3×4","Pull-ups 3×max","Band Shoulder Circuit","Sprint 3×20yd"], notes:"Maintain strength base. Adjust based on game-day performance feedback." },
        { week:13, phase:"In-Season", focus:"Recovery Priority", intensity:"Low-Mod", volume:"Low", sessions:2, keyLifts:["Light squat 3×6","Cable Row 3×10","Core Stability Circuit","Stretch 20min","Cold Contrast Bath"], notes:"Post-game recovery optimized. Hot/cold contrast + sleep 9hrs." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Squat 3×4","Core Circuit","Shoulder Activation","Film 90min"], notes:"Playoff push. Everything dialed in. Execution over effort now." },
        { week:15, phase:"Peak", focus:"Championship Week", intensity:"Low-Mod activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up","Lateral Shuffle Drill","Core Circuit (light)","Arm care 15min","Visualize every play"], notes:"Championship mentality. You've done the work. Execute your assignments perfectly." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["10min Bike Warm-Up","Band Shoulder Warm-Up","Throwing warm-up 50 balls","Mental prep 15min","Nutrition protocol"], notes:"Game day protocol. Pre-game meal 3hrs out. Stay warm, stay sharp." },
      ]
    },
    "Wide Receiver": {
      label: "Wide Receiver",
      sport: "Football",
      description: "Elite acceleration, route precision, hands, and the conditioning to run 100+ routes a game.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Speed", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Speed Foundation", intensity:"Low", volume:"High", sessions:4, keyLifts:["A-Skip 4×20m","B-Skip 4×20m","Single-Leg Squat 3×10","Nordic Hamstring 3×8","Hip Flexor Stretch Circuit"], notes:"Sprint mechanics first. Foot strike, arm drive, knee lift — perfect the fundamentals." },
        { week:2, phase:"Off-Season", focus:"Strength Base", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Romanian Deadlift 4×8","Incline DB Press 3×10","Pull-ups 4×8","Lateral Band Walk 3×20"], notes:"Build the strength that produces speed. Hip and hamstring focus." },
        { week:3, phase:"Off-Season", focus:"Strength + Speed", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Squat 4×8","Power Clean 4×4","Sprint 6×40yd (80%)","Broad Jump 3×5","Step-Up 3×10 each"], notes:"Introduce acceleration at 80%. Focus on drive phase — first 10 yards of every route." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Lift 30min","Sprint 4×20yd (60%)","Catch drills 20min","Stretch circuit","Sleep priority"], notes:"Deload. Start catching work — hands through all drills." },
        { week:5, phase:"Pre-Season", focus:"Acceleration + Power", intensity:"Mod-High", volume:"Mod-High", sessions:5, keyLifts:["Box Squat 5×4","Jump Squat 4×5","10yd Acceleration Sprint ×10","Hip Thrust 4×6","Resisted Sprint 4×20m"], notes:"First step is everything. 10-yard split more important than top speed for WR." },
        { week:6, phase:"Pre-Season", focus:"Top-End Speed", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Squat 5×4 @ 82%","Flying Sprint 4×30m","Med Ball Bound 4×6","Iso-Hold Quarter Squat 4×20sec","Sprint 6×60yd @ 90%"], notes:"Flying sprints develop max velocity. Run at 90% — controlled aggression." },
        { week:7, phase:"Pre-Season", focus:"Route Running + COD", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Pro Agility 8×","Cone Route Drill 10×","Squat 4×4 @ 80%","Vertical Jump 4×4","Sprint 4×40yd @ 95%"], notes:"Change of direction sharpness. Out-cut, in-cut, double-move precision." },
        { week:8, phase:"Pre-Season", focus:"Game Speed Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Route running vs coverage 30min","Sprint 10×20yd","Squat 3×5","Pull-ups 3×max","Catch under fatigue drill"], notes:"Game-speed conditions. Routes against live DB coverage." },
        { week:9, phase:"Pre-Season", focus:"Speed Peak", intensity:"Max", volume:"Low-Mod", sessions:4, keyLifts:["Sprint 6×40yd @ 100%","Vertical Jump test","Broad Jump test","Agility test","Pro day prep"], notes:"Peak speed week. Test all your numbers. This is your performance ceiling." },
        { week:10, phase:"Pre-Season", focus:"Camp Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Sprint 4×20yd","Route precision work","Light lift 30min","Flexibility circuit","Mental prep"], notes:"Arrive to camp feeling explosive. Every route should feel effortless." },
        { week:11, phase:"In-Season", focus:"Speed + Strength Maintenance", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Sprint 4×20yd","Squat 3×4 @ 72%","Nordic Hamstring 3×6","Hip Flexor Care","Film 60min"], notes:"Hamstring care is critical. Never skip Nordic curls in-season." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","Sprint 4×20yd","RDL 3×6","Pull-ups 3×max","Catch drills 15min"], notes:"Keep the fast-twitch fibers firing. Short, sharp, explosive sessions only." },
        { week:13, phase:"In-Season", focus:"Recovery + Activation", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Tempo Run 10min","Hip Mobility Circuit","Light Squat 3×6","Flexibility 20min","Mental Rehearsal"], notes:"Route tree mental reps. Visualize every release at the line before game day." },
        { week:14, phase:"In-Season", focus:"Playoff Speed", intensity:"Mod-High (activation)", volume:"Low", sessions:2, keyLifts:["Sprint 4×20yd @ 95%","Box Jump 3×4","Squat 3×3 @ 75%","Core Circuit","Film review 90min"], notes:"Playoff speed. Trust your conditioning. Make the plays when it counts." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Acceleration Sprint 4×10yd","Jump Series 3×3","Route precision 10min","Mental prep"], notes:"Championship week. Visualize every route vs. their coverage." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["10min Warm-Up","Sprint Stride 4×15yd","Jump Series","Catch warm-up","Pre-game nutrition"], notes:"Trust every rep from weeks 1–10. You're ready. Make the plays." },
      ]
    },
    "Running Back": {
      label: "Running Back",
      sport: "Football",
      description: "Explosive burst, contact balance, pass-catching out of the backfield, and the conditioning to carry 20+ times.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Contact Balance Foundation", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Bulgarian Split Squat 4×10","Trap Bar Deadlift 3×10","Single-Leg Hip Thrust 3×12","Lateral Band Walk 3×20","Core Stability Circuit 3 rounds"], notes:"Build single-leg strength — every RB cut is a single-leg explosion. Balance and hip stability from day one." },
        { week:2, phase:"Off-Season", focus:"Lower Body Strength", intensity:"Low-Mod (65%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×8","RDL 4×10","Step-Up Jump 3×8 each","Pallof Press 3×12","Farmer Carry 3×30m"], notes:"Introduce loaded carries — simulates fighting for extra yards after contact." },
        { week:3, phase:"Off-Season", focus:"Strength + First-Step Speed", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","10yd Acceleration Sprint ×8","Hip Thrust 4×8","Broad Jump 3×5"], notes:"First step is everything. Acceleration pattern — drive phase mechanics, low pad level." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low (55%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Hip Mobility Circuit","Sprint 4×15yd (60%)","Core Circuit","Catch Drills 15min"], notes:"Deload + catching work. RBs must be reliable receiving threats in modern offenses." },
        { week:5, phase:"Pre-Season", focus:"Explosive Power", intensity:"High (82%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Power Clean 5×4","Jump Squat 4×5","Hip Thrust 5×5","Sprint 8×20yd"], notes:"Sprint volume doubles. Every session: 8+ short sprints. Game-speed acceleration is the target." },
        { week:6, phase:"Pre-Season", focus:"Contact Power + Speed", intensity:"High (83%)", volume:"Mod", sessions:5, keyLifts:["Trap Bar Deadlift 4×4","Box Squat 4×4","Resisted Sprint 6×20m","Med Ball Slam 4×8","Single-Leg Bound 4×5"], notes:"Resisted sprints develop drive phase power. Med ball slams build contact absorption strength." },
        { week:7, phase:"Pre-Season", focus:"Cut Speed + COD", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Pro Agility 10×","L-Drill 8×","Squat 4×4 @ 80%","Lateral Bound 4×6 each","Sprint 6×40yd @ 90%"], notes:"Change of direction is the RB's art form. Pro agility and L-drill become daily. Cut on a dime." },
        { week:8, phase:"Pre-Season", focus:"Pass Protection + Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Pass Pro Drill 4×5","Sprint Circuit 5 rounds","Squat 3×5","Pull-ups 3×max","Plyo Circuit 3 rounds"], notes:"Pass protection technique — punch timing, anchor position, blitz pickup reads. Non-negotiable modern skill." },
        { week:9, phase:"Pre-Season", focus:"Game Speed Peak", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Sprint 6×40yd @ 100%","Pro Agility Test × 4","Power Clean 3×3","Squat 3×4 @ 82%","Catch vs Coverage Drill"], notes:"Peak speed week. Test your 40 and agility. Arrive to camp explosive and confident." },
        { week:10, phase:"Pre-Season", focus:"Camp Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Sprint 4×20yd","Light Lift 30min","Route Running","Catch Drills","Mental Prep"], notes:"Arrive fresh. Legs springy, hands sharp. Make every rep count." },
        { week:11, phase:"In-Season", focus:"Explosion Maintenance", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4 @ 72%","Power Clean 2×3","Hip Thrust 3×5","Sprint 4×15yd","Core Circuit"], notes:"2 sessions max. Hamstring care critical — never skip hip hinge work in-season." },
        { week:12, phase:"In-Season", focus:"Speed + Strength", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","RDL 3×6","Squat 3×4","Sprint 4×15yd","Catch Drills 15min"], notes:"Keep the fast-twitch firing. Short, sharp, explosive. 35 min max." },
        { week:13, phase:"In-Season", focus:"Recovery Priority", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min","Hip Mobility Circuit","Light Squat 3×6","Hamstring Care","Film 60min"], notes:"Running backs take punishment every carry. Prioritize soft tissue recovery — massage, contrast bath." },
        { week:14, phase:"In-Season", focus:"Playoff Push", intensity:"Mod (74%)", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Squat 3×4","Sprint 4×15yd","Plyo 2×5","Film review"], notes:"Playoff preparation. Trust the conditioning built in weeks 5–9." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Acceleration 4×10yd","Plyo Series 3×3","Route Running Precision","Mental Prep"], notes:"Championship week. Every carry in training got you here. Execute." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 15min","Sprint Strides 4×15yd","Jump Series","Catch Warm-Up","Nutrition Protocol"], notes:"Game day. Trust the process. Make every touch count." },
      ]
    },

    "Offensive Lineman": {
      label: "Offensive Lineman",
      sport: "Football",
      description: "Raw strength, leverage, hand fighting, and the endurance to dominate 60+ snaps per game.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Strength", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Structural Strength Base", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×10","Deadlift 4×8","DB Bench Press 4×10","Barbell Row 4×10","Sled Push 4×20m"], notes:"No max efforts. Build structural tolerance in tendons and joints. OL is a year-round strength sport." },
        { week:2, phase:"Off-Season", focus:"Hypertrophy Foundation", intensity:"Mod (65%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Trap Bar Deadlift 4×8","Incline Bench 4×8","Weighted Pull-ups 3×8","Farmer Carry 4×30m"], notes:"Calorie surplus required — elite OL need mass. Target 500kcal above TDEE this phase." },
        { week:3, phase:"Off-Season", focus:"Hypertrophy + Grip Strength", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 5×8","Bench Press 5×8","Deadlift 4×8","Wrist Roller 3 sets","Neck Harness 3×15"], notes:"Grip and hand strength are OL weapons. Add wrist roller and plate pinches weekly." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low (55%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Light Bench 3×8","Core Circuit","Mobility 20min","Film: technique study"], notes:"Deload and technical study. Watch film of elite OL — foot placement, punch timing, anchor position." },
        { week:5, phase:"Pre-Season", focus:"Max Strength", intensity:"High (82%)", volume:"High", sessions:5, keyLifts:["Back Squat 5×5","Bench Press 5×5","Deadlift 5×4","Weighted Dips 4×6","Hip Thrust 4×6"], notes:"Strength is the OL's only currency. Every session should move heavy weight. 3-min rest between sets." },
        { week:6, phase:"Pre-Season", focus:"Max Strength Peak", intensity:"High (85-90%)", volume:"Mod", sessions:5, keyLifts:["Back Squat 5×4","Bench Press 5×4","Deadlift 4×4","Push Press 4×4","Barbell Row 4×4"], notes:"Work up to near-max efforts. A 500lb squat and 400lb bench press are realistic targets for elite OL." },
        { week:7, phase:"Pre-Season", focus:"Power + Footwork", intensity:"Mod-High (78%)", volume:"Mod", sessions:5, keyLifts:["Power Clean 4×3","Box Jump 3×4","Speed Bench 5×5 @ 60%","Lateral Shuffle Drill 4×10yd","Kick Step Drill 4×5"], notes:"Introduce footwork: kick step for pass sets, lateral shuffle for zone blocking. Feet are the foundation." },
        { week:8, phase:"Pre-Season", focus:"Leverage + Hand Combat", intensity:"High", volume:"High", sessions:5, keyLifts:["Squat 4×5","Bench 4×5","Hand Fighting Drill 4 rounds","Sled Push 6×15m","Stalemate Block Drill 4×5"], notes:"Hand fighting technique — inside hand placement, punch timing, reset and re-grip. Practice with a partner." },
        { week:9, phase:"Pre-Season", focus:"Camp Strength Peak", intensity:"High (85%)", volume:"Mod", sessions:4, keyLifts:["Squat 4×4","Bench 4×4","Deadlift 3×4","Power Clean 3×3","Footwork Agility 20min"], notes:"Arrive to camp as the strongest version of yourself. Strength is your identity." },
        { week:10, phase:"Pre-Season", focus:"Camp Taper", intensity:"Mod (70%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×5","Light Bench 3×5","Mobility Circuit","Hand Drills","Rest priority"], notes:"Taper. Arrive fresh. Let the practice snaps be the conditioning." },
        { week:11, phase:"In-Season", focus:"Strength Preservation", intensity:"High (80%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4 @ 80%","Bench 3×4 @ 80%","Deadlift 2×4","Core Circuit","Mobility"], notes:"OL must stay strong all season. Higher in-season intensity than skill positions — strength is the job." },
        { week:12, phase:"In-Season", focus:"Max Strength Maintenance", intensity:"High (82%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Bench 3×4","Push Press 3×4","Barbell Row 3×4","Plank Circuit"], notes:"Keep the strength numbers up. A weak OL in week 14 is a liability. Never let this slip." },
        { week:13, phase:"In-Season", focus:"Recovery + Strength", intensity:"Mod (75%)", volume:"Low", sessions:2, keyLifts:["Light Squat 3×5","Light Bench 3×5","Mobility Circuit","Soft Tissue Work 20min","Film review"], notes:"Body armor maintenance. Ice baths, massage, and sleep are your off-field weapons." },
        { week:14, phase:"In-Season", focus:"Playoff Strength", intensity:"High (80%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Bench 3×4","Deadlift 2×4","Core Circuit","Footwork Drill 15min"], notes:"Playoff push. You should be physically at your peak — 14 weeks of training behind you." },
        { week:15, phase:"Peak", focus:"Championship Preparation", intensity:"Activation (60%)", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Light Squat 3×3","Light Bench 3×3","Hand Drills","Mental Prep"], notes:"Championship week. Your strength is already there. Stay loose, stay focused." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Warm-Up 20min","Light movement","Hand Combat Activation","Sled Push 2×10m","Pre-game nutrition"], notes:"Dominate every snap. 60 snaps, 60 battles. Win each one." },
      ]
    },

    "Linebacker": {
      label: "Linebacker",
      sport: "Football",
      description: "Sideline-to-sideline pursuit speed, run-stopping power, blitz explosiveness, and zone coverage athleticism.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Athletic Base", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×8","RDL 4×10","DB Bench Press 4×10","Pull-ups 4×8","Lateral Bound 3×5 each"], notes:"LB athleticism starts with multi-directional strength. Every session has a lateral movement component." },
        { week:2, phase:"Off-Season", focus:"Strength + Hip Power", intensity:"Low-Mod (65%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Hip Thrust 4×10","Single-Leg Deadlift 3×8","Cable Row 4×10","Rotational Med Ball 3×10"], notes:"Hip power drives every tackle. Rotational medicine ball work simulates taking on blocks and wrapping up." },
        { week:3, phase:"Off-Season", focus:"Strength + Speed Foundation", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Sprint 6×30m (80%)","Box Jump 3×5","Core Anti-Rotation Circuit"], notes:"Combine strength days with speed days. LBs need to be the second-fastest player on the field." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low (55%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Core Circuit","Sprint 4×20yd (60%)","Hip Mobility","Film: reading plays pre-snap"], notes:"Film study — reading guard/tackle movement to diagnose run vs. pass at the snap." },
        { week:5, phase:"Pre-Season", focus:"Max Strength + Explosion", intensity:"High (82%)", volume:"Mod-High", sessions:5, keyLifts:["Back Squat 5×5","Deadlift 4×5","Power Clean 5×4","Weighted Pull-ups 4×5","Sprint 6×30m"], notes:"The LB must be strong enough to shed 300lb linemen AND fast enough to cover running backs." },
        { week:6, phase:"Pre-Season", focus:"Blitz Speed + Contact Power", intensity:"High (83%)", volume:"Mod", sessions:5, keyLifts:["Power Clean 5×4","Box Squat 4×4","Resisted Sprint 6×20m","Hip Thrust 4×6","Sled Drive 4×10m"], notes:"Blitz pad level — low and explosive first step. Resisted sprints build the exact force pattern of blitzing." },
        { week:7, phase:"Pre-Season", focus:"Pursuit Angles + COD", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Pro Agility 8×","W-Drill 6×","Squat 4×4 @ 80%","Lateral Shuffle 4×15yd","Sprint 6×40yd @ 90%"], notes:"Pursuit angle efficiency — taking the right path to the ball carrier. Practice cutting off running lanes." },
        { week:8, phase:"Pre-Season", focus:"Coverage + Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Zone Drop Drill 4×","Man Coverage Footwork 4×","Squat 3×5","Interval Sprint 8×30sec on/30 off","Power Clean 3×4"], notes:"Coverage technique — zone drops, man-to-man leverage, jamming TEs at the line. Non-negotiable modern skill." },
        { week:9, phase:"Pre-Season", focus:"Camp Readiness", intensity:"High", volume:"Mod", sessions:4, keyLifts:["Sprint 6×40yd @ 95%","Power Clean 3×3","Squat 3×4 @ 82%","Pro Agility 4×","Tackling Form Drill"], notes:"Arrive as the most athletic linebacker on the field. Every drill is a tryout." },
        { week:10, phase:"Pre-Season", focus:"Camp Taper", intensity:"Mod (70%)", volume:"Low", sessions:3, keyLifts:["Light Lift 30min","Sprint 4×20yd","Hip Mobility","Film review","Sleep priority"], notes:"Arrive fresh. Trust the speed and strength built over 9 weeks." },
        { week:11, phase:"In-Season", focus:"Strength + Speed Maintenance", intensity:"Mod (73%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Power Clean 2×3","Pull-ups 3×max","Sprint 4×20yd","Core Circuit"], notes:"2 sessions max. Keep the explosive qualities — LBs who don't maintain speed lose pursuit angles." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","RDL 3×6","Squat 3×4","Sprint 4×15yd","Hip Mobility 10min"], notes:"Short, sharp, explosive. 30-35 min sessions only. Save everything for Sundays." },
        { week:13, phase:"In-Season", focus:"Recovery Priority", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min","Core Circuit","Light Squat 3×6","Soft Tissue Work","Film 60min"], notes:"LBs take hits on every snap. Soft tissue recovery — hamstring and hip flexor care especially." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (74%)", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Squat 3×4","Sprint 4×15yd","Coverage Drill","Film review"], notes:"Playoff push. Read tendencies from film. Your athleticism + film study = unblockable." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint 4×15yd","Jump Series 3×3","Lateral Shuffle Activation","Mental Prep"], notes:"Championship week. You've built the motor and the instincts. Trust them both." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 20min","Sprint Strides","Lateral Movement","Film final review","Nutrition Protocol"], notes:"Game day. Fly to the ball. Make every play in your area." },
      ]
    },

    "Cornerback": {
      label: "Cornerback",
      sport: "Football",
      description: "Elite hip flexibility, backpedal speed, press coverage technique, and the mental composure to match up 1-on-1.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Speed", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Hip Flexibility + Speed Foundation", intensity:"Low", volume:"High", sessions:4, keyLifts:["Hip Flexor Circuit 4 rounds","90/90 Hip Mobility 3×90sec","A-Skip 4×20m","B-Skip 4×20m","Backpedal Drill 4×15yd"], notes:"CB play starts in the hips. Elite hip rotation is what separates press coverage specialists from average DBs." },
        { week:2, phase:"Off-Season", focus:"Lower Body Strength", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Single-Leg RDL 3×10 each","Hip Thrust 4×10","Copenhagen Adductor 3×8","Sprint 4×30m (75%)"], notes:"Build the lower body strength that powers backpedal and break. Adductor strength prevents groin pulls." },
        { week:3, phase:"Off-Season", focus:"Strength + Acceleration", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Sprint 6×30m (85%)","Broad Jump 3×5","Lateral Bound 4×5"], notes:"The CB's first 5 yards on a break must be violent. Sprint mechanics + power clean build this transition." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Hip Mobility Circuit","Light Squat 3×8","Backpedal 4×15yd","Stretch 20min","Film: route tree study"], notes:"Study every route in the tree. Know the release tells, the stem, and the break — before the snap." },
        { week:5, phase:"Pre-Season", focus:"Top-End Speed", intensity:"High", volume:"Mod-High", sessions:5, keyLifts:["Sprint 8×40yd @ 95%","Flying Sprint 4×30m","Squat 5×4 @ 80%","Box Jump 4×5","Hip Mobility 10min"], notes:"40 time is the CB's calling card. Flying sprints develop max velocity — what it feels like to chase a WR down." },
        { week:6, phase:"Pre-Season", focus:"Backpedal + Break Speed", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Backpedal-to-Sprint 8×","Hip Flip Drill 6×","Squat 4×4 @ 82%","Lateral Sprint 6×20m","Sprint 6×30m @ 95%"], notes:"Backpedal-to-sprint transition is the core CB movement. Practice it daily at game speed." },
        { week:7, phase:"Pre-Season", focus:"Press Coverage + Route Recognition", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Press Jam Drill 6×","Man Coverage vs WR 30min","Squat 4×4","Sprint 4×30m","Hip Mobility Circuit"], notes:"Press technique — inside hand, mirror the release, redirect without grabbing. Practice against live receivers." },
        { week:8, phase:"Pre-Season", focus:"Zone + Coverage Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Zone Drop Drill 4×","Pattern Match Drill 4×","Interval Sprint 8×30sec","Squat 3×5","Film: WR tendency study"], notes:"Zone coverage footwork — eyes to QB, leverage by alignment. Read the QB's eyes, not the receiver." },
        { week:9, phase:"Pre-Season", focus:"Speed Peak", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Sprint 6×40yd @ 100%","Pro Agility Test 4×","Backpedal-to-Sprint Test","Squat 3×4 @ 80%","Reaction Drill 3 sets"], notes:"Peak speed week. Test every metric. Your 40 time and agility numbers determine your market value." },
        { week:10, phase:"Pre-Season", focus:"Camp Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Sprint 4×20yd","Hip Mobility Circuit","Light Lift 30min","Coverage Drill","Mental Prep"], notes:"Arrive confident. Every WR has tells. You've studied them. Trust your preparation." },
        { week:11, phase:"In-Season", focus:"Speed + Hip Maintenance", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Sprint 4×20yd","Squat 3×4 @ 70%","Hip Mobility Circuit","Backpedal Drill 4×","Stretch 15min"], notes:"Hip mobility is the first thing to decline without maintenance. 10 min of mobility every single day." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×20yd @ 90%","Box Jump 3×4","RDL 3×6","Hip Flip Drill","Core Circuit"], notes:"Keep the burst and top-end speed. Don't let the closing speed decline — that's when you start giving up big plays." },
        { week:13, phase:"In-Season", focus:"Recovery + Activation", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Hip Mobility 15min","Light Sprint 3×20yd","Core Circuit","Stretch 20min","Film: upcoming WR study"], notes:"Study the WR you're facing this week. Their alignment tendencies, release tells, favorite routes." },
        { week:14, phase:"In-Season", focus:"Playoff Speed", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×20yd @ 95%","Squat 3×4","Hip Mobility","Coverage Drill","Film review 90min"], notes:"Playoff CBs are mentally locked in. You know every tendency. Execute with confidence." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint 4×15yd","Hip Mobility Circuit","Backpedal Drill","Visualization"], notes:"Championship week. Study #1 WR until you know every route in their tree. You've got him." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 15min","Sprint Strides 4×15yd","Hip Mobility","Coverage Activation","Pre-game nutrition"], notes:"Game day. Press, redirect, break on the ball. Your preparation beats their talent." },
      ]
    },

    "Safety": {
      label: "Safety",
      sport: "Football",
      description: "The last line of defense — open-field range, explosive closing speed, physicality in run support, and elite football instincts.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Speed", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Range + Strength Foundation", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×8","RDL 4×10","DB Bench Press 4×8","Lateral Bound 3×6 each","Backpedal-to-Sprint 4×20yd"], notes:"Safeties need range — the ability to cover ground in any direction. Lateral explosion is the foundation." },
        { week:2, phase:"Off-Season", focus:"Lower Body Strength", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Hip Thrust 4×10","Single-Leg RDL 3×10","Pull-ups 4×8","Diagonal Sprint 4×20yd"], notes:"Diagonal sprint patterns — safeties rarely run straight lines. Train the angles you play." },
        { week:3, phase:"Off-Season", focus:"Strength + Zone Speed", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Sprint 6×40yd (80%)","Box Jump 3×5","Lateral Shuffle 4×20yd"], notes:"Zone coverage requires reading keys on the move. Conditioning must support 70 high-intensity plays." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Core Circuit","Sprint 4×20yd","Hip Mobility","Film: coverage shell concepts"], notes:"Film study — 2-high shell, cover 3 rotations, match coverage principles. IQ is half the position." },
        { week:5, phase:"Pre-Season", focus:"Explosive Speed", intensity:"High", volume:"Mod-High", sessions:5, keyLifts:["Sprint 8×40yd @ 90%","Squat 5×4 @ 80%","Power Clean 5×4","Box Jump 4×5","Angle Sprint 6×30m"], notes:"Safety speed is different — closing speed on receivers AND pursuit speed on runners. Train both every week." },
        { week:6, phase:"Pre-Season", focus:"Physicality + Contact", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Power Clean 5×4","Hip Thrust 4×6","Resisted Sprint 6×20m","Sled Drive 4×15m","Open-Field Tackle Drill"], notes:"Open-field tackling technique — leverage, fit, finish. A missed tackle in the open field is catastrophic." },
        { week:7, phase:"Pre-Season", focus:"Coverage Range + Reads", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Backpedal 6×20yd","Post-Snap Diagnosis Drill 4×","Squat 4×4 @ 80%","Sprint 4×40yd @ 95%","Transition Drill 4×"], notes:"Post-snap key reading — guard pull, TE release, QB eyes. Two steps before the ball is snapped you should know." },
        { week:8, phase:"Pre-Season", focus:"Conditioning + Communication", intensity:"High", volume:"High", sessions:5, keyLifts:["Coverage Shell Drill 30min","Sprint Circuit 4 rounds","Squat 3×5","Pull-ups 4×max","Communication Drill"], notes:"The safety organizes the entire secondary. Practice pre-snap communication — call the coverage, set alignments." },
        { week:9, phase:"Pre-Season", focus:"Peak Speed + IQ", intensity:"High", volume:"Mod", sessions:4, keyLifts:["Sprint 6×40yd @ 100%","Pro Agility 4×","Squat 3×4","Power Clean 3×3","Film: tendencies of camp opponent"], notes:"Peak athleticism week. IQ separates good safeties from great ones — know the offense before the snap." },
        { week:10, phase:"Pre-Season", focus:"Camp Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Sprint 4×20yd","Light Lift 30min","Hip Mobility","Film review","Sleep priority"], notes:"Arrive fresh and mentally locked in. Set the tone in practice — the safety sets the temperature of the defense." },
        { week:11, phase:"In-Season", focus:"Speed + Strength Maintenance", intensity:"Mod (73%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Power Clean 2×3","Sprint 4×20yd","Core Circuit","Hip Mobility"], notes:"Maintain the athleticism. Safeties who lose closing speed give up touchdowns they should prevent." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","RDL 3×6","Sprint 4×15yd","Squat 3×4","Lateral Bound 3×4"], notes:"Keep the fast-twitch firing. 30-35 min sessions. Quality over quantity." },
        { week:13, phase:"In-Season", focus:"Recovery + Film", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min","Hip Mobility Circuit","Core Circuit","Soft Tissue Work","Film 90min"], notes:"Film is your preparation. Study upcoming offensive tendencies — formation, route combos, run direction." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (74%)", volume:"Low", sessions:2, keyLifts:["Sprint 4×15yd","Squat 3×4","Power Clean 2×3","Coverage Drill","Film 90min"], notes:"Playoff safety play is about eliminating mistakes. Know your coverage assignments before the snap." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint 4×15yd","Lateral Movement Circuit","Coverage Activation","Mental Prep"], notes:"Championship week. You are the quarterback of the defense. Lead with confidence." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 20min","Sprint Strides","Lateral Shuffle","Film last review","Pre-game nutrition"], notes:"Game day. Range. Physicality. IQ. You've trained all three. Bring all three." },
      ]
    },

    "Tight End": {
      label: "Tight End",
      sport: "Football",
      description: "The hybrid weapon — inline blocking strength of an OL combined with the receiving routes and hands of a WR.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "FB" },
        { name: "Peak Performance", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Hybrid Foundation", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×10","RDL 4×10","DB Bench Press 4×10","Pull-ups 4×10","Route Running (light) 20min"], notes:"Build both sides of the position. Upper body strength for blocking, lower body power for routes and yards after catch." },
        { week:2, phase:"Off-Season", focus:"Blocking Strength + Route Speed", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Bench Press 4×8","Barbell Row 4×8","Sprint 4×30m (75%)","Catch Drills 20min"], notes:"The TE must be a credible blocker to make their receiving threat dangerous. Both skill sets must improve together." },
        { week:3, phase:"Off-Season", focus:"Strength + Athleticism", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Sprint 6×30m (85%)","Box Jump 3×5","Route Running vs Coverage"], notes:"Position athleticism — a 6ft 5in 260lb player running a seam route is matchup death for any linebacker." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Light Bench 3×8","Sprint 4×20yd","Catch Drills","Film: blocking technique"], notes:"Film study — blocking technique: down blocks, angle blocks, reach blocks. Know your assignments." },
        { week:5, phase:"Pre-Season", focus:"Max Strength + Speed", intensity:"High (82%)", volume:"Mod-High", sessions:5, keyLifts:["Back Squat 5×5","Bench Press 5×5","Power Clean 4×4","Sprint 6×40yd","Vertical Jump 4×4"], notes:"TE must be strong enough to handle edge rushers AND fast enough to get open on seam routes. Train both." },
        { week:6, phase:"Pre-Season", focus:"Blocking Power + Route Precision", intensity:"High (83%)", volume:"Mod", sessions:5, keyLifts:["Trap Bar Deadlift 4×4","Push Press 4×5","Resisted Sprint 4×20m","Hand Fighting Drill 3 rounds","Route vs LB Coverage"], notes:"Run routes against linebackers and safeties. A TE who can win vs. LBs in man coverage is elite." },
        { week:7, phase:"Pre-Season", focus:"Seam Routes + Pass Blocking", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Squat 4×4 @ 80%","Sprint 4×40yd @ 90%","Seam Route Timing Drill 6×","Pass Protection Drill 4×","Catch Under Pressure"], notes:"Seam routes are the TE's defining play. Perfect the stem and separation at the top of the route." },
        { week:8, phase:"Pre-Season", focus:"Game-Speed Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Red Zone Route Drill","Squat 3×5","Bench 3×5","Sprint Circuit 4 rounds","Blocking vs Edge Rusher"], notes:"Red zone mastery — TEs win games in the red zone. Practice every route from the 10-yard line in." },
        { week:9, phase:"Pre-Season", focus:"Camp Readiness", intensity:"High", volume:"Mod", sessions:4, keyLifts:["Sprint 6×40yd @ 95%","Squat 4×4","Bench 4×4","Route vs Coverage","Blocking Technique Drill"], notes:"Arrive as the most complete TE in camp. Block, run routes, catch balls. Be the most versatile player on the field." },
        { week:10, phase:"Pre-Season", focus:"Camp Taper", intensity:"Mod (70%)", volume:"Low", sessions:3, keyLifts:["Sprint 4×20yd","Light Lift 30min","Route Running","Catch Drills","Rest priority"], notes:"Fresh legs, fresh hands. Arrive ready to make plays in every phase." },
        { week:11, phase:"In-Season", focus:"Strength + Speed Maintenance", intensity:"Mod (73%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Bench 3×4","Sprint 4×20yd","Catch Drills 15min","Core Circuit"], notes:"Both sides of the position must be maintained. Never sacrifice blocking strength for the sake of speed training." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Box Jump 3×4","RDL 3×5","Sprint 4×15yd","Route Precision 15min"], notes:"Route timing and blocking anchor maintained. 35-min sessions max." },
        { week:13, phase:"In-Season", focus:"Recovery + Technique", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Light Squat 3×5","Core Circuit","Catch Drills 15min","Soft Tissue Work","Film review"], notes:"Body maintenance. A TE who gets dinged up loses both their blocking and receiving value. Stay healthy." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (73%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Sprint 4×15yd","Route vs Coverage","Blocking Drill","Film 90min"], notes:"Playoff TEs are matchup nightmares. Know which linebacker you're exploiting and attack all week." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint 4×15yd","Route Precision","Blocking Activation","Mental Prep"], notes:"Championship week. You're the mismatch they can't solve. Make them pay for it." },
        { week:16, phase:"Peak", focus:"Game Day Readiness", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 20min","Sprint Strides","Route Warm-Up","Blocking Activation","Pre-game nutrition"], notes:"Game day. Block. Run routes. Catch balls. Win matchups. Be the difference." },
      ]
    },

    },

  basketball: {
    "Point Guard": {
      label: "Point Guard",
      sport: "Basketball",
      description: "Court vision runs through elite conditioning — the PG must be faster and sharper in the 4th quarter than the 1st. Speed, handle, and relentless cardio.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Speed", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "BB" },
        { name: "Peak / Playoffs", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Foot Speed + Ankle Stability", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Ankle Stability Circuit 4 rounds","Lateral Band Walk 3×25","A-Skip 4×20m","Single-Leg Balance Squat 3×10 each","Agility Ladder 15min"], notes:"PG play starts at the feet. Ankle stability and first-step quickness built from the ground up — nothing before this matters more." },
        { week:2, phase:"Off-Season", focus:"Lower Body Strength + Change of Direction", intensity:"Low-Mod (65%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Single-Leg RDL 3×10","Hip Thrust 4×10","Pro Agility Drill 6×","Sprint 4×20m (70%)"], notes:"Single-leg strength drives every crossover, drive, and defensive slide. Build unilateral strength before bilateral max efforts." },
        { week:3, phase:"Off-Season", focus:"Conditioning Base + Speed", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Interval Run 8×30sec on/30 off","Sprint 6×30m (80%)","Core Anti-Rotation Circuit","Handle Drills 20min"], notes:"Start conditioning base early. PGs run the most of any player — studies show elite PGs cover 4–5 miles per game." },
        { week:4, phase:"Off-Season", focus:"Deload + Skill", intensity:"Low (55%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Agility Ladder 10min","Handle Drills 30min","Shooting 200 shots","Stretch 20min"], notes:"Deload and skill work. Ball handling and shooting are the PG's art — daily touch with the ball is non-negotiable." },
        { week:5, phase:"Pre-Season", focus:"Speed Peak + First Step", intensity:"High (80%)", volume:"Mod-High", sessions:5, keyLifts:["10yd Acceleration Sprint ×12","Pro Agility 10×","Squat 4×5 @ 80%","Box Jump 4×5","Reaction Drill 3 sets"], notes:"First step is the PG's primary weapon. 10-yard split is more important than 40-yard speed. Train the burst, not the cruise." },
        { week:6, phase:"Pre-Season", focus:"On-Ball Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Full-Court Sprint 10×","Defensive Slide 6×30sec","Squat 4×4","Pull-ups 4×max","Handle Under Fatigue Drill"], notes:"Handle under fatigue — dribble drills done after sprint sets. Game decisions must be made in minute 40 as clearly as minute 1." },
        { week:7, phase:"Pre-Season", focus:"Pick and Roll Speed + COD", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["P&R Rejection Drill 6×","5-10-5 Agility 10×","Squat 4×4 @ 82%","3/4 Court Sprint 8×","Lateral Bound 4×6"], notes:"Pick-and-roll navigation is the core skill of modern PG play. Speed through the screen, read the defense on the way." },
        { week:8, phase:"Pre-Season", focus:"Game Conditioning Peak", intensity:"High", volume:"High", sessions:5, keyLifts:["5-on-5 Scrimmage 60min","Suicide Sprint 6×","Squat 3×4","Sprint Circuit 4 rounds","Defensive Intensity Drill 4×"], notes:"Full game conditioning. Track your time on court — simulate 30+ minute demands with no drop in pace or decision quality." },
        { week:9, phase:"Pre-Season", focus:"Athleticism Test", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Sprint 6×30m @ 100%","Pro Agility Test 4×","Vertical Jump Test","3/4 Court Sprint Test","Handle Precision Drill"], notes:"Test week. Measure everything — 30m sprint, agility, vertical. These numbers are your baseline for the season." },
        { week:10, phase:"Pre-Season", focus:"Season Opener Taper", intensity:"Mod (70%)", volume:"Low", sessions:3, keyLifts:["Sprint 4×20m","Light Lift 30min","Shoot 200 shots","Stretch 20min","Mental prep"], notes:"Arrive at opening night with fresh legs and sharp handles. Your conditioning and speed are built — show it." },
        { week:11, phase:"In-Season", focus:"Speed + Conditioning Maintenance", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Sprint 4×20m","Squat 3×4 @ 70%","Core Circuit","Defensive Slide 3×20sec","Handle Drills 15min"], notes:"2 sessions max. PG must maintain conditioning mid-season — heavy game schedule doesn't replace sprint work." },
        { week:12, phase:"In-Season", focus:"First Step + Lateral Speed", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Pro Agility 4×","Box Jump 3×4","RDL 3×5","Sprint 4×15m","Ankle Circuit"], notes:"Keep the first step sharp. If the first step slows, the entire offense slows. Non-negotiable maintenance." },
        { week:13, phase:"In-Season", focus:"Recovery + Vision", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min easy","Core Circuit","Stretch 20min","Handle Drills 20min","Film: defensive tendencies"], notes:"Film study — study your defender's tendencies, off-ball coverage rotations, and pick-and-roll schemes to attack." },
        { week:14, phase:"In-Season", focus:"Playoff Speed", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×15m @ 90%","Pro Agility 4×","Squat 3×4","Core Circuit","Shooting 100 shots"], notes:"Playoff PGs are mentally elite. Your fitness must be at season-high — fourth-quarter execution wins championships." },
        { week:15, phase:"Peak", focus:"Playoff Performance", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint Strides 4×15m","Pro Agility 3×","Handle Activation 15min","Mental prep"], notes:"Playoffs. Your conditioning is your advantage. Run them ragged. Make decisions when they can't breathe." },
        { week:16, phase:"Peak", focus:"Championship Game", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 15min","Sprint Strides 3×10m","Handle Warm-Up","Shooting Ritual","Visualization"], notes:"Championship. You're the engine of this team. Be the fastest, sharpest player on the court in the 4th quarter." },
      ]
    },

    "Shooting Guard": {
      label: "Shooting Guard",
      sport: "Basketball",
      description: "Elite off-ball movement, scoring off the catch, pull-up efficiency, and the conditioning to be a constant scoring threat for 35+ minutes.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "BB" },
        { name: "Peak / Playoffs", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Movement Efficiency Base", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Goblet Squat 4×10","Lateral Band Walk 3×20","A-Skip 4×20m","Core Stability Circuit","Shooting 200 shots"], notes:"SG play is about movement without the ball. Off-ball cuts, pin-downs, flare screens — every basket is set up by footwork." },
        { week:2, phase:"Off-Season", focus:"Lower Body Strength + Jump Foundation", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","RDL 4×10","Hip Thrust 4×10","Box Step-Up 3×10 each","Catch-and-Shoot Drill 20min"], notes:"Jump shooting power comes from the legs, not the arms. Build the foundation that will become a reliable pull-up jumper." },
        { week:3, phase:"Off-Season", focus:"Strength + Vertical", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Box Jump 4×5","Sprint 6×30m (80%)","Shooting off movement 30min"], notes:"Vertical jump training — shot fake + jump, catch off a screen + jump. The shooting SG must create separation vertically." },
        { week:4, phase:"Off-Season", focus:"Deload + Skill", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Shooting 300 shots","Off-Ball Cut Drill","Stretch 20min","Film: shooting technique"], notes:"Shoot 300 balls every day this week. Muscle memory is built in deload weeks — the body is fresh, the reps go deep." },
        { week:5, phase:"Pre-Season", focus:"Explosive Vertical + Speed", intensity:"High (80%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Depth Jump 4×6","Sprint 6×30m @ 85%","Box Jump 5×5","Pull-up Jump Series 4×6"], notes:"The pull-up jumper is the SG's most important shot — train the jump, not just the shot. Power and hang time win spacing battles." },
        { week:6, phase:"Pre-Season", focus:"On-Ball Scoring + Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Mid-Range Isolation Drill 30min","Sprint 8×30m","Squat 4×4","Lateral Bound 4×6","Pull-up Efficiency Drill"], notes:"One-on-one scoring drills at game speed. Create off the dribble — step-back, mid-range pull-up, floater — at full conditioning." },
        { week:7, phase:"Pre-Season", focus:"Off-Ball Movement + Conditioning", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Pin-Down Cut Drill 6×","Flare Screen Drill 6×","Squat 4×4 @ 80%","3/4 Court Sprint 6×","Shooting off screens 30min"], notes:"The best SGs are exhausting to guard because they never stop moving. Condition the off-ball movement patterns." },
        { week:8, phase:"Pre-Season", focus:"Defensive Conditioning + Game Fitness", intensity:"High", volume:"High", sessions:5, keyLifts:["Deny Drill 4×30sec","Close-Out Drill 6×","5-on-5 Scrimmage 60min","Sprint Circuit 4 rounds","Shooting under fatigue"], notes:"Defensive intensity in the SG role — hedge, deny, chase through screens. Train the defense as hard as the offense." },
        { week:9, phase:"Pre-Season", focus:"Peak Athleticism", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Vertical Jump Test","Sprint 6×30m @ 100%","Pro Agility 4×","Shooting 200 shots","3-on-3 game speed"], notes:"Test week. Shooting percentage under fatigue is a key metric — shoot 50 shots after sprinting each set." },
        { week:10, phase:"Pre-Season", focus:"Season Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Light Lift 30min","Sprint 4×20m","Shoot 300 shots","Stretch","Mental prep"], notes:"Arrive sharp. Hot shooting early in the season sets the tone for the entire year." },
        { week:11, phase:"In-Season", focus:"Vertical + Strength Maintenance", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Box Jump 3×4","Pull-ups 3×max","Core Circuit","Shooting 100 shots"], notes:"Maintain the jump. SGs who lose their vertical in-season lose their shot quality — the shots get flat and the arc disappears." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Depth Jump 3×4","Sprint 4×15m","RDL 3×5","Lateral Bound 3×4","Shooting off screens 15min"], notes:"Keep the fast-twitch firing. 30 min sessions max. Quality trumps quantity every time." },
        { week:13, phase:"In-Season", focus:"Recovery + Shooting Touch", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min","Core Circuit","Shooting 200 shots (light)","Stretch 20min","Film: shot selection review"], notes:"Film your shot selection — are you getting quality looks? Adjust off-ball movement patterns if shots are contested." },
        { week:14, phase:"In-Season", focus:"Playoff Scoring Peak", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","Sprint 4×15m","Squat 3×4","Shooting 150 shots","Film: playoff opponent tendencies"], notes:"Playoff SG focus — identify when and where defenders give you open looks. Run those actions relentlessly." },
        { week:15, phase:"Peak", focus:"Playoff Performance", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up","Jump Activation 3×3","Sprint Strides 3×15m","Shooting Ritual 100 shots","Mental prep"], notes:"Playoffs. Your shot is automatic. Your movement is exhausting. Make them chase you for 40 minutes." },
        { week:16, phase:"Peak", focus:"Championship Game", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 15min","Jump Series 3×3","Shooting Ritual","Mental visualization","Pre-game nutrition"], notes:"Championship. Every catch is an opportunity. Your shot has been built over 16 weeks. Trust it." },
      ]
    },

    "Small Forward": {
      label: "Small Forward",
      sport: "Basketball",
      description: "The most versatile position — must score off drives and catch-and-shoot, switch defensively across positions, and rebound above their size.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "BB" },
        { name: "Peak / Playoffs", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Multi-Directional Strength", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×10","Pull-ups 4×8","Lateral Lunge 3×10 each","Core Anti-Rotation Circuit","Catch-and-Shoot Drill 20min"], notes:"The SF is asked to guard PGs and Centers in the same game. Build the multi-directional athleticism to switch everything." },
        { week:2, phase:"Off-Season", focus:"Strength + Athleticism Base", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Hip Thrust 4×10","DB Bench 4×8","Sprint 4×30m (70%)","Rebound Box-Out Drill"], notes:"Wing strength is the key — strong enough to post up smaller defenders, quick enough to beat bigger ones off the dribble." },
        { week:3, phase:"Off-Season", focus:"Strength + Vertical + Drive", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Squat 4×8","Power Clean 4×4","Box Jump 4×5","Drive-and-Finish Drill 20min","Sprint 6×30m"], notes:"The SF's primary scoring tool is the drive — train the first step acceleration, elevation, and contact finishing simultaneously." },
        { week:4, phase:"Off-Season", focus:"Deload + Versatility", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Core Circuit","Shooting 200 shots","Post Footwork Drill","Stretch 20min"], notes:"Practice being every position. Shoot like a guard, post up like a big, handle like a PG. Versatility is the SF's superpower." },
        { week:5, phase:"Pre-Season", focus:"Power + Switchability", intensity:"High (80%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Power Clean 4×4","Lateral Bound 4×6","Box Jump 5×5","Wing Isolation Drill 30min"], notes:"Switchability requires reactive lateral speed. Train the hip abductors and adductors as hard as the quads." },
        { week:6, phase:"Pre-Season", focus:"Scoring Versatility", intensity:"High", volume:"High", sessions:5, keyLifts:["Post Move + Finish Drill 30min","Drive + Kick Drill 6×","Squat 4×4","Sprint 6×30m","Defensive Switch Drill 4×"], notes:"Train every scoring action in the SF arsenal — post-up, mid-range pull-up, drive and dish, catch-and-shoot." },
        { week:7, phase:"Pre-Season", focus:"Defensive Versatility", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["1-on-1 Defense vs Guard","1-on-1 Defense vs Big","Squat 4×4 @ 80%","Lateral Sprint 6×20m","Closeout Drill 6×"], notes:"Defensive switching is a premium skill. Guard a PG, a C, and everyone between — conditioning must support all of it." },
        { week:8, phase:"Pre-Season", focus:"Full-Game Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["5-on-5 Scrimmage 60min","Sprint Circuit 4 rounds","Squat 3×5","Rebound + Outlet Drill","Pull-ups 4×max"], notes:"Full game simulation. Track your defensive assignments — are you winning switchable matchups?" },
        { week:9, phase:"Pre-Season", focus:"Peak Athleticism", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Vertical Test","Sprint 6×30m @ 100%","Lateral Speed Test","Squat 3×4 @ 82%","All-Around Skills Assessment"], notes:"Test everything. As an SF, you should have elite scores across multiple categories — that versatility is your value." },
        { week:10, phase:"Pre-Season", focus:"Season Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Sprint 4×20m","Light Lift 30min","Shooting 200 shots","Post Work","Mental prep"], notes:"Arrive as the most versatile player in the gym. That is the SF identity." },
        { week:11, phase:"In-Season", focus:"All-Around Maintenance", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Box Jump 3×4","Pull-ups 3×max","Sprint 4×15m","Core Circuit"], notes:"Maintain everything — strength, speed, and vertical. Being a complete player means maintaining complete athleticism." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Lateral Bound 3×5","Power Clean 2×3","RDL 3×5","Sprint 3×15m","Shooting 100 shots"], notes:"Keep the switchability. Lateral quickness is the first quality to decline without maintenance." },
        { week:13, phase:"In-Season", focus:"Recovery + Versatility", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min","Core Circuit","Post Footwork Drill","Stretch 20min","Film: matchup tendencies"], notes:"Study your matchups — who are you guarding tonight? What are their tendencies? Prepare your defensive game plan." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (73%)", volume:"Low", sessions:2, keyLifts:["Sprint 4×15m","Squat 3×4","Lateral Bound 3×4","Core Circuit","Film review 90min"], notes:"Playoff SFs are winning matchups before tip-off through film preparation and tactical versatility." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Jump Series 3×3","Sprint Strides","Shooting Ritual","Mental prep"], notes:"Championship week. Your versatility is the X-factor. Be ready to guard anyone and score against anyone." },
        { week:16, phase:"Peak", focus:"Game Day", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 15min","Jump Activation","Sprint Strides","Shooting Warm-Up","Visualization"], notes:"Championship. Execute your defensive assignments, make winning plays, be the glue." },
      ]
    },

    "Power Forward": {
      label: "Power Forward",
      sport: "Basketball",
      description: "Interior strength to battle bigs, perimeter mobility to guard in space, and elite rebounding positioning — the physically demanding flex position.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Strength", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "BB" },
        { name: "Peak / Playoffs", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Physical Foundation", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×10","DB Bench 4×10","Barbell Row 4×10","Box-Out Rebounding Drill","Hip Mobility Circuit"], notes:"PF physical demands: must be strong enough to post up, mobile enough to defend pick-and-roll. Build both foundations." },
        { week:2, phase:"Off-Season", focus:"Strength Base + Mobility", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Hip Thrust 4×10","Weighted Pull-ups 3×8","Lateral Lunge 3×10","Post Footwork Drill"], notes:"Hip mobility is critical for PFs who must defend in space. Combine heavy lifting with mobility work every session." },
        { week:3, phase:"Off-Season", focus:"Strength + Vertical", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 5×8","Bench Press 4×8","Deadlift 4×8","Box Jump 3×5","Rebound + Outlet Drill"], notes:"Rebounding is a physical battle. Build the leg power and upper body strength to secure boards over bigger opponents." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Light Bench 3×8","Post Move Drill","Mobility 20min","Shooting Mid-Range 100 shots"], notes:"Modern PFs must shoot from the elbows and three-point line. Mid-range and corner 3 shooting sessions weekly." },
        { week:5, phase:"Pre-Season", focus:"Max Strength", intensity:"High (82%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Bench Press 5×5","Deadlift 4×5","Power Clean 4×4","Post Battle Drill 20min"], notes:"Strength peak — you must be the physically stronger player in every matchup. Post battles are won in the weight room." },
        { week:6, phase:"Pre-Season", focus:"Explosive Power + Rebounding", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Box Jump 5×5","Squat 4×4 @ 83%","Hip Thrust 4×6","Box-Out + Jump Drill 4×6","Lateral Bound 4×5"], notes:"Offensive rebounding requires vertical explosiveness AND positioning. Train both the jump and the box-out simultaneously." },
        { week:7, phase:"Pre-Season", focus:"Pick-and-Roll Defense + Mobility", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Drop Coverage Drill 6×","Hedge-and-Recover Drill 6×","Squat 4×4 @ 80%","Lateral Sprint 6×20m","Shooting Elbow Area 100 shots"], notes:"Pick-and-roll defense is the PF's most contested assignment. Drop, hedge, or switch — practice all three schemes." },
        { week:8, phase:"Pre-Season", focus:"Post Game + Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Post Move Series 30min","5-on-5 Scrimmage 60min","Squat 3×5","Bench 3×5","Sprint Circuit 3 rounds"], notes:"Develop a reliable post repertoire: drop step, up-and-under, jump hook. Each move should be automatic." },
        { week:9, phase:"Pre-Season", focus:"Peak Strength + Athleticism", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Squat 3×4 @ 85%","Bench 3×4 @ 85%","Vertical Jump Test","Lateral Speed Test","Post Efficiency Assessment"], notes:"Test your strength numbers. A PF squatting 350+ lbs has a physical advantage in every box-out and post battle." },
        { week:10, phase:"Pre-Season", focus:"Season Taper", intensity:"Mod (70%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×5","Light Bench 3×5","Shooting 150 shots","Post Footwork","Mental prep"], notes:"Arrive physically dominant. Your size and strength advantage must be felt in the first minute of the first game." },
        { week:11, phase:"In-Season", focus:"Strength Preservation", intensity:"High (78%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4 @ 78%","Bench 3×4 @ 78%","Deadlift 2×4","Box Jump 3×4","Core Circuit"], notes:"PFs need higher in-season intensity than guards. Strength is your job — don't let it erode over the 82-game season." },
        { week:12, phase:"In-Season", focus:"Explosive + Strength Maintenance", intensity:"High (80%)", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Squat 3×4","Box Jump 3×4","Hip Thrust 3×5","Post Footwork 15min"], notes:"Both strength and explosiveness maintained. The rebounding battles in February must feel the same as October." },
        { week:13, phase:"In-Season", focus:"Recovery + Positioning", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Light Squat 3×5","Core Circuit","Post Drill 15min","Soft Tissue Work","Film: rebounding positioning"], notes:"Film study — study rebounding positioning tendencies. Where does the ball come off? Where do you need to be?" },
        { week:14, phase:"In-Season", focus:"Playoff Strength", intensity:"High (78%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Bench 3×4","Post Battle Drill","Sprint 3×15m","Film review"], notes:"Playoff PFs dominate the glass. Your physical dominance must peak in weeks 15–16." },
        { week:15, phase:"Peak", focus:"Championship Prep", intensity:"Activation (60%)", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up","Light Squat 3×3","Box Jump 3×3","Post Activation","Mental prep"], notes:"Championship week. Win every physical battle. Own the glass. Set screens that move people." },
        { week:16, phase:"Peak", focus:"Game Day", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Warm-Up 20min","Light Squat Activation","Jump Activation","Post Warm-Up","Pre-game nutrition"], notes:"Championship. Dominate the paint. Your strength was built across 16 weeks. Use every pound of it." },
      ]
    },

    "Center": {
      label: "Center",
      sport: "Basketball",
      description: "The anchor — elite post strength, rim protection dominance, offensive rebounding explosiveness, and the conditioning to be physical for 30+ minutes.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Strength", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "BB" },
        { name: "Peak / Playoffs", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Mass + Structural Base", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×10","Bench Press 4×10","Barbell Row 4×10","Farmer Carry 4×30m","Neck + Trap Work 3 sets"], notes:"Centers are physical. Build mass and structural strength — every pound of lean mass is a physical advantage in the post. Target 500kcal surplus." },
        { week:2, phase:"Off-Season", focus:"Strength Foundation + Post Footwork", intensity:"Low-Mod (65%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Deadlift 4×8","Weighted Dips 4×8","Box-Out Drill 3×5min","Drop Step Drill 20min"], notes:"Post footwork builds simultaneously with gym strength. Drop step, up-and-under, jump hook — drill daily." },
        { week:3, phase:"Off-Season", focus:"Hypertrophy + Rim Presence", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 5×8","Bench Press 5×8","Deadlift 4×8","Standing Reach Practice","Post Battle Drill 20min"], notes:"Rim protection begins in the weight room. Arm length + vertical reach + strength = the rim protector profile." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low (55%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Light Bench 3×8","Post Move Practice","Mobility 20min","Film: elite C post technique"], notes:"Watch elite Center post play. Study footwork, use of body, seal positions, and finishing angles." },
        { week:5, phase:"Pre-Season", focus:"Max Strength Peak", intensity:"High (83%)", volume:"Mod-High", sessions:5, keyLifts:["Back Squat 5×5","Bench Press 5×5","Deadlift 5×4","Weighted Dips 4×6","Post Battle vs PF 20min"], notes:"Centers need the highest raw strength of any position. A 400lb+ squat and 300lb+ bench are elite benchmarks." },
        { week:6, phase:"Pre-Season", focus:"Explosive Strength + Vertical", intensity:"High (83-87%)", volume:"Mod", sessions:5, keyLifts:["Power Clean 4×4","Box Jump 4×5","Hip Thrust 4×6","Bench 5×4","Offensive Rebound Box-Out Series"], notes:"Offensive rebounding requires explosive vertical + physical positioning. Train both every session." },
        { week:7, phase:"Pre-Season", focus:"Post Finishing + Rim Protection", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Drop Step Finish 4×8 each","Jump Hook 4×8 each","Shot Block Drill 4×6","Squat 4×4 @ 82%","Sprint 4×30m"], notes:"Shot blocking is not a reflex — it's a trained skill. Timing, verticality, and two-hand technique: practice all three." },
        { week:8, phase:"Pre-Season", focus:"Pick-and-Roll Offense + Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Roll-to-Rim Finishing Drill 30min","5-on-5 Scrimmage 60min","Squat 3×5","Bench 3×5","Conditioning Bike 4×45sec"], notes:"The modern C must be a lob threat and a pick-and-roll finisher. Train the timing and touch for the roll." },
        { week:9, phase:"Pre-Season", focus:"Strength + Conditioning Peak", intensity:"High (85%)", volume:"Mod", sessions:4, keyLifts:["Squat 3×4 @ 85%","Bench 3×4 @ 85%","Vertical Jump Test","Post Efficiency Test","Conditioning Test 4×45sec bike sprint"], notes:"Test your numbers — squat, bench, vertical. Your strength advantage must be measurable." },
        { week:10, phase:"Pre-Season", focus:"Season Taper", intensity:"Mod (70%)", volume:"Low", sessions:3, keyLifts:["Light Squat 3×5","Light Bench 3×5","Post Moves 20min","Mobility Circuit","Rest priority"], notes:"Arrive physically dominant. In-season, your job is to be the most physical presence on the floor." },
        { week:11, phase:"In-Season", focus:"Max Strength Preservation", intensity:"High (80%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4 @ 80%","Bench 3×4 @ 80%","Deadlift 2×4","Core Circuit","Post Footwork 15min"], notes:"Centers run the highest in-season intensity of any position — 80% 1RM maintained. Strength IS the position." },
        { week:12, phase:"In-Season", focus:"Strength + Explosive Power", intensity:"High (82%)", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Box Jump 3×5","Squat 3×4","Bench 3×4","Post Drill 15min"], notes:"Keep the explosive qualities for rebounding. A Center who loses vertical in November loses offensive boards." },
        { week:13, phase:"In-Season", focus:"Recovery + Dominance", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Light Squat 3×5","Light Bench 3×5","Soft Tissue Work 20min","Post Footwork","Film: rebounding positioning"], notes:"Physical recovery — ice bath, massage, and sleep. Centers absorb physical punishment every game." },
        { week:14, phase:"In-Season", focus:"Playoff Strength Peak", intensity:"High (80%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4 @ 80%","Bench 3×4","Post Battle Drill","Core Circuit","Film review 90min"], notes:"Playoff Centers dominate the paint on both ends. Your physical peak must arrive in weeks 15–16." },
        { week:15, phase:"Peak", focus:"Championship Preparation", intensity:"Activation (60%)", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 20min","Light Squat 3×3","Box Jump 3×4","Post Activation Drill","Mental prep"], notes:"Championship week. Own the paint. Protect the rim. Set screens that move people 5 feet. Secure every board." },
        { week:16, phase:"Peak", focus:"Game Day Domination", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Warm-Up 20min","Post Activation Drill","Jump Activation","Rim Protection Timing","Pre-game nutrition"], notes:"Championship. Your strength was built across 16 weeks. Be the most physical player on the floor. Every. Single. Possession." },
      ]
    },

    "_default": {
      label: "Basketball Athlete",
      sport: "Basketball",
      description: "Explosive vertical, lateral quickness, elite conditioning, and in-season strength preservation.",
      phases: [
        { name: "Off-Season Base", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "BB" },
        { name: "Peak / Playoffs", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Structural Balance", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Goblet Squat 4×10","RDL 3×12","Push-Up Variations 4×12","Pull-ups 3×10","Ankle Mobility Circuit"], notes:"Establish movement quality. Ankle and hip mobility are critical for basketball athletes." },
        { week:2, phase:"Off-Season", focus:"Strength Foundation", intensity:"Mod (65–70%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Hip Thrust 4×10","DB Bench 4×8","Cable Row 4×10","Lateral Band Walk 3×20"], notes:"Build hip strength — every explosive move starts in the posterior chain." },
        { week:3, phase:"Off-Season", focus:"Hypertrophy + Conditioning", intensity:"Mod (70–75%)", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Bench Press 4×8","Weighted Pull-ups 4×6","Single-Leg Press 3×10","Sprints 6×30m"], notes:"Combine strength and conditioning. Arrive at pre-season in shape." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Core Circuit","Bike 20min","Stretch","Shooting 30min"], notes:"Rest and skill work." },
        { week:5, phase:"Pre-Season", focus:"Power Development", intensity:"High (80%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Power Clean 4×4","Depth Jump 3×6","Bench 5×5","Sprint 6×30m"], notes:"Power is the game. Every movement should be explosive." },
        { week:6, phase:"Pre-Season", focus:"Vertical + Lateral Power", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Box Jump 5×5","Lateral Bound 4×8","Clean Pull 4×4","Step-Up Jump 4×5 each","Sprint 6×20m"], notes:"Jump training twice weekly." },
        { week:7, phase:"Pre-Season", focus:"Sport-Specific Conditioning", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Suicide Sprints 5×","Defensive Slide Drill 4×30sec","Squat 4×4 @ 80%","Push Press 4×4","Core Circuit"], notes:"Basketball conditioning — suicide sprints and slide drills." },
        { week:8, phase:"Pre-Season", focus:"Conditioning Peak", intensity:"High", volume:"High", sessions:5, keyLifts:["3-on-3 Scrimmage 60min","Sprint Circuit 4 rounds","Squat 3×5","Pull-ups 4×max","Plyo Circuit 3 rounds"], notes:"Full game-intensity conditioning." },
        { week:9, phase:"Pre-Season", focus:"Speed + Agility", intensity:"High", volume:"Mod", sessions:5, keyLifts:["5-10-5 Agility 8×","Vertical Test","3/4 Court Sprint 6×","Squat 4×4","Ankle Plyos 3 sets"], notes:"Test week — measure improvements." },
        { week:10, phase:"Pre-Season", focus:"Season Taper", intensity:"Mod", volume:"Low-Mod", sessions:3, keyLifts:["Light Lift 30min","Sprint 4×20m","Shoot 200 shots","Stretch","Sleep priority"], notes:"Arrive to season opener feeling explosive and fresh." },
        { week:11, phase:"In-Season", focus:"Strength Maintenance", intensity:"Mod (70–75%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Bench 3×4","Pull-ups 3×max","Jump Series 3×4","Core Circuit"], notes:"2 lift sessions per week max." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","Power Clean 2×3","RDL 3×5","Lateral Bound 3×5 each","Sprint 3×20m"], notes:"Short, sharp sessions. 30–40 min max." },
        { week:13, phase:"In-Season", focus:"Recovery + Activation", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min","Light Squat 3×6","Band Circuit","Stretch 20min","Shooting 20min"], notes:"Recovery week if heavy schedule." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Squat 3×4","Core Circuit","Sprint 4×15m","Film review"], notes:"Playoff push." },
        { week:15, phase:"Peak", focus:"Playoff Performance", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up","Jump Series 3×3","Defensive Slide 3×20sec","Sprint 3×15m","Mental prep"], notes:"Playoffs. Every possession matters." },
        { week:16, phase:"Peak", focus:"Championship Run", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["10min Activation","Jump Activation 3×3","Core Activation","Shooting Ritual","Visualization"], notes:"Championship mindset. Execute." },
      ]
    }
  },

  soccer: {
    "Goalkeeper": {
      label: "Goalkeeper",
      sport: "Soccer",
      description: "The GK is a completely different athlete — explosive diving range, aerial command, distribution power, and the mental intensity to be fully switched on for 90+ minutes with seconds notice.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Explosiveness", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "SC" },
        { name: "Peak / Finals", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Dive Foundation + Wrist Resilience", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Lateral Dive Roll Drill 4×8","Wrist Flexion/Extension 3×20","Shoulder External Rotation 3×20","Single-Leg Balance 3×30sec","Core Anti-Rotation 3×12"], notes:"GK training is unlike any outfield position. Start with dive mechanics, landing technique, and wrist/shoulder durability — the joints that take the most punishment." },
        { week:2, phase:"Off-Season", focus:"Lower Body Strength + Lateral Power", intensity:"Low-Mod (65%)", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Single-Leg RDL 3×10 each","Lateral Box Jump 3×5 each","Hip Thrust 4×10","Throwing Distance Work 15min"], notes:"GK explosiveness is almost entirely lateral and vertical. Every strength exercise must transfer to diving range and aerial command." },
        { week:3, phase:"Off-Season", focus:"Explosive Foundation + Distribution", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Box Jump 4×5","Overarm Throw Circuit 3×15","Kicking Distance Drill 20min"], notes:"Distribution is a weapon. Work on both throwing distance and kick power — goal kicks under pressure require maximum power." },
        { week:4, phase:"Off-Season", focus:"Deload + Reflex Introduction", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Tennis Ball Reaction Drill 10min","Lateral Shuffle 4×15yd","Wrist Care Circuit","Film: positioning principles"], notes:"Introduce reaction training. Tennis ball drops, partner toss reactions — reflex work should feel like play, not training." },
        { week:5, phase:"Pre-Season", focus:"Explosive Power + Shot-Stopping", intensity:"High (80%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Lateral Box Jump 5×5 each side","Power Clean 4×4","Diving Save Drill 4×8","Reaction Ball Drill 3×2min"], notes:"GK-specific plyometrics: lateral box jumps, standing broad jumps to a dive. Every power exercise simulates a save movement pattern." },
        { week:6, phase:"Pre-Season", focus:"Diving Range + Aerial Dominance", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Full Extension Dive Drill 4×6 each","Aerial Claim Drill 4×8","Box Jump 4×5","Hip Thrust 4×6","Throw-and-React Drill 3×15"], notes:"Aerial dominance training — jump timing, body positioning at peak, two-handed claim. A GK who commands their area defends more than just shots." },
        { week:7, phase:"Pre-Season", focus:"Reflexes + Distribution Under Pressure", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Multi-Ball Shot-Stop Drill 4×","Close-Range Reaction Save 4×","Squat 4×4 @ 80%","Goal Kick Power Drill 4×8","Short Distribution Accuracy Drill"], notes:"Multi-ball drills replicate the cognitive load of match shot-stopping. The GK must process, react, reset — and do it again in 2 seconds." },
        { week:8, phase:"Pre-Season", focus:"Match Simulation + Set Pieces", intensity:"High", volume:"High", sessions:5, keyLifts:["11v11 Scrimmage + GK Focus 60min","Cross Claiming Drill 4×8","Corner Kick Command Drill","Squat 3×5","Distribution Under Fatigue"], notes:"Full match simulation. Claim every cross. Organize the defense. Distribute quickly. Test match IQ as hard as physical capacity." },
        { week:9, phase:"Pre-Season", focus:"Pre-Season Sharpening", intensity:"Mod-High", volume:"Mod", sessions:4, keyLifts:["Shot-Stop Test (20 shots)","Lateral Speed Test","Squat 3×4 @ 78%","Distribution Accuracy Test","Reflex Score Benchmark"], notes:"Test everything. GKs should track: dive reaction time, cross claim %, distribution accuracy. Measurable data drives training focus." },
        { week:10, phase:"Pre-Season", focus:"Season Opener Taper", intensity:"Low-Mod", volume:"Low", sessions:3, keyLifts:["Light Lift 30min","Reaction Drill 10min","Shot-Stop Warm-Up Drill","Stretch 20min","Mental prep"], notes:"Arrive confident. Your positioning, reflexes, and distribution are match-ready." },
        { week:11, phase:"In-Season", focus:"Explosive Maintenance + Shot-Stopping", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Lateral Box Jump 3×4 each","Squat 3×4 @ 70%","Wrist Care Circuit","Dive Drill 3×6 each","Reaction Ball 10min"], notes:"GKs must maintain lateral explosiveness all season. Weekly dive drills prevent technique decay from lack of match shots." },
        { week:12, phase:"In-Season", focus:"Power + Reflexes", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","Power Clean 2×3","Reaction Ball 10min","Hip Thrust 3×5","Distribution Drill 15min"], notes:"Reflex sharpness is a perishable skill. Weekly reaction work — tennis balls, multi-ball drills — keeps it at match level." },
        { week:13, phase:"In-Season", focus:"Recovery + Mental Sharpness", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Light Lateral Movement","Wrist + Shoulder Care","Reaction Drill 10min","Stretch 20min","Film: opposition striker tendencies"], notes:"Film study — every striker has patterns. Where do they shoot from? Which is their strong foot? What do they do under pressure?" },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Lateral Box Jump 3×4","Squat 3×4","Dive Drill 4×6","Reflex Drill 15min","Mental visualization"], notes:"Playoff GK mindset — every clean sheet is earned by preparation, positioning, and decision-making, not luck." },
        { week:15, phase:"Peak", focus:"Cup Final Preparation", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Lateral Jump Activation 3×4","Dive Activation Drill 3×4 each","Reaction Drill 10min","Visualization"], notes:"Cup final week. You know every striker tendency. Your positioning is automatic. Be the wall." },
        { week:16, phase:"Peak", focus:"Match Day", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-Match Activation 20min","Lateral Shuffle 3×10yd","Dive Warm-Up","Cross Claiming Warm-Up","Pre-match nutrition"], notes:"Match day. Command your area. Organize your defense. Make the saves that matter. Be the difference." },
      ]
    },
    "Defender": {
      label: "Defender",
      sport: "Soccer",
      description: "Aerial dominance, tackling aggression, positional discipline, and the recovery speed to get back when beaten — the last line before the goalkeeper.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "SC" },
        { name: "Peak / Finals", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Structural Strength Base", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["Back Squat 4×10","RDL 4×10","DB Bench 4×10","Copenhagen Adductor 3×8","Easy Run 4km"], notes:"Defenders need raw physical presence. Build the structural strength base — groin, hamstring, and lower back injury prevention are priorities from day one." },
        { week:2, phase:"Off-Season", focus:"Strength + Aerial Foundation", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Hip Thrust 4×10","Weighted Pull-ups 3×8","Box Jump 3×5","Heading Timing Drill (no contact)"], notes:"Aerial duels are won with vertical jump strength and timing. Start building the leg power that wins headers in your own box." },
        { week:3, phase:"Off-Season", focus:"Strength + Speed Base", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Squat 4×8","Power Clean 4×4","Sprint 6×30m (80%)","Nordic Hamstring 4×8","Tempo Run 4km"], notes:"Defenders must be fast enough to recover when beaten. Sprint training begins alongside strength work from week 3." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Hip Mobility Circuit","Easy Run 3km","Stretch 20min","Film: defensive shape and positioning"], notes:"Film study — defensive shape, pressing triggers, cover shadow positioning. Tactical IQ is a physical multiplier for defenders." },
        { week:5, phase:"Pre-Season", focus:"Max Strength + Aerial Power", intensity:"High (82%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Deadlift 4×5","Box Jump 4×5","Vertical Jump 4×4","Sprint 6×30m"], notes:"Aerial dominance requires 30-inch+ verticals for outfield players. Build the leg power to win every ball in the air." },
        { week:6, phase:"Pre-Season", focus:"Tackling Speed + Recovery Sprint", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Sprint 8×30m @ 90%","Recovery Sprint Drill 6×","Squat 4×4","Power Clean 3×4","Nordic 3×8"], notes:"Recovery speed — the sprint back after being beaten — is the most important defensive physical quality. Train it explicitly." },
        { week:7, phase:"Pre-Season", focus:"1v1 Defense + Conditioning", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["1-on-1 Defending Drill 8×","Pressing Trigger Drill 6×","Squat 4×4 @ 80%","Lateral Sprint 6×20m","Interval Run 6×45sec"], notes:"1v1 positioning — stay on feet, show the striker outside, force them back toward support. Technique saves more goals than tackles." },
        { week:8, phase:"Pre-Season", focus:"Defensive Shape + Match Fitness", intensity:"High", volume:"High", sessions:5, keyLifts:["11v11 Scrimmage 60min","Sprint Recovery Drill 4×","Squat 3×4","Nordic 2×8","Core Circuit"], notes:"Defensive unit work — offside trap timing, press coordination, and set piece marking. Physical fitness must be automatic by now." },
        { week:9, phase:"Pre-Season", focus:"Pre-Season Sharpening", intensity:"Mod-High", volume:"Mod", sessions:4, keyLifts:["Sprint 6×30m @ 95%","Vertical Jump Test","Squat 3×4 @ 80%","Aerobic Test","Tactical Drill 20min"], notes:"Final fitness tests. Defenders should be physically dominant — strong, fast to recover, powerful in the air." },
        { week:10, phase:"Pre-Season", focus:"Season Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Sprint Strides 4×20m","Light Lift 30min","Hip Mobility","Stretch","Mental prep"], notes:"Arrive organized and physically confident. Win the first duel — set the tone for the whole match." },
        { week:11, phase:"In-Season", focus:"Strength + Speed Maintenance", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4 @ 72%","Nordic 3×6","Sprint 4×20m","Core Circuit","Hip Mobility 10min"], notes:"Nordic hamstring curls are the number-one injury prevention exercise for defenders. Never skip them in-season." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Box Jump 3×4","Sprint 4×20m","RDL 3×6","Nordic 2×6","Core Circuit"], notes:"Recovery sprint speed must be maintained. Weekly sprint sessions protect the defensive position all season long." },
        { week:13, phase:"In-Season", focus:"Recovery + Positioning", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Easy Run 2km","Hip Mobility Circuit","Light Squat 3×6","Stretch 20min","Film: opposition striker tendencies"], notes:"Study the striker you face this week — their first touch direction, preferred foot, movement patterns on set pieces." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×20m","Squat 3×4","Box Jump 3×4","Nordic 2×6","Film review 90min"], notes:"Playoff defenders keep clean sheets through organization, communication, and physical dominance. All three peak here." },
        { week:15, phase:"Peak", focus:"Cup Final Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint Strides 4×20m","Box Jump 3×3","Aerial Timing Drill","Mental prep"], notes:"Cup final week. Win your duels. Keep your shape. Communicate on every set piece. Clean sheet." },
        { week:16, phase:"Peak", focus:"Match Day", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-Match Activation 20min","Sprint Strides 3×10m","Dynamic Stretch","Aerial Warm-Up","Pre-match nutrition"], notes:"Match day. Defend with your positioning first, your tackles second. Win before kick-off with your organization." },
      ]
    },
    "Midfielder": {
      label: "Midfielder",
      sport: "Soccer",
      description: "The engine — midfielders cover 10–13km per match, more than any position. 90-minute elite aerobic capacity, repeated sprint ability, and technical precision under fatigue.",
      phases: [
        { name: "Off-Season Aerobic Base", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Engine Build", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "SC" },
        { name: "Peak / Finals", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Aerobic Base — Zone 2", intensity:"Low (60–65%)", volume:"High", sessions:5, keyLifts:["Zone 2 Run 6km (conversation pace)","Bodyweight Squat Circuit 3×15","Single-Leg Balance 3×30sec","Hip Flexor Stretch","Nordic Hamstring 3×8"], notes:"Elite midfielders cover 10–13km per match — more than any position. Week 1 is pure aerobic base. Keep heart rate conversational. This engine is what all future training runs on." },
        { week:2, phase:"Off-Season", focus:"Aerobic Base + Strength", intensity:"Low-Mod (65%)", volume:"High", sessions:5, keyLifts:["Zone 2 Run 7km","Front Squat 4×8","RDL 4×10","Copenhagen Adductor 3×8","Core Circuit 3 rounds"], notes:"Combine aerobic sessions with strength training. Midfielders need leg endurance AND the strength to win physical midfield battles." },
        { week:3, phase:"Off-Season", focus:"Aerobic + Tempo Running", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Tempo Run 5km @ 75% effort","Back Squat 4×8","Nordic Hamstring 4×8","Sprint 4×40m (80%)","Hip Mobility Circuit"], notes:"Introduce tempo running — the bridge between easy aerobic base and game-speed conditioning. This is the midfield workhorse's foundational quality." },
        { week:4, phase:"Off-Season", focus:"Deload + Skill", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Easy Run 3km","Light Squat 3×8","Ball Skill 30min","Stretch 20min","Film: midfield pressing patterns"], notes:"Study pressing triggers and midfield coordination. A high-pressing midfielder runs 30% more — the fitness must match the tactical demands." },
        { week:5, phase:"Pre-Season", focus:"Aerobic Power + Repeated Sprint", intensity:"High (80%)", volume:"High", sessions:5, keyLifts:["Interval Run 8×90sec on/45sec off","Squat 4×5 @ 80%","Power Clean 4×4","Sprint 6×40m @ 90%","Nordic 3×8"], notes:"Repeated sprint ability is the midfielder's defining physical quality — sprint, recover briefly, sprint again. Train it with short rest intervals from week 5." },
        { week:6, phase:"Pre-Season", focus:"High-Intensity Interval + Strength", intensity:"High", volume:"High", sessions:5, keyLifts:["5×5min High-Intensity Run (>85% max)","Sprint 6×30m","Squat 4×4 @ 82%","Box Jump 3×5","Hip Mobility 10min"], notes:"5-minute high intensity blocks simulate match demands. Midfielders sustain elevated heart rates for extended periods — train at greater than 85% max heart rate." },
        { week:7, phase:"Pre-Season", focus:"Small-Sided Game Conditioning", intensity:"Mod-High", volume:"High", sessions:5, keyLifts:["4v4 Rondo 30min","Pressing Drill 4×4min","Squat 3×4 @ 80%","Sprint 4×30m","Core Circuit"], notes:"Rondos and small-sided games build soccer-specific fitness better than running alone. Decision-making under fatigue is as important as the physical load." },
        { week:8, phase:"Pre-Season", focus:"Full Match Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["11v11 Scrimmage 80min","Recovery Run 2km next day","Squat 3×5","Nordic 3×8","Sprint Circuit"], notes:"80-minute full match scrimmage. Can you maintain technical quality and tactical awareness at minute 80? If not, the aerobic work is not done." },
        { week:9, phase:"Pre-Season", focus:"Season Fitness Test", intensity:"Mod-High", volume:"Mod", sessions:4, keyLifts:["Yo-Yo Intermittent Test (Level 2)","Sprint 6×30m @ 95%","Squat 3×4 @ 78%","Technical Quality Under Fatigue","Match Intensity Drill 20min"], notes:"The Yo-Yo test is the gold standard for soccer fitness. Elite midfielders reach Level 18–20. Use this score to track season-over-season improvement." },
        { week:10, phase:"Pre-Season", focus:"Season Opener Taper", intensity:"Low-Mod", volume:"Low", sessions:3, keyLifts:["Light Run 3km","Sprint Strides 4×20m","Light Lift 30min","Ball Touch 20min","Mental prep"], notes:"Arrive with a full tank. Your aerobic base is built. Your legs should feel light and fast." },
        { week:11, phase:"In-Season", focus:"Aerobic + Strength Maintenance", intensity:"Mod (68%)", volume:"Low", sessions:2, keyLifts:["Recovery Run 3km (day after match)","Squat 3×4 @ 68%","Nordic 3×6","Interval Sprint 4×30sec on/30 off","Core Circuit"], notes:"The recovery run the day after a match is non-negotiable for midfielders — active recovery clears lactate and maintains aerobic base across a long season." },
        { week:12, phase:"In-Season", focus:"Repeated Sprint Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 6×30m","Box Jump 3×4","RDL 3×6","Nordic 2×6","Ball Skill 15min"], notes:"Repeated sprint ability must be maintained weekly. Without it, match performance declines by minute 60." },
        { week:13, phase:"In-Season", focus:"Recovery + Technical Quality", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Easy Run 2km","Hip Mobility Circuit","Core Circuit","Ball Work 20min","Film: opposition midfield patterns"], notes:"Technical quality under fatigue is a trained quality. Ball work in a fatigued state maintains decision-making sharpness across the season." },
        { week:14, phase:"In-Season", focus:"Cup / Playoff Fitness Peak", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×30m @ 90%","Squat 3×4","Interval 4×60sec on/30 off","Nordic 2×6","Film review 90min"], notes:"Playoff midfielders run the most and decide the most. Physical peak and tactical preparation must align in weeks 15–16." },
        { week:15, phase:"Peak", focus:"Cup Final Preparation", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint Strides 4×20m","Interval 3×45sec","Ball Touch Drill","Mental prep"], notes:"Cup final week. You have the engine. Your conditioning outlasts theirs in the 80th minute. That is your advantage." },
        { week:16, phase:"Peak", focus:"Match Day", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-Match Activation 20min","Sprint Strides 3×10m","Dynamic Stretch","Ball Warm-Up","Pre-match nutrition"], notes:"Match day. Cover every blade of grass. Press relentlessly. Be the engine that wins it in the last 10 minutes." },
      ]
    },
    "Striker": {
      label: "Striker",
      sport: "Soccer",
      description: "The predator — clinical finishing under pressure, explosive acceleration to get in behind, relentless pressing from the front, and the composure to score when it matters most.",
      phases: [
        { name: "Off-Season Foundation", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Acceleration", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "SC" },
        { name: "Peak / Finals", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Speed Foundation + Hamstring Protection", intensity:"Low (60%)", volume:"High", sessions:4, keyLifts:["A-Skip 4×20m","B-Skip 4×20m","Nordic Hamstring 3×8","Single-Leg Hip Thrust 3×10 each","Stride Mechanics Drill 15min"], notes:"Strikers sprint more maximally than any position — and tear hamstrings more than any position. Hamstring protection from week 1 is non-negotiable." },
        { week:2, phase:"Off-Season", focus:"Lower Body Power + First Step", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","RDL 4×10","Box Jump 3×5","10m Sprint Mechanics ×8","Hip Flexor Strength Circuit"], notes:"First-step quickness is the striker's primary weapon for getting in behind. Build the hip flexor strength and quad explosiveness that powers it." },
        { week:3, phase:"Off-Season", focus:"Power + Shooting Mechanics", intensity:"Mod (70%)", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Sprint 6×30m (80%)","Shot Power Drill 4×8 each foot","Finishing Inside Box 20min"], notes:"Shooting power is a trained quality — hip flexor strength, ankle stability, and contact technique all contribute. Train it as athletically as you train speed." },
        { week:4, phase:"Off-Season", focus:"Deload + Finishing Touch", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Sprint 4×20m (60%)","Finishing Drill 30min (low pressure)","Stretch 20min","Film: movement to create chances"], notes:"Study striker movement — the run to get in behind, the check-and-go, the movement across the defender. Goals are scored before the ball arrives." },
        { week:5, phase:"Pre-Season", focus:"Maximum Acceleration", intensity:"High (80%)", volume:"Mod-High", sessions:5, keyLifts:["10m Sprint ×15 (full recovery)","Squat 5×5","Power Clean 4×4","Box Jump 5×5","Drive Phase Mechanics Drill"], notes:"10-meter acceleration is the striker's most critical physical quality. Every session: 15+ short sprints at 100% with full recovery. Velocity, not endurance." },
        { week:6, phase:"Pre-Season", focus:"Sprint Transition + Contact Finishing", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Sprint-to-Shot Drill 8×","Contact Finish Through Defender 4×8","Squat 4×4 @ 82%","Resisted Sprint 6×15m","Hamstring Circuit"], notes:"Sprint-to-shot: sprint 20m at full speed, receive a pass, shoot in stride without stopping. This is the exact sequence of a striker's most dangerous moment." },
        { week:7, phase:"Pre-Season", focus:"Off-Ball Movement + Goal Sense", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Near-Post Run Drill 6×","Far-Post Run Timing Drill 6×","Squat 4×4 @ 80%","Sprint 6×20m @ 95%","1v1 Finishing vs GK"], notes:"Near-post and far-post runs must be timed to the ball carrier's vision — train the movement patterns that create open goals." },
        { week:8, phase:"Pre-Season", focus:"Pressing + Game Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["High Press Intensity Drill 4×4min","Sprint Recovery Drill 6×","5-on-5 Scrimmage 60min","Squat 3×5","Finishing Under Fatigue 4×8"], notes:"Modern strikers press from the front as a tactical weapon. A striker who presses creates turnovers in dangerous areas — and it requires dedicated fitness." },
        { week:9, phase:"Pre-Season", focus:"Speed Peak + Composure", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Sprint 6×30m @ 100%","10m Acceleration Test ×4","Penalty Kick Routine 20 shots","1v1 vs GK Finishing","Match Composure Drill"], notes:"Peak speed week. Test 10m and 30m times. Also test composure — finish a specific number of quality chances from variety of positions. Measure the conversion rate." },
        { week:10, phase:"Pre-Season", focus:"Season Opener Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Sprint 4×15m","Light Lift 30min","Finishing 30min (light)","Stretch","Mental prep"], notes:"Arrive sharp and hungry. Your acceleration is at peak. Trust your movement to create the chance, trust your technique to finish it." },
        { week:11, phase:"In-Season", focus:"Speed + Power Maintenance", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Sprint 4×15m @ 90%","Squat 3×4 @ 70%","Nordic 3×6","Box Jump 3×4","Finishing Drill 15min"], notes:"Weekly sprint work essential — strikers who stop sprinting in-season lose their most dangerous quality. 15-meter sprints at 90% twice a week." },
        { week:12, phase:"In-Season", focus:"Explosive + Hamstring Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×15m","RDL 3×6","Nordic 2×6","Box Jump 3×4","1v1 Finishing vs GK"], notes:"Hamstring protection in-season: RDL and Nordic curls every session. The hamstring is a striker's most valuable muscle — treat it accordingly." },
        { week:13, phase:"In-Season", focus:"Recovery + Finishing Sharpness", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Easy Run 2km","Hip Flexibility Circuit","Finishing Drill 20min (relaxed)","Stretch 20min","Film: upcoming GK tendencies"], notes:"Study the goalkeeper you face this week — their positioning on near-post shots, reaction to feints, command of crosses. Know where to shoot before you get the ball." },
        { week:14, phase:"In-Season", focus:"Playoff Acceleration Peak", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×15m @ 95%","Squat 3×4","Nordic 2×6","Finishing Under Pressure 4×8","Film review 90min"], notes:"Playoff strikers are decisive. One chance, one goal. Your finishing must be automatic — no hesitation, no second-guessing." },
        { week:15, phase:"Peak", focus:"Cup Final Preparation", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint Strides 4×15m","Box Jump 3×3","Finishing Ritual 15min","Mental prep"], notes:"Cup final week. Visualize every type of chance you might receive. Practice your finishing ritual. Be ready to score the goal that matters." },
        { week:16, phase:"Peak", focus:"Match Day", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-Match Activation 15min","Sprint Strides 3×10m","Dynamic Stretch","Finishing Warm-Up","Pre-match nutrition"], notes:"Match day. Prey on every defensive mistake. Get in behind. Finish clinically. One moment changes everything — be ready for it." },
      ]
    },
    "_default": {
      label: "Soccer Athlete",
      sport: "Soccer",
      description: "Aerobic base, explosive acceleration, technical speed, and injury resilience.",
      phases: [
        { name: "Off-Season Base", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "SC" },
        { name: "Peak / Finals", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Aerobic Base", intensity:"Low (60%)", volume:"High", sessions:5, keyLifts:["Easy Run 5km","Bodyweight Circuit 3×","Single-Leg Balance 3×30sec","Hip Flexor Stretch","Nordic Hamstring 3×8"], notes:"Build aerobic base. Zone 2 heart rate running." },
        { week:2, phase:"Off-Season", focus:"Strength Foundation", intensity:"Low-Mod", volume:"High", sessions:5, keyLifts:["Front Squat 4×8","RDL 4×10","Copenhagen Adductor 3×8","Calf Raise 4×15","Run 4km easy"], notes:"Groin and adductor strength critical for soccer." },
        { week:3, phase:"Off-Season", focus:"Strength + Aerobic", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Hip Thrust 4×10","Sprint 6×40m (80%)","Nordic Hamstring 4×8","Tempo Run 5km"], notes:"Combine strength and aerobic development." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Easy Run 3km","Light Squat 3×8","Hip Mobility Circuit","Stretch 20min","Ball Work 20min"], notes:"Recovery and light ball work." },
        { week:5, phase:"Pre-Season", focus:"Power + Speed", intensity:"High", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×4","Power Clean 4×4","Sprint 8×30m @ 95%","Box Jump 4×5","Acceleration Drill 6×10m"], notes:"Acceleration is the most critical soccer speed quality." },
        { week:6, phase:"Pre-Season", focus:"Speed Endurance", intensity:"High", volume:"High", sessions:5, keyLifts:["Sprint 8×60m @ 90%","Squat 4×4","Lateral Run 4×30m","Interval 6×45sec on/15 off","Nordic 3×8"], notes:"Speed endurance — sprint repeatedly." },
        { week:7, phase:"Pre-Season", focus:"Game Fitness", intensity:"High", volume:"High", sessions:5, keyLifts:["Small-Sided Game 45min","Sprint 6×30m","Squat 3×5","Core Circuit","Hip Mobility"], notes:"Small-sided games build soccer-specific fitness." },
        { week:8, phase:"Pre-Season", focus:"Tactical + Fitness", intensity:"High", volume:"High", sessions:5, keyLifts:["11v11 Scrimmage 60min","Recovery Run 2km","Squat 3×4","Plyometric Circuit","Nordic 3×8"], notes:"Full-game scrimmages." },
        { week:9, phase:"Pre-Season", focus:"Season Sharpening", intensity:"Mod-High", volume:"Mod", sessions:4, keyLifts:["Sprint Test 40m × 4","Squat 3×4 @ 78%","Tactical Drill 30min","Core Circuit","Flexibility"], notes:"Final sharpening." },
        { week:10, phase:"Pre-Season", focus:"Taper", intensity:"Low-Mod", volume:"Low", sessions:3, keyLifts:["Light Run 3km","Sprint Strides 4×20m","Light Lift 30min","Stretch","Mental prep"], notes:"Fresh for match day." },
        { week:11, phase:"In-Season", focus:"Recovery + Maintenance", intensity:"Mod (68%)", volume:"Low", sessions:2, keyLifts:["Recovery Run 3km","Nordic 3×6","Squat 3×4","Core Circuit","Hip Mobility 15min"], notes:"Recovery run day after match critical." },
        { week:12, phase:"In-Season", focus:"Power Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×20m","Box Jump 3×4","RDL 3×6","Nordic 3×6","Core Circuit"], notes:"Maintain explosiveness." },
        { week:13, phase:"In-Season", focus:"Recovery + Activation", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Easy Run 2km","Hip Mobility","Light Squat 3×6","Stretch 20min","Ball Skill 15min"], notes:"Keep legs moving." },
        { week:14, phase:"In-Season", focus:"Playoff Prep", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Sprint 4×20m","Squat 3×4","Nordic 2×6","Plyo 2×5","Film review"], notes:"Final push." },
        { week:15, phase:"Peak", focus:"Cup Final Prep", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Sprint Strides 4×20m","Agility Drill 3 sets","Core Activation","Visualization"], notes:"Trust the base." },
        { week:16, phase:"Peak", focus:"Match Day", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-Match Activation 20min","Sprint Strides 3×10m","Dynamic Stretch","Technical Warm-Up","Pre-match nutrition"], notes:"Execute." },
      ]
    }
  },

  hockey: {
    "_default": {
      label: "Hockey Athlete",
      sport: "Hockey",
      description: "On-ice speed, explosive shifts, elite hip mobility, and the strength to battle along the boards for 60 minutes.",
      phases: [
        { name: "Off-Season Base", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "HK" },
        { name: "Peak / Playoffs", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Hip Mobility + Base Strength", intensity:"Low", volume:"High", sessions:4, keyLifts:["Skating Squat Pattern 4×10","Copenhagen Adductor 3×10","Hip Flexor Mobility Circuit","RDL 4×10","Band Hip Abduction 3×20"], notes:"Hip mobility is the limiting factor for most hockey players. Address it from day 1." },
        { week:2, phase:"Off-Season", focus:"Lower Body Strength", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Front Squat 4×8","Lateral Lunge 3×10 each","Hip Thrust 4×10","Single-Leg Deadlift 3×8","Calf Raise 4×15"], notes:"Hockey-specific movement patterns. Lateral lunge mimics skating stride." },
        { week:3, phase:"Off-Season", focus:"Strength + Power Foundation", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Back Squat 4×8","Power Clean 4×4","Lateral Bound 4×6","Bench Press 4×8","Row 4×10"], notes:"Add power work. Lateral bounds develop the exact push-off pattern of skating." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Hip Mobility Circuit","Skating Strides (dry land)","Core Circuit","Stretch 20min"], notes:"Recovery. Dry-land skating mechanics to maintain movement pattern." },
        { week:5, phase:"Pre-Season", focus:"Max Strength", intensity:"High (82%)", volume:"Mod-High", sessions:5, keyLifts:["Back Squat 5×5","Deadlift 4×5","Push Press 4×5","Weighted Pull-ups 4×5","Hip Thrust 4×6"], notes:"Strength is the foundation of skating speed and board battles." },
        { week:6, phase:"Pre-Season", focus:"Explosive Power", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Power Clean 5×4","Lateral Jump 4×6","Box Squat 5×3","Med Ball Slam 4×8","Speed Skater Jump 4×8"], notes:"Speed skater jumps are the single best dry-land exercise for hockey explosiveness." },
        { week:7, phase:"Pre-Season", focus:"On-Ice Transfer", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Power Clean 4×3","Lateral Bound Max Distance 4×5","Sprint 6×20m","Bench Press 4×4","Core Anti-Rotation"], notes:"Transfer power to the ice. Skating sessions double per week." },
        { week:8, phase:"Pre-Season", focus:"Shift Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["Bike Interval 8×45sec on/90sec off","Squat 3×5","Lateral Slide Board 4×45sec","Pull-ups 4×max","Hip Mobility"], notes:"Shift intervals: 45 seconds ON at max, 90 sec rest = hockey shift simulation." },
        { week:9, phase:"Pre-Season", focus:"Camp Preparation", intensity:"High", volume:"Mod", sessions:4, keyLifts:["Power Clean 3×3","Sprint 6×20m","Squat 3×5 @ 80%","Bike Interval 6×30sec","Skating agility drill"], notes:"Camp-ready. On-ice skating takes priority from here." },
        { week:10, phase:"Pre-Season", focus:"Season Opener Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Light Lift 30min","Sprint Strides","Hip Mobility","Skating warm-up","Mental prep"], notes:"Legs fresh, explosive. Ready for the opening face-off." },
        { week:11, phase:"In-Season", focus:"Strength Maintenance", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4 @ 70%","Hip Thrust 3×5","Pull-ups 3×max","Core Circuit","Hip Mobility 10min"], notes:"2 sessions/week max. Skate hard, lift light, recover fully." },
        { week:12, phase:"In-Season", focus:"Explosive Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Lateral Bound 3×5","Power Clean 2×3","RDL 3×6","Bike Sprint 4×20sec","Core Circuit"], notes:"Keep the fast-twitch firing. 25–35 min sessions only." },
        { week:13, phase:"In-Season", focus:"Recovery + Activation", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Bike 15min easy","Hip Mobility Circuit","Light Squat 3×6","Stretch 20min","Film 45min"], notes:"Recovery week. Game schedule often congested Jan–Feb. Manage carefully." },
        { week:14, phase:"In-Season", focus:"Playoff Preparation", intensity:"Mod (72%)", volume:"Low", sessions:2, keyLifts:["Power Clean 2×3","Squat 3×4","Lateral Jump 3×4","Core Circuit","Skating drill"], notes:"Playoff push. Stay healthy above all else." },
        { week:15, phase:"Peak", focus:"Playoff Performance", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up","Lateral Bound 3×4","Bike Activation 10min","Core Circuit","Mental prep"], notes:"Playoff ice time. Every shift matters. Your conditioning is your advantage." },
        { week:16, phase:"Peak", focus:"Championship Game", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-game Activation 15min","Bike 8min","Hip Mobility","Mental rehearsal","Game-day nutrition"], notes:"Championship. You've put in the work for 16 weeks. Leave it all on the ice." },
      ]
    }
  },

  volleyball: {
    "_default": {
      label: "Volleyball Athlete",
      sport: "Volleyball",
      description: "Elite vertical, explosive approach power, shoulder resilience, and the conditioning for 5-set matches.",
      phases: [
        { name: "Off-Season Base", weeks: "1–4", color: "#6B9FD4", icon: "🏗" },
        { name: "Pre-Season Power", weeks: "5–10", color: "#F0C040", icon: "" },
        { name: "In-Season Maintenance", weeks: "11–14", color: "#4BAE71", icon: "VB" },
        { name: "Peak / Tournament", weeks: "15–16", color: "#BFA16A", icon: "◆" },
      ],
      weeks: [
        { week:1, phase:"Off-Season", focus:"Shoulder Health + Base", intensity:"Low", volume:"High", sessions:4, keyLifts:["Band External Rotation 3×20","Face Pull 4×15","Front Squat 3×10","RDL 3×12","Approach Jump (low) 3×6"], notes:"Shoulder care is the most important off-season investment for volleyball players." },
        { week:2, phase:"Off-Season", focus:"Lower Body + Shoulder Strength", intensity:"Low-Mod", volume:"High", sessions:4, keyLifts:["Back Squat 4×8","Hip Thrust 4×10","DB Shoulder Press 3×10","Pull-ups 3×8","Ankle Plyo Circuit"], notes:"Build the base that will become your vertical. Every pound of squat strength = vertical." },
        { week:3, phase:"Off-Season", focus:"Hypertrophy + Power Introduction", intensity:"Mod", volume:"High", sessions:5, keyLifts:["Squat 4×8","Power Clean 4×4","Box Jump 3×5","Bench Press 4×8","Band Shoulder Circuit"], notes:"Introduce plyometrics. Approach jump mechanics — arm swing timing is trainable." },
        { week:4, phase:"Off-Season", focus:"Deload", intensity:"Low", volume:"Low", sessions:3, keyLifts:["Light Squat 3×8","Shoulder Circuit","Jump practice (easy)","Stretch 20min","Film: serving mechanics"], notes:"Rest and shoulder recovery. Light jump practice for mechanics, not intensity." },
        { week:5, phase:"Pre-Season", focus:"Vertical Power", intensity:"High (80%)", volume:"Mod-High", sessions:5, keyLifts:["Squat 5×5","Power Clean 4×4","Depth Jump 4×6","Approach Jump 5×5","Sprint 4×20m"], notes:"Vertical training blocks — 3 jump sessions per week. Volume builds the ceiling." },
        { week:6, phase:"Pre-Season", focus:"Vertical + Reactive Speed", intensity:"High", volume:"Mod", sessions:5, keyLifts:["Box Jump 5×5","Reactive Jump 4×6","Squat 4×4 @ 83%","Push Press 4×5","Lateral Bound 4×6 each"], notes:"Reactive jumps: land and immediately jump again — develops volleyball timing." },
        { week:7, phase:"Pre-Season", focus:"Sport-Specific Athleticism", intensity:"Mod-High", volume:"Mod", sessions:5, keyLifts:["Approach Vertical Test","Squat 4×4","Plyo Push-Up 4×8","Defensive Dive Drill 3 sets","Core Anti-Rotation"], notes:"Test your vertical. Translate gym power to court performance." },
        { week:8, phase:"Pre-Season", focus:"Match Conditioning", intensity:"High", volume:"High", sessions:5, keyLifts:["5-Set Scrimmage 90min","Squat 3×5","Jump Circuit 3 rounds","Shoulder Circuit","Core Circuit"], notes:"5-set scrimmage — full match simulation. Conditioning should feel automatic." },
        { week:9, phase:"Pre-Season", focus:"Peak Jump Training", intensity:"Max", volume:"Mod", sessions:4, keyLifts:["Approach Jump Test ×5","Power Clean 3×3","Box Jump 4×5","Squat 4×4","Sprint 4×15m"], notes:"Peak jump week. Record your best approach vertical. This is your ceiling." },
        { week:10, phase:"Pre-Season", focus:"Season Taper", intensity:"Mod", volume:"Low", sessions:3, keyLifts:["Light Lift 30min","Jump Activation 3×4","Sprint Strides","Shoulder Care","Mental prep"], notes:"Fresh for opening tournament. Arms should feel loose and explosive." },
        { week:11, phase:"In-Season", focus:"Vertical + Strength Maintenance", intensity:"Mod (70%)", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Box Jump 3×4","Pull-ups 3×max","Shoulder Circuit 4 exercises","Core Circuit"], notes:"2 sessions/week. Jump every session — don't let the vertical decline." },
        { week:12, phase:"In-Season", focus:"Power Maintenance", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Depth Jump 3×5","Power Clean 2×3","RDL 3×6","Push Press 2×5","Core Circuit"], notes:"30–40 min sessions. Sharp and fast, not long and grinding." },
        { week:13, phase:"In-Season", focus:"Shoulder Recovery + Activation", intensity:"Low", volume:"Low", sessions:2, keyLifts:["Shoulder Circuit (care)","Light Squat 3×6","Jump Activation 2×5","Stretch 20min","Film review"], notes:"High serving/hitting volume in tournament season — shoulder care weekly non-negotiable." },
        { week:14, phase:"In-Season", focus:"Tournament Preparation", intensity:"Mod-High", volume:"Low", sessions:2, keyLifts:["Squat 3×4","Box Jump 3×5","Approach Jump 4×4","Core Circuit","Film review"], notes:"Peak alignment with tournament week. Vertical should feel at season-high." },
        { week:15, phase:"Peak", focus:"Tournament Performance", intensity:"Activation", volume:"Minimal", sessions:1, keyLifts:["Dynamic Warm-Up 15min","Jump Activation 3×4","Shoulder Circuit","Sprint 3×15m","Mental prep"], notes:"Tournament. Trust every rep from weeks 1–10. Attack every ball with confidence." },
        { week:16, phase:"Peak", focus:"Championship Tournament", intensity:"Activation only", volume:"Minimal", sessions:1, keyLifts:["Pre-match Warm-Up 20min","Jump Series 3×3","Shoulder Activation","Approach Jumps 3×3","Visualization"], notes:"Championship. Every approach is automatic. Every serve, every block. Execute." },
      ]
    }
  }
};

// Helper: get the right periodization plan for current sport/position
function getPeriodizationPlan(sport, position) {
  const sportPlans = PERIODIZATION_PLANS[sport];
  if (!sportPlans) return null;
  // Try exact position match first, then _default
  return sportPlans[position] || sportPlans["_default"] || null;
}

const SPORT_WORKOUTS = {

  // ════════════════════════════════════════════════════════════
  // FOOTBALL
  // ════════════════════════════════════════════════════════════
  football: {
    _default: {
      "Strength Training": {
        "Full Body": [
          {name:"Power Clean",sets:4,reps:"4",rest:"3min",load:"75-80% 1RM",muscles:"Full posterior chain, traps, core",cues:"Explode from floor, shrug aggressively, catch in quarter squat. Critical for on-field power transfer."},
          {name:"Back Squat",sets:4,reps:"5",rest:"3min",load:"80-85% 1RM",muscles:"Quads, glutes, hamstrings, core",cues:"Bar on traps, knees track toes, depth below parallel. Foundation of football lower body strength."},
          {name:"Bench Press",sets:4,reps:"5",rest:"3min",load:"80-85% 1RM",muscles:"Pectorals, anterior deltoid, triceps",cues:"Retract scapula, feet flat, controlled descent 2sec, explosive press. Essential for blocking and separation."},
          {name:"Barbell Row",sets:4,reps:"6",rest:"2min",load:"70-75% 1RM",muscles:"Lats, rhomboids, rear delts, biceps",cues:"Hinge at hip 45°, pull to lower sternum, squeeze lats at top. Builds pulling strength for tackles."},
          {name:"Romanian Deadlift",sets:3,reps:"8",rest:"2min",load:"65-70% 1RM",muscles:"Hamstrings, glutes, lower back",cues:"Soft knee bend, push hips back, feel hamstring stretch, drive hips forward. Injury prevention essential."},
          {name:"Farmer's Carry",sets:4,reps:"40yd",rest:"90sec",load:"Heavy — challenge grip",muscles:"Forearms, traps, core, legs",cues:"Chest tall, shoulders packed, short fast steps. Builds total body stability and grip for ball security."},
        ],
        "Upper Body": [
          {name:"Bench Press",sets:5,reps:"5",rest:"3min",load:"82-88% 1RM",muscles:"Pectorals, triceps, anterior deltoid",cues:"Arch back, drive feet, bar path slightly diagonal. Maximum pressing power for blocking."},
          {name:"Weighted Pull-Ups",sets:4,reps:"6",rest:"2.5min",load:"BW+25-45lbs",muscles:"Lats, biceps, mid-back",cues:"Dead hang start, drive elbows down and back, chin over bar. Builds pulling power for tackles and separation."},
          {name:"Push Press",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Deltoids, triceps, traps, core",cues:"Dip knees slightly, explode up, lock arms overhead. Develops explosive upper body power."},
          {name:"Barbell Row",sets:4,reps:"6",rest:"2min",load:"75% 1RM",muscles:"Lats, rhomboids, rear delts",cues:"Pull to navel, lead with elbows, control the descent."},
          {name:"Dips — Weighted",sets:3,reps:"8",rest:"2min",load:"BW+25lbs",muscles:"Triceps, pectorals, anterior deltoid",cues:"Lean slightly forward for chest emphasis. Full ROM for strength development."},
          {name:"Face Pulls",sets:3,reps:"15",rest:"60sec",load:"Moderate — feel rear delt",muscles:"Rear deltoids, external rotators, rhomboids",cues:"Pull to forehead, elbows high, external rotate. Critical rotator cuff health for throwing/tackling athletes."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:5,reps:"5",rest:"3min",load:"85% 1RM",muscles:"Quads, glutes, hamstrings, erectors",cues:"Brace core maximally, knees out, sit into squat. King of football lower body exercises."},
          {name:"Romanian Deadlift",sets:4,reps:"6",rest:"2.5min",load:"75% 1RM",muscles:"Hamstrings, glutes, lower back",cues:"Maintain neutral spine, push hips back as far as possible before knee bend."},
          {name:"Bulgarian Split Squat",sets:3,reps:"8 each leg",rest:"2min",load:"DB 35-60lbs each hand",muscles:"Quads, glutes, hip flexors",cues:"Front shin vertical, drop knee toward floor, drive through front heel. Unilateral power for cutting."},
          {name:"Nordic Hamstring Curl",sets:3,reps:"5-6",rest:"2min",load:"Bodyweight",muscles:"Hamstrings (eccentric)",cues:"Control descent as slow as possible. #1 hamstring injury prevention exercise — critical for all football players."},
          {name:"Hip Thrust",sets:4,reps:"10",rest:"90sec",load:"185-275lbs",muscles:"Glutes, hamstrings",cues:"Chin tucked, drive hips to full extension, squeeze hard at top. Sprint speed and power production."},
          {name:"Calf Raises — Single Leg",sets:4,reps:"12",rest:"60sec",load:"DB 35-50lbs",muscles:"Gastrocnemius, soleus",cues:"Full range, pause at bottom. Ankle stability reduces sprain risk."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"Power Clean",sets:5,reps:"3",rest:"3min",load:"80-85% 1RM",muscles:"Full posterior chain, traps",cues:"Maximum explosion from floor. Each rep is independent. Focus on bar speed."},
          {name:"Box Jumps",sets:4,reps:"5",rest:"2min",load:"Bodyweight — 30-36in box",muscles:"Quads, glutes, calves",cues:"Load hips, explode up, land softly with bent knees. Stick landing. Develops reactive lower body power."},
          {name:"40-Yard Sprint",sets:6,reps:"1",rest:"3min full recovery",load:"Max effort each",muscles:"Full body — sprint mechanics",cues:"Drive phase first 10yds, transition to max velocity. Time each rep for tracking."},
          {name:"Lateral Cone Drill",sets:4,reps:"5-yard x3",rest:"90sec",load:"Bodyweight — max speed",muscles:"Glutes, adductors, quads",cues:"Stay low, plant hard outside foot, drive opposite direction. Develops change of direction critical for all positions."},
          {name:"Medicine Ball Rotational Slam",sets:4,reps:"8 each side",rest:"90sec",load:"15-20lb ball",muscles:"Core, obliques, hips, shoulders",cues:"Generate rotation from hips, not arms. Maximum power on each rep. Mimics blocking and tackling rotation."},
          {name:"Sled Push",sets:4,reps:"20yd",rest:"2min",load:"Challenging but maintain form",muscles:"Quads, glutes, calves, core",cues:"Low angle, drive through ground, pump arms. Builds drive phase power and mental toughness."},
        ],
        "Upper Body": [
          {name:"Medicine Ball Chest Pass — Wall",sets:4,reps:"10",rest:"90sec",load:"15-20lb ball",muscles:"Pectorals, triceps, core",cues:"Explosive release, receive and immediately return. Develops upper body rate of force development."},
          {name:"Push Press",sets:5,reps:"4",rest:"2.5min",load:"80-85% 1RM",muscles:"Deltoids, triceps, traps, legs",cues:"Powerful dip and drive, arms lock overhead. Transfers leg power through upper body."},
          {name:"Battle Ropes — Alternating",sets:4,reps:"30sec",rest:"90sec",load:"Heavy ropes, max effort",muscles:"Shoulders, arms, core, cardiovascular",cues:"Hinge at hips, big wave amplitude, breathe through effort. Builds shoulder endurance for late-game strength."},
          {name:"TRX Explosive Row",sets:4,reps:"8",rest:"90sec",load:"Body angle — challenging",muscles:"Lats, rhomboids, biceps",cues:"Explode to row, control return slowly. Reactive pulling strength for tackles."},
          {name:"KB One-Arm Press",sets:3,reps:"8 each",rest:"90sec",load:"50-70lbs KB",muscles:"Deltoid, tricep, stabilizers",cues:"Crush grip, brace core, press from shoulder to lockout. Unilateral pressing stability."},
        ],
        "Lower Body": [
          {name:"Power Clean — Hang Position",sets:5,reps:"3",rest:"3min",load:"75-80% 1RM",muscles:"Hamstrings, glutes, traps, core",cues:"Start at knee height, triple extension (ankle/knee/hip), aggressive shrug."},
          {name:"Box Jumps",sets:5,reps:"5",rest:"2min",load:"30-36in box",muscles:"Quads, glutes, calves",cues:"Full hip extension at top, land controlled. Maximum effort each jump."},
          {name:"Banded Sprint Starts",sets:8,reps:"10yd",rest:"90sec",load:"Heavy resistance band",muscles:"Hip flexors, glutes, quads",cues:"Explosive drive against resistance. Builds start acceleration."},
          {name:"Single-Leg Romanian Deadlift",sets:3,reps:"8 each",rest:"2min",load:"DB 40-60lbs",muscles:"Hamstrings, glutes, stabilizers",cues:"Hinge from hip, keep hips square, feel hamstring stretch. Balance and unilateral strength."},
          {name:"Lateral Bounds",sets:4,reps:"8 each direction",rest:"90sec",load:"Bodyweight",muscles:"Glutes, adductors, calves",cues:"Stick each landing for 1sec. Explosive lateral power for cuts and direction changes."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Squat",sets:4,reps:"8-10",rest:"2min",load:"70-75% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Controlled descent 3sec, drive hard up. Volume accumulation for mass."},
          {name:"Weighted Pull-Ups",sets:4,reps:"8-10",rest:"2min",load:"BW+15-25lbs",muscles:"Lats, biceps, mid-back",cues:"Full ROM, squeeze at top. Build the back width every athlete needs."},
          {name:"DB Incline Press",sets:4,reps:"10-12",rest:"90sec",load:"Challenging DB weight",muscles:"Upper pectorals, deltoids, triceps",cues:"Press to full extension, lower slowly over 3sec. Upper chest development."},
          {name:"Romanian Deadlift",sets:3,reps:"10-12",rest:"2min",load:"65-70% 1RM",muscles:"Hamstrings, glutes",cues:"Feel the stretch, squeeze at top. Posterior chain mass builder."},
          {name:"Cable Core Rotation",sets:3,reps:"12 each side",rest:"60sec",load:"Moderate weight",muscles:"Obliques, transverse abdominis, rotators",cues:"Rotate from hips, brace core throughout. Functional core strength for sport."},
          {name:"Dumbbell Shoulder Press",sets:3,reps:"10-12",rest:"90sec",load:"Challenging DBs",muscles:"Deltoids, triceps",cues:"Press overhead to full extension, control down. Shoulder mass for pads."},
        ],
        "Upper Body": [
          {name:"Incline Barbell Press",sets:4,reps:"8-10",rest:"2min",load:"70-75% 1RM",muscles:"Upper pectorals, deltoids, triceps",cues:"30-45° incline, retract scapula, control descent. Upper chest thickness."},
          {name:"Weighted Pull-Ups",sets:4,reps:"8-10",rest:"2min",load:"BW+20lbs",muscles:"Lats, biceps, rhomboids",cues:"Full dead hang to chin over bar. Width builder."},
          {name:"Lateral Raises",sets:4,reps:"15",rest:"60sec",load:"Light — strict form",muscles:"Medial deltoids",cues:"Lead with elbows, slight forward lean, stop at shoulder height. Wide shoulder cap look."},
          {name:"Hammer Curls",sets:3,reps:"12",rest:"60sec",load:"Moderate DBs",muscles:"Biceps, brachialis, forearms",cues:"Neutral grip, control throughout. Arm thickness and grip strength."},
          {name:"Skull Crushers",sets:3,reps:"12",rest:"60sec",load:"EZ-bar moderate weight",muscles:"Triceps long head",cues:"Elbows fixed, lower to forehead slowly, explode up. Tricep mass."},
          {name:"Face Pulls",sets:3,reps:"15",rest:"60sec",load:"Light — feel rear delts",muscles:"Rear deltoids, external rotators",cues:"High attachment, pull to face level, elbows high. Rotator cuff health essential."},
          {name:"Cable Rows — Wide Grip",sets:4,reps:"10-12",rest:"90sec",load:"Moderate stack",muscles:"Upper back, rhomboids, rear delts",cues:"Sit tall, pull to lower chest, squeeze shoulder blades together."},
        ],
        "Lower Body": [
          {name:"Hack Squat",sets:4,reps:"10-12",rest:"2min",load:"Moderate-heavy",muscles:"Quads, glutes",cues:"Feet shoulder-width, full depth, drive through heels. Quad development without spinal load."},
          {name:"Romanian Deadlift",sets:4,reps:"10-12",rest:"2min",load:"65-70% 1RM",muscles:"Hamstrings, glutes, lower back",cues:"Maximum hip hinge, feel hamstring stretch throughout."},
          {name:"Leg Press",sets:3,reps:"12-15",rest:"90sec",load:"Heavy",muscles:"Quads, glutes",cues:"Feet at shoulder width, don't lock knees. High volume quad work."},
          {name:"Bulgarian Split Squat",sets:3,reps:"10 each",rest:"90sec",load:"DB 30-50lbs each",muscles:"Quads, glutes, hip flexors",cues:"Deep stretch at bottom, drive through front foot. Single-leg strength balance."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Loaded barbell",muscles:"Glutes, hamstrings",cues:"Full hip extension, glute squeeze at top. Glute mass and sprint power."},
          {name:"Lying Leg Curl",sets:4,reps:"12",rest:"60sec",load:"Moderate",muscles:"Hamstrings (isolation)",cues:"Squeeze at top, slow controlled descent. Hamstring isolation and injury prevention."},
          {name:"Tibialis Raise",sets:3,reps:"15",rest:"45sec",load:"Bodyweight/banded",muscles:"Tibialis anterior",cues:"Heel on floor, raise toes up and hold. Shin and ankle injury prevention."},
        ],
      },
    },

    // Position overrides — these REPLACE the default for specific positions
    "Quarterback": {
      "Strength Training": {
        "Full Body": [
          {name:"Power Clean — Hang",sets:4,reps:"4",rest:"3min",load:"70-75% 1RM",muscles:"Posterior chain, traps, core",cues:"QBs need rotational power transfer. Clean from hang to maintain hip mobility."},
          {name:"Back Squat",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Controlled, focus on staying upright. Builds lower body base for pocket movement."},
          {name:"Rotational Medicine Ball Throw",sets:4,reps:"8 each side",rest:"90sec",load:"10-15lb ball",muscles:"Core, hips, obliques, shoulders",cues:"Drive rotation from hips, not arms. Directly transfers to throwing mechanics."},
          {name:"Landmine Press",sets:4,reps:"8 each arm",rest:"2min",load:"45-90lbs on bar",muscles:"Deltoids, pectorals, core",cues:"Single arm, rotational press. More shoulder-friendly and sport-specific than flat bench."},
          {name:"Single-Leg RDL",sets:3,reps:"8 each",rest:"90sec",load:"DB 30-50lbs",muscles:"Hamstrings, glutes, balance",cues:"Hip hinge, keep hips square. Develops drop-step stability for pocket movement."},
          {name:"Wrist Flexion & Extension",sets:3,reps:"20 each direction",rest:"45sec",load:"Light plate",muscles:"Forearm flexors/extensors",cues:"Controlled. Finger and wrist health for ball grip."},
        ],
        "Upper Body": [
          {name:"Rotational MB Chest Pass",sets:4,reps:"8 each side",rest:"90sec",load:"10lb ball",muscles:"Core, chest, shoulders",cues:"Step into throw, rotate from hips. Most sport-specific upper body exercise for QBs."},
          {name:"DB Bench Press",sets:4,reps:"8",rest:"2min",load:"Moderate-heavy DBs",muscles:"Pectorals, deltoids, triceps",cues:"DBs allow natural shoulder rotation — safer for QB shoulder health than barbell."},
          {name:"Cable External Rotation",sets:3,reps:"15 each arm",rest:"60sec",load:"Light — 5-15lbs",muscles:"Infraspinatus, teres minor (rotator cuff)",cues:"Elbow at 90°, rotate away from body. Highest priority exercise for QB shoulder longevity."},
          {name:"Prone Y-T-W Raises",sets:3,reps:"12 each position",rest:"60sec",load:"2.5-5lb plates",muscles:"Lower traps, rhomboids, rear delts",cues:"Lie face down on bench, raise arms to Y, T, W positions. Scapular stability for accurate throwing."},
          {name:"Band Pull-Apart",sets:4,reps:"20",rest:"45sec",load:"Light resistance band",muscles:"Rear delts, external rotators, rhomboids",cues:"Arms at shoulder height, pull band to chest, control return. Daily shoulder health maintenance."},
          {name:"Wrist Roller",sets:3,reps:"Full roll up and down",rest:"45sec",load:"5-10lbs",muscles:"Forearms, wrists",cues:"Slow controlled rolling. Grip and wrist endurance for throwing throughout game."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Full depth, upright torso. Pocket presence and scramble ability."},
          {name:"Nordic Hamstring Curl",sets:3,reps:"5",rest:"2min",load:"Bodyweight",muscles:"Hamstrings — eccentric",cues:"Slow descent as long as possible. #1 hamstring injury prevention."},
          {name:"Single-Leg Box Step-Up",sets:3,reps:"10 each leg",rest:"90sec",load:"DB 25-45lbs each hand",muscles:"Quads, glutes, balance",cues:"Drive through stepping foot only. Unilateral leg strength for scrambling."},
          {name:"Hip Flexor March — Banded",sets:3,reps:"20 each leg",rest:"60sec",load:"Light resistance band",muscles:"Hip flexors, core",cues:"Drive knee up against band resistance. Drop-back hip flexor health and strength."},
          {name:"Lateral Band Walk",sets:3,reps:"20 each direction",rest:"60sec",load:"Medium resistance band",muscles:"Glutes medius, hip abductors",cues:"Stay low, consistent tension on band. Lateral movement stability."},
          {name:"Calf Raises — Single Leg",sets:3,reps:"15 each",rest:"60sec",load:"DB 25-35lbs",muscles:"Gastrocnemius, soleus",cues:"Full ROM. Ankle stability for planting and throwing."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"5-10-5 Pro Agility Drill",sets:8,reps:"1 rep",rest:"90sec full recovery",load:"Max effort",muscles:"Quads, glutes, adductors, CNS",cues:"Stay low in breaks, plant hard outside foot, drive back. Time every rep."},
          {name:"Drop-Back Footwork Ladder",sets:5,reps:"5-step drop x6",rest:"2min",load:"Bodyweight with ball",muscles:"Hip flexors, calves, coordination",cues:"Quick feet, maintain body lean, eyes downfield. QB-specific footwork pattern."},
          {name:"Rotational Power — Landmine",sets:4,reps:"6 each side",rest:"90sec",load:"45-70lbs on bar",muscles:"Core, hips, obliques",cues:"Rotate from ground up, not just arms. Throwing power comes from ground reaction."},
          {name:"60yd Shuttle Run",sets:4,reps:"1",rest:"3min",load:"Max effort",muscles:"Full cardiovascular and muscular",cues:"Drive at each cone, stay low. Late-game conditioning and decision-making under fatigue."},
          {name:"Jump Rope — Double Unders",sets:5,reps:"30sec",rest:"60sec",load:"Speed rope",muscles:"Calves, coordination, cardiovascular",cues:"Tight wrist rotation, light on feet. Footwork coordination and ankle conditioning."},
        ],
        "Upper Body": [
          {name:"Band Throwing Simulation",sets:4,reps:"15 each arm",rest:"60sec",load:"Medium resistance band",muscles:"Deltoids, triceps, rotator cuff",cues:"Mimic exact throwing motion against band resistance. Most specific upper body drill."},
          {name:"Medicine Ball Overhead Throw — Wall",sets:4,reps:"10",rest:"90sec",load:"10-12lb ball",muscles:"Core, triceps, deltoids",cues:"Generate power from hips and core, finish with wrist snap. Builds throwing power."},
          {name:"Push-Up Variations Circuit",sets:3,reps:"10 each variation",rest:"60sec",load:"Bodyweight",muscles:"Chest, triceps, shoulders, core",cues:"Wide, close, explosive clap push-ups. Upper body conditioning with shoulder safety."},
          {name:"Face Pulls",sets:3,reps:"20",rest:"45sec",load:"Light cable",muscles:"Rear delts, rotator cuff",cues:"Daily shoulder health. Cannot skip this."},
        ],
        "Lower Body": [
          {name:"Drop-Back Sprint 10yd",sets:8,reps:"1",rest:"90sec",load:"Max speed",muscles:"Hip flexors, glutes, hamstrings",cues:"Explosive first step backward, transition forward. Game-speed pocket escape."},
          {name:"Lateral Shuffle 5yd x4",sets:6,reps:"1",rest:"90sec",load:"Bodyweight",muscles:"Adductors, glutes, quads",cues:"Stay low, never cross feet, quick shuffle. Pocket movement under pressure."},
          {name:"Single-Leg Squat — Pistol",sets:3,reps:"6 each",rest:"90sec",load:"Bodyweight to assisted",muscles:"Quads, glutes, balance",cues:"Reach opposite leg forward, sit back into single leg. Balance and landing stability."},
          {name:"Ankle Mobilization Circuit",sets:2,reps:"10 each direction",rest:"45sec",load:"Bodyweight",muscles:"Ankle stabilizers",cues:"Circles, dorsiflexion, plantar flexion. Ankle health for planting on artificial turf."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"DB Squat",sets:4,reps:"10",rest:"2min",load:"Heavy DBs",muscles:"Quads, glutes",cues:"Goblet or hex bar preferred — protects QB spine. Full depth."},
          {name:"Seated Cable Row",sets:4,reps:"12",rest:"90sec",load:"Moderate stack",muscles:"Lats, rhomboids, mid-back",cues:"Sit tall, row to lower chest, squeeze hard. Upper back mass for jersey fill."},
          {name:"DB Shoulder Press",sets:4,reps:"10",rest:"90sec",load:"Challenging DBs",muscles:"Deltoids, triceps",cues:"DBs allow slight pronation at top — safer than barbell overhead for QB shoulders."},
          {name:"DB Romanian Deadlift",sets:3,reps:"12",rest:"2min",load:"Heavy DBs",muscles:"Hamstrings, glutes",cues:"Hip hinge, feel stretch, drive hips. Posterior chain mass."},
          {name:"Dumbbell Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps",cues:"Supinate at top. Arm size helps fill out jersey."},
          {name:"Tricep Rope Pushdown",sets:3,reps:"15",rest:"60sec",load:"Moderate cable",muscles:"Triceps",cues:"Elbows at sides, full extension. Tricep definition."},
        ],
        "Upper Body": [
          {name:"DB Incline Press",sets:4,reps:"10",rest:"2min",load:"Heavy DBs",muscles:"Upper chest, deltoids, triceps",cues:"DBs preferred — natural shoulder path. Upper chest mass."},
          {name:"Wide-Grip Lat Pulldown",sets:4,reps:"12",rest:"90sec",load:"Moderate stack",muscles:"Lats, biceps",cues:"Pull to upper chest, lean back slightly. Back width."},
          {name:"DB Lateral Raise",sets:4,reps:"15",rest:"60sec",load:"15-25lbs",muscles:"Medial deltoid",cues:"Raise to shoulder height, control descent. Shoulder cap width."},
          {name:"EZ-Bar Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps, brachialis",cues:"Controlled throughout, squeeze at top."},
          {name:"Overhead Tricep Extension",sets:3,reps:"12",rest:"60sec",load:"Moderate cable or EZ-bar",muscles:"Triceps long head",cues:"Elbows fixed by ears, extend fully. Arm development."},
          {name:"External Rotation Cable",sets:3,reps:"20 each arm",rest:"45sec",load:"Light",muscles:"Rotator cuff",cues:"Health priority — never skip. Non-negotiable for QB shoulder maintenance."},
        ],
        "Lower Body": [
          {name:"Goblet Squat",sets:4,reps:"12",rest:"90sec",load:"Heavy KB or DB",muscles:"Quads, glutes, core",cues:"Elbows in at bottom, drive up. Safer squat variation with excellent depth for QBs."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"2min",load:"Heavy DBs or barbell",muscles:"Hamstrings, glutes",cues:"Maximum hamstring stretch. Posterior chain development."},
          {name:"Leg Press",sets:3,reps:"15",rest:"90sec",load:"Heavy",muscles:"Quads, glutes",cues:"Full depth, don't lock knees. Leg mass without axial spinal loading."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Barbell 135-225lbs",muscles:"Glutes, hamstrings",cues:"Full hip extension, hold 1sec at top. Glute strength for scrambling ability."},
          {name:"Calf Raise Machine",sets:4,reps:"15",rest:"60sec",load:"Heavy",muscles:"Gastrocnemius, soleus",cues:"Full ROM, pause at stretch. Calf development and ankle stability."},
        ],
      },
    },

    "Offensive Lineman": {
      "Strength Training": {
        "Full Body": [
          {name:"Back Squat",sets:5,reps:"3-5",rest:"4min",load:"88-95% 1RM",muscles:"Full lower body, core, back",cues:"Maximum load. Offensive linemen need the highest strength levels in football. No depth compromise."},
          {name:"Deadlift",sets:5,reps:"3-5",rest:"4min",load:"88-95% 1RM",muscles:"Full posterior chain",cues:"Conventional or sumo based on hip structure. This is your primary strength builder. Straps allowed for max sets."},
          {name:"Bench Press",sets:5,reps:"3-5",rest:"4min",load:"88-95% 1RM",muscles:"Pectorals, triceps, deltoids",cues:"Arch hard, leg drive, maximum bar speed on way up. Blocking strength directly relates to bench press numbers."},
          {name:"Barbell Row",sets:4,reps:"5",rest:"3min",load:"80-85% 1RM",muscles:"Lats, rhomboids, mid-back",cues:"Heavy rows build the back thickness needed for blocking. Pull to navel."},
          {name:"Power Clean",sets:4,reps:"3",rest:"3min",load:"75-80% 1RM",muscles:"Full posterior chain, explosiveness",cues:"Hip extension explosiveness translates to drive blocking. Perfect technique mandatory."},
          {name:"Farmer's Carry — Heavy",sets:4,reps:"50yd",rest:"2min",load:"120-200lbs each hand",muscles:"Full body — grip, traps, core, legs",cues:"Heaviest farmer's carries in the program. Grip and structural strength. Essential for linemen."},
        ],
        "Upper Body": [
          {name:"Bench Press",sets:6,reps:"3-5",rest:"4min",load:"90-95% 1RM",muscles:"Pectorals, triceps, anterior deltoid",cues:"Linemen should target 400+ lb bench. Blocking power is directly correlated. Max effort."},
          {name:"Weighted Dips",sets:4,reps:"6-8",rest:"3min",load:"BW+90-135lbs",muscles:"Triceps, chest, anterior deltoid",cues:"Heavy weighted dips for lockout strength. Extends blocking power."},
          {name:"Close-Grip Bench Press",sets:4,reps:"6",rest:"3min",load:"80% 1RM",muscles:"Triceps, chest",cues:"Shoulder-width grip, elbows 45° out. Tricep lockout strength for sustaining blocks."},
          {name:"DB Row — Heavy",sets:4,reps:"8 each",rest:"2.5min",load:"100-150lbs DB",muscles:"Lats, rhomboids, mid-back",cues:"Elbow drives back, full ROM. Pulling strength creates blocking stability."},
          {name:"Overhead Press",sets:4,reps:"5",rest:"3min",load:"80-85% 1RM",muscles:"Deltoids, triceps, upper back",cues:"Strict press, no leg drive. Shoulder stability for hand fighting."},
          {name:"Shrugs — Barbell",sets:4,reps:"10",rest:"90sec",load:"Heavy barbell",muscles:"Traps, upper back",cues:"Full elevation, hold at top 1sec. Trap development for neck and shoulder protection."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:6,reps:"3-5",rest:"4min",load:"90-95% 1RM",muscles:"Full lower body",cues:"Linemen should target 500+ lb squat. No shortcuts. No parallel — below depth."},
          {name:"Deadlift",sets:5,reps:"3",rest:"4min",load:"90-95% 1RM",muscles:"Full posterior chain",cues:"Maximum pulling strength. Directly relates to drive blocking and run blocking success."},
          {name:"Leg Press",sets:4,reps:"10",rest:"3min",load:"Maximum — 8+ plates each side",muscles:"Quads, glutes",cues:"High foot placement, deep ROM. Supplemental quad work after heavy squats."},
          {name:"Romanian Deadlift",sets:4,reps:"8",rest:"2.5min",load:"75-80% 1RM",muscles:"Hamstrings, glutes",cues:"Hamstring strength critical for short-area power and pass protection."},
          {name:"Hip Thrust",sets:4,reps:"10",rest:"2min",load:"315-405lbs",muscles:"Glutes, hamstrings",cues:"Highest hip thrust loads in the program. Glute power for drive blocking."},
          {name:"Walking Lunge — Loaded",sets:3,reps:"20yd",rest:"2min",load:"DB 60-80lbs each hand",muscles:"Quads, glutes, balance",cues:"Deep lunge, stay upright. Unilateral strength for base-setting in pass protection."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"Short Shuttle — 10yd",sets:8,reps:"1",rest:"2min",load:"Max effort",muscles:"Quads, glutes, first-step quickness",cues:"Drive off line, short choppy steps. First 10 yards is the entire game for linemen."},
          {name:"Power Clean",sets:5,reps:"3",rest:"3min",load:"85% 1RM",muscles:"Full body explosive",cues:"Hip explosion is blocking explosion. Maximum bar speed."},
          {name:"Sled Push — Heavy",sets:5,reps:"10yd",rest:"2min",load:"Heavy — struggle to move it",muscles:"Full body drive",cues:"Low position, drive into sled with legs. Exactly mimics drive blocking."},
          {name:"Sled Pull — Face Away",sets:5,reps:"10yd",rest:"2min",load:"Heavy",muscles:"Full body pull",cues:"Lean away from sled, drive hips, pump arms. Drive blocking finish."},
          {name:"Lateral Shuffle — Low",sets:4,reps:"10yd each direction",rest:"90sec",load:"Resistance band around waist",muscles:"Glutes medius, adductors, quads",cues:"Stay low the entire time — lineman's stance. Lateral pass protection movement."},
          {name:"Broad Jump",sets:4,reps:"5",rest:"2min",load:"Bodyweight",muscles:"Full lower body explosive",cues:"Swing arms, load hips, maximum horizontal distance. Explosive power measurement."},
        ],
        "Upper Body": [
          {name:"Towel Pull-Up",sets:4,reps:"6-8",rest:"2min",load:"Bodyweight to weighted",muscles:"Lats, biceps, forearms/grip",cues:"Grip towels instead of bar — simulates jersey grip in pass rush defense."},
          {name:"Bench Press — Speed Work",sets:8,reps:"3",rest:"60sec",load:"50-60% 1RM — bar speed priority",muscles:"Pectorals, triceps",cues:"Explosive as possible on every rep. Dynamic effort builds rate of force development."},
          {name:"Hand Fight Drill — Band Resistance",sets:4,reps:"30sec",rest:"90sec",load:"Partner or band",muscles:"Forearms, wrists, deltoids",cues:"Simulate punch and reset. Punch technique and hand fighting endurance."},
          {name:"KB Bottoms-Up Press",sets:3,reps:"8 each",rest:"2min",load:"25-40lb KB",muscles:"Shoulder stabilizers, rotator cuff",cues:"Keep KB balanced, brace everything. Wrist and shoulder stability for blocking."},
        ],
        "Lower Body": [
          {name:"Jump Squat",sets:5,reps:"5",rest:"2.5min",load:"25-30% 1RM",muscles:"Quads, glutes, calves",cues:"Explode up from squat, land softly. Maximum rate of force development."},
          {name:"Single-Leg Press — Explosive",sets:4,reps:"6 each",rest:"2min",load:"Moderate — explosive",muscles:"Quads, glutes",cues:"Drive leg explosively. Single leg power for pass protection steps."},
          {name:"Hip Thrust — Banded",sets:4,reps:"12",rest:"90sec",load:"Heavy bar + bands",muscles:"Glutes, hamstrings",cues:"Band adds accommodating resistance at lockout. Explosive glute power."},
          {name:"Sled Backward Drag",sets:5,reps:"15yd",rest:"90sec",load:"Heavy",muscles:"Hamstrings, glutes",cues:"Stay low, drive through heels. Pass protection drop-step mechanics."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Back Squat",sets:5,reps:"8-10",rest:"2.5min",load:"70-75% 1RM",muscles:"Quads, glutes, hamstrings",cues:"High volume for mass accumulation. Linemen need to be big and strong. No reps cut short."},
          {name:"Bench Press",sets:5,reps:"8-10",rest:"2.5min",load:"70-75% 1RM",muscles:"Pectorals, triceps",cues:"Full ROM, controlled descent. Volume builds the mass needed at the position."},
          {name:"Barbell Row",sets:4,reps:"10-12",rest:"2min",load:"65-70% 1RM",muscles:"Lats, rhomboids, mid-back",cues:"Build the thick back every elite lineman has."},
          {name:"Romanian Deadlift",sets:4,reps:"10-12",rest:"2min",load:"65-70% 1RM",muscles:"Hamstrings, glutes",cues:"Posterior chain mass for sustained blocks."},
          {name:"Dips — Weighted",sets:4,reps:"10-12",rest:"90sec",load:"BW+45-90lbs",muscles:"Triceps, chest",cues:"Chest mass and arm size for the position."},
          {name:"Shrugs",sets:4,reps:"15",rest:"60sec",load:"Heavy",muscles:"Upper traps",cues:"Massive trap development for neck protection and imposing presence."},
        ],
        "Upper Body": [
          {name:"Incline Barbell Press",sets:5,reps:"8-10",rest:"2.5min",load:"70-75% 1RM",muscles:"Upper chest, deltoids",cues:"Upper chest mass for commanding physical presence."},
          {name:"Cable Row — Heavy",sets:4,reps:"10",rest:"2min",load:"Heavy stack",muscles:"Mid-back, lats, rhomboids",cues:"Thick back is the lineman's trademark."},
          {name:"Lateral Raises",sets:4,reps:"15",rest:"60sec",load:"25-35lbs",muscles:"Medial deltoids",cues:"Wide shoulder cap appearance."},
          {name:"Barbell Curl",sets:4,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps",cues:"Arm mass. Grip and elbow health."},
          {name:"Close-Grip Bench Press",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Triceps, inner chest",cues:"Tricep mass for arm extension in blocking."},
          {name:"Shrugs — DB",sets:4,reps:"15",rest:"60sec",load:"Heavy DBs",muscles:"Traps, upper back",cues:"Full elevation, neck protection mass."},
          {name:"Preacher Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps, brachialis",cues:"Peak contraction bicep work."},
        ],
        "Lower Body": [
          {name:"Leg Press",sets:5,reps:"12-15",rest:"2min",load:"Maximum plates",muscles:"Quads, glutes",cues:"Highest volume leg press in any sport program. Build the leg mass to hold the point of attack."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"2min",load:"Barbell heavy",muscles:"Hamstrings, glutes",cues:"Posterior chain mass."},
          {name:"Hack Squat",sets:4,reps:"12",rest:"2min",load:"Heavy",muscles:"Quads",cues:"Supplemental quad volume. Linemen need thick quads."},
          {name:"Leg Curl — Lying",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings",cues:"Isolation for hamstring size and health."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Barbell heavy",muscles:"Glutes",cues:"Powerful glutes for drive blocking and run game."},
          {name:"Seated Calf Raise",sets:4,reps:"15",rest:"60sec",load:"Heavy",muscles:"Soleus",cues:"Calf mass for lower leg size and ankle stability."},
          {name:"Standing Calf Raise",sets:4,reps:"15",rest:"60sec",load:"Heavy",muscles:"Gastrocnemius",cues:"Full ROM, pause at bottom stretch."},
        ],
      },
    },

    "Wide Receiver": {
      "Strength Training": {
        "Full Body": [
          {name:"Power Clean — Hang",sets:4,reps:"4",rest:"2.5min",load:"70-75% 1RM",muscles:"Posterior chain, traps",cues:"Explosive hip extension for route acceleration. WRs need power-to-weight ratio, not max strength."},
          {name:"Box Jump",sets:4,reps:"6",rest:"2min",load:"36in box",muscles:"Quads, glutes, calves",cues:"Maximum height, stick landing. Vertical jump directly relates to jump ball wins."},
          {name:"Single-Leg Squat",sets:3,reps:"8 each",rest:"2min",load:"BW or light DBs",muscles:"Quads, glutes, balance",cues:"Landing stability for routes and jump catches. Balance critical."},
          {name:"Pull-Ups — Weighted",sets:4,reps:"6",rest:"2min",load:"BW+15-25lbs",muscles:"Lats, biceps, grip",cues:"Full dead hang. Upper body pulling strength for contested catches."},
          {name:"Hip Thrust",sets:4,reps:"10",rest:"90sec",load:"Heavy barbell",muscles:"Glutes, hamstrings",cues:"Glute power drives route acceleration off the line."},
          {name:"Core: Anti-Rotation Press",sets:3,reps:"12 each side",rest:"60sec",load:"Light-moderate cable",muscles:"Core stabilizers, obliques",cues:"Brace hard, resist rotation. Core stability for catches in traffic."},
        ],
        "Upper Body": [
          {name:"DB Bench Press",sets:4,reps:"8",rest:"2min",load:"Moderate-heavy DBs",muscles:"Pectorals, deltoids, triceps",cues:"Balanced pressing. WRs don't need a huge bench — focus on shoulder health and stability."},
          {name:"Pull-Ups",sets:5,reps:"8",rest:"90sec",load:"BW to BW+10lbs",muscles:"Lats, biceps, core",cues:"Strong back for strong hands. Pulling strength aids in contested catch scenarios."},
          {name:"Rotator Cuff Circuit",sets:3,reps:"15 each direction",rest:"45sec",load:"Light band or cable",muscles:"Rotator cuff muscles",cues:"External rotation, internal rotation, abduction. Shoulder health is a WR's career."},
          {name:"Pinch Grip Carries",sets:3,reps:"20yd",rest:"90sec",load:"45lb plates",muscles:"Forearms, finger flexors",cues:"Grip two plates between fingers. Finger and hand strength for ball security."},
          {name:"Cable Face Pull",sets:3,reps:"20",rest:"45sec",load:"Light",muscles:"Rear delts, external rotators",cues:"Shoulder longevity. Essential for high-volume route running athletes."},
        ],
        "Lower Body": [
          {name:"Bulgarian Split Squat",sets:4,reps:"8 each",rest:"2min",load:"DB 30-50lbs",muscles:"Quads, glutes, hip flexors",cues:"Single leg power for route breaks. Explosive drive off break = separation."},
          {name:"Nordic Hamstring Curl",sets:3,reps:"5",rest:"2.5min",load:"Bodyweight",muscles:"Hamstrings — eccentric",cues:"Most important exercise for hamstring injury prevention in speed athletes."},
          {name:"Power Clean — Hang",sets:4,reps:"3",rest:"2.5min",load:"70% 1RM",muscles:"Full posterior chain",cues:"Explosive hip extension for acceleration."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy",muscles:"Glutes, hamstrings",cues:"Glute power for sprint acceleration. Non-negotiable for speed development."},
          {name:"Single-Leg Box Jump",sets:3,reps:"5 each leg",rest:"2min",load:"24-30in box",muscles:"Quads, glutes, calves",cues:"Single leg explosive power for jump ball situations."},
          {name:"Ankle Mobilization",sets:2,reps:"15 each direction",rest:"30sec",load:"Bodyweight",muscles:"Ankle stabilizers",cues:"Ankle health critical for cutting and planting on turf."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"40-Yard Dash — Full Sprint",sets:6,reps:"1",rest:"4min full recovery",load:"Max effort",muscles:"Full body sprint mechanics",cues:"Drive phase first 10yds, max velocity to 40. Every 10th of a second counts."},
          {name:"Route Running Drill: In-Out-Post",sets:5,reps:"3 routes",rest:"2min",load:"Bodyweight — game speed",muscles:"Hip flexors, glutes, quads",cues:"Full speed into each break, precise footwork at stem. Sell the route."},
          {name:"Reactive Agility — Tennis Ball Drop",sets:6,reps:"1",rest:"90sec",load:"Coach or partner",muscles:"Reaction time, full body",cues:"React to ball drop, catch before second bounce. Trains hand-eye and first-step quickness."},
          {name:"Vertical Jump — Approach",sets:5,reps:"3",rest:"2min",load:"Max height",muscles:"Quads, glutes, calves, arms",cues:"Two-step approach, plant-jump-reach. Contest catches in end zone."},
          {name:"Lateral Bound — Stick Landing",sets:4,reps:"6 each direction",rest:"90sec",load:"Bodyweight",muscles:"Glutes, adductors, quads",cues:"Stick each landing for 2sec. Deceleration and cutting power."},
        ],
        "Upper Body": [
          {name:"Plyometric Push-Up",sets:4,reps:"8",rest:"90sec",load:"Bodyweight",muscles:"Chest, triceps, shoulders",cues:"Explosive push, hands leave ground. Upper body power for stiff-arm and blocking off."},
          {name:"Band Resistance Hand Fight",sets:4,reps:"30sec",rest:"60sec",load:"Resistance bands",muscles:"Forearms, deltoids, grip",cues:"Simulate jam release and hand fighting off press coverage."},
          {name:"Grip Training — Rice Bucket",sets:3,reps:"60sec",rest:"45sec",load:"Rice bucket",muscles:"Finger flexors, forearms",cues:"Open and close hand in rice. Hand health and grip for catches in rain."},
        ],
        "Lower Body": [
          {name:"Cone Drill — 3-Cone L",sets:6,reps:"1 each direction",rest:"2min",load:"Max speed",muscles:"Quads, glutes, hip flexors",cues:"Low center of gravity through cuts, accelerate out. Tests COD ability at WR position."},
          {name:"Sprint — Flying 20",sets:6,reps:"1",rest:"3min",load:"Max velocity",muscles:"Full sprint mechanics",cues:"Build to top speed before timing zone. Trains max velocity maintenance."},
          {name:"Hip Flexor Sprint Drill",sets:4,reps:"20yd high-knees",rest:"90sec",load:"Resistance band optional",muscles:"Hip flexors, core",cues:"Knee drive for stride length. Hip flexor power increases speed."},
          {name:"Depth Jump",sets:4,reps:"5",rest:"2min",load:"18-24in box",muscles:"Quads, calves, reactive power",cues:"Step off box, land and immediately explode up. Reactive strength for route cuts."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Squat",sets:4,reps:"10",rest:"2min",load:"65-70% 1RM",muscles:"Quads, glutes, hamstrings",cues:"WRs build enough strength for function — not max size. Lean mass only."},
          {name:"DB Bench Press",sets:4,reps:"10",rest:"90sec",load:"Moderate DBs",muscles:"Pectorals, deltoids",cues:"Functional upper body mass without restricting route-running mobility."},
          {name:"Pull-Up — Volume",sets:4,reps:"10-12",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Back width and pulling strength. Essential for contested catches."},
          {name:"Romanian Deadlift",sets:3,reps:"12",rest:"90sec",load:"Moderate barbell",muscles:"Hamstrings, glutes",cues:"Posterior chain without excessive mass accumulation."},
          {name:"Bicep Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate DBs",muscles:"Biceps",cues:"Arm development for jersey appearance and ball-carrying strength."},
          {name:"Core: Pallof Press",sets:3,reps:"12 each side",rest:"60sec",load:"Light cable",muscles:"Core, obliques",cues:"Resist rotation. Core stability for balance in jump ball situations."},
        ],
        "Upper Body": [
          {name:"DB Incline Press",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Upper chest",cues:"Upper chest development without excessive bulk."},
          {name:"Cable Row",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Mid-back",cues:"Back thickness for physical play."},
          {name:"Lateral Raise",sets:4,reps:"15",rest:"60sec",load:"Light-moderate",muscles:"Medial deltoid",cues:"Shoulder width without bulk."},
          {name:"Hammer Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps, brachialis, forearms",cues:"Grip strength for ball security."},
          {name:"Tricep Pushdown",sets:3,reps:"15",rest:"60sec",load:"Moderate cable",muscles:"Triceps",cues:"Arm definition."},
        ],
        "Lower Body": [
          {name:"Bulgarian Split Squat",sets:4,reps:"12 each",rest:"90sec",load:"Moderate DBs",muscles:"Quads, glutes",cues:"Single leg mass development for explosive legs."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings, glutes",cues:"Lean leg muscle without bulk."},
          {name:"Leg Press",sets:3,reps:"15",rest:"90sec",load:"Moderate",muscles:"Quads",cues:"Supplemental quad work. Keep it functional."},
          {name:"Hip Thrust",sets:4,reps:"15",rest:"60sec",load:"Moderate barbell",muscles:"Glutes",cues:"Glute development for acceleration."},
          {name:"Calf Raise",sets:4,reps:"15",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Calf definition and ankle strength for cutting."},
        ],
      },
    },
  },

  // ════════════════════════════════════════════════════════════
  // BASKETBALL
  // ════════════════════════════════════════════════════════════
  basketball: {
    _default: {
      "Strength Training": {
        "Full Body": [
          {name:"Hang Clean",sets:4,reps:"4",rest:"3min",load:"70-75% 1RM",muscles:"Posterior chain, traps, core",cues:"Hip explosion translates to jumping and explosive first steps. Technical excellence required."},
          {name:"Back Squat",sets:4,reps:"5",rest:"3min",load:"78-83% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Full depth — develops jump power. Basketball players squat every possession."},
          {name:"Bench Press",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Pectorals, triceps, deltoids",cues:"Upper body strength for physical play in paint and box-outs."},
          {name:"Single-Leg RDL",sets:3,reps:"8 each",rest:"2min",load:"DB 30-50lbs",muscles:"Hamstrings, glutes, balance",cues:"Balance essential for basketball. Unilateral training mimics sport demands."},
          {name:"Pull-Ups — Weighted",sets:4,reps:"6",rest:"2min",load:"BW+15-25lbs",muscles:"Lats, biceps",cues:"Upper body pulling for contested rebounds."},
          {name:"Copenhagen Plank",sets:3,reps:"30sec each",rest:"90sec",load:"Bodyweight",muscles:"Adductors, core",cues:"Groin strength critical for lateral movement. Reduces groin injury risk."},
        ],
        "Upper Body": [
          {name:"DB Bench Press",sets:4,reps:"8",rest:"2min",load:"Moderate-heavy",muscles:"Pectorals, deltoids, triceps",cues:"DBs allow natural shoulder movement. Protects long-term shoulder health."},
          {name:"Pull-Ups",sets:4,reps:"8-10",rest:"90sec",load:"BW to weighted",muscles:"Lats, biceps",cues:"Strong back for rebounding and defensive positioning."},
          {name:"Push Press",sets:4,reps:"6",rest:"2.5min",load:"70-75% 1RM",muscles:"Deltoids, triceps, legs",cues:"Explosive overhead strength for shot-blocking and rebounding."},
          {name:"Rotator Cuff Work",sets:3,reps:"20 each",rest:"45sec",load:"Light band",muscles:"Rotator cuff",cues:"Shooting shoulder health. Non-negotiable for every basketball player."},
          {name:"Tricep Dips",sets:3,reps:"12",rest:"60sec",load:"BW or weighted",muscles:"Triceps",cues:"Push-off strength and finish-at-rim ability."},
          {name:"Wrist Curls",sets:3,reps:"20",rest:"45sec",load:"Light plate",muscles:"Forearm flexors",cues:"Wrist and finger strength for ball handling and shooting control."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:5,reps:"5",rest:"3min",load:"80-85% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Jump height directly correlates with squat strength. Non-negotiable."},
          {name:"Romanian Deadlift",sets:4,reps:"8",rest:"2.5min",load:"70-75% 1RM",muscles:"Hamstrings, glutes",cues:"Hamstring strength for deceleration and injury prevention."},
          {name:"Step-Up — Explosive",sets:4,reps:"6 each leg",rest:"2min",load:"DB 30-50lbs",muscles:"Quads, glutes",cues:"Explosive drive through stepping leg. Layup and finishing power."},
          {name:"Lateral Squat",sets:3,reps:"10 each side",rest:"90sec",load:"Goblet position",muscles:"Adductors, quads, glutes",cues:"Lateral movement demand. Defense and offensive footwork."},
          {name:"Calf Raise — Single Leg",sets:4,reps:"15 each",rest:"60sec",load:"Heavy DB",muscles:"Gastrocnemius, soleus",cues:"Ankle stability critical — most common basketball injury."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes, hamstrings",cues:"Vertical jump power. Jump ability is the most trainable basketball physical attribute."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"Approach Vertical Jump",sets:5,reps:"5",rest:"2.5min",load:"Max height",muscles:"Full body explosive",cues:"Two-step approach into two-foot jump. In-game jump mechanics. Track height."},
          {name:"Lane Agility Drill",sets:6,reps:"1",rest:"2min",load:"Max speed",muscles:"Glutes, quads, calves",cues:"Stay low, quick feet, touch each line. NBA combines test this."},
          {name:"Pro Agility — 5-10-5",sets:8,reps:"1",rest:"90sec",load:"Max effort",muscles:"Full body COD",cues:"Explosion in each direction. Stay low through breaks."},
          {name:"Reactive Sprint — Coach Cue",sets:6,reps:"10yd",rest:"2min",load:"Max reaction speed",muscles:"Full body reaction",cues:"React to audio or visual cue. Game-speed reaction training."},
          {name:"Resisted Lateral Shuffle",sets:4,reps:"15yd each direction",rest:"90sec",load:"Resistance band around waist",muscles:"Glutes medius, adductors",cues:"Low defensive stance the entire time. Defensive slides with resistance."},
          {name:"Depth Jump — Box to Court",sets:4,reps:"5",rest:"2min",load:"24in box",muscles:"Reactive power — quads, calves",cues:"Step off, land instantly, explode up. Minimum ground contact time."},
        ],
        "Upper Body": [
          {name:"Plyometric Push-Up",sets:4,reps:"8",rest:"90sec",load:"Bodyweight",muscles:"Chest, triceps, shoulders",cues:"Explode off floor. Upper body explosiveness for shot blocking and post play."},
          {name:"Med Ball Overhead Throw — Wall",sets:4,reps:"10",rest:"90sec",load:"10-14lb ball",muscles:"Core, shoulders, triceps",cues:"Generate from hips. Shot-put motion. Explosive upper body."},
          {name:"Band Resistance Shooting Motion",sets:4,reps:"15 each arm",rest:"60sec",load:"Light resistance band",muscles:"Deltoids, triceps, rotator cuff",cues:"Mimic exact shooting form against resistance. Sport-specific power."},
        ],
        "Lower Body": [
          {name:"Reactive Box Jump",sets:5,reps:"5",rest:"2min",load:"30-36in box",muscles:"Quads, calves, reactive",cues:"Minimum ground contact. Reactive power for contested rebounds."},
          {name:"Single-Leg Broad Jump",sets:4,reps:"5 each",rest:"2min",load:"Bodyweight",muscles:"Glutes, quads, calves",cues:"Stick landing 2sec. Unilateral power and landing stability."},
          {name:"Speed Ladder — 1-In, 2-In, In-In-Out",sets:4,reps:"3 patterns",rest:"90sec",load:"Speed ladder",muscles:"Coordination, calves, hip flexors",cues:"Maximum foot speed. Footwork for crossover and post moves."},
          {name:"Tuck Jump",sets:4,reps:"8",rest:"90sec",load:"Bodyweight",muscles:"Full lower body explosive",cues:"Tuck knees to chest at peak. Jump height and hip flexor power."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Squat",sets:4,reps:"10",rest:"2min",load:"65-70% 1RM",muscles:"Quads, glutes",cues:"Lean muscle mass for NBA physicality. Stay functional — too much bulk hurts speed."},
          {name:"DB Bench Press",sets:4,reps:"10",rest:"90sec",load:"Moderate",muscles:"Chest, deltoids, triceps",cues:"Upper body mass for physical play without restricting shooting mechanics."},
          {name:"Pull-Up — Volume",sets:4,reps:"10-12",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Back width and strength for rebounding position."},
          {name:"Romanian Deadlift",sets:3,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings, glutes",cues:"Posterior chain without excessive bulk."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes",cues:"Glute mass and power. Jump ability."},
          {name:"Bicep Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate DBs",muscles:"Biceps",cues:"Arm size for physical presence."},
        ],
        "Upper Body": [
          {name:"Incline DB Press",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Upper chest",cues:"Upper chest development for blocking out."},
          {name:"Lat Pulldown",sets:4,reps:"12",rest:"90sec",load:"Moderate stack",muscles:"Lats",cues:"Back width for wingspan appearance."},
          {name:"Lateral Raise",sets:4,reps:"15",rest:"60sec",load:"Light-moderate",muscles:"Deltoids",cues:"Shoulder width."},
          {name:"Hammer Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate DBs",muscles:"Biceps, forearms",cues:"Arm thickness and grip."},
          {name:"Tricep Pushdown",sets:3,reps:"15",rest:"60sec",load:"Moderate cable",muscles:"Triceps",cues:"Arm definition."},
          {name:"Face Pull",sets:3,reps:"20",rest:"45sec",load:"Light",muscles:"Rear delts",cues:"Shoulder health."},
        ],
        "Lower Body": [
          {name:"Hack Squat",sets:4,reps:"12",rest:"2min",load:"Moderate-heavy",muscles:"Quads, glutes",cues:"Quad mass without excessive load on spine."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings, glutes",cues:"Posterior chain mass."},
          {name:"Leg Press",sets:3,reps:"15",rest:"90sec",load:"Heavy",muscles:"Quads, glutes",cues:"Supplemental quad volume."},
          {name:"Hip Thrust",sets:4,reps:"15",rest:"60sec",load:"Moderate barbell",muscles:"Glutes",cues:"Glute development for vertical jump."},
          {name:"Leg Curl",sets:3,reps:"15",rest:"60sec",load:"Moderate",muscles:"Hamstrings",cues:"Hamstring balance."},
          {name:"Calf Raise",sets:4,reps:"20",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Calf mass and ankle stability."},
        ],
      },
    },
    "Point Guard": {
      "Athletic Performance": {
        "Full Body": [
          {name:"First-Step Explosion Drill",sets:8,reps:"5yd burst",rest:"90sec",load:"Max effort from set position",muscles:"Quads, glutes, hip flexors",cues:"React and drive first step. The most important PG athletic attribute."},
          {name:"Speed Dribble Suicide",sets:5,reps:"1 court length",rest:"2min",load:"Basketball",muscles:"Full body cardiovascular",cues:"Full speed with ball. Game conditioning with ball."},
          {name:"Crossover Reactive Cone",sets:6,reps:"1",rest:"90sec",load:"Cones and ball",muscles:"Lateral movement",cues:"React to cone signal, crossover dribble, accelerate. Decision + explosion."},
          {name:"45° Change of Direction",sets:8,reps:"10yd x4 cuts",rest:"90sec",load:"Bodyweight",muscles:"Quads, glutes, adductors",cues:"Plant and explode at 45°. Crossover, between-legs footwork."},
          {name:"Jump Rope — Speed",sets:5,reps:"60sec",rest:"45sec",load:"Speed rope",muscles:"Calves, coordination",cues:"Maximum foot turnover. Footwork and conditioning."},
        ],
        "Upper Body": [
          {name:"Push-Up Circuit",sets:4,reps:"15 each",rest:"60sec",load:"BW — various grips",muscles:"Chest, triceps, core",cues:"Lay-up finishing strength. Functional upper body."},
          {name:"Cable Pull — Driving Motion",sets:4,reps:"12 each arm",rest:"60sec",load:"Light-moderate cable",muscles:"Lats, biceps, core",cues:"Mimic drive-to-basket pulling motion. Sport specific."},
          {name:"Wrist Snap — Ball",sets:3,reps:"50",rest:"30sec",load:"Basketball",muscles:"Wrist flexors",cues:"Flick wrist against wall — shooting wrist strength and snap."},
        ],
        "Lower Body": [
          {name:"Lateral Speed Shuffle — Banded",sets:5,reps:"20yd each direction",rest:"90sec",load:"Resistance band",muscles:"Glutes medius, adductors",cues:"Stay low, short fast steps. Defensive slide footwork."},
          {name:"Single-Leg Squat Jump",sets:4,reps:"5 each leg",rest:"2min",load:"BW",muscles:"Quads, glutes, calves",cues:"One-foot takeoff and landing. Layup jump mechanics."},
          {name:"Hip Flexor March — Explosive",sets:3,reps:"20 each leg",rest:"60sec",load:"Light resistance band",muscles:"Hip flexors",cues:"Drive knee up explosively. Crossover step speed."},
        ],
      },
      "Strength Training": {
        "Full Body": [
          {name:"Power Clean",sets:4,reps:"4",rest:"2.5min",load:"70-75% 1RM",muscles:"Posterior chain, core",cues:"Explosive power for drives and cutting speed."},
          {name:"Back Squat",sets:4,reps:"5",rest:"3min",load:"75-80% 1RM",muscles:"Quads, glutes",cues:"Leg strength foundation. Don't neglect this — PG squat strength predicts first-step quickness."},
          {name:"DB Bench Press",sets:4,reps:"8",rest:"2min",load:"Moderate",muscles:"Chest, deltoids",cues:"Finishing strength in traffic."},
          {name:"Copenhagen Plank",sets:3,reps:"30sec each",rest:"90sec",load:"BW",muscles:"Adductors, core",cues:"Groin health for lateral movement."},
          {name:"Single-Leg RDL",sets:3,reps:"10 each",rest:"90sec",load:"DB 25-40lbs",muscles:"Hamstrings, glutes",cues:"Balance and hamstring health."},
          {name:"Anti-Rotation Press",sets:3,reps:"12 each",rest:"60sec",load:"Cable",muscles:"Core",cues:"Core stability for ball handling under contact."},
        ],
        "Upper Body": [
          {name:"DB Bench Press",sets:4,reps:"8",rest:"2min",load:"Moderate DBs",muscles:"Chest, deltoids, triceps",cues:"Functional pressing strength."},
          {name:"Pull-Ups",sets:4,reps:"10",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Back strength for driving contact."},
          {name:"Rotator Cuff Circuit",sets:3,reps:"20",rest:"45sec",load:"Light band",muscles:"Rotator cuff",cues:"Shooting shoulder health."},
          {name:"Wrist Curl & Extension",sets:3,reps:"20 each",rest:"45sec",load:"Light plate",muscles:"Forearms, wrists",cues:"Ball handling and shooting wrist health."},
          {name:"Face Pull",sets:3,reps:"20",rest:"45sec",load:"Light cable",muscles:"Rear delts",cues:"Shoulder health."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:5,reps:"5",rest:"3min",load:"78-83% 1RM",muscles:"Quads, glutes",cues:"Foundation of PG athleticism."},
          {name:"Nordic Hamstring Curl",sets:3,reps:"5",rest:"2min",load:"BW",muscles:"Hamstrings",cues:"Injury prevention at high sprint speeds."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes",cues:"First-step explosive power."},
          {name:"Calf Raise",sets:4,reps:"20",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Ankle stability and jumping ability."},
          {name:"Lateral Lunge",sets:3,reps:"12 each",rest:"60sec",load:"BW to goblet",muscles:"Adductors, quads, glutes",cues:"Lateral strength for defensive slides."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Squat",sets:4,reps:"10",rest:"2min",load:"65% 1RM",muscles:"Quads, glutes",cues:"Lean muscle — PGs don't want excess bulk."},
          {name:"Pull-Ups",sets:4,reps:"12",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Back development."},
          {name:"DB Press",sets:4,reps:"10",rest:"90sec",load:"Moderate",muscles:"Chest, deltoids",cues:"Functional mass."},
          {name:"RDL",sets:3,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings, glutes",cues:"Posterior chain."},
          {name:"Bicep Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps",cues:"Arm appearance."},
          {name:"Core Circuit",sets:3,reps:"45sec each",rest:"30sec",load:"BW",muscles:"Core",cues:"Plank, side plank, hollow hold. Core definition."},
        ],
        "Upper Body": [
          {name:"Incline DB Press",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Upper chest",cues:"Upper body mass."},
          {name:"Lat Pulldown",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Lats",cues:"Back width."},
          {name:"Lateral Raise",sets:4,reps:"15",rest:"60sec",load:"Light",muscles:"Deltoids",cues:"Shoulder width."},
          {name:"Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps",cues:"Arm development."},
          {name:"Tricep Pushdown",sets:3,reps:"15",rest:"60sec",load:"Moderate",muscles:"Triceps",cues:"Arm definition."},
        ],
        "Lower Body": [
          {name:"Hack Squat",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Quads",cues:"Quad development without bulk."},
          {name:"RDL",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings",cues:"Hamstring balance."},
          {name:"Hip Thrust",sets:4,reps:"15",rest:"60sec",load:"Moderate",muscles:"Glutes",cues:"Glute mass for jump power."},
          {name:"Calf Raise",sets:4,reps:"20",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Calf development."},
        ],
      },
    },
    "Center": {
      "Strength Training": {
        "Full Body": [
          {name:"Back Squat",sets:5,reps:"4-5",rest:"4min",load:"85-90% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Centers need the highest squat numbers of any basketball position. Hold the paint."},
          {name:"Deadlift",sets:5,reps:"4",rest:"4min",load:"85-90% 1RM",muscles:"Full posterior chain",cues:"Back strength for box-outs and physical post play."},
          {name:"Power Clean",sets:4,reps:"3",rest:"3min",load:"75-80% 1RM",muscles:"Explosive full body",cues:"Vertical jump power. Centers live and die by their explosiveness around the rim."},
          {name:"Bench Press",sets:5,reps:"5",rest:"3min",load:"80-85% 1RM",muscles:"Chest, triceps",cues:"Post strength for holding position and finishing through contact."},
          {name:"Farmer's Carry",sets:4,reps:"30yd",rest:"2min",load:"100-160lbs each hand",muscles:"Full body",cues:"Structural strength for body contact under the basket."},
          {name:"Hip Thrust",sets:4,reps:"10",rest:"2min",load:"Heavy",muscles:"Glutes, hamstrings",cues:"Explosive lower body for vertical and sprint."},
        ],
        "Upper Body": [
          {name:"Bench Press",sets:5,reps:"5",rest:"3min",load:"82-88% 1RM",muscles:"Chest, triceps",cues:"Highest bench target of any basketball position. Post play demands it."},
          {name:"Weighted Dips",sets:4,reps:"8",rest:"2.5min",load:"BW+45lbs",muscles:"Triceps, chest",cues:"Finishing at rim through contact."},
          {name:"Barbell Row",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Lats, mid-back",cues:"Rebounding and post position holding."},
          {name:"Overhead Press",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Deltoids, triceps",cues:"Shot-blocking reach and power."},
          {name:"Shrug",sets:3,reps:"12",rest:"90sec",load:"Heavy",muscles:"Traps",cues:"Neck and shoulder mass for physical play."},
          {name:"Face Pull",sets:3,reps:"20",rest:"60sec",load:"Light cable",muscles:"Rear delts, rotator cuff",cues:"Shoulder health under high physical load."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:6,reps:"4-5",rest:"4min",load:"87-92% 1RM",muscles:"Quads, glutes",cues:"Maximum leg strength. Centers must be impossible to move in the post."},
          {name:"Deadlift",sets:4,reps:"4",rest:"3.5min",load:"85% 1RM",muscles:"Full posterior chain",cues:"The pulling strength of a center determines their rebounding ability."},
          {name:"Romanian Deadlift",sets:4,reps:"8",rest:"2.5min",load:"70% 1RM",muscles:"Hamstrings, glutes",cues:"Hamstring strength for powerful jump landing mechanics."},
          {name:"Leg Press",sets:4,reps:"12",rest:"2min",load:"Very heavy",muscles:"Quads, glutes",cues:"High volume quad work. Centers need big legs."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"315+ lbs",muscles:"Glutes, hamstrings",cues:"Glute power for vertical jump. Centers should hip thrust more than any other basketball player."},
          {name:"Calf Raise",sets:4,reps:"15",rest:"60sec",load:"Heavy",muscles:"Calves",cues:"Calf strength for jump height and ankle stability."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"Vertical Jump Training — Two Foot",sets:5,reps:"8",rest:"2.5min",load:"Max height",muscles:"Full lower body",cues:"Two-foot takeoff for shot blocking and rebounding. Track height every session."},
          {name:"Rim Touch Jumps",sets:4,reps:"10",rest:"2min",load:"Bodyweight",muscles:"Full lower body",cues:"Touch rim repeatedly with minimal rest between jumps. Game-speed repeat jumping."},
          {name:"Post Footwork Drill",sets:5,reps:"1 min continuous",rest:"2min",load:"Basketball",muscles:"Footwork, coordination",cues:"Drop step, up-and-under, pivot. Post moves at game speed."},
          {name:"Rebound Positioning — Box Out",sets:4,reps:"30sec hold",rest:"90sec",load:"Partner resistance",muscles:"Core, back, legs",cues:"Hold against partner push. Develop box-out strength and technique."},
          {name:"Sprint — Half Court",sets:8,reps:"1",rest:"90sec",load:"Max effort",muscles:"Full sprint",cues:"Transition sprinting — centers must get back on D."},
        ],
        "Upper Body": [
          {name:"Med Ball Overhead Slam",sets:4,reps:"10",rest:"90sec",load:"14-20lb ball",muscles:"Core, shoulders, triceps",cues:"Full extension then slam. Explosive upper body for blocking shots."},
          {name:"Band Resistance Dribble",sets:3,reps:"30sec each hand",rest:"60sec",load:"Resistance band around wrist",muscles:"Forearms, wrists",cues:"Develop ball-handling security despite large hands."},
        ],
        "Lower Body": [
          {name:"Depth Jump",sets:5,reps:"5",rest:"3min",load:"24-30in box",muscles:"Reactive power",cues:"Minimum ground contact. Shot-blocking and rebounding reactive power."},
          {name:"Squat Jump",sets:5,reps:"5",rest:"2.5min",load:"30% 1RM",muscles:"Quads, glutes, calves",cues:"Explosive from squat position. Power development."},
          {name:"Lateral Shuffle Sprint",sets:6,reps:"10yd each direction",rest:"90sec",load:"Bodyweight",muscles:"Lateral movement",cues:"Defensive positioning for centers — slower but must be able to move laterally."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Back Squat",sets:5,reps:"10",rest:"2.5min",load:"70% 1RM",muscles:"Quads, glutes",cues:"High volume mass building. Centers must be large."},
          {name:"Bench Press",sets:5,reps:"10",rest:"2.5min",load:"68-72% 1RM",muscles:"Chest, triceps",cues:"Upper body mass for post play."},
          {name:"Barbell Row",sets:4,reps:"10",rest:"2min",load:"68% 1RM",muscles:"Mid-back, lats",cues:"Back thickness."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"2min",load:"65% 1RM",muscles:"Hamstrings, glutes",cues:"Posterior chain mass."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes",cues:"Glute mass for jump power."},
          {name:"Shrug",sets:4,reps:"15",rest:"60sec",load:"Heavy",muscles:"Traps",cues:"Trap development."},
        ],
        "Upper Body": [
          {name:"Incline Bench Press",sets:5,reps:"10",rest:"2.5min",load:"68-72% 1RM",muscles:"Upper chest",cues:"Upper chest mass for physical presence."},
          {name:"Cable Row",sets:4,reps:"10",rest:"2min",load:"Heavy stack",muscles:"Mid-back",cues:"Back thickness."},
          {name:"Lateral Raise",sets:4,reps:"15",rest:"60sec",load:"25-40lbs",muscles:"Deltoids",cues:"Wide shoulder appearance."},
          {name:"Barbell Curl",sets:4,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps",cues:"Arm mass."},
          {name:"Weighted Dips",sets:4,reps:"10",rest:"90sec",load:"BW+45lbs",muscles:"Triceps",cues:"Arm development."},
          {name:"Shrug",sets:4,reps:"15",rest:"60sec",load:"Heavy",muscles:"Traps",cues:"Trap mass for physical presence."},
        ],
        "Lower Body": [
          {name:"Leg Press",sets:5,reps:"15",rest:"2min",load:"Maximum",muscles:"Quads, glutes",cues:"Maximum leg volume. Centers need the biggest legs on the team."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"2min",load:"Heavy",muscles:"Hamstrings, glutes",cues:"Posterior chain mass."},
          {name:"Hack Squat",sets:4,reps:"12",rest:"2min",load:"Heavy",muscles:"Quads",cues:"Additional quad volume."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy",muscles:"Glutes",cues:"Glute mass."},
          {name:"Leg Curl",sets:4,reps:"12",rest:"60sec",load:"Moderate",muscles:"Hamstrings",cues:"Hamstring balance."},
          {name:"Calf Raise",sets:4,reps:"20",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Calf development."},
          {name:"Standing Calf Raise",sets:4,reps:"15",rest:"45sec",load:"Heavy",muscles:"Gastrocnemius",cues:"Full ROM."},
        ],
      },
    },
  },

  // ════════════════════════════════════════════════════════════
  // SOCCER
  // ════════════════════════════════════════════════════════════
  soccer: {
    _default: {
      "Strength Training": {
        "Full Body": [
          {name:"Power Clean",sets:4,reps:"4",rest:"3min",load:"70-75% 1RM",muscles:"Full posterior chain",cues:"Soccer is an explosive sport. Clean technique transfers to sprint and jump power."},
          {name:"Back Squat",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Leg strength base for shooting power and sprint acceleration."},
          {name:"Nordic Hamstring Curl",sets:3,reps:"5",rest:"3min",load:"Bodyweight",muscles:"Hamstrings — eccentric",cues:"Most important exercise for soccer players. Hamstring injuries are the #1 time-miss injury in soccer. Non-negotiable."},
          {name:"Single-Leg RDL",sets:3,reps:"10 each",rest:"2min",load:"DB 30-50lbs",muscles:"Hamstrings, glutes, balance",cues:"Unilateral balance mimics single-leg plant demands of soccer."},
          {name:"Copenhagen Adductor",sets:3,reps:"8 each",rest:"2min",load:"Bodyweight",muscles:"Adductors",cues:"Groin health critical in soccer. Prevents the most common soccer muscle strain."},
          {name:"Hip Thrust",sets:4,reps:"10",rest:"90sec",load:"Heavy barbell",muscles:"Glutes, hamstrings",cues:"Sprint power and shooting power from hip extension."},
        ],
        "Upper Body": [
          {name:"DB Bench Press",sets:4,reps:"8",rest:"2min",load:"Moderate",muscles:"Pectorals, deltoids",cues:"Upper body strength for physical play and headers."},
          {name:"Pull-Ups",sets:4,reps:"8",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Back strength for aerial duels."},
          {name:"Rotator Cuff Circuit",sets:3,reps:"20",rest:"45sec",load:"Light band",muscles:"Rotator cuff",cues:"Shoulder health for throw-ins (goalkeepers) and heading."},
          {name:"Core: Dead Bug",sets:3,reps:"10 each side",rest:"60sec",load:"Bodyweight",muscles:"Deep core stabilizers",cues:"Spine neutral throughout. Core stability for kicking mechanics."},
          {name:"Anti-Rotation Press",sets:3,reps:"12 each",rest:"60sec",load:"Light-moderate cable",muscles:"Obliques, core",cues:"Rotational stability essential for accurate long passing and shooting."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:4,reps:"6",rest:"3min",load:"75-80% 1RM",muscles:"Quads, glutes",cues:"Leg power foundation. Shooting and sprint power come from squats."},
          {name:"Nordic Hamstring Curl",sets:4,reps:"5-6",rest:"3min",load:"Bodyweight",muscles:"Hamstrings — eccentric",cues:"Perform these twice per week every week. Non-negotiable injury prevention."},
          {name:"Copenhagen Adductor Plank",sets:3,reps:"8 each",rest:"2min",load:"Bodyweight",muscles:"Adductors, core",cues:"Groin strength. Direct groin injury prevention."},
          {name:"Bulgarian Split Squat",sets:3,reps:"8 each",rest:"2min",load:"DB 25-40lbs",muscles:"Quads, glutes, hip flexors",cues:"Unilateral strength for cutting and planting."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes",cues:"Shooting and sprint power from glutes."},
          {name:"Calf Raise",sets:3,reps:"15",rest:"60sec",load:"Heavy",muscles:"Calves",cues:"Ankle stability for cleats on uneven surfaces."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"Flying 20m Sprint",sets:6,reps:"1",rest:"3min full recovery",load:"Max velocity",muscles:"Full sprint mechanics",cues:"Build to speed, time only the 20m zone. Soccer requires max velocity repeatedly."},
          {name:"Change of Direction — 5-0-5 Test",sets:6,reps:"each direction",rest:"2min",load:"Max effort",muscles:"Quads, glutes, plant mechanics",cues:"Precise footwork at 180° turn. Plant and drive. Soccer COD is game critical."},
          {name:"Yo-Yo Intermittent Recovery",sets:1,reps:"Full test",rest:"Per protocol",load:"Bodyweight",muscles:"Full cardiovascular system",cues:"Most validated soccer fitness test. Mirrors actual game demands. Note level achieved."},
          {name:"Agility Ladder — Soccer Patterns",sets:4,reps:"4 lengths",rest:"90sec",load:"Bodyweight + ball",muscles:"Coordination, hip flexors, calves",cues:"Linear, lateral, crossover. Add ball control component."},
          {name:"Repeated Sprint Ability — 30m x10",sets:10,reps:"1 — 30sec rest between",rest:"30sec only",load:"Max effort",muscles:"Full sprint — fatigue resistance",cues:"Sprint quality must be maintained throughout. Soccer requires sprints under fatigue."},
        ],
        "Upper Body": [
          {name:"Med Ball Header Sim",sets:4,reps:"15",rest:"60sec",load:"3kg ball",muscles:"Neck, core, upper back",cues:"Throw ball against wall at head height, meet with forehead. Heading power."},
          {name:"Push-Up Variety Circuit",sets:3,reps:"12 each",rest:"60sec",load:"Bodyweight",muscles:"Chest, triceps, core",cues:"Wide, close, spider push-ups. Functional upper body for shielding."},
        ],
        "Lower Body": [
          {name:"Reactive Sprint — Light Signal",sets:8,reps:"10m",rest:"90sec",load:"Max reaction",muscles:"First-step quickness",cues:"React to visual cue. Game-speed first-step training."},
          {name:"Single-Leg Box Jump",sets:4,reps:"5 each",rest:"2min",load:"24in box",muscles:"Quads, glutes, calves",cues:"Unilateral explosive power for aerial duels."},
          {name:"Lateral Band Shuffle",sets:4,reps:"15yd each direction",rest:"60sec",load:"Medium resistance band",muscles:"Glutes medius, adductors",cues:"Defensive positioning and marking footwork."},
          {name:"Sprint — Curved Acceleration",sets:6,reps:"30m arc",rest:"2min",load:"Max speed on curve",muscles:"Full sprint — inside leg dominant",cues:"Mimic curved runs into space that are common in soccer."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Squat",sets:4,reps:"10",rest:"2min",load:"65-70% 1RM",muscles:"Quads, glutes",cues:"Soccer players build functional lean mass — not bulk. Excessive weight hurts endurance."},
          {name:"Pull-Up — Volume",sets:4,reps:"10-12",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Back development for aerial duels."},
          {name:"DB Bench",sets:3,reps:"10",rest:"90sec",load:"Moderate",muscles:"Chest",cues:"Functional upper body."},
          {name:"RDL",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings",cues:"Posterior chain development."},
          {name:"Hip Thrust",sets:4,reps:"15",rest:"60sec",load:"Moderate-heavy",muscles:"Glutes",cues:"Glute mass for sprint power."},
          {name:"Core Circuit",sets:3,reps:"45sec each",rest:"30sec",load:"BW",muscles:"Core",cues:"Plank, side plank, bird dog. Core definition."},
        ],
        "Upper Body": [
          {name:"DB Incline Press",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Upper chest",cues:"Lean upper body mass."},
          {name:"Lat Pulldown",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Lats",cues:"Back development."},
          {name:"Lateral Raise",sets:3,reps:"15",rest:"60sec",load:"Light",muscles:"Deltoids",cues:"Shoulder definition."},
          {name:"Bicep Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps",cues:"Arm development."},
          {name:"Tricep Pushdown",sets:3,reps:"15",rest:"60sec",load:"Moderate",muscles:"Triceps",cues:"Arm definition."},
        ],
        "Lower Body": [
          {name:"Bulgarian Split Squat",sets:4,reps:"12 each",rest:"90sec",load:"Moderate DBs",muscles:"Quads, glutes",cues:"Lean leg mass. Unilateral development."},
          {name:"RDL",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings",cues:"Posterior chain."},
          {name:"Hip Thrust",sets:4,reps:"15",rest:"60sec",load:"Moderate",muscles:"Glutes",cues:"Glute mass."},
          {name:"Calf Raise",sets:4,reps:"20",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Calf development."},
          {name:"Leg Curl",sets:3,reps:"15",rest:"60sec",load:"Moderate",muscles:"Hamstrings",cues:"Hamstring balance."},
        ],
      },
    },
  },

  // ════════════════════════════════════════════════════════════
  // HOCKEY
  // ════════════════════════════════════════════════════════════
  hockey: {
    _default: {
      "Strength Training": {
        "Full Body": [
          {name:"Power Clean",sets:4,reps:"4",rest:"3min",load:"75-80% 1RM",muscles:"Posterior chain",cues:"Hockey requires short explosive bursts — power clean is the closest analog to a shift explosion."},
          {name:"Front Squat",sets:4,reps:"5",rest:"3min",load:"75-80% 1RM",muscles:"Quads, core, upper back",cues:"More hockey-specific than back squat — mimics skating posture with upright torso."},
          {name:"Single-Leg Squat",sets:3,reps:"8 each",rest:"2min",load:"BW to light DB",muscles:"Quads, glutes, balance",cues:"Hockey is a single-leg sport — skaters are always on one skate edge."},
          {name:"Bench Press",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Pectorals, triceps",cues:"Board battle and stick-handling strength."},
          {name:"Barbell Row",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Lats, mid-back",cues:"Pulling strength for battles along the boards."},
          {name:"Copenhagen Adductor",sets:3,reps:"10 each",rest:"2min",load:"Bodyweight",muscles:"Adductors, groin",cues:"Hockey groin strains are extremely common. This is the #1 prevention exercise for skaters."},
        ],
        "Upper Body": [
          {name:"Bench Press",sets:5,reps:"5",rest:"3min",load:"78-83% 1RM",muscles:"Pectorals, triceps",cues:"Board battle strength. Physical play along the boards demands upper body strength."},
          {name:"Barbell Row",sets:4,reps:"6",rest:"2.5min",load:"75% 1RM",muscles:"Lats, mid-back",cues:"Pulling power for puck battles and stick checking."},
          {name:"Push Press",sets:4,reps:"5",rest:"2.5min",load:"75% 1RM",muscles:"Deltoids, triceps",cues:"Explosive overhead strength for physical play and lifting opponents."},
          {name:"Shrug",sets:3,reps:"12",rest:"90sec",load:"Heavy",muscles:"Traps, upper back",cues:"Neck and shoulder protection for physical play and contact."},
          {name:"Face Pull",sets:3,reps:"20",rest:"45sec",load:"Light",muscles:"Rear delts, rotator cuff",cues:"Shoulder health for stick handling and shooting."},
          {name:"Wrist Curl & Extension",sets:3,reps:"20 each",rest:"45sec",load:"Light",muscles:"Forearms, wrists",cues:"Wrist and stick-handling strength."},
        ],
        "Lower Body": [
          {name:"Front Squat",sets:5,reps:"5",rest:"3min",load:"78-83% 1RM",muscles:"Quads, core",cues:"Hockey posture requires upright torso. Front squat is the most hockey-specific squat variation."},
          {name:"Lateral Lunge — Skating Sim",sets:4,reps:"10 each",rest:"2min",load:"Goblet position — heavy KB",muscles:"Adductors, glutes, quads",cues:"Simulate skating stride — push laterally, feel adductor stretch. Skating power."},
          {name:"Nordic Hamstring Curl",sets:3,reps:"5",rest:"2.5min",load:"Bodyweight",muscles:"Hamstrings",cues:"Hamstring protection for powerful skating strides."},
          {name:"Copenhagen Adductor",sets:4,reps:"8 each",rest:"2min",load:"Bodyweight",muscles:"Adductors",cues:"Most important injury prevention exercise in hockey. Do it twice weekly."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes, hamstrings",cues:"Glute power drives skating acceleration."},
          {name:"Skater Squat",sets:3,reps:"8 each",rest:"90sec",load:"BW to DB",muscles:"Quads, glutes, balance",cues:"Single-leg, touch ground beside foot. Closest gym exercise to skating mechanics."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"On-Ice Sprint Simulation — Slide Board",sets:6,reps:"30sec",rest:"90sec",load:"Max effort",muscles:"Adductors, glutes, quads",cues:"If no slide board, use skater hops. Mimics on-ice skating mechanics."},
          {name:"Power Clean",sets:5,reps:"3",rest:"3min",load:"80-85% 1RM",muscles:"Full explosive",cues:"Shift starts require explosive hip extension. Power clean trains exactly this."},
          {name:"Skater Hops — Lateral",sets:4,reps:"10 each direction",rest:"90sec",load:"Bodyweight",muscles:"Glutes, adductors, calves",cues:"Mimic skating stride mechanics. Land on single leg, push off explosively."},
          {name:"Staircase Sprint",sets:6,reps:"30 steps",rest:"2min",load:"Max effort",muscles:"Quads, glutes, calves",cues:"Two steps at a time. Develops skating power and shift conditioning."},
          {name:"Battling Ropes — Seated",sets:4,reps:"30sec",rest:"90sec",load:"Heavy ropes",muscles:"Shoulders, core",cues:"Seated position mimics skating posture. Upper body conditioning for physical play."},
        ],
        "Upper Body": [
          {name:"Stick-Handling Speed Drill",sets:4,reps:"30sec",rest:"60sec",load:"Hockey stick + ball/puck",muscles:"Forearms, wrists, coordination",cues:"Maximum hand speed. Wrist and stick-handling quickness under fatigue."},
          {name:"Med Ball Rotational Throw",sets:4,reps:"8 each side",rest:"90sec",load:"10-14lb ball",muscles:"Core, hips, shoulders",cues:"Mimic slap shot rotation. Hip-driven upper body power."},
          {name:"Push-Up Endurance Circuit",sets:3,reps:"25",rest:"60sec",load:"Bodyweight",muscles:"Chest, triceps, core",cues:"Shift endurance. Can you still push in period 3?"},
        ],
        "Lower Body": [
          {name:"Reactive Lateral Bound",sets:5,reps:"8 each direction",rest:"90sec",load:"Bodyweight",muscles:"Glutes, adductors",cues:"Explosive lateral push off — exactly mimics skating push-off mechanics."},
          {name:"Box Jump — Rotational Land",sets:4,reps:"5",rest:"2min",load:"Bodyweight",muscles:"Quads, glutes",cues:"Jump and rotate 90° before landing. Reactive agility on ice."},
          {name:"Sprint — 20m x8",sets:8,reps:"1",rest:"60sec",load:"Max effort",muscles:"Full sprint",cues:"Shift conditioning — 8 intense shifts per period."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Front Squat",sets:4,reps:"10",rest:"2min",load:"68-72% 1RM",muscles:"Quads, core",cues:"Hockey-specific mass. Maintain skating posture strength."},
          {name:"Bench Press",sets:4,reps:"10",rest:"2min",load:"68-72% 1RM",muscles:"Chest, triceps",cues:"Upper body mass for physical play."},
          {name:"Barbell Row",sets:4,reps:"10",rest:"2min",load:"68% 1RM",muscles:"Mid-back, lats",cues:"Back development."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"90sec",load:"65% 1RM",muscles:"Hamstrings, glutes",cues:"Posterior chain mass."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy",muscles:"Glutes",cues:"Glute mass for skating power."},
          {name:"Copenhagen Plank",sets:3,reps:"30sec each",rest:"60sec",load:"BW",muscles:"Adductors",cues:"Groin health — required even in muscle building phase."},
        ],
        "Upper Body": [
          {name:"Incline Press",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Upper chest",cues:"Upper body mass."},
          {name:"Cable Row",sets:4,reps:"12",rest:"90sec",load:"Heavy",muscles:"Mid-back",cues:"Back thickness."},
          {name:"Lateral Raise",sets:4,reps:"15",rest:"60sec",load:"Moderate",muscles:"Deltoids",cues:"Shoulder width."},
          {name:"Barbell Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps",cues:"Arm development."},
          {name:"Skull Crusher",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Triceps",cues:"Arm mass."},
          {name:"Shrug",sets:3,reps:"15",rest:"60sec",load:"Heavy",muscles:"Traps",cues:"Neck protection mass."},
        ],
        "Lower Body": [
          {name:"Hack Squat",sets:4,reps:"12",rest:"2min",load:"Heavy",muscles:"Quads",cues:"Quad mass for skating power."},
          {name:"Lateral Lunge",sets:4,reps:"12 each",rest:"90sec",load:"Goblet position",muscles:"Adductors, quads",cues:"Skating-specific leg development."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings",cues:"Hamstring development."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy",muscles:"Glutes",cues:"Glute mass."},
          {name:"Leg Curl",sets:3,reps:"15",rest:"60sec",load:"Moderate",muscles:"Hamstrings",cues:"Isolation work."},
          {name:"Calf Raise",sets:4,reps:"15",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Skating push-off calf strength."},
        ],
      },
    },
  },

  // ════════════════════════════════════════════════════════════
  // VOLLEYBALL
  // ════════════════════════════════════════════════════════════
  volleyball: {
    _default: {
      "Strength Training": {
        "Full Body": [
          {name:"Hang Clean",sets:4,reps:"4",rest:"3min",load:"70-75% 1RM",muscles:"Posterior chain, traps",cues:"Vertical jump power for attacks and blocks. Hip extension speed is critical."},
          {name:"Back Squat",sets:4,reps:"6",rest:"2.5min",load:"75-80% 1RM",muscles:"Quads, glutes, hamstrings",cues:"Jump height directly correlates with squat strength. Volleyball players live and die by their vertical."},
          {name:"Single-Leg RDL",sets:3,reps:"10 each",rest:"2min",load:"DB 25-40lbs",muscles:"Hamstrings, glutes, balance",cues:"Landing stability and hamstring health for repeated jumping."},
          {name:"Pull-Ups — Weighted",sets:4,reps:"6",rest:"2min",load:"BW+15lbs",muscles:"Lats, biceps",cues:"Upper body pulling for blocking stability."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes, hamstrings",cues:"Jump power. Hip thrust strength is directly predictive of vertical jump improvement."},
          {name:"Copenhagen Plank",sets:3,reps:"30sec each",rest:"90sec",load:"Bodyweight",muscles:"Adductors",cues:"Groin health for lateral movement and approach footwork."},
        ],
        "Upper Body": [
          {name:"DB Bench Press",sets:4,reps:"8",rest:"2min",load:"Moderate-heavy",muscles:"Pectorals, deltoids, triceps",cues:"Hitting power and blocking arm strength."},
          {name:"Pull-Ups",sets:4,reps:"8",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Pulling strength for arm swing power."},
          {name:"Rotator Cuff Circuit",sets:3,reps:"20 each",rest:"45sec",load:"Light band",muscles:"Rotator cuff — infraspinatus, teres minor",cues:"The most important shoulder health work for volleyball. Attackers are at high risk for shoulder impingement. Do this every session."},
          {name:"Collagen Supplement Note",sets:1,reps:"N/A",rest:"N/A",load:"15g collagen + Vitamin C pre-workout",muscles:"Connective tissue",cues:"Take 15g collagen + 250mg Vitamin C 30-45min before training. Dramatically improves tendon and shoulder joint health."},
          {name:"Shoulder External Rotation",sets:3,reps:"20 each arm",rest:"45sec",load:"Very light cable or band",muscles:"Infraspinatus, teres minor",cues:"Highest priority exercise for attacking players. Do not overload."},
          {name:"Lat Pulldown",sets:4,reps:"10",rest:"90sec",load:"Moderate stack",muscles:"Lats, biceps",cues:"Arm swing power comes from lats. Build them."},
        ],
        "Lower Body": [
          {name:"Back Squat",sets:5,reps:"5",rest:"3min",load:"80-85% 1RM",muscles:"Quads, glutes",cues:"Jump height. Volleyball squats are as important as basketball squats."},
          {name:"Nordic Hamstring Curl",sets:3,reps:"5",rest:"2.5min",load:"Bodyweight",muscles:"Hamstrings",cues:"Hamstring injury prevention for repeated jumping athletes."},
          {name:"Hip Thrust",sets:4,reps:"12",rest:"90sec",load:"Heavy barbell",muscles:"Glutes",cues:"Glute power for jump height. Most overlooked exercise for vertical jump."},
          {name:"Depth Jump",sets:4,reps:"5",rest:"2.5min",load:"20-24in box",muscles:"Quads, calves, reactive",cues:"Minimum ground contact time. Reactive power for blocking."},
          {name:"Patellar Tendon Health — Decline Squat",sets:3,reps:"15",rest:"60sec",load:"BW to light load",muscles:"Patellar tendon (eccentric)",cues:"On 25° decline board, slow 4sec descent. Patellar tendinopathy is the #1 overuse injury in volleyball."},
          {name:"Calf Raise — Single Leg",sets:4,reps:"15 each",rest:"60sec",load:"DB 25-40lbs",muscles:"Gastrocnemius, soleus",cues:"Landing absorption and ankle stability."},
        ],
      },
      "Athletic Performance": {
        "Full Body": [
          {name:"Approach Jump — Attack",sets:5,reps:"8",rest:"2.5min",load:"Max height",muscles:"Full body jumping",cues:"3-step approach into two-foot takeoff. Track height every session. This is your most important performance metric."},
          {name:"Reactive Block Jump — Cue",sets:5,reps:"5",rest:"2.5min",load:"Max reactivity",muscles:"Reactive lower body",cues:"React to visual cue, jump to block position. Trains game-speed blocking reaction."},
          {name:"Repeat Jump Test — 15sec",sets:4,reps:"15sec continuous",rest:"3min",load:"Max effort",muscles:"Full lower body endurance",cues:"Jump as high as possible every jump for 15sec. Game-condition jump power testing."},
          {name:"Sprint — 10m Reaction",sets:8,reps:"1",rest:"90sec",load:"Max speed",muscles:"First-step quickness",cues:"React and cover 10m. Court coverage speed."},
          {name:"Lateral Slide — Width of Court",sets:5,reps:"1",rest:"90sec",load:"Max speed",muscles:"Lateral movement",cues:"From sideline to sideline. Defensive coverage speed."},
        ],
        "Upper Body": [
          {name:"Med Ball Attack Swing",sets:4,reps:"10 each arm",rest:"90sec",load:"3-5kg ball",muscles:"Core, deltoids, triceps",cues:"Simulate exact arm swing of attack. Hip-driven power to hand."},
          {name:"Band Spiking Motion",sets:3,reps:"15 each arm",rest:"60sec",load:"Resistance band",muscles:"Shoulder, rotator cuff, triceps",cues:"Mimic spike contact point. Velocity with healthy mechanics."},
          {name:"Block Reach — Weighted",sets:4,reps:"10",rest:"90sec",load:"Light DBs in hands",muscles:"Deltoids, core",cues:"Jump and reach with dumbbells. Blocking height with resistance."},
        ],
        "Lower Body": [
          {name:"Depth Jump to Attack",sets:4,reps:"5",rest:"3min",load:"20in box",muscles:"Reactive power",cues:"Step off, land, immediately execute approach jump. Reactive power for attack off a set."},
          {name:"Single-Leg Jump — Vertical",sets:4,reps:"6 each leg",rest:"2min",load:"Max height",muscles:"Quads, glutes, calves",cues:"Single leg takeoff and land. Develop asymmetrical jump ability."},
          {name:"Shuffle-Sprint Combo",sets:5,reps:"5yd shuffle + 5yd sprint",rest:"90sec",load:"Max effort",muscles:"Full lower body",cues:"Lateral movement into linear sprint. Game movement transitions."},
        ],
      },
      "Muscle Building": {
        "Full Body": [
          {name:"Squat",sets:4,reps:"10",rest:"2min",load:"68-72% 1RM",muscles:"Quads, glutes",cues:"Lean muscle mass for volleyball. Excess bulk hurts vertical jump. Focus on lean strength."},
          {name:"Pull-Up — Volume",sets:4,reps:"12",rest:"90sec",load:"BW",muscles:"Lats, biceps",cues:"Back width for shoulder stability and arm swing."},
          {name:"DB Bench",sets:4,reps:"10",rest:"90sec",load:"Moderate",muscles:"Chest, deltoids",cues:"Functional upper body mass."},
          {name:"Romanian Deadlift",sets:3,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings, glutes",cues:"Posterior chain development."},
          {name:"Hip Thrust",sets:4,reps:"15",rest:"60sec",load:"Moderate-heavy",muscles:"Glutes",cues:"Glute mass for jump power."},
          {name:"Core Circuit",sets:3,reps:"45sec each",rest:"30sec",load:"BW",muscles:"Core",cues:"Plank, V-up, hollow body. Core definition."},
        ],
        "Upper Body": [
          {name:"DB Incline Press",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Upper chest",cues:"Upper body development."},
          {name:"Lat Pulldown",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Lats",cues:"Arm swing power."},
          {name:"Lateral Raise",sets:3,reps:"15",rest:"60sec",load:"Light-moderate",muscles:"Deltoids",cues:"Shoulder definition."},
          {name:"Hammer Curl",sets:3,reps:"12",rest:"60sec",load:"Moderate",muscles:"Biceps, forearms",cues:"Arm development."},
          {name:"External Rotation",sets:3,reps:"20 each",rest:"45sec",load:"Light",muscles:"Rotator cuff",cues:"Always included. Shoulder health."},
        ],
        "Lower Body": [
          {name:"Hack Squat",sets:4,reps:"12",rest:"90sec",load:"Moderate-heavy",muscles:"Quads",cues:"Quad mass for jump power."},
          {name:"Romanian Deadlift",sets:4,reps:"12",rest:"90sec",load:"Moderate",muscles:"Hamstrings, glutes",cues:"Posterior chain."},
          {name:"Hip Thrust",sets:4,reps:"15",rest:"60sec",load:"Moderate-heavy",muscles:"Glutes",cues:"Glute mass for vertical."},
          {name:"Decline Squat — Slow",sets:3,reps:"15",rest:"60sec",load:"BW",muscles:"Patellar tendon",cues:"Patellar health. Non-negotiable."},
          {name:"Calf Raise",sets:4,reps:"20",rest:"45sec",load:"Heavy",muscles:"Calves",cues:"Calf development and landing mechanics."},
        ],
      },
    },
  },
};

// ── WORKOUT LOOKUP FUNCTION ──────────────────────────────────
// Returns the best workout for sport + position + wkType + wkFocus
function getSportWorkout(sport, position, wkType, wkFocus) {
  const sportData = SPORT_WORKOUTS[sport];
  if (!sportData) return null;

  // Try position-specific first, fall back to _default
  const posData = sportData[position] || sportData._default;
  if (!posData) return null;

  const typeData = posData[wkType];
  if (!typeData) {
    // Fall back to _default for this type
    const defType = sportData._default?.[wkType];
    if (!defType) return null;
    return defType[wkFocus] || null;
  }

  return typeData[wkFocus] || null;
}


// ─────────────────────────────────────────────────────────────
// EXERCISE LIBRARY — v2 (39 exercises with video demos)
// ytId = YouTube video ID for embedded demo (no-cookie player)
// ─────────────────────────────────────────────────────────────
const EXERCISE_LIBRARY = [
  // ── CHEST ──────────────────────────────────────────────────
  {name:"Barbell Bench Press",muscle:"Chest",cat:"Strength",diff:"Intermediate",ytId:"vcBig73ojpE",cues:"Retract shoulder blades, arch slightly, bar to lower chest, drive through heels.",mistakes:"Flared elbows, bouncing bar off chest, lifting hips.",sets:"4×6–8",muscles:"Pectorals, anterior deltoid, triceps"},
  {name:"Incline Dumbbell Press",muscle:"Chest",cat:"Strength",diff:"Intermediate",ytId:"8iPEnn-ltC8",cues:"30–45° incline, slight wrist tilt, controlled descent to chest level.",mistakes:"Too steep an angle, excessive range shortens pec activation.",sets:"3×10–12",muscles:"Upper pectorals, anterior deltoid"},
  {name:"Cable Fly",muscle:"Chest",cat:"Isolation",diff:"Beginner",ytId:"taI4XduLpTk",cues:"Slight forward lean, arms slightly bent, squeeze pecs at midline.",mistakes:"Bending elbows too much, rushing the motion.",sets:"3×12–15",muscles:"Pectorals"},
  {name:"Push-Up",muscle:"Chest",cat:"Bodyweight",diff:"Beginner",ytId:"IODxDxX7oi4",cues:"Straight line head-to-heel, hands slightly wider than shoulders, full ROM.",mistakes:"Sagging hips, partial reps, neck jutting forward.",sets:"3×15–20",muscles:"Chest, triceps, anterior deltoid, core"},
  {name:"Dips",muscle:"Chest",cat:"Bodyweight",diff:"Intermediate",ytId:"2z8JmcrW-As",cues:"Lean forward for chest emphasis, controlled descent, push up explosively.",mistakes:"Locking out fully at top, excessive forward lean losing control.",sets:"3×8–12",muscles:"Lower chest, triceps, anterior deltoid"},
  // ── BACK ───────────────────────────────────────────────────
  {name:"Deadlift",muscle:"Back",cat:"Strength",diff:"Advanced",ytId:"op9kVnSso6Q",cues:"Bar over mid-foot, hinge don't squat, lat engagement, neutral spine, drive hips forward.",mistakes:"Rounded lower back, bar drifting from legs, jerking the bar.",sets:"4×4–6",muscles:"Entire posterior chain, lats, traps, glutes, hamstrings"},
  {name:"Barbell Row",muscle:"Back",cat:"Strength",diff:"Intermediate",ytId:"G8l_8chR5BE",cues:"Hinge 45°, overhand grip, pull to lower chest, retract scapulae.",mistakes:"Using momentum, not fully retracting shoulder blades.",sets:"4×8–10",muscles:"Lats, rhomboids, rear delts, biceps"},
  {name:"Pull-Up",muscle:"Back",cat:"Bodyweight",diff:"Intermediate",ytId:"eGo4IYlbE5g",cues:"Dead hang start, engage lats before pulling, chin over bar, full descent.",mistakes:"Kipping without control, partial range, shrugging shoulders.",sets:"4×6–10",muscles:"Lats, biceps, rear delts, core"},
  {name:"Lat Pulldown",muscle:"Back",cat:"Strength",diff:"Beginner",ytId:"CAwf7n6Luuc",cues:"Slight backward lean, pull to upper chest, squeeze lats at bottom.",mistakes:"Leaning too far back, using momentum, partial range.",sets:"3×10–12",muscles:"Lats, biceps, rear delts"},
  {name:"Seated Cable Row",muscle:"Back",cat:"Strength",diff:"Beginner",ytId:"GZbfZ033f74",cues:"Sit tall, pull to lower abdomen, drive elbows back, hold 1 second.",mistakes:"Rounding lower back, using body momentum.",sets:"3×10–12",muscles:"Mid-back, rhomboids, lats, biceps"},
  {name:"Romanian Deadlift",muscle:"Back",cat:"Strength",diff:"Intermediate",ytId:"JCXUYuzwNrM",cues:"Soft knee bend, hinge at hips, bar stays close to legs, feel hamstring stretch.",mistakes:"Squatting the weight, rounding the spine, bar drifting forward.",sets:"3×10–12",muscles:"Hamstrings, glutes, lower back"},
  // ── SHOULDERS ──────────────────────────────────────────────
  {name:"Overhead Press",muscle:"Shoulders",cat:"Strength",diff:"Intermediate",ytId:"2yjwXTZQDDI",cues:"Elbows slightly forward, press overhead and back, don't hyperextend spine.",mistakes:"Excessive lower-back arch, flaring elbows, not fully locking out.",sets:"4×6–8",muscles:"Anterior & lateral delts, triceps, upper traps"},
  {name:"Lateral Raise",muscle:"Shoulders",cat:"Isolation",diff:"Beginner",ytId:"3VcKaXpzqRo",cues:"Lead with elbows not hands, slight forward lean, stop at shoulder height.",mistakes:"Swinging, shrugging, going above shoulder height.",sets:"3×12–15",muscles:"Lateral deltoid"},
  {name:"Face Pull",muscle:"Shoulders",cat:"Isolation",diff:"Beginner",ytId:"rep-qVOkqgk",cues:"Pull to face level, external rotate at end, elbows high.",mistakes:"Pulling to neck, not fully externally rotating.",sets:"3×15–20",muscles:"Rear delts, external rotators, traps"},
  {name:"Arnold Press",muscle:"Shoulders",cat:"Strength",diff:"Intermediate",ytId:"6Z15_WdXmVw",cues:"Start palms facing you, rotate to palms forward as you press.",mistakes:"Moving too fast through rotation, not getting full supination.",sets:"3×10–12",muscles:"All three delt heads, upper traps"},
  // ── LEGS ───────────────────────────────────────────────────
  {name:"Back Squat",muscle:"Legs",cat:"Strength",diff:"Intermediate",ytId:"ultWZbUMPL8",cues:"Bar on traps, brace core, knees track toes, break parallel, drive up.",mistakes:"Knee cave, heel rise, excessive forward lean, shallow depth.",sets:"4×5–8",muscles:"Quads, glutes, hamstrings, core"},
  {name:"Front Squat",muscle:"Legs",cat:"Strength",diff:"Advanced",ytId:"uYumuL_G_V0",cues:"Elbows up, upright torso, knees out, deep squat.",mistakes:"Dropping elbows, rounding upper back, narrow stance.",sets:"4×5–8",muscles:"Quads, glutes, core (more upright than back squat)"},
  {name:"Bulgarian Split Squat",muscle:"Legs",cat:"Strength",diff:"Intermediate",ytId:"2C-uNgKwPLE",cues:"Rear foot elevated, front foot forward enough, vertical shin, drop straight down.",mistakes:"Front knee going way past toes, leaning too far forward.",sets:"3×8–12 per side",muscles:"Quads, glutes, hip flexors"},
  {name:"Leg Press",muscle:"Legs",cat:"Strength",diff:"Beginner",ytId:"IZxyjW7MPJQ",cues:"Feet shoulder-width, lower until 90°, push through heels, don't lock knees fully.",mistakes:"Too much weight limiting range, feet too low.",sets:"3×12–15",muscles:"Quads, glutes, hamstrings"},
  {name:"Nordic Hamstring Curl",muscle:"Legs",cat:"Strength",diff:"Advanced",ytId:"TyaO9OGQISQ",cues:"Kneel, lower body slowly (3–4 sec), catch at bottom, push back up.",mistakes:"Dropping too fast, not using a training partner or anchor.",sets:"3×5–8",muscles:"Hamstrings (eccentric focus)"},
  {name:"Glute Bridge",muscle:"Legs",cat:"Strength",diff:"Beginner",ytId:"8bbE64NuDTU",cues:"Drive hips up through heels, squeeze glutes at top, neutral spine.",mistakes:"Hyperextending the lower back, not fully extending at top.",sets:"3×15",muscles:"Glutes, hamstrings, lower back"},
  {name:"Calf Raise",muscle:"Legs",cat:"Isolation",diff:"Beginner",ytId:"MPe9nO1i9lE",cues:"Full range of motion, pause at bottom and top, slow on the way down.",mistakes:"Bouncing at the bottom, partial reps.",sets:"4×15–20",muscles:"Gastrocnemius, soleus"},
  // ── ARMS ───────────────────────────────────────────────────
  {name:"Barbell Curl",muscle:"Arms",cat:"Isolation",diff:"Beginner",ytId:"kwG2ipFRgfo",cues:"Elbows pinned to sides, supinate at top, slow eccentric.",mistakes:"Swinging, elbows drifting forward, half reps.",sets:"3×10–12",muscles:"Biceps brachii, brachialis"},
  {name:"Hammer Curl",muscle:"Arms",cat:"Isolation",diff:"Beginner",ytId:"TwD-YGVP4Bk",cues:"Neutral grip, elbows at sides, curl up and squeeze.",mistakes:"Swinging torso, rushing through reps.",sets:"3×10–12",muscles:"Brachialis, brachioradialis, biceps"},
  {name:"Skull Crushers",muscle:"Arms",cat:"Isolation",diff:"Intermediate",ytId:"d_KZxkY_0cM",cues:"Elbows tucked, lower bar to forehead, extend to full lockout.",mistakes:"Elbows flaring out, lowering to neck.",sets:"3×10–12",muscles:"All three tricep heads"},
  {name:"Tricep Pushdown",muscle:"Arms",cat:"Isolation",diff:"Beginner",ytId:"2-LAMcpzODU",cues:"Elbows at sides, push through full extension, squeeze at bottom.",mistakes:"Elbows drifting forward, cutting range short.",sets:"3×12–15",muscles:"Triceps"},
  // ── CORE ───────────────────────────────────────────────────
  {name:"Plank",muscle:"Core",cat:"Bodyweight",diff:"Beginner",ytId:"ASdvN_XEl_c",cues:"Neutral spine, brace core as if about to be punched, don't hold breath.",mistakes:"Sagging hips, raised hips, holding breath.",sets:"3×30–60 sec",muscles:"Transverse abdominis, obliques, glutes"},
  {name:"Hanging Leg Raise",muscle:"Core",cat:"Bodyweight",diff:"Intermediate",ytId:"Pr1ieGZ5atk",cues:"Dead hang, posterior pelvic tilt first, raise legs to parallel or higher.",mistakes:"Swinging, using momentum, only bending knees.",sets:"3×10–15",muscles:"Hip flexors, lower abs, core"},
  {name:"Cable Crunch",muscle:"Core",cat:"Isolation",diff:"Beginner",ytId:"bswv2pVx2x0",cues:"Hinge at hips not waist, crunch elbows toward knees, round upper back.",mistakes:"Pulling with arms, not fully contracting abs.",sets:"3×15–20",muscles:"Rectus abdominis, obliques"},
  {name:"Ab Wheel Rollout",muscle:"Core",cat:"Bodyweight",diff:"Advanced",ytId:"ndc391RFNUM",cues:"Start on knees, roll out on inhale, pull back on exhale, don't let hips sag.",mistakes:"Going too far before you're strong enough, hips dropping.",sets:"3×8–12",muscles:"Core, lats, shoulder stabilizers"},
  {name:"Pallof Press",muscle:"Core",cat:"Isolation",diff:"Beginner",ytId:"AH_QZLm_0-s",cues:"Stand perpendicular to cable, press out and hold 2 sec, resist rotation.",mistakes:"Rotating hips, not controlling the return.",sets:"3×12 per side",muscles:"Anti-rotation core, obliques"},
  // ── POWER / OLYMPIC ────────────────────────────────────────
  {name:"Hang Clean",muscle:"Power",cat:"Olympic",diff:"Advanced",ytId:"qQ8InArxi-Y",cues:"Start at hang, triple extension, fast elbows, drop under bar.",mistakes:"Reverse curling the bar, slow elbows, arms pulling bar.",sets:"4×3–5",muscles:"Full body — traps, glutes, quads, hamstrings"},
  {name:"Power Clean",muscle:"Power",cat:"Olympic",diff:"Advanced",ytId:"E2z5zK5V-MM",cues:"Bar from floor, first pull slow, second pull explosive, receive in partial squat.",mistakes:"Early arm bend, bar swinging away from body, slow transition.",sets:"4×3–5",muscles:"Full body, emphasizes posterior chain + traps"},
  {name:"Box Jump",muscle:"Power",cat:"Plyometric",diff:"Intermediate",ytId:"HJZh-12p6vg",cues:"Hinge and swing arms, land softly with bent knees, step down don't jump down.",mistakes:"Jumping down, landing with straight legs, poor arm timing.",sets:"4×5",muscles:"Glutes, quads, calves, hip flexors"},
  {name:"Broad Jump",muscle:"Power",cat:"Plyometric",diff:"Intermediate",ytId:"q7851uL2M8c",cues:"Hinge, swing arms, jump forward landing softly with bent hips and knees.",mistakes:"Landing stiff-legged, arms not timing with jump.",sets:"4×5",muscles:"Glutes, quads, hamstrings, calves"},
  {name:"Medicine Ball Slam",muscle:"Power",cat:"Plyometric",diff:"Beginner",ytId:"QxYhFwMd1Ks",cues:"Full overhead extension, slam with full force, absorb ball on bounce.",mistakes:"Partial overhead reach, weak slam.",sets:"4×8–10",muscles:"Core, lats, shoulders, full body"},
  // ── CARDIO / CONDITIONING ──────────────────────────────────
  {name:"Battle Ropes",muscle:"Conditioning",cat:"Cardio",diff:"Beginner",ytId:"0N7IPIcnhEA",cues:"Athletic stance, simultaneous or alternating waves, keep tension on ropes.",mistakes:"Arms only — drive from core and legs.",sets:"5×30 sec on / 30 sec off",muscles:"Shoulders, core, cardiovascular system"},
  {name:"Sled Push",muscle:"Conditioning",cat:"Cardio",diff:"Intermediate",ytId:"Qw8q55JR5VY",cues:"45° forward lean, short powerful strides, drive through full hip extension.",mistakes:"Too upright, tiny shuffling steps.",sets:"6×20m",muscles:"Quads, glutes, calves, core"},
  {name:"Farmer's Carry",muscle:"Conditioning",cat:"Strength",diff:"Beginner",ytId:"NH7Xv-7NQNQ",cues:"Tall posture, shoulders back, small controlled steps, breathe consistently.",mistakes:"Leaning to one side, hunching shoulders.",sets:"4×30–40m",muscles:"Grip, traps, core, shoulders"},
  {name:"Assault Bike Sprint",muscle:"Conditioning",cat:"Cardio",diff:"Intermediate",ytId:"XSFjDpqX0ms",cues:"Push AND pull the handles, drive with legs equally, stay in athletic position.",mistakes:"Arms only, hunching over, stopping abruptly.",sets:"8×20 sec max / 40 sec rest",muscles:"Full body, cardiovascular system"},
];

const EXERCISE_MUSCLES = ["All","Chest","Back","Shoulders","Legs","Arms","Core","Power","Conditioning"];
const EXERCISE_CATS = ["All","Strength","Isolation","Bodyweight","Olympic","Plyometric","Cardio"];

const WORKOUTS = {
  "Strength Training": {
    "Upper Body": ["Bench Press 4×8","Weighted Pull-Ups 4×8","Overhead Press 3×8","Barbell Row 4×8","Weighted Dips 3×10","Barbell Curl 3×12","Skull Crushers 3×12"],
    "Lower Body": ["Back Squat 4×8","Romanian Deadlift 4×8","Leg Press 3×12","Walking Lunges 3×12ea","Calf Raises 4×15","Glute Bridge 3×15","Nordic Curls 3×6"],
    "Full Body":  ["Deadlift 4×5","Power Clean 4×4","Front Squat 3×8","Weighted Pull-Ups 3×8","Dips 3×10","Farmer's Carry 3×40yd"],
  },
  "Athletic Performance": {
    "Upper Body": ["Medicine Ball Chest Pass 4×8","Battle Ropes 4×30sec","KB Swings 4×15","Push Press 4×6","TRX Explosive Rows 3×10"],
    "Lower Body": ["Box Jumps 4×8","40yd Sprint ×6","Single-Leg RDL 3×10ea","Lateral Bounds 4×8","Sled Push 4×20yd"],
    "Full Body":  ["Olympic Complex: Clean + Jerk","Plyometric Circuit 4 rounds","Agility Ladder 6 patterns","Medicine Ball Slams 4×12","Core Stability Finisher"],
  },
  "Muscle Building": {
    "Upper Body": ["Incline DB Press 4×10","Cable Rows 4×12","Lateral Raises 4×15","Face Pulls 3×15","Hammer Curls 3×12","Overhead Tricep Ext 3×12"],
    "Lower Body": ["Hack Squat 4×12","Lying Leg Curl 4×12","Leg Extension 4×15","Bulgarian Split Squat 3×10ea","Hip Thrust 4×12","Tibialis Raise 3×15"],
    "Full Body":  ["Squat 4×10","Weighted Pull-Ups 4×8","DB Shoulder Press 3×12","Romanian Deadlift 3×10","Pec Deck Fly 3×15","Cable Core Rotation 3×12"],
  },
};

// ─────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900;1,9..40,300;1,9..40,400&family=Inter:wght@300;400;500;600;700&display=swap');

:root {
  /* ── Gold: deeper amber — restrained, serious ── */
  --gold:      #A8822A;
  --gold-lt:   #C19830;
  --gold-dk:   #7A5E1A;
  --gold-pale: #D4AF6A;
  /* ── Surface scale: very deep matte blacks ── */
  --onyx:      #060504;
  --ink:       #080706;
  --charcoal:  #0D0C0A;
  --slate:     #121110;
  --smoke:     #191714;
  /* ── Text: crisp, not creamy ── */
  --ivory:     #F8F5F0;
  --ivory2:    #9A948C;
  --muted:     #4A4540;
  --fg:        #F8F5F0;
  /* ── Borders: barely visible — "Luxury is Quiet" ── */
  --border:    rgba(255,255,255,0.06);
  --r:    2px;
  --r-lg: 4px;
  --r-xl: 6px;
  /* ── Shadows: flat, no glow ── */
  --lux: 0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
  --glow: none;
}

/* ── LIGHT MODE THEME ─────────────────────────────────────────
   Warm premium cream palette — luxury feel, not harsh white
─────────────────────────────────────────────────────────────── */
[data-theme="light"] {
  --gold:      #8B6520;
  --gold-lt:   #A07828;
  --gold-dk:   #6B4F18;
  --gold-pale: #5A3E10;  --onyx:      #FAF7F2;
  --ink:       #F5F0E8;
  --charcoal:  #EEEAD8;
  --slate:     #E8E2D6;
  --smoke:     #DDD7C8;
  --ivory:     #2C2820;
  --ivory2:    #4A4438;
  --muted:     #7A7060;
  --lux: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  --glow: 0 0 30px rgba(139,101,32,0.12), 0 0 60px rgba(139,101,32,0.05);
  --fg: #2C2820;
  --border: rgba(139,101,32,0.2);
  --card: #EEEAD8;
}
[data-theme="light"] body { background:#FAF7F2 !important; color:#2C2820 !important; }
[data-theme="light"] .nav { background:rgba(250,247,242,0.95) !important; border-bottom:1px solid rgba(139,101,32,0.15); }
[data-theme="light"] .nav-wm-top { color:#8B6520; }
[data-theme="light"] .nav-wm-main { color:#2C2820; background:none; -webkit-text-fill-color:#2C2820; }
[data-theme="light"] .nav-pills { background:rgba(0,0,0,0.04); border-color:rgba(139,101,32,0.12); }
[data-theme="light"] .npill { color:#7A7060; }
[data-theme="light"] .npill:hover { color:#4A4438; }
[data-theme="light"] .npill.on { background:rgba(139,101,32,0.12); color:#8B6520; }
[data-theme="light"] .bgh { color:#4A4438; border-color:rgba(139,101,32,0.25); }
[data-theme="light"] .bgh:hover { background:rgba(139,101,32,0.08); }
[data-theme="light"] .bsm { color:#4A4438; border-color:rgba(139,101,32,0.2); background:rgba(0,0,0,0.04); }
[data-theme="light"] .bsm:hover { border-color:rgba(139,101,32,0.4); }
[data-theme="light"] .bsm.on { background:#8B6520; color:#FAF7F2; border-color:#8B6520; }
[data-theme="light"] .panel { background:#EEEAD8; border-color:rgba(139,101,32,0.15); }
[data-theme="light"] .ph { border-bottom-color:rgba(139,101,32,0.1); background:#EEEAD8; }
[data-theme="light"] .pb { background:#EEEAD8; }
[data-theme="light"] .fi { background:rgba(0,0,0,0.04); border-color:rgba(139,101,32,0.18); color:#2C2820; }
[data-theme="light"] .fi:focus { border-color:#8B6520; background:rgba(255,255,255,0.8); }
[data-theme="light"] select.fi { background:rgba(0,0,0,0.04); color:#2C2820; }
[data-theme="light"] .mtile { background:#E8E2D6; border-color:rgba(139,101,32,0.15); }
[data-theme="light"] .mtile:hover { border-color:rgba(139,101,32,0.45); box-shadow:0 8px 32px rgba(139,101,32,0.12); }
[data-theme="light"] .mtile.on { border-color:#8B6520; }
[data-theme="light"] .mt-img { filter:saturate(0.55) brightness(0.82) !important; }
[data-theme="light"] .mtile:hover .mt-img { filter:saturate(0.75) brightness(0.88) !important; }
[data-theme="light"] .mt-label { color:#2C2820; }
[data-theme="light"] .mtile.on .mt-label,[data-theme="light"] .mtile:hover .mt-label { color:#8B6520; }
[data-theme="light"] .mt-sub { color:#7A7060; }
[data-theme="light"] .sh2 { color:#2C2820; }
[data-theme="light"] .sh2 em { color:#8B6520; }
[data-theme="light"] .eyebrow { color:#8B6520; }
[data-theme="light"] .pt { color:#2C2820; }
[data-theme="light"] .pt em { color:#8B6520; }
[data-theme="light"] .inj-tag { background:rgba(139,101,32,0.08); border-color:rgba(139,101,32,0.2); color:#4A4438; }
[data-theme="light"] .inj-tag.s { background:rgba(139,101,32,0.18); border-color:#8B6520; color:#8B6520; }
[data-theme="light"] .freq-tile { background:#E8E2D6; border-color:rgba(139,101,32,0.15); color:#4A4438; }
[data-theme="light"] .freq-tile.on { background:#8B6520; border-color:#8B6520; color:#FAF7F2; }
[data-theme="light"] .freq-tile.on .freq-n { color:#FAF7F2; }
[data-theme="light"] .freq-tile.on .freq-lbl { color:rgba(255,255,255,0.75); }
[data-theme="light"] .freq-tile.on .freq-sub { color:rgba(255,255,255,0.6); }
[data-theme="light"] .mr { border-bottom-color:rgba(139,101,32,0.08); }
[data-theme="light"] .md { background:#8B6520; }
[data-theme="light"] .bdg { background:rgba(139,101,32,0.12); color:#8B6520; }
[data-theme="light"] .bg-g { background:rgba(75,174,113,0.15); color:#2A7A4A; }
[data-theme="light"] .noise { opacity:0.008; }
[data-theme="light"] ::-webkit-scrollbar-track { background:#F5F0E8; }
[data-theme="light"] ::-webkit-scrollbar-thumb { background:#A07828; }
[data-theme="light"] .toast { background:#1C1A17 !important; color:#E8E0D0 !important; }
[data-theme="light"] .mt { background:rgba(0,0,0,0.10); }
[data-theme="light"] .mv { color:#4A4438; }
[data-theme="light"] .mn { color:#5A5048; }
[data-theme="light"] .gi { border-bottom-color:rgba(0,0,0,0.07); color:#4A4438; }
[data-theme="light"] .meal-item-row { border-bottom-color:rgba(0,0,0,0.07); }
[data-theme="light"] .meal-item-name { color:#3A3028; }
[data-theme="light"] .er { border-bottom-color:rgba(0,0,0,0.07); }
[data-theme="light"] .en { color:#3A3028; }

/* Hero strip always dark */
[data-theme="light"] .dh-strip { background:rgba(8,8,7,0.88) !important; }
[data-theme="light"] .dh-stat-val { color:#F5F2EC !important; }
[data-theme="light"] .dh-stat-lbl { color:rgba(184,178,168,0.55) !important; }
[data-theme="light"] .dh-greet { color:#F5F2EC !important; }
[data-theme="light"] .dh-greet em { color:var(--gold-lt) !important; -webkit-text-fill-color:var(--gold-lt) !important; }
[data-theme="light"] .dh-eyebrow { color:var(--gold) !important; }
[data-theme="light"] .dh-badge { color:var(--gold) !important; }

/* Hero is always over a dark photo — keep text light in both themes */
[data-theme="light"] .hero-h1 { color:#F5F2EC; }
[data-theme="light"] .hero-h1 em { color:#D4AF37; }
[data-theme="light"] .hero-sub { color:rgba(245,242,236,0.75); }
[data-theme="light"] .hero-kick-txt { color:#D4AF37; }
[data-theme="light"] .hero-kick-line { background:#D4AF37; }
[data-theme="light"] .hero-scroll span { color:#D4AF37; }
/* Watch the Film ghost button — on dark hero bg, needs light styling */
[data-theme="light"] .hero-ctas .bgh { color:rgba(245,242,236,0.85); border-color:rgba(245,242,236,0.28); }
[data-theme="light"] .hero-ctas .bgh:hover { color:#F5F2EC; border-color:rgba(212,175,55,0.6); background:rgba(212,175,55,0.06); }
/* Stat bar has hardcoded dark bg — keep numbers and labels light */
[data-theme="light"] .sn { color:#F5F2EC; }
[data-theme="light"] .sl { color:rgba(184,178,168,0.7); }
[data-theme="light"] .scell:hover { background:rgba(212,175,55,0.06); }

/* ── Catch-all for any remaining hardcoded dark inline backgrounds ──────── */
[data-theme="light"] [style*="rgba(8,7,5"]   { background:var(--slate) !important; }
[data-theme="light"] [style*="rgba(20,19,16"] { background:var(--slate) !important; }
[data-theme="light"] [style*="rgba(14,13,11"] { background:var(--slate) !important; }
[data-theme="light"] [style*="rgba(255,255,255,0.06)"] { background:var(--border) !important; }
[data-theme="light"] [style*="rgba(255,255,255,0.05)"] { background:var(--border) !important; }
[data-theme="light"] [style*="rgba(255,255,255,0.04)"] { background:var(--border) !important; }

*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;background:var(--onyx);color:var(--ivory);min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased;}
::selection{background:rgba(191,161,106,0.2);}
::-webkit-scrollbar{width:4px;}
::-webkit-scrollbar-track{background:var(--ink);}
::-webkit-scrollbar-thumb{background:var(--gold-dk);border-radius:4px;}

/* NOISE */
.noise{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:0.022;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}

/* NAV — matte, minimal */
.nav{position:fixed;top:0;left:0;right:0;z-index:900;height:64px;
  display:flex;align-items:center;justify-content:space-between;padding:0 2.5rem;
  background:rgba(6,5,4,0.97);backdrop-filter:blur(20px);
  border-bottom:1px solid rgba(255,255,255,0.05);}

.nav-wm{display:flex;flex-direction:column;line-height:1;gap:2px;}
.nav-wm-top{font-family:'Inter',sans-serif;font-size:0.54rem;font-weight:500;letter-spacing:5px;text-transform:uppercase;color:var(--gold);opacity:0.65;}
.nav-wm-main{font-family:'DM Sans',sans-serif;font-size:1.1rem;font-weight:800;letter-spacing:8px;text-transform:uppercase;color:var(--ivory);}

.nav-pills{display:flex;gap:0;background:transparent;border:1px solid rgba(255,255,255,0.06);border-radius:2px;padding:3px;}
.npill{font-family:'Inter',sans-serif;font-size:0.62rem;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;
  color:var(--muted);background:none;border:none;cursor:pointer;padding:0.4rem 0.85rem;border-radius:1px;transition:all 0.15s;white-space:nowrap;}
.npill:hover{color:var(--ivory2);}
.npill.on{background:rgba(255,255,255,0.05);color:var(--ivory);}

.nav-r{display:flex;align-items:center;gap:0.75rem;}

/* BUTTONS — flat, matte, no glow */
.bg{font-family:'Inter',sans-serif;font-size:0.62rem;font-weight:700;letter-spacing:3.5px;text-transform:uppercase;
  background:var(--gold-lt);color:#060504;border:none;cursor:pointer;
  padding:0.7rem 1.8rem;border-radius:var(--r);transition:background 0.15s;}
.bg:hover{background:var(--gold-pale);box-shadow:none;transform:none;}

.bgh{font-family:'Inter',sans-serif;font-size:0.62rem;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;
  color:var(--ivory2);background:none;border:1px solid rgba(255,255,255,0.1);cursor:pointer;
  padding:0.68rem 1.5rem;border-radius:var(--r);transition:all 0.15s;}
.bgh:hover{border-color:rgba(255,255,255,0.22);color:var(--ivory);background:rgba(255,255,255,0.03);}

.bsm{font-family:'Inter',sans-serif;font-size:0.6rem;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;
  color:var(--muted);background:transparent;border:1px solid rgba(255,255,255,0.07);
  cursor:pointer;padding:0.32rem 0.75rem;border-radius:var(--r);transition:all 0.15s;}
.bsm:hover{color:var(--ivory2);border-color:rgba(255,255,255,0.14);}
.bsm.on{background:rgba(255,255,255,0.06);color:var(--ivory);border-color:rgba(255,255,255,0.14);}

/* HERO */
.hero{position:relative;min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;}
.hero-bg{position:absolute;inset:0;background-size:cover;background-position:center 30%;
  animation:hzoom 22s ease-in-out infinite alternate;}
@keyframes hzoom{from{transform:scale(1);}to{transform:scale(1.07);}}
.hero-vig{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(8,8,7,0.45)0%,rgba(8,8,7,0.15)30%,rgba(8,8,7,0.5)65%,rgba(8,8,7,0.98)100%);}
.hero-grain{position:absolute;inset:0;opacity:0.035;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
.hero-c{position:relative;z-index:2;padding:0 5rem 6.5rem;animation:hup 1.2s cubic-bezier(0.16,1,0.3,1) both;}
@keyframes hup{from{opacity:0;transform:translateY(50px);}to{opacity:1;transform:translateY(0);}}
.hero-kick{display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;}
.hero-kick-line{height:1px;width:48px;background:var(--gold);opacity:0.55;}
.hero-kick-txt{font-size:0.74rem;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--gold);}
.hero-h1{font-family:'DM Sans',sans-serif;font-size:clamp(3.8rem,8vw,7.5rem);font-weight:800;line-height:0.92;color:var(--ivory);margin-bottom:1.5rem;letter-spacing:4px;text-transform:uppercase;}
.hero-h1 em{font-style:normal;color:var(--gold-lt);display:block;font-weight:300;letter-spacing:3px;text-transform:uppercase;}
.hero-sub{font-family:'Inter',sans-serif;font-size:0.95rem;font-weight:400;letter-spacing:0.3px;
  color:var(--ivory2);max-width:480px;line-height:1.75;margin-bottom:2.5rem;}
.hero-ctas{display:flex;gap:1rem;align-items:center;}
.hero-scroll{position:absolute;bottom:2.5rem;right:5rem;z-index:2;display:flex;flex-direction:column;align-items:center;gap:0.4rem;opacity:0.45;animation:sb 2s ease-in-out infinite;}
@keyframes sb{0%,100%{transform:translateY(0);}50%{transform:translateY(6px);}}
.hero-scroll span{font-size:0.52rem;letter-spacing:3px;text-transform:uppercase;color:var(--gold);}

/* STAT BAR */
.sbar{position:relative;z-index:2;display:grid;grid-template-columns:repeat(5,1fr);
  border-top:1px solid rgba(255,255,255,0.05);background:rgba(6,5,4,0.97);}
.scell{padding:1.75rem 1.5rem;text-align:center;border-right:1px solid rgba(255,255,255,0.04);transition:background 0.2s;}
.scell:last-child{border-right:none;}
.scell:hover{background:rgba(255,255,255,0.02);}
.sn{font-family:'DM Sans',sans-serif;font-size:2.4rem;font-weight:800;color:var(--ivory);line-height:1;letter-spacing:1px;}
.sl{font-family:'Inter',sans-serif;font-size:0.58rem;font-weight:500;letter-spacing:3.5px;text-transform:uppercase;color:var(--muted);margin-top:0.35rem;}

/* LAYOUT */
.wrap{max-width:1380px;margin:0 auto;padding:0 2.5rem;}

/* SECTION LABELS */
.eyebrow{font-family:'Inter',sans-serif;font-size:0.55rem;font-weight:600;letter-spacing:5px;text-transform:uppercase;color:var(--gold);opacity:0.8;margin-bottom:0.6rem;
  display:flex;align-items:center;gap:0.6rem;}
.eyebrow::before{content:'';width:18px;height:1px;background:var(--gold);opacity:0.5;}
/* Phase 2: Massive tracked uppercase — "NUTRITION PLAN" style */
.sh2{font-family:'DM Sans',sans-serif;font-size:clamp(2.2rem,4.5vw,4.2rem);font-weight:800;
  line-height:0.95;color:var(--ivory);letter-spacing:3px;text-transform:uppercase;}
.sh2 em{font-style:normal;color:var(--gold-lt);font-weight:300;letter-spacing:2px;}

/* SPORT TILES */
.sport-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;
  background:rgba(191,161,106,0.07);border:1px solid rgba(191,161,106,0.07);border-radius:var(--r-xl);overflow:hidden;}
.stile{position:relative;aspect-ratio:3/4;overflow:hidden;cursor:pointer;transition:transform 0.5s cubic-bezier(0.16,1,0.3,1);}
.stile:hover{z-index:2;transform:scale(1.04);}
.stile.sel{z-index:3;}
.stile-img{position:absolute;inset:0;background-size:cover;background-position:center;
  filter:saturate(0.6) brightness(0.55);transition:all 0.65s cubic-bezier(0.16,1,0.3,1);}
.stile:hover .stile-img{transform:scale(1.1);filter:saturate(0.9) brightness(0.7);}
.stile.sel .stile-img{filter:saturate(1.1) brightness(0.55);}
.stile-ov{position:absolute;inset:0;background:linear-gradient(180deg,transparent 20%,rgba(8,8,7,0.92)100%);}
.stile.sel .stile-ov{background:linear-gradient(180deg,rgba(255,255,255,0.03)0%,rgba(8,8,7,0.94)100%);}
.stile-body{position:absolute;bottom:0;left:0;right:0;padding:1.5rem 1.25rem;}
.stile-icon{width:38px;height:38px;border-radius:4px;margin-bottom:0.55rem;
  background:rgba(201,168,76,0.12);border:1px solid rgba(255,255,255,0.09);
  display:flex;align-items:center;justify-content:center;
  font-family:'DM Sans',sans-serif;font-size:0.68rem;font-weight:700;letter-spacing:1.5px;color:var(--gold);}
.stile-name{font-family:'DM Sans',sans-serif;font-size:0.82rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--ivory);}
.stile.sel .stile-name,.stile:hover .stile-name{color:var(--gold-lt);}
.stile-bar{width:0;height:1px;background:var(--gold);margin-top:0.6rem;transition:width 0.4s;}
.stile:hover .stile-bar,.stile.sel .stile-bar{width:32px;}
.stile-ck{position:absolute;top:0.9rem;right:0.9rem;width:26px;height:26px;border-radius:50%;
  background:transparent;border:1px solid transparent;display:flex;align-items:center;justify-content:center;
  font-size:0.76rem;color:transparent;font-weight:700;transition:all 0.3s;}
.stile.sel .stile-ck{background:var(--gold);border-color:var(--gold);color:var(--onyx);}

/* BENTO TILES */
.bento{display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:min-content;gap:10px;}
.bt{position:relative;overflow:hidden;cursor:pointer;border-radius:var(--r-lg);
  border:1px solid rgba(255,255,255,0.05);background:var(--charcoal);
  transition:all 0.42s cubic-bezier(0.16,1,0.3,1);min-height:190px;}
.bt:hover{border-color:rgba(255,255,255,0.12);box-shadow:var(--glow);transform:translateY(-3px);}
.bt-a{grid-column:span 7;grid-row:span 2;min-height:400px;}
.bt-b,.bt-c{grid-column:span 5;}
.bt-d,.bt-e,.bt-f{grid-column:span 4;}
.bt-img{position:absolute;inset:0;background-size:cover;background-position:center;
  filter:saturate(0.45) brightness(0.32);transition:all 0.6s;}
.bt:hover .bt-img{filter:saturate(0.7) brightness(0.42);transform:scale(1.05);}
.bt-ov{position:absolute;inset:0;background:linear-gradient(135deg,rgba(8,8,7,0.65)0%,transparent100%);}
.bt-arr{position:absolute;top:1.4rem;right:1.4rem;width:34px;height:34px;border-radius:50%;
  border:1px solid rgba(191,161,106,0.2);display:flex;align-items:center;justify-content:center;
  font-size:0.85rem;color:var(--gold);opacity:0;transition:all 0.3s;}
.bt:hover .bt-arr{opacity:1;transform:rotate(-45deg);}
.bt-body{position:relative;z-index:1;padding:1.75rem;height:100%;display:flex;flex-direction:column;justify-content:flex-end;}
.bt-num{font-family:'Inter',sans-serif;font-size:0.58rem;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:var(--gold);opacity:0.7;margin-bottom:0.6rem;}
.bt-title{font-family:'DM Sans',sans-serif;font-size:1.25rem;font-weight:700;letter-spacing:-0.3px;color:var(--ivory);line-height:1.15;margin-bottom:0.4rem;}
.bt-a .bt-title{font-size:2rem;letter-spacing:-0.5px;}
.bt-desc{font-family:'Inter',sans-serif;font-size:0.82rem;line-height:1.7;color:var(--ivory2);font-weight:400;max-width:340px;}

/* PRICING */
.price-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;
  background:rgba(191,161,106,0.07);border:1px solid rgba(191,161,106,0.07);border-radius:var(--r-xl);overflow:hidden;}
.ptile{background:var(--charcoal);padding:3rem 2.5rem;position:relative;overflow:hidden;transition:background 0.35s;}
.ptile:hover{background:var(--slate);}
.ptile.feat{background:var(--slate);}
.ptile.feat::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at top,rgba(191,161,106,0.07)0%,transparent70%);}
.ptile.feat::after{content:'MOST POPULAR';position:absolute;top:18px;right:-32px;background:var(--gold);color:var(--onyx);
  font-size:0.52rem;font-weight:700;letter-spacing:2px;padding:0.28rem 3.5rem;transform:rotate(45deg);}
.pt-tier{font-family:'Inter',sans-serif;font-size:0.6rem;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:var(--gold);margin-bottom:1.25rem;}
.pt-name{font-family:'DM Sans',sans-serif;font-size:1.5rem;font-weight:700;letter-spacing:-0.5px;color:var(--ivory);line-height:1;margin-bottom:0.2rem;}
.pt-amt{font-family:'DM Sans',sans-serif;font-size:4rem;font-weight:700;line-height:1;color:var(--ivory);letter-spacing:-3px;}
.pt-per{font-family:'Inter',sans-serif;font-size:0.65rem;font-weight:500;color:var(--muted);letter-spacing:1px;margin-bottom:2rem;}
.pt-feats{list-style:none;margin-bottom:2rem;}
.pt-feats li{padding:0.5rem 0;font-family:'Inter',sans-serif;font-size:0.82rem;color:var(--ivory2);border-bottom:1px solid rgba(255,255,255,0.04);
  display:flex;gap:0.65rem;align-items:center;font-weight:400;}
.pt-feats li::before{content:'—';color:var(--gold);font-family:'Inter',sans-serif;flex-shrink:0;font-size:0.7rem;}

/* DASHBOARD */
.dash-hero{position:relative;height:340px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;margin-bottom:2.5rem;}
.dh-bg{position:absolute;inset:0;background-size:cover;background-position:center 30%;
  filter:saturate(0.3) brightness(0.28);transition:all 0.8s;}
.dh-vig{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(6,5,4,0.05)0%,rgba(6,5,4,0.15)35%,rgba(6,5,4,0.97)100%);}
/* Thin gold rule across top */
.dh-rule{position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(168,130,42,0.6),transparent);z-index:2;}
.dh-c{position:relative;z-index:2;padding:0 2.5rem 0;}
.dh-eyebrow{font-family:'Inter',sans-serif;font-size:0.52rem;font-weight:600;letter-spacing:5px;
  text-transform:uppercase;color:var(--gold);opacity:0.65;margin-bottom:0.5rem;
  display:flex;align-items:center;gap:0.5rem;}
.dh-eyebrow::before{content:'';width:16px;height:1px;background:var(--gold);opacity:0.5;}
.dh-greet{font-family:'DM Sans',sans-serif;font-size:3.2rem;font-weight:800;color:#F8F5F0;
  line-height:0.92;letter-spacing:2px;text-transform:uppercase;margin-bottom:0.8rem;}
.dh-greet em{font-style:normal;color:var(--gold-lt);font-weight:300;display:block;font-size:2.4rem;letter-spacing:1px;}
.dh-badge{display:inline-flex;align-items:center;gap:0.5rem;background:rgba(255,255,255,0.04);
  border:1px solid rgba(255,255,255,0.1);border-radius:1px;padding:0.28rem 0.75rem;
  font-size:0.52rem;font-weight:600;letter-spacing:3.5px;text-transform:uppercase;color:rgba(248,245,240,0.65);}
/* Bottom stats strip */
.dh-strip{position:relative;z-index:2;
  display:grid;grid-template-columns:repeat(4,1fr);
  border-top:1px solid rgba(255,255,255,0.05);
  background:rgba(6,5,4,0.95);
  margin-top:1.5rem;}
.dh-stat{padding:0.85rem 1.5rem;border-right:1px solid rgba(255,255,255,0.04);}
.dh-stat:last-child{border-right:none;}
.dh-stat-val{font-family:'DM Sans',sans-serif;font-size:1.5rem;font-weight:800;color:#F8F5F0;line-height:1;letter-spacing:-0.5px;}
.dh-stat-lbl{font-family:'Inter',sans-serif;font-size:0.52rem;font-weight:600;letter-spacing:3px;
  text-transform:uppercase;color:rgba(154,148,140,0.5);margin-top:0.2rem;}
.dh-acts{position:absolute;top:1.25rem;right:2rem;z-index:3;display:flex;gap:0.45rem;}

/* MODULE TILES */
.mod-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:2.5rem;}
.mtile{background:var(--charcoal);border:1px solid rgba(255,255,255,0.05);border-radius:var(--r-lg);
  overflow:hidden;cursor:pointer;transition:border-color 0.25s,transform 0.25s;position:relative;min-height:155px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);}
.mtile:hover{border-color:rgba(255,255,255,0.12);transform:translateY(-2px);}
.mtile.on{border-color:rgba(168,130,42,0.5);}
.mt-img{position:absolute;inset:0;background-size:cover;background-position:center;
  filter:saturate(0.2) brightness(0.22);transition:all 0.4s;}
.mtile:hover .mt-img{filter:saturate(0.45) brightness(0.32);transform:scale(1.04);}
.mtile.on .mt-img{filter:saturate(0.55) brightness(0.28);}
.mt-grad{position:absolute;inset:0;background:linear-gradient(135deg,rgba(6,5,4,0.65)0%,transparent 70%);}
.mt-dot{position:absolute;top:0.9rem;right:0.9rem;width:4px;height:4px;border-radius:50%;
  background:var(--gold);opacity:0;transition:opacity 0.2s;}
.mtile.on .mt-dot{opacity:0.8;}
.mt-body{position:relative;z-index:1;padding:1.25rem;height:100%;display:flex;flex-direction:column;justify-content:space-between;}
.mt-icon{width:36px;height:36px;border-radius:2px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
  display:flex;align-items:center;justify-content:center;
  font-family:'DM Sans',sans-serif;font-size:0.65rem;font-weight:700;letter-spacing:1.5px;color:var(--ivory2);}
.mt-label{font-family:'DM Sans',sans-serif;font-size:0.7rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--ivory);line-height:1;margin-top:2rem;}
.mtile.on .mt-label,.mtile:hover .mt-label{color:#F8F5F0;}
.mt-sub{font-family:'Inter',sans-serif;font-size:0.58rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-top:0.2rem;font-weight:400;}

/* PANEL — matte glass, inset effect */
.panel{background:var(--charcoal);border:1px solid rgba(255,255,255,0.05);border-radius:var(--r-lg);overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.03),0 1px 3px rgba(0,0,0,0.4);}
.ph{padding:1.4rem 1.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;}
.pt{font-family:'DM Sans',sans-serif;font-size:1.1rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--ivory);}
.pt em{font-style:normal;color:var(--gold-lt);font-weight:300;letter-spacing:0.5px;}
.pb{padding:1.5rem 1.75rem;}

/* INPUTS — clean underline */
.f{margin-bottom:1.4rem;}
.fl{display:block;font-family:'Inter',sans-serif;font-size:0.55rem;font-weight:600;letter-spacing:3.5px;text-transform:uppercase;color:var(--muted);margin-bottom:0.55rem;}
.fi{width:100%;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.1);border-radius:0;
  color:var(--ivory);font-family:'Inter',sans-serif;font-size:0.9rem;font-weight:400;
  padding:0.8rem 0.15rem;transition:border-color 0.15s;outline:none;-webkit-appearance:none;}
.fi:focus{border-bottom-color:var(--gold);background:rgba(255,255,255,0.01);}
.fi option{background:var(--charcoal);color:var(--ivory);}
textarea.fi{resize:vertical;min-height:115px;border:1px solid rgba(201,168,76,0.18);border-radius:var(--r);padding:0.85rem 0.9rem;}
textarea.fi:focus{border-color:rgba(255,255,255,0.25);}

/* GRID */
.two{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;}
.three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;}
.four{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;}
@media(max-width:700px){.two,.three,.four{grid-template-columns:1fr;}}
@media(max-width:900px){.four{grid-template-columns:1fr 1fr;} .mod-grid{grid-template-columns:repeat(2,1fr);}}

/* RULE */
.gr{height:1px;background:linear-gradient(90deg,transparent,rgba(191,161,106,0.28),transparent);margin:1.6rem 0;}

/* MEAL */
.mg{margin-bottom:1.4rem;}
.mg-lbl{font-size:0.72rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin-bottom:0.7rem;display:flex;align-items:center;gap:0.55rem;}
.mr{display:flex;align-items:center;gap:0.7rem;padding:0.52rem 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.9rem;color:var(--ivory2);font-weight:300;}
.md{width:4px;height:4px;border-radius:50%;background:var(--gold);flex-shrink:0;opacity:0.55;}

/* WORKOUT */
.er{display:flex;justify-content:space-between;align-items:center;padding:0.68rem 0;border-bottom:1px solid rgba(255,255,255,0.03);}
.en{font-size:0.82rem;color:var(--ivory2);font-weight:300;}
.et{font-size:0.74rem;font-weight:700;letter-spacing:1.5px;padding:0.22rem 0.6rem;border-radius:20px;
  background:rgba(255,255,255,0.05);color:var(--gold);border:1px solid rgba(191,161,106,0.18);}

/* MACRO */
.mr2{margin-bottom:1.2rem;}
.mh{display:flex;justify-content:space-between;margin-bottom:0.38rem;}
.mn{font-size:0.73rem;color:var(--ivory2);font-weight:400;}
.mv{font-family:'DM Sans',sans-serif;font-size:0.73rem;font-weight:700;color:var(--gold);}
.mt{background:rgba(255,255,255,0.05);border-radius:20px;height:4px;overflow:hidden;}
.mf{height:100%;border-radius:20px;background:linear-gradient(90deg,var(--gold-dk),var(--gold-lt));transition:width 1.2s cubic-bezier(0.16,1,0.3,1);}

/* GROCERY */
.gg{display:grid;grid-template-columns:1fr 1fr;}
.gi{display:flex;align-items:center;gap:0.7rem;padding:0.55rem 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.88rem;color:var(--ivory2);font-weight:300;}
.gc{width:14px;height:14px;border-radius:2px;border:1px solid rgba(255,255,255,0.12);flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-size:8px;cursor:pointer;transition:all 0.15s;}
.gc.ck{background:var(--gold);border-color:var(--gold);color:var(--onyx);font-weight:700;}

/* BADGE */
.bdg{display:inline-flex;align-items:center;font-size:0.58rem;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;padding:0.22rem 0.65rem;border-radius:2px;}
.bg-g{background:rgba(255,255,255,0.05);color:var(--ivory2);border:1px solid rgba(255,255,255,0.1);}
.bg-green{background:rgba(46,160,100,0.1);color:#4BAE71;border:1px solid rgba(46,160,100,0.22);}
.bg-red{background:rgba(155,58,47,0.1);color:#C0695E;border:1px solid rgba(155,58,47,0.22);}

/* INJURY */
.inj-tag{display:inline-block;margin:0.22rem;background:rgba(155,58,47,0.09);border:1px solid rgba(155,58,47,0.22);
  color:#B86058;font-size:0.82rem;font-weight:300;padding:0.38rem 0.85rem;border-radius:20px;cursor:pointer;transition:all 0.22s;}
.inj-tag:hover{background:rgba(155,58,47,0.18);border-color:rgba(155,58,47,0.45);}
.inj-tag.s{background:rgba(155,58,47,0.22);border-color:#B86058;color:#D4877E;}

/* JOURNAL */
.je{background:var(--slate);border:1px solid rgba(255,255,255,0.05);border-radius:var(--r-lg);padding:1.4rem;margin-bottom:0.7rem;transition:border-color 0.2s;}
.je:hover{border-color:rgba(255,255,255,0.1);}
.jd{font-size:0.58rem;letter-spacing:3.5px;text-transform:uppercase;color:var(--muted);margin-bottom:0.45rem;}
.jt{font-family:'Inter',sans-serif;font-size:0.9rem;font-weight:400;color:var(--ivory2);line-height:1.75;}

/* METRIC TILE */
.metr{background:var(--slate);border:1px solid rgba(255,255,255,0.05);border-radius:var(--r-lg);padding:1.4rem;transition:all 0.28s;}
.metr:hover{border-color:rgba(191,161,106,0.22);transform:translateY(-2px);}
.ml{font-size:0.55rem;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted);margin-bottom:0.45rem;font-weight:600;}
.mv2{font-family:'DM Sans',sans-serif;font-size:2.4rem;font-weight:700;color:var(--ivory);line-height:1;letter-spacing:-2px;}
.md2{font-size:0.68rem;color:#4BAE71;margin-top:0.28rem;font-weight:500;}

/* CALENDAR */
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
.chd{text-align:center;font-size:0.72rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);padding:0.45rem 0;}
.cd{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:var(--r);font-size:0.9rem;
  cursor:pointer;transition:all 0.18s;border:1px solid transparent;color:var(--ivory2);font-weight:300;}
.cd:hover{background:rgba(191,161,106,0.08);border-color:rgba(191,161,106,0.18);}
.cd.tod{border-color:var(--gold);color:var(--gold);font-weight:600;}
.cd.hev{position:relative;}
.cd.hev::after{content:'';position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--gold);}
.cd.oth{opacity:0.18;}
.cd.sl2{background:rgba(191,161,106,0.13);border-color:var(--gold);}

/* PHOTO DROP */
.pdrop{border:1px dashed rgba(191,161,106,0.22);border-radius:var(--r-lg);min-height:175px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.45rem;
  cursor:pointer;transition:all 0.28s;background:rgba(191,161,106,0.02);text-align:center;padding:1.5rem;}
.pdrop:hover{border-color:var(--gold);background:rgba(191,161,106,0.05);}
.pdrop-ic{font-size:2rem;opacity:0.45;}
.pdrop-lb{font-size:0.68rem;letter-spacing:1.5px;color:var(--muted);font-weight:400;}

/* PAYMENT */
.pmbg{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.88);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;padding:1rem;}
.pm{background:var(--charcoal);border:1px solid rgba(191,161,106,0.18);border-radius:var(--r-xl);
  width:100%;max-width:475px;max-height:90vh;overflow-y:auto;box-shadow:var(--lux);}
.pmh{padding:1.9rem 2.4rem 1.4rem;border-bottom:1px solid rgba(191,161,106,0.07);display:flex;justify-content:space-between;align-items:flex-start;}
.pmb{padding:1.9rem 2.4rem 2.4rem;}
.ptabs{display:flex;gap:3px;background:rgba(255,255,255,0.03);border-radius:var(--r);padding:3px;margin-bottom:1.4rem;}
.ptab{flex:1;padding:0.58rem;border:none;background:none;font-family:'Inter',sans-serif;font-size:0.58rem;font-weight:600;
  letter-spacing:2px;text-transform:uppercase;cursor:pointer;border-radius:var(--r);transition:all 0.15s;color:var(--muted);}
.ptab.on{background:rgba(255,255,255,0.07);color:var(--ivory);}
.ppb{width:100%;padding:0.9rem;border-radius:var(--r);border:none;background:#003087;color:white;cursor:pointer;
  font-size:1rem;font-weight:700;display:flex;align-items:center;justify-content:center;gap:0.5rem;transition:all 0.22s;}
.ppb:hover{background:#002070;box-shadow:0 8px 30px rgba(0,48,135,0.4);transform:translateY(-1px);}

/* TOAST */
.toast{position:fixed;bottom:2rem;right:2rem;z-index:9999;
  background:#1C1A17;
  border:1px solid rgba(255,255,255,0.14);border-radius:var(--r-lg);padding:0.9rem 1.4rem;
  display:flex;align-items:center;gap:0.7rem;
  box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 0 1px rgba(201,168,76,0.1);
  animation:tin 0.4s cubic-bezier(0.16,1,0.3,1);}
@keyframes tin{from{transform:translateX(100%);opacity:0;}to{transform:translateX(0);opacity:1;}}
.toast-m{font-size:0.88rem;color:#E8E0D0;font-weight:400;letter-spacing:0.2px;}
/* Always override in light mode — toast is always dark for contrast */
[data-theme="light"] .toast{background:#1C1A17 !important;border-color:rgba(255,255,255,0.14) !important;}
[data-theme="light"] .toast .toast-m{color:#E8E0D0 !important;}

/* AVATAR */
.av{width:78px;height:78px;border-radius:50%;border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:2rem;background:rgba(191,161,106,0.06);margin:0 auto 1.2rem;}

/* SUCCESS */
.succ{position:fixed;inset:0;z-index:9998;background:var(--onyx);display:flex;align-items:center;justify-content:center;animation:sfade 0.5s ease;}
@keyframes sfade{from{opacity:0;}to{opacity:1;}}
.succ-inner{text-align:center;}
.succ-icon{font-size:5rem;margin-bottom:1.5rem;}
.succ-h{font-family:'DM Sans',sans-serif;font-size:3rem;font-weight:700;color:var(--ivory);letter-spacing:-1px;}
.succ-sub{font-size:0.76rem;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-top:0.75rem;}

/* CHART */
.chart-svg{width:100%;overflow:visible;}
@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8);}50%{opacity:1;transform:scale(1.1);}}
#coach-msgs{scroll-behavior:smooth;}

/* MEAL FREQUENCY SELECTOR */
.freq-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:1.5rem;}
.freq-tile{background:var(--slate);border:1px solid rgba(255,255,255,0.06);border-radius:var(--r-lg);
  padding:1.1rem 1rem;text-align:center;cursor:pointer;transition:all 0.2s;}
.freq-tile:hover{border-color:rgba(255,255,255,0.12);transform:translateY(-1px);}
.freq-tile.on{border-color:rgba(255,255,255,0.2);background:rgba(255,255,255,0.07);}
.freq-n{font-family:'DM Sans',sans-serif;font-size:2rem;font-weight:800;color:var(--ivory);line-height:1;letter-spacing:1px;}
.freq-tile.on .freq-n{color:var(--gold);}
.freq-lbl{font-size:0.74rem;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:0.3rem;}
.freq-tile.on .freq-lbl{color:var(--gold);}
.freq-sub{font-family:'Inter',sans-serif;font-size:0.68rem;color:var(--muted);margin-top:0.2rem;letter-spacing:1px;}

/* MEAL BLOCK */
.meal-block{background:var(--slate);border:1px solid rgba(191,161,106,0.08);border-radius:var(--r-lg);
  margin-bottom:0.75rem;overflow:hidden;transition:border-color 0.3s;}
.meal-block:hover{border-color:rgba(191,161,106,0.22);}
.meal-block-head{padding:0.9rem 1.25rem;display:flex;align-items:center;justify-content:space-between;
  cursor:pointer;border-bottom:1px solid rgba(191,161,106,0.06);}
.meal-block-left{display:flex;align-items:center;gap:0.75rem;}
.meal-block-emoji{width:36px;height:36px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.meal-block-label{font-family:'Inter',sans-serif;font-size:0.88rem;font-weight:500;color:var(--ivory);}
.meal-block-time{font-size:0.74rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:0.1rem;}
.meal-block-cal{font-family:'DM Sans',sans-serif;font-size:1.3rem;font-weight:700;color:var(--ivory);line-height:1;letter-spacing:-0.5px;}
.meal-block-cal-lbl{font-size:0.68rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-align:right;}
.meal-block-body{padding:0.85rem 1.25rem;}
.meal-item-row{display:flex;align-items:center;justify-content:space-between;
  padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.03);}
.meal-item-row:last-child{border-bottom:none;}
.meal-item-name{font-size:0.9rem;color:var(--ivory2);font-weight:300;line-height:1.6;display:flex;align-items:center;gap:0.6rem;}
.meal-item-macros{display:flex;gap:0.5rem;flex-shrink:0;}
.macro-chip{font-size:0.72rem;font-weight:600;letter-spacing:1px;padding:0.18rem 0.5rem;border-radius:20px;}
.mc-cal{background:rgba(191,161,106,0.12);color:var(--gold);border:1px solid rgba(191,161,106,0.2);}
.mc-p{background:rgba(46,160,100,0.1);color:#4BAE71;border:1px solid rgba(46,160,100,0.2);}
.mc-c{background:rgba(58,107,155,0.12);color:#6AABCC;border:1px solid rgba(58,107,155,0.2);}
.mc-f{background:rgba(180,120,50,0.12);color:#C8884A;border:1px solid rgba(180,120,50,0.2);}

/* DAILY TOTALS BAR */
.totals-bar{background:linear-gradient(135deg,rgba(191,161,106,0.1)0%,rgba(191,161,106,0.04)100%);
  border:1px solid rgba(191,161,106,0.22);border-radius:var(--r-lg);padding:1.25rem 1.5rem;
  display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.25rem;}
.tot-cell{text-align:center;}
.tot-val{font-family:'DM Sans',sans-serif;font-size:2rem;font-weight:700;line-height:1;letter-spacing:-1px;}
.tot-val.cal{color:var(--gold-lt);}
.tot-val.pro{color:#4BAE71;}
.tot-val.carb{color:#6AABCC;}
.tot-val.fat{color:#C8884A;}
.tot-lbl{font-size:0.52rem;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted);margin-top:0.25rem;}

`;

// ─────────────────────────────────────────────────────────────
// ROOT COMPONENT
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("landing");
  const [dash, setDash] = useState("nutrition");
  const [toast, setToast] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [payTab, setPayTab] = useState("card");
  const [success, setSuccess] = useState(false);

  // ── AUTH STATE ───────────────────────────────────────────────
  const [authUser,    setAuthUser]    = useState(null);
  const [authModal,   setAuthModal]   = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [dbLoading,   setDbLoading]   = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [emailModal,  setEmailModal]  = useState(null);

  // ── IN-APP CAMERA ─────────────────────────────────────────────
  // Works on desktop + mobile via getUserMedia (unlike HTML capture attr which is mobile-only)
  const [cameraModal, setCameraModal] = useState(null); // null | 'profile-before' | 'profile-after' | 'progress'
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraFacing, setCameraFacing] = useState('environment');
  const cameraVideoRef = useRef(null);

  // Attach stream to video element when modal opens
  useEffect(() => {
    if (cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream;
      cameraVideoRef.current.play().catch(()=>{});
    }
  }, [cameraStream]);

  const openCamera = async (target) => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        shout("Camera not supported in this browser — use Upload instead","!");
        return;
      }
      // Stop any existing stream first
      if (cameraStream) cameraStream.getTracks().forEach(t=>t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width:{ideal:1280}, height:{ideal:720} },
        audio: false,
      });
      setCameraStream(stream);
      setCameraModal(target);
    } catch(e) {
      console.error('Camera error:', e.message);
      if (e.name === 'NotAllowedError') shout("Camera permission denied — please allow camera access","!");
      else if (e.name === 'NotFoundError') shout("No camera found — use Upload instead","!");
      else shout("Camera unavailable — use Upload instead","!");
    }
  };

  const closeCamera = () => {
    if (cameraStream) cameraStream.getTracks().forEach(t=>t.stop());
    setCameraStream(null);
    setCameraModal(null);
  };

  const flipCamera = async () => {
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(newFacing);
    if (cameraStream) cameraStream.getTracks().forEach(t=>t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing },
        audio: false,
      });
      setCameraStream(stream);
    } catch(e) { shout("Could not flip camera","!"); }
  };

  const capturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  const [profile, setProfile] = useState({ name:"", weight:"", height:"", age:"", sport:"football", position:"", goal:"Weight Maintenance" });
  const [mealType, setMealType] = useState("Weight Maintenance");
  const [mealFreq, setMealFreq] = useState(5);
  const [mealView, setMealView] = useState("daily"); // "daily" | "weekly" | "monthly"
  const [expandedDay, setExpandedDay] = useState(null);
  const [wkType, setWkType] = useState("Strength Training");
  const [wkFocus, setWkFocus] = useState("Full Body");
  const [wkWeek, setWkWeek] = useState(1);
  const [wkLog, setWkLog] = useState([]);
  const [logEntry, setLogEntry] = useState({});
  const [showLog, setShowLog] = useState(false);
  // Enhanced workout logger state
  const [activeSession, setActiveSession] = useState(null); // null | {startTime, exercise, sets:[{reps,load,rpe,done}]}
  const [sessionLog, setSessionLog] = useState([]); // completed exercises this session [{name,sets,totalVol,isPR}]
  const [restTimer, setRestTimer] = useState(null); // null | {endTime, duration}
  const [restTick, setRestTick] = useState(0); // forces re-render for countdown
  const [showSessionSummary, setShowSessionSummary] = useState(false);
  // Flexible weekly schedule — athlete can drag/reorder workout days
  const [weekSchedule, setWeekSchedule] = useState([
    {day:"Mon", wkType:"Strength Training", wkFocus:"Full Body",   active:true},
    {day:"Tue", wkType:"Athletic Performance", wkFocus:"Lower Body", active:true},
    {day:"Wed", wkType:"Muscle Building", wkFocus:"Upper Body",    active:false, label:"Rest"},
    {day:"Thu", wkType:"Strength Training", wkFocus:"Lower Body",  active:true},
    {day:"Fri", wkType:"Athletic Performance", wkFocus:"Full Body", active:true},
    {day:"Sat", wkType:"Muscle Building", wkFocus:"Upper Body",    active:false, label:"Active Recovery"},
    {day:"Sun", wkType:"",                  wkFocus:"",             active:false, label:"Rest"},
  ]);
  const [editSchedule, setEditSchedule] = useState(false);
  const [selInj, setSelInj] = useState([]);  // multi-select array
  const [jText, setJText] = useState("");
  const [jTitle, setJTitle] = useState("");
  const [jEntries, setJEntries] = useState([]);
  const [grocery, setGrocery] = useState({});
  // Profile photos
  const [profilePhotoBefore, setProfilePhotoBefore] = useState(null); // base64
  const [profilePhotoAfter, setProfilePhotoAfter]   = useState(null);
  // Progress photo journal: [{id, date, label, dataUrl, weight, note}]
  const [progressPhotos, setProgressPhotos] = useState([]);
  const [photoNote, setPhotoNote] = useState("");
  const [photoLabel, setPhotoLabel] = useState("Progress");
  const [photoWeight, setPhotoWeight] = useState("");

  // ── ELITE ANALYTICS STATE ────────────────────────────────────
  // Daily check-in log [{date, recovery, energy, sleep, soreness, mood, notes}]
  const [checkIns, setCheckIns] = useState([]);
  const [todayCheckIn, setTodayCheckIn] = useState({recovery:7, energy:7, sleep:8, soreness:3, mood:7, notes:""});
  const [checkInDone, setCheckInDone] = useState(false);

  // Weight log [{date, weight, bodyFat}]
  const [weightLog, setWeightLog] = useState([]);
  const [newWeight, setNewWeight] = useState("");
  const [newBodyFat, setNewBodyFat] = useState("");

  // Body measurements [{date, chest, waist, hips, arms, thighs}]
  const [measurements, setMeasurements] = useState([]);
  const [newMeasure, setNewMeasure] = useState({chest:"", waist:"", hips:"", arms:"", thighs:""});

  // Nutrition log [{date, calories, protein, carbs, fat, water}]
  const [nutritionLog, setNutritionLog] = useState([]);
  const [todayNutrition, setTodayNutrition] = useState({calories:"", protein:"", carbs:"", fat:"", water:""});
  // Food search + macro calculator state
  const [foodQuery, setFoodQuery] = useState("");
  const [foodResults, setFoodResults] = useState([]);
  const [foodSearching, setFoodSearching] = useState(false);
  const [foodLog, setFoodLog] = useState([]); // today's food items [{name,cal,p,c,f,qty,unit}]
  const [selectedFood, setSelectedFood] = useState(null);
  const [foodQty, setFoodQty] = useState("100");
  const [macroMode, setMacroMode] = useState("search"); // "search" | "manual" | "calculator"
  const [customFood, setCustomFood] = useState({name:"",cal:"",protein:"",carbs:"",fat:"",qty:"1",unit:"serving"});
  // Macro calculator inputs
  const [macroCalcInputs, setMacroCalcInputs] = useState({weight:"",height:"",age:"",sex:"male",activityLevel:"moderate",goal:"maintain"});

  // Performance benchmarks [{date, test, value, unit, notes}]
  const [benchmarks, setBenchmarks] = useState([]);
  const [newBench, setNewBench] = useState({test:"40-Yard Dash", value:"", unit:"sec", notes:""});

  // Progress tab sub-view
  const [progressTab, setProgressTab] = useState("overview");
  const [recruitingEmail, setRecruitingEmail] = useState("");
  const [recruitingNote, setRecruitingNote] = useState("");
  const [recruitingCardSent, setRecruitingCardSent] = useState(false);
  // Coach Connect state
  // Push notification state
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const [notifSettings, setNotifSettings] = useState({
    checkInEnabled: true,   checkInTime: "08:00",
    workoutEnabled: true,   workoutTime: "07:00",
    recoveryEnabled: false, recoveryTime: "20:00",
    nutritionEnabled: false,nutritionTime: "12:00",
    weeklyEnabled: true,    weeklyDay: "1", // Monday
  });
  const [swRegistered, setSwRegistered] = useState(false);
  const [coaches, setCoaches] = useState([]);
  const [newCoach, setNewCoach] = useState({name:"",email:"",role:"Head Coach",sport:""});
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [reportSections, setReportSections] = useState({readiness:true,overtraining:true,wellness:true,weight:true,nutrition:true,performance:true,prs:true,injuries:true,notes:true});
  const [reportMessage, setReportMessage] = useState("");
  const [reportFrequency, setReportFrequency] = useState("manual");
  const [sentReports, setSentReports] = useState([]);
  // Supplement stack UI state (must be at component level — hooks can't live inside IIFEs)
  const [suppCategory, setSuppCategory] = useState("all");
  const [expandedSupp, setExpandedSupp] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [expandedHistory, setExpandedHistory] = useState(null);
  const [darkMode, setDarkMode] = useState(()=>localStorage.getItem('ea_theme')!=='light');
  const [showExLib, setShowExLib] = useState(false);
  const [exLibQuery, setExLibQuery] = useState("");
  const [exLibMuscle, setExLibMuscle] = useState("All");
  const [exLibCat, setExLibCat] = useState("All");
  const [exLibSelected, setExLibSelected] = useState(null);
  const [showPeriodization, setShowPeriodization] = useState(false);
  const [selectedPeriodWeek, setSelectedPeriodWeek] = useState(null);
  const [selectedPhase, setSelectedPhase] = useState(null); // filter week grid by phase // overview | checkin | body | nutrition | performance | photos
  // AI Coach state
  const [coachMessages, setCoachMessages] = useState([]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachReady, setCoachReady] = useState(false);
  const [mealSubs, setMealSubs] = useState({}); // {mealId_itemIdx: {name, cal, p, c, f, portion}}
  const [subEditing, setSubEditing] = useState(null); // "mealId_itemIdx"
  const [subForm, setSubForm] = useState({name:"", cal:"", p:"", c:"", f:"", portion:""});
  const [pNote, setPNote] = useState("");
  const [notes, setNotes] = useState([]);

  // ── AUTH LISTENER ────────────────────────────────────────────
  // ── SERVICE WORKER + NOTIFICATIONS ──────────────────────────
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        setSwRegistered(true);
        // Load saved notification settings
        const saved = localStorage.getItem('ea_notif_settings');
        if (saved) {
          try { setNotifSettings(JSON.parse(saved)); } catch(e) {}
        }
      }).catch(err => console.log('SW registration failed:', err));
    }
    if (typeof Notification !== 'undefined') {
      setNotifPermission(Notification.permission);
    }
  }, []);

  // Schedule a notification at a given time string "HH:MM" daily
  const scheduleDaily = (timeStr, title, body, tag) => {
    if (!swRegistered || notifPermission !== 'granted') return;
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const next = new Date();
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage({ type: 'SCHEDULE_NOTIFICATION', title, body, tag, delay });
    });
  };

  // Request permission and schedule all enabled notifications
  const requestAndScheduleNotifications = async () => {
    if (typeof Notification === 'undefined') {
      shout("Your browser doesn't support notifications","!"); return;
    }
    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
    if (permission !== 'granted') {
      shout("Notification permission denied","!"); return;
    }
    scheduleAllNotifications();
    shout("Notifications enabled — reminders scheduled","");
  };

  const scheduleAllNotifications = () => {
    const s = notifSettings;
    const name = profile.name ? profile.name.split(' ')[0] : 'Athlete';
    if (s.checkInEnabled)  scheduleDaily(s.checkInTime,  " Daily Check-In", `${name}, log your recovery, energy, and sleep to power your readiness score.`, "checkin");
    if (s.workoutEnabled)  scheduleDaily(s.workoutTime,  " Training Day",  `${name}, your ${sport.label} workout is scheduled. Ready to build?`, "workout");
    if (s.recoveryEnabled) scheduleDaily(s.recoveryTime, " Recovery Check", `${name}, how's your body feeling? Log any soreness or concerns.`, "recovery");
    if (s.nutritionEnabled)scheduleDaily(s.nutritionTime,"🥗 Nutrition Log",  `${name}, have you logged today's nutrition? Stay on track with your targets.`, "nutrition");
  };

  const saveNotifSettings = (updated) => {
    setNotifSettings(updated);
    localStorage.setItem('ea_notif_settings', JSON.stringify(updated));
  };

  const sendTestNotification = (title, body) => {
    if (notifPermission !== 'granted') { shout("Enable notifications first","!"); return; }
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, { body, icon: '/icon-192.svg', vibrate: [100,50,100] });
    });
  };

  // Rest timer tick
  useEffect(() => {
    if (!restTimer) return;
    const interval = setInterval(() => {
      setRestTick(t => t + 1);
      if (Date.now() >= restTimer.endTime) {
        setRestTimer(null);
        if (notifPermission === 'granted') {
          navigator.serviceWorker.ready.then(reg =>
            reg.showNotification("⏱ Rest Complete", { body: "Time for your next set!", icon: '/icon-192.svg', vibrate: [200, 100, 200] })
          );
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [restTimer, notifPermission]);

  useEffect(() => {
    // Restore session on load — go straight to dashboard if already logged in
    getSession().then(session => {
      if (session?.user) {
        setAuthUser(session.user);
        loadUserData(session.user.id);
        setScreen("dashboard");
      }
      setAuthLoading(false);
    });
    // Listen for auth changes (login/logout)
    const { data: { subscription: authSub } } = onAuthChange((session, event) => {
      if (event === 'SIGNED_OUT') {
        setAuthUser(null);
        setSubscription(null);
        setScreen("landing");
        setAuthLoading(false);
      } else if (session?.user) {
        setAuthUser(session.user);
        loadUserData(session.user.id);
        setScreen("dashboard");
        setAuthLoading(false);
      }
    });
    // Check for successful Stripe payment return
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      const planName = params.get('plan') || 'Elite';
      shout(`${planName} plan activated! Welcome to Elite.`, '◆');
      window.history.replaceState({}, '', window.location.pathname);
    }
    return () => authSub?.unsubscribe();
  }, []);

  // ── LOAD USER DATA FROM SUPABASE ─────────────────────────────
  const loadUserData = async (userId) => {
    setDbLoading(true);
    try {
      const [prof, journals, progNotes, sub, checkInsData, workoutData, weightData, nutritionData, benchmarkData] = await Promise.all([
        loadProfile(userId),
        loadJournalEntries(userId),
        loadProgressNotes(userId),
        loadSubscription(userId),
        loadCheckIns(userId).catch(()=>[]),
        loadWorkoutLogs(userId).catch(()=>[]),
        loadWeightLogs(userId).catch(()=>[]),
        loadNutritionLogs(userId).catch(()=>[]),
        loadBenchmarks(userId).catch(()=>[]),
      ]);
      if (prof) {
        setProfile(p => ({ ...p, ...prof }));
        if (prof.goal) setMealType(
          prof.goal === "Weight Gain" ? "Weight Gain" :
          prof.goal === "Weight Loss" ? "Weight Loss" : "Weight Maintenance"
        );
      }
      if (journals?.length) setJEntries(journals.map(j => ({ id: j.id, date: new Date(j.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), text: j.text, title: j.title })));
      if (progNotes?.length) setNotes(progNotes.map(n => ({ date: new Date(n.created_at).toLocaleDateString(), text: n.text })));
      if (sub) setSubscription(sub);
      if (checkInsData?.length) setCheckIns(checkInsData.map(c=>({date:c.date,recovery:c.recovery||7,energy:c.energy||7,sleep:parseFloat(c.sleep)||8,soreness:c.soreness||3,mood:c.mood||7,notes:c.notes||""})));
      if (workoutData?.length) setWkLog(workoutData.map(w=>({date:w.date,week:w.week,exercise:w.exercise,load:w.load,notes:w.notes,wkType:w.wk_type,wkFocus:w.wk_focus})));
      if (weightData?.length) setWeightLog(weightData.map(w=>({date:w.date,weight:parseFloat(w.weight),bodyFat:w.body_fat?parseFloat(w.body_fat):null})));
      if (nutritionData?.length) setNutritionLog(nutritionData.map(n=>({date:n.date,calories:n.calories,protein:n.protein,carbs:n.carbs,fat:n.fat,water:n.water})));
      if (benchmarkData?.length) setBenchmarks(benchmarkData.map(b=>({date:b.date,test:b.test,value:b.value,unit:b.unit,notes:b.notes})));
    } catch (err) {
      console.error('Failed to load user data:', err);
    } finally {
      setDbLoading(false);
    }
  };

  // ── AUTOSAVE PROFILE ─────────────────────────────────────────
  useEffect(() => {
    if (!authUser?.id || !profile.name) return;
    const timer = setTimeout(() => {
      saveProfile(authUser.id, {
        name: profile.name, weight: profile.weight, height: profile.height,
        age: profile.age, sport: profile.sport, position: profile.position, goal: profile.goal,
      }).catch(err => console.error('Profile save failed:', err));
    }, 1500);
    return () => clearTimeout(timer);
  }, [profile, authUser]);

  // ── AUTOSAVE — WORKOUT LOG (debounced 2s after each new entry) ──
  useEffect(() => {
    if (!authUser?.id || wkLog.length === 0) return;
    const timer = setTimeout(() => {
      const latest = wkLog.slice(-5); // only push most recent batch
      saveWorkoutLog(authUser.id, latest.map(e => ({
        ...e, wk_type: e.wkType||e.wk_type||'', wk_focus: e.wkFocus||e.wk_focus||''
      }))).catch(err => console.error('wkLog autosave:', err));
    }, 2000);
    return () => clearTimeout(timer);
  }, [wkLog.length, authUser]);

  // ── AUTOSAVE — WEIGHT LOG ─────────────────────────────────────
  useEffect(() => {
    if (!authUser?.id || weightLog.length === 0) return;
    const timer = setTimeout(() => {
      const latest = weightLog[weightLog.length - 1];
      if (latest) saveWeightEntry(authUser.id, latest).catch(err => console.error('weightLog autosave:', err));
    }, 1500);
    return () => clearTimeout(timer);
  }, [weightLog.length, authUser]);

  // ── AUTOSAVE — NUTRITION LOG ──────────────────────────────────
  useEffect(() => {
    if (!authUser?.id || nutritionLog.length === 0) return;
    const timer = setTimeout(() => {
      const latest = nutritionLog[nutritionLog.length - 1];
      if (latest) saveNutritionEntry(authUser.id, latest).catch(err => console.error('nutritionLog autosave:', err));
    }, 1500);
    return () => clearTimeout(timer);
  }, [nutritionLog.length, authUser]);

  // ── AUTOSAVE — JOURNAL (debounced 3s — heavier writes) ────────
  useEffect(() => {
    if (!authUser?.id || jEntries.length === 0) return;
    const timer = setTimeout(() => {
      const latest = jEntries[0];
      if (latest?.text) saveJournalEntry(authUser.id, { text: latest.text, title: latest.title||'' })
        .catch(err => console.error('journal autosave:', err));
    }, 3000);
    return () => clearTimeout(timer);
  }, [jEntries[0]?.text, authUser]);

  // ── AUTOSAVE — PROGRESS NOTES (debounced 2s) ─────────────────
  useEffect(() => {
    if (!authUser?.id || notes.length === 0) return;
    const timer = setTimeout(() => {
      const latest = notes[0];
      if (latest?.text) saveProgressNote(authUser.id, { text: latest.text })
        .catch(err => console.error('notes autosave:', err));
    }, 2000);
    return () => clearTimeout(timer);
  }, [notes[0]?.text, authUser]);

  const shout = (msg, icon="✦") => { setToast({msg,icon}); setTimeout(()=>setToast(null),3200); };
  // ── 4-TIER PERMISSION SYSTEM ─────────────────────────────────
  // Tiers: 'free' → 'athlete' → 'elite' → 'coach'
  const userTier = getUserTier(subscription);
  const canAccess = (requiredTier) => tierCanAccess(userTier, requiredTier);
  // Keep isPremium for existing email-to-coach gates (backwards compat)
  const isPremium = canAccess('elite');
  // Scroll to main content after any nav action
  // Apply dark/light theme to document root
  useEffect(()=>{
    const root = document.documentElement;
    if(darkMode){
      root.setAttribute('data-theme','dark');
      localStorage.setItem('ea_theme','dark');
    } else {
      root.setAttribute('data-theme','light');
      localStorage.setItem('ea_theme','light');
    }
  },[darkMode]);

  const goTo = (id) => {
    setDash(id);
    // Reset progress sub-tab when navigating away — prevents duplicate #progress-tab-content anchors
    if (id !== 'progress') setProgressTab('overview');
    // Scroll to just below the mod-grid tiles so module content is immediately visible.
    // The mod-grid sits after the 270px hero + 60px nav. We use the mod-grid element
    // itself so this works regardless of screen size or future layout changes.
    setTimeout(() => {
      const grid = document.querySelector('.mod-grid');
      if (grid) {
        const gridBottom = grid.getBoundingClientRect().bottom + window.scrollY;
        window.scrollTo({ top: gridBottom + 8, behavior: 'smooth' });
      }
    }, 50);
  };

  // ── PDF DOWNLOAD HANDLERS ────────────────────────────────────
  const handleDownloadMealPlan = () => {
    try {
      downloadMealPlanPDF({ athleteName: profile.name, sport: profile.sport, position: profile.position, mealType, mealFreq, meals, totalCals, totalP, totalC, totalF });
      shout("Meal plan PDF downloaded", "📄");
    } catch(e) { shout("PDF download failed", "!"); }
  };
  const handleDownloadWorkout = () => {
    try {
      downloadWorkoutPDF({
        athleteName: profile.name,
        sport: profile.sport,
        position: profile.position,
        wkType, wkFocus,
        exercises: workout,
        weekNum: wkWeek,
        progressLog: wkLog.filter(l => l.wkType === wkType && l.wkFocus === wkFocus).slice(-8),
      });
      shout("Workout PDF downloaded", "📄");
    } catch(e) { shout("PDF failed: " + e.message, "!"); console.error(e); }
  };
  const handleDownloadInjury = () => {
    try {
      // Build phases from INJURY_PROTOCOLS for each selected injury
      const allPhases = [];
      const disclaimer = {
        label:"⚕ Medical Disclaimer",
        duration:"Important",
        items:[
          "These protocols are for informational purposes only.",
          "Consult a licensed physician or certified physical therapist before beginning rehabilitation.",
          "Individual injuries vary — your healthcare provider should supervise your recovery.",
          "Seek emergency care if you experience severe symptoms.",
        ]
      };
      allPhases.push(disclaimer);

      selInj.forEach(injuryName => {
        const proto = INJURY_PROTOCOLS[injuryName];
        if (proto) {
          // Header phase with meta info
          allPhases.push({
            label: `${injuryName} — ${proto.fullName}`,
            duration: proto.severity,
            items: [
              `Surgery: ${proto.surgeryRequired}`,
              ...(proto.positionNotes?.[profile.position] ? [`${profile.position} Note: ${proto.positionNotes[profile.position]}`] : []),
            ]
          });
          // All rehab phases
          proto.phases.forEach(ph => {
            allPhases.push({ label: ph.ph, duration: ph.d, items: ph.items });
          });
          // Nutrition phases
          if (proto.nutrition) {
            allPhases.push({ label: `${injuryName} — Acute Phase Nutrition`, duration: "Acute", items: proto.nutrition.acute });
            allPhases.push({ label: `${injuryName} — Recovery Phase Nutrition`, duration: "Recovery", items: proto.nutrition.recovery });
          }
        } else {
          // Fallback generic protocol
          allPhases.push({label:`${injuryName} — Phase 1 — Acute`,duration:"Days 1–7",items:["RICE Protocol","Anti-inflammatory nutrition","Gentle ROM exercises","Pain management","Sleep optimization 9–10hrs"]});
          allPhases.push({label:`${injuryName} — Phase 2 — Sub-Acute`,duration:"Weeks 2–4",items:["Progressive range of motion","Isometric strengthening","Proprioception training","Aquatic therapy","Collagen protocol"]});
          allPhases.push({label:`${injuryName} — Phase 3 — Return to Play`,duration:"Weeks 5–8",items:["Sport-specific movement","Progressive loading","Neuromuscular re-education","Full clearance protocol"]});
        }
      });

      if (allPhases.length <= 1) {
        shout("Select at least one injury first", "!"); return;
      }

      downloadRecoveryPDF({
        athleteName: profile.name,
        sport: profile.sport,
        injury: selInj.join(", ") || "General Recovery",
        phases: allPhases,
        profile,
      });
      shout("Recovery protocol downloaded", "📄");
    } catch(e) { shout("PDF download failed: " + e.message, "!"); console.error(e); }
  };

  // ── AI COACH ─────────────────────────────────────────────────
  // Builds a rich system prompt from all athlete data
  const buildAthleteContext = () => {
    const lastCI = checkIns.length > 0 ? [...checkIns].sort((a,b)=>new Date(b.date)-new Date(a.date))[0] : null;
    const last7CI = checkIns.slice(-7);
    const avgRecovery = last7CI.length > 0 ? (last7CI.reduce((s,c)=>s+c.recovery,0)/last7CI.length).toFixed(1) : null;
    const avgSleep = last7CI.length > 0 ? (last7CI.reduce((s,c)=>s+(parseFloat(c.sleep)||0),0)/last7CI.length).toFixed(1) : null;
    const avgEnergy = last7CI.length > 0 ? (last7CI.reduce((s,c)=>s+c.energy,0)/last7CI.length).toFixed(1) : null;
    const recentLoads = wkLog.slice(-10);
    const sessionDays = [...new Set(recentLoads.map(l=>l.date))];
    const recentNutrition = nutritionLog.slice(-7);
    const avgCals = recentNutrition.length > 0 ? Math.round(recentNutrition.reduce((s,n)=>s+(parseFloat(n.calories)||0),0)/recentNutrition.length) : null;
    const lastWeight = weightLog.length > 0 ? weightLog[weightLog.length-1] : null;
    const prs = Object.entries(recentLoads.reduce((acc,l)=>{
      const num=parseFloat(l.load);
      if(num&&(!acc[l.exercise]||num>acc[l.exercise]))acc[l.exercise]=num;
      return acc;
    },{})).slice(0,5).map(([ex,load])=>`${ex}: ${load}lbs`).join(", ");
    const sp = SPORT_NUTRITION_PROFILES[profile.sport];
    const proteinTarget = Math.round((parseFloat(profile.weight)||185) * (sp?.positions?.[profile.position]?.proteinGperLb ?? sp?.base?.proteinGperLb ?? 0.85));

    return `You are an elite personal athletic coach and sports scientist for an elite athlete. You have complete access to their training data. Respond conversationally but with the precision of a world-class coach. Be direct, specific, and action-oriented. Never be generic. Always reference their actual data.

ATHLETE PROFILE:
- Name: ${profile.name || "Athlete"}
- Sport: ${sport.label} | Position: ${profile.position || "General"}
- Weight: ${profile.weight ? profile.weight + " lbs" : "Not logged"} | Height: ${profile.height ? Math.floor(profile.height/12) + "'" + (profile.height%12) + '"' : "Not logged"} | Age: ${profile.age || "Not logged"}
- Primary Goal: ${mealType} | Training Program: ${wkType}
- Training Week: Week ${wkWeek}

NUTRITION TARGETS:
- Daily Calorie Target: ${totalCals.toLocaleString()} kcal (TDEE-based, position-adjusted)
- Protein Target: ${proteinTarget}g/day (${sp?.base?.proteinGperLb || 0.85}g per lb for ${sport.label})
- Meal Plan: ${mealType} | ${mealFreq} meals/day
${avgCals ? `- Avg Actual Intake (last 7 days): ${avgCals.toLocaleString()} kcal (${avgCals > totalCals ? "+" : ""}${(avgCals - totalCals).toLocaleString()} vs target)` : "- Nutrition log: No entries yet"}

WELLNESS DATA (LAST 7 DAYS):
${lastCI ? `- Most Recent Check-In (${lastCI.date}): Recovery ${lastCI.recovery}/10 | Energy ${lastCI.energy}/10 | Sleep ${lastCI.sleep}hrs | Soreness ${lastCI.soreness}/10 | Mood ${lastCI.mood}/10
${lastCI.notes ? "  Notes: " + lastCI.notes : ""}` : "- No check-ins logged yet"}
${avgRecovery ? `- 7-Day Averages: Recovery ${avgRecovery}/10 | Sleep ${avgSleep}hrs | Energy ${avgEnergy}/10` : ""}

TRAINING LOAD:
- Sessions Logged: ${wkLog.length} total
- Recent Training Days: ${sessionDays.length > 0 ? sessionDays.slice(-5).join(", ") : "None logged"}
- Recent Session Volume: ${recentLoads.length} exercise entries in last 10 logs
${prs ? `- Recent Loads: ${prs}` : "- No loads logged yet"}

BODY COMPOSITION:
${lastWeight ? `- Last Logged Weight: ${lastWeight.weight} lbs (${lastWeight.date})${lastWeight.bodyFat ? " | Body Fat: " + lastWeight.bodyFat + "%" : ""}` : "- Weight not logged"}
${weightLog.length > 1 ? `- Weight Change: ${(weightLog[weightLog.length-1].weight - weightLog[0].weight > 0 ? "+" : "") + (weightLog[weightLog.length-1].weight - weightLog[0].weight).toFixed(1)} lbs since first entry` : ""}

PERFORMANCE BENCHMARKS:
${benchmarks.length > 0 ? benchmarks.slice(-5).map(b=>`- ${b.test}: ${b.value} ${b.unit} (${b.date})`).join("\n") : "- No performance tests logged yet"}

INJURY STATUS:
${selInj && selInj.length > 0 ? `- Active/Recent Injuries: ${selInj.join(", ")}` : "- No injuries logged"}

POSITION-SPECIFIC NOTES:
${sp?.positions?.[profile.position]?.note || sp?.base?.recoveryFocus || "General athletic development"}

COACHING GUIDELINES:
- Give SPECIFIC recommendations based on their actual data above
- Reference their real numbers (e.g., "your 7.2/10 recovery score means...")
- Identify patterns (e.g., sleep below 7hrs correlates with lower energy scores)
- Provide today-specific advice (training intensity, nutrition, recovery)
- Flag overtraining risk if sleep avg < 7hrs, soreness > 7/10, or 5+ consecutive training days
- Be warm but direct — like a coach who genuinely cares AND knows their stuff
- Keep responses concise but complete — no bullet point walls, use flowing coaching language
- When suggesting workouts, be specific about exercises from their program
- If data is missing, tell them what to log and why it matters`;
  };

  const triggerCoachGreeting = async () => {
    if (coachMessages.length > 0) return;
    setCoachLoading(true);
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 35000);
    try {
      const context = buildAthleteContext();
      const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
      const res = await fetch("/.netlify/functions/coach", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          system: context,
          messages: [{role:"user", content:`Today is ${today}. Give me my personalized coaching brief for today — what should I focus on, what does my data tell you, and what's your single most important recommendation right now?`}]
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errData = await res.json().catch(()=>({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = data.content?.[0]?.text || "I'm ready to coach you. What would you like to work on today?";
      setCoachMessages([{role:"assistant", content:reply, ts:new Date()}]);
      setCoachReady(true);
    } catch(e) {
      clearTimeout(timeoutId);
      console.error("Coach greeting error:", e.message);
      setCoachMessages([{role:"assistant", content:`Welcome, ${profile.name||"Athlete"}. I'm your Elite AI Coach, ready to give you personalized guidance based on your training data. Ask me anything — today's training, recovery, nutrition, or performance.`, ts:new Date()}]);
      setCoachReady(true);
    }
    setCoachLoading(false);
  };

  const sendCoachMessage = async () => {
    if (!coachInput.trim() || coachLoading) return;
    const userMsg = {role:"user", content:coachInput.trim(), ts:new Date()};
    const newMessages = [...coachMessages, userMsg];
    setCoachMessages(newMessages);
    setCoachInput("");
    setCoachLoading(true);
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 35000);
    try {
      const context = buildAthleteContext();
      // Only send role+content, filter any empty content
      const apiMessages = newMessages
        .map(m=>({role:m.role, content:typeof m.content==='string'?m.content.trim():''}))
        .filter(m=>m.content.length>0);
      const res = await fetch("/.netlify/functions/coach", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ system: context, messages: apiMessages }),
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errData = await res.json().catch(()=>({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = data.content?.[0]?.text || "I didn't quite catch that — could you rephrase?";
      setCoachMessages(prev=>[...prev, {role:"assistant", content:reply, ts:new Date()}]);
    } catch(e) {
      clearTimeout(timeoutId);
      console.error("Coach send error:", e.message);
      const isTimeout = e.name === 'AbortError';
      const isKeyError = e.message?.includes("401") || e.message?.includes("API key");
      setCoachMessages(prev=>[...prev, {role:"assistant",
        content: isTimeout
          ? "Response timed out — the AI Coach is busy. Please try again."
          : isKeyError
            ? "API key issue — check that ANTHROPIC_API_KEY is set in Netlify."
            : `Connection issue (${e.message}) — please try again.`,
        ts:new Date()}]);
    }
    setCoachLoading(false);
  };

  // Auto-scroll coach chat to bottom when messages change
  useEffect(()=>{
    const el = document.getElementById("coach-msgs");
    if(el) el.scrollTop = el.scrollHeight;
  }, [coachMessages, coachLoading]);

  const handleDownloadProgress = () => {
    try {
      const lastCI = checkIns[0];
      const latestWt = weightLog.length > 0 ? weightLog[weightLog.length-1] : null;
      const avgCals7 = nutritionLog.length > 0
        ? Math.round(nutritionLog.slice(-7).reduce((s,n)=>s+(parseFloat(n.calories)||0),0) / Math.min(nutritionLog.slice(-7).length,7))
        : null;
      const avgProt7 = nutritionLog.length > 0 && nutritionLog.some(n=>n.protein)
        ? Math.round(nutritionLog.slice(-7).filter(n=>n.protein).reduce((s,n)=>s+(parseFloat(n.protein)||0),0) / Math.max(nutritionLog.slice(-7).filter(n=>n.protein).length,1))
        : null;
      const prs = Object.entries(wkLog.reduce((acc,l)=>{
        const num=parseFloat(l.load);
        if(num&&(!acc[l.exercise]||num>acc[l.exercise].num)) acc[l.exercise]={num,load:l.load,date:l.date};
        return acc;
      },{}));
      const acwrVal = (()=>{
        const l7=checkIns.slice(0,7); const l14=checkIns.slice(0,14);
        const a=l7.length>0?l7.reduce((s,c)=>s+(c.recovery||0),0)/l7.length:0;
        const ch=l14.length>0?l14.reduce((s,c)=>s+(c.recovery||0),0)/l14.length:0;
        return ch>0?(a/ch).toFixed(2):"1.00";
      })();
      const suppStack = getSupplementStack(profile.sport||"football", profile.position||"");
      downloadProgressReportPDF({
        profile: {
          name: profile.name||"—", sport: profile.sport||"—", position: profile.position||"—",
          goal: profile.goal||"Weight Maintenance", weight: profile.weight||"—",
          height: profile.height||"—", age: profile.age||"—",
        },
        notes, totalCals, mealType, mealFreq,
        checkIns: checkIns.slice(0,14),
        latestWeight: latestWt,
        weightLog: weightLog.slice(-10),
        avgCals7, avgProt7,
        prs: prs.slice(0,8),
        acwr: acwrVal,
        benchmarks: benchmarks.slice(0,8),
        suppStack: suppStack.slice(0,8),
        selInj,
      });
      shout("Progress report downloaded","📄");
    } catch(e) { console.error(e); shout("PDF download failed — "+e.message,"!"); }
  };
  const handleDownloadJournal = () => {
    try {
      downloadJournalPDF({ athleteName: profile.name, entries: jEntries });
      shout("Journal PDF downloaded", "📄");
    } catch(e) { shout("PDF download failed", "!"); }
  };

  // ── EMAIL HANDLERS ───────────────────────────────────────────
  const handleEmailMealPlan = (toCoach=false) => {
    if (!authUser?.email) { shout("Sign in to email reports", "!"); return; }
    if (toCoach && !isPremium) { setPayModal({tierKey:"elite",billing:"annual"}); shout("Upgrade to Elite to send to coach","⭐"); return; }
    setEmailModal({ type:"meal", label:"Meal Plan", data:{ meals, totalCals, mealType, mealFreq } });
  };
  const _sendEmailMealPlan = async (toEmail) => {
    try {
      await emailMealPlan({ toEmail, athleteName: profile.name, meals, totalCals, mealType, mealFreq });
      shout("Meal plan emailed to " + toEmail, "✉");
    } catch(e) { shout("Email failed — check EmailJS config", "!"); }
  };
  const handleEmailInjury = () => {
    setEmailModal({ type:"injury", label:"Recovery Protocol", data:{ injuries: selInj, sport: profile.sport, position: profile.position, injuryProtocols: INJURY_PROTOCOLS } });
  };

  const handleEmailProgress = (toCoach=false) => {
    if (!authUser?.email) { shout("Sign in to email reports", "!"); return; }
    if (toCoach && !isPremium) { setPayModal({tierKey:"elite",billing:"annual"}); shout("Upgrade to Elite to send to coach","⭐"); return; }
    setEmailModal({ type:"progress", label:"Progress Report", data:{ ...profile, totalCals, mealType, mealFreq } });
  };
  const _sendEmailProgress = async (toEmail) => {
    try {
      await emailProgressReport({ toEmail, athleteName: profile.name, reportData: { ...profile, totalCals, mealType, mealFreq } });
      shout("Progress report emailed to " + toEmail, "✉");
    } catch(e) { shout("Email failed — check EmailJS config", "!"); }
  };

  // ── SAVE JOURNAL ENTRY ───────────────────────────────────────
  const saveJournalToDb = async (entry) => {
    if (!authUser?.id) return;
    try {
      await saveJournalEntry(authUser.id, { text: entry.text, title: entry.title || '' });
    } catch(e) { console.error('Journal save error:', e); }
  };

  // ── SAVE PROGRESS NOTE ───────────────────────────────────────
  const saveNoteToDb = async (note) => {
    if (!authUser?.id) return;
    try {
      await saveProgressNote(authUser.id, { text: note });
    } catch(e) { console.error('Note save error:', e); }
  };
  const sport = SPORTS[profile.sport] || SPORTS.football;
  // Pull today's meals from WEEKLY_VARIETY using current day of week (0=Sun … 6=Sat)
  const _today = new Date();
  const todayDow = _today.getDay();
  const todayMonth = _today.getMonth();
  const _variety = WEEKLY_VARIETY[mealType]?.[mealFreq];
  const meals = (_variety ? _variety[getMonthVariedIndex(todayDow, todayMonth)] : null)
    || MEAL_PLANS[mealType]?.[mealFreq]
    || MEAL_PLANS["Weight Maintenance"][5];
  const baseTotalCals = meals.reduce((sum,meal)=>sum+meal.items.reduce((s,it)=>s+it.cal,0),0);
  const totalCals = getSportCalorieTarget(baseTotalCals, profile.sport, profile.position, profile.weight, profile.height, profile.age, mealType) || baseTotalCals;
  const totalP    = meals.reduce((sum,meal)=>sum+meal.items.reduce((s,it)=>s+it.p,0),0);
  const totalC    = meals.reduce((sum,meal)=>sum+meal.items.reduce((s,it)=>s+it.c,0),0);
  const totalF    = meals.reduce((sum,meal)=>sum+meal.items.reduce((s,it)=>s+it.f,0),0);
  const sportNutrition = getSportNutritionNote(profile.sport, profile.position);
  // Sport/position-aware workout — falls back to generic WORKOUTS if no specific program
  const sportWorkout = getSportWorkout(profile.sport, profile.position, wkType, wkFocus);

  // Resolve specific loads based on athlete's bodyweight
  const bw = parseFloat(profile.weight) || 185;
  function resolveLoad(load, exerciseName) {
    if (!load) return "—";
    // Already has specific numbers — return as-is
    if (/\d+(lbs?|kg|%)/.test(load)) return load;
    const name = (exerciseName || "").toLowerCase();
    // Map generic labels to bodyweight-based specifics
    const isUpper = /bench|press|row|curl|dip|pull|push|fly|tricep|shoulder/i.test(name);
    const isLower = /squat|deadlift|lunge|leg|hip|calf|clean|thrust/i.test(name);
    const isCore = /plank|core|rotation|carry|farmer/i.test(name);
    if (load === "Light" || load === "light") return isUpper ? `${Math.round(bw*0.15)}–${Math.round(bw*0.2)}lbs` : isLower ? `${Math.round(bw*0.25)}–${Math.round(bw*0.35)}lbs` : `${Math.round(bw*0.1)}–${Math.round(bw*0.15)}lbs`;
    if (load === "Moderate" || load === "moderate") return isUpper ? `${Math.round(bw*0.3)}–${Math.round(bw*0.4)}lbs` : isLower ? `${Math.round(bw*0.5)}–${Math.round(bw*0.65)}lbs` : `${Math.round(bw*0.2)}–${Math.round(bw*0.3)}lbs`;
    if (load === "Heavy" || load === "heavy") return isUpper ? `${Math.round(bw*0.5)}–${Math.round(bw*0.65)}lbs` : isLower ? `${Math.round(bw*0.9)}–${Math.round(bw*1.1)}lbs` : `${Math.round(bw*0.4)}–${Math.round(bw*0.5)}lbs`;
    if (/light-moderate|light to moderate/i.test(load)) return isUpper ? `${Math.round(bw*0.2)}–${Math.round(bw*0.3)}lbs` : `${Math.round(bw*0.35)}–${Math.round(bw*0.5)}lbs`;
    if (/moderate-heavy|moderate to heavy/i.test(load)) return isUpper ? `${Math.round(bw*0.4)}–${Math.round(bw*0.55)}lbs` : `${Math.round(bw*0.7)}–${Math.round(bw*0.9)}lbs`;
    return load; // return unchanged if pattern not matched
  }

  const workout = (sportWorkout ? sportWorkout.map(ex => ({...ex, load: resolveLoad(ex.load, ex.name)})) : null) || WORKOUTS[wkType]?.[wkFocus]?.map(ex => {
    const sets = ex.match(/[\d]+×[\d]+/)?.[0] || "";
    const name = sets ? ex.replace(sets,"").trim() : ex;
    const [s,r] = sets.split("×");
    return {name, sets:parseInt(s)||3, reps:r||"8", rest:"2min", muscles:"", cues:"", load:""};
  }) || [];

  // ── LOADING (wait for session check) ────────────────────────
  if (authLoading) return <div style={{background:"#0a0908",width:"100vw",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:"#D4AF37",fontFamily:"'DM Sans', sans-serif",fontSize:"1rem",letterSpacing:"8px",fontWeight:700}}>ELITE ATHLETE</div></div>;

  // ── LANDING ─────────────────────────────────────────────────
  if (screen === "landing") return (
    <>
      <style>{CSS}</style>
      <div className="noise"/>
      <nav className="nav">
        <div className="nav-wm">
          <span className="nav-wm-top">The Premier Athletic Platform</span>
          <span className="nav-wm-main">Elite Athlete</span>
        </div>
        <div className="nav-pills">
          {[["Features","features"],["Sports","sports"],["Pricing","pricing"],["About","about"]].map(([label,id])=>(
            <button key={id} className="npill" onClick={()=>{
              const el = document.getElementById(`landing-${id}`);
              if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
            }}>{label}</button>
          ))}
        </div>
        <div className="nav-r">
          <button className="bgh" onClick={()=>setAuthModal(true)}>Sign In</button>
          <button className="bg" onClick={()=>setScreen("setup")}>Begin Journey</button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-bg" style={{backgroundImage:"url(https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1800&q=80)"}}/>
        <div className="hero-vig"/>
        <div className="hero-grain"/>
        <div className="hero-c">
          <div className="hero-kick">
            <span className="hero-kick-line"/>
            <span className="hero-kick-txt">Engineered for Champions</span>
          </div>
          <h1 className="hero-h1">Unlock Your<br/><em>True Potential</em></h1>
          <p className="hero-sub">Precision nutrition, elite training protocols, and accelerated recovery — curated for the athlete who accepts nothing less than extraordinary.</p>
          <div className="hero-ctas">
            <button className="bg" style={{padding:"0.85rem 2.5rem",fontSize:"0.9rem",letterSpacing:"3px"}} onClick={()=>setScreen("setup")}>Start Free Trial</button>
            <button className="bgh" style={{padding:"0.85rem 2rem"}} onClick={()=>{
              // Open a YouTube embed modal with an elite athlete promo film
              const modal = document.createElement('div');
              modal.id = 'film-modal';
              modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.96);display:flex;flex-direction:column;align-items:center;justify-content:center;';
              modal.innerHTML = `
                <div style="position:relative;width:min(90vw,900px);aspect-ratio:16/9;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
                  <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&controls=1&rel=0&modestbranding=1" style="width:100%;height:100%;border:none;" allow="autoplay; fullscreen" allowfullscreen></iframe>
                </div>
                <div style="margin-top:1.5rem;display:flex;flex-direction:column;align-items:center;gap:0.5rem;">
                  <div style="font-family:'Inter',sans-serif;font-size:0.58rem;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:rgba(168,130,42,0.7);">The Premier Athletic Platform</div>
                  <button onclick="document.getElementById('film-modal').remove()" style="font-family:'Inter',sans-serif;font-size:0.6rem;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.45);padding:0.5rem 1.5rem;border-radius:3px;cursor:pointer;margin-top:0.5rem;">Close</button>
                </div>`;
              modal.addEventListener('click', e => { if(e.target === modal) modal.remove(); });
              document.body.appendChild(modal);
            }}>Watch the Film</button>
          </div>
        </div>
        <div className="hero-scroll"><span>Scroll</span><span style={{fontSize:"1rem"}}>↓</span></div>
        <div className="sbar">
          {[["50K+","Elite Athletes"],["5","Sports Covered"],["99%","Retention Rate"],["24/7","AI Coaching"],["3M+","Meals Planned"]].map(([n,l])=>(
            <div key={l} className="scell"><div className="sn">{n}</div><div className="sl">{l}</div></div>
          ))}
        </div>
      </section>

      {/* SPORT TILES */}
      <section id="landing-sports" style={{padding:"7rem 0",background:"var(--ink)"}}>
        <div className="wrap">
          <div style={{marginBottom:"3.5rem"}}>
            <div className="eyebrow">Supported Sports</div>
            <h2 className="sh2">Tailored for <em>Every Champion</em></h2>
          </div>
          <div className="sport-grid">
            {Object.entries(SPORTS).map(([key,s])=>(
              <div key={key} className={`stile${profile.sport===key?" sel":""}`}
                onClick={()=>{setProfile(p=>({...p,sport:key,position:""}));setScreen("setup");}}>
                <div className="stile-img" style={{backgroundImage:`url(${s.img})`}}/>
                <div className="stile-ov"/>
                <div className="stile-ck">{profile.sport===key?"✓":""}</div>
                <div className="stile-body">
                  <div className="stile-icon"></div>
                  <div className="stile-name">{s.label}</div>
                  <div className="stile-bar"/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURE BENTO */}
      <section id="landing-features" style={{padding:"7rem 0"}}>
        <div className="wrap">
          <div style={{marginBottom:"3.5rem"}}>
            <div className="eyebrow">Platform Features</div>
            <h2 className="sh2">Everything You <em>Need to Win</em></h2>
          </div>
          <div className="bento">
            {[
              {cls:"bt-a",img:"https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=900&q=80",num:"01",title:"Precision Nutrition",desc:"Custom meal plans engineered for your sport, position, and performance goals. Macro-optimized menus with elite grocery curation and daily tracking."},
              {cls:"bt-b",img:"https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=600&q=80",num:"02",title:"Elite Workout Plans",desc:"Position-specific strength and conditioning protocols."},
              {cls:"bt-c",img:"https://images.unsplash.com/photo-1552072092-7f9b8d63efcb?w=600&q=80",num:"03",title:"Injury Recovery",desc:"Sport-specific rehabilitation protocols and recovery nutrition."},
              {cls:"bt-d",img:"https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600&q=80",num:"04",title:"Progress Tracking",desc:"3-month analytics and exportable reports."},
              {cls:"bt-e",img:"https://images.unsplash.com/photo-1486218119243-13301543a1b4?w=600&q=80",num:"05",title:"Training Calendar",desc:"Intelligent scheduling for all facets of your program."},
              {cls:"bt-f",img:"https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&q=80",num:"06",title:"Athlete Journal",desc:"Private journal — shareable and exportable."},
            ].map(f=>(
              <div key={f.num} className={`bt ${f.cls}`} onClick={()=>setScreen("setup")}>
                <div className="bt-img" style={{backgroundImage:`url(${f.img})`}}/>
                <div className="bt-ov"/>
                <div className="bt-arr">→</div>
                <div className="bt-body">
                  <div className="bt-num">{f.num}</div>
                  <div className="bt-title">{f.title}</div>
                  <div className="bt-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING — 4-Tier: Free · Athlete · Elite · Coach Pro */}
      <section id="landing-pricing" style={{padding:"7rem 0",background:"var(--ink)"}}>
        <div className="wrap">
          <div style={{textAlign:"center",marginBottom:"1.5rem"}}>
            <div className="eyebrow" style={{justifyContent:"center"}}>Membership</div>
            <h2 className="sh2" style={{textAlign:"center"}}>Invest in <em>Excellence</em></h2>
            <p style={{textAlign:"center",color:"var(--muted)",fontSize:"0.88rem",marginTop:"0.75rem",fontWeight:300}}>
              Annual plans save up to 43% · Cancel anytime
            </p>
          </div>

          <PricingSection setPayModal={setPayModal} />

          {/* LANDING FOOTER */}
          <div id="landing-about" style={{borderTop:"1px solid rgba(191,161,106,0.1)",marginTop:"4rem",paddingTop:"2rem",paddingBottom:"3rem",textAlign:"center"}}>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.9rem",fontWeight:700,letterSpacing:"6px",color:"var(--ivory)",marginBottom:"0.75rem"}}>ELITE ATHLETE</div>
            <div style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px",marginBottom:"1rem"}}>The Premier Athletic Platform</div>
            <div style={{display:"flex",justifyContent:"center",gap:"2rem",flexWrap:"wrap"}}>
              <a href="/privacy-policy.html" style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px",textDecoration:"none"}} onMouseOver={e=>e.target.style.color="var(--gold)"} onMouseOut={e=>e.target.style.color="var(--muted)"}>Privacy Policy</a>
              <a href="/report-bug.html" style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px",textDecoration:"none"}} onMouseOver={e=>e.target.style.color="var(--gold)"} onMouseOut={e=>e.target.style.color="var(--muted)"}>Report a Bug</a>
              <span style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px"}}>© {new Date().getFullYear()} Elite Athlete</span>
            </div>
          </div>
        </div>
      </section>

      {payModal && <PayModal plan={payModal} tab={payTab} setTab={setPayTab} userEmail={authUser?.email} onClose={()=>setPayModal(null)}
        onSuccess={()=>{setPayModal(null);setSuccess(true);setTimeout(()=>{setSuccess(false);setScreen("dashboard");},2500);}}/>}
      {authModal && <AuthModal onClose={()=>setAuthModal(false)} onAuth={(user)=>{setAuthUser(user);setScreen("dashboard");shout(`Welcome back, ${user.email?.split('@')[0]}!`,"◆");}}/>}
      {success && <SuccessScreen/>}

      {/* ── IN-APP CAMERA MODAL ─────────────────────────────────────── */}
      {cameraModal && (
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.97)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          {/* Header */}
          <div style={{position:"absolute",top:0,left:0,right:0,padding:"1rem 1.5rem",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.7rem",fontWeight:700,letterSpacing:"3px",textTransform:"uppercase",color:"var(--ivory2)"}}>
              {cameraModal==='progress' ? 'Progress Photo' : cameraModal==='profile-before' ? 'Before Photo' : 'Current Photo'}
            </div>
            <div style={{display:"flex",gap:"0.75rem",alignItems:"center"}}>
              <button onClick={flipCamera} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"50%",width:"40px",height:"40px",cursor:"pointer",color:"var(--ivory2)",fontSize:"1.1rem",display:"flex",alignItems:"center",justifyContent:"center"}} title="Flip camera">↺</button>
              <button onClick={closeCamera} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"50%",width:"40px",height:"40px",cursor:"pointer",color:"var(--ivory2)",fontSize:"1.2rem",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
          </div>
          {/* Viewfinder */}
          <div style={{position:"relative",width:"min(90vw,640px)",aspectRatio:"4/3",borderRadius:"12px",overflow:"hidden",border:"1px solid rgba(255,255,255,0.1)"}}>
            <video ref={cameraVideoRef} autoPlay playsInline muted style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
            {/* Corner guides */}
            {[['0%','0%','borderTop','borderLeft'],['0%','auto','borderTop','borderRight'],['auto','0%','borderBottom','borderLeft'],['auto','auto','borderBottom','borderRight']].map(([t,r,bt,bl],i)=>(
              <div key={i} style={{position:"absolute",top:t==='auto'?undefined:'12px',bottom:t==='auto'?'12px':undefined,left:r==='auto'?undefined:'12px',right:r==='auto'?'12px':undefined,width:"22px",height:"22px",[bt]:"2px solid rgba(168,130,42,0.8)",[bl]:"2px solid rgba(168,130,42,0.8)"}}/>
            ))}
          </div>
          {/* Capture button */}
          <div style={{marginTop:"2rem",display:"flex",gap:"1.5rem",alignItems:"center"}}>
            <button onClick={closeCamera} style={{fontFamily:"'Inter',sans-serif",fontSize:"0.6rem",fontWeight:600,letterSpacing:"2.5px",textTransform:"uppercase",background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"var(--muted)",padding:"0.6rem 1.4rem",borderRadius:"4px",cursor:"pointer"}}>Cancel</button>
            <button onClick={()=>{
              const dataUrl = capturePhoto();
              if (!dataUrl) { shout("Capture failed — try again","!"); return; }
              if (cameraModal === 'progress') {
                const id = Date.now().toString();
                const date = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
                setProgressPhotos(prev=>[{id,date,dataUrl,label:"Progress",weight:"",note:""},...prev]);
                shout("Progress photo captured","◆");
              } else if (cameraModal === 'profile-before') {
                setProfilePhotoBefore(dataUrl);
                shout("Before photo captured","◆");
              } else if (cameraModal === 'profile-after') {
                setProfilePhotoAfter(dataUrl);
                shout("Photo captured","◆");
              }
              closeCamera();
            }} style={{
              width:"72px",height:"72px",borderRadius:"50%",
              background:"#fff",border:"4px solid rgba(255,255,255,0.3)",
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
              boxShadow:"0 0 0 2px rgba(255,255,255,0.15)",
              transition:"transform 0.1s",
            }} onMouseDown={e=>e.currentTarget.style.transform="scale(0.94)"} onMouseUp={e=>e.currentTarget.style.transform="scale(1)"}>
              <div style={{width:"52px",height:"52px",borderRadius:"50%",background:"#fff",border:"2px solid rgba(0,0,0,0.15)"}}/>
            </button>
            <div style={{width:"86px"}}/>
          </div>
          <div style={{marginTop:"0.75rem",fontSize:"0.58rem",letterSpacing:"2px",color:"rgba(255,255,255,0.25)",textTransform:"uppercase"}}>Tap to capture</div>
        </div>
      )}

      {toast && <Toast t={toast}/>}

    </>
  );

  // ── SETUP ────────────────────────────────────────────────────
  if (screen === "setup") return (
    <>
      <style>{CSS}</style>
      <div className="noise"/>
      <nav className="nav">
        <div className="nav-wm">
          <span className="nav-wm-top">The Premier Athletic Platform</span>
          <span className="nav-wm-main">Elite Athlete</span>
        </div>
        <div className="nav-r">
          <button className="bgh" onClick={()=>setScreen("landing")}>Back</button>
        </div>
      </nav>
      <div style={{paddingTop:"68px",minHeight:"100vh"}}>
        <div style={{height:"280px",position:"relative",backgroundImage:`url(${sport.img})`,backgroundSize:"cover",backgroundPosition:"center 22%"}}>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,rgba(8,8,7,0.35)0%,rgba(8,8,7,0.97)100%)"}}/>
          <div className="wrap" style={{position:"relative",zIndex:1,paddingTop:"4rem"}}>
            <div className="eyebrow">Getting Started</div>
            <h1 className="sh2">Build Your <em>Profile</em></h1>
          </div>
        </div>
        <div className="wrap" style={{paddingTop:"3rem",paddingBottom:"5rem"}}>
          <div className="two" style={{marginBottom:"1.5rem"}}>
            {/* Before Photo */}
            {[
              {label:"Before Photo", icon:"", state:profilePhotoBefore, setter:setProfilePhotoBefore, camTarget:"profile-before"},
              {label:"Current / After Photo", icon:"", state:profilePhotoAfter, setter:setProfilePhotoAfter, camTarget:"profile-after"},
            ].map(({label,icon,state,setter,camTarget})=>(
              <div key={label} style={{position:"relative"}}>
                <input type="file" accept="image/*" id={`inp-${label}`}
                  style={{display:"none"}}
                  onChange={e=>{
                    const file=e.target.files?.[0];
                    if(!file) return;
                    const reader=new FileReader();
                    reader.onload=ev=>setter(ev.target.result);
                    reader.readAsDataURL(file);
                  }}/>
                <div className="pdrop" style={{position:"relative",overflow:"hidden",minHeight:"200px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer"}}
                  onClick={()=>document.getElementById(`inp-${label}`)?.click()}>
                  {state ? (
                    <>
                      <img src={state} alt={label} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",borderRadius:"var(--r-lg)"}}/>
                      <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.7),transparent)",borderRadius:"var(--r-lg)"}}/>
                      <div style={{position:"relative",zIndex:1,textAlign:"center",marginTop:"auto",padding:"0.75rem"}}>
                        <div style={{fontSize:"0.72rem",color:"#fff",letterSpacing:"1.5px",textTransform:"uppercase"}}>{label}</div>
                        <div style={{fontSize:"0.68rem",color:"rgba(255,255,255,0.6)",marginTop:"2px"}}>Click to change</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="pdrop-ic">{icon}</div>
                      <div className="pdrop-lb" style={{marginTop:"0.5rem"}}>{label}</div>
                      <div style={{fontSize:"0.68rem",color:"var(--muted)",marginTop:"0.3rem"}}>Click to upload</div>
                    </>
                  )}
                </div>
                {/* Camera shortcut button */}
                <button onClick={e=>{e.stopPropagation();openCamera(camTarget);}} style={{position:"absolute",bottom:"0.6rem",right:"0.6rem",zIndex:3,background:"rgba(0,0,0,0.6)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:"34px",height:"34px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}} title="Use camera">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="ph"><div className="pt">Athlete <em>Information</em></div><span className="bdg bg-g">Profile Setup</span></div>
            <div className="pb">
              <div className="two">
                <div>
                  {[["Full Name","text","Your full name","name"],["Age","number","Years","age"],["Weight","number","lbs","weight"],["Height","number","inches","height"]].map(([l,t,ph,k])=>(
                    <div key={k} className="f"><label className="fl">{l}</label><input type={t} className="fi" placeholder={ph} value={profile[k]} onChange={e=>setProfile(p=>({...p,[k]:e.target.value}))}/></div>
                  ))}
                </div>
                <div>
                  <div className="f"><label className="fl">Primary Goal</label>
                    <select className="fi" value={profile.goal} onChange={e=>setProfile(p=>({...p,goal:e.target.value}))}>
                      {["Weight Maintenance","Weight Gain","Weight Loss","Strength Training","Muscle Building","Athletic Performance"].map(g=><option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div className="f">
                    <label className="fl">Sport</label>
                    <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"0.5rem"}}>
                      {Object.entries(SPORTS).map(([k,s])=>(
                        <button key={k} className={`bsm${profile.sport===k?" on":""}`} onClick={()=>{setProfile(p=>({...p,sport:k,position:""}));setSelInj([]);}}>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.5px",opacity:0.7,marginRight:"3px"}}></span>{s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {profile.sport && (
                    <div className="f"><label className="fl">Position</label>
                      <select className="fi" value={profile.position} onChange={e=>{setProfile(p=>({...p,position:e.target.value}));setSelInj([]);}}>
                        <option value="">Select Position</option>
                        {SPORTS[profile.sport].positions.map(pos=><option key={pos}>{pos}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
              <div className="gr"/>
              <div style={{display:"flex",justifyContent:"flex-end",gap:"0.75rem"}}>
                <button className="bgh" onClick={()=>setScreen("landing")}>Back</button>
                <button className="bg" style={{padding:"0.8rem 2.5rem"}} onClick={()=>{
                  if(profile.name&&profile.sport){
                    setMealType(profile.goal==="Weight Gain"?"Weight Gain":profile.goal==="Weight Loss"?"Weight Loss":"Weight Maintenance");
                    setScreen("dashboard");shout(`Welcome, ${profile.name}. Your journey begins now.`,"◆");
                  } else shout("Please enter your name and select a sport","!");
                }}>Launch Dashboard</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast t={toast}/>}
    </>
  );

  // ── DASHBOARD ────────────────────────────────────────────────
  const MODS = [
    {id:"nutrition",label:"Nutrition",  sub:"Meal Plans",     icon:"N",img:"https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=80"},
    {id:"workout",  label:"Workout",    sub:"Training",       icon:"W",img:"https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&q=80"},
    {id:"injury",   label:"Recovery",   sub:"Rehabilitation", icon:"R",img:"https://images.unsplash.com/photo-1552072092-7f9b8d63efcb?w=600&q=80"},
    {id:"progress", label:"Progress",   sub:"Analytics",      icon:"P",img:"https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600&q=80"},
    {id:"journal",  label:"Journal",    sub:"Personal Notes", icon:"J",img:"https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&q=80"},
    {id:"calendar", label:"Calendar",   sub:"Schedule",       icon:"C",  img:"https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80"},
    {id:"profile",  label:"Profile",    sub:"Settings",       icon:"✦",img:sport.img},
    {id:"upgrade",  label:"Upgrade",    sub:"Premium Plans",  icon:"◆",img:"https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&q=80"},
  ];

  // ── PRICING SCREEN ─────────────────────────────────────────
  if (screen === "pricing") return (
    <>
      <style>{CSS}</style>
      <div className="noise"/>
      <nav className="nav">
        <div className="nav-wm">
          <span className="nav-wm-top">The Premier Athletic Platform</span>
          <span className="nav-wm-main">Elite Athlete</span>
        </div>
        <div className="nav-r">
          <button className="bgh" onClick={()=>setScreen("dashboard")} style={{fontSize:"0.68rem",letterSpacing:"2px"}}>← Back</button>
        </div>
      </nav>
      <div style={{paddingTop:"80px",minHeight:"100vh",background:"var(--ink)"}}>
        <div className="wrap" style={{paddingTop:"3rem",paddingBottom:"5rem"}}>
          <div style={{textAlign:"center",marginBottom:"1.5rem"}}>
            <div className="eyebrow" style={{justifyContent:"center"}}>Membership</div>
            <h2 className="sh2" style={{textAlign:"center"}}>Choose Your <em>Plan</em></h2>
            <p style={{textAlign:"center",color:"var(--muted)",fontSize:"0.88rem",marginTop:"0.75rem",fontWeight:300}}>
              Annual plans save up to 43% · Cancel anytime
            </p>
          </div>
          <PricingSection setPayModal={setPayModal}/>
        </div>
      </div>
      {payModal && <PayModal plan={payModal} tab={payTab} setTab={setPayTab} userEmail={authUser?.email} onClose={()=>setPayModal(null)}
        onSuccess={()=>{setPayModal(null);shout("Subscription activated! Welcome to Elite.","◆");setScreen("dashboard");}}/>}
      {toast && <Toast t={toast}/>}
    </>
  );

  if (screen !== "dashboard") return null;
  return (
    <>
      <style>{CSS}</style>
      <div className="noise"/>
      <nav className="nav">
        <div className="nav-wm">
          <span className="nav-wm-top">The Premier Athletic Platform</span>
          <span className="nav-wm-main">Elite Athlete</span>
        </div>
        <div className="nav-pills">
          {MODS.slice(0,6).map(m=>(
            <button key={m.id} className={`npill${dash===m.id?" on":""}`} onClick={()=>goTo(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="nav-r">
          {/* Dark/Light mode toggle */}
          <button onClick={()=>setDarkMode(d=>!d)} style={{
            background:"none",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"20px",
            cursor:"pointer",padding:"0.3rem 0.7rem",display:"flex",alignItems:"center",gap:"0.35rem",
            fontSize:"0.78rem",color:"var(--gold)",transition:"all 0.25s",
          }} title={darkMode?"Switch to Light Mode":"Switch to Dark Mode"}>
            <span style={{fontSize:"0.9rem"}}>{darkMode?"":""}</span>
            <span style={{fontSize:"0.68rem",letterSpacing:"1px",fontWeight:600}}>{darkMode?"LIGHT":"DARK"}</span>
          </button>
          {authUser ? (
            <>
              <span style={{fontSize:"0.74rem",color:"var(--gold)",letterSpacing:"1.5px",border:"1px solid rgba(255,255,255,0.07)",padding:"0.3rem 0.7rem",borderRadius:"var(--r)"}}>
                ✓ {authUser.email?.split('@')[0]}
              </span>
              <button className="bgh" onClick={()=>{signOut();setAuthUser(null);setScreen("landing");}} style={{fontSize:"0.8rem",padding:"0.5rem 1rem"}}>Sign Out</button>
            </>
          ) : (
            <>
              <button className="bgh" onClick={()=>setAuthModal(true)} style={{fontSize:"0.8rem",padding:"0.5rem 1rem"}}>Sign In</button>
              <button className="bgh" onClick={()=>setScreen("landing")} style={{fontSize:"0.8rem",padding:"0.5rem 1rem"}}>Exit</button>
            </>
          )}
        </div>
      </nav>

      <div style={{paddingTop:"68px",minHeight:"100vh"}}>
        {/* DASH HERO */}
        <div className="dash-hero">
          <div className="dh-bg" style={{backgroundImage:`url(${sport.img})`}}/>
          <div className="dh-vig"/>
          <div className="dh-rule"/>
          {/* Action buttons — top right */}
          <div className="dh-acts">
            <button className="bsm" onClick={()=>{
              try { downloadAthleteReportCard({profile,sport,totalCals,wkWeek,wkLog,benchmarks,weightLog,checkIns,nutritionLog,progressPhotos});
                shout("Report Card downloaded","◆"); } catch(e){ shout("Export failed","!"); }
            }}>↓ Report Card</button>
            <button className="bsm" onClick={()=>setEmailModal({type:"progress",label:"Progress Report",data:{...profile,totalCals,mealType,mealFreq}})}>✉ Email</button>
            <button className="bsm" onClick={handleDownloadProgress}>↓ Download</button>
          </div>
          {/* Main identity block */}
          <div className="dh-c">
            <div className="dh-eyebrow">Elite Athlete Platform</div>
            <div className="dh-greet">
              Welcome back,<em>{profile.name||"Champion"}</em>
            </div>
            <div className="dh-badge">
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.58rem",fontWeight:700,letterSpacing:"1px",background:"rgba(201,168,76,0.18)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"2px",padding:"1px 5px"}}>{sport.icon}</span>
              {sport.label} · {profile.position||"Elite Athlete"}
            </div>
          </div>
          {/* Stats strip */}
          <div className="dh-strip">
            {[
              [totalCals.toLocaleString(), "Daily Target kcal"],
              [`Wk ${wkWeek}`, "Training Week"],
              [wkLog.length > 0 ? wkLog.length : "0", "Sessions Logged"],
              [checkIns.length > 0 ? `${(checkIns.slice(0,7).reduce((s,c)=>s+(c.recovery||0),0)/Math.max(checkIns.slice(0,7).length,1)).toFixed(1)}/10` : "—", "Avg Recovery"],
            ].map(([val, lbl])=>(
              <div key={lbl} className="dh-stat">
                <div className="dh-stat-val">{val}</div>
                <div className="dh-stat-lbl">{lbl}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="wrap" style={{paddingBottom:"5rem"}}>
          {/* MODULE TILES */}
          <div className="mod-grid">
            {MODS.map(m=>(
              <div key={m.id} className={`mtile${dash===m.id?" on":""}`}
                onClick={()=>m.id==="upgrade"?setScreen("pricing"):goTo(m.id)}>
                <div className="mt-img" style={{backgroundImage:`url(${m.img})`}}/>
                <div className="mt-grad"/>
                <div className="mt-dot"/>
                <div className="mt-body">
                  <div className="mt-icon">{m.icon}</div>
                  <div><div className="mt-label">{m.label}</div><div className="mt-sub">{m.sub}</div></div>
                </div>
              </div>
            ))}
          </div>

          {/* NUTRITION */}
          {dash==="nutrition" && (
            <div>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"2rem"}}>
                <div><div className="eyebrow">Daily Fuel</div><h2 className="sh2">Nutrition <em>Plan</em></h2></div>
                <div style={{display:"flex",gap:"0.45rem",flexWrap:"wrap"}}>
                  {["Weight Gain","Weight Loss","Weight Maintenance"].map(t=>(
                    <button key={t} className={`bsm${mealType===t?" on":""}`} onClick={()=>setMealType(t)}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Daily / Weekly / Monthly Toggle */}
              <div style={{display:"flex",gap:"0.5rem",marginBottom:"1rem"}}>
                {[["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]].map(([v,lbl])=>(
                  <button key={v} onClick={()=>setMealView(v)} style={{
                    flex:1,padding:"0.6rem",borderRadius:"var(--r)",border:`1px solid ${mealView===v?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.06)"}`,
                    background:mealView===v?"rgba(255,255,255,0.06)":"transparent",
                    color:mealView===v?"var(--ivory)":"var(--muted)",
                    fontSize:"0.6rem",fontFamily:"'Inter',sans-serif",letterSpacing:"3px",textTransform:"uppercase",cursor:"pointer",fontWeight:600
                  }}>{lbl}</button>
                ))}
              </div>

              {/* Sport + Position Nutrition Intelligence Panel */}
              {sportNutrition && (
                <div style={{background:"var(--slate)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:"var(--r)",padding:"1.1rem 1.25rem",marginBottom:"1.25rem"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.75rem"}}>
                    <div>
                      <div style={{fontSize:"0.6rem",letterSpacing:"3.5px",textTransform:"uppercase",color:"var(--ivory2)",marginBottom:"0.3rem",fontFamily:"'Inter',sans-serif",fontWeight:600}}>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.58rem",fontWeight:700,letterSpacing:"1px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"2px",padding:"1px 5px",marginRight:"0.3rem",color:"var(--ivory2)"}}>{sport.icon}</span>{sport.label}{profile.position ? ` · ${profile.position}` : ""} — Sport-Optimized Nutrition
                      </div>
                      <div style={{fontSize:"0.88rem",color:"var(--ivory2)",fontFamily:"'Inter',sans-serif",lineHeight:1.7}}>
                        {sportNutrition.posNote}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:"1rem"}}>
                      <div style={{fontSize:"2.2rem",fontFamily:"'DM Sans',sans-serif",color:"var(--ivory)",fontWeight:800,letterSpacing:"2px",lineHeight:1}}>{totalCals.toLocaleString()}</div>
                      <div style={{fontSize:"0.52rem",letterSpacing:"3.5px",color:"var(--muted)",textTransform:"uppercase",fontFamily:"'Inter',sans-serif",fontWeight:600,marginTop:"0.2rem"}}>Target kcal/day</div>
                      {sportNutrition.calMultiplier !== 1.0 && (
                        <div style={{fontSize:"0.82rem",color:sportNutrition.calMultiplier>1?"#4BAE71":"#C0695E",marginTop:"0.2rem",lineHeight:1.4}}>
                          {sportNutrition.calMultiplier>1
                            ? `+${Math.round((sportNutrition.calMultiplier-1)*100)}% more than average — your position demands it`
                            : `-${Math.abs(Math.round((sportNutrition.calMultiplier-1)*100))}% less than average — lean composition priority`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"1rem",flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:"160px"}}>
                      <div style={{fontSize:"0.82rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.35rem"}}>⏱ Nutrient Timing</div>
                      <div style={{fontSize:"0.82rem",color:"var(--muted)",lineHeight:1.6}}>{sportNutrition.timing}</div>
                    </div>
                    <div style={{flex:1,minWidth:"160px"}}>
                      <div style={{fontSize:"0.82rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.35rem"}}> Key Supplements</div>
                      <div style={{fontSize:"0.82rem",color:"var(--muted)",lineHeight:1.6}}>{sportNutrition.supplements.join(" · ")}</div>
                    </div>
                  </div>
                  <div style={{marginTop:"0.65rem",paddingTop:"0.65rem",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                    <div style={{fontSize:"0.76rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.5rem"}}> Jump To Workout</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"0.4rem",marginBottom:"0.85rem"}}>
                      {[["Strength Training","Full Body"],["Athletic Performance","Full Body"],["Muscle Building","Upper Body"]].map(([t,f])=>(
                        <button key={t} onClick={()=>{goTo("workout");setWkType(t);setWkFocus(f);shout(t+" — "+f+" loaded","");}}
                          style={{fontSize:"0.78rem",background:"rgba(255,255,255,0.04)",color:"var(--gold)",padding:"5px 14px",borderRadius:"var(--r)",border:"1px solid rgba(255,255,255,0.09)",cursor:"pointer"}}>
                          {t} →
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{paddingTop:"0.65rem",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                    <div style={{fontSize:"0.82rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.3rem"}}>🥩 Priority Foods for Your Position</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"0.35rem"}}>
                      {sportNutrition.keyFoods.map(f=>(
                        <span key={f} style={{fontSize:"0.74rem",background:"rgba(255,255,255,0.04)",color:"var(--ivory2)",padding:"2px 8px",borderRadius:"3px",border:"1px solid rgba(191,161,106,0.15)"}}>{f}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Meal Frequency Selector */}
              <div className="panel" style={{marginBottom:"1.25rem"}}>
                <div className="ph">
                  <div className="pt">Meals Per Day <em>— Your Lifestyle Protocol</em></div>
                  <span className="bdg bg-g">{mealFreq}-Meal Plan Active</span>
                </div>
                <div className="pb">
                  <div className="freq-grid">
                    {[
                      {n:3,lbl:"3 Meals",sub:"Classic · Busy schedule"},
                      {n:5,lbl:"5 Meals",sub:"Optimal · Performance focus"},
                      {n:7,lbl:"7 Meals",sub:"Elite · Maximum fuel protocol"},
                    ].map(f=>(
                      <div key={f.n} className={`freq-tile${mealFreq===f.n?" on":""}`} onClick={()=>setMealFreq(f.n)}>
                        <div className="freq-n">{f.n}</div>
                        <div className="freq-lbl">{f.lbl}</div>
                        <div className="freq-sub">{f.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:"0.84rem",color:"var(--muted)",fontFamily:"'Inter',sans-serif",letterSpacing:"0.3px",lineHeight:1.65}}>
                    {mealFreq===3 && "3 large structured meals — ideal for athletes with demanding schedules. Each meal is calorie-dense to meet elite performance targets without interrupting your day."}
                    {mealFreq===5 && "5 meals distributes nutrients optimally throughout the day, maintaining an anabolic state and steady energy. The gold standard for most competitive athletes."}
                    {mealFreq===7 && "7 meals maximizes nutrient timing, muscle protein synthesis, and metabolic rate. Designed for professional athletes in high-training phases requiring maximum fuel delivery around the clock."}
                  </div>
                </div>
              </div>

              {/* Daily Totals Bar */}
              <div className="totals-bar">
                <div className="tot-cell">
                  <div className="tot-val cal">{totalCals.toLocaleString()}</div>
                  <div className="tot-lbl">Total Calories</div>
                </div>
                <div className="tot-cell">
                  <div className="tot-val pro">{totalP}g</div>
                  <div className="tot-lbl">Protein</div>
                </div>
                <div className="tot-cell">
                  <div className="tot-val carb">{totalC}g</div>
                  <div className="tot-lbl">Carbohydrates</div>
                </div>
                <div className="tot-cell">
                  <div className="tot-val fat">{totalF}g</div>
                  <div className="tot-lbl">Total Fat</div>
                </div>
              </div>

              <div className="two">
                {/* Left — Daily or Weekly Meal View */}
                <div>
                  {mealView === "daily" ? (
                    <>
                      <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"0.75rem",padding:"0.65rem 0.85rem",background:"rgba(255,255,255,0.03)",borderRadius:"var(--r)",border:"1px solid rgba(191,161,106,0.15)"}}>
                        <span style={{fontSize:"1.1rem"}}>{"◆💥↺"[todayDow]}</span>
                        <div>
                          <div style={{fontSize:"0.82rem",fontWeight:600,color:"var(--gold)"}}>
                            {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][todayDow]}'s Plan
                          </div>
                          <div style={{fontSize:"0.74rem",color:"var(--muted)"}}>Matched to your weekly schedule · {totalCals.toLocaleString()} kcal · {meals.length} meals</div>
                        </div>
                      </div>
                      {meals.map(meal=>{
                        const mCal=meal.items.reduce((s,it)=>s+it.cal,0);
                        const mP=meal.items.reduce((s,it)=>s+it.p,0);
                        const mC=meal.items.reduce((s,it)=>s+it.c,0);
                        const mF=meal.items.reduce((s,it)=>s+it.f,0);
                        return (
                          <div key={meal.id} className="meal-block">
                            <div className="meal-block-head">
                              <div className="meal-block-left">
                                <span className="meal-block-emoji">{(()=>{
                                  const label = meal.emoji || "·";
                                  const fs = label.length <= 1 ? 13 : label.length <= 2 ? 11 : 9;
                                  return (
                                    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"
                                      style={{borderRadius:"4px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
                                      <text x="18" y="23" textAnchor="middle" fontFamily="DM Sans,sans-serif" fontSize={fs} fontWeight="700"
                                        letterSpacing="0.5" fill="var(--gold)">{label}</text>
                                    </svg>
                                  );
                                })()}</span>
                                <div>
                                  <div className="meal-block-label">{meal.label}</div>
                                  <div className="meal-block-time">{meal.time}</div>
                                </div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div className="meal-block-cal">{mCal}</div>
                                <div className="meal-block-cal-lbl">kcal &nbsp;·&nbsp; {mP}P {mC}C {mF}F</div>
                              </div>
                            </div>
                            <div className="meal-block-body">
                              {meal.items.map((it,i)=>(
                                <div key={i} className="meal-item-row" style={{flexDirection:"column",alignItems:"stretch",gap:"0.25rem"}}>
                                  {(()=>{
                                    const subKey=`${meal.id}_${i}`;
                                    const sub=mealSubs[subKey];
                                    const d=sub||it;
                                    return (<>
                                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"0.4rem"}}>
                                        <div className="meal-item-name" style={{flex:1}}>
                                          <div className="md"/>
                                          <span style={sub?{color:"var(--gold)",fontStyle:"italic"}:{}}>{d.name}</span>
                                          {sub&&<span style={{fontSize:"0.7rem",color:"#4BAE71",marginLeft:"0.3rem"}}>✓ sub</span>}
                                        </div>
                                        <div style={{display:"flex",gap:"0.25rem",alignItems:"center",flexShrink:0}}>
                                          <div className="meal-item-macros">
                                            <span className="macro-chip mc-cal">{d.cal} kcal</span>
                                            <span className="macro-chip mc-p">{d.p}g P</span>
                                            <span className="macro-chip mc-c">{d.c}g C</span>
                                            <span className="macro-chip mc-f">{d.f}g F</span>
                                          </div>
                                          <button onClick={()=>{const k=`${meal.id}_${i}`;if(subEditing===k){setSubEditing(null);setSubForm({name:"",cal:"",p:"",c:"",f:"",portion:""});}else{setSubEditing(k);setSubForm(mealSubs[k]||{name:"",cal:"",p:"",c:"",f:"",portion:""});}}} style={{fontSize:"0.7rem",background:"rgba(255,255,255,0.04)",color:"var(--gold)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"4px",padding:"2px 6px",cursor:"pointer"}}>
                                            {sub?"✏":"⇄"}
                                          </button>
                                          {sub&&<button onClick={()=>setMealSubs(s=>{const n={...s};delete n[`${meal.id}_${i}`];return n;})} style={{fontSize:"0.7rem",background:"rgba(192,105,94,0.1)",color:"#C0695E",border:"1px solid rgba(192,105,94,0.2)",borderRadius:"4px",padding:"2px 6px",cursor:"pointer"}}>✕</button>}
                                        </div>
                                      </div>
                                      {subEditing===`${meal.id}_${i}`&&(
                                        <div style={{background:"rgba(191,161,106,0.05)",border:"1px solid rgba(191,161,106,0.15)",borderRadius:"var(--r)",padding:"0.7rem",marginTop:"0.2rem"}}>
                                          <div style={{fontSize:"0.78rem",color:"var(--gold)",marginBottom:"0.45rem",fontWeight:600}}>⇄ Substitute Ingredient</div>
                                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.35rem",marginBottom:"0.35rem"}}>
                                            <input className="fi" placeholder="Food name (e.g. Grilled Tilapia 6oz)" value={subForm.name} onChange={e=>setSubForm(f=>({...f,name:e.target.value}))} style={{fontSize:"0.8rem",padding:"0.38rem 0.6rem"}}/>
                                            <input className="fi" placeholder="Portion size (e.g. 6oz, 1 cup)" value={subForm.portion} onChange={e=>setSubForm(f=>({...f,portion:e.target.value}))} style={{fontSize:"0.8rem",padding:"0.38rem 0.6rem"}}/>
                                          </div>
                                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.35rem",marginBottom:"0.45rem"}}>
                                            {[["cal","Calories"],["p","Protein g"],["c","Carbs g"],["f","Fat g"]].map(([k,lbl])=>(
                                              <input key={k} type="number" className="fi" placeholder={lbl} value={subForm[k]} onChange={e=>setSubForm(f=>({...f,[k]:e.target.value}))} style={{fontSize:"0.8rem",padding:"0.38rem 0.5rem"}}/>
                                            ))}
                                          </div>
                                          <div style={{fontSize:"0.72rem",color:"var(--muted)",marginBottom:"0.4rem",fontStyle:"italic"}}>Enter nutritional values from food label or USDA database</div>
                                          <div style={{display:"flex",gap:"0.4rem"}}>
                                            <button className="bg" style={{flex:1,padding:"0.42rem",fontSize:"0.78rem"}} onClick={()=>{
                                              if(!subForm.name||!subForm.cal){shout("Enter food name and calories","!");return;}
                                              const k=`${meal.id}_${i}`;
                                              setMealSubs(s=>({...s,[k]:{name:subForm.name,cal:parseInt(subForm.cal)||0,p:parseInt(subForm.p)||0,c:parseInt(subForm.c)||0,f:parseInt(subForm.f)||0,portion:subForm.portion}}));
                                              setSubEditing(null);setSubForm({name:"",cal:"",p:"",c:"",f:"",portion:""});
                                              shout(subForm.name+" substituted","✓");
                                            }}>✓ Save</button>
                                            <button className="bgh" style={{padding:"0.42rem 0.7rem",fontSize:"0.78rem"}} onClick={()=>{setSubEditing(null);setSubForm({name:"",cal:"",p:"",c:"",f:"",portion:""});}}>Cancel</button>
                                          </div>
                                        </div>
                                      )}
                                    </>);
                                  })()}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  ) : mealView === "weekly" ? (
                    /* Weekly Plan — clickable days with full meal drill-down */
                    <div>
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((day,di)=>{
                        const wkLabels = ["Strength: Full Body","Strength: Upper Body","Cardio","Strength: Lower Body","Cardio","Active Recovery","Rest Day"];
                        const variety = WEEKLY_VARIETY[mealType]?.[mealFreq];
                        const dayMeals = variety ? variety[getMonthVariedIndex(di, new Date().getMonth())] : (MEAL_PLANS[mealType]?.[mealFreq] || meals);
                        const dayCals = dayMeals.reduce((s,m)=>s+m.items.reduce((ss,it)=>ss+it.cal,0),0);
                        const isOpen = expandedDay === di;
                        return (
                          <div key={day} style={{marginBottom:"0.5rem",borderRadius:"var(--r)",border:`1px solid ${isOpen?"var(--gold)":"rgba(255,255,255,0.06)"}`,overflow:"hidden"}}>
                            {/* Day header — clickable */}
                            <div onClick={()=>setExpandedDay(isOpen?null:di)} style={{display:"flex",alignItems:"center",gap:"0.75rem",padding:"0.85rem 1rem",cursor:"pointer",background:isOpen?"rgba(191,161,106,0.07)":"transparent"}}>
                              <span style={{fontSize:"1.2rem"}}>{["","","","◆","💥","","↺"][di]}</span>
                              <div style={{flex:1}}>
                                <div style={{fontSize:"0.92rem",fontWeight:600,color:isOpen?"var(--gold)":"var(--fg)"}}>{day}</div>
                                <div style={{fontSize:"0.76rem",color:"var(--muted)",marginTop:"0.15rem"}}>{dayCals.toLocaleString()} kcal · {dayMeals.length} meals · {wkLabels[di]}</div>
                              </div>
                              <div style={{fontSize:"0.76rem",color:isOpen?"var(--gold)":"var(--muted)",letterSpacing:"2px"}}>{isOpen?"▲ HIDE":"▼ VIEW"}</div>
                            </div>
                            {/* Expanded meal detail */}
                            {isOpen && (
                              <div style={{padding:"0.75rem 1rem",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                                {dayMeals.map((meal,mi)=>{
                                  const mCal=meal.items.reduce((s,it)=>s+it.cal,0);
                                  const mP=meal.items.reduce((s,it)=>s+it.p,0);
                                  const mC=meal.items.reduce((s,it)=>s+it.c,0);
                                  const mF=meal.items.reduce((s,it)=>s+it.f,0);
                                  return (
                                    <div key={mi} style={{marginBottom:"0.75rem",paddingBottom:"0.75rem",borderBottom:"1px solid var(--border)"}}>
                                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.4rem"}}>
                                        <div style={{fontSize:"0.84rem",fontWeight:600,color:"var(--gold)"}}>{meal.emoji} {meal.label} <span style={{color:"var(--muted)",fontWeight:300}}>· {meal.time}</span></div>
                                        <div style={{fontSize:"0.76rem",color:"var(--muted)"}}>{mCal} kcal · {mP}P {mC}C {mF}F</div>
                                      </div>
                                      {meal.items.map((it,ii)=>(
                                        <div key={ii} style={{display:"flex",justifyContent:"space-between",padding:"0.25rem 0.5rem",fontSize:"0.82rem",color:"var(--ivory2)"}}>
                                          <span>• {it.name}</span>
                                          <span style={{color:"var(--muted)"}}>{it.cal} kcal</span>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Monthly Plan — clickable days */
                    <div>
                      <div style={{fontSize:"0.76rem",letterSpacing:"3px",textTransform:"uppercase",color:"var(--gold)",marginBottom:"1rem"}}>
                        {new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})} — {mealType} · {mealFreq} Meals/Day · tap a day to expand
                      </div>
                      {(() => {
                        const now = new Date();
                        const year = now.getFullYear();
                        const month = now.getMonth();
                        const daysInMonth = new Date(year, month+1, 0).getDate();
                        const wkTypes = ["Strength Training","Strength Training","Cardio","Strength Training","Cardio","Active Recovery","Rest"];
                        const wkFocuses = ["Full Body","Upper Body","Lower Body","Upper Body","Full Body","Full Body","Full Body"];
                        const altTypes = mealType==="Weight Gain"
                          ? ["Weight Gain","Weight Gain","Weight Maintenance","Weight Gain","Weight Gain","Weight Maintenance","Weight Gain"]
                          : mealType==="Weight Loss"
                          ? ["Weight Loss","Weight Loss","Weight Maintenance","Weight Loss","Weight Loss","Weight Maintenance","Weight Loss"]
                          : ["Weight Maintenance","Weight Maintenance","Weight Gain","Weight Maintenance","Weight Maintenance","Weight Loss","Weight Maintenance"];
                        return Array.from({length: daysInMonth}, (_,i) => {
                          const date = new Date(year, month, i+1);
                          const dow = date.getDay();
                          const dayMeals = (MEAL_PLANS[altTypes[dow]]?.[mealFreq]) || meals;
                          const dayCals = dayMeals.reduce((s,m)=>s+m.items.reduce((ss,it)=>ss+it.cal,0),0);
                          const workout = wkTypes[dow];
                          const focus = wkFocuses[dow];
                          const isToday = i+1 === now.getDate();
                          const isExpanded = expandedDay === `m-${i}`;
                          return (
                            <div key={i} style={{marginBottom:"0.35rem",borderRadius:"var(--r)",border:`1px solid ${isToday?"var(--gold)":isExpanded?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.04)"}`,overflow:"hidden"}}>
                              <div onClick={()=>setExpandedDay(isExpanded?null:`m-${i}`)} style={{
                                display:"flex",alignItems:"center",gap:"0.75rem",
                                padding:"0.65rem 0.85rem",cursor:"pointer",
                                background:isToday?"rgba(191,161,106,0.06)":isExpanded?"rgba(191,161,106,0.04)":"rgba(20,19,16,0.6)"
                              }}>
                                <div style={{minWidth:"32px",textAlign:"center"}}>
                                  <div style={{fontSize:"1rem",fontFamily:"'DM Sans',sans-serif",color:isToday?"var(--gold)":"var(--fg)",fontWeight:700,letterSpacing:"-0.5px"}}>{i+1}</div>
                                  <div style={{fontSize:"0.82rem",letterSpacing:"1px",color:"var(--muted)",textTransform:"uppercase"}}>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow]}</div>
                                </div>
                                <div style={{flex:1,borderLeft:"1px solid rgba(255,255,255,0.06)",paddingLeft:"0.75rem"}}>
                                  <div style={{display:"flex",gap:"0.5rem",alignItems:"center",marginBottom:"0.2rem"}}>
                                    <span style={{fontSize:"0.76rem",background:"rgba(255,255,255,0.05)",color:"var(--gold)",padding:"1px 6px",borderRadius:"3px"}}>{dayCals.toLocaleString()} kcal</span>
                                    <span style={{fontSize:"0.76rem",background:"rgba(58,107,155,0.15)",color:"#6B9FD4",padding:"1px 6px",borderRadius:"3px"}}>{workout==="Rest"?"Rest Day":focus}</span>
                                  </div>
                                  <div style={{fontSize:"0.76rem",color:"var(--ivory2)",fontWeight:300}}>{dayMeals.map(m=>m.label||m.label).join(" · ")}</div>
                                </div>
                                <div style={{fontSize:"0.84rem",color:"var(--muted)"}}>{isExpanded?"▲":"▼"}</div>
                              </div>
                              {isExpanded && (
                                <div style={{padding:"0.75rem 1rem",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                                  {dayMeals.map((meal,mi)=>{
                                    const mCal=meal.items.reduce((s,it)=>s+it.cal,0);
                                    return (
                                      <div key={mi} style={{marginBottom:"0.6rem"}}>
                                        <div style={{fontSize:"0.82rem",fontWeight:600,color:"var(--gold)",marginBottom:"0.25rem"}}>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.65rem",letterSpacing:"1px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:"3px",padding:"1px 5px",marginRight:"0.4rem"}}>{meal.emoji}</span>
                          {meal.label} <span style={{color:"var(--muted)",fontWeight:300}}>· {meal.time} · {mCal} kcal</span></div>
                                        {meal.items.map((it,ii)=>(
                                          <div key={ii} style={{display:"flex",justifyContent:"space-between",padding:"0.2rem 0.5rem",fontSize:"0.9rem",color:"var(--ivory2)"}}>
                                            <span>• {it.name}</span><span style={{color:"var(--muted)"}}>{it.cal} kcal</span>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                  <div style={{display:"flex",gap:"0.7rem",marginTop:"0.5rem"}}>
                    {mealView === "daily" ? (<>
                      <button className="bg" style={{flex:1,padding:"0.72rem"}} onClick={handleDownloadMealPlan}>⬇ PDF</button>
                      <button className="bgh" style={{flex:1,padding:"0.72rem"}} onClick={()=>setEmailModal({type:"meal",label:"Meal Plan",data:{meals,totalCals,mealType,mealFreq}})}>✉ Email</button>
                      <button className="bgh" style={{padding:"0.72rem 1rem"}} onClick={()=>{window.print();shout("Printing…","↓")}}>↓</button>
                    </>) : (<>
                      <button className="bg" style={{flex:1,padding:"0.72rem"}} onClick={()=>{
                        // Print weekly or monthly full plan
                        const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
                        const variety = WEEKLY_VARIETY[mealType]?.[mealFreq];
                        const wkLabels = ["Strength: Full Body","Strength: Upper Body","Cardio","Strength: Lower Body","Cardio","Active Recovery","Rest Day"];
                        const isMonthly = mealView === "monthly";
                        const win = window.open("","_blank");
                        const title = isMonthly
                          ? `${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})} Monthly Plan`
                          : "Weekly Meal Plan";
                        let body = "";
                        if(isMonthly) {
                          const now = new Date();
                          const daysInMonth = new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
                          const wkTypes=["Rest","Strength: Full Body","Strength: Upper Body","Cardio","Strength: Lower Body","Cardio","Active Recovery"];
                          for(let d=1;d<=daysInMonth;d++){
                            const dow=new Date(now.getFullYear(),now.getMonth(),d).getDay();
                            const dayMeals=variety?variety[getMonthVariedIndex(dow,new Date().getMonth())]:(MEAL_PLANS[mealType]?.[mealFreq]||meals);
                            const dayCals=dayMeals.reduce((s,m)=>s+m.items.reduce((ss,it)=>ss+it.cal,0),0);
                            const dayName=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow];
                            body+=`<div style="margin-bottom:16px;padding:12px;border:1px solid #eee;border-radius:6px"><div style="font-weight:bold;color:#BFA16A;margin-bottom:6px">${d} ${dayName} — ${dayCals.toLocaleString()} kcal · ${wkTypes[dow]}</div>`;
                            dayMeals.forEach(m=>{const mc=m.items.reduce((s,it)=>s+it.cal,0);body+=`<div style="margin:4px 0"><span style="font-size:0.85em;font-weight:600">${m.emoji} ${m.label}</span> <span style="color:#888;font-size:0.8em">· ${mc} kcal</span><ul style="margin:2px 0 0 16px;padding:0">${m.items.map(it=>`<li style="font-size:0.78em">${it.name} — ${it.cal} kcal</li>`).join("")}</ul></div>`;});
                            body+="</div>";
                          }
                        } else {
                          days.forEach((day,di)=>{
                            const dayMeals=variety?variety[getMonthVariedIndex(di,new Date().getMonth())]:(MEAL_PLANS[mealType]?.[mealFreq]||meals);
                            const dayCals=dayMeals.reduce((s,m)=>s+m.items.reduce((ss,it)=>ss+it.cal,0),0);
                            body+=`<div style="margin-bottom:20px;padding:14px;border:1px solid #eee;border-radius:6px"><div style="font-weight:bold;color:#BFA16A;margin-bottom:8px">${day} — ${dayCals.toLocaleString()} kcal · ${wkLabels[di]}</div>`;
                            dayMeals.forEach(m=>{const mc=m.items.reduce((s,it)=>s+it.cal,0);body+=`<div style="margin:6px 0"><span style="font-size:0.85em;font-weight:600">${m.emoji} ${m.label}</span> <span style="color:#888;font-size:0.8em">· ${m.time} · ${mc} kcal</span><ul style="margin:2px 0 0 16px;padding:0">${m.items.map(it=>`<li style="font-size:0.78em">${it.name} — ${it.cal} kcal · ${it.p}P ${it.c}C ${it.f}F</li>`).join("")}</ul></div>`;});
                            body+="</div>";
                          });
                        }
                        win.document.write(`<!DOCTYPE html><html><head><title>${sanitizeHtml(title)}</title><style>body{font-family:Georgia,serif;max-width:800px;margin:30px auto;color:#1a1a1a}h1{border-bottom:2px solid #BFA16A;padding-bottom:8px}p{color:#888;font-size:0.85em}</style></head><body><h1>${sanitizeHtml(title)}</h1><p>Athlete: ${sanitizeHtml(profile.name||"—")} · ${sanitizeHtml(mealType)} · ${mealFreq} meals/day</p>${body}</body></html>`);
                        win.document.close();win.print();
                        shout(`${mealView==="monthly"?"Monthly":"Weekly"} plan printed`,"↓");
                      }}>↓ Print {mealView==="monthly"?"Month":"Week"}</button>
                      <button className="bgh" style={{flex:1,padding:"0.72rem"}} onClick={()=>{
                        const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
                        const variety=WEEKLY_VARIETY[mealType]?.[mealFreq];
                        const isMonthly=mealView==="monthly";
                        const NL="\n";
                        let msg="ELITE ATHLETE — "+(isMonthly?"MONTHLY":"WEEKLY")+" MEAL PLAN"+NL+"Athlete: "+(profile.name||"—")+NL+"Plan: "+mealType+" \u00b7 "+mealFreq+" meals/day"+NL+"──────────────────────────────────────────────────"+NL+NL;
                        if(isMonthly){
                          const now=new Date();const dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
                          const dns=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                          for(let d=1;d<=dim;d++){const dow=new Date(now.getFullYear(),now.getMonth(),d).getDay();const dm=variety?variety[getMonthVariedIndex(dow,now.getMonth())]:(MEAL_PLANS[mealType]?.[mealFreq]||meals);const dc=dm.reduce((s,m)=>s+m.items.reduce((ss,it)=>ss+it.cal,0),0);msg+=d+" "+dns[dow]+" \u2014 "+dc.toLocaleString()+" kcal"+NL;dm.forEach(m=>{msg+="  "+m.emoji+" "+m.label+": "+m.items.map(it=>it.name).join(", ")+NL;});msg+=NL;}
                        } else {
                          days.forEach((day,di)=>{const dm=variety?variety[getMonthVariedIndex(di,new Date().getMonth())]:(MEAL_PLANS[mealType]?.[mealFreq]||meals);const dc=dm.reduce((s,m)=>s+m.items.reduce((ss,it)=>ss+it.cal,0),0);msg+=day+" \u2014 "+dc.toLocaleString()+" kcal"+NL;dm.forEach(m=>{msg+="  "+m.emoji+" "+m.label+" ("+m.time+")"+NL;m.items.forEach(it=>{msg+="    \u2022 "+it.name+" \u2014 "+it.cal+" kcal"+NL;});});msg+=NL;});
                        }
                        setEmailModal({type:"weeklyPlan",label:(isMonthly?"Monthly":"Weekly")+" Meal Plan",data:{msg,mealType,mealFreq}});
                      }}>Email {mealView==="monthly"?"Month":"Week"}</button>
                    </>)}
                  </div>
                </div>

                {/* Right — Macro Breakdown + Grocery */}
                <div>
                  <div className="panel" style={{marginBottom:"1.1rem"}}>
                    <div className="ph"><div className="pt">Macro <em>Breakdown</em></div></div>
                    <div className="pb">
                      {[
                        {l:"Total Calories",v:totalCals,m:4500,u:"kcal",color:"var(--gold-lt)"},
                        {l:"Protein",       v:totalP,   m:280, u:"g",   color:"#4BAE71"},
                        {l:"Carbohydrates", v:totalC,   m:550, u:"g",   color:"#6AABCC"},
                        {l:"Fats",          v:totalF,   m:180, u:"g",   color:"#C8884A"},
                      ].map(mac=>(
                        <div key={mac.l} className="mr2">
                          <div className="mh">
                            <span className="mn">{mac.l}</span>
                            <span className="mv" style={{color:mac.color}}>{mac.v}{mac.u}</span>
                          </div>
                          <div className="mt">
                            <div className="mf" style={{width:`${Math.min(mac.v/mac.m*100,100)}%`,background:`linear-gradient(90deg,${mac.color}88,${mac.color})`}}/>
                          </div>
                        </div>
                      ))}
                      <div className="gr"/>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
                        {[
                          {l:"Protein %", v:Math.round(totalP*4/totalCals*100)||0,  color:"#4BAE71"},
                          {l:"Carbs %",   v:Math.round(totalC*4/totalCals*100)||0,  color:"#6AABCC"},
                          {l:"Fat %",     v:Math.round(totalF*9/totalCals*100)||0,  color:"#C8884A"},
                          {l:"Meals/Day", v:mealFreq,                               color:"var(--gold)"},
                        ].map(s=>(
                          <div key={s.l} style={{background:"var(--smoke)",borderRadius:"var(--r)",padding:"0.75rem",textAlign:"center"}}>
                            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.8rem",fontWeight:600,color:s.color,lineHeight:1}}>{s.v}{s.l.includes("%")?"%":""}</div>
                            <div style={{fontSize:"0.84rem",letterSpacing:"2px",textTransform:"uppercase",color:"var(--muted)",marginTop:"0.22rem"}}>{s.l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="ph">
                      <div className="pt">Grocery <em>List</em></div>
                      <span style={{fontSize:"0.84rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase"}}>
                        {mealView==="daily"?"Today's":"Full Week"} Ingredients
                      </span>
                    </div>
                    <div className="pb">
                      {(()=>{
                        // Build grocery list — weekly/monthly uses full variety, daily uses just today's meals
                        const variety = WEEKLY_VARIETY[mealType]?.[mealFreq];
                        const allMeals = mealView === "daily"
                          ? (MEAL_PLANS[mealType]?.[mealFreq] || meals)
                          : (variety ? variety.flat() : (MEAL_PLANS[mealType]?.[mealFreq] || meals));
                        const itemMap = {};
                        allMeals.forEach(meal=>{
                          meal.items.forEach(it=>{
                            const key = it.name;
                            if(!itemMap[key]) itemMap[key] = {name:it.name, cal:it.cal, count:0};
                            itemMap[key].count++;
                          });
                        });
                        const groceryItems = Object.values(itemMap).sort((a,b)=>b.count-a.count);
                        return (
                          <div className="gg">
                            {groceryItems.map(item=>(
                              <div key={item.name} className="gi">
                                <div className={`gc${grocery[item.name]?" ck":""}`} onClick={()=>setGrocery(g=>({...g,[item.name]:!g[item.name]}))}>
                                  {grocery[item.name]?"✓":""}
                                </div>
                                <span style={{textDecoration:grocery[item.name]?"line-through":"none",opacity:grocery[item.name]?0.3:1,flex:1}}>{item.name}</span>
                                {item.count>1 && <span style={{fontSize:"0.84rem",color:"var(--gold)",marginLeft:"0.5rem"}}>×{item.count}</span>}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <div className="gr"/>
                      <button className="bgh" style={{width:"100%",padding:"0.68rem"}} onClick={()=>{
                        const variety = WEEKLY_VARIETY[mealType]?.[mealFreq];
                        const allMeals = variety ? variety.flat() : (MEAL_PLANS[mealType]?.[mealFreq] || meals);
                        const itemMap = {};
                        allMeals.forEach(meal=>{ meal.items.forEach(it=>{ if(!itemMap[it.name]) itemMap[it.name]={name:it.name,count:0}; itemMap[it.name].count++; }); });
                        const items = Object.keys(itemMap);
                        const checked = items.filter(i=>grocery[i]);
                        const unchecked = items.filter(i=>!grocery[i]);
                        const win = window.open('','_blank');
                        win.document.write(`<!DOCTYPE html><html><head><title>Elite Athlete — Grocery List</title><style>
                          body{font-family:Georgia,serif;max-width:600px;margin:40px auto;color:#1a1a1a;background:#fff;}
                          h1{font-size:1.8rem;border-bottom:2px solid #BFA16A;padding-bottom:10px;color:#1a1a1a;}
                          h2{font-size:0.9rem;letter-spacing:3px;text-transform:uppercase;color:#BFA16A;margin-top:24px;}
                          .item{padding:8px 0;border-bottom:1px solid #eee;font-size:1rem;}
                          .done{text-decoration:line-through;opacity:0.4;}
                          .meta{font-size:0.75rem;color:#888;margin-bottom:24px;}
                        </style></head><body>
                        <h1>Grocery List</h1>
                        <div class="meta">Athlete: ${profile.name || "—"} · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
                        <h2>To Buy (${unchecked.length} items)</h2>
                        ${unchecked.map(i=>`<div class="item">☐ ${i}</div>`).join('')}
                        ${checked.length?`<h2>Got It (${checked.length} items)</h2>${checked.map(i=>`<div class="item done">✓ ${i}</div>`).join('')}`:''}
                        </body></html>`);
                        win.document.close();
                        win.print();
                      }}>↓ Print List</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}


          {/* WORKOUT */}
          {dash==="workout" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"1.25rem"}}>
                <div><div className="eyebrow">Training</div><h2 className="sh2">Workout <em>Plan</em></h2></div>
                <div style={{display:"flex",gap:"0.5rem",alignItems:"center"}}>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:"0.72rem",color:"var(--muted)"}}>Training Week</div>
                    <div style={{display:"flex",alignItems:"center",gap:"0.4rem",marginTop:"0.2rem"}}>
                      <button className="bsm" onClick={()=>setWkWeek(w=>Math.max(1,w-1))}>−</button>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.4rem",color:"var(--gold)",fontWeight:600,minWidth:"2rem",textAlign:"center"}}>{wkWeek}</span>
                      <button className="bsm" onClick={()=>setWkWeek(w=>w+1)}>+</button>
                      <button className="bsm" onClick={()=>setWkWeek(1)} style={{color:"var(--muted)",fontSize:"0.68rem"}}>Reset</button>
                    </div>
                    {(()=>{
                      const plan = getPeriodizationPlan(profile.sport, profile.position);
                      const wk = plan?.weeks?.find(w=>w.week===wkWeek);
                      if (!wk) return null;
                      const phase = plan.phases.find(ph=>ph.name.includes(wk.phase));
                      return (
                        <div style={{fontSize:"0.68rem",marginTop:"0.25rem",color:phase?.color||"var(--gold)",fontWeight:600,letterSpacing:"0.5px"}}>
                          {wk.phase} · {wk.focus}
                        </div>
                      );
                    })()}
                  </div>
                  <button className="bsm" onClick={()=>setShowLog(l=>!l)} style={{height:"100%"}}>
                    {showLog?"Hide":"📊 Progress Log"}
                  </button>
                  <button className="bg" style={{padding:"0.45rem 1rem",fontSize:"0.76rem",flexShrink:0}}
                    onClick={()=>setShowPeriodization(p=>!p)}>
                    {showPeriodization?"✕ Close":"📅 16-Week Plan"}
                  </button>
                  <button className="bgh" style={{padding:"0.45rem 1rem",fontSize:"0.76rem",flexShrink:0}}
                    onClick={()=>{setShowExLib(true);setExLibSelected(null);}}>
                    📹 Exercise Library
                  </button>
                </div>
              </div>

              {/* ── 16-WEEK PERIODIZATION PLAN ─────────────────── */}
              {showPeriodization && (()=>{
                const plan = getPeriodizationPlan(profile.sport, profile.position);
                if (!plan) return (
                  <div className="panel" style={{marginBottom:"1.25rem",padding:"1.25rem",textAlign:"center",color:"var(--muted)",fontStyle:"italic"}}>
                    No periodization plan available for {profile.sport} / {profile.position} yet. Check back soon.
                  </div>
                );
                const currentPhase = plan.weeks.find(w=>w.week===wkWeek);
                return (
                  <div style={{marginBottom:"1.5rem"}}>
                    {/* Plan header */}
                    <div style={{background:"linear-gradient(135deg,rgba(191,161,106,0.1),rgba(191,161,106,0.03))",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"var(--r-lg)",padding:"1.25rem 1.5rem",marginBottom:"1rem"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"0.75rem"}}>
                        <div>
                          <div style={{fontSize:"0.68rem",letterSpacing:"3px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.3rem"}}>16-Week Periodization</div>
                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.5rem",fontWeight:600,color:"var(--ivory)"}}>{plan.label}</div>
                          <div style={{fontSize:"0.82rem",color:"var(--muted)",marginTop:"0.2rem",maxWidth:"480px"}}>{plan.description}</div>
                        </div>
                        <div style={{display:"flex",gap:"0.5rem",flexWrap:"wrap"}}>
                          {plan.phases.map(ph=>{
                            const isPhaseSelected = selectedPhase === ph.name;
                            return (
                              <button key={ph.name}
                                onClick={()=>{
                                  const newPhase = isPhaseSelected ? null : ph.name;
                                  setSelectedPhase(newPhase);
                                  // Auto-select the first week of the clicked phase
                                  if (newPhase) {
                                    const firstWk = plan.weeks.find(w=>
                                      newPhase.includes(w.phase) || w.phase===newPhase.split(" ")[0]
                                    );
                                    setSelectedPeriodWeek(firstWk?.week || null);
                                  } else {
                                    setSelectedPeriodWeek(null);
                                  }
                                }}
                                style={{
                                  background:isPhaseSelected?`${ph.color}22`:"rgba(255,255,255,0.04)",
                                  border:`1px solid ${isPhaseSelected?ph.color:"rgba(255,255,255,0.08)"}`,
                                  borderRadius:"var(--r)",padding:"0.5rem 0.85rem",
                                  textAlign:"center",cursor:"pointer",
                                  transition:"all 0.2s",fontFamily:"inherit",
                                  transform:isPhaseSelected?"translateY(-2px)":"none",
                                  boxShadow:isPhaseSelected?`0 4px 16px ${ph.color}33`:"none",
                                }}>
                                <div style={{fontSize:"1.1rem",marginBottom:"0.2rem"}}>{ph.icon}</div>
                                <div style={{fontSize:"0.68rem",color:isPhaseSelected?ph.color:"var(--muted)",marginBottom:"0.1rem",fontWeight:isPhaseSelected?600:400}}>Wks {ph.weeks}</div>
                                <div style={{fontSize:"0.74rem",color:ph.color,fontWeight:600}}>{ph.name.split(" ")[0]}</div>
                                {isPhaseSelected && (
                                  <div style={{fontSize:"0.6rem",color:ph.color,marginTop:"0.2rem",letterSpacing:"1px"}}>● ACTIVE</div>
                                )}
                              </button>
                            );
                          })}
                          {selectedPhase && (
                            <button onClick={()=>{setSelectedPhase(null);setSelectedPeriodWeek(null);}}
                              style={{background:"var(--smoke)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"0.5rem 0.75rem",cursor:"pointer",fontFamily:"inherit",color:"var(--muted)",fontSize:"0.72rem",alignSelf:"center"}}>
                              ✕ All weeks
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Week grid — filtered by selectedPhase if set */}
                    {selectedPhase && (
                      <div style={{fontSize:"0.74rem",color:"var(--muted)",marginBottom:"0.5rem",fontStyle:"italic"}}>
                        Showing {plan.phases.find(ph=>ph.name===selectedPhase)?.name} weeks only — click a week to see details
                      </div>
                    )}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:"0.3rem",marginBottom:"1rem"}}>
                      {plan.weeks.filter(w => !selectedPhase || w.phase === plan.phases.find(ph=>ph.name===selectedPhase)?.name.split(" ")[0] || plan.phases.find(ph=>ph.name===selectedPhase)?.name.includes(w.phase)).map(w=>{
                        const phase = plan.phases.find(ph=>ph.name.includes(w.phase));
                        const isActive = w.week === wkWeek;
                        const isSelected = selectedPeriodWeek === w.week;
                        return (
                          <button key={w.week} onClick={()=>setSelectedPeriodWeek(isSelected?null:w.week)}
                            style={{
                              background:isActive?"rgba(191,161,106,0.15)":isSelected?"rgba(191,161,106,0.08)":"var(--smoke)",
                              border:`1px solid ${isActive?"rgba(191,161,106,0.6)":isSelected?"rgba(255,255,255,0.09)":"var(--border)"}`,
                              borderRadius:"6px",padding:"0.4rem 0.2rem",cursor:"pointer",
                              transition:"all 0.15s",fontFamily:"inherit"
                            }}>
                            <div style={{fontSize:"0.6rem",color:phase?.color||"var(--muted)",fontWeight:600,marginBottom:"0.15rem"}}>
                              {w.phase.split("-")[0].substring(0,3).toUpperCase()}
                            </div>
                            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.1rem",color:isActive?"var(--gold)":"var(--ivory2)",fontWeight:600}}>{w.week}</div>
                            <div style={{fontSize:"0.58rem",color:"var(--muted)",marginTop:"0.1rem"}}>{w.sessions}×</div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Current week detail (auto-shown) */}
                    {(()=>{
                      const wk = plan.weeks.find(w=>w.week===(selectedPeriodWeek||wkWeek));
                      if (!wk) return null;
                      const phase = plan.phases.find(ph=>ph.name.includes(wk.phase));
                      return (
                        <div style={{background:"var(--slate)",border:`1px solid ${phase?.color||"var(--gold)"}33`,borderRadius:"var(--r-lg)",padding:"1.25rem",position:"relative",overflow:"hidden"}}>
                          <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:phase?.color||"var(--gold)"}}/>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1rem",flexWrap:"wrap",gap:"0.5rem"}}>
                            <div>
                              <div style={{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.3rem"}}>
                                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"2rem",fontWeight:600,color:phase?.color||"var(--gold)",lineHeight:1}}>Week {wk.week}</div>
                                {wk.week===wkWeek&&<div style={{fontSize:"0.68rem",background:"rgba(191,161,106,0.15)",color:"var(--gold)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"10px",padding:"2px 8px"}}>Current Week</div>}
                              </div>
                              <div style={{fontSize:"0.88rem",fontWeight:600,color:"var(--ivory)",marginBottom:"0.15rem"}}>{wk.focus}</div>
                              <div style={{fontSize:"0.74rem",color:"var(--muted)"}}>{wk.phase} Phase</div>
                            </div>
                            <div style={{display:"flex",gap:"1rem"}}>
                              {[["Intensity",wk.intensity],["Volume",wk.volume],["Sessions/wk",wk.sessions.toString()]].map(([l,v])=>(
                                <div key={l} style={{textAlign:"center"}}>
                                  <div style={{fontSize:"0.65rem",letterSpacing:"1.5px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.2rem"}}>{l}</div>
                                  <div style={{fontSize:"0.82rem",color:"var(--ivory2)",fontWeight:600}}>{v}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Key Lifts */}
                          <div style={{marginBottom:"1rem"}}>
                            <div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.5rem",fontWeight:600}}>Key Lifts This Week</div>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"0.4rem"}}>
                              {wk.keyLifts.map((lift,i)=>(
                                <div key={i} style={{display:"flex",alignItems:"center",gap:"0.5rem",background:"var(--smoke)",border:"1px solid var(--border)",borderRadius:"6px",padding:"0.45rem 0.6rem"}}>
                                  <div style={{width:"4px",height:"4px",borderRadius:"50%",background:phase?.color||"var(--gold)",flexShrink:0}}/>
                                  <div style={{fontSize:"0.82rem",color:"var(--ivory2)"}}>{lift}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Coach note */}
                          <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(191,161,106,0.22)",borderRadius:"var(--r)",padding:"0.75rem 0.9rem",display:"flex",gap:"0.6rem",alignItems:"flex-start"}}>
                            <div style={{fontSize:"0.9rem",flexShrink:0}}>✦</div>
                            <div style={{fontSize:"0.84rem",color:"var(--ivory2)",lineHeight:1.6,fontStyle:"italic"}}>{wk.notes}</div>
                          </div>

                          {/* Quick-apply to current week button */}
                          <div style={{display:"flex",gap:"0.5rem",marginTop:"0.75rem"}}>
                            <button className="bg" style={{flex:2,padding:"0.7rem"}}
                              onClick={()=>{
                                setWkWeek(wk.week);
                                // Map key lifts to a weekly focus note shown in workout header
                                shout(`Week ${wk.week}: ${wk.focus} — ${wk.sessions} sessions, ${wk.intensity}`,"📅");
                                setShowPeriodization(false);
                              }}>
                              {wk.week===wkWeek ? "✓ Apply This Week's Plan →" : `→ Jump to Week ${wk.week}`}
                            </button>
                            {wk.week!==wkWeek && (
                              <button className="bsm" style={{flex:1}}
                                onClick={()=>setSelectedPeriodWeek(selectedPeriodWeek===wk.week?null:wk.week)}>
                                {selectedPeriodWeek===wk.week?"↑ Collapse":"Compare"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* Flexible Weekly Schedule */}
              <div className="panel" style={{marginBottom:"1.25rem"}}>
                <div className="ph">
                  <div className="pt">Weekly <em>Schedule</em></div>
                  <button className="bsm" onClick={()=>setEditSchedule(e=>!e)}>{editSchedule?"✓ Done":"✏ Edit Schedule"}</button>
                </div>
                <div className="pb" style={{padding:"0.75rem 1rem"}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"0.4rem"}}>
                    {weekSchedule.map((day,di)=>(
                      <div key={day.day} style={{textAlign:"center"}}>
                        <div style={{fontSize:"0.72rem",fontWeight:600,color:"var(--gold)",marginBottom:"0.3rem"}}>{day.day}</div>
                        {editSchedule ? (
                          <div style={{background:"var(--smoke)",borderRadius:"var(--r)",padding:"0.4rem 0.3rem"}}>
                            <select style={{width:"100%",background:"transparent",border:"none",color:"var(--fg)",fontSize:"0.65rem",marginBottom:"0.3rem"}}
                              value={day.wkType} onChange={e=>setWeekSchedule(s=>s.map((d,i)=>i===di?{...d,wkType:e.target.value,active:!!e.target.value,label:""}:d))}>
                              <option value="">Rest</option>
                              {Object.keys(WORKOUTS).map(t=><option key={t} value={t}>{t}</option>)}
                            </select>
                            <select style={{width:"100%",background:"transparent",border:"none",color:"var(--muted)",fontSize:"0.65rem"}}
                              value={day.wkFocus} onChange={e=>setWeekSchedule(s=>s.map((d,i)=>i===di?{...d,wkFocus:e.target.value}:d))}>
                              {["Full Body","Upper Body","Lower Body"].map(f=><option key={f}>{f}</option>)}
                            </select>
                          </div>
                        ) : (
                          <div onClick={()=>{if(day.active){setWkType(day.wkType);setWkFocus(day.wkFocus);shout(`${day.day}: ${day.wkType} loaded`,"");}}}
                            style={{background:day.active?"rgba(191,161,106,0.08)":"var(--smoke)",border:`1px solid ${day.active?"rgba(191,161,106,0.25)":"var(--border)"}`,borderRadius:"var(--r)",padding:"0.4rem 0.3rem",cursor:day.active?"pointer":"default",minHeight:"52px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"0.2rem"}}>
                            {day.active ? (<>
                              <div style={{fontSize:"0.68rem",color:"var(--ivory2)",fontWeight:500,lineHeight:1.2,textAlign:"center"}}>{day.wkType.split(" ")[0]}</div>
                              <div style={{fontSize:"0.62rem",color:"var(--muted)"}}>{day.wkFocus}</div>
                            </>) : (
                              <div style={{fontSize:"0.68rem",color:"var(--muted)",fontStyle:"italic"}}>{day.label||"Rest"}</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {!editSchedule && <div style={{fontSize:"0.72rem",color:"var(--muted)",marginTop:"0.6rem",fontStyle:"italic"}}>Tap any day to load that session · Edit to customize your week</div>}
                </div>
              </div>

              {/* Progress Log */}
              {showLog && (
                <div className="panel" style={{marginBottom:"1.25rem"}}>
                  <div className="ph"><div className="pt">Progress <em>Log</em></div>
                    <button className="bsm" onClick={()=>setWkLog([])} style={{color:"var(--muted)"}}>Clear Log</button>
                  </div>
                  <div className="pb">
                    {wkLog.length === 0 ? (
                      <div style={{color:"var(--muted)",fontSize:"0.82rem",fontStyle:"italic"}}>No entries yet. Log your actual loads after each session below.</div>
                    ) : (
                      <div>
                        {[...new Set(wkLog.map(l=>l.wkType+"|"+l.wkFocus))].map(key=>{
                          const [t,f] = key.split("|");
                          const entries = wkLog.filter(l=>l.wkType===t&&l.wkFocus===f);
                          // Group by exercise + date to get one row per exercise per session
                          const exerciseMap = {};
                          entries.forEach(l=>{
                            const ek = `${l.exercise}|${l.date}|${l.week}`;
                            if(!exerciseMap[ek]) exerciseMap[ek] = {exercise:l.exercise, date:l.date, week:l.week, sets:[], totalVol:0};
                            exerciseMap[ek].sets.push(l.load);
                            exerciseMap[ek].totalVol += l.totalVol||0;
                          });
                          const rows = Object.values(exerciseMap);
                          return (
                            <div key={key} style={{marginBottom:"1rem"}}>
                              <div style={{fontSize:"0.74rem",color:"var(--gold)",fontWeight:600,marginBottom:"0.4rem",letterSpacing:"1px"}}>{t} — {f}</div>
                              <div style={{overflowX:"auto"}}>
                                <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.78rem"}}>
                                  <thead><tr>
                                    {["Week","Date","Exercise","Sets · Load","Volume"].map(h=>(
                                      <td key={h} style={{color:"var(--gold)",fontSize:"0.65rem",letterSpacing:"2px",textTransform:"uppercase",padding:"5px 8px",borderBottom:"1px solid rgba(191,161,106,0.2)"}}>{h}</td>
                                    ))}
                                  </tr></thead>
                                  <tbody>
                                    {rows.map((r,i)=>(
                                      <tr key={i} style={{borderBottom:"1px solid var(--border)"}}>
                                        <td style={{padding:"5px 8px",color:"var(--gold)",fontWeight:600}}>{r.week}</td>
                                        <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.72rem"}}>{r.date}</td>
                                        <td style={{padding:"5px 8px",color:"var(--fg)",fontWeight:500}}>{r.exercise}</td>
                                        <td style={{padding:"5px 8px",color:"var(--ivory2)"}}>
                                          <span style={{fontWeight:600}}>{r.sets.length} sets</span>
                                          <span style={{color:"var(--muted)",fontSize:"0.72rem",marginLeft:"0.4rem"}}>
                                            {/* Show distinct loads */}
                                            {[...new Set(r.sets)].slice(0,2).join(', ')}
                                            {[...new Set(r.sets)].length > 2 ? ` +${[...new Set(r.sets)].length-2} more` : ''}
                                          </span>
                                        </td>
                                        <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.72rem"}}>{r.totalVol>0?`${Math.round(r.totalVol).toLocaleString()} lbs`:"—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:"0.45rem",marginBottom:"0.75rem",flexWrap:"wrap"}}>
                {Object.keys(WORKOUTS).map(t=><button key={t} className={`bsm${wkType===t?" on":""}`} onClick={()=>setWkType(t)}>{t}</button>)}
              </div>
              <div style={{display:"flex",gap:"0.45rem",marginBottom:"1.25rem"}}>
                {["Full Body","Upper Body","Lower Body"].map(f=><button key={f} className={`bsm${wkFocus===f?" on":""}`} onClick={()=>setWkFocus(f)}>{f}</button>)}
              </div>
              <div className="two">
                <div>
                  <div className="panel" style={{marginBottom:"1.1rem"}}>
                    <div className="ph"><div className="pt">{wkFocus} <em>Session</em></div><span className="bdg bg-g">{wkType}</span></div>
                    <div className="pb">
                      {/* Sport/position header */}
                      {sportWorkout && (
                        <div style={{background:"var(--smoke)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"0.75rem 1rem",marginBottom:"1rem"}}>
                          <div style={{fontSize:"0.74rem",color:"var(--gold)",fontWeight:600,marginBottom:"0.2rem"}}>
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.65rem",fontWeight:700,letterSpacing:"1px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:"3px",padding:"1px 5px",marginRight:"0.3rem"}}>{sport.icon}</span> {sport.label} {profile.position ? `· ${profile.position}` : ""} — {wkType}
                          </div>
                          <div style={{fontSize:"0.72rem",color:"var(--muted)",fontStyle:"italic"}}>
                            Sport-specific program · {workout.length} exercises
                          </div>
                        </div>
                      )}
                      {workout.map((ex,i)=>(
                        <div key={i} style={{marginBottom:"0.85rem",padding:"0.9rem",background:"var(--slate)",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
                          {/* Exercise header */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.5rem"}}>
                            <div style={{fontWeight:600,fontSize:"0.9rem",color:"var(--fg)",flex:1}}>{i+1}. {ex.name}</div>
                            <div style={{display:"flex",gap:"0.4rem",flexShrink:0,marginLeft:"0.5rem"}}>
                              {ex.sets && <span style={{fontSize:"0.72rem",background:"rgba(191,161,106,0.15)",color:"var(--gold)",padding:"2px 8px",borderRadius:"4px",fontWeight:600}}>{ex.sets} sets</span>}
                              {ex.reps && <span style={{fontSize:"0.72rem",background:"rgba(58,107,155,0.2)",color:"#6B9FD4",padding:"2px 8px",borderRadius:"4px"}}>{ex.reps} reps</span>}
                            </div>
                          </div>
                          {/* Details row */}
                          <div style={{display:"flex",gap:"1rem",flexWrap:"wrap",marginBottom:"0.5rem"}}>
                            {ex.load && <div style={{fontSize:"0.72rem",color:"var(--muted)"}}><span style={{color:"var(--gold)"}}>⚖ Load:</span> {ex.load}</div>}
                            {ex.rest && <div style={{fontSize:"0.72rem",color:"var(--muted)"}}><span style={{color:"var(--gold)"}}>⏱ Rest:</span> {ex.rest}</div>}
                            {ex.muscles && <div style={{fontSize:"0.72rem",color:"var(--muted)"}}><span style={{color:"var(--gold)"}}> Muscles:</span> {ex.muscles}</div>}
                          </div>
                          {/* Coaching cue */}
                          {ex.cues && (
                            <div style={{fontSize:"0.74rem",color:"var(--ivory2)",fontStyle:"italic",lineHeight:1.55,borderLeft:"2px solid rgba(255,255,255,0.09)",paddingLeft:"0.65rem"}}>
                              "{ex.cues}"
                            </div>
                          )}
                          {/* Video demo link */}
                          {(()=>{
                            const libEx = EXERCISE_LIBRARY.find(e=>e.name.toLowerCase()===ex.name?.toLowerCase()||ex.name?.toLowerCase().includes(e.name.toLowerCase().split(' ').slice(0,2).join(' ')));
                            if(!libEx) return null;
                            return (
                              <button style={{marginTop:"0.4rem",background:"rgba(107,159,212,0.1)",border:"1px solid rgba(107,159,212,0.25)",borderRadius:"4px",padding:"3px 8px",fontSize:"0.68rem",color:"#6B9FD4",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:"0.3rem"}}
                                onClick={()=>{setExLibSelected(libEx);setShowExLib(true);}}>
                                ▶ Watch Demo
                              </button>
                            );
                          })()}
                          {/* Prior logged loads for this exercise */}
                          {(() => {
                            const prior = wkLog.filter(l=>l.exercise===ex.name&&l.wkType===wkType&&l.wkFocus===wkFocus).slice(-4);
                            if(!prior.length) return null;
                            return (
                              <div style={{marginTop:"0.5rem",display:"flex",gap:"0.4rem",flexWrap:"wrap",alignItems:"center"}}>
                                <span style={{fontSize:"0.68rem",color:"var(--muted)"}}>History:</span>
                                {prior.map((l,pi)=>(
                                  <span key={pi} style={{fontSize:"0.72rem",background:"rgba(75,174,113,0.12)",color:"#4BAE71",padding:"1px 7px",borderRadius:"3px",border:"1px solid rgba(75,174,113,0.2)"}}>
                                    {l.week}: {l.load}
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* ── SESSION LOGGER ─────────────────────────────── */}
                  {(()=>{
                    const restSecsLeft = restTimer ? Math.max(0, Math.ceil((restTimer.endTime - Date.now()) / 1000)) : 0;
                    const restPct = restTimer ? (restSecsLeft / restTimer.duration) * 100 : 0;

                    // PR check — all-time best load for an exercise
                    const allTimeBest = (exName) => {
                      const all = wkLog.filter(l=>l.exercise===exName&&parseFloat(l.load));
                      return all.length ? Math.max(...all.map(l=>parseFloat(l.load))) : 0;
                    };

                    // Total session volume
                    const sessionVolume = sessionLog.reduce((s,ex)=>
                      s + ex.sets.filter(st=>st.done).reduce((sv,st)=>sv+(parseFloat(st.load)||0)*(parseFloat(st.reps)||0),0), 0);

                    const startEx = (ex) => {
                      const best = allTimeBest(ex.name);
                      const suggestedLoad = best ? `${best}` : ex.load?.match(/\d+/)?.[0] || "";
                      setActiveSession({
                        exercise: ex,
                        sets: Array.from({length: parseInt(ex.sets)||3}, (_,i)=>({
                          setNum: i+1, load: suggestedLoad, reps: ex.reps?.match(/\d+/)?.[0]||"", rpe:"", done:false
                        }))
                      });
                    };

                    const finishSet = (setIdx) => {
                      setActiveSession(prev=>{
                        const updated = {...prev, sets: prev.sets.map((s,i)=>i===setIdx?{...s,done:true}:s)};
                        return updated;
                      });
                      // Start rest timer
                      const restSecs = parseInt(activeSession?.exercise?.rest?.match(/\d+/)?.[0]||"90");
                      const duration = restSecs <= 2 ? restSecs * 60 : restSecs;
                      setRestTimer({endTime: Date.now() + duration*1000, duration});
                    };

                    const completeExercise = () => {
                      if (!activeSession) return;
                      const doneSets = activeSession.sets.filter(s=>s.done);
                      if (!doneSets.length) { shout("Complete at least one set","!"); return; }
                      const best = allTimeBest(activeSession.exercise.name);
                      const maxLoad = Math.max(...doneSets.map(s=>parseFloat(s.load)||0));
                      const isPR = maxLoad > 0 && maxLoad > best;
                      const vol = doneSets.reduce((s,st)=>s+(parseFloat(st.load)||0)*(parseFloat(st.reps)||0),0);
                      const completed = {name:activeSession.exercise.name, sets:activeSession.sets, totalVol:vol, isPR};
                      setSessionLog(prev=>[...prev, completed]);
                      // Save to wkLog
                      const date = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
                      const entries = doneSets.map(s=>({
                        week:`Wk ${wkWeek}`, date, exercise:activeSession.exercise.name,
                        load:`${s.load}lbs × ${s.reps} reps`, rpe:s.rpe||"", notes:"",
                        wkType, wkFocus, sets:doneSets.length, totalVol:vol
                      }));
                      setWkLog(prev=>[...prev,...entries]);
                      if(authUser?.id) saveWorkoutLog(authUser.id, entries.map(e=>({...e,wk_type:e.wkType,wk_focus:e.wkFocus}))).catch(()=>{});
                      setActiveSession(null);
                      setRestTimer(null);
                      if (isPR) shout(`◆ NEW PR — ${maxLoad}lbs on ${activeSession.exercise.name}!`,"◆");
                      else shout(`${activeSession.exercise.name} logged`,"");
                    };

                    return (
                      <div style={{margin:"0.75rem 0"}}>
                        {/* Rest timer banner */}
                        {restTimer && (
                          <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"var(--r)",padding:"0.75rem 1rem",marginBottom:"0.75rem"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.4rem"}}>
                              <div style={{fontSize:"0.76rem",color:"var(--gold)",fontWeight:600}}>⏱ Rest Timer</div>
                              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.8rem",fontWeight:600,color:restSecsLeft<=10?"#C0695E":"var(--gold)",lineHeight:1}}>{Math.floor(restSecsLeft/60)}:{String(restSecsLeft%60).padStart(2,"0")}</div>
                              <button className="bsm" style={{fontSize:"0.72rem"}} onClick={()=>setRestTimer(null)}>Skip</button>
                            </div>
                            <div style={{height:"4px",background:"rgba(255,255,255,0.08)",borderRadius:"2px"}}>
                              <div style={{width:`${restPct}%`,height:"100%",background:restSecsLeft<=10?"#C0695E":"var(--gold)",borderRadius:"2px",transition:"width 1s linear"}}/>
                            </div>
                          </div>
                        )}

                        {/* Active exercise logger */}
                        {activeSession ? (
                          <div style={{background:"var(--slate)",border:"1px solid rgba(191,161,106,0.25)",borderRadius:"var(--r)",padding:"1rem"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.85rem"}}>
                              <div>
                                <div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.2rem"}}>Logging</div>
                                <div style={{fontSize:"0.92rem",fontWeight:600,color:"var(--ivory)"}}>{activeSession.exercise.name}</div>
                                <div style={{fontSize:"0.72rem",color:"var(--muted)",marginTop:"0.15rem"}}>
                                  Target: {activeSession.exercise.sets} sets × {activeSession.exercise.reps} · {activeSession.exercise.rest} rest
                                </div>
                              </div>
                              {allTimeBest(activeSession.exercise.name) > 0 && (
                                <div style={{textAlign:"right"}}>
                                  <div style={{fontSize:"0.68rem",color:"var(--muted)"}}>All-time best</div>
                                  <div style={{fontSize:"1rem",fontWeight:700,color:"#4BAE71"}}>{allTimeBest(activeSession.exercise.name)} lbs</div>
                                </div>
                              )}
                            </div>

                            {/* Set rows */}
                            <div style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr 80px auto",gap:"0.4rem",alignItems:"center",marginBottom:"0.6rem"}}>
                              <div style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px"}}>SET</div>
                              <div style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px"}}>WEIGHT (lbs)</div>
                              <div style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px"}}>REPS</div>
                              <div style={{fontSize:"0.68rem",color:"var(--muted)",letterSpacing:"1px"}}>RPE</div>
                              <div/>
                            </div>
                            {activeSession.sets.map((s,i)=>(
                              <div key={i} style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr 80px auto",gap:"0.4rem",alignItems:"center",marginBottom:"0.4rem",opacity:s.done?0.5:1}}>
                                <div style={{width:"28px",height:"28px",borderRadius:"50%",background:s.done?"#4BAE71":"rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.76rem",fontWeight:700,color:s.done?"#0E0D0B":"var(--muted)",flexShrink:0}}>{s.setNum}</div>
                                <input type="number" className="fi" placeholder="lbs" style={{fontSize:"0.84rem",padding:"0.35rem 0.5rem",textAlign:"center"}}
                                  value={s.load} disabled={s.done}
                                  onChange={e=>setActiveSession(p=>({...p,sets:p.sets.map((st,j)=>j===i?{...st,load:e.target.value}:st)}))}/>
                                <input type="number" className="fi" placeholder="reps" style={{fontSize:"0.84rem",padding:"0.35rem 0.5rem",textAlign:"center"}}
                                  value={s.reps} disabled={s.done}
                                  onChange={e=>setActiveSession(p=>({...p,sets:p.sets.map((st,j)=>j===i?{...st,reps:e.target.value}:st)}))}/>
                                <select className="fi" style={{fontSize:"0.82rem",padding:"0.3rem"}} value={s.rpe} disabled={s.done}
                                  onChange={e=>setActiveSession(p=>({...p,sets:p.sets.map((st,j)=>j===i?{...st,rpe:e.target.value}:st)}))}>
                                  <option value="">RPE</option>
                                  {[6,7,7.5,8,8.5,9,9.5,10].map(r=><option key={r} value={r}>{r}</option>)}
                                </select>
                                {!s.done ? (
                                  <button className="bg" style={{padding:"0.3rem 0.6rem",fontSize:"0.76rem",flexShrink:0}} onClick={()=>finishSet(i)}>✓</button>
                                ) : (
                                  <div style={{fontSize:"0.76rem",color:"#4BAE71",textAlign:"center"}}>✓</div>
                                )}
                              </div>
                            ))}

                            {/* PR indicator */}
                            {(()=>{
                              const best = allTimeBest(activeSession.exercise.name);
                              const currentMax = Math.max(...activeSession.sets.filter(s=>s.done&&s.load).map(s=>parseFloat(s.load)||0),0);
                              if (best>0 && currentMax>0 && currentMax>best) return (
                                <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"var(--r)",padding:"0.5rem 0.75rem",marginBottom:"0.6rem",fontSize:"0.8rem",color:"var(--gold)",fontWeight:600,textAlign:"center"}}>
                                  ◆ NEW PERSONAL RECORD — {currentMax}lbs beats previous best of {best}lbs!
                                </div>
                              );
                              return null;
                            })()}

                            <div style={{display:"flex",gap:"0.5rem"}}>
                              <button className="bg" style={{flex:1,padding:"0.6rem",fontSize:"0.82rem"}} onClick={completeExercise}>✓ Complete Exercise</button>
                              <button className="bsm" style={{padding:"0.6rem 0.75rem",fontSize:"0.78rem"}} onClick={()=>{setActiveSession(null);setRestTimer(null);}}>✕ Cancel</button>
                              <button className="bsm" style={{padding:"0.6rem 0.75rem",fontSize:"0.78rem"}} onClick={()=>{
                                setActiveSession(p=>({...p,sets:[...p.sets,{setNum:p.sets.length+1,load:p.sets[p.sets.length-1]?.load||"",reps:p.sets[p.sets.length-1]?.reps||"",rpe:"",done:false}]}));
                              }}>+ Set</button>
                            </div>
                          </div>
                        ) : (
                          /* Exercise picker */
                          <div style={{background:"var(--slate)",border:"1px solid rgba(191,161,106,0.15)",borderRadius:"var(--r)",padding:"1rem"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.75rem"}}>
                              <div style={{fontSize:"0.74rem",color:"var(--gold)",fontWeight:600,letterSpacing:"1px"}}>
                                SESSION LOGGER — Week {wkWeek}
                              </div>
                              {sessionLog.length>0 && (
                                <div style={{fontSize:"0.72rem",color:"var(--muted)"}}>
                                  {sessionLog.length} logged · {Math.round(sessionVolume).toLocaleString()} lbs vol
                                </div>
                              )}
                            </div>

                            {/* Logged this session */}
                            {sessionLog.length>0 && (
                              <div style={{marginBottom:"0.75rem",display:"flex",flexDirection:"column",gap:"0.25rem"}}>
                                {sessionLog.map((ex,i)=>(
                                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.35rem 0.6rem",background:ex.isPR?"rgba(191,161,106,0.1)":"rgba(75,174,113,0.07)",border:`1px solid ${ex.isPR?"rgba(191,161,106,0.25)":"rgba(75,174,113,0.15)"}`,borderRadius:"4px",fontSize:"0.76rem"}}>
                                    <span style={{color:ex.isPR?"var(--gold)":"var(--ivory2)",fontWeight:ex.isPR?600:400}}>{ex.isPR?"◆ ":""}{ex.name}</span>
                                    <span style={{color:"var(--muted)"}}>{ex.sets.filter(s=>s.done).length} sets · {Math.round(ex.totalVol)} lbs</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Exercise buttons */}
                            <div style={{fontSize:"0.72rem",color:"var(--muted)",marginBottom:"0.4rem"}}>Tap an exercise to start logging:</div>
                            <div style={{display:"flex",flexDirection:"column",gap:"0.3rem",maxHeight:"200px",overflowY:"auto"}}>
                              {workout.filter(ex=>ex.name&&!ex.name.includes("Collagen")&&!ex.name.includes("Note")).map((ex,i)=>{
                                const alreadyDone = sessionLog.some(s=>s.name===ex.name);
                                return (
                                  <button key={i} style={{
                                    display:"flex",justifyContent:"space-between",alignItems:"center",
                                    padding:"0.5rem 0.75rem",borderRadius:"4px",cursor:"pointer",
                                    background:alreadyDone?"rgba(75,174,113,0.08)":"rgba(8,7,5,0.5)",
                                    border:`1px solid ${alreadyDone?"rgba(75,174,113,0.2)":"rgba(255,255,255,0.06)"}`,
                                    color:alreadyDone?"#4BAE71":"var(--ivory2)",fontSize:"0.8rem",textAlign:"left",
                                  }} onClick={()=>!alreadyDone&&startEx(ex)}>
                                    <span>{alreadyDone?"✓ ":""}{ex.name}</span>
                                    <span style={{color:"var(--muted)",fontSize:"0.72rem",flexShrink:0,marginLeft:"0.5rem"}}>{ex.sets}×{ex.reps}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Finish session */}
                            {sessionLog.length>0 && (
                              <button className="bg" style={{width:"100%",padding:"0.7rem",marginTop:"0.75rem",fontSize:"0.84rem",fontWeight:600}} onClick={()=>{
                                setShowSessionSummary(true);
                                shout(`Session saved — ${sessionLog.length} exercises, ${Math.round(sessionVolume).toLocaleString()} lbs total volume`,"");
                              }}>🏁 Finish Session</button>
                            )}
                          </div>
                        )}

                        {/* Session Summary Modal */}
                        {showSessionSummary && (
                          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
                            <div style={{background:"var(--charcoal)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:"16px",padding:"1.5rem",maxWidth:"460px",width:"100%",maxHeight:"80vh",overflowY:"auto"}}>
                              <div style={{textAlign:"center",marginBottom:"1.25rem"}}>
                                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.8rem",fontWeight:600,color:"var(--gold)"}}>Session Complete</div>
                                <div style={{fontSize:"0.8rem",color:"var(--muted)",marginTop:"0.2rem"}}>{wkType} · {wkFocus} · Week {wkWeek}</div>
                              </div>
                              {/* Stats */}
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.75rem",marginBottom:"1.25rem"}}>
                                {[
                                  ["Exercises",sessionLog.length,""],
                                  ["Total Sets",sessionLog.reduce((s,ex)=>s+ex.sets.filter(st=>st.done).length,0),""],
                                  ["Total Volume",`${Math.round(sessionVolume).toLocaleString()}`,"lbs"],
                                ].map(([l,v,u])=>(
                                  <div key={l} style={{background:"rgba(255,255,255,0.03)",borderRadius:"var(--r)",padding:"0.75rem",textAlign:"center"}}>
                                    <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.5rem",color:"var(--gold)",fontWeight:600}}>{v}</div>
                                    <div style={{fontSize:"0.68rem",color:"var(--muted)"}}>{l}{u?` (${u})`:""}</div>
                                  </div>
                                ))}
                              </div>
                              {/* PRs */}
                              {sessionLog.filter(ex=>ex.isPR).length>0 && (
                                <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(191,161,106,0.25)",borderRadius:"var(--r)",padding:"0.75rem 1rem",marginBottom:"1rem"}}>
                                  <div style={{fontSize:"0.72rem",letterSpacing:"2px",color:"var(--gold)",fontWeight:600,marginBottom:"0.5rem"}}>◆ NEW PERSONAL RECORDS</div>
                                  {sessionLog.filter(ex=>ex.isPR).map((ex,i)=>(
                                    <div key={i} style={{fontSize:"0.82rem",color:"var(--ivory2)",marginBottom:"0.2rem"}}>
                                      {ex.name} — {Math.max(...ex.sets.map(s=>parseFloat(s.load)||0))} lbs
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Exercise breakdown */}
                              {sessionLog.map((ex,i)=>(
                                <div key={i} style={{marginBottom:"0.6rem",paddingBottom:"0.6rem",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                                  <div style={{fontSize:"0.82rem",fontWeight:600,color:ex.isPR?"var(--gold)":"var(--ivory2)",marginBottom:"0.3rem"}}>{ex.isPR?"◆ ":""}{ex.name}</div>
                                  <div style={{display:"flex",gap:"0.5rem",flexWrap:"wrap"}}>
                                    {ex.sets.filter(s=>s.done).map((s,j)=>(
                                      <span key={j} style={{fontSize:"0.72rem",background:"rgba(75,174,113,0.1)",color:"#4BAE71",padding:"2px 8px",borderRadius:"3px"}}>
                                        {s.load}×{s.reps}{s.rpe?` @${s.rpe}`:""}</span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                              <button className="bg" style={{width:"100%",padding:"0.75rem"}} onClick={()=>{setShowSessionSummary(false);setSessionLog([]);}}>Done</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div style={{display:"flex",gap:"0.7rem"}}>
                    <button className="bg" style={{flex:1,padding:"0.72rem"}} onClick={handleDownloadWorkout}>⬇ PDF</button>
                    <button className="bgh" style={{flex:1,padding:"0.72rem"}} onClick={()=>setEmailModal({type:"workout",label:"Workout Plan",data:{wkType,wkFocus,exercises:workout,sport:profile.sport,position:profile.position,weekNum:wkWeek}})}>✉ Email</button>
                    <button className="bgh" style={{padding:"0.72rem 1rem"}} onClick={()=>{
                      const win=window.open("","_blank");
                      const rows=workout.map((ex,i)=>`<tr style="border-bottom:1px solid #eee"><td style="padding:8px;font-weight:bold;color:#1a1a1a">${i+1}. ${ex.name||ex}</td><td style="padding:8px;color:#BFA16A">${ex.sets||"—"}×${ex.reps||"—"}</td><td style="padding:8px;color:#555">${ex.load||"—"}</td><td style="padding:8px;color:#888;font-style:italic;font-size:0.85em">${ex.cues||""}</td></tr>`).join("");
                      win.document.write(`<!DOCTYPE html><html><head><title>Workout Plan</title><style>body{font-family:Georgia,serif;max-width:750px;margin:30px auto;color:#1a1a1a}h1{border-bottom:2px solid #BFA16A;padding-bottom:8px}table{width:100%;border-collapse:collapse}th{background:#1a1a1a;color:#BFA16A;padding:8px;text-align:left;font-size:0.8em;letter-spacing:2px}</style></head><body><h1>Workout Plan — ${sanitizeHtml(wkType)} · ${sanitizeHtml(wkFocus)}</h1><p style="color:#888">Week ${wkWeek} · ${sanitizeHtml(profile.name||"—")} · ${sanitizeHtml(sport.label)} ${profile.position?"· "+sanitizeHtml(profile.position):""}</p><table><thead><tr><th>Exercise</th><th>Sets×Reps</th><th>Load</th><th>Coaching Cue</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
                      win.document.close();win.print();
                    }}>↓ Print</button>
                  </div>
                </div>
                <div>
                  <div className="panel" style={{marginBottom:"1.1rem"}}>
                    <div className="ph"><div className="pt">Performance <em>Metrics</em></div></div>
                    <div className="pb">
                      {[
                        ["Strength",       78, "#C9A84C"],
                        ["Endurance",      65, "#6AABCC"],
                        ["Speed & Agility",82, "#4ECDC4"],
                        ["Recovery Rate",  71, "#4BAE71"],
                        ["Flexibility",    58, "#9B8EC4"],
                      ].map(([l,v,c])=>(
                        <div key={l} className="mr2">
                          <div className="mh"><span className="mn">{l}</span><span className="mv" style={{color:c}}>{v}%</span></div>
                          <div className="mt"><div className="mf" style={{width:`${v}%`,background:c}}/></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="panel">
                    <div className="ph"><div className="pt">Weekly <em>Schedule</em></div></div>
                    <div className="pb">
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((d,i)=>(
                        <div key={d} style={{display:"flex",justifyContent:"space-between",padding:"0.58rem 0",borderBottom:"1px solid var(--border)",fontSize:"0.9rem"}}>
                          <span style={{color:"var(--ivory2)",fontWeight:300}}>{d}</span>
                          <span className={`bdg ${[0,2,4].includes(i)?"bg-g":[6].includes(i)?"bg-green":"bg-red"}`}>
                            {[0,2,4].includes(i)?"Training":[6].includes(i)?"Active Rest":"Rest Day"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* INJURY */}
          {dash==="injury" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"1.5rem"}}>
                <div><div className="eyebrow">Rehabilitation</div><h2 className="sh2">Injury <em>Recovery</em></h2></div>
              </div>

              {/* Medical Disclaimer */}
              <div style={{
                background:"linear-gradient(135deg,rgba(191,161,106,0.05),rgba(58,107,155,0.05))",
                border:"1px solid rgba(191,161,106,0.25)",
                borderLeft:"3px solid var(--gold)",
                borderRadius:"var(--r)",
                padding:"1rem 1.25rem",
                marginBottom:"1.75rem",
                display:"flex",
                gap:"0.85rem",
                alignItems:"flex-start"
              }}>
                <span style={{fontSize:"1.3rem",flexShrink:0,marginTop:"0.1rem"}}>⚕</span>
                <div>
                  <div style={{fontSize:"0.76rem",fontWeight:700,letterSpacing:"2px",textTransform:"uppercase",color:"var(--gold)",marginBottom:"0.4rem"}}>
                    Medical Disclaimer
                  </div>
                  <div style={{fontSize:"0.88rem",color:"var(--ivory2)",lineHeight:1.7}}>
                    The injury protocols and recovery recommendations provided in this app are for <strong style={{color:"var(--ivory)"}}>informational and educational purposes only</strong> and are not a substitute for professional medical advice, diagnosis, or treatment.
                  </div>
                  <div style={{fontSize:"0.86rem",color:"var(--muted)",lineHeight:1.7,marginTop:"0.45rem"}}>
                    Always consult a <strong style={{color:"var(--ivory2)"}}>licensed physician, sports medicine doctor, or certified physical therapist</strong> before beginning any rehabilitation program. Individual injuries vary in severity — your healthcare provider should evaluate and supervise your specific recovery plan in conjunction with the guidance shown here.
                  </div>
                  <div style={{display:"flex",gap:"1rem",marginTop:"0.65rem",flexWrap:"wrap"}}>
                    {["🏥 Consult your physician","🩺 Work with a licensed PT","! Seek emergency care for severe symptoms"].map(t=>(
                      <span key={t} style={{fontSize:"0.76rem",color:"var(--gold)",background:"rgba(255,255,255,0.04)",padding:"3px 10px",borderRadius:"20px",border:"1px solid rgba(191,161,106,0.18)"}}>{t}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="two">
                <div>
                  <div className="panel" style={{marginBottom:"1.1rem"}}>
                    <div className="ph">
                      <div className="pt">{sport.label} <em>Injuries</em></div>
                      {profile.position && POSITION_INJURY_RISK[profile.sport]?.[profile.position] && (
                        <span style={{fontSize:"0.72rem",color:"#C0695E",letterSpacing:"1px"}}>
                          ! {POSITION_INJURY_RISK[profile.sport]?.[profile.position]?.high?.length} high-risk for {profile.position}
                        </span>
                      )}
                    </div>
                    <div className="pb">
                      {profile.position && POSITION_INJURY_RISK[profile.sport]?.[profile.position] && (
                        <div style={{fontSize:"0.78rem",color:"var(--muted)",marginBottom:"0.6rem"}}>
                          <span style={{color:"#C0695E",fontWeight:600}}>!</span> Injuries common at your position have a red border warning. <em>Tap any injury to view its full protocol.</em>
                        </div>
                      )}
                      {(() => {
                        const riskData = POSITION_INJURY_RISK[profile.sport]?.[profile.position];
                        const highRisk = riskData?.high || [];
                        const allInjuries = sport.injuries;
                        const sorted = [...new Set([...highRisk.filter(h=>allInjuries.includes(h)), ...allInjuries])];
                        return sorted.map(inj=>(
                          <span key={inj} className={`inj-tag${selInj.includes(inj)?" s":""}`}
                            onClick={()=>setSelInj(s=>s.includes(inj)?s.filter(i=>i!==inj):[...s,inj])}
                            style={highRisk.includes(inj)?{borderColor:"rgba(192,105,94,0.35)"}:{}} >
                            {highRisk.includes(inj)&&<span style={{color:"#C0695E",marginRight:"3px",fontSize:"0.68rem"}}>!</span>}
                            {inj}
                          </span>
                        ));
                      })()}
                    </div>
                  </div>
                  {selInj.length > 0 && selInj.map(injuryName => {
                    const proto = INJURY_PROTOCOLS[injuryName];
                    const posNote = proto?.positionNotes?.[profile.position];
                    const phases = proto?.phases || [
                      {ph:"Phase 1 — Acute",d:"Days 1–7",c:"#3A6B9B",items:["RICE Protocol","Anti-inflammatory nutrition","Gentle ROM exercises","Pain management","Sleep optimization 9–10hrs"]},
                      {ph:"Phase 2 — Sub-Acute",d:"Weeks 2–4",c:"#9B8A3A",items:["Progressive range of motion","Isometric strengthening","Proprioception training","Aquatic therapy","Collagen protocol"]},
                      {ph:"Phase 3 — Return to Play",d:"Weeks 5–8",c:"#3A9B5A",items:["Sport-specific movement","Progressive loading","Neuromuscular re-education","Full clearance protocol"]},
                    ];
                    return (
                      <div key={injuryName} className="panel" style={{marginBottom:"1.1rem"}}>
                        <div className="ph">
                          <div>
                            <div className="pt">{injuryName} <em>Protocol</em></div>
                            {proto && <div style={{fontSize:"0.74rem",color:"var(--muted)",marginTop:"0.2rem"}}>{proto.fullName}</div>}
                          </div>
                          {proto?.severity && <span style={{fontSize:"0.72rem",color:"#C0695E",border:"1px solid rgba(192,105,94,0.3)",padding:"2px 8px",borderRadius:"4px",flexShrink:0}}>{proto.severity}</span>}
                        </div>
                        <div className="pb">
                          {/* Surgery note */}
                          {proto?.surgeryRequired && (
                            <div style={{background:"rgba(192,105,94,0.08)",border:"1px solid rgba(192,105,94,0.2)",borderRadius:"var(--r)",padding:"0.6rem 0.85rem",marginBottom:"0.85rem",fontSize:"0.82rem",color:"var(--ivory2)"}}>
                              <span style={{color:"#C0695E",fontWeight:600}}>⚕ Surgery: </span>{proto.surgeryRequired}
                            </div>
                          )}
                          {/* Position-specific note */}
                          {posNote && (
                            <div style={{background:"rgba(191,161,106,0.07)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"var(--r)",padding:"0.6rem 0.85rem",marginBottom:"0.85rem"}}>
                              <div style={{fontSize:"0.72rem",color:"var(--gold)",fontWeight:600,marginBottom:"0.2rem"}}><span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.65rem",fontWeight:700,letterSpacing:"1px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:"3px",padding:"1px 5px",marginRight:"0.3rem"}}>{sport.icon}</span> {profile.position} — Position-Specific Note</div>
                              <div style={{fontSize:"0.84rem",color:"var(--ivory2)",fontStyle:"italic",lineHeight:1.6}}>{posNote}</div>
                            </div>
                          )}
                          {/* Rehab phases */}
                          {phases.map(ph=>(
                            <div key={ph.ph} className="mg">
                              <div className="mg-lbl" style={{color:ph.c||"#3A6B9B"}}>{ph.ph} <span style={{color:"var(--muted)",fontWeight:300}}>— {ph.d}</span></div>
                              {ph.items.map(it=><div key={it} className="mr"><div className="md"/><span style={{fontSize:"0.84rem",lineHeight:1.6}}>{it}</span></div>)}
                            </div>
                          ))}
                          {/* Nutrition for this injury */}
                          {proto?.nutrition && (
                            <div style={{marginTop:"0.85rem",paddingTop:"0.85rem",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                              <div style={{fontSize:"0.72rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.5rem"}}>🥗 Injury-Specific Nutrition</div>
                              <div style={{marginBottom:"0.5rem"}}>
                                <div style={{fontSize:"0.72rem",color:"var(--gold)",marginBottom:"0.3rem"}}>Acute Phase:</div>
                                {proto.nutrition.acute.map(n=><div key={n} className="mr"><div className="md"/><span style={{fontSize:"0.82rem"}}>{n}</span></div>)}
                              </div>
                              <div>
                                <div style={{fontSize:"0.72rem",color:"#4BAE71",marginBottom:"0.3rem"}}>Recovery Phase:</div>
                                {proto.nutrition.recovery.map(n=><div key={n} className="mr"><div className="md"/><span style={{fontSize:"0.82rem"}}>{n}</span></div>)}
                              </div>
                            </div>
                          )}
                          <div className="gr"/>
                          <div style={{display:"flex",gap:"0.7rem"}}>
                            <button className="bg" style={{flex:1,padding:"0.72rem"}} onClick={handleDownloadInjury}>⬇ Download</button>
                            <button className="bgh" style={{flex:1,padding:"0.72rem"}} onClick={handleEmailInjury}>✉ Email</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="panel">
                  <div className="ph"><div className="pt">Recovery <em>Supplementation</em></div>
                    <button className="bsm" style={{fontSize:"0.7rem"}} onClick={()=>{goTo("progress");setProgressTab("supplements");}}>
                      Full Stack →
                    </button>
                  </div>
                  <div className="pb">
                    {/* Injury-specific supplements — shown when injury is selected */}
                    {selInj.length > 0 && selInj.some(inj=>INJURY_PROTOCOLS[inj]?.nutrition) && (
                      <div style={{marginBottom:"1rem"}}>
                        <div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"#C0695E",textTransform:"uppercase",fontWeight:600,marginBottom:"0.5rem"}}>⚕ Active Injury Protocols</div>
                        {selInj.filter(inj=>INJURY_PROTOCOLS[inj]?.nutrition).map(injuryName=>{
                          const proto = INJURY_PROTOCOLS[injuryName];
                          return (
                            <div key={injuryName} style={{marginBottom:"0.75rem",padding:"0.65rem 0.85rem",background:"rgba(192,105,94,0.06)",border:"1px solid rgba(192,105,94,0.2)",borderRadius:"var(--r)"}}>
                              <div style={{fontSize:"0.76rem",fontWeight:600,color:"#C0695E",marginBottom:"0.4rem"}}>{injuryName}</div>
                              <div style={{fontSize:"0.68rem",color:"#F0C040",marginBottom:"0.25rem",textTransform:"uppercase",letterSpacing:"1px"}}>Acute phase:</div>
                              {proto.nutrition.acute.map(n=>(
                                <div key={n} style={{display:"flex",gap:"0.4rem",fontSize:"0.78rem",color:"var(--ivory2)",marginBottom:"0.2rem"}}>
                                  <span style={{color:"#C0695E",flexShrink:0}}>•</span><span>{n}</span>
                                </div>
                              ))}
                              <div style={{fontSize:"0.68rem",color:"#4BAE71",margin:"0.35rem 0 0.25rem",textTransform:"uppercase",letterSpacing:"1px"}}>Recovery phase:</div>
                              {proto.nutrition.recovery.map(n=>(
                                <div key={n} style={{display:"flex",gap:"0.4rem",fontSize:"0.78rem",color:"var(--ivory2)",marginBottom:"0.2rem"}}>
                                  <span style={{color:"#4BAE71",flexShrink:0}}>•</span><span>{n}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Sport/position supplement stack — top 6 most relevant */}
                    {(()=>{
                      const stack = getSupplementStack(profile.sport||"football", profile.position||"");
                      const recoverySupps = stack.filter(s=>s.category==="recovery" || s.category==="foundation");
                      const perfSupps = stack.filter(s=>s.category==="performance").slice(0,2);
                      const displaySupps = [...recoverySupps, ...perfSupps].slice(0,6);
                      return (
                        <div style={{marginBottom:"0.75rem"}}>
                          <div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",fontWeight:600,marginBottom:"0.5rem"}}>
                            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.65rem",fontWeight:700,letterSpacing:"1px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:"3px",padding:"1px 5px",marginRight:"0.3rem"}}>{sport.icon}</span> {profile.position||sport.label} Supplement Stack
                          </div>
                          {displaySupps.map((s,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"0.4rem 0",borderBottom:"1px solid var(--border)"}}>
                              <div style={{display:"flex",gap:"0.5rem",alignItems:"flex-start",flex:1}}>
                                <span style={{flexShrink:0}}></span>
                                <div>
                                  <div style={{fontSize:"0.8rem",color:"var(--ivory2)",fontWeight:500}}>{s.name}</div>
                                  <div style={{fontSize:"0.7rem",color:"var(--muted)"}}>{s.timing}</div>
                                </div>
                              </div>
                              <div style={{fontSize:"0.76rem",color:"var(--gold)",fontWeight:600,flexShrink:0,marginLeft:"0.5rem",textAlign:"right"}}>{s.dose}</div>
                            </div>
                          ))}
                          <button className="bsm" style={{width:"100%",marginTop:"0.6rem",fontSize:"0.74rem",padding:"0.4rem"}}
                            onClick={()=>{goTo("progress");setProgressTab("supplements");}}>
                            View full {stack.length}-supplement stack →
                          </button>
                        </div>
                      );
                    })()}

                    <div className="mg"><div className="mg-lbl"> Anti-Inflammatory Foods</div>
                      {["Wild-caught Salmon (omega-3)","Tart Cherry Juice","Turmeric Golden Milk","Leafy Greens & Berries","Pineapple (bromelain)"].map(it=><div key={it} className="mr"><div className="md"/>{it}</div>)}
                    </div>
                    <div className="mg"><div className="mg-lbl">😴 Recovery Protocols</div>
                      {["Sleep 9–10 hrs nightly","Cold water immersion 10min","Compression therapy","Foam rolling & mobility","Breathwork & meditation"].map(it=><div key={it} className="mr"><div className="md"/>{it}</div>)}
                    </div>
                    <div style={{display:"flex",gap:"0.7rem"}}>
                      <button className="bgh" style={{flex:1,padding:"0.68rem"}} onClick={()=>setEmailModal({type:"recovery",label:"Recovery Nutrition Guide",data:{}})}>✉ Email</button>
                      <button className="bgh" style={{flex:1,padding:"0.68rem"}} onClick={()=>{
                        const stack = getSupplementStack(profile.sport||"football", profile.position||"");
                        const win=window.open('','_blank');
                        const injLines = selInj.filter(inj=>INJURY_PROTOCOLS[inj]?.nutrition).map(inj=>{
                          const p=INJURY_PROTOCOLS[inj];
                          return `<h2 style="color:#C0695E">${inj} — Injury Supplements</h2><h3>Acute Phase</h3>${p.nutrition.acute.map(n=>`<div class="item">• ${n}</div>`).join('')}<h3>Recovery Phase</h3>${p.nutrition.recovery.map(n=>`<div class="item">• ${n}</div>`).join('')}`;
                        }).join('');
                        const stackLines = stack.slice(0,8).map(s=>`<div class="item"><b>$ ${s.name}</b> — ${s.dose} · ${s.timing}</div>`).join('');
                        win.document.write(`<!DOCTYPE html><html><head><title>Recovery Supplement Guide</title><style>body{font-family:Georgia,serif;max-width:600px;margin:40px auto;color:#1a1a1a;}h1{border-bottom:2px solid #BFA16A;padding-bottom:10px;}h2{font-size:0.85rem;letter-spacing:3px;text-transform:uppercase;color:#BFA16A;margin-top:24px;}h3{color:#4BAE71;font-size:0.8rem;}.item{padding:6px 0;border-bottom:1px solid #eee;}</style></head><body><h1>Recovery Supplement Guide</h1><p style="color:#888">${profile.name||"—"} · ${sport.label} · ${profile.position||""}</p>${injLines}<h2>Full Supplement Stack</h2>${stackLines}</body></html>`);
                        win.document.close();win.print();
                      }}>↓ Print Guide</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PROGRESS */}
          {dash==="progress" && (
            <div>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"1.5rem"}}>
                <div><div className="eyebrow">Analytics</div><h2 className="sh2">Progress <em>Tracking</em></h2></div>
                <div style={{display:"flex",gap:"0.45rem"}}>
                  <button className="bsm" onClick={()=>setEmailModal({type:"progress",label:"Progress Report",data:{...profile,totalCals,mealType,mealFreq}})}>✉ Email</button>
                  <button className="bsm" onClick={handleDownloadProgress}>⬇ Report</button>
                  <button className="bg" style={{padding:"0.45rem 1rem",fontSize:"0.76rem"}} onClick={()=>{
                    try {
                      downloadAthleteReportCard({profile, sport, totalCals, wkWeek, wkLog, benchmarks, weightLog, checkIns, nutritionLog, progressPhotos});
                      shout("Athlete Report Card downloaded","◆");
                    } catch(e) { shout("PDF failed: "+e.message,"!"); console.error(e); }
                  }}>◆ Report Card</button>
                </div>
              </div>

              {/* Sub-nav tabs */}
              <div style={{display:"flex",gap:"0.35rem",marginBottom:"1.75rem",flexWrap:"wrap"}}>
                {[
                  ["coach","AI Coach"],
                  ["overview","Overview"],
                  ["checkin","Daily Check-In"],
                  ["body","Body Tracking"],
                  ["nutrition","Nutrition Log"],
                  ["performance","Performance"],
                  ["photos","Photos"],
                  ["recruiting","Recruiting"],
                  ["coachconnect","Coach Connect"],
                  ["notifications","Notifications"],
                  ["supplements","Supplements"],
                  ["history","History"],
                ].map(([id,label])=>(
                  <button key={id} className={`bsm${progressTab===id?" on":""}`}
                    style={progressTab===id&&id==="coach"?{background:"rgba(255,255,255,0.1)",color:"var(--ivory)",borderColor:"rgba(255,255,255,0.18)",fontWeight:600}:
                           progressTab===id?{background:"rgba(255,255,255,0.08)",color:"var(--ivory)",borderColor:"rgba(255,255,255,0.15)"}:{}}
                    onClick={()=>{
                      setProgressTab(id);
                      if(id==="coach"&&coachMessages.length===0){setTimeout(()=>triggerCoachGreeting(),100);}
                      setTimeout(()=>{
                        const el=document.getElementById('progress-tab-content');
                        if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
                      },80);
                    }}>{label}</button>
                ))}
              </div>
              <div id="progress-tab-content" style={{scrollMarginTop:"80px"}}/>

              {/* ══ AI COACH ══════════════════════════════════════ */}
              {progressTab==="coach" && (
                <div>
                  {/* Coach header */}
                  <div style={{
                    background:"linear-gradient(135deg,rgba(191,161,106,0.08) 0%,rgba(139,105,20,0.04) 100%)",
                    border:"1px solid rgba(255,255,255,0.07)",
                    borderRadius:"var(--r-lg)",
                    padding:"1.25rem 1.5rem",
                    marginBottom:"1.25rem",
                    display:"flex",gap:"1rem",alignItems:"center"
                  }}>
                    {/* Coach avatar */}
                    <div style={{
                      width:"52px",height:"52px",borderRadius:"50%",flexShrink:0,
                      background:"linear-gradient(135deg,#BFA16A,#8B6914)",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:"1.4rem",boxShadow:"0 0 0 3px rgba(191,161,106,0.2)"
                    }}>✦</div>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.25rem",fontWeight:600,color:"var(--ivory)"}}>
                        Elite AI Coach
                      </div>
                      <div style={{fontSize:"0.78rem",color:"var(--muted)",marginTop:"0.15rem"}}>
                        Reads your actual data — recovery, loads, nutrition, sleep, benchmarks — and coaches you in real time
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:"0.4rem",flexShrink:0,alignItems:"flex-end"}}>
                      {[
                        checkIns.length>0?"✓ "+checkIns.length+" check-ins":"○ No check-ins",
                        wkLog.length>0?"✓ "+wkLog.length+" sessions":"○ No sessions",
                        nutritionLog.length>0?"✓ Nutrition logged":"○ No nutrition",
                      ].map((s,i)=>(
                        <div key={i} style={{fontSize:"0.7rem",color:s.startsWith("✓")?"#4BAE71":"rgba(255,255,255,0.15)",letterSpacing:"0.5px"}}>{s}</div>
                      ))}
                      {coachMessages.length>0 && (
                        <button onClick={()=>{setCoachMessages([]);setCoachReady(false);}} style={{
                          marginTop:"0.3rem",fontFamily:"'Inter',sans-serif",fontSize:"0.56rem",fontWeight:600,
                          letterSpacing:"2px",textTransform:"uppercase",background:"rgba(255,255,255,0.05)",
                          border:"1px solid rgba(255,255,255,0.12)",color:"var(--ivory2)",padding:"0.3rem 0.7rem",
                          borderRadius:"var(--r)",cursor:"pointer",whiteSpace:"nowrap",
                        }}>↺ New Chat</button>
                      )}
                    </div>
                  </div>

                  {/* Quick-ask buttons */}
                  <div style={{display:"flex",gap:"0.4rem",flexWrap:"wrap",marginBottom:"1.1rem"}}>
                    {[
                      "Should I train hard today?",
                      "What does my recovery data say?",
                      "Am I eating enough for my goals?",
                      "Give me today's workout recommendation",
                      "Am I at risk of overtraining?",
                      "What's my biggest weakness right now?",
                    ].map(q=>(
                      <button key={q} onClick={()=>{
                        setCoachInput(q);
                        setTimeout(()=>{
                          setCoachInput("");
                          const userMsg={role:"user",content:q,ts:new Date()};
                          const newMsgs=[...coachMessages,userMsg];
                          setCoachMessages(newMsgs);
                          setCoachLoading(true);
                          const ctx=buildAthleteContext();
                          fetch("/.netlify/functions/coach",{
                            method:"POST",
                            headers:{"Content-Type":"application/json"},
                            body:JSON.stringify({
                              system:ctx,
                              messages:newMsgs.map(m=>({role:m.role,content:m.content}))
                            })
                          }).then(r=>r.json()).then(data=>{
                            const reply=data.content?.[0]?.text||"Let me think about that...";
                            setCoachMessages(prev=>[...prev,{role:"assistant",content:reply,ts:new Date()}]);
                          }).catch(()=>{
                            setCoachMessages(prev=>[...prev,{role:"assistant",content:"Connection issue — try again.",ts:new Date()}]);
                          }).finally(()=>setCoachLoading(false));
                        },10);
                      }}
                      style={{
                        fontSize:"0.76rem",color:"var(--gold)",
                        background:"rgba(191,161,106,0.07)",
                        border:"1px solid rgba(255,255,255,0.07)",
                        borderRadius:"20px",padding:"5px 14px",
                        cursor:"pointer",transition:"all 0.15s",fontFamily:"inherit"
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background="rgba(191,161,106,0.15)";e.currentTarget.style.borderColor="rgba(255,255,255,0.12)";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="rgba(191,161,106,0.07)";e.currentTarget.style.borderColor="rgba(191,161,106,0.2)";}}>
                        {q}
                      </button>
                    ))}
                  </div>

                  {/* Chat window */}
                  <div style={{
                    background:"var(--smoke)",
                    border:"1px solid rgba(191,161,106,0.12)",
                    borderRadius:"var(--r-lg)",
                    overflow:"hidden",
                    marginBottom:"0.75rem"
                  }}>
                    {/* Messages */}
                    <div id="coach-msgs" style={{
                      minHeight:"360px",maxHeight:"480px",overflowY:"auto",
                      padding:"1.25rem",
                      display:"flex",flexDirection:"column",gap:"1.1rem"
                    }}>
                      {coachMessages.length===0 && !coachLoading && (
                        <div style={{textAlign:"center",padding:"3rem 2rem"}}>
                          <div style={{fontSize:"2.5rem",marginBottom:"1rem",opacity:0.4}}>✦</div>
                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.15rem",color:"var(--muted)",fontWeight:600}}>
                            Your AI coach is ready
                          </div>
                          <div style={{fontSize:"0.8rem",color:"rgba(255,255,255,0.2)",marginTop:"0.4rem"}}>
                            Ask anything or tap a quick question above
                          </div>
                          <button className="bg" style={{marginTop:"1.5rem",padding:"0.7rem 2rem"}}
                            onClick={triggerCoachGreeting}>
                            Get Today's Coaching Brief →
                          </button>
                        </div>
                      )}

                      {coachMessages.map((msg,i)=>(
                        <div key={i} style={{
                          display:"flex",
                          flexDirection:msg.role==="user"?"row-reverse":"row",
                          gap:"0.75rem",alignItems:"flex-start"
                        }}>
                          {/* Avatar */}
                          <div style={{
                            width:"34px",height:"34px",borderRadius:"50%",flexShrink:0,
                            background:msg.role==="assistant"?"linear-gradient(135deg,#BFA16A,#8B6914)":"rgba(255,255,255,0.08)",
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:msg.role==="assistant"?"0.9rem":"0.8rem",
                            border:msg.role==="assistant"?"none":"1px solid rgba(255,255,255,0.1)",
                            marginTop:"2px"
                          }}>
                            {msg.role==="assistant"?"✦":(profile.name?.[0]||"A")}
                          </div>
                          {/* Bubble */}
                          <div style={{
                            maxWidth:"78%",
                            background:msg.role==="assistant"
                              ?"linear-gradient(135deg,rgba(191,161,106,0.1),rgba(191,161,106,0.04))"
                              :"rgba(255,255,255,0.06)",
                            border:msg.role==="assistant"
                              ?"1px solid rgba(191,161,106,0.18)"
                              :"1px solid rgba(255,255,255,0.08)",
                            borderRadius:msg.role==="assistant"?"4px 16px 16px 16px":"16px 4px 16px 16px",
                            padding:"0.85rem 1.1rem"
                          }}>
                            {msg.role==="assistant" && (
                              <div style={{fontSize:"0.68rem",color:"var(--gold)",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"0.5rem",fontWeight:600}}>
                                Elite Coach
                              </div>
                            )}
                            <div style={{
                              fontSize:"0.88rem",color:msg.role==="assistant"?"var(--ivory)":"var(--ivory2)",
                              lineHeight:1.72,whiteSpace:"pre-wrap"
                            }}>{msg.content}</div>
                            <div style={{fontSize:"0.67rem",color:"rgba(255,255,255,0.2)",marginTop:"0.4rem",textAlign:msg.role==="user"?"right":"left"}}>
                              {msg.ts?.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Thinking indicator */}
                      {coachLoading && (
                        <div style={{display:"flex",gap:"0.75rem",alignItems:"flex-start"}}>
                          <div style={{width:"34px",height:"34px",borderRadius:"50%",flexShrink:0,background:"linear-gradient(135deg,#BFA16A,#8B6914)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem"}}>✦</div>
                          <div style={{background:"linear-gradient(135deg,rgba(191,161,106,0.1),rgba(191,161,106,0.04))",border:"1px solid rgba(191,161,106,0.18)",borderRadius:"4px 16px 16px 16px",padding:"0.85rem 1.1rem"}}>
                            <div style={{fontSize:"0.68rem",color:"var(--gold)",letterSpacing:"2px",marginBottom:"0.5rem",fontWeight:600}}>ELITE COACH</div>
                            <div style={{display:"flex",gap:"5px",alignItems:"center",height:"18px"}}>
                              {[0,1,2].map(i=>(
                                <div key={i} style={{
                                  width:"7px",height:"7px",borderRadius:"50%",
                                  background:"rgba(191,161,106,0.6)",
                                  animation:`pulse 1.2s ${i*0.2}s ease-in-out infinite`
                                }}/>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Input bar */}
                    <div style={{
                      borderTop:"1px solid var(--border)",
                      padding:"0.85rem 1rem",
                      display:"flex",gap:"0.6rem",alignItems:"flex-end",
                      background:"var(--smoke)"
                    }}>
                      <textarea
                        placeholder="Ask your coach anything — training, nutrition, recovery, injury…"
                        value={coachInput}
                        onChange={e=>setCoachInput(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendCoachMessage();}}}
                        rows={1}
                        style={{
                          flex:1,background:"transparent",border:"none",outline:"none",
                          resize:"none",color:"var(--fg)",fontSize:"0.88rem",
                          lineHeight:1.6,fontFamily:"inherit",padding:"0.2rem 0"
                        }}
                      />
                      <button
                        onClick={sendCoachMessage}
                        disabled={coachLoading||!coachInput.trim()}
                        style={{
                          width:"40px",height:"40px",borderRadius:"50%",flexShrink:0,
                          background:coachInput.trim()&&!coachLoading?"linear-gradient(135deg,#BFA16A,#8B6914)":"rgba(255,255,255,0.05)",
                          border:`1px solid ${coachInput.trim()&&!coachLoading?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.08)"}`,
                          cursor:coachInput.trim()&&!coachLoading?"pointer":"default",
                          display:"flex",alignItems:"center",justifyContent:"center",
                          transition:"all 0.2s",fontSize:"1rem"
                        }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={coachInput.trim()&&!coachLoading?"#0E0D0B":"rgba(255,255,255,0.3)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Data quality note */}
                  <div style={{
                    marginTop:"1rem",padding:"0.75rem 1rem",
                    background:"rgba(191,161,106,0.04)",
                    border:"1px solid rgba(191,161,106,0.1)",
                    borderRadius:"var(--r)",
                    fontSize:"0.76rem",color:"var(--muted)",lineHeight:1.6
                  }}>
                    <span style={{color:"var(--gold)",fontWeight:600}}>Better data = better coaching.</span> The more you log — daily check-ins, workout loads, nutrition, and weight — the more precise and actionable your coach's recommendations become. Aim for 7+ consecutive days of check-ins for pattern analysis.
                  </div>
                </div>
              )}

              {/* ══ OVERVIEW ══════════════════════════════════════ */}
              {progressTab==="overview" && (
                <div>
                  {/* Key metrics row 1 */}
                  <div className="three" style={{marginBottom:"1rem"}}>
                    {[
                      ["Current Weight", profile.weight?`${profile.weight} lbs`:"—", "From profile · update in Body tab"],
                      ["Daily Cal Target", totalCals.toLocaleString()+" kcal", `${mealType} · TDEE-based`],
                      ["Protein Target", `${Math.round((parseFloat(profile.weight)||185)*(SPORT_NUTRITION_PROFILES[profile.sport]?.positions?.[profile.position]?.proteinGperLb??SPORT_NUTRITION_PROFILES[profile.sport]?.base?.proteinGperLb??0.85))}g/day`, `${sport.icon} Position optimized`],
                    ].map(([l,v,d])=>(
                      <div key={l} className="metr"><div className="ml">{l}</div><div className="mv2">{v}</div><div className="md2" style={{color:"var(--gold)"}}>{d}</div></div>
                    ))}
                  </div>
                  <div className="three" style={{marginBottom:"1.5rem"}}>
                    {[
                      ["Sessions Logged", wkLog.length.toString(), wkLog.length>0?`Last: ${wkLog[wkLog.length-1]?.date||"—"}`:"Log in Workout tab"],
                      ["Training Week", `Week ${wkWeek}`, wkWeek>1?`${wkWeek-1} weeks consistent`:"Start tracking"],
                      ["Avg Recovery", checkIns.length>0?`${(checkIns.slice(-7).reduce((s,c)=>s+c.recovery,0)/Math.min(checkIns.slice(-7).length,7)).toFixed(1)}/10`:"—", checkIns.length>0?"7-day average":"Log daily check-ins"],
                    ].map(([l,v,d])=>(
                      <div key={l} className="metr"><div className="ml">{l}</div><div className="mv2">{v}</div><div className="md2" style={{color:"var(--gold)"}}>{d}</div></div>
                    ))}
                  </div>

                  {/* ── COMPOSITE PERFORMANCE INTELLIGENCE ──────── */}
                  {(()=>{
                    const last3 = checkIns.slice(-3);
                    const last7 = checkIns.slice(-7);
                    const last14 = checkIns.slice(-14);
                    const recentDays = [...new Set(wkLog.slice(-14).map(l=>l.date))];
                    const avg = (arr, key) => arr.length ? arr.reduce((s,c)=>s+(parseFloat(c[key])||0),0)/arr.length : 0;
                    const noData = checkIns.length === 0;

                    // ── SIGNAL 1: Sleep Quality ──────────────────────
                    const avgSleep3  = avg(last3, 'sleep');
                    const avgSleep7  = avg(last7, 'sleep');
                    const optimalSleep = (profile.sport==='football'||profile.sport==='basketball') ? 9 : 8;
                    const sleepScore = Math.min(avgSleep3/optimalSleep, 1); // 0–1
                    const sleepDebt7 = Math.max(0, (optimalSleep - avgSleep7) * 7); // total hours in deficit
                    const sleepTrend = last7.length >= 4 ? avgSleep3 - avg(last7.slice(0,4), 'sleep') : 0;

                    // ── SIGNAL 2: Recovery Trend ─────────────────────
                    const avgRecovery3  = avg(last3,  'recovery');
                    const avgRecovery7  = avg(last7,  'recovery');
                    const avgRecovery14 = avg(last14, 'recovery');
                    const recoveryTrend = avgRecovery7 - avgRecovery14; // pos = improving
                    const recoveryAccel = avgRecovery3 - avgRecovery7;  // short-term change

                    // ── SIGNAL 3: Neuromuscular Fatigue (soreness trend) ──
                    const avgSoreness3 = avg(last3, 'soreness');
                    const avgSoreness7 = avg(last7, 'soreness');
                    const sorenessTrend = avgSoreness3 - avgSoreness7; // pos = worsening
                    const chronicSoreness = avgSoreness7 > 6; // sustained high = injury risk

                    // ── SIGNAL 4: HRV Proxy (energy + mood coherence) ──
                    const avgEnergy3 = avg(last3, 'energy');
                    const avgMood3   = avg(last3, 'mood');
                    const energyMoodCoherence = Math.abs(avgEnergy3 - avgMood3); // high divergence = stress
                    const hrvProxy = ((avgEnergy3 + avgMood3) / 2) - (energyMoodCoherence * 0.3);

                    // ── SIGNAL 5: Training Volume Load ──────────────
                    const sessionsLast7  = [...new Set(wkLog.slice(-7).map(l=>l.date))].length;
                    const sessionsLast14 = [...new Set(wkLog.slice(-14).map(l=>l.date))].length;
                    const acuteLoad  = sessionsLast7;
                    const chronicLoad = sessionsLast14 / 2;
                    // ACWR: Acute:Chronic Workload Ratio (sweet spot 0.8–1.3)
                    const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 1;
                    const acwrRisk = acwr > 1.5 ? (acwr - 1.5) * 4 :
                                     acwr < 0.7 ? (0.7 - acwr) * 2 : 0;

                    // ── COMPOSITE OVERTRAINING RISK (0–10) ───────────
                    // Weighted using NSCA and sports science clinical guidelines
                    const riskComponents = {
                      sleepDebt:    Math.min((sleepDebt7 / 7) * 3, 3),           // max 3pts
                      soreness:     Math.min(chronicSoreness ? avgSoreness7 - 4 : Math.max(0, avgSoreness3 - 6), 2.5), // max 2.5pts
                      recovery:     Math.min(avgRecovery7 < 5 ? (5 - avgRecovery7) * 0.6 : 0, 2),  // max 2pts
                      acwr:         Math.min(acwrRisk, 2),                        // max 2pts
                      trend:        sorenessTrend > 1.5 ? 0.5 : 0,              // 0.5 for worsening trend
                    };
                    const rawRisk = Math.min(10, Object.values(riskComponents).reduce((a,b)=>a+b,0));
                    const riskPct = rawRisk * 10;

                    // ── GAME-DAY READINESS (0–10) ─────────────────────
                    const readiness = Math.min(10, Math.round((
                      avgRecovery3 * 0.30 +
                      Math.min(avgSleep3 / optimalSleep, 1) * 10 * 0.25 +
                      avgEnergy3 * 0.20 +
                      avgMood3 * 0.15 +
                      (10 - avgSoreness3) * 0.10
                    ) * 10) / 10);

                    // ── RISK LEVEL & COLORS ───────────────────────────
                    const riskLevel = rawRisk >= 7 ? 'critical' : rawRisk >= 5 ? 'high' : rawRisk >= 3 ? 'moderate' : 'low';
                    const riskColor = {critical:"#C0695E", high:"#D4854A", moderate:"#F0C040", low:"#4BAE71"}[riskLevel];
                    const readColor = readiness >= 7.5 ? "#4BAE71" : readiness >= 5 ? "#F0C040" : "#C0695E";

                    // ── INJURY RISK PREDICTION by position ───────────
                    const injuryPredictions = [];
                    if (avgSoreness3 > 6 && profile.sport === 'football')
                      injuryPredictions.push({injury:"Hamstring strain", signal:"High soreness + football demands"});
                    if (sleepDebt7 > 4)
                      injuryPredictions.push({injury:"Overuse / stress fracture", signal:"Cumulative sleep debt >4hrs"});
                    if (acwr > 1.5)
                      injuryPredictions.push({injury:"Soft tissue injury", signal:`ACWR ${acwr.toFixed(2)} — spike zone`});
                    if (chronicSoreness && avgRecovery7 < 5)
                      injuryPredictions.push({injury:"Tendinopathy", signal:"Chronic soreness + low recovery"});
                    if (recoveryTrend < -1.5)
                      injuryPredictions.push({injury:"Burnout / overreaching", signal:"Recovery declining 2-week trend"});

                    // ── SPECIFIC RECOMMENDATIONS ──────────────────────
                    const recs = [];
                    if (rawRisk >= 7) {
                      recs.push({icon:"🛑", text:"Take 2 full rest days immediately — active recovery only (walk, swim)"});
                      recs.push({icon:"😴", text:`Sleep target: ${optimalSleep + 1}hrs tonight — you've accumulated ${sleepDebt7.toFixed(1)}hrs of debt`});
                      recs.push({icon:"⬇", text:"Reduce next training session volume by 40% when you return"});
                    } else if (rawRisk >= 5) {
                      recs.push({icon:"!", text:"Deload today — keep intensity below 70% of normal"});
                      recs.push({icon:"😴", text:`Prioritize ${optimalSleep}hrs sleep — current 7-day avg: ${avgSleep7.toFixed(1)}hrs`});
                      recs.push({icon:"🧊", text:"Cold water immersion or contrast shower post-session"});
                    } else if (rawRisk >= 3) {
                      recs.push({icon:"◉", text:"Monitor closely — check soreness and energy before each session"});
                      recs.push({icon:"P", text:acwr > 1.2 ? `ACWR at ${acwr.toFixed(2)} — don't increase volume this week` : "Training load is sustainable — maintain current schedule"});
                    } else {
                      recs.push({icon:"✓", text:"Excellent recovery status — ideal time for a peak training session"});
                      recs.push({icon:"W", text:"Consider a personal record attempt on a key lift today"});
                    }

                    return (
                      <div style={{marginBottom:"1.5rem"}}>
                        {/* Main score cards */}
                        {noData && (
                        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"var(--r)",padding:"0.75rem 1rem",marginBottom:"0.75rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:"0.82rem",fontWeight:600,color:"var(--gold)"}}>Readiness & Risk scores need check-in data</div>
                            <div style={{fontSize:"0.76rem",color:"var(--muted)",marginTop:"0.15rem"}}>Log your first Daily Check-In to activate these scores</div>
                          </div>
                          <button className="bsm" style={{flexShrink:0}} onClick={()=>setProgressTab("checkin")}>Log Check-In →</button>
                        </div>
                      )}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"0.75rem",opacity:noData?0.35:1,pointerEvents:noData?"none":"auto"}}>

                          {/* Game-Day Readiness */}
                          <div style={{background:"rgba(8,7,5,0.8)",border:`1px solid ${readColor}30`,borderRadius:"var(--r-lg)",padding:"1.25rem 1.25rem 1rem",position:"relative",overflow:"hidden"}}>
                            <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:readColor}}/>
                            <div style={{position:"absolute",bottom:"-20px",right:"-10px",fontSize:"5rem",opacity:0.04,fontWeight:900,color:readColor,userSelect:"none",lineHeight:1}}>
                              {readiness >= 7.5 ? "GO" : readiness >= 5 ? "?" : "NO"}
                            </div>
                            <div style={{fontSize:"0.68rem",letterSpacing:"3px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.4rem"}}>Game-Day Readiness</div>
                            <div style={{display:"flex",alignItems:"baseline",gap:"0.3rem",marginBottom:"0.25rem"}}>
                              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"3.5rem",fontWeight:600,color:readColor,lineHeight:1}}>{readiness.toFixed(1)}</div>
                              <div style={{fontSize:"0.9rem",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}>/10</div>
                            </div>
                            {/* Progress bar */}
                            <div style={{height:"3px",background:"rgba(255,255,255,0.06)",borderRadius:"2px",marginBottom:"0.6rem"}}>
                              <div style={{width:`${readiness*10}%`,height:"100%",background:readColor,borderRadius:"2px",transition:"width 0.5s ease"}}/>
                            </div>
                            <div style={{fontSize:"0.8rem",fontWeight:600,color:readColor,marginBottom:"0.6rem"}}>
                              {readiness>=7.5?"✦ Prime to Perform":readiness>=5?" Train with Caution":"! Recovery Priority"}
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                              {[["Recovery",avgRecovery3.toFixed(1)+"/10"],["Sleep",avgSleep3.toFixed(1)+"h"],["Energy",avgEnergy3.toFixed(1)+"/10"],["Soreness",avgSoreness3.toFixed(1)+"/10"]].map(([l,v])=>(
                                <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:"0.74rem"}}>
                                  <span style={{color:"var(--muted)"}}>{l}</span>
                                  <span style={{color:"var(--ivory2)",fontWeight:600}}>{v}</span>
                                </div>
                              ))}
                            </div>
                            <div style={{fontSize:"0.67rem",color:"var(--muted)",marginTop:"0.5rem",fontStyle:"italic"}}>Composite of last 3 check-ins</div>
                          </div>

                          {/* Overtraining Risk */}
                          <div style={{background:"rgba(8,7,5,0.8)",border:`1px solid ${riskColor}30`,borderRadius:"var(--r-lg)",padding:"1.25rem 1.25rem 1rem",position:"relative",overflow:"hidden"}}>
                            <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:riskColor}}/>
                            <div style={{position:"absolute",bottom:"-20px",right:"-10px",fontSize:"5rem",opacity:0.04,fontWeight:900,color:riskColor,userSelect:"none",lineHeight:1}}>
                              {riskLevel==="critical"?"!":riskLevel==="high"?"!!":riskLevel==="moderate"?"~":"✓"}
                            </div>
                            <div style={{fontSize:"0.68rem",letterSpacing:"3px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.4rem"}}>Overtraining Risk</div>
                            <div style={{display:"flex",alignItems:"baseline",gap:"0.3rem",marginBottom:"0.25rem"}}>
                              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"3.5rem",fontWeight:600,color:riskColor,lineHeight:1}}>{rawRisk.toFixed(1)}</div>
                              <div style={{fontSize:"0.9rem",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif"}}>/10</div>
                            </div>
                            {/* Risk bar */}
                            <div style={{height:"3px",background:"rgba(255,255,255,0.06)",borderRadius:"2px",marginBottom:"0.6rem"}}>
                              <div style={{width:`${riskPct}%`,height:"100%",background:riskColor,borderRadius:"2px",transition:"width 0.5s ease"}}/>
                            </div>
                            <div style={{fontSize:"0.8rem",fontWeight:600,color:riskColor,marginBottom:"0.6rem",textTransform:"uppercase",letterSpacing:"0.5px"}}>
                              {riskLevel.toUpperCase()} RISK
                            </div>
                            {/* Component breakdown */}
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                              {[
                                ["Sleep debt",`${sleepDebt7.toFixed(1)}h`,riskComponents.sleepDebt],
                                ["Soreness",avgSoreness7.toFixed(1)+"/10",riskComponents.soreness],
                                ["ACWR",acwr.toFixed(2),riskComponents.acwr],
                                ["Recovery",avgRecovery7.toFixed(1)+"/10",riskComponents.recovery],
                              ].map(([l,v,risk])=>(
                                <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:"0.74rem"}}>
                                  <span style={{color:"var(--muted)"}}>{l}</span>
                                  <span style={{color:risk>0.8?"#C0695E":risk>0.3?"#F0C040":"var(--ivory2)",fontWeight:600}}>{v}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* ACWR semicircle gauge */}
                        <div style={{background:"var(--slate)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"0.85rem 1rem",marginBottom:"0.75rem"}}>
                          <div style={{fontSize:"0.7rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.1rem"}}>Acute:Chronic Workload Ratio</div>
                          <div style={{fontSize:"0.76rem",color:"var(--muted)",marginBottom:"0.6rem"}}>This week vs 2-week average · Sweet spot: 0.8–1.3</div>
                          {(()=>{
                            const W=260,H=140,cx=130,cy=125,R=100,r=72;
                            const toAngle=v=>Math.PI+(Math.min(Math.max(v,0),2)/2)*Math.PI;
                            const polar=(a,rad)=>[cx+rad*Math.cos(a),cy+rad*Math.sin(a)];
                            const arc=(a1,a2,oR,iR)=>{
                              const[ox1,oy1]=polar(a1,oR),[ox2,oy2]=polar(a2,oR);
                              const[ix1,iy1]=polar(a2,iR),[ix2,iy2]=polar(a1,iR);
                              const lg=a2-a1>Math.PI?1:0;
                              return `M${ox1.toFixed(1)},${oy1.toFixed(1)} A${oR},${oR} 0 ${lg},1 ${ox2.toFixed(1)},${oy2.toFixed(1)} L${ix1.toFixed(1)},${iy1.toFixed(1)} A${iR},${iR} 0 ${lg},0 ${ix2.toFixed(1)},${iy2.toFixed(1)}Z`;
                            };
                            const a0=Math.PI,a07=toAngle(0.7),a08=toAngle(0.8),a13=toAngle(1.3),a15=toAngle(1.5),a20=toAngle(2.0);
                            const na=toAngle(acwr);
                            const[nx,ny]=polar(na,R-8);
                            const[b1x,b1y]=polar(na+Math.PI/2,5);
                            const[b2x,b2y]=polar(na-Math.PI/2,5);
                            const ac=acwr>1.5||acwr<0.7?"#C0695E":acwr>1.3?"#F0C040":"#4BAE71";
                            const tickColor  = darkMode ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.22)";
                            const arcOutline = darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
                            const arcOpacity = darkMode ? 1 : 1.8; // boost fill opacity in light
                            const redFill    = darkMode ? "rgba(192,105,94,0.25)"  : "rgba(192,105,94,0.40)";
                            const yellowFill = darkMode ? "rgba(240,192,64,0.2)"   : "rgba(240,192,64,0.35)";
                            const greenFill  = darkMode ? "rgba(75,174,113,0.3)"   : "rgba(75,174,113,0.45)";
                            return(
                              <div style={{display:"flex",alignItems:"center",gap:"1rem"}}>
                                <svg viewBox={`0 0 ${W} ${H}`} style={{width:"175px",flexShrink:0,overflow:"visible"}}>
                                  <path d={arc(a0,a07,R,r)} fill={redFill}/>
                                  <path d={arc(a07,a08,R,r)} fill={yellowFill}/>
                                  <path d={arc(a08,a13,R,r)} fill={greenFill}/>
                                  <path d={arc(a13,a15,R,r)} fill={yellowFill}/>
                                  <path d={arc(a15,a20,R,r)} fill={redFill}/>
                                  <path d={arc(a0,a20,R,r)} fill="none" stroke={arcOutline} strokeWidth="1"/>
                                  {[0.7,0.8,1.0,1.3,1.5].map(v=>{
                                    const a=toAngle(v);const[t1x,t1y]=polar(a,r-1);const[t2x,t2y]=polar(a,R+1);
                                    return <line key={v} x1={t1x.toFixed(1)} y1={t1y.toFixed(1)} x2={t2x.toFixed(1)} y2={t2y.toFixed(1)} stroke={tickColor} strokeWidth="1"/>;
                                  })}
                                  <path d={`M${b1x.toFixed(1)},${b1y.toFixed(1)} L${nx.toFixed(1)},${ny.toFixed(1)} L${b2x.toFixed(1)},${b2y.toFixed(1)}Z`} fill={ac}/>
                                  <circle cx={cx} cy={cy} r="6" fill="var(--slate)" stroke={ac} strokeWidth="1.5"/>
                                  <text x="18" y={cy+2} fontSize="7.5" fill="rgba(192,105,94,0.8)" textAnchor="middle">LOW</text>
                                  <text x={cx} y="28" fontSize="7.5" fill="rgba(75,174,113,0.9)" textAnchor="middle">OPTIMAL</text>
                                  <text x={W-18} y={cy+2} fontSize="7.5" fill="rgba(192,105,94,0.8)" textAnchor="middle">HIGH</text>
                                  <text x={cx} y={cy+22} fontSize="22" fontFamily="DM Sans,sans-serif" fontWeight="300" fill={ac} textAnchor="middle">{acwr.toFixed(2)}</text>
                                </svg>
                                <div style={{flex:1}}>
                                  <div style={{fontSize:"0.82rem",fontWeight:600,color:ac,marginBottom:"0.35rem"}}>
                                    {acwr>1.5?"! Danger — reduce volume":acwr>1.3?" Caution — monitor closely":acwr<0.7?"↓ Under-trained":acwr<0.8?" Below optimal":"✓ Ideal load"}
                                  </div>
                                  {[["0.8–1.3","Sweet spot","#4BAE71"],["< 0.7","Under-trained","#6B9FD4"],["1.3–1.5","Caution","#F0C040"],["> 1.5","Injury risk","#C0695E"]].map(([range,label,col])=>(
                                    <div key={range} style={{display:"flex",justifyContent:"space-between",fontSize:"0.72rem",marginBottom:"0.2rem"}}>
                                      <span style={{color:"var(--muted)"}}>{label}</span>
                                      <span style={{color:col,fontWeight:600}}>{range}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Injury prediction */}
                        {injuryPredictions.length > 0 && (
                          <div style={{background:"rgba(192,105,94,0.06)",border:"1px solid rgba(192,105,94,0.2)",borderRadius:"var(--r)",padding:"0.85rem 1rem",marginBottom:"0.75rem"}}>
                            <div style={{fontSize:"0.7rem",letterSpacing:"2px",color:"#C0695E",textTransform:"uppercase",marginBottom:"0.55rem",fontWeight:600}}>
                              ! Elevated Injury Risk Signals
                            </div>
                            {injuryPredictions.map((p,i)=>(
                              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.3rem 0",borderBottom:i<injuryPredictions.length-1?"1px solid rgba(192,105,94,0.1)":"none"}}>
                                <div style={{fontSize:"0.82rem",color:"var(--ivory2)",fontWeight:500}}>{p.injury}</div>
                                <div style={{fontSize:"0.72rem",color:"var(--muted)",fontStyle:"italic",textAlign:"right",maxWidth:"55%"}}>{p.signal}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Specific recommendations */}
                        <div style={{background:"var(--slate)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                          <div style={{fontSize:"0.7rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.55rem",fontWeight:600}}>
                            Today's Recommendations
                          </div>
                          {recs.map((r,i)=>(
                            <div key={i} style={{display:"flex",gap:"0.6rem",alignItems:"flex-start",marginBottom:i<recs.length-1?"0.5rem":0}}>
                              <span style={{fontSize:"1rem",flexShrink:0}}>{r.icon}</span>
                              <div style={{fontSize:"0.84rem",color:"var(--ivory2)",lineHeight:1.55}}>{r.text}</div>
                            </div>
                          ))}
                          <div style={{fontSize:"0.7rem",color:"var(--muted)",marginTop:"0.6rem",fontStyle:"italic",borderTop:"1px solid var(--border)",paddingTop:"0.5rem"}}>
                            Based on {checkIns.length} check-ins · {wkLog.length} sessions logged · NSCA clinical guidelines
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Today's check-in prompt if not done */}
                  {!checkInDone && (
                    <div style={{background:"linear-gradient(135deg,rgba(191,161,106,0.08),rgba(58,107,155,0.08))",border:"1px solid rgba(191,161,106,0.25)",borderRadius:"var(--r)",padding:"1rem 1.25rem",marginBottom:"1.5rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontWeight:600,color:"var(--ivory)",marginBottom:"0.2rem"}}>Today's check-in not done</div>
                        <div style={{fontSize:"0.82rem",color:"var(--muted)"}}>Takes 30 seconds — tracks recovery, energy, sleep, and soreness</div>
                      </div>
                      <button className="bg" style={{padding:"0.6rem 1.25rem",flexShrink:0}} onClick={()=>setProgressTab("checkin")}>Check In →</button>
                    </div>
                  )}

                  {/* 7-day Recovery Sparkline */}
                  {checkIns.length>0 && (
                    <div className="panel" style={{marginBottom:"1.25rem"}}>
                      <div className="ph"><div className="pt">7-Day <em>Wellness Trend</em></div>
                        <span style={{fontSize:"0.74rem",color:"var(--muted)"}}>{checkIns.length} check-ins total</span>
                      </div>
                      <div className="pb">
                        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"0.5rem",marginBottom:"0.75rem"}}>
                          {Array.from({length:7},(_,i)=>{
                            const d=new Date(); d.setDate(d.getDate()-6+i);
                            const key=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
                            const ci=checkIns.find(c=>c.date===key);
                            return (
                              <div key={i} style={{textAlign:"center"}}>
                                <div style={{fontSize:"0.68rem",color:"var(--muted)",marginBottom:"0.3rem"}}>{["S","M","T","W","T","F","S"][d.getDay()]}</div>
                                <div style={{height:"60px",background:"var(--smoke)",borderRadius:"4px",position:"relative",overflow:"hidden"}}>
                                  {ci && <>
                                    <div style={{position:"absolute",bottom:0,left:0,right:0,height:`${ci.recovery*10}%`,background:`hsl(${ci.recovery*12},60%,45%)`,opacity:0.8,transition:"height 0.3s"}}/>
                                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.76rem",fontWeight:600,color:"#fff"}}>{ci.recovery}</div>
                                  </>}
                                  {!ci && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.7rem",color:"var(--muted)"}}>—</div>}
                                </div>
                                <div style={{fontSize:"0.64rem",color:"var(--muted)",marginTop:"0.2rem"}}>{d.getDate()}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{display:"flex",gap:"1.5rem",flexWrap:"wrap"}}>
                          {checkIns.slice(-1)[0] && [
                            ["😴 Sleep",checkIns.slice(-1)[0].sleep+"hrs"],
                            [" Energy",checkIns.slice(-1)[0].energy+"/10"],
                            [" Recovery",checkIns.slice(-1)[0].recovery+"/10"],
                            [" Soreness",checkIns.slice(-1)[0].soreness+"/10"],
                          ].map(([l,v])=>(
                            <div key={l} style={{fontSize:"0.82rem"}}>
                              <span style={{color:"var(--muted)"}}>{l}: </span>
                              <span style={{color:"var(--ivory)",fontWeight:600}}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Weight trend mini chart */}
                  {weightLog.length>1 && (
                    <div className="panel" style={{marginBottom:"1.25rem"}}>
                      <div className="ph"><div className="pt">Weight <em>Trend</em></div>
                        <span style={{fontSize:"0.74rem",color:weightLog[weightLog.length-1]?.weight<weightLog[0]?.weight?"#4BAE71":"#C0695E"}}>
                          {weightLog.length>1?(weightLog[weightLog.length-1].weight-weightLog[0].weight>0?"+":"")+
                          (weightLog[weightLog.length-1].weight-weightLog[0].weight).toFixed(1)+" lbs":""}</span>
                      </div>
                      <div className="pb">
                        <svg viewBox={`0 0 400 80`} style={{width:"100%",overflow:"visible"}}>
                          {(() => {
                            const data=weightLog.slice(-12);
                            const wts=data.map(d=>d.weight);
                            const min=Math.min(...wts)-2, max=Math.max(...wts)+2;
                            const pts=data.map((d,i)=>({
                              x:10+(i/(data.length-1||1))*380,
                              y:10+((max-d.weight)/(max-min||1))*60
                            }));
                            const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
                            return (<>
                              <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#BFA16A" stopOpacity="0.25"/>
                                <stop offset="100%" stopColor="#BFA16A" stopOpacity="0"/>
                              </linearGradient></defs>
                              <path d={`${path} L${pts[pts.length-1].x},80 L10,80Z`} fill="url(#wg)"/>
                              <path d={path} fill="none" stroke="#BFA16A" strokeWidth="2" strokeLinecap="round"/>
                              {pts.map((p,i)=>(
                                <g key={i}>
                                  <circle cx={p.x} cy={p.y} r="3.5" fill="#BFA16A" stroke="#141310" strokeWidth="1.5"/>
                                  <text x={p.x} y={p.y-8} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.6)">{data[i].weight}</text>
                                </g>
                              ))}
                            </>);
                          })()}
                        </svg>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.72rem",color:"var(--muted)",marginTop:"0.25rem"}}>
                          <span>{weightLog.slice(-12)[0]?.date}</span>
                          <span>{weightLog.slice(-1)[0]?.date}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Personal Records */}
                  {wkLog.length>0 && (
                    <div className="panel" style={{marginBottom:"1.25rem"}}>
                      <div className="ph"><div className="pt">Personal <em>Records</em></div>
                        <span style={{fontSize:"0.74rem",color:"var(--gold)"}}>◆ Auto-detected from workout log</span>
                      </div>
                      <div className="pb">
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"0.6rem"}}>
                          {Object.entries(
                            wkLog.reduce((acc,l)=>{
                              const numMatch=l.load?.match(/^[\d.]+/);
                              if(!numMatch) return acc;
                              const num=parseFloat(numMatch[0]);
                              if(!acc[l.exercise]||num>acc[l.exercise].num)
                                acc[l.exercise]={num,load:l.load,date:l.date,week:l.week};
                              return acc;
                            },{})).slice(0,8).map(([ex,pr])=>(
                            <div key={ex} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(191,161,106,0.15)",borderRadius:"var(--r)",padding:"0.6rem 0.75rem"}}>
                              <div style={{fontSize:"0.7rem",color:"var(--muted)",marginBottom:"0.2rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ex}</div>
                              <div style={{fontSize:"1.1rem",fontFamily:"'DM Sans',sans-serif",color:"var(--gold)",fontWeight:600}}>{pr.load}</div>
                              <div style={{fontSize:"0.68rem",color:"var(--muted)",marginTop:"0.15rem"}}>{pr.week} · {pr.date}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Workout load history */}
                  {wkLog.length>0 && (
                    <div className="panel" style={{marginBottom:"1.25rem"}}>
                      <div className="ph"><div className="pt">Workout <em>Load History</em></div>
                        <span style={{fontSize:"0.74rem",color:"var(--muted)"}}>{wkLog.length} entries</span>
                      </div>
                      <div className="pb" style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.82rem"}}>
                          <thead><tr>
                            {["Week","Date","Program","Exercise","Load","Notes"].map(h=>(
                              <td key={h} style={{color:"var(--gold)",fontSize:"0.7rem",letterSpacing:"2px",textTransform:"uppercase",padding:"6px 8px",borderBottom:"1px solid rgba(191,161,106,0.2)"}}>{h}</td>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...wkLog].reverse().slice(0,12).map((l,i)=>(
                              <tr key={i} style={{borderBottom:"1px solid var(--border)"}}>
                                <td style={{padding:"5px 8px",color:"var(--gold)",fontWeight:600,fontSize:"0.78rem"}}>{l.week}</td>
                                <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.72rem"}}>{l.date}</td>
                                <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.72rem"}}>{l.wkType?.split(" ")[0]}</td>
                                <td style={{padding:"5px 8px",color:"var(--ivory2)"}}>{l.exercise}</td>
                                <td style={{padding:"5px 8px",color:"#4BAE71",fontWeight:700}}>{l.load}</td>
                                <td style={{padding:"5px 8px",color:"var(--muted)",fontStyle:"italic",fontSize:"0.72rem"}}>{l.notes}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Notes / progress journal */}
                  <div className="two">
                    <div className="panel">
                      <div className="ph"><div className="pt">Progress <em>Note</em></div></div>
                      <div className="pb">
                        <div className="f"><label className="fl">Date</label><input type="date" className="fi" defaultValue={new Date().toISOString().split("T")[0]}/></div>
                        <div className="f"><label className="fl">Note</label><textarea className="fi" placeholder="Measurements, milestones, observations…" value={pNote} onChange={e=>setPNote(e.target.value)}/></div>
                        <button className="bg" style={{width:"100%",padding:"0.72rem"}} onClick={()=>{if(pNote){const n={date:new Date().toLocaleDateString("en-US",{month:"long",day:"numeric"}),text:pNote};setNotes(ns=>[n,...ns]);saveNoteToDb(pNote);setPNote("");shout("Note saved","✦");}}}>Save Note</button>
                        {notes.slice(0,2).map((n,i)=>(
                          <div key={i} className="je" style={{marginTop:"0.7rem"}}>
                            <div className="jd">{n.date}</div><div className="jt">{n.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="panel">
                      <div className="ph"><div className="pt">3-Month <em>Weight Chart</em></div></div>
                      <div className="pb">
                        <svg viewBox="0 0 400 160" className="chart-svg">
                          <defs>
                            <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#BFA16A" stopOpacity="0.22"/>
                              <stop offset="100%" stopColor="#BFA16A" stopOpacity="0"/>
                            </linearGradient>
                          </defs>
                          <path d="M0,130 C40,115 60,105 90,95 C120,85 140,83 170,77 C200,71 220,65 250,58 C280,51 305,47 335,43 C360,40 382,38 400,36 L400,160 L0,160Z" fill="url(#cg)"/>
                          <path d="M0,130 C40,115 60,105 90,95 C120,85 140,83 170,77 C200,71 220,65 250,58 C280,51 305,47 335,43 C360,40 382,38 400,36" fill="none" stroke="#BFA16A" strokeWidth="2" strokeLinecap="round"/>
                          {[0,90,170,250,335,400].map((x,i)=>{
                            const y=[130,95,77,58,43,36][i];
                            return <circle key={i} cx={x} cy={y} r="4" fill="#BFA16A" stroke="#141310" strokeWidth="2"/>;
                          })}
                        </svg>
                        <div style={{display:"flex",justifyContent:"space-between",marginTop:"0.7rem",fontSize:"0.74rem",color:"var(--muted)",letterSpacing:"1px"}}>
                          {["Dec 1","Jan 1","Feb 1","Mar 1"].map(d=><span key={d}>{d}</span>)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ══ DAILY CHECK-IN ════════════════════════════════ */}
              {progressTab==="checkin" && (
                <div>
                  <div style={{display:"flex",gap:"0.75rem",marginBottom:"1.5rem",alignItems:"flex-start"}}>
                    <div className="panel" style={{flex:1}}>
                      <div className="ph"><div className="pt">Today's <em>Check-In</em></div>
                        <span style={{fontSize:"0.74rem",color:"var(--gold)"}}>{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</span>
                      </div>
                      <div className="pb">
                        {[
                          {key:"recovery",label:"Recovery",icon:"W",desc:"How recovered do you feel overall?",color:"#4BAE71"},
                          {key:"energy",label:"Energy Level",icon:"",desc:"Physical and mental energy today",color:"#F0C040"},
                          {key:"sleep",label:"Hours Slept",icon:"😴",desc:"Actual hours last night",color:"#6B9FD4",min:0,max:12,step:0.5},
                          {key:"soreness",label:"Muscle Soreness",icon:"",desc:"Body soreness / DOMS level",color:"#C0695E",invert:true},
                          {key:"mood",label:"Mood",icon:"🧠",desc:"Mental state and motivation",color:"#B06AC0"},
                        ].map(({key,label,icon,desc,color,min=1,max=10,step=1,invert})=>(
                          <div key={key} style={{marginBottom:"1.1rem"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.4rem"}}>
                              <div>
                                <span style={{fontSize:"0.88rem",fontWeight:600,color:"var(--ivory)"}}>{icon} {label}</span>
                                <div style={{fontSize:"0.74rem",color:"var(--muted)"}}>{desc}</div>
                              </div>
                              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.8rem",fontWeight:600,color,minWidth:"2.5rem",textAlign:"right"}}>
                                {todayCheckIn[key]}
                              </div>
                            </div>
                            <input type="range" min={min} max={max} step={step} value={todayCheckIn[key]}
                              onChange={e=>setTodayCheckIn(p=>({...p,[key]:parseFloat(e.target.value)}))}
                              style={{width:"100%",accentColor:color}}/>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.68rem",color:"var(--muted)"}}>
                              <span>{invert?"None":(key==="sleep"?"0hrs":min===1?"Poor":"Low")}</span>
                              <span>{invert?"Severe":(key==="sleep"?"12hrs":"Peak")}</span>
                            </div>
                          </div>
                        ))}
                        <div className="f" style={{marginTop:"0.5rem"}}><label className="fl">Notes (optional)</label>
                          <textarea className="fi" placeholder="Any soreness location, fatigue reason, illness…"
                            value={todayCheckIn.notes} onChange={e=>setTodayCheckIn(p=>({...p,notes:e.target.value}))}/>
                        </div>
                        <button className="bg" style={{width:"100%",padding:"0.8rem",marginTop:"0.75rem",fontSize:"0.88rem"}} onClick={()=>{
                          const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
                          const newCI={...todayCheckIn,date};
                          setCheckIns(prev=>[...prev.filter(c=>c.date!==date),newCI]);
                          setCheckInDone(true);
                          if(authUser?.id) saveCheckIn(authUser.id, newCI).catch(e=>console.error("checkIn save:",e));
                          shout("Check-in saved — great work","");
                          setProgressTab("overview");
                        }}>✓ Save Today's Check-In</button>
                      </div>
                    </div>
                    {/* Recent check-ins */}
                    {checkIns.length>0 && (
                      <div style={{width:"240px",flexShrink:0}}>
                        <div style={{fontSize:"0.72rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.75rem"}}>Recent Check-Ins</div>
                        {[...checkIns].reverse().slice(0,7).map((ci,i)=>(
                          <div key={i} style={{background:"var(--smoke)",borderRadius:"var(--r)",padding:"0.6rem 0.75rem",marginBottom:"0.4rem",border:"1px solid var(--border)"}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"0.3rem"}}>
                              <span style={{fontSize:"0.76rem",fontWeight:600,color:"var(--ivory)"}}>{ci.date}</span>
                              <span style={{fontSize:"0.76rem",color:`hsl(${ci.recovery*12},60%,50%)`}}>Recovery {ci.recovery}/10</span>
                            </div>
                            <div style={{display:"flex",gap:"0.6rem",fontSize:"0.72rem",color:"var(--muted)"}}>
                              <span>😴{ci.sleep}h</span><span>{ci.energy}</span><span>🧠{ci.mood}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ══ BODY TRACKING ═════════════════════════════════ */}
              {progressTab==="body" && (
                <div>
                  <div className="two" style={{marginBottom:"1.25rem"}}>
                    {/* Log weight */}
                    <div className="panel">
                      <div className="ph"><div className="pt">Log <em>Weight & Body Fat</em></div></div>
                      <div className="pb">
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.6rem",marginBottom:"0.75rem"}}>
                          <div className="f"><label className="fl">Weight (lbs)</label>
                            <input type="number" className="fi" placeholder={profile.weight||"lbs"} value={newWeight} onChange={e=>setNewWeight(e.target.value)}/>
                          </div>
                          <div className="f"><label className="fl">Body Fat % (optional)</label>
                            <input type="number" className="fi" placeholder="e.g. 14.5" value={newBodyFat} onChange={e=>setNewBodyFat(e.target.value)}/>
                          </div>
                        </div>
                        <button className="bg" style={{width:"100%",padding:"0.7rem"}} onClick={()=>{
                          if(!newWeight){shout("Enter a weight","!");return;}
                          const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
                          const we={date,weight:parseFloat(newWeight),bodyFat:newBodyFat?parseFloat(newBodyFat):null};
                          setWeightLog(prev=>[...prev,we]);
                          setNewWeight(""); setNewBodyFat("");
                          if(authUser?.id) saveWeightEntry(authUser.id,{date,weight:we.weight,body_fat:we.bodyFat}).catch(e=>console.error("weight save:",e));
                          shout(`${newWeight} lbs logged`,"⚖");
                        }}>Log Weight</button>
                      </div>
                    </div>
                    {/* Log measurements */}
                    <div className="panel">
                      <div className="ph"><div className="pt">Body <em>Measurements</em></div></div>
                      <div className="pb">
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem",marginBottom:"0.6rem"}}>
                          {[["chest","Chest (in)"],["waist","Waist (in)"],["hips","Hips (in)"],["arms","Arms (in)"],["thighs","Thighs (in)"]].map(([k,l])=>(
                            <div key={k} className="f" style={{marginBottom:0}}>
                              <label className="fl">{l}</label>
                              <input type="number" className="fi" placeholder="inches" value={newMeasure[k]}
                                onChange={e=>setNewMeasure(p=>({...p,[k]:e.target.value}))}/>
                            </div>
                          ))}
                        </div>
                        <button className="bg" style={{width:"100%",padding:"0.7rem"}} onClick={()=>{
                          const hasData=Object.values(newMeasure).some(v=>v);
                          if(!hasData){shout("Enter at least one measurement","!");return;}
                          const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
                          setMeasurements(prev=>[...prev,{date,...newMeasure}]);
                          setNewMeasure({chest:"",waist:"",hips:"",arms:"",thighs:""});
                          shout("Measurements saved","📏");
                        }}>Save Measurements</button>
                      </div>
                    </div>
                  </div>
                  {/* Weight history table */}
                  {weightLog.length>0 && (
                    <div className="panel" style={{marginBottom:"1.25rem"}}>
                      <div className="ph"><div className="pt">Weight <em>History</em></div>
                        <button className="bsm" style={{fontSize:"0.7rem",color:"var(--muted)"}} onClick={()=>setWeightLog([])}>Clear</button>
                      </div>
                      <div className="pb" style={{overflowX:"auto"}}>
                        {/* Chart */}
                        {weightLog.length>1 && (
                          <svg viewBox="0 0 400 100" style={{width:"100%",marginBottom:"1rem",overflow:"visible"}}>
                            {(() => {
                              const data=weightLog.slice(-16);
                              const wts=data.map(d=>d.weight);
                              const min=Math.min(...wts)-3, max=Math.max(...wts)+3;
                              const pts=data.map((d,i)=>({x:15+(i/(data.length-1||1))*370, y:10+((max-d.weight)/(max-min||1))*75}));
                              const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
                              return (<>
                                <defs><linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#BFA16A" stopOpacity="0.3"/>
                                  <stop offset="100%" stopColor="#BFA16A" stopOpacity="0"/>
                                </linearGradient></defs>
                                <path d={`${path} L${pts[pts.length-1].x},100 L15,100Z`} fill="url(#wg2)"/>
                                <path d={path} fill="none" stroke="#BFA16A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                {pts.map((p,i)=>(
                                  <g key={i}>
                                    <circle cx={p.x} cy={p.y} r="3" fill="#BFA16A" stroke="#141310" strokeWidth="1.5"/>
                                    {(i===0||i===pts.length-1||data[i].bodyFat)&&<text x={p.x} y={p.y-8} textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.65)">{data[i].weight}lbs</text>}
                                  </g>
                                ))}
                              </>);
                            })()}
                          </svg>
                        )}
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.82rem"}}>
                          <thead><tr>
                            {["Date","Weight","Body Fat","Change"].map(h=>(
                              <td key={h} style={{color:"var(--gold)",fontSize:"0.7rem",letterSpacing:"2px",padding:"5px 8px",borderBottom:"1px solid rgba(191,161,106,0.2)"}}>{h}</td>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...weightLog].reverse().slice(0,10).map((w,i,arr)=>{
                              const prev=arr[i+1];
                              const delta=prev?w.weight-prev.weight:null;
                              return (
                                <tr key={i} style={{borderBottom:"1px solid var(--border)"}}>
                                  <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.76rem"}}>{w.date}</td>
                                  <td style={{padding:"5px 8px",color:"var(--ivory)",fontWeight:600}}>{w.weight} lbs</td>
                                  <td style={{padding:"5px 8px",color:"var(--muted)"}}>{w.bodyFat?w.bodyFat+"%":"—"}</td>
                                  <td style={{padding:"5px 8px",color:delta===null?"var(--muted)":delta<0?"#4BAE71":"#C0695E",fontWeight:600}}>
                                    {delta===null?"—":(delta>0?"+":"")+delta.toFixed(1)+" lbs"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {/* Measurements history */}
                  {measurements.length>0 && (
                    <div className="panel">
                      <div className="ph"><div className="pt">Measurements <em>History</em></div>
                        <button className="bsm" style={{fontSize:"0.7rem",color:"var(--muted)"}} onClick={()=>setMeasurements([])}>Clear</button>
                      </div>
                      <div className="pb" style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.82rem"}}>
                          <thead><tr>
                            {["Date","Chest","Waist","Hips","Arms","Thighs"].map(h=>(
                              <td key={h} style={{color:"var(--gold)",fontSize:"0.7rem",letterSpacing:"2px",padding:"5px 8px",borderBottom:"1px solid rgba(191,161,106,0.2)"}}>{h}</td>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...measurements].reverse().slice(0,8).map((m,i)=>(
                              <tr key={i} style={{borderBottom:"1px solid var(--border)"}}>
                                <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.76rem"}}>{m.date}</td>
                                {["chest","waist","hips","arms","thighs"].map(k=>(
                                  <td key={k} style={{padding:"5px 8px",color:"var(--ivory2)"}}>{m[k]?m[k]+'"':"—"}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══ NUTRITION LOG ═════════════════════════════════ */}
              {progressTab==="nutrition" && (()=>{
                // Sum today's food log
                const logCals = Math.round(foodLog.reduce((s,f)=>s+(f.cal||0),0));
                const logProt = Math.round(foodLog.reduce((s,f)=>s+(f.p||0),0));
                const logCarbs= Math.round(foodLog.reduce((s,f)=>s+(f.c||0),0));
                const logFat  = Math.round(foodLog.reduce((s,f)=>s+(f.f||0),0));
                const pTarget = Math.round((parseFloat(profile.weight)||185)*(SPORT_NUTRITION_PROFILES[profile.sport]?.positions?.[profile.position]?.proteinGperLb ?? SPORT_NUTRITION_PROFILES[profile.sport]?.base?.proteinGperLb ?? 0.85));
                const carbTarget = Math.round((totalCals * 0.45) / 4);
                const fatTarget  = Math.round((totalCals * 0.25) / 9);

                // Food search via USDA FoodData Central — proxied through Netlify function
                const searchFood = async (isRetry = false) => {
                  if(!foodQuery.trim()) return;
                  if(!isRetry){ setFoodSearching(true); setFoodResults([]); }
                  // AbortController: cancel if no response in 15s
                  const ctrl = new AbortController();
                  const timeoutId = setTimeout(() => ctrl.abort(), 15000);
                  try {
                    const r = await fetch(
                      `/.netlify/functions/food-search?query=${encodeURIComponent(foodQuery)}`,
                      { signal: ctrl.signal }
                    );
                    clearTimeout(timeoutId);
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const d = await r.json();
                    if (d.error) throw new Error(d.error);
                    const items = (d.foods||[]).filter(f=>f.foodNutrients).map(f=>{
                      const get = (id) => {
                        const n = f.foodNutrients.find(n=>n.nutrientId===id||n.nutrientNumber===String(id));
                        return parseFloat((n?.value||0).toFixed(1));
                      };
                      const cal = get(1008)||get(208)||Math.round((get(1003)*4)+(get(1005)*4)+(get(1004)*9));
                      return {
                        name: f.description,
                        brand: f.brandOwner||f.brandName||"",
                        cal100: Math.round(cal),
                        p100: get(1003)||get(203),
                        c100: get(1005)||get(205),
                        f100: get(1004)||get(204),
                        serving: f.servingSize?(f.servingSize+" "+(f.servingSizeUnit||"g")):"100g",
                        fdcId: f.fdcId,
                      };
                    }).filter(f=>f.cal100>0);
                    setFoodResults(items);
                    if(items.length===0) shout("No results — try a different search term","!");
                  } catch(e) {
                    clearTimeout(timeoutId);
                    // Auto-retry once on timeout/network failure
                    if((e.name==='AbortError'||e.message==='Failed to fetch') && !isRetry){
                      console.warn('Food search: retrying after', e.name);
                      return searchFood(true);
                    }
                    shout(e.name==='AbortError' ? "Search timed out — try again" : "Food search failed — check connection","!");
                  } finally {
                    setFoodSearching(false);
                  }
                };

                const addFoodToLog = () => {
                  if(!selectedFood) return;
                  const qty = parseFloat(foodQty)||100;
                  const scale = qty/100;
                  const item = {
                    id: Date.now(),
                    name: selectedFood.name,
                    brand: selectedFood.brand,
                    qty, unit:"g",
                    cal: Math.round(selectedFood.cal100*scale),
                    p: parseFloat((selectedFood.p100*scale).toFixed(1)),
                    c: parseFloat((selectedFood.c100*scale).toFixed(1)),
                    f: parseFloat((selectedFood.f100*scale).toFixed(1)),
                  };
                  setFoodLog(prev=>[...prev,item]);
                  setSelectedFood(null); setFoodQty("100"); setFoodResults([]);
                  shout(`${item.name} added`,"🥗");
                };

                const addCustomToLog = () => {
                  if(!customFood.name||!customFood.cal){shout("Enter food name and calories","!");return;}
                  const qty = parseFloat(customFood.qty)||1;
                  setFoodLog(prev=>[...prev,{id:Date.now(),name:customFood.name,qty,unit:customFood.unit,
                    cal:Math.round(parseFloat(customFood.cal)||0),p:parseFloat(customFood.protein)||0,
                    c:parseFloat(customFood.carbs)||0,f:parseFloat(customFood.fat)||0}]);
                  setCustomFood({name:"",cal:"",protein:"",carbs:"",fat:"",qty:"1",unit:"serving"});
                  shout("Food added","🥗");
                };

                const saveDay = () => {
                  if(logCals===0&&!todayNutrition.calories){shout("Add foods or enter calories first","!");return;}
                  const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
                  const ne={date,
                    calories:logCals||parseFloat(todayNutrition.calories)||0,
                    protein:logProt||parseFloat(todayNutrition.protein)||0,
                    carbs:logCarbs||parseFloat(todayNutrition.carbs)||0,
                    fat:logFat||parseFloat(todayNutrition.fat)||0,
                    water:todayNutrition.water||0,
                  };
                  setNutritionLog(prev=>[...prev.filter(n=>n.date!==date),ne]);
                  setFoodLog([]); setTodayNutrition({calories:"",protein:"",carbs:"",fat:"",water:""});
                  if(authUser?.id) saveNutritionEntry(authUser.id,ne).catch(e=>console.error("nutrition save:",e));
                  shout("Day logged ✓","🥗");
                };

                return (
                <div>
                  {/* Macro targets header */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.75rem",marginBottom:"1.25rem"}}>
                    {[
                      ["Calories",logCals,totalCals,"#BFA16A","kcal"],
                      ["Protein",logProt,pTarget,"#4BAE71","g"],
                      ["Carbs",logCarbs,carbTarget,"#6B9FD4","g"],
                      ["Fat",logFat,fatTarget,"#C0695E","g"],
                    ].map(([label,val,target,col,unit])=>(
                      <div key={label} style={{background:"var(--smoke)",border:`1px solid ${val>0?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.04)"}`,borderRadius:"var(--r)",padding:"0.75rem"}}>
                        <div style={{fontSize:"0.65rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.3rem"}}>{label}</div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.4rem",fontWeight:600,color:val>target?"#C0695E":val>0?"#4BAE71":"var(--muted)"}}>
                          {val}<span style={{fontSize:"0.8rem",color:"var(--muted)"}}> / {target}{unit}</span>
                        </div>
                        <div style={{marginTop:"0.4rem",height:"4px",background:"rgba(255,255,255,0.06)",borderRadius:"2px"}}>
                          <div style={{width:`${Math.min(100,(val/target)*100)}%`,height:"100%",background:val>target?"#C0695E":col,borderRadius:"2px",transition:"width 0.3s"}}/>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mode tabs */}
                  <div style={{display:"flex",gap:"0.5rem",marginBottom:"1rem"}}>
                    {[["search","🔍 Food Search"],["manual","✏ Manual Entry"],["calculator","📐 Macro Calculator"]].map(([m,l])=>(
                      <button key={m} className={`bsm${macroMode===m?" on":""}`}
                        style={macroMode===m?{background:"var(--gold)",color:"#0E0D0B",borderColor:"var(--gold)"}:{}}
                        onClick={()=>setMacroMode(m)}>{l}</button>
                    ))}
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.25rem"}}>

                    {/* LEFT — input panel */}
                    <div>
                      {macroMode==="search" && (
                        <div className="panel">
                          <div className="ph"><div className="pt">Food <em>Search</em></div>
                            <span style={{fontSize:"0.72rem",color:"var(--muted)"}}>USDA FoodData Central</span>
                          </div>
                          <div className="pb">
                            <div style={{display:"flex",gap:"0.5rem",marginBottom:"0.75rem"}}>
                              <input className="fi" style={{flex:1,fontSize:"0.82rem"}} placeholder="Search any food, brand, or ingredient..."
                                value={foodQuery} onChange={e=>setFoodQuery(e.target.value)}
                                onKeyDown={e=>e.key==="Enter"&&searchFood()}/>
                              <button className="bg" style={{padding:"0.5rem 1rem",flexShrink:0}} onClick={searchFood}>
                                {foodSearching?"...":"Search"}
                              </button>
                            </div>
                            {/* Results */}
                            {foodResults.length>0 && (
                              <div style={{maxHeight:"280px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"0.3rem"}}>
                                {foodResults.map((f,i)=>(
                                  <div key={i} style={{
                                    padding:"0.55rem 0.75rem",borderRadius:"var(--r)",cursor:"pointer",
                                    background:selectedFood===f?"rgba(191,161,106,0.1)":"rgba(255,255,255,0.02)",
                                    border:`1px solid ${selectedFood===f?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.05)"}`,
                                    transition:"all 0.15s"
                                  }} onClick={()=>setSelectedFood(f)}>
                                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{fontSize:"0.8rem",color:selectedFood===f?"var(--gold)":"var(--ivory2)",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                                        {f.brand&&<div style={{fontSize:"0.68rem",color:"var(--muted)"}}>{f.brand}</div>}
                                      </div>
                                      <div style={{fontSize:"0.78rem",color:"var(--gold)",fontWeight:700,flexShrink:0,marginLeft:"0.5rem"}}>{f.cal100} kcal</div>
                                    </div>
                                    <div style={{display:"flex",gap:"0.75rem",marginTop:"0.2rem",fontSize:"0.68rem",color:"var(--muted)"}}>
                                      <span>P: {f.p100}g</span><span>C: {f.c100}g</span><span>F: {f.f100}g</span>
                                      <span style={{color:"rgba(255,255,255,0.3)"}}>per 100g</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {selectedFood && (
                              <div style={{marginTop:"0.75rem",padding:"0.75rem",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"var(--r)"}}>
                                <div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--gold)",marginBottom:"0.5rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selectedFood.name}</div>
                                <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
                                  <label className="fl" style={{flexShrink:0,marginBottom:0}}>Quantity (g)</label>
                                  <input type="number" className="fi" style={{width:"90px",fontSize:"0.82rem"}}
                                    value={foodQty} onChange={e=>setFoodQty(e.target.value)}/>
                                  <div style={{fontSize:"0.76rem",color:"var(--muted)"}}>
                                    = {Math.round(selectedFood.cal100*(parseFloat(foodQty)||100)/100)} kcal
                                  </div>
                                  <button className="bg" style={{padding:"0.4rem 0.75rem",fontSize:"0.78rem",marginLeft:"auto"}} onClick={addFoodToLog}>Add</button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {macroMode==="manual" && (
                        <div className="panel">
                          <div className="ph"><div className="pt">Manual <em>Entry</em></div></div>
                          <div className="pb">
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem"}}>
                              <div className="f" style={{gridColumn:"1/-1",marginBottom:0}}>
                                <label className="fl">Food Name</label>
                                <input className="fi" style={{fontSize:"0.82rem"}} placeholder="e.g. Chicken Breast"
                                  value={customFood.name} onChange={e=>setCustomFood(p=>({...p,name:e.target.value}))}/>
                              </div>
                              {[["cal","Calories (kcal)","#BFA16A"],["protein","Protein (g)","#4BAE71"],["carbs","Carbs (g)","#6B9FD4"],["fat","Fat (g)","#C0695E"]].map(([k,l,col])=>(
                                <div key={k} className="f" style={{marginBottom:0}}>
                                  <label className="fl" style={{color:col}}>{l}</label>
                                  <input type="number" className="fi" style={{fontSize:"0.82rem"}}
                                    value={customFood[k]} onChange={e=>setCustomFood(p=>({...p,[k]:e.target.value}))}/>
                                </div>
                              ))}
                              <div className="f" style={{marginBottom:0}}>
                                <label className="fl">Qty</label>
                                <input type="number" className="fi" style={{fontSize:"0.82rem"}}
                                  value={customFood.qty} onChange={e=>setCustomFood(p=>({...p,qty:e.target.value}))}/>
                              </div>
                              <div className="f" style={{marginBottom:0}}>
                                <label className="fl">Unit</label>
                                <select className="fi" style={{fontSize:"0.82rem"}} value={customFood.unit}
                                  onChange={e=>setCustomFood(p=>({...p,unit:e.target.value}))}>
                                  {["serving","g","oz","cup","tbsp","tsp","slice","piece"].map(u=><option key={u}>{u}</option>)}
                                </select>
                              </div>
                            </div>
                            <button className="bg" style={{width:"100%",padding:"0.65rem",marginTop:"0.75rem"}} onClick={addCustomToLog}>+ Add to Today</button>
                          </div>
                        </div>
                      )}

                      {macroMode==="calculator" && (
                        <div className="panel">
                          <div className="ph"><div className="pt">Macro <em>Calculator</em></div>
                            <span style={{fontSize:"0.72rem",color:"var(--muted)"}}>Mifflin-St Jeor formula</span>
                          </div>
                          <div className="pb">
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem",marginBottom:"0.75rem"}}>
                              {[["weight","Weight (lbs)","number",profile.weight||""],["height","Height (in)","number",profile.height||""],["age","Age","number",profile.age||""]].map(([k,l,t,ph])=>(
                                <div key={k} className="f" style={{marginBottom:0}}>
                                  <label className="fl">{l}</label>
                                  <input type={t} className="fi" style={{fontSize:"0.82rem"}} placeholder={ph||l}
                                    value={macroCalcInputs[k]} onChange={e=>setMacroCalcInputs(p=>({...p,[k]:e.target.value}))}/>
                                </div>
                              ))}
                              <div className="f" style={{marginBottom:0}}>
                                <label className="fl">Sex</label>
                                <select className="fi" style={{fontSize:"0.82rem"}} value={macroCalcInputs.sex}
                                  onChange={e=>setMacroCalcInputs(p=>({...p,sex:e.target.value}))}>
                                  <option value="male">Male</option><option value="female">Female</option>
                                </select>
                              </div>
                              <div className="f" style={{gridColumn:"1/-1",marginBottom:0}}>
                                <label className="fl">Activity Level</label>
                                <select className="fi" style={{fontSize:"0.82rem"}} value={macroCalcInputs.activityLevel}
                                  onChange={e=>setMacroCalcInputs(p=>({...p,activityLevel:e.target.value}))}>
                                  {[["sedentary","Sedentary (desk job, no exercise)"],["light","Light (1–3 days/week)"],["moderate","Moderate (3–5 days/week)"],["active","Active (6–7 days/week)"],["veryactive","Very Active (2x/day training)"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                              <div className="f" style={{gridColumn:"1/-1",marginBottom:0}}>
                                <label className="fl">Goal</label>
                                <select className="fi" style={{fontSize:"0.82rem"}} value={macroCalcInputs.goal}
                                  onChange={e=>setMacroCalcInputs(p=>({...p,goal:e.target.value}))}>
                                  {[["cut","Cut (lose fat)"],["maintain","Maintain"],["bulk","Bulk (gain muscle)"],["agg_bulk","Aggressive Bulk"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                            </div>
                            {/* Calculate and show results */}
                            {(()=>{
                              const w=parseFloat(macroCalcInputs.weight);const h=parseFloat(macroCalcInputs.height);const a=parseFloat(macroCalcInputs.age);
                              if(!w||!h||!a) return <div style={{fontSize:"0.78rem",color:"var(--muted)",textAlign:"center",padding:"0.5rem"}}>Enter weight, height, and age to calculate</div>;
                              const wKg=w*0.453592;const hCm=h*2.54;
                              const bmr=macroCalcInputs.sex==="male"?(10*wKg)+(6.25*hCm)-(5*a)+5:(10*wKg)+(6.25*hCm)-(5*a)-161;
                              const acts={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryactive:1.9};
                              const tdee=Math.round(bmr*(acts[macroCalcInputs.activityLevel]||1.55));
                              const goalAdj={cut:tdee-500,maintain:tdee,bulk:tdee+300,agg_bulk:tdee+600};
                              const cals=goalAdj[macroCalcInputs.goal]||tdee;
                              const prot=Math.round(w*1.0);const protCals=prot*4;
                              const fatCals=Math.round(cals*0.25);const fatG=Math.round(fatCals/9);
                              const carbCals=cals-protCals-fatCals;const carbG=Math.round(Math.max(carbCals,0)/4);
                              return (
                                <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                                  <div style={{fontSize:"0.7rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.6rem",fontWeight:600}}>Your Daily Targets</div>
                                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.5rem",marginBottom:"0.75rem"}}>
                                    {[["Calories",cals,"kcal","#BFA16A"],["Protein",prot,"g","#4BAE71"],["Carbs",carbG,"g","#6B9FD4"],["Fat",fatG,"g","#C0695E"]].map(([l,v,u,col])=>(
                                      <div key={l} style={{textAlign:"center"}}>
                                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.4rem",fontWeight:600,color:col}}>{v}</div>
                                        <div style={{fontSize:"0.65rem",color:"var(--muted)"}}>{l} {u}</div>
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{fontSize:"0.72rem",color:"var(--muted)",marginBottom:"0.5rem"}}>TDEE: {tdee.toLocaleString()} kcal · BMR: {Math.round(bmr).toLocaleString()} kcal</div>
                                  <button className="bsm" style={{fontSize:"0.74rem",width:"100%",padding:"0.45rem"}}
                                    onClick={()=>shout(`Targets: ${cals} kcal / ${prot}g protein / ${carbG}g carbs / ${fatG}g fat`,"📐")}>
                                    Apply These Targets
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* RIGHT — today's food log */}
                    <div className="panel">
                      <div className="ph">
                        <div className="pt">Today's <em>Food Log</em></div>
                        <span style={{fontSize:"0.72rem",color:"var(--muted)"}}>{foodLog.length} items · {logCals} kcal</span>
                      </div>
                      <div className="pb">
                        {foodLog.length===0 && (
                          <div style={{textAlign:"center",padding:"1.5rem 0",color:"var(--muted)",fontSize:"0.78rem"}}>
                            No foods logged yet — search or add manually
                          </div>
                        )}
                        {foodLog.map((f,i)=>(
                          <div key={f.id} style={{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0.45rem 0",borderBottom:"1px solid var(--border)"}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:"0.8rem",color:"var(--ivory2)",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                              <div style={{fontSize:"0.68rem",color:"var(--muted)"}}>{f.qty}{f.unit} · P:{f.p}g C:{f.c}g F:{f.f}g</div>
                            </div>
                            <div style={{fontSize:"0.82rem",color:"var(--gold)",fontWeight:700,flexShrink:0}}>{f.cal} kcal</div>
                            <button style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",fontSize:"0.8rem",padding:"2px 6px",flexShrink:0}}
                              onClick={()=>setFoodLog(prev=>prev.filter(x=>x.id!==f.id))}>✕</button>
                          </div>
                        ))}
                        {foodLog.length>0 && (
                          <div style={{marginTop:"0.75rem",padding:"0.6rem 0.75rem",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(191,161,106,0.15)",borderRadius:"var(--r)"}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.78rem",marginBottom:"0.3rem"}}>
                              <span style={{color:"var(--muted)"}}>Total</span>
                              <span style={{color:"var(--gold)",fontWeight:700}}>{logCals} / {totalCals} kcal</span>
                            </div>
                            <div style={{display:"flex",gap:"1rem",fontSize:"0.72rem"}}>
                              <span style={{color:"#4BAE71"}}>P: {logProt}g</span>
                              <span style={{color:"#6B9FD4"}}>C: {logCarbs}g</span>
                              <span style={{color:"#C0695E"}}>F: {logFat}g</span>
                            </div>
                          </div>
                        )}
                        {/* Water + save */}
                        <div style={{marginTop:"0.75rem",display:"flex",gap:"0.5rem",alignItems:"center"}}>
                          <div style={{flex:1}}>
                            <label className="fl" style={{color:"#5BB8D4"}}>Water (oz)</label>
                            <input type="number" className="fi" placeholder="64" style={{fontSize:"0.82rem"}}
                              value={todayNutrition.water} onChange={e=>setTodayNutrition(p=>({...p,water:e.target.value}))}/>
                          </div>
                          <button className="bg" style={{marginTop:"1.2rem",padding:"0.6rem 1rem",flexShrink:0}} onClick={saveDay}>
                            ✓ Save Day
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Nutrition history */}
                  {nutritionLog.length>0 && (
                    <div className="panel">
                      <div className="ph"><div className="pt">Nutrition <em>Log History</em></div>
                        <div style={{display:"flex",gap:"0.5rem",alignItems:"center"}}>
                          <span style={{fontSize:"0.74rem",color:"var(--muted)"}}>
                            Avg: {Math.round(nutritionLog.reduce((s,n)=>s+(parseFloat(n.calories)||0),0)/nutritionLog.length).toLocaleString()} kcal
                          </span>
                          <button className="bsm" style={{fontSize:"0.7rem",color:"var(--muted)"}} onClick={()=>setNutritionLog([])}>Clear</button>
                        </div>
                      </div>
                      <div className="pb" style={{overflowX:"auto"}}>
                        {/* Calorie bars */}
                        <div style={{marginBottom:"1rem"}}>
                          {nutritionLog.slice(-7).map((n,i)=>{
                            const pct=Math.min(100,((parseFloat(n.calories)||0)/totalCals)*100);
                            const over=parseFloat(n.calories)>totalCals;
                            return (
                              <div key={i} style={{marginBottom:"0.4rem",display:"flex",alignItems:"center",gap:"0.6rem"}}>
                                <div style={{fontSize:"0.72rem",color:"var(--muted)",width:"80px",flexShrink:0}}>{n.date}</div>
                                <div style={{flex:1,height:"18px",background:"var(--smoke)",borderRadius:"3px",overflow:"hidden"}}>
                                  <div style={{width:`${pct}%`,height:"100%",background:over?"#C0695E":"#4BAE71",borderRadius:"3px",transition:"width 0.3s"}}/>
                                </div>
                                <div style={{fontSize:"0.76rem",color:over?"#C0695E":"#4BAE71",fontWeight:600,width:"80px",flexShrink:0,textAlign:"right"}}>
                                  {parseFloat(n.calories).toLocaleString()} kcal
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.82rem"}}>
                          <thead><tr>
                            {["Date","Calories","Protein","Carbs","Fat","Water"].map(h=>(
                              <td key={h} style={{color:"var(--gold)",fontSize:"0.7rem",letterSpacing:"2px",padding:"5px 8px",borderBottom:"1px solid rgba(191,161,106,0.2)"}}>{h}</td>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...nutritionLog].reverse().slice(0,10).map((n,i)=>(
                              <tr key={i} style={{borderBottom:"1px solid var(--border)"}}>
                                <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.76rem"}}>{n.date}</td>
                                <td style={{padding:"5px 8px",color:parseFloat(n.calories)>totalCals?"#C0695E":"#4BAE71",fontWeight:600}}>{n.calories?parseFloat(n.calories).toLocaleString():"—"}</td>
                                <td style={{padding:"5px 8px",color:"var(--ivory2)"}}>{n.protein?n.protein+"g":"—"}</td>
                                <td style={{padding:"5px 8px",color:"var(--ivory2)"}}>{n.carbs?n.carbs+"g":"—"}</td>
                                <td style={{padding:"5px 8px",color:"var(--ivory2)"}}>{n.fat?n.fat+"g":"—"}</td>
                                <td style={{padding:"5px 8px",color:"var(--ivory2)"}}>{n.water?n.water+"oz":"—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
                );
              })()}

              {/* ══ PERFORMANCE BENCHMARKS ════════════════════════ */}
              {progressTab==="performance" && (
                <div>
                  <div className="two" style={{marginBottom:"1.25rem"}}>
                    <div className="panel">
                      <div className="ph"><div className="pt">Log <em>Performance Test</em></div></div>
                      <div className="pb">
                        <div className="f"><label className="fl">Test</label>
                          <select className="fi" value={newBench.test} onChange={e=>{
                            const units={"40-Yard Dash":"sec","Pro Agility (5-10-5)":"sec","Vertical Jump":"inches","Broad Jump":"inches","Bench Press 1RM":"lbs","Squat 1RM":"lbs","Deadlift 1RM":"lbs","Power Clean 1RM":"lbs","Sprint 100m":"sec","Mile Run":"min","VO2 Max":"ml/kg/min","Push-Up Max":"reps","Pull-Up Max":"reps","Plank Hold":"sec","Custom":""};
                            setNewBench(p=>({...p,test:e.target.value,unit:units[e.target.value]||""}));
                          }}>
                            {["40-Yard Dash","Pro Agility (5-10-5)","Vertical Jump","Broad Jump","Bench Press 1RM","Squat 1RM","Deadlift 1RM","Power Clean 1RM","Sprint 100m","Mile Run","VO2 Max","Push-Up Max","Pull-Up Max","Plank Hold","Custom"].map(t=><option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:"0.6rem"}}>
                          <div className="f"><label className="fl">Result</label>
                            <input type="number" className="fi" placeholder="Value" step="0.01"
                              value={newBench.value} onChange={e=>setNewBench(p=>({...p,value:e.target.value}))}/>
                          </div>
                          <div className="f"><label className="fl">Unit</label>
                            <input className="fi" placeholder="sec / lbs / in" value={newBench.unit}
                              onChange={e=>setNewBench(p=>({...p,unit:e.target.value}))}/>
                          </div>
                        </div>
                        <div className="f"><label className="fl">Notes</label>
                          <input className="fi" placeholder="Conditions, surface, equipment…" value={newBench.notes}
                            onChange={e=>setNewBench(p=>({...p,notes:e.target.value}))}/>
                        </div>
                        <button className="bg" style={{width:"100%",padding:"0.72rem"}} onClick={()=>{
                          if(!newBench.value){shout("Enter a result value","!");return;}
                          const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
                          const be={date,...newBench};
                          setBenchmarks(prev=>[...prev,be]);
                          setNewBench(p=>({...p,value:"",notes:""}));
                          if(authUser?.id) saveBenchmark(authUser.id,be).catch(e=>console.error("benchmark save:",e));
                          shout(`${newBench.test}: ${newBench.value} ${newBench.unit} logged`,"");
                        }}>✓ Log Result</button>
                      </div>
                    </div>

                    {/* Sport-specific benchmark targets */}
                    <div className="panel">
                      <div className="ph"><div className="pt"><span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.65rem",fontWeight:700,letterSpacing:"1px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:"3px",padding:"1px 5px",marginRight:"0.3rem"}}>{sport.icon}</span> {sport.label} <em>Elite Standards</em></div></div>
                      <div className="pb">
                        <div style={{fontSize:"0.78rem",color:"var(--muted)",marginBottom:"0.75rem",fontStyle:"italic"}}>Industry benchmarks for elite {sport.label} athletes at your position</div>
                        {(()=>{
                          const standards = {
                            football: {
                              "_default":       [["40-Yard Dash","4.6–4.9","sec"],["Bench Press 1RM","275+","lbs"],["Vertical Jump","30–35","in"],["Pro Agility","4.3–4.7","sec"]],
                              "Quarterback":    [["40-Yard Dash","4.6–4.9","sec"],["Bench Press 1RM","225+","lbs"],["Vertical Jump","28–33","in"],["Pro Agility","4.4–4.6","sec"]],
                              "Running Back":   [["40-Yard Dash","4.4–4.6","sec"],["Bench Press 1RM","280+","lbs"],["Vertical Jump","33–38","in"],["Broad Jump","115–125","in"]],
                              "Wide Receiver":  [["40-Yard Dash","4.3–4.5","sec"],["Vertical Jump","35–40","in"],["Pro Agility","4.1–4.3","sec"],["Broad Jump","118–128","in"]],
                              "Tight End":      [["40-Yard Dash","4.5–4.7","sec"],["Bench Press 1RM","275+","lbs"],["Vertical Jump","30–36","in"],["Pro Agility","4.3–4.6","sec"]],
                              "Offensive Lineman":[["40-Yard Dash","4.9–5.2","sec"],["Bench Press 1RM","400+","lbs"],["Squat 1RM","500+","lbs"]],
                              "Defensive End":  [["40-Yard Dash","4.6–4.8","sec"],["Bench Press 1RM","315+","lbs"],["Squat 1RM","405+","lbs"],["Vertical Jump","30–35","in"]],
                              "Linebacker":     [["40-Yard Dash","4.5–4.7","sec"],["Bench Press 1RM","315+","lbs"],["Vertical Jump","32–36","in"],["Pro Agility","4.2–4.5","sec"]],
                              "Cornerback":     [["40-Yard Dash","4.3–4.5","sec"],["Vertical Jump","36–40","in"],["Pro Agility","4.0–4.3","sec"],["Broad Jump","120–130","in"]],
                              "Safety":         [["40-Yard Dash","4.4–4.6","sec"],["Vertical Jump","34–38","in"],["Pro Agility","4.1–4.4","sec"],["Bench Press 1RM","260+","lbs"]],
                              "Kicker":         [["40-Yard Dash","4.8–5.1","sec"],["Vertical Jump","26–30","in"],["Pro Agility","4.5–4.8","sec"]],
                            },
                            basketball: {
                              "_default":       [["Vertical Jump","28–34","in"],["Pro Agility","4.2–4.5","sec"],["Sprint 3/4 Court","3.3–3.6","sec"],["Bench Press 1RM","185+","lbs"]],
                              "Point Guard":    [["Sprint 3/4 Court","3.1–3.4","sec"],["Vertical Jump","35–40","in"],["Pro Agility","4.1–4.3","sec"]],
                              "Shooting Guard": [["Sprint 3/4 Court","3.2–3.5","sec"],["Vertical Jump","34–39","in"],["Pro Agility","4.1–4.4","sec"]],
                              "Small Forward":  [["Vertical Jump","32–38","in"],["Pro Agility","4.2–4.5","sec"],["Bench Press 1RM","225+","lbs"]],
                              "Power Forward":  [["Vertical Jump","30–36","in"],["Bench Press 1RM","275+","lbs"],["Pro Agility","4.3–4.6","sec"]],
                              "Center":         [["Vertical Jump","28–34","in"],["Bench Press 1RM","315+","lbs"],["Pro Agility","4.5–4.8","sec"]],
                            },
                            soccer: {
                              "_default":       [["Sprint 100m","11.0–12.0","sec"],["Vertical Jump","24–30","in"],["VO2 Max","55–65","ml/kg/min"],["Pro Agility","4.2–4.5","sec"]],
                              "Goalkeeper":     [["Vertical Jump","28–34","in"],["Pro Agility","4.3–4.6","sec"],["Reaction Sprint 5m","0.95–1.05","sec"]],
                              "Center Back":    [["Sprint 100m","11.2–12.0","sec"],["Vertical Jump","26–32","in"],["Bench Press 1RM","185+","lbs"]],
                              "Full Back":      [["Sprint 100m","11.0–11.8","sec"],["VO2 Max","58–65","ml/kg/min"],["Pro Agility","4.2–4.4","sec"]],
                              "Defensive Mid":  [["VO2 Max","60–68","ml/kg/min"],["Sprint 100m","11.2–12.0","sec"],["Pro Agility","4.2–4.5","sec"]],
                              "Central Mid":    [["VO2 Max","58–66","ml/kg/min"],["Sprint 100m","11.0–11.8","sec"],["Vertical Jump","24–30","in"]],
                              "Winger":         [["Sprint 100m","10.6–11.4","sec"],["VO2 Max","57–65","ml/kg/min"],["Pro Agility","4.1–4.4","sec"]],
                              "Striker":        [["Sprint 100m","10.8–11.5","sec"],["Vertical Jump","26–32","in"],["Pro Agility","4.1–4.4","sec"]],
                            },
                            hockey: {
                              "_default":       [["Pro Agility","4.2–4.5","sec"],["Vertical Jump","26–32","in"],["Bench Press 1RM","250+","lbs"],["Squat 1RM","350+","lbs"]],
                              "Goalie":         [["Pro Agility","4.3–4.6","sec"],["Vertical Jump","24–30","in"],["Lateral 5-Step","1.6–1.9","sec"]],
                              "Defenseman":     [["Pro Agility","4.3–4.6","sec"],["Vertical Jump","26–32","in"],["Bench Press 1RM","275+","lbs"]],
                              "Left Wing":      [["Pro Agility","4.1–4.4","sec"],["Vertical Jump","28–34","in"],["Bench Press 1RM","225+","lbs"]],
                              "Right Wing":     [["Pro Agility","4.1–4.4","sec"],["Vertical Jump","28–34","in"],["Bench Press 1RM","225+","lbs"]],
                              "Center":         [["Pro Agility","4.2–4.5","sec"],["Vertical Jump","28–34","in"],["VO2 Max","55–62","ml/kg/min"]],
                            },
                            volleyball: {
                              "_default":       [["Vertical Jump","28–36","in"],["Pro Agility","4.2–4.5","sec"],["Broad Jump","100–115","in"],["Approach Jump","34–40","in"]],
                              "Setter":         [["Vertical Jump","28–34","in"],["Pro Agility","4.1–4.4","sec"],["Sprint 20m","3.0–3.3","sec"]],
                              "Libero":         [["Pro Agility","4.0–4.3","sec"],["Sprint 20m","2.9–3.2","sec"],["Vertical Jump","24–30","in"]],
                              "Outside Hitter": [["Approach Jump","34–40","in"],["Vertical Jump","32–38","in"],["Pro Agility","4.2–4.5","sec"]],
                              "Middle Blocker": [["Approach Jump","36–42","in"],["Vertical Jump","34–40","in"],["Pro Agility","4.2–4.5","sec"]],
                              "Opposite Hitter":[["Approach Jump","34–40","in"],["Vertical Jump","32–38","in"],["Bench Press 1RM","185+","lbs"]],
                              "Right Side":     [["Approach Jump","34–40","in"],["Vertical Jump","30–36","in"],["Pro Agility","4.2–4.5","sec"]],
                            },
                          };
                          const sportStds = standards[profile.sport]||{};
                          const posStds = sportStds[profile.position]||sportStds["_default"]||[];
                          return posStds.map(([test,target,unit])=>{
                            // Normalize test name: strip parenthetical suffixes for matching
                            // e.g. "Pro Agility (5-10-5)" matches standard "Pro Agility"
                            const normTest = t => t.toLowerCase().replace(/\s*\(.*?\)/g,'').trim();
                            const myBest = benchmarks.filter(b=>normTest(b.test)===normTest(test)).sort((a,b)=>parseFloat(a.value)-parseFloat(b.value))[0];
                            return (
                              <div key={test} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.45rem 0",borderBottom:"1px solid var(--border)"}}>
                                <div>
                                  <div style={{fontSize:"0.84rem",color:"var(--ivory2)",fontWeight:500}}>{test}</div>
                                  <div style={{fontSize:"0.72rem",color:"var(--muted)"}}>Elite target: {target} {unit}</div>
                                </div>
                                <div style={{textAlign:"right"}}>
                                  {myBest ? <div style={{fontSize:"0.88rem",fontWeight:700,color:"#4BAE71"}}>{myBest.value} {myBest.unit}</div>
                                    : <div style={{fontSize:"0.76rem",color:"var(--muted)",fontStyle:"italic"}}>Not tested</div>}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Benchmarks history */}
                  {benchmarks.length>0 && (
                    <div className="panel">
                      <div className="ph"><div className="pt">Performance <em>History</em></div>
                        <button className="bsm" style={{fontSize:"0.7rem",color:"var(--muted)"}} onClick={()=>setBenchmarks([])}>Clear</button>
                      </div>
                      <div className="pb" style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.82rem"}}>
                          <thead><tr>
                            {["Date","Test","Result","Notes"].map(h=>(
                              <td key={h} style={{color:"var(--gold)",fontSize:"0.7rem",letterSpacing:"2px",padding:"5px 8px",borderBottom:"1px solid rgba(191,161,106,0.2)"}}>{h}</td>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...benchmarks].reverse().map((b,i)=>(
                              <tr key={i} style={{borderBottom:"1px solid var(--border)"}}>
                                <td style={{padding:"5px 8px",color:"var(--muted)",fontSize:"0.76rem"}}>{b.date}</td>
                                <td style={{padding:"5px 8px",color:"var(--ivory2)",fontWeight:500}}>{b.test}</td>
                                <td style={{padding:"5px 8px",color:"#4BAE71",fontWeight:700}}>{b.value} {b.unit}</td>
                                <td style={{padding:"5px 8px",color:"var(--muted)",fontStyle:"italic",fontSize:"0.74rem"}}>{b.notes}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══ PROGRESS PHOTOS ═══════════════════════════════ */}
              {progressTab==="photos" && (
                <div>
                  <div className="panel" style={{marginBottom:"1.5rem"}}>
                    <div className="ph">
                      <div className="pt">Progress <em>Photos</em></div>
                      <span style={{fontSize:"0.74rem",color:"var(--muted)"}}>{progressPhotos.length} photo{progressPhotos.length!==1?"s":""} logged</span>
                    </div>
                    <div className="pb">
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1.25rem"}}>
                        <div style={{display:"flex",flexDirection:"column",gap:"0.6rem"}}>
                          <input type="file" accept="image/*" id="prog-file-inp" style={{display:"none"}}
                            onChange={e=>{
                              const file=e.target.files?.[0]; if(!file) return;
                              const reader=new FileReader();
                              reader.onload=ev=>{
                                const id=Date.now().toString();
                                const date=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
                                setProgressPhotos(prev=>[{id,date,dataUrl:ev.target.result,label:photoLabel||"Progress",weight:photoWeight,note:photoNote},...prev]);
                                setPhotoNote(""); setPhotoWeight("");
                                shout("Progress photo saved","");
                                document.getElementById("prog-file-inp").value="";
                              };
                              reader.readAsDataURL(file);
                            }}/>
                          <input type="file" accept="image/*" capture="environment" id="prog-cam-inp" style={{display:"none"}}
                            onChange={e=>{
                              const file=e.target.files?.[0]; if(!file) return;
                              const reader=new FileReader();
                              reader.onload=ev=>{
                                const id=Date.now().toString();
                                const date=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
                                setProgressPhotos(prev=>[{id,date,dataUrl:ev.target.result,label:photoLabel||"Progress",weight:photoWeight,note:photoNote},...prev]);
                                setPhotoNote(""); setPhotoWeight("");
                                shout("Photo captured and saved","");
                                document.getElementById("prog-cam-inp").value="";
                              };
                              reader.readAsDataURL(file);
                            }}/>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
                            {/* Upload from File — premium gold */}
                            <label htmlFor="prog-file-inp" style={{display:"block",cursor:"pointer"}}>
                              <div style={{
                                position:"relative",overflow:"hidden",
                                background:"var(--slate)",
                                border:"1px solid rgba(255,255,255,0.1)",
                                borderRadius:"16px",padding:"1.75rem 1rem",
                                display:"flex",flexDirection:"column",alignItems:"center",gap:"0.65rem",
                                transition:"all 0.25s ease",
                              }}
                              onMouseEnter={e=>{e.currentTarget.style.background="linear-gradient(145deg,rgba(191,161,106,0.22) 0%,rgba(191,161,106,0.08) 100%)";e.currentTarget.style.borderColor="rgba(191,161,106,0.65)";e.currentTarget.style.transform="translateY(-2px)";}}
                              onMouseLeave={e=>{e.currentTarget.style.background="linear-gradient(145deg,rgba(191,161,106,0.12) 0%,rgba(191,161,106,0.04) 100%)";e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";e.currentTarget.style.transform="translateY(0)";}}>
                                {/* Ambient glow */}
                                <div style={{position:"absolute",top:"-30px",left:"50%",transform:"translateX(-50%)",width:"80px",height:"80px",background:"rgba(255,255,255,0.05)",borderRadius:"50%",filter:"blur(20px)",pointerEvents:"none"}}/>
                                {/* Icon */}
                                <div style={{position:"relative",width:"48px",height:"48px",borderRadius:"12px",background:"rgba(191,161,106,0.15)",border:"1px solid rgba(255,255,255,0.09)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BFA16A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="17 8 12 3 7 8"/>
                                    <line x1="12" y1="3" x2="12" y2="15"/>
                                  </svg>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:"0.88rem",fontWeight:600,color:"var(--gold)",letterSpacing:"0.3px",marginBottom:"0.2rem"}}>Upload Photo</div>
                                  <div style={{fontSize:"0.72rem",color:"rgba(255,255,255,0.18)",letterSpacing:"1px"}}>JPG · PNG · HEIC</div>
                                </div>
                              </div>
                            </label>

                            {/* Take with Camera — uses getUserMedia, works on desktop + mobile */}
                            <div onClick={()=>openCamera('progress')} style={{cursor:"pointer",display:"block"}}>
                              <div style={{
                                position:"relative",overflow:"hidden",
                                background:"var(--smoke)",
                                border:"1px solid var(--border)",
                                borderRadius:"16px",padding:"1.75rem 1rem",
                                display:"flex",flexDirection:"column",alignItems:"center",gap:"0.65rem",
                                transition:"all 0.25s ease",
                              }}
                              onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.15)";e.currentTarget.style.transform="translateY(-2px)";}}
                              onMouseLeave={e=>{e.currentTarget.style.borderColor="";e.currentTarget.style.transform="translateY(0)";}}>
                                <div style={{position:"relative",width:"48px",height:"48px",borderRadius:"12px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ivory2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                    <circle cx="12" cy="13" r="4"/>
                                  </svg>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:"0.88rem",fontWeight:600,color:"var(--ivory2)",letterSpacing:"0.3px",marginBottom:"0.2rem"}}>Camera</div>
                                  <div style={{fontSize:"0.66rem",color:"rgba(255,255,255,0.25)",letterSpacing:"1px"}}>Live capture</div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div style={{border:"1px dashed var(--border)",borderRadius:"var(--r)",aspectRatio:"4/3",background:"var(--smoke)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                            {progressPhotos[0]?.dataUrl ? (
                              <img src={progressPhotos[0].dataUrl} alt="Latest" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            ) : (
                              <div style={{textAlign:"center",padding:"1rem"}}>
                                <div style={{fontSize:"1.5rem",opacity:0.3,marginBottom:"0.3rem"}}>📸</div>
                                <div style={{fontSize:"0.72rem",color:"var(--muted)",fontStyle:"italic"}}>Latest photo appears here</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:"0.55rem"}}>
                          <div>
                            <label className="fl">Photo Label</label>
                            <select className="fi" style={{fontSize:"0.82rem"}} value={photoLabel} onChange={e=>setPhotoLabel(e.target.value)}>
                              {["Before","After","Progress Check","Week 1","Week 2","Week 4","Week 8","Week 12","Month 1","Month 2","Month 3","Race Day","Game Day","Custom"].map(l=><option key={l}>{l}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="fl">Weight at this photo</label>
                            <input className="fi" type="number" placeholder="lbs" style={{fontSize:"0.82rem"}} value={photoWeight} onChange={e=>setPhotoWeight(e.target.value)}/>
                          </div>
                          <div style={{flex:1,display:"flex",flexDirection:"column"}}>
                            <label className="fl">Note</label>
                            <textarea className="fi" placeholder="How are you feeling? Milestones, energy levels, body changes…" style={{fontSize:"0.82rem",resize:"none",flex:1,minHeight:"100px"}} value={photoNote} onChange={e=>setPhotoNote(e.target.value)}/>
                          </div>
                          <div style={{fontSize:"0.72rem",color:"var(--muted)",fontStyle:"italic",lineHeight:1.5}}>
                            Fill in details above, then tap 🖼️ or 📷 to save a photo with this label and note.
                          </div>
                        </div>
                      </div>
                      {progressPhotos.length>0 ? (
                        <div>
                          <div style={{fontSize:"0.72rem",color:"var(--gold)",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"0.75rem"}}>Progress Timeline</div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"0.75rem"}}>
                            {progressPhotos.map(ph=>(
                              <div key={ph.id} style={{background:"var(--smoke)",borderRadius:"var(--r)",overflow:"hidden",border:"1px solid var(--border)"}}>
                                <div style={{position:"relative",aspectRatio:"3/4"}}>
                                  <img src={ph.dataUrl} alt={ph.label} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.75) 0%,transparent 50%)"}}/>
                                  <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"0.5rem"}}>
                                    <div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--gold)"}}>{ph.label}</div>
                                    <div style={{fontSize:"0.7rem",color:"rgba(255,255,255,0.7)"}}>{ph.date}</div>
                                    {ph.weight&&<div style={{fontSize:"0.72rem",color:"#4BAE71",fontWeight:600}}>{ph.weight} lbs</div>}
                                  </div>
                                  <button onClick={()=>setProgressPhotos(prev=>prev.filter(p=>p.id!==ph.id))}
                                    style={{position:"absolute",top:"0.35rem",right:"0.35rem",width:"22px",height:"22px",borderRadius:"50%",background:"rgba(0,0,0,0.6)",border:"none",color:"rgba(255,255,255,0.7)",fontSize:"0.7rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                                </div>
                                {ph.note&&<div style={{padding:"0.4rem 0.5rem",fontSize:"0.74rem",color:"var(--muted)",fontStyle:"italic",lineHeight:1.4}}>{ph.note}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{textAlign:"center",padding:"1.5rem",color:"var(--muted)",fontSize:"0.84rem",fontStyle:"italic"}}>
                          No progress photos yet — upload your first photo above to start tracking your visual journey
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}


              {/* ══ RECRUITING PROFILE ════════════════════════════ */}
              {progressTab==="recruiting" && (()=>{
                // Compute PRs from workout log
                const prs = Object.entries(
                  wkLog.reduce((acc,l)=>{
                    const num=parseFloat(l.load);
                    if(num&&(!acc[l.exercise]||num>acc[l.exercise].num))
                      acc[l.exercise]={num,load:l.load,date:l.date};
                    return acc;
                  },{})).slice(0,6);

                // Get best benchmark per test
                const bestBenches = Object.values(
                  benchmarks.reduce((acc,b)=>{
                    if(!acc[b.test]||parseFloat(b.value)<parseFloat(acc[b.test].value)||
                      ["Vertical Jump","Broad Jump"].includes(b.test)&&parseFloat(b.value)>parseFloat(acc[b.test].value))
                      acc[b.test]=b;
                    return acc;
                  },{})
                ).slice(0,6);

                // Latest weight
                const latestWeight = weightLog.length>0 ? weightLog[weightLog.length-1] : null;
                const latestPhoto = progressPhotos[0] || null;
                const heightFt = profile.height ? `${Math.floor(profile.height/12)}'${profile.height%12}"` : null;

                // Completion score
                const fields = [profile.name,profile.sport,profile.position,profile.height,profile.weight,profile.age,
                  benchmarks.length>0,prs.length>0,latestPhoto,profile.gpa,profile.graduationYear,profile.highSchool];
                const filled = fields.filter(Boolean).length;
                const completionPct = Math.round((filled/fields.length)*100);

                return (
                  <div>
                    {/* Header */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.5rem",flexWrap:"wrap",gap:"0.75rem"}}>
                      <div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.6rem",fontWeight:600,color:"var(--ivory)"}}>
                          Recruiting <em>Profile</em>
                        </div>
                        <div style={{fontSize:"0.8rem",color:"var(--muted)",marginTop:"0.2rem"}}>
                          Share with college coaches, scouts, and recruiting services
                        </div>
                      </div>
                      <div style={{display:"flex",gap:"0.5rem",alignItems:"center"}}>
                        <div style={{fontSize:"0.76rem",color:completionPct>=80?"#4BAE71":"#F0C040",fontWeight:600}}>
                          {completionPct}% complete
                        </div>
                        <button className="bg" style={{padding:"0.5rem 1.25rem",fontSize:"0.8rem"}}
                          onClick={()=>{
                            try {
                              downloadAthleteReportCard({profile,sport,totalCals,wkWeek,wkLog,benchmarks,weightLog,checkIns,nutritionLog,progressPhotos});
                              shout("Recruiting card downloaded","");
                            } catch(e){ shout("PDF failed — fill in more profile data","!"); }
                          }}>
                          ⬇ Download PDF Card
                        </button>
                      </div>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.25rem"}}>

                      {/* LEFT: The visual card */}
                      <div>
                        {/* The card itself */}
                        <div style={{
                          background:"linear-gradient(160deg,#141310 0%,#1A1815 60%,#0E0D0B 100%)",
                          border:"1px solid rgba(191,161,106,0.25)",
                          borderRadius:"16px",
                          overflow:"hidden",
                          position:"relative",
                          marginBottom:"0.75rem"
                        }}>
                          {/* Gold top bar */}
                          <div style={{height:"4px",background:"linear-gradient(90deg,#BFA16A,#8B6914,#BFA16A)"}}/>

                          {/* Card header */}
                          <div style={{padding:"1.25rem 1.25rem 0.75rem",borderBottom:"1px solid rgba(191,161,106,0.1)"}}>
                            <div style={{fontSize:"0.6rem",letterSpacing:"3px",color:"rgba(191,161,106,0.6)",textTransform:"uppercase",marginBottom:"0.3rem"}}>Elite Athlete · Recruiting Profile</div>
                            <div style={{display:"flex",gap:"1rem",alignItems:"flex-start"}}>
                              {/* Photo or initials */}
                              <div style={{
                                width:"72px",height:"72px",borderRadius:"50%",flexShrink:0,
                                background:latestPhoto?"transparent":"linear-gradient(135deg,#BFA16A,#8B6914)",
                                border:"2px solid rgba(255,255,255,0.12)",
                                overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"
                              }}>
                                {latestPhoto
                                  ? <img src={latestPhoto.dataUrl} alt="athlete" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  : <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.8rem",fontWeight:600,color:"#0E0D0B"}}>
                                      {profile.name?.[0]?.toUpperCase()||"?"}
                                    </div>
                                }
                              </div>
                              <div style={{flex:1}}>
                                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.5rem",fontWeight:600,color:"var(--ivory)",lineHeight:1.1}}>
                                  {profile.name||<span style={{color:"var(--muted)",fontStyle:"italic"}}>Athlete Name</span>}
                                </div>
                                <div style={{fontSize:"0.82rem",color:"var(--gold)",fontWeight:600,marginTop:"0.2rem"}}>
                                  {sport.label} · {profile.position||"Position"}
                                </div>
                                <div style={{fontSize:"0.74rem",color:"var(--muted)",marginTop:"0.15rem"}}>
                                  {[profile.highSchool,profile.graduationYear?"Class of "+profile.graduationYear:null].filter(Boolean).join(" · ")||"School · Class Year"}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Vitals row */}
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",borderBottom:"1px solid rgba(191,161,106,0.08)"}}>
                            {[
                              ["HT",heightFt||"—"],
                              ["WT",(latestWeight?.weight||profile.weight)?(latestWeight?.weight||profile.weight)+" lbs":"—"],
                              ["AGE",profile.age||"—"],
                              ["GPA",profile.gpa||"—"],
                            ].map(([l,v])=>(
                              <div key={l} style={{padding:"0.6rem 0.5rem",textAlign:"center",borderRight:"1px solid rgba(191,161,106,0.08)"}}>
                                <div style={{fontSize:"0.6rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.2rem"}}>{l}</div>
                                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.1rem",fontWeight:600,color:"var(--ivory)"}}>{v}</div>
                              </div>
                            ))}
                          </div>

                          {/* Performance benchmarks */}
                          {bestBenches.length > 0 && (
                            <div style={{padding:"0.85rem 1.25rem",borderBottom:"1px solid rgba(191,161,106,0.08)"}}>
                              <div style={{fontSize:"0.6rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.5rem",fontWeight:600}}>Performance Tests</div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                                {bestBenches.map((b,i)=>(
                                  <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:"0.78rem"}}>
                                    <span style={{color:"var(--muted)"}}>{b.test}</span>
                                    <span style={{color:"#4BAE71",fontWeight:700}}>{b.value} {b.unit}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Strength PRs */}
                          {prs.length > 0 && (
                            <div style={{padding:"0.85rem 1.25rem",borderBottom:"1px solid rgba(191,161,106,0.08)"}}>
                              <div style={{fontSize:"0.6rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.5rem",fontWeight:600}}>Strength PRs</div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                                {prs.map(([ex,pr],i)=>(
                                  <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:"0.78rem"}}>
                                    <span style={{color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100px"}}>{ex}</span>
                                    <span style={{color:"var(--gold)",fontWeight:700}}>{pr.load}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Coach note */}
                          {recruitingNote && (
                            <div style={{padding:"0.85rem 1.25rem",borderBottom:"1px solid rgba(191,161,106,0.08)"}}>
                              <div style={{fontSize:"0.6rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.4rem",fontWeight:600}}>Athlete Statement</div>
                              <div style={{fontSize:"0.78rem",color:"var(--ivory2)",lineHeight:1.55,fontStyle:"italic"}}>"{recruitingNote}"</div>
                            </div>
                          )}

                          {/* Footer */}
                          <div style={{padding:"0.6rem 1.25rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div style={{fontSize:"0.65rem",color:"rgba(255,255,255,0.15)"}}>eliteathlete.app</div>
                            <div style={{fontSize:"0.65rem",color:"rgba(255,255,255,0.15)"}}>
                              {new Date().toLocaleDateString('en-US',{month:'short',year:'numeric'})}
                            </div>
                          </div>
                        </div>

                        {/* Completion checklist */}
                        <div style={{background:"var(--smoke)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                          <div style={{fontSize:"0.7rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.6rem",fontWeight:600}}>
                            Card Completion — {completionPct}%
                          </div>
                          <div style={{height:"3px",background:"rgba(255,255,255,0.06)",borderRadius:"2px",marginBottom:"0.75rem"}}>
                            <div style={{width:`${completionPct}%`,height:"100%",background:completionPct>=80?"#4BAE71":"#F0C040",borderRadius:"2px",transition:"width 0.4s ease"}}/>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.25rem"}}>
                            {[
                              ["Name",!!profile.name],
                              ["Sport + Position",!!(profile.sport&&profile.position)],
                              ["Height",!!profile.height],
                              ["Weight",!!(latestWeight||profile.weight)],
                              ["Age",!!profile.age],
                              ["High School",!!profile.highSchool],
                              ["Class Year",!!profile.graduationYear],
                              ["GPA",!!profile.gpa],
                              ["Performance Tests",benchmarks.length>0],
                              ["Strength PRs",prs.length>0],
                              ["Profile Photo",!!latestPhoto],
                              ["Athlete Statement",!!recruitingNote],
                            ].map(([label,done])=>(
                              <div key={label} style={{display:"flex",alignItems:"center",gap:"0.4rem",fontSize:"0.74rem"}}>
                                <div style={{width:"8px",height:"8px",borderRadius:"50%",background:done?"#4BAE71":"rgba(255,255,255,0.12)",flexShrink:0}}/>
                                <span style={{color:done?"var(--ivory2)":"var(--muted)"}}>{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* RIGHT: Edit + send controls */}
                      <div style={{display:"flex",flexDirection:"column",gap:"0.75rem"}}>

                        {/* Recruiting-specific fields */}
                        <div className="panel">
                          <div className="ph"><div className="pt">Recruiting <em>Details</em></div></div>
                          <div className="pb">
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.6rem"}}>
                              {[
                                ["highSchool","High School / Club","text","West High School"],
                                ["graduationYear","Graduation Year","text","2026"],
                                ["gpa","GPA","text","3.8"],
                                ["gpaScale","GPA Scale","text","4.0"],
                                ["location","City, State","text","Atlanta, GA"],
                                ["hudlLink","Hudl / Film Link","text","hudl.com/..."],
                              ].map(([key,label,type,ph])=>(
                                <div key={key} className="f" style={{marginBottom:0}}>
                                  <label className="fl">{label}</label>
                                  <input type={type} className="fi" placeholder={ph}
                                    value={profile[key]||""}
                                    onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))}
                                    style={{fontSize:"0.82rem"}}/>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Athlete statement */}
                        <div className="panel">
                          <div className="ph"><div className="pt">Athlete <em>Statement</em></div></div>
                          <div className="pb">
                            <textarea className="fi" rows={4}
                              placeholder="Brief statement about your goals, work ethic, and what you bring to a program — coaches read these. Keep it genuine, specific, and under 150 words."
                              value={recruitingNote}
                              onChange={e=>setRecruitingNote(e.target.value)}
                              style={{fontSize:"0.82rem",resize:"vertical"}}/>
                            <div style={{fontSize:"0.72rem",color:"var(--muted)",marginTop:"0.3rem",textAlign:"right"}}>
                              {recruitingNote.split(/\s+/).filter(Boolean).length} / 150 words
                            </div>
                          </div>
                        </div>

                        {/* Send to coach */}
                        <div className="panel">
                          <div className="ph"><div className="pt">Send to <em>Coach / Scout</em></div></div>
                          <div className="pb">
                            <div className="f">
                              <label className="fl">Coach or Scout Email</label>
                              <input type="email" className="fi"
                                placeholder="coach@university.edu"
                                value={recruitingEmail}
                                onChange={e=>setRecruitingEmail(e.target.value)}
                                style={{fontSize:"0.82rem"}}/>
                            </div>
                            <button className="bg" style={{width:"100%",padding:"0.75rem"}}
                              onClick={()=>{
                                if(!recruitingEmail){shout("Enter a coach or scout email","!");return;}
                                if(!profile.name){shout("Add your name to the profile first","!");return;}
                                // Build email body
                                const subject = `Recruiting Profile — ${profile.name} | ${sport.label} ${profile.position}`;
                                const body = [
                                  `Coach,`,
                                  ``,
                                  `My name is ${profile.name} and I am a ${profile.position} interested in your ${sport.label} program.`,
                                  ``,
                                  `ATHLETE INFO`,
                                  `Sport / Position: ${sport.label} · ${profile.position}`,
                                  profile.height?`Height: ${Math.floor(profile.height/12)}'${profile.height%12}"`:null,
                                  (latestWeight?.weight||profile.weight)?`Weight: ${latestWeight?.weight||profile.weight} lbs`:null,
                                  profile.age?`Age: ${profile.age}`:null,
                                  profile.gpa?`GPA: ${profile.gpa}${profile.gpaScale?" / "+profile.gpaScale:""}`:null,
                                  profile.graduationYear?`Graduation Year: ${profile.graduationYear}`:null,
                                  profile.highSchool?`School: ${profile.highSchool}`:null,
                                  profile.location?`Location: ${profile.location}`:null,
                                  ``,
                                  bestBenches.length>0?"PERFORMANCE TESTS":null,
                                  ...bestBenches.map(b=>`  ${b.test}: ${b.value} ${b.unit}`),
                                  ``,
                                  prs.length>0?"STRENGTH PRs":null,
                                  ...prs.map(([ex,pr])=>`  ${ex}: ${pr.load}`),
                                  ``,
                                  profile.hudlLink?`Film / Highlights: ${profile.hudlLink}`:null,
                                  ``,
                                  recruitingNote?`ATHLETE STATEMENT
${recruitingNote}`:null,
                                  ``,
                                  `Generated by Elite Athlete — eliteathlete.app`,
                                ].filter(l=>l!==null).join("\\n");

                                const mailtoLink = `mailto:${recruitingEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                                window.open(mailtoLink);
                                setRecruitingCardSent(true);
                                shout(`Recruiting card opened for ${recruitingEmail}`,"");
                              }}>
                              🎓 Open Email to Coach →
                            </button>
                            {recruitingCardSent && (
                              <div style={{fontSize:"0.76rem",color:"#4BAE71",marginTop:"0.5rem",textAlign:"center"}}>
                                ✓ Email opened — add your personalized message and send
                              </div>
                            )}
                            <div style={{fontSize:"0.72rem",color:"var(--muted)",marginTop:"0.5rem",lineHeight:1.6}}>
                              Opens your email app pre-filled with your full recruiting profile, stats, and athlete statement. You can customize before sending.
                            </div>
                          </div>
                        </div>

                        {/* Quick tips */}
                        <div style={{background:"rgba(191,161,106,0.04)",border:"1px solid rgba(191,161,106,0.12)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                          <div style={{fontSize:"0.7rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.5rem",fontWeight:600}}>Recruiting Tips</div>
                          {[
                            "Log your best benchmark tests — 40yd, vertical, and 1RM numbers are the first thing coaches look at",
                            "Add a profile photo from the Progress Photos tab — first impressions matter",
                            "Keep your athlete statement under 150 words. Specific and genuine beats impressive and generic",
                            "Send to 30+ programs. D1, D2, D3, and NAIA all offer scholarships and opportunities",
                          ].map((t,i)=>(
                            <div key={i} style={{display:"flex",gap:"0.5rem",marginBottom:i<3?"0.4rem":0,fontSize:"0.78rem",color:"var(--ivory2)",lineHeight:1.5}}>
                              <span style={{color:"var(--gold)",flexShrink:0}}>✦</span>
                              <span>{t}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ══ COACH CONNECT ══════════════════════════════════ */}
              {progressTab==="coachconnect" && (()=>{
                // Build report content based on selected sections
                const buildReport = (coach) => {
                  const date = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
                  const lastCheckIn = checkIns[0];
                  const latestWeight = weightLog.length>0?weightLog[weightLog.length-1]:null;
                  const avgCals = nutritionLog.length>0?Math.round(nutritionLog.slice(-7).reduce((s,n)=>s+(parseFloat(n.calories)||0),0)/Math.min(nutritionLog.slice(-7).length,7)):null;
                  const avgProtein = nutritionLog.length>0?Math.round(nutritionLog.slice(-7).filter(n=>n.protein).reduce((s,n)=>s+(parseFloat(n.protein)||0),0)/Math.max(nutritionLog.slice(-7).filter(n=>n.protein).length,1)):null;
                  const prs = Object.entries(wkLog.reduce((acc,l)=>{const num=parseFloat(l.load);if(num&&(!acc[l.exercise]||num>acc[l.exercise].num))acc[l.exercise]={num,load:l.load,date:l.date};return acc;},{})).slice(0,8);
                  const acwrVal = (() => {
                    const last7=checkIns.slice(0,7);const last14=checkIns.slice(0,14);
                    const acute=last7.length>0?last7.reduce((s,c)=>s+(c.recovery||0),0)/last7.length:0;
                    const chronic=last14.length>0?last14.reduce((s,c)=>s+(c.recovery||0),0)/last14.length:0;
                    return chronic>0?(acute/chronic).toFixed(2):"1.00";
                  })();
                  const lines = [
                    `ATHLETE PROGRESS REPORT`,
                    `${profile.name||"Athlete"} — ${sport.label} · ${profile.position}`,
                    `Submitted: ${date}`,
                    ``,
                  ];
                  if(reportSections.readiness && lastCheckIn) {
                    const r=lastCheckIn.recovery||0,e=lastCheckIn.energy||0,sl=lastCheckIn.sleep||0,so=lastCheckIn.soreness||0,m=lastCheckIn.mood||0;
                    const score=((r*0.3+sl*0.25+e*0.2+m*0.15+((10-so)*0.1))).toFixed(1);
                    lines.push(`GAME-DAY READINESS: ${score}/10`);
                    lines.push(`Recovery: ${r}/10 · Energy: ${e}/10 · Sleep: ${sl}hrs · Soreness: ${so}/10 · Mood: ${m}/10`);
                    lines.push(``);
                  }
                  if(reportSections.overtraining) {
                    lines.push(`TRAINING LOAD (ACWR): ${acwrVal}`);
                    lines.push(`${parseFloat(acwrVal)>1.5?"! HIGH — volume reduction recommended":parseFloat(acwrVal)>1.3?" ELEVATED — monitor closely":parseFloat(acwrVal)<0.7?"↓ UNDERTRAINED — increase load gradually":"✓ OPTIMAL RANGE (0.8–1.3)"}`);
                    lines.push(``);
                  }
                  if(reportSections.wellness && checkIns.length>0) {
                    const last7=checkIns.slice(0,7);
                    const avg=(key)=>(last7.reduce((s,c)=>s+(c[key]||0),0)/last7.length).toFixed(1);
                    lines.push(`7-DAY WELLNESS AVERAGES`);
                    lines.push(`Recovery: ${avg("recovery")}/10 · Energy: ${avg("energy")}/10 · Sleep: ${avg("sleep")}hrs · Soreness: ${avg("soreness")}/10`);
                    lines.push(``);
                  }
                  if(reportSections.weight && latestWeight) {
                    const start=weightLog[0];
                    const delta=(latestWeight.weight-start.weight).toFixed(1);
                    lines.push(`BODY COMPOSITION`);
                    lines.push(`Current weight: ${latestWeight.weight} lbs (${delta>0?"+":""}${delta} lbs since ${start.date})`);
                    if(latestWeight.bodyFat) lines.push(`Body fat: ${latestWeight.bodyFat}%`);
                    lines.push(``);
                  }
                  if(reportSections.nutrition && avgCals) {
                    lines.push(`NUTRITION (7-day avg)`);
                    lines.push(`Calories: ${avgCals} kcal/day (target: ${totalCals})`);
                    if(avgProtein) lines.push(`Protein: ${avgProtein}g/day (target: ${proteinTarget}g)`);
                    lines.push(``);
                  }
                  if(reportSections.performance && benchmarks.length>0) {
                    const best=Object.values(benchmarks.reduce((acc,b)=>{if(!acc[b.test])acc[b.test]=b;return acc;},{}));
                    lines.push(`PERFORMANCE BENCHMARKS`);
                    best.slice(0,6).forEach(b=>lines.push(`${b.test}: ${b.value} ${b.unit}`));
                    lines.push(``);
                  }
                  if(reportSections.prs && prs.length>0) {
                    lines.push(`STRENGTH PRs`);
                    prs.forEach(([ex,pr])=>lines.push(`${ex}: ${pr.load} (${pr.date})`));
                    lines.push(``);
                  }
                  if(reportSections.notes && reportMessage) {
                    lines.push(`ATHLETE NOTES`);
                    lines.push(reportMessage);
                    lines.push(``);
                  }
                  lines.push(`—`);
                  lines.push(`Sent via Elite Athlete · eliteathlete.app`);
                  return lines.join("\n");
                };

                return (
                  <div>
                    {/* Header */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.5rem",flexWrap:"wrap",gap:"0.75rem"}}>
                      <div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.6rem",fontWeight:600,color:"var(--ivory)"}}>
                          Coach <em>Connect</em>
                        </div>
                        <div style={{fontSize:"0.8rem",color:"var(--muted)",marginTop:"0.2rem"}}>
                          Share structured progress reports directly with your coach or trainer
                        </div>
                      </div>
                      <div style={{fontSize:"0.76rem",color:"var(--muted)"}}>
                        {sentReports.length} report{sentReports.length!==1?"s":""} sent
                      </div>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem"}}>

                      {/* LEFT — Coaches + Report Builder */}
                      <div style={{display:"flex",flexDirection:"column",gap:"0.85rem"}}>

                        {/* Add Coach */}
                        <div className="panel">
                          <div className="ph"><div className="pt">My <em>Coaches & Trainers</em></div></div>
                          <div className="pb">
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem",marginBottom:"0.5rem"}}>
                              {[
                                ["name","Name","text","Coach Johnson"],
                                ["email","Email","email","coach@team.com"],
                              ].map(([k,l,t,ph])=>(
                                <div key={k} className="f" style={{marginBottom:0}}>
                                  <label className="fl">{l}</label>
                                  <input type={t} className="fi" placeholder={ph} style={{fontSize:"0.82rem"}}
                                    value={newCoach[k]} onChange={e=>setNewCoach(p=>({...p,[k]:e.target.value}))}/>
                                </div>
                              ))}
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem",marginBottom:"0.6rem"}}>
                              <div className="f" style={{marginBottom:0}}>
                                <label className="fl">Role</label>
                                <select className="fi" style={{fontSize:"0.82rem"}} value={newCoach.role}
                                  onChange={e=>setNewCoach(p=>({...p,role:e.target.value}))}>
                                  {["Head Coach","Assistant Coach","Strength & Conditioning","Athletic Trainer","Physical Therapist","Nutritionist","Personal Trainer","Scout"].map(r=><option key={r}>{r}</option>)}
                                </select>
                              </div>
                              <div className="f" style={{marginBottom:0}}>
                                <label className="fl">Sport / Team</label>
                                <input type="text" className="fi" placeholder={sport.label} style={{fontSize:"0.82rem"}}
                                  value={newCoach.sport} onChange={e=>setNewCoach(p=>({...p,sport:e.target.value}))}/>
                              </div>
                            </div>
                            <button className="bg" style={{width:"100%",padding:"0.65rem"}} onClick={()=>{
                              if(!newCoach.name||!newCoach.email){shout("Enter coach name and email","!");return;}
                              const coach={...newCoach,id:Date.now(),added:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})};
                              setCoaches(prev=>[...prev,coach]);
                              setSelectedCoach(coach);
                              setNewCoach({name:"",email:"",role:"Head Coach",sport:""});
                              shout(`${coach.name} added`,"📡");
                            }}>+ Add Coach</button>

                            {/* Coaches list */}
                            {coaches.length>0 && (
                              <div style={{marginTop:"0.75rem",display:"flex",flexDirection:"column",gap:"0.4rem"}}>
                                {coaches.map(c=>(
                                  <div key={c.id} style={{
                                    display:"flex",justifyContent:"space-between",alignItems:"center",
                                    padding:"0.6rem 0.75rem",borderRadius:"var(--r)",cursor:"pointer",
                                    background:selectedCoach?.id===c.id?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.02)",
                                    border:`1px solid ${selectedCoach?.id===c.id?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.06)"}`,
                                    transition:"all 0.2s"
                                  }} onClick={()=>setSelectedCoach(c)}>
                                    <div>
                                      <div style={{fontSize:"0.84rem",fontWeight:600,color:selectedCoach?.id===c.id?"var(--gold)":"var(--ivory2)"}}>{c.name}</div>
                                      <div style={{fontSize:"0.72rem",color:"var(--muted)"}}>{c.role}{c.sport?` · ${c.sport}`:""}</div>
                                      <div style={{fontSize:"0.7rem",color:"var(--muted)",marginTop:"0.1rem"}}>{c.email}</div>
                                    </div>
                                    <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
                                      {selectedCoach?.id===c.id && <div style={{fontSize:"0.68rem",color:"var(--gold)",fontWeight:600}}>SELECTED</div>}
                                      <button style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",fontSize:"0.8rem",padding:"2px 6px"}}
                                        onClick={e=>{e.stopPropagation();setCoaches(prev=>prev.filter(x=>x.id!==c.id));if(selectedCoach?.id===c.id)setSelectedCoach(null);}}>✕</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {coaches.length===0 && (
                              <div style={{textAlign:"center",padding:"0.75rem",fontSize:"0.78rem",color:"var(--muted)"}}>
                                No coaches added yet — add your first coach above
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Report sections toggle */}
                        <div className="panel">
                          <div className="ph"><div className="pt">Report <em>Contents</em></div>
                            <span style={{fontSize:"0.72rem",color:"var(--muted)"}}>{Object.values(reportSections).filter(Boolean).length} sections</span>
                          </div>
                          <div className="pb">
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem"}}>
                              {[
                                ["readiness","Game-Day Readiness"],
                                ["overtraining","Training Load (ACWR)"],
                                ["wellness","7-Day Wellness Avg"],
                                ["weight","Body Composition"],
                                ["nutrition","Nutrition Summary"],
                                ["performance","Benchmarks"],
                                ["prs","Strength PRs"],
                                ["notes","Athlete Notes"],
                              ].map(([k,label])=>(
                                <div key={k} style={{
                                  display:"flex",alignItems:"center",gap:"0.5rem",padding:"0.45rem 0.6rem",
                                  borderRadius:"var(--r)",cursor:"pointer",
                                  background:reportSections[k]?"rgba(75,174,113,0.08)":"var(--smoke)",
                                  border:`1px solid ${reportSections[k]?"rgba(75,174,113,0.2)":"var(--border)"}`,
                                  fontSize:"0.76rem",color:reportSections[k]?"var(--ivory2)":"var(--muted)",
                                  userSelect:"none",transition:"all 0.15s"
                                }} onClick={()=>setReportSections(p=>({...p,[k]:!p[k]}))}>
                                  <div style={{width:"8px",height:"8px",borderRadius:"50%",flexShrink:0,
                                    background:reportSections[k]?"#4BAE71":"var(--muted)",opacity:reportSections[k]?1:0.35}}/>
                                  {label}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* RIGHT — Preview + Send */}
                      <div style={{display:"flex",flexDirection:"column",gap:"0.85rem"}}>

                        {/* Athlete notes for this report */}
                        <div className="panel">
                          <div className="ph"><div className="pt">Message to <em>Coach</em></div></div>
                          <div className="pb">
                            <textarea className="fi" rows={3}
                              placeholder="Add a personal note — what you want the coach to know this week, questions, concerns, goals..."
                              value={reportMessage}
                              onChange={e=>setReportMessage(e.target.value)}
                              style={{fontSize:"0.82rem",resize:"vertical"}}/>
                          </div>
                        </div>

                        {/* Report preview */}
                        <div className="panel">
                          <div className="ph"><div className="pt">Report <em>Preview</em></div>
                            <span style={{fontSize:"0.72rem",color:"var(--muted)"}}>
                              {selectedCoach?`→ ${selectedCoach.name}`:"Select a coach first"}
                            </span>
                          </div>
                          <div className="pb">
                            <div style={{
                              background:"var(--slate)",border:"1px solid var(--border)",
                              borderRadius:"var(--r)",padding:"0.85rem 1rem",
                              fontFamily:"monospace",fontSize:"0.72rem",color:"var(--fg)",
                              lineHeight:1.7,maxHeight:"260px",overflowY:"auto",whiteSpace:"pre-wrap",
                              wordBreak:"break-word"
                            }}>
                              {buildReport(selectedCoach)}
                            </div>
                          </div>
                        </div>

                        {/* Send button */}
                        <button className="bg" style={{width:"100%",padding:"0.85rem",fontSize:"0.9rem",fontWeight:600}}
                          onClick={()=>{
                            if(!selectedCoach){shout("Select a coach first","!");return;}
                            const body=buildReport(selectedCoach);
                            const subject=`Athlete Progress Report — ${profile.name||"Athlete"} · ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
                            const mailto=`mailto:${selectedCoach.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                            window.open(mailto);
                            const record={coach:selectedCoach.name,email:selectedCoach.email,date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),time:new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}),sections:Object.values(reportSections).filter(Boolean).length};
                            setSentReports(prev=>[record,...prev].slice(0,20));
                            shout(`Report sent to ${selectedCoach.name}`,"📡");
                          }}>
                          Send Progress Report to Coach
                        </button>

                        {/* Send history */}
                        {sentReports.length>0 && (
                          <div className="panel">
                            <div className="ph"><div className="pt">Send <em>History</em></div></div>
                            <div className="pb">
                              <div style={{display:"flex",flexDirection:"column",gap:"0.35rem"}}>
                                {sentReports.slice(0,8).map((r,i)=>(
                                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.45rem 0",borderBottom:i<sentReports.length-1?"1px solid rgba(255,255,255,0.04)":"none"}}>
                                    <div>
                                      <div style={{fontSize:"0.8rem",color:"var(--ivory2)",fontWeight:500}}>→ {r.coach}</div>
                                      <div style={{fontSize:"0.7rem",color:"var(--muted)"}}>{r.email} · {r.sections} sections</div>
                                    </div>
                                    <div style={{fontSize:"0.7rem",color:"var(--muted)",textAlign:"right"}}>
                                      <div>{r.date}</div>
                                      <div>{r.time}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ══ NOTIFICATIONS ══════════════════════════════════ */}
              {progressTab==="notifications" && (
                <div>
                  {/* Header */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.5rem",flexWrap:"wrap",gap:"0.75rem"}}>
                    <div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.6rem",fontWeight:600,color:"var(--ivory)"}}>Push <em>Notifications</em></div>
                      <div style={{fontSize:"0.8rem",color:"var(--muted)",marginTop:"0.2rem"}}>Daily reminders for check-ins, training, and recovery</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
                      <div style={{width:"8px",height:"8px",borderRadius:"50%",background:notifPermission==="granted"?"#4BAE71":notifPermission==="denied"?"#C0695E":"#F0C040"}}/>
                      <span style={{fontSize:"0.78rem",color:"var(--muted)"}}>
                        {notifPermission==="granted"?"Notifications active":notifPermission==="denied"?"Blocked in browser":"Not yet enabled"}
                      </span>
                    </div>
                  </div>

                  {/* Permission banner */}
                  {notifPermission !== "granted" && (
                    <div style={{background:notifPermission==="denied"?"rgba(192,105,94,0.07)":"rgba(191,161,106,0.06)",border:`1px solid ${notifPermission==="denied"?"rgba(192,105,94,0.2)":"rgba(191,161,106,0.2)"}`,borderRadius:"var(--r-lg)",padding:"1rem 1.25rem",marginBottom:"1.25rem",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"0.75rem"}}>
                      <div>
                        <div style={{fontSize:"0.88rem",fontWeight:600,color:notifPermission==="denied"?"#C0695E":"var(--gold)"}}>
                          {notifPermission==="denied"?"🚫 Notifications blocked":"🔔 Enable push notifications"}
                        </div>
                        <div style={{fontSize:"0.78rem",color:"var(--muted)",marginTop:"0.2rem"}}>
                          {notifPermission==="denied"
                            ?"Go to browser Settings → Site permissions → Notifications → Allow for this site"
                            :"Get daily reminders for check-ins, workouts, and recovery — never miss a training day"}
                        </div>
                      </div>
                      {notifPermission !== "denied" && (
                        <button className="bg" style={{padding:"0.6rem 1.25rem",flexShrink:0}} onClick={requestAndScheduleNotifications}>
                          Enable Notifications
                        </button>
                      )}
                    </div>
                  )}

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem"}}>

                    {/* LEFT — Reminder settings */}
                    <div style={{display:"flex",flexDirection:"column",gap:"0.85rem"}}>

                      {/* Daily reminders */}
                      <div className="panel">
                        <div className="ph"><div className="pt">Daily <em>Reminders</em></div></div>
                        <div className="pb">
                          {[
                            {key:"checkIn",   label:" Daily Check-In",   desc:"Log recovery, energy, sleep & mood",timeKey:"checkInTime",   enableKey:"checkInEnabled"},
                            {key:"workout",   label:" Training Reminder", desc:"Push to start your workout",          timeKey:"workoutTime",   enableKey:"workoutEnabled"},
                            {key:"recovery",  label:" Recovery Check",    desc:"Evening check on soreness & rest",    timeKey:"recoveryTime",  enableKey:"recoveryEnabled"},
                            {key:"nutrition", label:"🥗 Nutrition Log",     desc:"Remind to log calories & protein",    timeKey:"nutritionTime", enableKey:"nutritionEnabled"},
                          ].map(({label,desc,timeKey,enableKey,key})=>(
                            <div key={key} style={{padding:"0.75rem 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.4rem"}}>
                                <div>
                                  <div style={{fontSize:"0.84rem",fontWeight:600,color:notifSettings[enableKey]?"var(--ivory2)":"var(--muted)"}}>{label}</div>
                                  <div style={{fontSize:"0.72rem",color:"var(--muted)"}}>{desc}</div>
                                </div>
                                {/* Toggle */}
                                <div style={{position:"relative",width:"40px",height:"22px",cursor:"pointer",flexShrink:0}}
                                  onClick={()=>saveNotifSettings({...notifSettings,[enableKey]:!notifSettings[enableKey]})}>
                                  <div style={{position:"absolute",inset:0,borderRadius:"11px",background:notifSettings[enableKey]?"#4BAE71":"rgba(255,255,255,0.12)",transition:"background 0.2s"}}/>
                                  <div style={{position:"absolute",top:"3px",left:notifSettings[enableKey]?"21px":"3px",width:"16px",height:"16px",borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.4)"}}/>
                                </div>
                              </div>
                              {notifSettings[enableKey] && (
                                <div style={{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.35rem"}}>
                                  <span style={{fontSize:"0.72rem",color:"var(--muted)"}}>Remind at</span>
                                  <input type="time" className="fi" style={{width:"110px",fontSize:"0.82rem",padding:"0.25rem 0.5rem"}}
                                    value={notifSettings[timeKey]}
                                    onChange={e=>saveNotifSettings({...notifSettings,[timeKey]:e.target.value})}/>
                                  <button className="bsm" style={{fontSize:"0.7rem"}} onClick={()=>{
                                    const msgs = {checkIn:[" Daily Check-In","Time to log your recovery and energy!"],workout:[" Training Day","Your workout is ready. Let's go!"],recovery:[" Recovery Check","How's your body feeling tonight?"],nutrition:["🥗 Nutrition Log","Log your meals and hit your targets."]};
                                    sendTestNotification(msgs[key][0], msgs[key][1]);
                                  }}>Test</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Weekly summary */}
                      <div className="panel">
                        <div className="ph">
                          <div className="pt">Weekly <em>Summary</em></div>
                          <div style={{position:"relative",width:"40px",height:"22px",cursor:"pointer"}}
                            onClick={()=>saveNotifSettings({...notifSettings,weeklyEnabled:!notifSettings.weeklyEnabled})}>
                            <div style={{position:"absolute",inset:0,borderRadius:"11px",background:notifSettings.weeklyEnabled?"#4BAE71":"rgba(255,255,255,0.12)",transition:"background 0.2s"}}/>
                            <div style={{position:"absolute",top:"3px",left:notifSettings.weeklyEnabled?"21px":"3px",width:"16px",height:"16px",borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
                          </div>
                        </div>
                        {notifSettings.weeklyEnabled && (
                          <div className="pb">
                            <div style={{fontSize:"0.78rem",color:"var(--muted)",marginBottom:"0.6rem"}}>Every week you'll get a summary of your readiness scores, workout load, and nutrition averages.</div>
                            <div style={{display:"flex",alignItems:"center",gap:"0.75rem",flexWrap:"wrap"}}>
                              <div>
                                <label className="fl">Day</label>
                                <select className="fi" style={{fontSize:"0.82rem",width:"130px"}} value={notifSettings.weeklyDay}
                                  onChange={e=>saveNotifSettings({...notifSettings,weeklyDay:e.target.value})}>
                                  {[["0","Sunday"],["1","Monday"],["2","Tuesday"],["3","Wednesday"],["4","Thursday"],["5","Friday"],["6","Saturday"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="fl">Time</label>
                                <input type="time" className="fi" style={{fontSize:"0.82rem",width:"110px"}}
                                  value={notifSettings.checkInTime}
                                  onChange={e=>saveNotifSettings({...notifSettings,checkInTime:e.target.value})}/>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* RIGHT — Schedule preview + controls */}
                    <div style={{display:"flex",flexDirection:"column",gap:"0.85rem"}}>

                      {/* Today's schedule */}
                      <div className="panel">
                        <div className="ph"><div className="pt">Today's <em>Reminder Schedule</em></div></div>
                        <div className="pb">
                          {[
                            {enabled:notifSettings.checkInEnabled,  time:notifSettings.checkInTime,   label:"Daily Check-In",   icon:""},
                            {enabled:notifSettings.workoutEnabled,  time:notifSettings.workoutTime,   label:"Training Reminder",icon:"W"},
                            {enabled:notifSettings.recoveryEnabled, time:notifSettings.recoveryTime,  label:"Recovery Check",   icon:""},
                            {enabled:notifSettings.nutritionEnabled,time:notifSettings.nutritionTime, label:"Nutrition Log",    icon:"N"},
                          ].filter(r=>r.enabled).sort((a,b)=>a.time.localeCompare(b.time)).map((r,i)=>(
                            <div key={i} style={{display:"flex",alignItems:"center",gap:"0.75rem",padding:"0.5rem 0",borderBottom:"1px solid var(--border)"}}>
                              <div style={{fontSize:"0.9rem",flexShrink:0}}>{r.icon}</div>
                              <div style={{flex:1}}>
                                <div style={{fontSize:"0.82rem",color:"var(--ivory2)",fontWeight:500}}>{r.label}</div>
                              </div>
                              <div style={{fontSize:"0.84rem",color:"var(--gold)",fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                                {new Date(`2000-01-01T${r.time}`).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})}
                              </div>
                            </div>
                          ))}
                          {![notifSettings.checkInEnabled,notifSettings.workoutEnabled,notifSettings.recoveryEnabled,notifSettings.nutritionEnabled].some(Boolean) && (
                            <div style={{textAlign:"center",padding:"1rem",fontSize:"0.78rem",color:"var(--muted)"}}>No reminders enabled — toggle some on to the left</div>
                          )}
                        </div>
                      </div>

                      {/* Apply + test */}
                      <div className="panel">
                        <div className="ph"><div className="pt">Apply <em>Schedule</em></div></div>
                        <div className="pb">
                          <div style={{fontSize:"0.78rem",color:"var(--muted)",marginBottom:"0.75rem",lineHeight:1.6}}>
                            After changing times or toggling reminders, apply the new schedule. This reschedules all active reminders based on your settings above.
                          </div>
                          <button className="bg" style={{width:"100%",padding:"0.75rem",marginBottom:"0.5rem"}}
                            onClick={()=>{
                              if(notifPermission!=="granted"){requestAndScheduleNotifications();return;}
                              scheduleAllNotifications();
                              shout("Reminder schedule updated","");
                            }}>
                            {notifPermission==="granted"?"🔔 Apply Schedule":"🔔 Enable & Apply Schedule"}
                          </button>
                          <button className="bsm" style={{width:"100%",padding:"0.6rem",fontSize:"0.78rem"}}
                            onClick={()=>sendTestNotification(" Elite Athlete Test","Your notifications are working correctly!")}>
                            Send Test Notification
                          </button>
                        </div>
                      </div>

                      {/* What each reminder does */}
                      <div style={{background:"rgba(191,161,106,0.04)",border:"1px solid rgba(191,161,106,0.12)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                        <div style={{fontSize:"0.7rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",marginBottom:"0.5rem",fontWeight:600}}>How it works</div>
                        {[
                          "Notifications are scheduled locally — no account or server required",
                          "Reminders fire daily at the times you set, even when the app is in the background",
                          "Tap any notification to open Elite Athlete directly",
                          "Times are saved to your device and persist between sessions",
                        ].map((t,i)=>(
                          <div key={i} style={{display:"flex",gap:"0.5rem",marginBottom:i<3?"0.4rem":0,fontSize:"0.78rem",color:"var(--ivory2)",lineHeight:1.5}}>
                            <span style={{color:"var(--gold)",flexShrink:0}}>✦</span><span>{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ══ SUPPLEMENTS ════════════════════════════════════ */}
              {progressTab==="supplements" && (()=>{
                const stack = getSupplementStack(profile.sport||"football", profile.position||"");
                const catColors = {foundation:"#6B9FD4",performance:"#BFA16A",recovery:"#4BAE71",cognitive:"#C084E8",body_comp:"#F0C040"};
                const catLabels = {foundation:"Foundation",performance:"Performance",recovery:"Recovery",cognitive:"Cognitive",body_comp:"Body Comp"};
                const evidenceLabels = {"A":"Strong evidence","B":"Good evidence","C":"Emerging"};
                const evidenceColors = {"A":"#4BAE71","B":"#F0C040","C":"#6B9FD4"};
                const categories = ["all","foundation","performance","recovery","cognitive","body_comp"];
                const filtered = suppCategory==="all" ? stack : stack.filter(s=>s.category===suppCategory);

                // Timing schedule builder
                const timingGroups = {
                  "Morning (wake up)": stack.filter(s=>s.timing?.toLowerCase().includes("morning")||s.timing?.toLowerCase().includes("wake")),
                  "Pre-Training / Pre-Game": stack.filter(s=>s.timing?.toLowerCase().includes("pre")),
                  "During Training / Game": stack.filter(s=>s.timing?.toLowerCase().includes("during")),
                  "Post-Training": stack.filter(s=>s.timing?.toLowerCase().includes("post")),
                  "With Meals": stack.filter(s=>s.timing?.toLowerCase().includes("meal")&&!s.timing?.toLowerCase().includes("pre")&&!s.timing?.toLowerCase().includes("post")),
                  "Before Bed": stack.filter(s=>s.timing?.toLowerCase().includes("bed")||s.timing?.toLowerCase().includes("night")),
                };

                return (
                  <div>
                    {/* Header */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.25rem",flexWrap:"wrap",gap:"0.75rem"}}>
                      <div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.6rem",fontWeight:600,color:"var(--ivory)"}}>
                          Supplement <em>Stack</em>
                        </div>
                        <div style={{fontSize:"0.8rem",color:"var(--muted)",marginTop:"0.2rem"}}>
                          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"0.65rem",fontWeight:700,letterSpacing:"1px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(201,168,76,0.25)",borderRadius:"3px",padding:"1px 5px",marginRight:"0.3rem"}}>{sport.icon}</span> {sport.label}{profile.position?` · ${profile.position}`:""} — evidence-based recommendations
                        </div>
                      </div>
                      <div style={{display:"flex",gap:"0.5rem",alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{fontSize:"0.74rem",color:"var(--muted)"}}>{stack.length} supplements</div>
                        <button className="bsm" onClick={()=>{
                          const lines = [`SUPPLEMENT STACK — ${profile.name||"Athlete"}`,`${sport.label} · ${profile.position||""}`,`Generated: ${new Date().toLocaleDateString()}`,``,`DAILY SCHEDULE`,``];
                          Object.entries(timingGroups).forEach(([time,supps])=>{
                            if(supps.length>0){lines.push(`${time.toUpperCase()}`);supps.forEach(s=>lines.push(`  • $ ${s.name} — ${s.dose}`));lines.push(``);}
                          });
                          lines.push(`FULL STACK DETAILS`);lines.push(``);
                          stack.forEach(s=>lines.push(`$ ${s.name}\n  Dose: ${s.dose}\n  Timing: ${s.timing}\n  Purpose: ${s.purpose}\n`));
                          lines.push(`Evidence key: A=Strong RCT data  B=Good evidence  C=Emerging`);
                          lines.push(`Always consult a healthcare provider before starting any supplement protocol.`);
                          const subject=`Supplement Stack — ${profile.name||"Athlete"} · ${sport.label}`;
                          window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`);
                          shout("Stack ready to email","");
                        }}>✉ Email Stack</button>
                      </div>
                    </div>

                    {/* Category filter */}
                    <div style={{display:"flex",gap:"0.4rem",marginBottom:"1rem",flexWrap:"wrap"}}>
                      {categories.map(cat=>(
                        <button key={cat} className="bsm"
                          style={{
                            background:suppCategory===cat?(cat==="all"?"var(--gold)":catColors[cat]||"var(--gold)"):"transparent",
                            color:suppCategory===cat?"#0E0D0B":"var(--muted)",
                            borderColor:suppCategory===cat?(catColors[cat]||"var(--gold)"):"rgba(255,255,255,0.1)",
                            fontSize:"0.72rem",padding:"0.3rem 0.65rem",
                          }}
                          onClick={()=>setSuppCategory(cat)}>
                          {cat==="all"?"All":catLabels[cat]}
                          <span style={{marginLeft:"0.3rem",opacity:0.7}}>
                            {cat==="all"?stack.length:stack.filter(s=>s.category===cat).length}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem"}}>

                      {/* LEFT — Supplement cards */}
                      <div style={{display:"flex",flexDirection:"column",gap:"0.55rem"}}>
                        {filtered.map((s,i)=>{
                          const isExpanded = expandedSupp===i;
                          const col = catColors[s.category]||"var(--gold)";
                          return (
                            <div key={i} style={{
                              background:"var(--smoke)",
                              border:`1px solid ${isExpanded?col:"rgba(255,255,255,0.06)"}`,
                              borderLeft:`3px solid ${col}`,
                              borderRadius:"var(--r)",
                              cursor:"pointer",
                              transition:"all 0.2s",
                            }} onClick={()=>setExpandedSupp(isExpanded?null:i)}>
                              <div style={{padding:"0.7rem 0.85rem",display:"flex",alignItems:"center",gap:"0.65rem"}}>
                                <div style={{fontSize:"1.1rem",flexShrink:0}}></div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"0.5rem"}}>
                                    <div style={{fontSize:"0.84rem",fontWeight:600,color:"var(--ivory2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                                    <div style={{display:"flex",gap:"0.35rem",alignItems:"center",flexShrink:0}}>
                                      <span style={{fontSize:"0.62rem",padding:"1px 5px",borderRadius:"3px",background:`${evidenceColors[s.evidence]}22`,color:evidenceColors[s.evidence],fontWeight:700,border:`1px solid ${evidenceColors[s.evidence]}44`}}>
                                        {s.evidence}
                                      </span>
                                      <span style={{fontSize:"0.62rem",padding:"1px 5px",borderRadius:"3px",background:`${col}22`,color:col,fontWeight:600}}>
                                        {catLabels[s.category]}
                                      </span>
                                    </div>
                                  </div>
                                  <div style={{fontSize:"0.74rem",color:"var(--gold)",fontWeight:600,marginTop:"0.1rem"}}>{s.dose}</div>
                                </div>
                                <div style={{color:"var(--muted)",fontSize:"0.7rem",flexShrink:0}}>{isExpanded?"▲":"▼"}</div>
                              </div>
                              {isExpanded && (
                                <div style={{padding:"0 0.85rem 0.85rem",borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                                  <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"0.3rem 0.75rem",marginTop:"0.6rem",fontSize:"0.78rem"}}>
                                    <span style={{color:"var(--muted)"}}>Timing</span>
                                    <span style={{color:"var(--ivory2)"}}>{s.timing}</span>
                                    <span style={{color:"var(--muted)"}}>Purpose</span>
                                    <span style={{color:"var(--ivory2)",lineHeight:1.5}}>{s.purpose}</span>
                                    <span style={{color:"var(--muted)"}}>Evidence</span>
                                    <span style={{color:evidenceColors[s.evidence]}}>{s.evidence} — {evidenceLabels[s.evidence]}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* RIGHT — Daily schedule + Legend */}
                      <div style={{display:"flex",flexDirection:"column",gap:"0.85rem"}}>

                        {/* Daily timing schedule */}
                        <div className="panel">
                          <div className="ph"><div className="pt">Daily <em>Schedule</em></div></div>
                          <div className="pb">
                            {Object.entries(timingGroups).map(([timeLabel, supps])=>{
                              if(supps.length===0) return null;
                              return (
                                <div key={timeLabel} style={{marginBottom:"0.75rem"}}>
                                  <div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",fontWeight:600,marginBottom:"0.35rem"}}>{timeLabel}</div>
                                  {supps.map((s,i)=>(
                                    <div key={i} style={{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0.25rem 0",fontSize:"0.78rem"}}>
                                      <span style={{flexShrink:0}}></span>
                                      <span style={{color:"var(--ivory2)",flex:1}}>{s.name}</span>
                                      <span style={{color:"var(--muted)",flexShrink:0}}>{s.dose}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Evidence legend */}
                        <div style={{background:"var(--smoke)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                          <div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",fontWeight:600,marginBottom:"0.6rem"}}>Evidence Guide</div>
                          {[["A","#4BAE71","Strong — multiple RCTs confirm benefit"],["B","#F0C040","Good — solid research, consistent results"],["C","#6B9FD4","Emerging — promising early research"]].map(([grade,col,desc])=>(
                            <div key={grade} style={{display:"flex",gap:"0.5rem",alignItems:"flex-start",marginBottom:"0.4rem"}}>
                              <span style={{fontWeight:700,color:col,fontSize:"0.8rem",flexShrink:0,width:"14px"}}>{grade}</span>
                              <span style={{fontSize:"0.76rem",color:"var(--muted)",lineHeight:1.5}}>{desc}</span>
                            </div>
                          ))}
                          <div style={{marginTop:"0.6rem",paddingTop:"0.6rem",borderTop:"1px solid rgba(191,161,106,0.15)"}}>
                            <div style={{fontSize:"0.72rem",color:"var(--muted)",marginBottom:"0.35rem"}}>Injured? See injury-specific protocols:</div>
                            <button className="bsm" style={{width:"100%",fontSize:"0.74rem",padding:"0.4rem"}}
                              onClick={()=>goTo("injury")}>
                              ⚕ View Recovery & Injury Protocols →
                            </button>
                          </div>
                          <div style={{marginTop:"0.5rem",fontSize:"0.7rem",color:"rgba(255,255,255,0.3)",lineHeight:1.6}}>
                            Based on ISSN Position Stands. Consult a sports dietitian before starting any supplement protocol.
                          </div>
                        </div>

                        {/* Supplement timing tips */}
                        <div style={{background:"rgba(191,161,106,0.04)",border:"1px solid rgba(191,161,106,0.12)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                          <div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",fontWeight:600,marginBottom:"0.5rem"}}>Pro Tips</div>
                          {[
                            "Creatine works regardless of timing — daily consistency matters more than when",
                            "Don't take iron and zinc at the same meal — they compete for absorption",
                            "Collagen + Vitamin C must be taken 30–45 min before training to be effective",
                            "Caffeine tolerance resets after 10–14 days off — cycle if it stops working",
                            "Beet root nitrates take 2–3 hours to peak — plan pre-game timing carefully",
                          ].map((tip,i)=>(
                            <div key={i} style={{display:"flex",gap:"0.5rem",marginBottom:i<4?"0.35rem":0,fontSize:"0.76rem",color:"var(--ivory2)",lineHeight:1.5}}>
                              <span style={{color:"var(--gold)",flexShrink:0}}>✦</span><span>{tip}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ══ HISTORY ════════════════════════════════════════ */}
              {progressTab==="history" && (()=>{
                const now = new Date();
                const cutoff = new Date(now); cutoff.setDate(cutoff.getDate()-90);
                const safeDate = (v) => { try { const d=new Date(v); return (!v||isNaN(d.getTime()))?null:d; } catch(e){return null;} };
                const safeFmt = (d) => { try { return d instanceof Date && !isNaN(d)?d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}):""; } catch(e){return "";} };
                const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
                const allEvents = [];

                checkIns.forEach(ci => { try {
                  const d=safeDate(ci.date); if(!d||d<cutoff) return;
                  const r=ci.recovery||0,e=ci.energy||0,sl=ci.sleep||0,so=ci.soreness||0,m=ci.mood||0;
                  const score=((r*0.3+sl*0.25+e*0.2+m*0.15+((10-so)*0.1))).toFixed(1);
                  allEvents.push({date:d,type:"checkin",icon:"",label:`Readiness ${score}/10`,detail:`Recovery ${r} · Energy ${e} · Sleep ${sl}h · Soreness ${so} · Mood ${m}`,color:"#BFA16A",raw:ci});
                } catch(e){} });

                weightLog.forEach(w => { try {
                  const d=safeDate(w.date); if(!d||d<cutoff) return;
                  allEvents.push({date:d,type:"weight",icon:"⚖️",label:`Weight: ${w.weight} lbs`,detail:w.bodyFat?`Body fat: ${w.bodyFat}%`:"",color:"#6B9FD4",raw:w});
                } catch(e){} });

                const wkByDate={};
                wkLog.forEach(l => { try {
                  if(!l.date) return;
                  const pts=l.date.split(' '); const mo=months[pts[0]]; const dy=parseInt(pts[1]);
                  if(isNaN(mo)||isNaN(dy)) return;
                  const d=new Date(now.getFullYear(),mo,dy); if(d<cutoff) return;
                  const key=`${mo}-${dy}-${l.wkType||''}-${l.wkFocus||''}`;
                  if(!wkByDate[key]) wkByDate[key]={date:d,exercises:[],type:l.wkType||"Workout",focus:l.wkFocus||""};
                  wkByDate[key].exercises.push(`${l.exercise||''} — ${(l.load||'').split(' ')[0]}`);
                } catch(e){} });
                Object.values(wkByDate).forEach(({date,exercises,type,focus}) => {
                  allEvents.push({date,type:"workout",icon:"W",label:`${type}${focus?" · "+focus:""}`,detail:`${exercises.length} exercise${exercises.length!==1?"s":""}: ${exercises.slice(0,3).join(", ")}${exercises.length>3?` +${exercises.length-3} more`:""}`,color:"#4BAE71",raw:{exercises,type,focus}});
                });

                nutritionLog.forEach(n => { try {
                  const d=safeDate(n.date); if(!d||d<cutoff) return;
                  allEvents.push({date:d,type:"nutrition",icon:"N",label:`Nutrition: ${Math.round(parseFloat(n.calories)||0)} kcal`,detail:`Protein ${n.protein||0}g · Carbs ${n.carbs||0}g · Fat ${n.fat||0}g`,color:"#4BAE71",raw:n});
                } catch(e){} });

                jEntries.forEach(j => { try {
                  const d=safeDate(j.date); if(!d||d<cutoff) return;
                  allEvents.push({date:d,type:"journal",icon:"J",label:`Journal: ${j.title||"Entry"}`,detail:(j.text||"").slice(0,80)+(j.text?.length>80?"…":""),color:"#C084E8",raw:j});
                } catch(e){} });

                notes.forEach(n => { try {
                  const d=safeDate(n.date); if(!d||d<cutoff) return;
                  allEvents.push({date:d,type:"note",icon:"📝",label:"Progress Note",detail:(n.text||"").slice(0,80)+(n.text?.length>80?"…":""),color:"#F0C040",raw:n});
                } catch(e){} });

                allEvents.sort((a,b)=>b.date-a.date);

                const typeFilters=["all","checkin","workout","nutrition","weight","journal","note"];
                const typeLabels={all:"All",checkin:"Check-ins",workout:"Workouts",nutrition:"Nutrition",weight:"Weight",journal:"Journal",note:"Notes"};
                const typeColors={checkin:"#BFA16A",workout:"#4BAE71",nutrition:"#4BAE71",weight:"#6B9FD4",journal:"#C084E8",note:"#F0C040"};
                const filtered=historyFilter==="all"?allEvents:allEvents.filter(e=>e.type===historyFilter);
                const ciCount=allEvents.filter(e=>e.type==="checkin").length;
                const wkCount=allEvents.filter(e=>e.type==="workout").length;
                const avgReadiness=ciCount>0?(allEvents.filter(e=>e.type==="checkin").reduce((s,e)=>s+parseFloat(e.label.match(/[\d.]+/)?.[0]||0),0)/ciCount).toFixed(1):"—";

                return (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.25rem",flexWrap:"wrap",gap:"0.75rem"}}>
                      <div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.6rem",fontWeight:600,color:"var(--ivory)"}}>90-Day <em>History</em></div>
                        <div style={{fontSize:"0.8rem",color:"var(--muted)",marginTop:"0.2rem"}}>{allEvents.length} entries across all modules</div>
                      </div>
                      <div style={{display:"flex",gap:"0.65rem",flexWrap:"wrap"}}>
                        {[["≡",allEvents.length,"Total"],["",ciCount,"Check-ins"],["",wkCount,"Workouts"],["⭐",avgReadiness,"Avg Readiness"]].map(([icon,val,label])=>(
                          <div key={label} style={{background:"var(--smoke)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"0.5rem 0.8rem",textAlign:"center",minWidth:"64px"}}>
                            <div style={{fontSize:"0.9rem"}}>{icon}</div>
                            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.1rem",color:"var(--gold)",fontWeight:600}}>{val}</div>
                            <div style={{fontSize:"0.62rem",color:"var(--muted)"}}>{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{
                      display:"flex",gap:"0.4rem",marginBottom:"1rem",flexWrap:"wrap",
                      background:"var(--smoke)",border:"1px solid var(--border)",
                      borderRadius:"var(--r)",padding:"0.4rem 0.5rem"
                    }}>
                      {typeFilters.map(t=>(
                        <button key={t} className="bsm" style={{
                          background:historyFilter===t?(t==="all"?"var(--gold)":typeColors[t]||"var(--gold)"):"transparent",
                          color:historyFilter===t?"#0E0D0B":"var(--muted)",
                          borderColor:historyFilter===t?(typeColors[t]||"var(--gold)"):"var(--border)",
                          fontSize:"0.72rem",padding:"0.3rem 0.65rem",
                        }} onClick={()=>setHistoryFilter(t)}>
                          {typeLabels[t]} <span style={{opacity:0.7}}>{t==="all"?allEvents.length:allEvents.filter(e=>e.type===t).length}</span>
                        </button>
                      ))}
                    </div>
                    {filtered.length===0?(
                      <div style={{textAlign:"center",padding:"3rem 1rem",color:"var(--muted)"}}>
                        <div style={{fontSize:"2rem",marginBottom:"0.75rem"}}>≡</div>
                        <div style={{fontSize:"0.9rem",fontStyle:"italic",marginBottom:"0.4rem"}}>No entries yet{historyFilter!=="all"?` in ${typeLabels[historyFilter]}`:""}.</div>
                        <div style={{fontSize:"0.78rem"}}>Log a check-in, workout, or meal to see your history here.</div>
                      </div>
                    ):(
                      <div>
                        {filtered.map((ev,i)=>{
                          const isNewDay=i===0||safeFmt(ev.date)!==safeFmt(filtered[i-1]?.date);
                          const isExp=expandedHistory===i;
                          return (
                            <div key={i}>
                              {isNewDay&&<div style={{fontSize:"0.68rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase",padding:"0.75rem 0 0.35rem",fontWeight:600,borderBottom:"1px solid var(--border)",marginBottom:"0.3rem"}}>{safeFmt(ev.date)}</div>}
                              <div style={{borderRadius:"6px",background:isExp?"rgba(20,19,16,0.8)":"rgba(8,7,5,0.3)",marginBottom:"0.2rem",borderLeft:`2px solid ${ev.color}`,border:isExp?`1px solid ${ev.color}44`:"1px solid transparent",borderLeftWidth:"2px",borderLeftColor:ev.color,cursor:"pointer",transition:"all 0.15s"}}
                                onClick={()=>setExpandedHistory(isExp?null:i)}>
                                {/* Collapsed row */}
                                <div style={{display:"flex",gap:"0.75rem",alignItems:"flex-start",padding:"0.5rem 0.6rem"}}>
                                  <span style={{fontSize:"1rem",flexShrink:0,width:"20px",textAlign:"center",marginTop:"0.05rem"}}>{ev.icon}</span>
                                  <div style={{flex:1,minWidth:0}}>
                                    <div style={{fontSize:"0.82rem",color:"var(--ivory2)",fontWeight:500}}>{ev.label}</div>
                                    {!isExp&&ev.detail&&<div style={{fontSize:"0.73rem",color:"var(--muted)",marginTop:"0.1rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.detail}</div>}
                                  </div>
                                  <div style={{fontSize:"0.7rem",color:"var(--muted)",flexShrink:0,marginLeft:"0.5rem"}}>{isExp?"▲":"▼"}</div>
                                </div>
                                {/* Expanded content */}
                                {isExp&&(
                                  <div style={{padding:"0 0.6rem 0.6rem 2.4rem",borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                                    {/* Check-in expanded */}
                                    {ev.type==="checkin"&&(
                                      <div style={{paddingTop:"0.6rem"}}>
                                        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"0.4rem",marginBottom:"0.6rem"}}>
                                          {[["Recovery",ev.raw?.recovery],["Energy",ev.raw?.energy],["Sleep",ev.raw?.sleep+"h"],["Soreness",ev.raw?.soreness],["Mood",ev.raw?.mood]].map(([l,v])=>(
                                            <div key={l} style={{background:"rgba(255,255,255,0.03)",borderRadius:"4px",padding:"0.4rem 0.5rem",textAlign:"center"}}>
                                              <div style={{fontSize:"1rem",fontWeight:600,color:"var(--gold)"}}>{v}</div>
                                              <div style={{fontSize:"0.62rem",color:"var(--muted)"}}>{l}</div>
                                            </div>
                                          ))}
                                        </div>
                                        {ev.raw?.notes&&<div style={{fontSize:"0.78rem",color:"var(--ivory2)",fontStyle:"italic",lineHeight:1.6,marginBottom:"0.5rem"}}>"{ev.raw.notes}"</div>}
                                        <button className="bsm" style={{fontSize:"0.7rem",padding:"0.3rem 0.6rem"}} onClick={e=>{e.stopPropagation();setProgressTab("checkin");}}>View Check-In →</button>
                                      </div>
                                    )}
                                    {/* Workout expanded */}
                                    {ev.type==="workout"&&(
                                      <div style={{paddingTop:"0.6rem"}}>
                                        <div style={{fontSize:"0.74rem",color:"var(--muted)",marginBottom:"0.5rem",lineHeight:1.8}}>
                                          {(ev.raw?.exercises||[ev.detail]).map((ex,j)=>(
                                            <div key={j} style={{display:"flex",gap:"0.5rem",padding:"0.2rem 0",borderBottom:"1px solid var(--border)"}}>
                                              <span style={{color:"#4BAE71",flexShrink:0}}>•</span>
                                              <span style={{color:"var(--ivory2)"}}>{ex}</span>
                                            </div>
                                          ))}
                                        </div>
                                        <button className="bsm" style={{fontSize:"0.7rem",padding:"0.3rem 0.6rem"}} onClick={e=>{e.stopPropagation();goTo("workout");}}>View Workouts →</button>
                                      </div>
                                    )}
                                    {/* Journal expanded */}
                                    {ev.type==="journal"&&(
                                      <div style={{paddingTop:"0.6rem"}}>
                                        {ev.raw?.title&&<div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--gold)",marginBottom:"0.4rem"}}>{ev.raw.title}</div>}
                                        <div style={{fontSize:"0.8rem",color:"var(--ivory2)",lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:"200px",overflowY:"auto",paddingRight:"0.5rem"}}>{ev.raw?.text||ev.detail}</div>
                                        <button className="bsm" style={{fontSize:"0.7rem",padding:"0.3rem 0.6rem",marginTop:"0.5rem"}} onClick={e=>{e.stopPropagation();setDash("journal");}}>Open Journal →</button>
                                      </div>
                                    )}
                                    {/* Progress note expanded */}
                                    {ev.type==="note"&&(
                                      <div style={{paddingTop:"0.6rem"}}>
                                        <div style={{fontSize:"0.8rem",color:"var(--ivory2)",lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{ev.raw?.text||ev.detail}</div>
                                      </div>
                                    )}
                                    {/* Weight expanded */}
                                    {ev.type==="weight"&&(
                                      <div style={{paddingTop:"0.6rem",display:"flex",gap:"1.5rem",alignItems:"center"}}>
                                        <div style={{textAlign:"center"}}>
                                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"2rem",color:"var(--gold)",fontWeight:600,lineHeight:1}}>{ev.raw?.weight}</div>
                                          <div style={{fontSize:"0.68rem",color:"var(--muted)"}}>lbs</div>
                                        </div>
                                        {ev.raw?.bodyFat&&<div style={{textAlign:"center"}}>
                                          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"2rem",color:"#4BAE71",fontWeight:600,lineHeight:1}}>{ev.raw.bodyFat}%</div>
                                          <div style={{fontSize:"0.68rem",color:"var(--muted)"}}>body fat</div>
                                        </div>}
                                        <button className="bsm" style={{fontSize:"0.7rem",padding:"0.3rem 0.6rem"}} onClick={e=>{e.stopPropagation();setProgressTab("body");}}>Body Tracking →</button>
                                      </div>
                                    )}
                                    {/* Nutrition expanded */}
                                    {ev.type==="nutrition"&&(
                                      <div style={{paddingTop:"0.6rem"}}>
                                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.4rem",marginBottom:"0.5rem"}}>
                                          {[["Calories",ev.raw?.calories,"kcal","#BFA16A"],["Protein",ev.raw?.protein,"g","#6B9FD4"],["Carbs",ev.raw?.carbs,"g","#4BAE71"],["Fat",ev.raw?.fat,"g","#F0C040"]].map(([l,v,u,col])=>(
                                            <div key={l} style={{background:"var(--smoke)",borderRadius:"4px",padding:"0.4rem",textAlign:"center"}}>
                                              <div style={{fontSize:"0.9rem",fontWeight:600,color:col}}>{Math.round(parseFloat(v)||0)}</div>
                                              <div style={{fontSize:"0.62rem",color:"var(--muted)"}}>{l} ({u})</div>
                                            </div>
                                          ))}
                                        </div>
                                        {ev.raw?.water&&<div style={{fontSize:"0.74rem",color:"var(--muted)"}}>💧 Water: {ev.raw.water}</div>}
                                        <button className="bsm" style={{fontSize:"0.7rem",padding:"0.3rem 0.6rem",marginTop:"0.4rem"}} onClick={e=>{e.stopPropagation();setProgressTab("nutrition");}}>View Nutrition →</button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
          {dash==="journal" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"2rem"}}>
                <div><div className="eyebrow">Personal</div><h2 className="sh2">Athlete <em>Journal</em></h2></div>
                <div style={{display:"flex",gap:"0.45rem"}}>
                  <button className="bsm" onClick={()=>{
                    try {
                      downloadAthleteReportCard({profile,sport,totalCals,wkWeek,wkLog,benchmarks,weightLog,checkIns,nutritionLog,progressPhotos});
                      shout("Report Card downloaded","◆");
                    } catch(e){ shout("Export failed","!"); }
                  }}>⬇ Report Card</button>
                  <button className="bsm" onClick={()=>setEmailModal({type:"progress",label:"Progress Report",data:{...profile,totalCals,mealType,mealFreq}})}>✉ Email</button>
                  <button className="bsm" onClick={handleDownloadProgress}>⬇ PDF</button>
                </div>
              </div>
              <div className="two">
                <div className="panel">
                  <div className="ph"><div className="pt">New <em>Entry</em></div></div>
                  <div className="pb">
                    <div className="f"><label className="fl">Title</label><input className="fi" placeholder="Entry title…" value={jTitle||""} onChange={e=>setJTitle(e.target.value)}/></div>
                    <div className="f"><label className="fl">Your Thoughts</label><textarea className="fi" style={{minHeight:"210px"}} placeholder="Record your thoughts, reflections, progress, goals…" value={jText} onChange={e=>setJText(e.target.value)}/></div>
                    <div style={{display:"flex",gap:"0.7rem"}}>
                      <button className="bg" style={{flex:1,padding:"0.72rem"}} onClick={()=>{if(jText){const entry={date:new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}),title:jTitle||"Untitled",text:jText};setJEntries(e=>[entry,...e]);saveJournalToDb(entry);setJText("");setJTitle("");shout("Entry saved","📓");}}}>Save Entry</button>
                      <button className="bgh" style={{padding:"0.72rem 1rem"}} onClick={handleDownloadJournal}>⬇ PDF</button>
                    </div>
                  </div>
                </div>
                <div>
                  {/* Header row with Clear All */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
                    <div style={{fontSize:"0.74rem",letterSpacing:"3px",textTransform:"uppercase",color:"var(--muted)",fontWeight:"600"}}>Recent Entries</div>
                    {jEntries.length > 0 && (
                      <button className="bsm" style={{fontSize:"0.6rem",color:"rgba(192,105,94,0.7)",borderColor:"rgba(192,105,94,0.18)",padding:"0.3rem 0.75rem"}}
                        onClick={()=>{
                          if(!window.confirm(`Delete all ${jEntries.length} journal entries? This cannot be undone.`)) return;
                          // Delete from Supabase if entries have ids
                          if(authUser?.id){
                            jEntries.forEach(e=>{ if(e.id) deleteJournalEntry(e.id).catch(()=>{}); });
                          }
                          setJEntries([]);
                          shout("All journal entries cleared","!");
                        }}>
                        Clear All
                      </button>
                    )}
                  </div>
                  {jEntries.length === 0 && (
                    <div style={{color:"var(--muted)",fontSize:"0.82rem",fontStyle:"italic",padding:"1.5rem 0"}}>No entries yet — write your first entry.</div>
                  )}
                  {jEntries.map((e,i)=>(
                    <div key={e.id||i} className="je" style={{position:"relative"}}>
                      {/* Delete button — top right of each card */}
                      <button
                        onClick={()=>{
                          if(authUser?.id && e.id) deleteJournalEntry(e.id).catch(()=>{});
                          setJEntries(prev=>prev.filter((_,idx)=>idx!==i));
                          shout("Entry deleted","!");
                        }}
                        style={{
                          position:"absolute",top:"0.6rem",right:"0.6rem",
                          background:"rgba(192,105,94,0.08)",border:"1px solid rgba(192,105,94,0.2)",
                          borderRadius:"50%",width:"22px",height:"22px",
                          cursor:"pointer",color:"rgba(192,105,94,0.7)",
                          fontSize:"0.75rem",display:"flex",alignItems:"center",justifyContent:"center",
                          lineHeight:1,padding:0,flexShrink:0,
                        }}
                        title="Delete entry"
                        aria-label="Delete entry"
                      >×</button>
                      <div className="jd" style={{paddingRight:"1.5rem"}}>
                        {e.date}{e.title&&e.title!=="Untitled" ? <span style={{color:"var(--gold)",marginLeft:"0.5rem",fontStyle:"normal"}}>— {e.title}</span> : ""}
                      </div>
                      <div className="jt">{e.text}</div>
                      <div style={{display:"flex",gap:"0.45rem",marginTop:"0.7rem"}}>
                        <button className="bsm" onClick={()=>{try{downloadJournalPDF({athleteName:profile.name,entries:[e]});shout("PDF downloaded","📄");}catch(err){shout("PDF failed","!");}}}>⬇ PDF</button>
                        <button className="bsm" onClick={()=>window.print()}>↓ Print</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CALENDAR */}
          {dash==="calendar" && <CalView shout={shout} meals={meals} mealType={mealType} mealFreq={mealFreq} wkType={wkType} wkFocus={wkFocus} totalCals={totalCals} MEAL_PLANS={MEAL_PLANS} WORKOUTS={WORKOUTS} checkIns={checkIns} wkLog={wkLog} nutritionLog={nutritionLog} weightLog={weightLog} selInj={selInj} profile={profile} setDash={setDash} setProgressTab={setProgressTab}/>}

          {/* PROFILE */}
          {dash==="profile" && (
            <div>
              <div style={{marginBottom:"2rem"}}><div className="eyebrow">Account</div><h2 className="sh2">Athlete <em>Profile</em></h2></div>
              <div className="two">
                <div>
                  <div className="panel" style={{textAlign:"center",marginBottom:"1.1rem"}}>
                    <div className="pb" style={{paddingTop:"2rem"}}>
                      {/* Profile photo or sport icon */}
                      <div style={{position:"relative",display:"inline-block",marginBottom:"0.75rem"}}>
                        {profilePhotoAfter ? (
                          <div style={{width:"100px",height:"100px",borderRadius:"50%",overflow:"hidden",border:"3px solid var(--gold)",margin:"0 auto",boxShadow:"0 0 0 6px rgba(191,161,106,0.12)"}}>
                            <img src={profilePhotoAfter} alt={profile.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                          </div>
                        ) : (
                          <div className="av">{sport.icon}</div>
                        )}
                        {/* Change photo button */}
                        <label htmlFor="av-photo-inp" style={{position:"absolute",bottom:0,right:0,width:"28px",height:"28px",borderRadius:"50%",background:"var(--gold)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.7rem"}}>📷</label>
                        <input type="file" accept="image/*" id="av-photo-inp" style={{display:"none"}} onChange={e=>{
                          const file=e.target.files?.[0]; if(!file) return;
                          const reader=new FileReader();
                          reader.onload=ev=>setProfilePhotoAfter(ev.target.result);
                          reader.readAsDataURL(file);
                        }}/>
                      </div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"2rem",fontWeight:600,color:"var(--ivory)"}}>{profile.name||"Athlete"}</div>
                      <div style={{color:"var(--gold)",fontSize:"0.82rem",letterSpacing:"3px",margin:"0.45rem 0 0.7rem"}}>{profile.position||""}</div>
                      <span className="bdg bg-g">{sport.label.toUpperCase()}</span>

                    </div>
                  </div>
                  <div className="panel">
                    <div className="ph"><div className="pt">Stats <em>Overview</em></div></div>
                    <div className="pb">
                      <div className="two">
                        {[["Weight",profile.weight?`${profile.weight} lbs`:"—"],["Height",profile.height?`${Math.floor(profile.height/12)}'${profile.height%12}"`:"—"],["Age",profile.age?`${profile.age} yrs`:"—"],["Goal",profile.goal||"—"]].map(([l,v])=>(
                          <div key={l} style={{marginBottom:"1rem"}}>
                            <div style={{fontSize:"0.84rem",letterSpacing:"2px",textTransform:"uppercase",color:"var(--muted)",marginBottom:"0.28rem"}}>{l}</div>
                            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.4rem",fontWeight:600,color:"var(--ivory)"}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="panel" style={{marginBottom:"1.1rem"}}>
                    <div className="ph"><div className="pt">Edit <em>Profile</em></div></div>
                    <div className="pb">
                      <div className="f"><label className="fl">Name</label><input className="fi" value={profile.name} onChange={e=>setProfile(p=>({...p,name:e.target.value}))}/></div>
                      <div className="two">
                        <div className="f"><label className="fl">Weight (lbs)</label><input type="number" className="fi" value={profile.weight} onChange={e=>setProfile(p=>({...p,weight:e.target.value}))}/></div>
                        <div className="f"><label className="fl">Height (in)</label><input type="number" className="fi" value={profile.height} onChange={e=>setProfile(p=>({...p,height:e.target.value}))}/></div>
                      </div>
                      <div className="f"><label className="fl">Age (years)</label><input type="number" className="fi" placeholder="e.g. 24" value={profile.age} onChange={e=>setProfile(p=>({...p,age:e.target.value}))}/></div>
                      <div className="f"><label className="fl">Sport</label>
                        <select className="fi" value={profile.sport} onChange={e=>setProfile(p=>({...p,sport:e.target.value,position:""}))}>
                          {Object.entries(SPORTS).map(([k,s])=><option key={k} value={k}> {s.label}</option>)}
                        </select>
                      </div>
                      {profile.sport && <div className="f"><label className="fl">Position</label>
                        <select className="fi" value={profile.position} onChange={e=>{setProfile(p=>({...p,position:e.target.value}));setSelInj([]);}}>
                          <option value="">Select Position</option>
                          {SPORTS[profile.sport].positions.map(pos=><option key={pos}>{pos}</option>)}
                        </select>
                      </div>}
                      <button className="bg" style={{width:"100%",padding:"0.78rem"}} onClick={async()=>{
                        try{
                          if(authUser?.id) await saveProfile(authUser.id, profile);
                          shout("Profile saved","✦");
                        }catch(e){shout("Save failed","!");}
                      }}>Save Changes</button>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="ph"><div className="pt">Subscription</div></div>
                    <div className="pb">

                      {/* Current plan */}
                      <div style={{background:"rgba(168,130,42,0.06)",border:"1px solid rgba(168,130,42,0.25)",borderRadius:"var(--r)",padding:"1.1rem 1.25rem",marginBottom:"1.25rem"}}>
                        <div style={{fontSize:"0.52rem",letterSpacing:"4px",textTransform:"uppercase",color:"var(--gold)",marginBottom:"0.3rem"}}>Current Plan</div>
                        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.5rem",fontWeight:700,color:"var(--ivory)",letterSpacing:"1px"}}>
                          {subscription?.plan_name||"Elite Membership"}
                        </div>
                        <div style={{color:"var(--muted)",fontSize:"0.78rem",marginTop:"0.2rem"}}>
                          {subscription?.price||"$69"}/month · Renews {subscription?.renewal_date||"March 1, 2026"}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{display:"flex",flexDirection:"column",gap:"0.6rem"}}>
                        {/* Upgrade */}
                        <button className="bg" style={{width:"100%",padding:"0.75rem"}}
                          onClick={()=>setPayModal({name:"Elite",price:"$69"})}>
                          Upgrade / Change Plan
                        </button>
                        {/* Downgrade to Athlete */}
                        <button className="bgh" style={{width:"100%",padding:"0.72rem"}}
                          onClick={()=>setPayModal({name:"Athlete",price:"$29"})}>
                          Downgrade to Athlete — $29/mo
                        </button>
                        {/* Cancel */}
                        <button className="bsm" style={{width:"100%",padding:"0.65rem",color:"rgba(192,105,94,0.7)",borderColor:"rgba(192,105,94,0.18)",marginTop:"0.25rem"}}
                          onClick={()=>{
                            if(window.confirm("Cancel your subscription? You'll keep full access until the end of your billing period.")){
                              shout("To cancel, email support@elite-athlete.com or manage via Stripe.","!");
                            }
                          }}>
                          Cancel Subscription
                        </button>
                      </div>

                      <div style={{marginTop:"1rem",fontSize:"0.65rem",color:"var(--muted)",textAlign:"center",letterSpacing:"0.5px"}}>
                        For billing questions: support@elite-athlete.com
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {payModal && <PayModal plan={payModal} tab={payTab} setTab={setPayTab} userEmail={authUser?.email} onClose={()=>setPayModal(null)}
        onSuccess={()=>{setPayModal(null);shout("Subscription activated! Welcome to Elite.","◆");}}/>}
      {authModal && <AuthModal onClose={()=>setAuthModal(false)} onAuth={(user)=>{setAuthUser(user);setScreen("dashboard");shout(`Welcome, ${user.email?.split('@')[0]}!`,"◆");}}/>}
      {emailModal && <EmailModal emailModal={emailModal} authUser={authUser} isPremium={isPremium} setPayModal={setPayModal} shout={shout} onClose={()=>setEmailModal(null)}
        onSend={async(toEmail)=>{
          if(emailModal.type==="meal") await _sendEmailMealPlan(toEmail);
          if(emailModal.type==="progress") await _sendEmailProgress(toEmail);
          if(emailModal.type==="injury") await emailInjuryProtocol({toEmail, athleteName:profile.name, injuries:emailModal.data.injuries, sport:emailModal.data.sport, position:emailModal.data.position, injuryProtocols:emailModal.data.injuryProtocols});
          if(emailModal.type==="workout") await emailWorkoutPlan({toEmail, athleteName:profile.name, sport:emailModal.data.sport, position:emailModal.data.position, wkType:emailModal.data.wkType, wkFocus:emailModal.data.wkFocus, exercises:emailModal.data.exercises, weekNum:emailModal.data.weekNum});
          if(emailModal.type==="recovery") await emailRecoveryNutrition({toEmail, athleteName:profile.name});
          if(emailModal.type==="journal") await emailMealPlan({toEmail, athleteName:profile.name, meals:[], totalCals:0, mealType:`Journal — ${jEntries.length} entries`, mealFreq:0});
          if(emailModal.type==="weeklyPlan") { await sendEmail({toEmail, fromName:profile.name, subject:`Elite Athlete — ${emailModal.label} (${emailModal.data.mealType})`, message:emailModal.data.msg, replyTo:toEmail}); shout("Plan emailed","✉"); }
        }}/>}
      {/* ══ EXERCISE LIBRARY MODAL ═══════════════════════════ */}
      {showExLib && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",alignItems:"stretch",justifyContent:"flex-end"}} onClick={e=>{if(e.target===e.currentTarget){setShowExLib(false);setExLibSelected(null);}}}>
          <div style={{width:"min(860px,100vw)",background:"#0E0D0B",borderLeft:"1px solid rgba(191,161,106,0.2)",display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>

            {/* Header */}
            <div style={{padding:"1.25rem 1.5rem",borderBottom:"1px solid rgba(191,161,106,0.12)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.5rem",fontWeight:600,color:"var(--ivory)"}}>Exercise <em style={{color:"var(--gold)"}}>Library</em></div>
                <div style={{fontSize:"0.72rem",color:"var(--muted)",marginTop:"0.1rem"}}>{EXERCISE_LIBRARY.length} exercises with form demonstrations</div>
              </div>
              <button style={{background:"none",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"50%",width:"32px",height:"32px",cursor:"pointer",color:"var(--muted)",fontSize:"1rem",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{setShowExLib(false);setExLibSelected(null);}}>✕</button>
            </div>

            {/* Search + Filters */}
            <div style={{padding:"0.85rem 1.5rem",borderBottom:"1px solid var(--border)",flexShrink:0}}>
              <input className="fi" placeholder="🔍  Search exercises..." value={exLibQuery} onChange={e=>setExLibQuery(e.target.value)}
                style={{marginBottom:"0.65rem",fontSize:"0.85rem",padding:"0.5rem 0.75rem"}}/>
              <div style={{display:"flex",gap:"0.35rem",flexWrap:"wrap",marginBottom:"0.4rem"}}>
                {EXERCISE_MUSCLES.map(m=>(
                  <button key={m} className="bsm" style={{fontSize:"0.68rem",padding:"0.25rem 0.55rem",background:exLibMuscle===m?"var(--gold)":"transparent",color:exLibMuscle===m?"#0E0D0B":"var(--muted)",borderColor:exLibMuscle===m?"var(--gold)":"rgba(255,255,255,0.1)"}}
                    onClick={()=>{setExLibMuscle(m);setExLibSelected(null);}}>{m}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:"0.35rem",flexWrap:"wrap"}}>
                {EXERCISE_CATS.map(c=>(
                  <button key={c} className="bsm" style={{fontSize:"0.68rem",padding:"0.25rem 0.55rem",background:exLibCat===c?"#6B9FD4":"transparent",color:exLibCat===c?"#0E0D0B":"var(--muted)",borderColor:exLibCat===c?"#6B9FD4":"rgba(255,255,255,0.1)"}}
                    onClick={()=>{setExLibCat(c);setExLibSelected(null);}}>{c}</button>
                ))}
              </div>
            </div>

            {/* Body: list + detail */}
            <div style={{display:"flex",flex:1,overflow:"hidden"}}>

              {/* Exercise list */}
              <div style={{width:exLibSelected?"280px":"100%",flexShrink:0,overflowY:"auto",borderRight:exLibSelected?"1px solid rgba(255,255,255,0.06)":"none"}}>
                {(()=>{
                  const q=exLibQuery.toLowerCase();
                  const filtered=EXERCISE_LIBRARY.filter(e=>(exLibMuscle==="All"||e.muscle===exLibMuscle)&&(exLibCat==="All"||e.cat===exLibCat)&&(!q||e.name.toLowerCase().includes(q)||e.muscles.toLowerCase().includes(q)));
                  const diffColor={Beginner:"#4BAE71",Intermediate:"#F0C040",Advanced:"#C0695E"};
                  if(!filtered.length) return <div style={{padding:"2rem",textAlign:"center",color:"var(--muted)",fontStyle:"italic"}}>No exercises match. Try clearing filters.</div>;
                  return filtered.map((ex,i)=>(
                    <div key={i} onClick={()=>{setExLibSelected(ex===exLibSelected?null:ex);setPlayingVid(null);}}
                      style={{padding:"0.75rem 1rem",cursor:"pointer",borderBottom:"1px solid var(--border)",background:exLibSelected===ex?"rgba(191,161,106,0.08)":"transparent",transition:"background 0.15s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:"0.84rem",fontWeight:600,color:exLibSelected===ex?"var(--gold)":"var(--ivory2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.name}</div>
                          <div style={{fontSize:"0.7rem",color:"var(--muted)",marginTop:"0.1rem"}}>{ex.muscle} · {ex.cat}</div>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"0.2rem",flexShrink:0,marginLeft:"0.5rem"}}>
                          <span style={{fontSize:"0.62rem",fontWeight:700,color:diffColor[ex.diff]||"var(--muted)",background:`${diffColor[ex.diff]}18`,padding:"1px 6px",borderRadius:"3px"}}>{ex.diff}</span>
                          <span style={{fontSize:"0.65rem",color:"#6B9FD4"}}>▶ video</span>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>

              {/* Detail panel */}
              {exLibSelected && (
                <div style={{flex:1,overflowY:"auto",padding:"1.25rem"}}>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.35rem",fontWeight:600,color:"var(--ivory)",marginBottom:"0.2rem"}}>{exLibSelected.name}</div>
                  <div style={{display:"flex",gap:"0.5rem",marginBottom:"1rem",flexWrap:"wrap"}}>
                    <span style={{fontSize:"0.7rem",background:"rgba(255,255,255,0.05)",color:"var(--gold)",padding:"2px 8px",borderRadius:"3px",fontWeight:600}}>{exLibSelected.muscle}</span>
                    <span style={{fontSize:"0.7rem",background:"rgba(107,159,212,0.12)",color:"#6B9FD4",padding:"2px 8px",borderRadius:"3px"}}>{exLibSelected.cat}</span>
                    <span style={{fontSize:"0.7rem",background:({Beginner:"rgba(75,174,113,0.12)",Intermediate:"rgba(240,192,64,0.12)",Advanced:"rgba(192,105,94,0.12)"})[exLibSelected.diff]||"rgba(255,255,255,0.06)",color:({Beginner:"#4BAE71",Intermediate:"#F0C040",Advanced:"#C0695E"})[exLibSelected.diff]||"var(--muted)",padding:"2px 8px",borderRadius:"3px",fontWeight:600}}>{exLibSelected.diff}</span>
                  </div>

                  {/* Video Demo — thumbnail links to YouTube */}
                  <a href={`https://www.youtube.com/watch?v=${exLibSelected.ytId}`} target="_blank" rel="noopener noreferrer"
                    style={{display:"block",position:"relative",paddingBottom:"56.25%",height:0,borderRadius:"8px",overflow:"hidden",marginBottom:"1rem",background:"#111",cursor:"pointer",textDecoration:"none"}}>
                    <img
                      src={`https://i.ytimg.com/vi/${exLibSelected.ytId}/maxresdefault.jpg`}
                      alt={exLibSelected.name}
                      style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",objectFit:"cover"}}
                      onError={e=>{e.target.src=`https://i.ytimg.com/vi/${exLibSelected.ytId}/hqdefault.jpg`;}}
                    />
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.25)"}}>
                      <div style={{width:"72px",height:"50px",background:"#FF0000",borderRadius:"14px",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 24px rgba(0,0,0,0.7)",transition:"transform 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"}
                        onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
                        <div style={{width:0,height:0,borderTop:"13px solid transparent",borderBottom:"13px solid transparent",borderLeft:"22px solid white",marginLeft:"5px"}}/>
                      </div>
                    </div>
                    <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"0.5rem 0.75rem",background:"linear-gradient(transparent,rgba(0,0,0,0.8))",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{fontSize:"0.72rem",color:"#fff",fontWeight:500}}>▶ Watch Form Demo on YouTube</span>
                      <span style={{fontSize:"0.62rem",color:"rgba(255,255,255,0.5)"}}>opens new tab ↗</span>
                    </div>
                  </a>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.65rem",marginBottom:"1rem"}}>
                    <div style={{background:"var(--smoke)",borderRadius:"var(--r)",padding:"0.65rem 0.85rem",border:"1px solid var(--border)"}}>
                      <div style={{fontSize:"0.62rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.2rem"}}>Recommended</div>
                      <div style={{fontSize:"0.84rem",color:"var(--gold)",fontWeight:600}}>{exLibSelected.sets}</div>
                    </div>
                    <div style={{background:"var(--smoke)",borderRadius:"var(--r)",padding:"0.65rem 0.85rem",border:"1px solid var(--border)"}}>
                      <div style={{fontSize:"0.62rem",letterSpacing:"2px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"0.2rem"}}>Primary Muscles</div>
                      <div style={{fontSize:"0.78rem",color:"var(--ivory2)",lineHeight:1.4}}>{exLibSelected.muscles}</div>
                    </div>
                  </div>

                  <div style={{background:"rgba(191,161,106,0.05)",border:"1px solid rgba(191,161,106,0.15)",borderRadius:"var(--r)",padding:"0.85rem 1rem",marginBottom:"0.75rem"}}>
                    <div style={{fontSize:"0.62rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",fontWeight:600,marginBottom:"0.4rem"}}>✦ Coaching Cues</div>
                    <div style={{fontSize:"0.82rem",color:"var(--ivory2)",lineHeight:1.7}}>{exLibSelected.cues}</div>
                  </div>

                  <div style={{background:"rgba(192,105,94,0.05)",border:"1px solid rgba(192,105,94,0.15)",borderRadius:"var(--r)",padding:"0.85rem 1rem"}}>
                    <div style={{fontSize:"0.62rem",letterSpacing:"2px",color:"#C0695E",textTransform:"uppercase",fontWeight:600,marginBottom:"0.4rem"}}>! Common Mistakes</div>
                    <div style={{fontSize:"0.82rem",color:"var(--ivory2)",lineHeight:1.7}}>{exLibSelected.mistakes}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {toast && <Toast t={toast}/>}
    </>
  );
}


// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// PRICING SECTION — 4-Tier with annual/monthly toggle
// Free · Athlete ($29/mo·$199/yr) · Elite ($69/mo·$529/yr) · Coach Pro ($99/mo+$4.99/ath)
// ─────────────────────────────────────────────────────────────
function PricingSection({ setPayModal }) {
  const [billing, setBilling] = useState('annual');

  const TIERS = [
    {
      tierKey: 'free',
      tier: 'Try Free',
      name: 'Free',
      monthly: { price: '$0', label: 'Free forever' },
      annual:  { price: '$0', label: 'Free forever' },
      feats: [
        'Sport + position setup',
        'Day 1 meal plan preview',
        'Sample workout card',
        'Daily check-in + readiness score',
        '1 AI welcome brief (Day 1)',
        'Week calendar view',
      ],
      cta: 'Start Free',
      ctaClass: 'bgh',
      feat: false,
    },
    {
      tierKey: 'athlete',
      tier: 'Foundation',
      name: 'Athlete',
      monthly: { price: '$29', label: '/month · billed monthly' },
      annual:  { price: '$199', moEquiv: '$16.58/mo', save: 'Save $149/yr', label: '/year · billed annually' },
      feats: [
        'Full position-specific meal plans',
        'Complete workout program',
        'Session logger + PR detection',
        'Exercise Library (40 + YouTube)',
        '30-day history timeline',
        'Progress photos + body tracking',
        'PDF downloads + email to self',
        'Push notifications + calendar',
      ],
      cta: 'Get Athlete',
      ctaClass: 'bgh',
      feat: false,
    },
    {
      tierKey: 'elite',
      tier: 'Champion',
      name: 'Elite',
      monthly: { price: '$69', label: '/month · billed monthly' },
      annual:  { price: '$529', moEquiv: '$44.08/mo', save: 'Save $299/yr', label: '/year · billed annually' },
      feats: [
        'Everything in Athlete',
        'AI Coach — unlimited, daily briefs',
        'Injury recovery (100+ protocols)',
        'Supplement stack + full dosing (180+)',
        '16-week periodization plan',
        '90-day history + recruiting profile',
        'Progress Report + Report Card PDFs',
        'Email everything to coach',
      ],
      cta: 'Get Elite Access',
      ctaClass: 'bg',
      feat: true,
    },
    {
      tierKey: 'coach',
      tier: 'Professional',
      name: 'Coach Pro',
      monthly: { price: '$99', extra: '+ $4.99/athlete/mo', label: '/month base + per athlete' },
      annual:  { price: '$899', extra: '+ $39.99/ath/yr', moEquiv: '$74.92/mo', save: 'Save ~$280/yr', label: '/year base' },
      feats: [
        'Everything in Elite',
        'Coach dashboard — roster + readiness',
        'Athlete invite + roster management',
        'Program delivery to athletes',
        'Team wellness feed',
        'Team reports + compliance',
      ],
      cta: 'Join Waitlist',
      ctaClass: 'bgh',
      feat: false,
      waitlist: true,
      badge: 'Q3 2026',
    },
  ];

  return (
    <div>
      {/* Billing toggle */}
      <div style={{display:'flex',justifyContent:'center',marginBottom:'3rem'}}>
        <div style={{display:'flex',background:'rgba(255,255,255,0.04)',borderRadius:'var(--r)',padding:'4px',gap:'4px'}}>
          <button onClick={()=>setBilling('annual')} style={{
            padding:'0.55rem 1.75rem',fontSize:'0.72rem',letterSpacing:'1.5px',
            borderRadius:'calc(var(--r) - 2px)',border:'none',cursor:'pointer',transition:'all 0.2s',
            background: billing==='annual'?'var(--gold)':'transparent',
            color:       billing==='annual'?'#0a0908':'var(--muted)',
            fontWeight:  billing==='annual'?700:400,
          }}>
            ANNUAL <span style={{fontSize:'0.62rem',marginLeft:'6px',opacity:0.85}}>SAVE UP TO 43%</span>
          </button>
          <button onClick={()=>setBilling('monthly')} style={{
            padding:'0.55rem 1.75rem',fontSize:'0.72rem',letterSpacing:'1.5px',
            borderRadius:'calc(var(--r) - 2px)',border:'none',cursor:'pointer',transition:'all 0.2s',
            background: billing==='monthly'?'rgba(255,255,255,0.08)':'transparent',
            color:       billing==='monthly'?'var(--ivory)':'var(--muted)',
          }}>
            MONTHLY
          </button>
        </div>
      </div>

      {/* 4-column price grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'2px',
        background:'rgba(191,161,106,0.07)',border:'1px solid rgba(191,161,106,0.07)',
        borderRadius:'var(--r-xl)',overflow:'hidden'}}>
        {TIERS.map(t => {
          const b = billing === 'annual' ? t.annual : t.monthly;
          return (
            <div key={t.name} style={{
              background: t.feat ? 'var(--slate)' : 'var(--charcoal)',
              padding:'2.5rem 2rem',position:'relative',overflow:'hidden',
              transition:'background 0.35s',
            }}>
              {/* Gold glow on featured */}
              {t.feat && <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at top,rgba(191,161,106,0.07)0%,transparent70%)',pointerEvents:'none'}}/>}
              {/* Most Popular ribbon */}
              {t.feat && <div style={{position:'absolute',top:'18px',right:'-32px',background:'var(--gold)',color:'var(--onyx)',fontSize:'0.5rem',fontWeight:700,letterSpacing:'2px',padding:'0.28rem 3.5rem',transform:'rotate(45deg)'}}>MOST POPULAR</div>}
              {/* Coming Soon badge */}
              {t.badge && <div style={{display:'inline-block',background:'rgba(191,161,106,0.1)',border:'1px solid rgba(191,161,106,0.25)',borderRadius:'2px',padding:'0.2rem 0.6rem',fontSize:'0.55rem',letterSpacing:'2px',color:'var(--gold)',marginBottom:'0.75rem'}}>{t.badge}</div>}

              <div style={{fontSize:'0.7rem',fontWeight:700,letterSpacing:'4px',textTransform:'uppercase',color:'var(--gold)',marginBottom:'1.25rem'}}>{t.tier}</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:'1.75rem',fontWeight:600,letterSpacing:'3px',color:'var(--ivory)',lineHeight:1,marginBottom:'0.2rem'}}>{t.name}</div>

              {/* Price */}
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:'3.8rem',fontWeight:600,lineHeight:1,color:'var(--gold-lt)',letterSpacing:'-2px',marginTop:'0.75rem'}}>
                {b.price}
              </div>
              {b.extra && <div style={{fontSize:'0.7rem',color:'var(--gold)',letterSpacing:'0.5px',marginTop:'2px'}}>{b.extra}</div>}
              <div style={{fontSize:'0.65rem',color:'var(--muted)',letterSpacing:'1px',marginBottom:'0.35rem',marginTop:'4px'}}>{b.label}</div>
              {billing==='annual' && b.save && (
                <div style={{fontSize:'0.65rem',color:'var(--gold-lt)',marginBottom:'2rem'}}>{b.save} · {b.moEquiv}</div>
              )}
              {!(billing==='annual' && b.save) && <div style={{marginBottom:'2rem'}}/>}

              <ul style={{listStyle:'none',marginBottom:'2rem'}}>
                {t.feats.map(f=>(
                  <li key={f} style={{padding:'0.5rem 0',fontSize:'0.84rem',color:'var(--ivory2)',borderBottom:'1px solid rgba(191,161,106,0.06)',display:'flex',gap:'0.65rem',alignItems:'center',fontWeight:300}}>
                    <span style={{color:'var(--gold)',fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>—</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                className={t.ctaClass}
                style={{width:'100%',padding:'0.85rem'}}
                onClick={() => setPayModal({ tierKey: t.tierKey, billing })}>
                {t.cta}
              </button>
            </div>
          );
        })}
      </div>

      {/* Value anchor */}
      <p style={{textAlign:'center',fontSize:'0.78rem',color:'var(--muted)',marginTop:'2rem',fontWeight:300,fontStyle:'italic'}}>
        Private sports nutritionist $200–500/mo + strength coach $300–800/mo = $500–1,300/mo.
        Elite Athlete = $44/month.
      </p>
    </div>
  );
}

// EMAIL MODAL — Send to self or coach (elite gate)
// ─────────────────────────────────────────────────────────────
function EmailModal({ emailModal, authUser, isPremium, onSend, onClose, setPayModal, shout }) {
  const [recipient, setRecipient] = useState("self");
  const [coachEmail, setCoachEmail] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const toEmail = recipient === "self" ? authUser?.email : coachEmail;
    if (!toEmail || (recipient === "coach" && !coachEmail.includes("@"))) {
      shout("Enter a valid coach email", "!"); return;
    }
    setSending(true);
    await onSend(toEmail);
    setSending(false);
    onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"2rem",width:"100%",maxWidth:"440px"}}>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.5rem",fontWeight:600,marginBottom:"0.3rem"}}>
          Email <em style={{color:"var(--gold)"}}>{emailModal?.label}</em>
        </div>
        <div style={{fontSize:"0.84rem",letterSpacing:"3px",color:"var(--muted)",textTransform:"uppercase",marginBottom:"1.5rem"}}>Choose recipient</div>

        {/* Self option */}
        <div onClick={()=>setRecipient("self")} style={{display:"flex",alignItems:"center",gap:"0.75rem",padding:"0.9rem 1rem",borderRadius:"var(--r)",border:`1px solid ${recipient==="self"?"var(--gold)":"var(--border)"}`,marginBottom:"0.75rem",cursor:"pointer",background:recipient==="self"?"rgba(191,161,106,0.06)":"transparent"}}>
          <div style={{width:"16px",height:"16px",borderRadius:"50%",border:`2px solid ${recipient==="self"?"var(--gold)":"var(--muted)"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {recipient==="self" && <div style={{width:"8px",height:"8px",borderRadius:"50%",background:"var(--gold)"}}/>}
          </div>
          <div>
            <div style={{fontSize:"0.87rem",fontWeight:600,color:"var(--fg)"}}>Send to Myself</div>
            <div style={{fontSize:"0.76rem",color:"var(--muted)"}}>{authUser?.email}</div>
          </div>
        </div>

        {/* Coach option — premium gated */}
        <div onClick={()=>{ if(!isPremium){setPayModal({name:"Elite",price:"$79",per:"/month"});onClose();return;} setRecipient("coach");}}
          style={{display:"flex",alignItems:"center",gap:"0.75rem",padding:"0.9rem 1rem",borderRadius:"var(--r)",border:`1px solid ${recipient==="coach"?"var(--gold)":"var(--border)"}`,marginBottom:"1.25rem",cursor:"pointer",background:recipient==="coach"?"rgba(191,161,106,0.06)":"transparent",opacity:isPremium?1:0.6}}>
          <div style={{width:"16px",height:"16px",borderRadius:"50%",border:`2px solid ${recipient==="coach"?"var(--gold)":"var(--muted)"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {recipient==="coach" && <div style={{width:"8px",height:"8px",borderRadius:"50%",background:"var(--gold)"}}/>}
          </div>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
              <span style={{fontSize:"0.87rem",fontWeight:600,color:"var(--fg)"}}>Send to My Coach</span>
              {!isPremium && <span style={{fontSize:"0.82rem",letterSpacing:"2px",background:"var(--gold)",color:"#0a0908",padding:"2px 6px",borderRadius:"3px",fontWeight:700}}>ELITE</span>}
            </div>
            <div style={{fontSize:"0.76rem",color:"var(--muted)"}}>{ isPremium ? "Enter coach email below" : "Upgrade to Elite to unlock"}</div>
          </div>
        </div>

        {/* Coach email input */}
        {recipient === "coach" && isPremium && (
          <div style={{marginBottom:"1.25rem"}}>
            <label style={{fontSize:"0.84rem",letterSpacing:"2px",textTransform:"uppercase",color:"var(--muted)",display:"block",marginBottom:"0.4rem"}}>Coach Email</label>
            <input className="fi" type="email" placeholder="coach@team.com" value={coachEmail} onChange={e=>setCoachEmail(e.target.value)}/>
          </div>
        )}

        <div style={{display:"flex",gap:"0.7rem"}}>
          <button className="bgh" style={{flex:1,padding:"0.72rem"}} onClick={onClose}>Cancel</button>
          <button className="bg" style={{flex:1,padding:"0.72rem"}} onClick={handleSend} disabled={sending}>
            {sending ? "Sending…" : "✉ Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CALENDAR VIEW
// ─────────────────────────────────────────────────────────────
function CalView({shout, meals, mealType, mealFreq, wkType, wkFocus, totalCals, MEAL_PLANS, WORKOUTS,
                  checkIns=[], wkLog=[], nutritionLog=[], weightLog=[], selInj=[], profile={}, setDash, setProgressTab}) {
  const now = new Date();
  const [yr,setYr]=useState(now.getFullYear());
  const [mo,setMo]=useState(now.getMonth());
  const [evs,setEvs]=useState({});
  const [selD,setSelD]=useState(null);
  const [newEv,setNewEv]=useState("");
  const [view,setView]=useState("month"); // "month" | "week"

  // Build lookup maps from real logged data
  const checkInMap = checkIns.reduce((acc,ci)=>{
    if(!ci.date) return acc;
    const d = new Date(ci.date);
    const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if(!acc[key]) acc[key]=[];
    acc[key].push(ci);
    return acc;
  },{});

  const wkLogMap = wkLog.reduce((acc,l)=>{
    if(!l.date) return acc;
    // date format: "Mar 20" — parse it
    const parts = l.date.split(' ');
    const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const m=months[parts[0]];
    const d=parseInt(parts[1]);
    if(isNaN(m)||isNaN(d)) return acc;
    const key=`${now.getFullYear()}-${m}-${d}`;
    if(!acc[key]) acc[key]=[];
    acc[key].push(l);
    return acc;
  },{});

  const nutritionMap = nutritionLog.reduce((acc,n)=>{
    if(!n.date) return acc;
    const parts=n.date.split(' ');
    const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const m=months[parts[0]];
    const d=parseInt(parts[1]);
    if(isNaN(m)||isNaN(d)) return acc;
    const key=`${now.getFullYear()}-${m}-${d}`;
    acc[key]=n;
    return acc;
  },{});

  const syncMonthToCalendar = () => {
    const daysInMonth = new Date(yr, mo+1, 0).getDate();
    const wkTypes = ["Rest","Strength Training","Strength Training","Cardio","Strength Training","Cardio","Active Recovery"];
    const wkFocuses = ["Rest","Full Body","Upper Body","Lower Body","Upper Body","Full Body","Full Body"];
    const altTypes = mealType==="Weight Gain"
      ? ["Weight Gain","Weight Gain","Weight Maintenance","Weight Gain","Weight Gain","Weight Maintenance","Weight Gain"]
      : mealType==="Weight Loss"
      ? ["Weight Loss","Weight Loss","Weight Maintenance","Weight Loss","Weight Loss","Weight Maintenance","Weight Loss"]
      : ["Weight Maintenance","Weight Maintenance","Weight Gain","Weight Maintenance","Weight Maintenance","Weight Loss","Weight Maintenance"];
    const newEvs = {...evs};
    for(let d=1; d<=daysInMonth; d++) {
      const date = new Date(yr, mo, d);
      const dow = date.getDay();
      const key = `${yr}-${mo}-${d}`;
      const dayMeals = (MEAL_PLANS?.[altTypes[dow]]?.[mealFreq]) || meals || [];
      const dayCals = dayMeals.reduce((s,m)=>s+m.items.reduce((ss,it)=>ss+it.cal,0),0);
      const wk = wkTypes[dow];
      const focus = wkFocuses[dow];
      const mealLabel = `◆ ${altTypes[dow]} — ${dayCals.toLocaleString()} kcal`;
      const workoutLabel = wk === "Rest" ? "😴 Rest Day" : ` ${wk}: ${focus}`;
      const existing = (newEvs[key] || []).filter(e => !e.startsWith("◆") && !e.startsWith("") && !e.startsWith("😴"));
      newEvs[key] = [...existing, mealLabel, workoutLabel];
    }
    setEvs(newEvs);
    shout(`${new Date(yr,mo).toLocaleString('en-US',{month:'long'})} synced`, "📅");
  };

  const MN=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DN=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const first=new Date(yr,mo,1).getDay();
  const total=new Date(yr,mo+1,0).getDate();
  const days=[];
  for(let i=0;i<first;i++) days.push({d:null,key:null});
  for(let d=1;d<=total;d++) days.push({d,key:`${yr}-${mo}-${d}`});

  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  // Get readiness score for a check-in
  const getScore = (ci) => {
    const r=ci.recovery||0,e=ci.energy||0,sl=ci.sleep||0,so=ci.soreness||0,m=ci.mood||0;
    return parseFloat(((r*0.3+sl*0.25+e*0.2+m*0.15+((10-so)*0.1)))).toFixed(1);
  };

  const scoreColor = (score) => {
    const s=parseFloat(score);
    return s>=8?"#4BAE71":s>=6?"#F0C040":"#C0695E";
  };

  const selKey = selD ? `${yr}-${mo}-${selD}` : null;
  const selCheckIns = selKey ? (checkInMap[selKey]||[]) : [];
  const selWorkouts = selKey ? (wkLogMap[selKey]||[]) : [];
  const selNutrition = selKey ? nutritionMap[selKey] : null;
  const selManual = selKey ? (evs[selKey]||[]) : [];
  const selScore = selCheckIns.length ? getScore(selCheckIns[0]) : null;

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"1.5rem",flexWrap:"wrap",gap:"0.75rem"}}>
        <div><div className="eyebrow">Planning</div><h2 className="sh2">Training <em>Calendar</em></h2></div>
        <div style={{display:"flex",gap:"0.45rem",alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:"0.78rem",color:"var(--muted)"}}>{mealType} · {mealFreq} meals · {wkType}</span>
          <button className="bg" style={{padding:"0.5rem 0.9rem",fontSize:"0.76rem"}} onClick={syncMonthToCalendar}> Sync Plan</button>
          {/* Calendar export — ICS works with Apple Calendar, Outlook; Google needs webcal link */}
          <button className="bgh" style={{padding:"0.5rem 0.9rem",fontSize:"0.76rem"}} onClick={()=>{
            const pad=n=>String(n).padStart(2,"0");
            const icsDate=(y,m,d)=>`${y}${pad(m+1)}${pad(d)}`;
            const daysInMonth=new Date(yr,mo+1,0).getDate();
            let ics="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Elite Athlete//EN\r\nCALSCALE:GREGORIAN\r\n";
            ics+=`X-WR-CALNAME:Elite Athlete ${MN[mo]} ${yr}\r\n`;
            for(let d=1;d<=daysInMonth;d++){
              const key=`${yr}-${mo}-${d}`;
              const allEvs=evs[key]||[];
              const wks=wkLogMap[key]||[];
              wks.forEach((w,i)=>{ics+=`BEGIN:VEVENT\r\nUID:wk-${key}-${i}@ea\r\nDTSTART;VALUE=DATE:${icsDate(yr,mo,d)}\r\nSUMMARY: ${w.exercise} — ${w.load}\r\nEND:VEVENT\r\n`;});
              allEvs.forEach((ev,i)=>{ics+=`BEGIN:VEVENT\r\nUID:ev-${key}-${i}@ea\r\nDTSTART;VALUE=DATE:${icsDate(yr,mo,d)}\r\nSUMMARY:${ev}\r\nEND:VEVENT\r\n`;});
            }
            ics+="END:VCALENDAR";
            const blob=new Blob([ics],{type:"text/calendar"});
            const url=URL.createObjectURL(blob);
            const a=document.createElement("a");a.href=url;a.download=`elite-athlete-${MN[mo]}-${yr}.ics`;a.click();
            shout("ICS downloaded — open to add to Apple Calendar or Outlook","📅");
          }}>🍎 Apple / Outlook</button>
          <button className="bgh" style={{padding:"0.5rem 0.9rem",fontSize:"0.76rem"}} onClick={()=>{
            const pad=n=>String(n).padStart(2,"0");
            const icsDate=(y,m,d,h=0,min=0)=>`${y}${pad(m+1)}${pad(d)}T${pad(h)}${pad(min)}00Z`;
            const daysInMonth=new Date(yr,mo+1,0).getDate();
            let ics="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Elite Athlete//EN\r\nCALSCALE:GREGORIAN\r\n";
            for(let d=1;d<=daysInMonth;d++){
              const key=`${yr}-${mo}-${d}`;
              const allEvs=evs[key]||[];
              const wks=wkLogMap[key]||[];
              wks.forEach((w,i)=>{ics+=`BEGIN:VEVENT\r\nUID:gcal-wk-${key}-${i}@ea\r\nDTSTART:${icsDate(yr,mo,d,7,0)}\r\nDTEND:${icsDate(yr,mo,d,8,0)}\r\nSUMMARY: ${w.exercise} — ${w.load}\r\nEND:VEVENT\r\n`;});
              allEvs.filter(e=>!e.startsWith("")&&!e.startsWith("😴")).forEach((ev,i)=>{ics+=`BEGIN:VEVENT\r\nUID:gcal-ev-${key}-${i}@ea\r\nDTSTART:${icsDate(yr,mo,d,8,0)}\r\nDTEND:${icsDate(yr,mo,d,9,0)}\r\nSUMMARY:${ev}\r\nEND:VEVENT\r\n`;});
            }
            ics+="END:VCALENDAR";
            const blob=new Blob([ics],{type:"text/calendar"});
            const url=URL.createObjectURL(blob);
            // Google Calendar import URL
            const gcalUrl=`https://calendar.google.com/calendar/r/eventedit`;
            // For full month import, use the file download approach with instructions
            const a=document.createElement("a");a.href=url;a.download=`elite-athlete-${MN[mo]}-${yr}-google.ics`;a.click();
            setTimeout(()=>window.open("https://calendar.google.com/calendar/r/settings/export","_blank"),800);
            shout("Download then import at Google Calendar → Settings → Import","📅");
          }}>🗓 Google Calendar</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:selD?"minmax(0,1fr) 300px":"1fr",gap:"1rem",alignItems:"start",overflow:"hidden"}}>
        {/* Calendar grid */}
        <div style={{minWidth:0,overflow:"hidden"}}>
          {/* Month nav */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.75rem"}}>
            <button className="bsm" onClick={()=>{if(mo===0){setMo(11);setYr(y=>y-1);}else setMo(m=>m-1);setSelD(null);}}>← Prev</button>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.3rem",fontWeight:600,color:"var(--ivory)"}}>{MN[mo]} {yr}</div>
            <button className="bsm" onClick={()=>{if(mo===11){setMo(0);setYr(y=>y+1);}else setMo(m=>m+1);setSelD(null);}}>Next →</button>
          </div>

          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px",marginBottom:"2px"}}>
            {DN.map(d=><div key={d} style={{textAlign:"center",fontSize:"0.68rem",letterSpacing:"2px",color:"var(--muted)",padding:"0.3rem 0"}}>{d}</div>)}
          </div>

          {/* Day cells */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px"}}>
            {days.map(({d,key},i)=>{
              if(!d) return <div key={i}/>;
              const isToday = key===today;
              const isSel = d===selD && yr===now.getFullYear() && mo===now.getMonth() || (selD===d);
              const cis = checkInMap[key]||[];
              const wks = wkLogMap[key]||[];
              const nut = nutritionMap[key];
              const man = evs[key]||[];
              const score = cis.length ? parseFloat(getScore(cis[0])) : null;
              const hasWorkout = wks.length>0 || man.some(e=>e.startsWith("")||e.startsWith("😴"));
              const hasMeal = nut || man.some(e=>e.startsWith("◆"));

              return (
                <div key={key} onClick={()=>setSelD(d===selD&&yr===now.getFullYear()&&mo===now.getMonth()?null:d)}
                  style={{
                    minHeight:"60px",padding:"0.25rem 0.3rem",borderRadius:"6px",cursor:"pointer",overflow:"hidden",
                    background:isSel?"rgba(191,161,106,0.12)":isToday?"rgba(191,161,106,0.06)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${isSel?"rgba(255,255,255,0.12)":isToday?"rgba(191,161,106,0.2)":"rgba(255,255,255,0.04)"}`,
                    transition:"all 0.15s",
                  }}>
                  {/* Date number */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.2rem"}}>
                    <span style={{fontSize:"0.82rem",fontWeight:isToday?700:400,color:isToday?"var(--gold)":"var(--ivory2)"}}>{d}</span>
                    {score!==null && (
                      <span style={{fontSize:"0.62rem",fontWeight:700,color:scoreColor(score),lineHeight:1}}>{score}</span>
                    )}
                  </div>
                  {/* Indicators */}
                  <div style={{display:"flex",flexWrap:"wrap",gap:"2px"}}>
                    {hasWorkout && <span style={{fontSize:"0.6rem",background:"rgba(107,159,212,0.2)",color:"#6B9FD4",padding:"1px 4px",borderRadius:"2px"}}></span>}
                    {hasMeal && <span style={{fontSize:"0.6rem",background:"rgba(75,174,113,0.15)",color:"#4BAE71",padding:"1px 4px",borderRadius:"2px"}}>◆</span>}
                    {cis.length>0 && <span style={{fontSize:"0.6rem",background:"rgba(191,161,106,0.15)",color:"var(--gold)",padding:"1px 4px",borderRadius:"2px"}}>✓</span>}
                    {nut && <span style={{fontSize:"0.6rem",background:"rgba(75,174,113,0.12)",color:"#4BAE71",padding:"1px 4px",borderRadius:"2px"}}>{Math.round(parseFloat(nut.calories)||0)}k</span>}
                  </div>
                  {/* Manual events (first 1) */}
                  {man.slice(0,1).map((e,i)=>(
                    <div key={i} style={{fontSize:"0.58rem",color:"var(--muted)",marginTop:"0.15rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3}}>{e}</div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{display:"flex",gap:"1rem",marginTop:"0.75rem",flexWrap:"wrap"}}>
            {[["","Workout logged","#6B9FD4"],["◆","Meal planned","#4BAE71"],["✓","Check-in done","var(--gold)"],["Score","Readiness (0–10)","#4BAE71"]].map(([icon,label,col])=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:"0.3rem",fontSize:"0.7rem",color:"var(--muted)"}}>
                <span style={{color:col}}>{icon}</span>{label}
              </div>
            ))}
          </div>
        </div>

        {/* Day detail panel */}
        {selD && (
          <div style={{background:"var(--smoke)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"var(--r-lg)",padding:"1rem",position:"sticky",top:"1rem"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.85rem"}}>
              <div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"1.2rem",fontWeight:600,color:"var(--gold)"}}>{MN[mo]} {selD}</div>
                {selScore && (
                  <div style={{fontSize:"0.76rem",fontWeight:600,color:scoreColor(selScore),marginTop:"0.15rem"}}>
                    Readiness: {selScore}/10
                  </div>
                )}
              </div>
              <button style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",fontSize:"0.9rem"}} onClick={()=>setSelD(null)}>✕</button>
            </div>

            {/* Check-in data */}
            {selCheckIns.length>0 && (
              <div style={{marginBottom:"0.75rem",padding:"0.6rem 0.75rem",background:"rgba(255,255,255,0.03)",borderRadius:"var(--r)",border:"1px solid rgba(191,161,106,0.15)"}}>
                <div style={{fontSize:"0.66rem",letterSpacing:"2px",color:"var(--gold)",textTransform:"uppercase",fontWeight:600,marginBottom:"0.4rem"}}> Check-In</div>
                {selCheckIns.map((ci,i)=>(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"0.3rem",fontSize:"0.72rem"}}>
                    {[["Recovery",ci.recovery],["Energy",ci.energy],["Sleep",ci.sleep+"h"],["Soreness",ci.soreness],["Mood",ci.mood]].map(([l,v])=>(
                      <div key={l}><span style={{color:"var(--muted)"}}>{l}: </span><span style={{color:"var(--ivory2)",fontWeight:500}}>{v}</span></div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Workouts logged */}
            {selWorkouts.length>0 && (
              <div style={{marginBottom:"0.75rem",padding:"0.6rem 0.75rem",background:"rgba(107,159,212,0.06)",borderRadius:"var(--r)",border:"1px solid rgba(107,159,212,0.15)"}}>
                <div style={{fontSize:"0.66rem",letterSpacing:"2px",color:"#6B9FD4",textTransform:"uppercase",fontWeight:600,marginBottom:"0.4rem"}}> Workouts Logged</div>
                {selWorkouts.map((w,i)=>(
                  <div key={i} style={{fontSize:"0.76rem",color:"var(--ivory2)",marginBottom:"0.15rem",display:"flex",justifyContent:"space-between"}}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{w.exercise}</span>
                    <span style={{color:"#6B9FD4",flexShrink:0,marginLeft:"0.5rem",fontWeight:600}}>{w.load?.split(' ')[0]}</span>
                  </div>
                ))}
                <button className="bsm" style={{width:"100%",marginTop:"0.4rem",fontSize:"0.7rem",padding:"0.3rem"}} onClick={()=>{setDash("workout");}}>View Workout →</button>
              </div>
            )}

            {/* Nutrition logged */}
            {selNutrition && (
              <div style={{marginBottom:"0.75rem",padding:"0.6rem 0.75rem",background:"rgba(75,174,113,0.06)",borderRadius:"var(--r)",border:"1px solid rgba(75,174,113,0.15)"}}>
                <div style={{fontSize:"0.66rem",letterSpacing:"2px",color:"#4BAE71",textTransform:"uppercase",fontWeight:600,marginBottom:"0.4rem"}}>🥗 Nutrition</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.2rem",fontSize:"0.74rem"}}>
                  {[["Calories",selNutrition.calories,"kcal"],["Protein",selNutrition.protein,"g"],["Carbs",selNutrition.carbs,"g"],["Fat",selNutrition.fat,"g"]].map(([l,v,u])=>(
                    <div key={l}><span style={{color:"var(--muted)"}}>{l}: </span><span style={{color:"var(--ivory2)",fontWeight:500}}>{v}{u}</span></div>
                  ))}
                </div>
                <button className="bsm" style={{width:"100%",marginTop:"0.4rem",fontSize:"0.7rem",padding:"0.3rem"}} onClick={()=>{setDash("progress");setProgressTab("nutrition");}}>Log Nutrition →</button>
              </div>
            )}

            {/* Injuries */}
            {selInj.length>0 && (
              <div style={{marginBottom:"0.75rem",padding:"0.6rem 0.75rem",background:"rgba(192,105,94,0.06)",borderRadius:"var(--r)",border:"1px solid rgba(192,105,94,0.2)"}}>
                <div style={{fontSize:"0.66rem",letterSpacing:"2px",color:"#C0695E",textTransform:"uppercase",fontWeight:600,marginBottom:"0.3rem"}}>⚕ Active Recovery</div>
                {selInj.map(inj=><div key={inj} style={{fontSize:"0.76rem",color:"var(--ivory2)"}}>{inj}</div>)}
              </div>
            )}

            {/* Manual events */}
            {selManual.length>0 && (
              <div style={{marginBottom:"0.75rem"}}>
                {selManual.map((e,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.3rem 0",borderBottom:"1px solid var(--border)",fontSize:"0.78rem"}}>
                    <span style={{color:"var(--ivory2)"}}>{e}</span>
                    <button style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",fontSize:"0.75rem"}} onClick={()=>setEvs(prev=>{const ne={...prev};ne[selKey]=(ne[selKey]||[]).filter((_,j)=>j!==i);return ne;})}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Add event */}
            <div style={{display:"flex",gap:"0.4rem"}}>
              <input className="fi" style={{flex:1,fontSize:"0.8rem",padding:"0.4rem 0.6rem"}} placeholder="Add note or event..." value={newEv} onChange={e=>setNewEv(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&newEv.trim()){setEvs(p=>{const n={...p};n[selKey]=[...(n[selKey]||[]),newEv.trim()];return n;});setNewEv("");}}}/>
              <button className="bg" style={{padding:"0.4rem 0.7rem",fontSize:"0.78rem",flexShrink:0}} onClick={()=>{
                if(newEv.trim()){setEvs(p=>{const n={...p};n[selKey]=[...(n[selKey]||[]),newEv.trim()];return n;});setNewEv("");}
              }}>+</button>
            </div>

            {/* Empty state */}
            {!selCheckIns.length && !selWorkouts.length && !selNutrition && !selManual.length && (
              <div style={{textAlign:"center",padding:"0.75rem 0",fontSize:"0.78rem",color:"var(--muted)"}}>
                Nothing logged yet — add a note above or log a check-in
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Toast({t}) {
  const isError = t.icon === "!" || (typeof t.msg === 'string' && t.msg.toLowerCase().includes('fail'));
  return (
    <div className="toast">
      <span style={{
        width:"22px",height:"22px",borderRadius:"50%",flexShrink:0,display:"flex",
        alignItems:"center",justifyContent:"center",
        background: isError ? "rgba(192,105,94,0.2)" : "rgba(201,168,76,0.15)",
        border: isError ? "1px solid rgba(192,105,94,0.5)" : "1px solid rgba(255,255,255,0.12)",
        fontSize:"0.65rem",fontWeight:700,color: isError ? "#C0695E" : "#D4AF37"
      }}>{t.icon}</span>
      <span className="toast-m">{t.msg}</span>
    </div>
  );
}
function SuccessScreen() {
  return (
    <div className="succ">
      <div className="succ-inner">
        <div className="succ-icon">◆</div>
        <div className="succ-h">Welcome to Elite</div>
        <div className="succ-sub">Preparing your dashboard…</div>
      </div>
    </div>
  );
}
