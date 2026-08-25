// netlify/functions/coach-contacts-import.js
// Coach Ops - contact ingestion engine.
// POST a raw CSV (any vendor's column layout) + optional defaults; the engine
// parses it, maps arbitrary headers onto the coach_contacts schema, normalizes
// state/level/email, dedupes on email, and files each row into its folder
// (state / region / level / sport). Admin-gated. Returns an import summary.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || 'kiszo@taratechent.com';

// --- header synonyms -> schema field ---------------------------------------
const HEADER_MAP = {
  email: ['email', 'email address', 'e-mail', 'emailaddress', 'coach email', 'work email', 'contact email'],
  coach_name: ['coach name', 'coach', 'name', 'full name', 'contact name', 'contact'],
  first_name: ['first name', 'firstname', 'first'],
  last_name: ['last name', 'lastname', 'last', 'surname'],
  ad_name: ['ad name', 'athletic director', 'athletic director name', 'ad', 'a.d.'],
  school: ['school', 'school name', 'organization', 'institution', 'org', 'company', 'program'],
  sport: ['sport', 'sports', 'sport name'],
  level: ['level', 'division', 'category', 'type'],
  state: ['state', 'st', 'state code', 'province'],
  region: ['region', 'metro', 'area', 'district', 'conference'],
  classification: ['classification', 'class', 'clazz'],
  phone: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'cell'],
  website: ['website', 'url', 'web', 'site', 'web site'],
  source: ['source', 'origin', 'list'],
};

const STATES = { alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO', connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY', 'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR', pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD', tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', 'west virginia':'WV', wisconsin:'WI', wyoming:'WY', 'district of columbia':'DC' };

// state -> US region (so 'region' folders auto-populate from state)
const US_REGION = {
  CT:'Northeast', ME:'Northeast', MA:'Northeast', NH:'Northeast', NJ:'Northeast', NY:'Northeast', PA:'Northeast', RI:'Northeast', VT:'Northeast',
  AL:'Southeast', AR:'Southeast', FL:'Southeast', GA:'Southeast', KY:'Southeast', LA:'Southeast', MS:'Southeast', NC:'Southeast', SC:'Southeast', TN:'Southeast', VA:'Southeast', WV:'Southeast', DC:'Southeast', DE:'Southeast', MD:'Southeast',
  IL:'Midwest', IN:'Midwest', IA:'Midwest', KS:'Midwest', MI:'Midwest', MN:'Midwest', MO:'Midwest', NE:'Midwest', ND:'Midwest', OH:'Midwest', SD:'Midwest', WI:'Midwest',
  AZ:'Southwest', NM:'Southwest', OK:'Southwest', TX:'Southwest',
  AK:'West', CA:'West', CO:'West', HI:'West', ID:'West', MT:'West', NV:'West', OR:'West', UT:'West', WA:'West', WY:'West',
};

function normState(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATES[s.toLowerCase()] || s.slice(0, 40);
}
function normLevel(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (/(high\s*school|^hs$|highschool|prep|varsity)/.test(s)) return 'hs';
  if (/(college|university|ncaa|naia|juco|univ)/.test(s)) return 'college';
  if (/(pro|professional|nfl|nba|mlb|mls|nhl)/.test(s)) return 'pro';
  return null;
}
function normEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

// --- minimal RFC-4180-ish CSV parser (handles quotes, commas, CRLF) --------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  const s = text.replace(/^﻿/, ''); // strip BOM
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

