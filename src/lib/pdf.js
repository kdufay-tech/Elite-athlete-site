// ─────────────────────────────────────────────────────────────
// src/lib/pdf.js
// Real PDF generation using jsPDF + jspdf-autotable
// ─────────────────────────────────────────────────────────────
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const GOLD  = [191, 161, 106];
const DARK  = [8,   8,   7  ];
const GRAY  = [100, 98,  88 ];
const WHITE = [242, 237, 227];
const SLATE = [28,  26,  22 ];

function addHeader(doc, title, subtitle) {
  // Black background bar
  doc.setFillColor(...DARK);
  doc.rect(0, 0, 210, 28, 'F');

  // Gold accent line
  doc.setFillColor(...GOLD);
  doc.rect(0, 28, 210, 0.8, 'F');

  // Wordmark
  doc.setTextColor(...GOLD);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('ELITE ATHLETE', 14, 12);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text('THE PREMIER ATHLETIC PLATFORM', 14, 18);

  // Title
  doc.setTextColor(...WHITE);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(title.toUpperCase(), 14, 24);

  if (subtitle) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GOLD);
    doc.text(subtitle, 210 - 14, 24, { align: 'right' });
  }
}

function addFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...DARK);
    doc.rect(0, 285, 210, 12, 'F');
    doc.setFillColor(...GOLD);
    doc.rect(0, 285, 210, 0.5, 'F');
    doc.setTextColor(...GRAY);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('Elite Athlete App — Engineered for Champions', 14, 291);
    doc.text(`Page ${i} of ${pageCount}`, 210 - 14, 291, { align: 'right' });
  }
}

// ── MEAL PLAN PDF ─────────────────────────────────────────────
export function downloadMealPlanPDF({ athleteName, sport, position, mealType, mealFreq, meals, totalCals, totalP, totalC, totalF }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  addHeader(doc, 'Nutrition Plan', `${mealFreq} Meals/Day · ${mealType}`);

  let y = 36;

  // Athlete info
  doc.setFillColor(...SLATE);
  doc.roundedRect(14, y, 182, 18, 2, 2, 'F');
  doc.setTextColor(...GOLD);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('ATHLETE', 20, y + 6);
  doc.text('SPORT', 80, y + 6);
  doc.text('DATE', 150, y + 6);
  doc.setTextColor(...WHITE);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(athleteName || '—', 20, y + 13);
  doc.text(`${sport || '—'} · ${position || '—'}`, 80, y + 13);
  doc.text(date, 150, y + 13);
  y += 24;

  // Daily totals
  doc.setFillColor(...GOLD);
  doc.roundedRect(14, y, 182, 16, 2, 2, 'F');
  doc.setTextColor(...DARK);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  const totals = [
    [`${totalCals?.toLocaleString() || 0} kcal`, 'CALORIES'],
    [`${totalP || 0}g`, 'PROTEIN'],
    [`${totalC || 0}g`, 'CARBS'],
    [`${totalF || 0}g`, 'FAT'],
  ];
  totals.forEach(([val, lbl], i) => {
    const x = 14 + i * 46 + 12;
    doc.setFontSize(11);
    doc.text(val, x, y + 9);
    doc.setFontSize(6.5);
    doc.text(lbl, x, y + 14);
  });
  y += 22;

  // Each meal
  meals.forEach((meal, idx) => {
    const mealCal = meal.items.reduce((s, i) => s + i.cal, 0);
    if (y > 250) { doc.addPage(); y = 15; }

    // Meal header
    doc.setFillColor(28, 26, 22);
    doc.roundedRect(14, y, 182, 10, 1.5, 1.5, 'F');
    doc.setTextColor(...GOLD);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`${meal.label}`, 20, y + 7);
    doc.setFontSize(8);
    doc.text(`${mealCal} kcal`, 210 - 20, y + 7, { align: 'right' });
    doc.setTextColor(...GRAY);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(meal.time, 20, y + 7 + 4.5); // secondary line hack — just shift below
    y += 13;

    // Items table
    doc.autoTable({
      startY: y,
      head: [['Food Item', 'Calories', 'Protein', 'Carbs', 'Fat']],
      body: meal.items.map(it => [it.name, `${it.cal} kcal`, `${it.p}g`, `${it.c}g`, `${it.f}g`]),
      theme: 'plain',
      styles: { fontSize: 8, textColor: WHITE, fillColor: [14, 13, 11], cellPadding: 2.5 },
      headStyles: { fontSize: 7, textColor: GOLD, fillColor: SLATE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [20, 19, 16] },
      columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 26 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 } },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  });

  addFooter(doc);
  doc.save(`Elite-Athlete-Meal-Plan-${mealType.replace(/\s/g,'-')}-${mealFreq}meals.pdf`);
}

