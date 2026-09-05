// netlify/functions/coach-contacts-import.js
// Coach Ops - contact ingestion engine.
// Accepts either a raw CSV (any vendor's column layout) or a pre-structured
// rows[] array (used by the client after it parses Excel or PDF). Maps arbitrary
// headers onto the coach_contacts schema, normalizes state/level/sport/email,
// folds sport variants, dedupes on email, and files each row into its folder
// (state / region / level / sport). Admin-gated. Returns an import summary.
// GET returns folder counts, or a filtered recipient count when query params are set.

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
  phone: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'cell', 'school phone', 'work phone', 'office phone'],
  website: ['website', 'url', 'web', 'site', 'web site', 'proof url'],
  email_status: ['email status', 'email verification', 'deliverability', 'verification', 'verification status', 'status'],
  source: ['source', 'origin', 'list'],
};

const STATES = { alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO', connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY', 'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR', pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD', tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', 'west virginia':'WV', wisconsin:'WI', wyoming:'WY', 'district of columbia':'DC' };

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
  if (/(high\s*school|^hs$|highschool|prep|varsity|secondary)/.test(s)) return 'hs';
  if (/(college|university|ncaa|naia|juco|univ)/.test(s)) return 'college';
  if (/(pro|professional|nfl|nba|mlb|mls|nhl)/.test(s)) return 'pro';
  return null;
}
function normSport(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes('football')) return 'football';
  if (s.includes('basketball')) return 'basketball';
  if (s.includes('soccer')) return 'soccer';
  if (s.includes('volleyball')) return 'volleyball';
  if (s.includes('hockey')) return 'hockey';
  return String(v).trim().toLowerCase() || null;
}
function normEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}
function isVerified(v) {
  return /verified|deliverable|valid|good|ok|passed/i.test(String(v || ''));
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

// Normalize one loosely-shaped record (from CSV row or client-parsed rows[]) into a contact.
function toContact(raw, defs) {
  const email = normEmail(raw.email);
  if (!email) return null;
  let coach = (raw.coach_name || '').trim();
  if (!coach) coach = [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim();
  const st = normState(raw.state) || defs.state || null;
  const region = (raw.region || '').trim() || defs.region || (st ? US_REGION[st] : null) || null;
  return {
    email,
    coach_name: coach || null,
    ad_name: (raw.ad_name || '').trim() || null,
    school: (raw.school || '').trim() || null,
    sport: normSport(raw.sport) || (defs.sport ? normSport(defs.sport) : null) || null,
    level: normLevel(raw.level) || defs.level || null,
    state: st,
    region,
    classification: (raw.classification || '').trim() || null,
    phone: (raw.phone || '').trim() || null,
    website: (raw.website || '').trim() || null,
    source: (raw.source || '').trim() || defs.source,
    status: 'active',
    validated: raw.validated === true || isVerified(raw.email_status),
  };
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
        const sq = f.concat(['select=coach_name,school', 'limit=1']).join('&');
        const sr = await fetch(`${SUPABASE_URL}/rest/v1/coach_contacts?${sq}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        const srows = sr.ok ? await sr.json() : [];
        return new Response(JSON.stringify({ ok: true, count, sample: srows[0] || null }), { status: 200, headers: CORS });
      }
      const fr = await fetch(`${SUPABASE_URL}/rest/v1/coach_contacts_folders?select=*`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      const folders = fr.ok ? await fr.json() : [];
      return new Response(JSON.stringify({ ok: true, folders }), { status: 200, headers: CORS });
    }

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const defaults = body.defaults || {};
    const defs = {
      state: normState(defaults.state),
      level: normLevel(defaults.level) || (defaults.level ? String(defaults.level).toLowerCase() : null),
      sport: defaults.sport ? String(defaults.sport).trim() : null,
      region: defaults.region ? String(defaults.region).trim() : null,
      source: defaults.source ? String(defaults.source).trim() : 'import',
    };

    let rawRecords = [];
    let mappedColumns = [];
    let unmappedHeaders = [];
    let rowsInFile = 0;

    if (Array.isArray(body.rows)) {
      // Pre-structured rows (client already parsed Excel/PDF into schema-ish objects)
      rowsInFile = body.rows.length;
      rawRecords = body.rows;
      mappedColumns = ['(pre-parsed rows)'];
    } else {
      const csv = body.csv;
      if (!csv || typeof csv !== 'string') return new Response(JSON.stringify({ error: 'No CSV or rows provided' }), { status: 400, headers: CORS });
      const grid = parseCSV(csv);
      if (grid.length < 2) return new Response(JSON.stringify({ error: 'File has no data rows' }), { status: 400, headers: CORS });
      const header = grid[0];
      const col = buildColumnIndex(header);
      mappedColumns = Object.keys(col);
      unmappedHeaders = header.filter(h => { const k = String(h||'').trim().toLowerCase(); return !Object.values(HEADER_MAP).some(syns => syns.includes(k)); });
      const get = (r, f) => (col[f] !== undefined ? String(r[col[f]] ?? '').trim() : '');
      rowsInFile = grid.length - 1;
      rawRecords = grid.slice(1).map(r => ({
        email: get(r, 'email'), coach_name: get(r, 'coach_name'), first_name: get(r, 'first_name'), last_name: get(r, 'last_name'),
        ad_name: get(r, 'ad_name'), school: get(r, 'school'), sport: get(r, 'sport'), level: get(r, 'level'),
        state: get(r, 'state'), region: get(r, 'region'), classification: get(r, 'classification'), phone: get(r, 'phone'),
        website: get(r, 'website'), email_status: get(r, 'email_status'), source: get(r, 'source'),
      }));
    }

    const contacts = [];
    const seen = new Set();
    let noEmail = 0;
    for (const raw of rawRecords) {
      const c = toContact(raw, defs);
      if (!c) { noEmail++; continue; }
      if (seen.has(c.email)) continue;
      seen.add(c.email);
      contacts.push(c);
    }

    if (!contacts.length) return new Response(JSON.stringify({ error: 'No rows with a valid email were found', rowsInFile, mappedColumns }), { status: 400, headers: CORS });

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

    return new Response(JSON.stringify({
      ok: true,
      summary: {
        rowsInFile,
        skippedNoEmail: noEmail,
        validContacts: contacts.length,
        inserted,
        duplicatesSkipped: contacts.length - inserted,
        mappedColumns,
        unmappedHeaders,
        appliedDefaults: defs,
      },
      sample: contacts.slice(0, 3),
    }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: CORS });
  }
};
