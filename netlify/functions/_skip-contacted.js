// "Skip schools already contacted" — organisation-level de-duplication.
//
// Every other filter in this system works at the address level: has THIS person
// been emailed. That is not always the right question. When a head coach was
// mailed in one tranche and their five assistants come up in the next, all six
// addresses are individually unmailed, yet the staff room receives the same
// message twice in a week. Complaints, not bounces, are what damage a sending
// domain, and "why did three of us get this?" is how complaints start.
//
// So this collapses the audience to school+sport: if ANY address at a school,
// in that sport, has ever been sent to, everyone else there is skipped.
//
// Deliberate choices:
//
//   * "Ever mailed" spans every source, not just the cohort being sent. A
//     colleague reached through Autobuild counts exactly as much as one reached
//     through the scrape - the recipient cannot tell which list they were on.
//
//   * The roster lookup omits `status`. A colleague who has since hard-bounced
//     was still contacted, and their school should still be considered touched.
//
//   * Colleagues are found within the same folder rather than by scanning the
//     whole table. Same school implies same level, state and region, and sport
//     is fixed, so a same-school+sport colleague is always inside the folder
//     filters - which keeps this to a bounded read instead of 10k+ rows.
//
// Returns a Set of lowercased addresses to exclude, so callers filter with the
// same one-line shape they already use for the suppression and engaged lists
// and no recipient object needs reshaping.

// Folder identity only: level / state / region / sport. No narrowing filters -
// a colleague excluded by title is still a colleague - and no status.
export function folderFilters(body){
  const f=['email=not.is.null'];
  const lv=String(body.level||'').toLowerCase();  if(lv&&lv!=='all')  f.push(`level=eq.${lv}`);
  const st=String(body.state||'').toUpperCase();  if(st&&st!=='ALL')  f.push(`state=eq.${st}`);
  const rg=String(body.region||'');               if(rg&&rg.toLowerCase()!=='all') f.push(`region=eq.${encodeURIComponent(rg)}`);
  const sp=String(body.sport||'').toLowerCase();  if(sp&&sp!=='all')  f.push(`sport=eq.${sp}`);
  return f;
}

// Real boolean from a JSON body, the string "true" from a query string.
// String(false) is "false", so a bare truthiness test would invert this.
export function wantsSkipContacted(body){
  const v=body.skipContactedSchools;
  return v===true||String(v||'').toLowerCase()==='true';
}

// pageFn(pathFn, onRow) - the caller's paginated reader, so this module never
// needs the service key or fetch details of its own.
export async function contactedSchoolEmails(pageFn, body){
  const mailed=new Set();
  await pageFn(p=>`email_blasts?select=email&limit=1000&offset=${p*1000}`,
    r=>{ const e=String(r.email||'').toLowerCase(); if(e) mailed.add(e); });
  if(!mailed.size) return new Set();

  const roster=[];
  const ff=folderFilters(body);
  await pageFn(p=>`coach_contacts?${ff.concat(['select=email,school,sport','limit=1000',`offset=${p*1000}`]).join('&')}`,
    r=>{
      const e=String(r.email||'').toLowerCase();
      if(e) roster.push({ e, k:`${String(r.school||'').trim()}|${String(r.sport||'').trim()}` });
    });

  // Pass 1: which school+sport pairs have already heard from us.
  const touched=new Set();
  for(const x of roster) if(mailed.has(x.e)) touched.add(x.k);
  if(!touched.size) return new Set();

  // Pass 2: every address sitting in one of those pairs. A row with no school
  // has key "|sport", which cannot match a real school, so it is never blocked
  // by accident.
  const blocked=new Set();
  for(const x of roster) if(touched.has(x.k)) blocked.add(x.e);
  return blocked;
}
