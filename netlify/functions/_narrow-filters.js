// Narrowing filters applied on top of the level/state/region/sport folder.
//
// This lives in its own module because BOTH the sender (marketing-blast) and
// the recipient counter (coach-contacts-import) have to build the identical
// query. A count that disagrees with the send is worse than no count at all -
// it is a number the operator trusts while a different set of people receives
// the email.
//
//   source           - prefix match, e.g. "Scrape NCAA"
//   titleIncludes    - substring the title must contain, e.g. "head coach"
//   titleExcludes    - comma-separated substrings the title must NOT contain,
//                      e.g. "assistant,assoc" (needed because "Associate Head
//                      Coach" contains "head coach")
//   divisionExcludes - comma-separated exact division values to drop,
//                      e.g. "CLUB,SPRINT" for non-varsity programmes
//   verifiedOnly     - true to require a non-NULL title, i.e. the contact was
//                      seen on a live staff page during the crawl
//
// All optional: omit every one and recipient selection is byte-for-byte what
// it was before this module existed.
export function applyNarrowFilters(f,body){
  const src=String(body.source||'').trim();
  if(src) f.push(`source=ilike.${encodeURIComponent(src+'*')}`);
  const ti=String(body.titleIncludes||'').trim();
  if(ti) f.push(`title=ilike.${encodeURIComponent('*'+ti+'*')}`);

  // A non-NULL title means the crawler found this person on their school's live
  // staff directory, so the address was confirmed against a real page rather
  // than generated from a name. In the 2026-09-15 Autobuild volleyball pilot
  // that split 300 recipients into 125 titled (0 bounced) and 175 untitled
  // (10 bounced, 5.71%) - so this is a deliverability control, not a seniority
  // one, and it stays independent of titleIncludes on purpose.
  //
  // Arrives as a real boolean from marketing-blast's JSON body and as the
  // string "true" from the count endpoint's query string, hence both checks;
  // String(false) is "false", so a bare truthiness test would invert this.
  const vo=body.verifiedOnly;
  if(vo===true||String(vo||'').toLowerCase()==='true') f.push('title=not.is.null');

  // Exclusions have to be NULL-safe. PostgREST renders `title=not.ilike.*x*`
  // as NOT (title ILIKE '%x%'), which for a row with a NULL title evaluates to
  // NULL rather than TRUE - so the row is dropped. Most of this table predates
  // the 2026-09 scrape and has no title or division at all, meaning a bare
  // not.ilike would silently remove ~6,000 people from a send that never
  // intended to touch them. Each list is therefore wrapped as
  // "column is null OR none of the terms match".
  //
  // Both groups go into ONE `and=(...)` parameter because PostgREST honours a
  // single top-level `or`/`and` key; pushing two `or=` params would let the
  // second quietly overwrite the first.
  const terms=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
  const groups=[];
  const tx=terms(body.titleExcludes);
  if(tx.length) groups.push(`or(title.is.null,and(${
    tx.map(x=>`title.not.ilike."*${encodeURIComponent(x)}*"`).join(',')}))`);
  // division holds the program's actual level, so non-varsity rows (CLUB,
  // SPRINT) are excluded by fact rather than by guessing at title wording:
  // Navy's sprint football coach is titled plainly "Head Coach", and Calvin's
  // two ACHA coaches are indistinguishable from varsity in title AND
  // sport_detail. Exact match - these are controlled values, not scraped prose.
  const dx=terms(body.divisionExcludes);
  if(dx.length) groups.push(`or(division.is.null,division.not.in.(${
    dx.map(x=>`"${encodeURIComponent(x)}"`).join(',')}))`);
  if(groups.length) f.push(`and=(${groups.join(',')})`);
}