// ── WORKOUT PDF ───────────────────────────────────────────────
export function downloadWorkoutPDF({ athleteName, sport, position, wkType, wkFocus, exercises, weekNum, progressLog }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  addHeader(doc, 'Workout Plan', date);

  let y = 36;

  // Athlete + program header
  const headerRows = [
    ['Athlete', athleteName || '—', 'Sport', `${sport || '—'}${position ? ' · ' + position : ''}`],
    ['Program', wkType, 'Focus', wkFocus],
    ['Week', weekNum ? `Week ${weekNum}` : 'Current', 'Date', date],
  ];
  doc.autoTable({
    startY: y,
    body: headerRows,
    theme: 'plain',
    styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14, 13, 11], cellPadding: 2.5 },
    columnStyles: {
      0: { textColor: GOLD, fontStyle: 'bold', cellWidth: 30 },
      1: { cellWidth: 55 },
      2: { textColor: GOLD, fontStyle: 'bold', cellWidth: 30 },
      3: { cellWidth: 67 },
    },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // Exercise table — handles both object and string formats
  const rows = exercises.map((ex, i) => {
    if (typeof ex === 'object') {
      const setsReps = `${ex.sets || '—'} × ${ex.reps || '—'}`;
      const load = ex.load || '—';
      const rest = ex.rest || '—';
      const muscles = ex.muscles || '—';
      return [i + 1, ex.name || ex, setsReps, load, rest, muscles];
    } else {
      const setsMatch = ex.match(/[\d]+×[\d]+(?:ea|s|yd)?/);
      const sets = setsMatch ? setsMatch[0] : '—';
      const name = sets !== '—' ? ex.replace(sets, '').trim() : ex;
      return [i + 1, name, sets, '—', '—', '—'];
    }
  });

  doc.autoTable({
    startY: y,
    head: [['#', 'Exercise', 'Sets × Reps', 'Load', 'Rest', 'Muscles']],
    body: rows,
    theme: 'plain',
    styles: { fontSize: 8, textColor: WHITE, fillColor: [14, 13, 11], cellPadding: 2.5 },
    headStyles: { fontSize: 7.5, textColor: GOLD, fillColor: SLATE, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [20, 19, 16] },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 52 },
      2: { cellWidth: 22 },
      3: { cellWidth: 38 },
      4: { cellWidth: 18 },
      5: { cellWidth: 44 },
    },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // Coaching cues section
  const exWithCues = exercises.filter(ex => typeof ex === 'object' && ex.cues);
  if (exWithCues.length > 0 && y < 220) {
    doc.setTextColor(...GOLD);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('COACHING CUES', 14, y);
    y += 5;

    doc.autoTable({
      startY: y,
      body: exWithCues.map((ex, i) => [`${i + 1}. ${ex.name}`, ex.cues]),
      theme: 'plain',
      styles: { fontSize: 8, textColor: WHITE, fillColor: [14, 13, 11], cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 55, textColor: GOLD, fontStyle: 'bold' }, 1: { cellWidth: 127, fontStyle: 'italic' } },
      alternateRowStyles: { fillColor: [20, 19, 16] },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Progress tracking log
  if (progressLog && progressLog.length > 0 && y < 230) {
    doc.setTextColor(...GOLD);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PROGRESS LOG', 14, y);
    y += 5;
    doc.autoTable({
      startY: y,
      head: [['Date', 'Exercise', 'Actual Load', 'Notes']],
      body: progressLog.slice(-5).map(l => [l.date, l.exercise, l.load, l.notes || '']),
      theme: 'plain',
      styles: { fontSize: 8, textColor: WHITE, fillColor: [14, 13, 11], cellPadding: 2.5 },
      headStyles: { fontSize: 7.5, textColor: GOLD, fillColor: SLATE, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 65 }, 2: { cellWidth: 40 }, 3: { cellWidth: 42 } },
      margin: { left: 14, right: 14 },
    });
  }

  // Notes area
  if (y < 245) {
    y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y;
    if (y < 245) {
      doc.setFillColor(...SLATE);
      doc.roundedRect(14, y, 182, 28, 2, 2, 'F');
      doc.setTextColor(...GOLD);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.text('SESSION NOTES', 20, y + 7);
    }
  }

  addFooter(doc);
  doc.save(`Elite-Athlete-Workout-${wkType.replace(/\s/g,'-')}-${date.replace(/,?\s/g,'-')}.pdf`);
}

// ── PROGRESS REPORT PDF ───────────────────────────────────────
export function downloadProgressReportPDF({ profile, notes, totalCals, mealType, mealFreq,
  checkIns=[], latestWeight=null, weightLog=[], avgCals7=null, avgProt7=null,
  prs=[], acwr="1.00", benchmarks=[], suppStack=[], selInj=[] }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const sportIcons = {football:'🏈',basketball:'🏀',soccer:'⚽',hockey:'🏒',volleyball:'🏐'};
  const sport = `${sportIcons[profile.sport]||''} ${profile.sport||'—'}`.trim();
  addHeader(doc, 'Athlete Progress Report', date);

  const sectionTitle = (text, y) => {
    doc.setFillColor(...SLATE);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFillColor(...GOLD);
    doc.rect(14, y, 2, 7, 'F');
    doc.setTextColor(...GOLD);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text(text.toUpperCase(), 20, y + 4.8);
    return y + 11;
  };

  let y = 36;

  // ── ATHLETE PROFILE ───────────────────────────────────────
  y = sectionTitle('Athlete Profile', y);
  const heightFt = profile.height ? `${Math.floor(profile.height/12)}'${profile.height%12}"` : '—';
  const profileStats = [
    ['Name', profile.name||'—'],    ['Sport / Position', `${sport} · ${profile.position||'—'}`],
    ['Weight', `${profile.weight||'—'} lbs`], ['Height', heightFt],
    ['Age', `${profile.age||'—'} yrs`], ['Goal', profile.goal||'—'],
    ['Calorie Target', `${totalCals?.toLocaleString()||'—'} kcal/day`], ['Meal Plan', `${mealType} · ${mealFreq} meals`],
  ];
  doc.autoTable({
    startY: y, body: profileStats, theme: 'plain',
    styles: { fontSize: 9, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
    columnStyles: { 0: { textColor: GOLD, fontStyle: 'bold', cellWidth: 55 }, 1: { cellWidth: 127 } },
    margin: { left: 14, right: 14 }, tableWidth: 182,
    didParseCell: d => { if(d.row.index%2===1) d.cell.styles.fillColor=[20,19,16]; },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ── READINESS & WELLNESS ──────────────────────────────────
  if (checkIns.length > 0) {
    y = sectionTitle('Readiness & Wellness', y);
    const lastCI = checkIns[0];
    const r=lastCI.recovery||0, e=lastCI.energy||0, sl=lastCI.sleep||0, so=lastCI.soreness||0, m=lastCI.mood||0;
    const score = ((r*0.3+sl*0.25+e*0.2+m*0.15+((10-so)*0.1))).toFixed(1);
    const acwrN = parseFloat(acwr);
    const acwrStatus = acwrN>1.5?'HIGH — reduce volume':acwrN>1.3?'Caution — monitor':acwrN<0.7?'Under-trained':'Optimal range';
    const avg7 = (key) => checkIns.slice(0,7).length ? (checkIns.slice(0,7).reduce((s,c)=>s+(c[key]||0),0)/checkIns.slice(0,7).length).toFixed(1) : '—';
    const wellnessRows = [
      ['Game-Day Readiness', `${score}/10`, '7-Day Avg Recovery', `${avg7('recovery')}/10`],
      ['Last Check-In Recovery', `${r}/10`, '7-Day Avg Energy', `${avg7('energy')}/10`],
      ['Last Check-In Energy', `${e}/10`, '7-Day Avg Sleep', `${avg7('sleep')}h`],
      ['Last Check-In Sleep', `${sl}h`, '7-Day Avg Soreness', `${avg7('soreness')}/10`],
      ['Training Load (ACWR)', acwr, 'ACWR Status', acwrStatus],
    ];
    doc.autoTable({
      startY: y, body: wellnessRows, theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      columnStyles: { 0:{textColor:GOLD,fontStyle:'bold',cellWidth:55}, 1:{cellWidth:36}, 2:{textColor:GOLD,fontStyle:'bold',cellWidth:55}, 3:{cellWidth:36} },
      margin: { left: 14, right: 14 }, tableWidth: 182,
      didParseCell: d => { if(d.row.index%2===1) d.cell.styles.fillColor=[20,19,16]; },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── BODY COMPOSITION ─────────────────────────────────────
  if (latestWeight || weightLog.length > 0) {
    y = sectionTitle('Body Composition', y);
    const startWt = weightLog.length > 0 ? weightLog[0] : null;
    const endWt = latestWeight || (weightLog.length > 0 ? weightLog[weightLog.length-1] : null);
    const delta = startWt && endWt ? (parseFloat(endWt.weight) - parseFloat(startWt.weight)).toFixed(1) : null;
    const bodyRows = [
      ['Current Weight', endWt ? `${endWt.weight} lbs` : '—', 'Starting Weight', startWt ? `${startWt.weight} lbs` : '—'],
      ['Change', delta !== null ? `${delta > 0 ? '+':''}${delta} lbs` : '—', 'Entries Logged', `${weightLog.length}`],
    ];
    if (endWt?.bodyFat) bodyRows.push(['Body Fat %', `${endWt.bodyFat}%`, '', '']);
    doc.autoTable({
      startY: y, body: bodyRows, theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      columnStyles: { 0:{textColor:GOLD,fontStyle:'bold',cellWidth:55}, 1:{cellWidth:36}, 2:{textColor:GOLD,fontStyle:'bold',cellWidth:55}, 3:{cellWidth:36} },
      margin: { left: 14, right: 14 }, tableWidth: 182,
      didParseCell: d => { if(d.row.index%2===1) d.cell.styles.fillColor=[20,19,16]; },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── NUTRITION ─────────────────────────────────────────────
  if (avgCals7 || avgProt7) {
    y = sectionTitle('Nutrition Summary (7-Day Average)', y);
    const nutRows = [
      ['Avg Calories', avgCals7 ? `${avgCals7.toLocaleString()} kcal` : '—', 'Target Calories', `${totalCals?.toLocaleString()||'—'} kcal`],
      ['Avg Protein', avgProt7 ? `${avgProt7}g` : '—', 'Meal Plan', `${mealType}`],
    ];
    doc.autoTable({
      startY: y, body: nutRows, theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      columnStyles: { 0:{textColor:GOLD,fontStyle:'bold',cellWidth:55}, 1:{cellWidth:36}, 2:{textColor:GOLD,fontStyle:'bold',cellWidth:55}, 3:{cellWidth:36} },
      margin: { left: 14, right: 14 }, tableWidth: 182,
      didParseCell: d => { if(d.row.index%2===1) d.cell.styles.fillColor=[20,19,16]; },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── PERFORMANCE BENCHMARKS ────────────────────────────────
  if (benchmarks.length > 0) {
    y = sectionTitle('Performance Benchmarks', y);
    const bestMap = benchmarks.reduce((acc,b)=>{
      if(!acc[b.test]||parseFloat(b.value)>parseFloat(acc[b.test].value)) acc[b.test]=b;
      return acc;
    },{});
    const bmRows = Object.values(bestMap).map(b => [b.test, `${b.value} ${b.unit}`, b.date||'—', b.notes||'—']);
    doc.autoTable({
      startY: y, head: [['Test','Result','Date','Notes']], body: bmRows, theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      headStyles: { fontSize: 7.5, textColor: GOLD, fillColor: SLATE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [20,19,16] },
      columnStyles: { 0:{cellWidth:70}, 1:{cellWidth:30}, 2:{cellWidth:30}, 3:{cellWidth:52} },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── STRENGTH PRs ──────────────────────────────────────────
  if (prs.length > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    y = sectionTitle('Strength Personal Records', y);
    const prRows = prs.map(([ex,pr]) => [ex, pr.load, pr.date||'—']);
    doc.autoTable({
      startY: y, head: [['Exercise','Best Load','Date']], body: prRows, theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      headStyles: { fontSize: 7.5, textColor: GOLD, fillColor: SLATE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [20,19,16] },
      columnStyles: { 0:{cellWidth:100}, 1:{cellWidth:52}, 2:{cellWidth:30} },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── SUPPLEMENT STACK ──────────────────────────────────────
  if (suppStack.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }
    y = sectionTitle('Supplement Stack', y);
    const suppRows = suppStack.map(s => [s.name, s.dose, s.timing]);
    doc.autoTable({
      startY: y, head: [['Supplement','Dose','Timing']], body: suppRows, theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      headStyles: { fontSize: 7.5, textColor: GOLD, fillColor: SLATE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [20,19,16] },
      columnStyles: { 0:{cellWidth:75}, 1:{cellWidth:47}, 2:{cellWidth:60} },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── ACTIVE INJURIES ───────────────────────────────────────
  if (selInj.length > 0) {
    if (y > 260) { doc.addPage(); y = 20; }
    y = sectionTitle('Active Recovery / Injuries', y);
    doc.autoTable({
      startY: y, body: selInj.map(inj => [inj]), theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      columnStyles: { 0:{cellWidth:182} },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── PROGRESS NOTES ────────────────────────────────────────
  if (notes && notes.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }
    y = sectionTitle('Progress Notes', y);
    doc.autoTable({
      startY: y, head: [['Date','Note']], body: notes.map(n=>[n.date||'',n.text||'']), theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14,13,11], cellPadding: 3 },
      headStyles: { fontSize: 7.5, textColor: GOLD, fillColor: SLATE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [20,19,16] },
      columnStyles: { 0:{cellWidth:35}, 1:{cellWidth:147} },
      margin: { left: 14, right: 14 },
    });
  }

  addFooter(doc);
  doc.save(`Elite-Athlete-Report-${date.replace(/,?\s/g,'-')}.pdf`);
}

// ── JOURNAL PDF ───────────────────────────────────────────────
export function downloadJournalPDF({ athleteName, entries }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  addHeader(doc, 'Personal Journal', athleteName || 'Athlete');

  let y = 40;

  entries.forEach((entry, idx) => {
    if (y > 260) { doc.addPage(); y = 20; }

    // Entry header
    doc.setFillColor(...SLATE);
    doc.roundedRect(14, y, 182, 9, 1.5, 1.5, 'F');
    doc.setTextColor(...GOLD);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text(entry.date || '', 20, y + 6);
    doc.setTextColor(...GRAY);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Entry ${idx + 1}`, 210 - 20, y + 6, { align: 'right' });
    y += 12;

    // Entry text with word wrap
    doc.setTextColor(...DARK);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(entry.text || '', 175);
    doc.text(lines, 20, y);
    y += lines.length * 5 + 8;

    // Divider
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.3);
    doc.setGState(new doc.GState({ opacity: 0.2 }));
    doc.line(14, y, 196, y);
    doc.setGState(new doc.GState({ opacity: 1 }));
    y += 6;
  });

  addFooter(doc);
  doc.save(`Elite-Athlete-Journal-${new Date().toISOString().split('T')[0]}.pdf`);
}

// ── INJURY RECOVERY PDF ───────────────────────────────────────
export function downloadRecoveryPDF({ athleteName, sport, injury, phases }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  addHeader(doc, 'Injury Recovery Protocol', `${sport || ''} · ${injury || ''}`);

  let y = 36;

  doc.setFillColor(...SLATE);
  doc.roundedRect(14, y, 182, 12, 2, 2, 'F');
  doc.setTextColor(...GOLD);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(`Athlete: ${athleteName || '—'}   |   Sport: ${sport || '—'}   |   Injury: ${injury || '—'}`, 20, y + 8);
  y += 18;

  phases.forEach(phase => {
    if (y > 250) { doc.addPage(); y = 15; }
    doc.setFillColor(...SLATE);
    doc.roundedRect(14, y, 182, 9, 1.5, 1.5, 'F');
    doc.setTextColor(...GOLD);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`${phase.label}  ·  ${phase.duration}`, 20, y + 6.5);
    y += 12;

    doc.autoTable({
      startY: y,
      body: phase.items.map(item => [item]),
      theme: 'plain',
      styles: { fontSize: 8.5, textColor: WHITE, fillColor: [14, 13, 11], cellPadding: 2.5 },
      alternateRowStyles: { fillColor: [20, 19, 16] },
      columnStyles: { 0: { cellWidth: 182 } },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  });

  addFooter(doc);
  doc.save(`Elite-Athlete-Recovery-${(injury || 'Protocol').replace(/\s/g, '-')}.pdf`);
}

// ── ATHLETE REPORT CARD PDF ───────────────────────────────────
export function downloadAthleteReportCard({ profile, sport, totalCals, wkWeek, wkLog, benchmarks, weightLog, checkIns, nutritionLog, progressPhotos }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // === DARK BACKGROUND ===
  doc.setFillColor(14, 13, 11);
  doc.rect(0, 0, 210, 297, 'F');

  // === GOLD HEADER BAR ===
  doc.setFillColor(191, 161, 106);
  doc.rect(0, 0, 210, 38, 'F');

  // Logo text
  doc.setTextColor(14, 13, 11);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('THE PREMIER ATHLETIC PLATFORM', 14, 8);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('ELITE ATHLETE', 14, 22);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('ATHLETE REPORT CARD', 14, 31);

  // Date top right
  doc.setFontSize(8);
  doc.setTextColor(14, 13, 11);
  doc.text(date, 196, 31, { align: 'right' });

  let y = 48;

  // === ATHLETE NAME HERO ===
  doc.setTextColor(...[191, 161, 106]);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(profile.name?.toUpperCase() || 'ATHLETE', 14, y);
  y += 8;

  doc.setTextColor(180, 180, 170);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const sportPos = [sport?.label || profile.sport, profile.position].filter(Boolean).join('  ·  ');
  doc.text(sportPos.toUpperCase(), 14, y);
  y += 6;

  // Divider line
  doc.setDrawColor(191, 161, 106);
  doc.setLineWidth(0.5);
  doc.line(14, y, 196, y);
  y += 8;

  // === BODY STATS ROW ===
  const stats = [
    { label: 'WEIGHT', value: profile.weight ? `${profile.weight} lbs` : '—' },
    { label: 'HEIGHT', value: profile.height ? `${Math.floor(profile.height/12)}'${profile.height%12}"` : '—' },
    { label: 'AGE', value: profile.age ? `${profile.age} yrs` : '—' },
    { label: 'GOAL', value: profile.goal?.replace('Weight ', '') || '—' },
    { label: 'CAL TARGET', value: totalCals ? `${totalCals.toLocaleString()} kcal` : '—' },
    { label: 'TRAINING WK', value: `Week ${wkWeek}` },
  ];

  const statW = 30;
  stats.forEach((s, i) => {
    const sx = 14 + i * 32;
    doc.setFillColor(24, 23, 20);
    doc.roundedRect(sx, y, 30, 18, 1, 1, 'F');
    doc.setTextColor(191, 161, 106);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text(s.label, sx + 15, y + 6, { align: 'center' });
    doc.setTextColor(240, 235, 220);
    doc.setFontSize(9);
    doc.text(s.value, sx + 15, y + 13, { align: 'center' });
  });
  y += 26;

  // === PERFORMANCE BENCHMARKS ===
  if (benchmarks && benchmarks.length > 0) {
    doc.setTextColor(191, 161, 106);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text('PERFORMANCE BENCHMARKS', 14, y);
    y += 5;

    // Get best per test
    const bests = {};
    benchmarks.forEach(b => {
      if (!bests[b.test] || parseFloat(b.value) > parseFloat(bests[b.test].value)) {
        bests[b.test] = b;
      }
    });

    const benchRows = Object.values(bests).slice(0, 6);
    const colW = 86;
    benchRows.forEach((b, i) => {
      const col = i % 2;
      const bx = 14 + col * 97;
      const by = y + Math.floor(i / 2) * 12;
      doc.setFillColor(20, 19, 16);
      doc.rect(bx, by, colW, 10, 'F');
      doc.setTextColor(180, 180, 170);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text(b.test, bx + 3, by + 6.5);
      doc.setTextColor(75, 174, 113);
      doc.setFont('helvetica', 'bold');
      doc.text(`${b.value} ${b.unit}`, bx + colW - 3, by + 6.5, { align: 'right' });
    });
    y += Math.ceil(benchRows.length / 2) * 12 + 6;
  }

  // === TRAINING SUMMARY ===
  doc.setDrawColor(30, 28, 24);
  doc.setLineWidth(0.3);
  doc.line(14, y, 196, y);
  y += 6;
  doc.setTextColor(191, 161, 106);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('TRAINING SUMMARY', 14, y);
  y += 5;

  const prs = Object.entries(
    wkLog.reduce((acc, l) => {
      const num = parseFloat(l.load);
      if (num && (!acc[l.exercise] || num > acc[l.exercise])) acc[l.exercise] = num;
      return acc;
    }, {})
  ).slice(0, 6);

  if (prs.length > 0) {
    prs.forEach(([ ex, load ], i) => {
      const col = i % 2;
      const px = 14 + col * 97;
      const py = y + Math.floor(i / 2) * 10;
      doc.setFillColor(20, 19, 16);
      doc.rect(px, py, 86, 8, 'F');
      doc.setTextColor(180, 180, 170);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text(ex.length > 28 ? ex.substring(0, 28) + '…' : ex, px + 3, py + 5.5);
      doc.setTextColor(191, 161, 106);
      doc.setFont('helvetica', 'bold');
      doc.text(`${load} lbs`, px + 83, py + 5.5, { align: 'right' });
    });
    y += Math.ceil(prs.length / 2) * 10 + 6;
  } else {
    doc.setTextColor(100, 100, 95);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text('No workout loads logged yet', 14, y);
    y += 10;
  }

  // === WELLNESS SNAPSHOT ===
  if (checkIns && checkIns.length > 0) {
    doc.line(14, y, 196, y);
    y += 6;
    doc.setTextColor(191, 161, 106);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text('WELLNESS SNAPSHOT — 7-DAY AVERAGE', 14, y);
    y += 5;

    const last7 = checkIns.slice(-7);
    const avg = (key) => (last7.reduce((s, c) => s + (parseFloat(c[key]) || 0), 0) / last7.length).toFixed(1);
    const wellnessStats = [
      { label: 'RECOVERY', value: avg('recovery') + '/10' },
      { label: 'ENERGY', value: avg('energy') + '/10' },
      { label: 'SLEEP', value: avg('sleep') + ' hrs' },
      { label: 'MOOD', value: avg('mood') + '/10' },
      { label: 'CHECK-INS', value: checkIns.length.toString() },
    ];

    wellnessStats.forEach((ws, i) => {
      const wx = 14 + i * 37;
      doc.setFillColor(24, 23, 20);
      doc.roundedRect(wx, y, 35, 14, 1, 1, 'F');
      doc.setTextColor(191, 161, 106);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'bold');
      doc.text(ws.label, wx + 17.5, y + 5, { align: 'center' });
      doc.setTextColor(240, 235, 220);
      doc.setFontSize(9);
      doc.text(ws.value, wx + 17.5, y + 11, { align: 'center' });
    });
    y += 22;
  }

  // === WEIGHT TREND ===
  if (weightLog && weightLog.length > 1) {
    doc.line(14, y, 196, y);
    y += 6;
    doc.setTextColor(191, 161, 106);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    const delta = (weightLog[weightLog.length-1].weight - weightLog[0].weight).toFixed(1);
    doc.text(`WEIGHT TREND  (${delta > 0 ? '+' : ''}${delta} lbs since start)`, 14, y);
    y += 3;
  }

  // === FOOTER ===
  y = 270;
  doc.setDrawColor(191, 161, 106);
  doc.setLineWidth(0.3);
  doc.line(14, y, 196, y);
  y += 5;
  doc.setTextColor(100, 100, 95);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Generated by Elite Athlete — The Premier Athletic Platform', 14, y);
  doc.text(`eliteathlete.app  ·  ${date}`, 196, y, { align: 'right' });

  // Watermark
  doc.setTextColor(25, 24, 20);
  doc.setFontSize(60);
  doc.setFont('helvetica', 'bold');
  doc.text('ELITE', 105, 180, { align: 'center', angle: 45 });

  doc.save(`Elite-Athlete-Report-Card-${(profile.name || 'Athlete').replace(/\s/g, '-')}.pdf`);
}