function buildColumnIndex(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const key = String(h || '').trim().toLowerCase();
    for (const [field, syns] of Object.entries(HEADER_MAP)) {
      if (syns.includes(key)) { if (idx[field] === undefined) idx[field] = i; }
    }
  });
  return idx;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  try {
    if (req.method !== 'POST' && req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
    if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: CORS });

    const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    const ur = token ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } }) : null;
    const u = ur && ur.ok ? await ur.json() : null;
    if (!u || u.email !== ADMIN_EMAIL) return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: CORS });

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const p = url.searchParams;
      const hasFilter = ['level','state','region','sport'].some(k => p.get(k) !== null);
      if (hasFilter) {
        const f = ['status=eq.active', 'email=not.is.null'];
        const lv = String(p.get('level')||'').toLowerCase(); if (lv && lv !== 'all') f.push(`level=eq.${lv}`);
        const st = String(p.get('state')||'').toUpperCase(); if (st && st !== 'ALL') f.push(`state=eq.${st}`);
        const rg = String(p.get('region')||''); if (rg && rg.toLowerCase() !== 'all') f.push(`region=eq.${encodeURIComponent(rg)}`);
        const sp = String(p.get('sport')||'').toLowerCase(); if (sp && sp !== 'all') f.push(`sport=eq.${sp}`);
        const q = f.concat(['select=id']).join('&');
        const cr = await fetch(`${SUPABASE_URL}/rest/v1/coach_contacts?${q}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact', Range: '0-0' } });
        const range = cr.headers.get('content-range') || '';
        const count = parseInt((range.split('/')[1] || '0'), 10) || 0;
        return new Response(JSON.stringify({ ok: true, count }), { status: 200, headers: CORS });
      }
      const fr = await fetch(`${SUPABASE_URL}/rest/v1/coach_contacts_folders?select=*`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      const folders = fr.ok ? await fr.json() : [];
      return new Response(JSON.stringify({ ok: true, folders }), { status: 200, headers: CORS });
    }

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const csv = body.csv;
    const defaults = body.defaults || {};
    if (!csv || typeof csv !== 'string') return new Response(JSON.stringify({ error: 'No CSV provided' }), { status: 400, headers: CORS });

    const grid = parseCSV(csv);
    if (grid.length < 2) return new Response(JSON.stringify({ error: 'CSV has no data rows' }), { status: 400, headers: CORS });

    const header = grid[0];
    const col = buildColumnIndex(header);
    const dataRows = grid.slice(1);

    const defState = normState(defaults.state);
    const defLevel = normLevel(defaults.level) || (defaults.level ? String(defaults.level).toLowerCase() : null);
    const defSport = defaults.sport ? String(defaults.sport).trim() : null;
    const defRegion = defaults.region ? String(defaults.region).trim() : null;
    const defSource = defaults.source ? String(defaults.source).trim() : 'csv import';

    const get = (r, f) => (col[f] !== undefined ? String(r[col[f]] ?? '').trim() : '');
    const contacts = [];
    let noEmail = 0;
    const seen = new Set();
    for (const r of dataRows) {
      const email = normEmail(get(r, 'email'));
      if (!email) { noEmail++; continue; }
      if (seen.has(email)) continue;
      seen.add(email);
      let coach = get(r, 'coach_name');
      if (!coach) { const fn = get(r, 'first_name'), ln = get(r, 'last_name'); coach = [fn, ln].filter(Boolean).join(' ').trim(); }
      const st = normState(get(r, 'state')) || defState || null;
      const region = get(r, 'region') || defRegion || (st ? US_REGION[st] : null) || null;
      contacts.push({
        email,
        coach_name: coach || null,
        ad_name: get(r, 'ad_name') || null,
        school: get(r, 'school') || null,
        sport: get(r, 'sport') || defSport || null,
        level: normLevel(get(r, 'level')) || defLevel || null,
        state: st,
        region,
        classification: get(r, 'classification') || null,
        phone: get(r, 'phone') || null,
        website: get(r, 'website') || null,
        source: get(r, 'source') || defSource,
        status: 'active',
        validated: false,
      });
    }

    if (!contacts.length) return new Response(JSON.stringify({ error: 'No rows with a valid email were found', parsed: dataRows.length, mappedColumns: col }), { status: 400, headers: CORS });

    // Insert in batches, ignoring rows whose email already exists.
    let inserted = 0;
    const BATCH = 500;
    for (let i = 0; i < contacts.length; i += BATCH) {
      const batch = contacts.slice(i, i + BATCH);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/coach_contacts?on_conflict=email`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(batch),
      });
      if (r.ok) { const saved = await r.json().catch(() => []); inserted += saved.length; }
      else { const e = await r.text().catch(() => ''); return new Response(JSON.stringify({ error: 'Insert failed', detail: e.slice(0, 300), insertedSoFar: inserted }), { status: 500, headers: CORS }); }
    }

    const mapped = Object.keys(col);
    return new Response(JSON.stringify({
      ok: true,
      summary: {
        rowsInFile: dataRows.length,
        skippedNoEmail: noEmail,
        validContacts: contacts.length,
        inserted,
        duplicatesSkipped: contacts.length - inserted,
        mappedColumns: mapped,
        unmappedHeaders: header.filter(h => { const k = String(h||'').trim().toLowerCase(); return !Object.values(HEADER_MAP).some(syns => syns.includes(k)); }),
        appliedDefaults: { state: defState, level: defLevel, sport: defSport, region: defRegion, source: defSource },
      },
      sample: contacts.slice(0, 3),
    }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: CORS });
  }
};
