const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Content-Type':'application/json'};
const ADMIN_EMAIL='kiszo@taratechent.com';
// CAN-SPAM requires a valid physical postal address in every marketing email.
const POSTAL_ADDRESS='Taradome Technologies · 1366 Athens Ave SW, Atlanta, GA 30310';
function buildHtml({headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote}){
  let thumb=thumbnailUrl;
  if(!thumb&&videoUrl){const m=videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);if(m)thumb=`https://img.youtube.com/vi/${m[1]}/maxresdefault.jpg`;}
  const vid=thumb?`<tr><td align="center" style="padding:0 0 32px 0;"><a href="${videoUrl||ctaUrl}" target="_blank"><img src="${thumb}" width="560" style="width:100%;max-width:560px;border-radius:8px;border:2px solid #B8962E;" /></a><p style="margin:8px 0 0;font-size:13px;color:#888;text-align:center;font-family:Arial,sans-serif;">&#9658; Click to watch</p></td></tr>`:'';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background:#111;padding:28px 40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;font-family:Arial,sans-serif;">ELITE ATHLETE</p><p style="margin:0;font-size:11px;color:#444;font-family:Arial,sans-serif;">ENGINEERED FOR CHAMPIONS</p></td><td align="right"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">elite-athlete.app</p></td></tr></table></td></tr><tr><td style="background:#B8962E;height:1px;"></td></tr><tr><td style="background:#111;padding:40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:8px;"><h1 style="margin:0;font-size:32px;font-weight:900;color:#fff;font-family:Arial,sans-serif;">${headline}</h1></td></tr>${subheadline?`<tr><td style="padding-bottom:28px;"><p style="margin:0;font-size:18px;color:#B8962E;font-weight:600;font-family:Arial,sans-serif;">${subheadline}</p></td></tr>`:'<tr><td style="padding-bottom:28px;"></td></tr>'}${vid}<tr><td style="padding-bottom:32px;"><p style="margin:0;font-size:15px;color:#CCC;line-height:1.7;font-family:Arial,sans-serif;white-space:pre-line;">${bodyText}</p></td></tr><tr><td align="center" style="padding-bottom:36px;"><a href="${ctaUrl}" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:16px 48px;border-radius:6px;font-family:Arial,sans-serif;">${ctaText||'Open Elite Athlete'}</a></td></tr><tr><td style="border-top:1px solid #ffffff08;padding-top:24px;"><p style="margin:0;font-size:13px;color:#555;font-family:Arial,sans-serif;">${footerNote||"You're receiving this because we believe Elite Athlete can take your athletic performance to the next level."}</p></td></tr></table></td></tr><tr><td style="background:#0D0D0D;padding:20px 40px;border:1px solid #ffffff08;border-top:none;"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">ELITE ATHLETE &middot; support@elite-athlete.app &middot; elite-athlete.app</p><p style="margin:4px 0 0;font-size:11px;color:#333;font-family:Arial,sans-serif;">${POSTAL_ADDRESS}</p><p style="margin:4px 0 0;font-size:11px;font-family:Arial,sans-serif;"><a href="https://elite-athlete.app/.netlify/functions/unsubscribe?email={{EMAIL}}" style="color:#555;text-decoration:underline;">Unsubscribe</a></p></td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}
function personalize(str,v){
  v=v||{};
  const first=(v.first!=null?String(v.first):'').trim();
  const last =(v.last !=null?String(v.last ):'').trim();
  const name =(v.name !=null?String(v.name ):'').trim();
  const school=(v.school!=null?String(v.school):'').trim();
  // FIRST_NAME/LAST_NAME fall back to '' (NOT 'Coach') so the draft's own "Coach {{FIRST_NAME}}," never doubles up.
  let out=String(str||'')
    .replace(/\{\{\s*COACH_NAME\s*\}\}/gi, name || 'Coach')
    .replace(/\{\{\s*FIRST_NAME\s*\}\}/gi, first)
    .replace(/\{\{\s*LAST_NAME\s*\}\}/gi, last)
    .replace(/\{\{\s*SCHOOL\s*\}\}/gi, school || 'your program');
  // Cleanup when a name was blank: "Coach ," -> "Coach,"  and kill any stray "Coach Coach".
  out=out
    .replace(/\bCoach\s+Coach\b/g,'Coach')
    .replace(/Coach\s+([,.!?:])/g,'Coach$1')
    .replace(/[ \t]{2,}/g,' ');
  return out;
}
export default async(req)=>{
  if(req.method==='OPTIONS')return new Response('',{status:204,headers:CORS});
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:CORS});
  const supabaseUrl=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;
  const resendKey=process.env.RESEND_API_KEY;
  if(!resendKey)return new Response(JSON.stringify({error:'RESEND_API_KEY not configured'}),{status:500,headers:CORS});
  // Auth: admin bearer token, OR internal service key (scheduled auto-runner).
  const internalKey=req.headers.get('x-internal-key');
  const isInternal=internalKey&&serviceKey&&internalKey===serviceKey;
  if(!isInternal){
    const token=(req.headers.get('authorization')||'').replace('Bearer ','').trim();
    if(!token)return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
    const userRes=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:`Bearer ${token}`}});
    const userData=userRes.ok?await userRes.json():null;
    if(!userData?.email||userData.email!==ADMIN_EMAIL)return new Response(JSON.stringify({error:'Admin access required'}),{status:403,headers:CORS});
  }
  let body;
  try{body=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS});}
  const{subject,headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote,audience='invited',testEmail}=body;
  if(!subject||!headline||!bodyText||!ctaUrl)return new Response(JSON.stringify({error:'subject, headline, bodyText, ctaUrl required'}),{status:400,headers:CORS});
  const html=buildHtml({headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote});

  // ---- TEST SEND: one personalized email to yourself, previewed with a REAL coach from the folder ----
  if(testEmail){
    let mv=body.merge||{};
    if(!mv.first){
      try{
        // Always sample a real coach from coach_contacts for a realistic preview (apply folder filters if given).
        const f=['status=eq.active','email=not.is.null'];
        const lv=String(body.level||'').toLowerCase(); if(lv&&lv!=='all')f.push(`level=eq.${lv}`);
        if(audience==='coach_hs')f.push('level=eq.hs');
        const st=String(body.state||'').toUpperCase(); if(st&&st!=='ALL')f.push(`state=eq.${st}`);
        const rg=String(body.region||''); if(rg&&rg.toLowerCase()!=='all')f.push(`region=eq.${encodeURIComponent(rg)}`);
        const sp=String(body.sport||'').toLowerCase(); if(sp&&sp!=='all')f.push(`sport=eq.${sp}`);
        const sr=await fetch(`${supabaseUrl}/rest/v1/coach_contacts?${f.concat(['select=coach_name,school','limit=1']).join('&')}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
        const rows=sr.ok?await sr.json():[];
        if(rows[0]){ const nm=String(rows[0].coach_name||'').trim(); const p=nm.split(/\s+/).filter(Boolean); mv={name:nm,first:p[0]||'',last:p.length>1?p[p.length-1]:'',school:String(rows[0].school||'').trim()}; }
      }catch(_){}
    }
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Elite Athlete <support@elite-athlete.app>',to:testEmail,subject:personalize(subject,mv),html:personalize(html,mv).replace('{{EMAIL}}',encodeURIComponent(testEmail))})});
    const d=await r.json().catch(()=>({}));
    return new Response(JSON.stringify(r.ok?{ok:true,message:`Test sent to ${testEmail}${mv.first?` — previewed as ${mv.first}${mv.school?' / '+mv.school:''}`:''}`}:{ok:false,error:d.message}),{status:200,headers:CORS});
  }

  // ---- GATHER RECIPIENTS as {email, merge fields} ----
  const recip=new Map();
  const add=(email,mv)=>{ if(email){ const k=String(email).toLowerCase(); if(!recip.has(k)) recip.set(k,{email:String(email),mv:mv||{}}); } };
  const mkMerge=(name,school)=>{ const nm=String(name||'').trim(); const p=nm.split(/\s+/).filter(Boolean); return {name:nm,first:p[0]||'',last:p.length>1?p[p.length-1]:'',school:String(school||'').trim()}; };
  const sbPage=async(pathFn,onRow)=>{ let page=0; while(true){ const r=await fetch(`${supabaseUrl}/rest/v1/${pathFn(page)}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}}); const data=r.ok?await r.json():[]; data.forEach(onRow); if(data.length<1000)break; page++; } };

  if(audience==='invited'||audience==='all'){
    await sbPage(p=>`beta_invites?status=in.(sent,pending)&status=neq.unsubscribed&select=email&limit=1000&offset=${p*1000}`, i=>add(i.email));
  }
  if(audience==='coaches'||audience==='coach_college'||audience==='coach_pro'){
    const tf=audience==='coach_college'?'&template=eq.coach_college':(audience==='coach_pro'?'&template=eq.coach_pro':'');
    await sbPage(p=>`beta_invites?beta_type=eq.coach&status=in.(sent,pending)${tf}&select=email&limit=1000&offset=${p*1000}`, i=>add(i.email));
  }
  if(audience==='invited_athletes'){
    await sbPage(p=>`beta_invites?beta_type=eq.athlete&status=in.(sent,pending)&select=email&limit=1000&offset=${p*1000}`, i=>add(i.email));
  }
  if(audience==='waitlist'){
    await sbPage(p=>`coach_waitlist?select=email&limit=1000&offset=${p*1000}`, i=>add(i.email));
  }
  if(audience==='coach_hs'){
    await sbPage(p=>`coach_contacts?level=eq.hs&status=eq.active&email=not.is.null&select=email,coach_name,school&limit=1000&offset=${p*1000}`, i=>add(i.email,mkMerge(i.coach_name,i.school)));
  }
  if(audience==='contacts'){
    const f=['status=eq.active','email=not.is.null'];
    const lv=String(body.level||'').toLowerCase(); if(lv&&lv!=='all')f.push(`level=eq.${lv}`);
    const st=String(body.state||'').toUpperCase(); if(st&&st!=='ALL')f.push(`state=eq.${st}`);
    const rg=String(body.region||''); if(rg&&rg.toLowerCase()!=='all')f.push(`region=eq.${encodeURIComponent(rg)}`);
    const sp=String(body.sport||'').toLowerCase(); if(sp&&sp!=='all')f.push(`sport=eq.${sp}`);
    await sbPage(p=>`coach_contacts?${f.concat(['select=email,coach_name,school','limit=1000',`offset=${p*1000}`]).join('&')}`, i=>add(i.email,mkMerge(i.coach_name,i.school)));
  }
  const levelMap={athlete_hs:'hs',athlete_college:'college',athlete_pro:'pro'};
  if(audience==='users'||audience==='all'||levelMap[audience]){
    const lvl=levelMap[audience];
    const pr=await fetch(`${supabaseUrl}/rest/v1/profiles?select=user_id,name${lvl?`&level=eq.${lvl}`:''}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
    const profiles=pr.ok?await pr.json():[];
    const seen=new Set();
    for(const pf of profiles){
      if(!pf.user_id||seen.has(pf.user_id))continue; seen.add(pf.user_id);
      const ur=await fetch(`${supabaseUrl}/auth/v1/admin/users/${pf.user_id}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
      if(ur.ok){const u=await ur.json();if(u.email)add(u.email,mkMerge(pf.name,''));}
    }
  }

  let recipients=[...recip.values()];
  if(!recipients.length)return new Response(JSON.stringify({error:'No recipients found'}),{status:400,headers:CORS});

  // ---- SUPPRESSION: never email anyone on the global opt-out list (applies to ALL audiences, incl. coach folders) ----
  try{
    const supp=new Set(); let sp=0;
    while(true){ const sr=await fetch(`${supabaseUrl}/rest/v1/email_blasts?blast_id=in.(unsubscribed,bounced,complained)&select=email&limit=1000&offset=${sp*1000}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}}); const rows=sr.ok?await sr.json():[]; rows.forEach(r=>supp.add(String(r.email).toLowerCase())); if(rows.length<1000)break; sp++; }
    if(supp.size) recipients=recipients.filter(r=>!supp.has(r.email.toLowerCase()));
  }catch(_){}
  if(!recipients.length)return new Response(JSON.stringify({ok:true,message:'All recipients are unsubscribed — nothing to send',sent:0,total:0}),{status:200,headers:CORS});

  // ---- ENGAGED-ONLY: restrict to coaches who genuinely opened/clicked (human_engaged view,
  // >2min after delivery — excludes security-scanner noise). For warm-audience follow-ons. ----
  if(body.engagedOnly){
    const eng=new Set(); let ep=0;
    while(true){ const er=await fetch(`${supabaseUrl}/rest/v1/human_engaged?select=email&limit=1000&offset=${ep*1000}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}}); const rows=er.ok?await er.json():[]; rows.forEach(r=>eng.add(String(r.email).toLowerCase())); if(rows.length<1000)break; ep++; }
    recipients=recipients.filter(r=>eng.has(r.email.toLowerCase()));
    if(!recipients.length)return new Response(JSON.stringify({ok:true,message:'No engaged recipients match this folder yet',sent:0,total:0}),{status:200,headers:CORS});
  }

  // Optional: skip anyone already emailed under this blast id (auto-runner resume); optional per-run cap.
  const blastId=body.blastId||null;
  if(blastId){
    const sentSet=new Set(); let page=0;
    while(true){ const sr=await fetch(`${supabaseUrl}/rest/v1/email_blasts?blast_id=eq.${blastId}&select=email&limit=1000&offset=${page*1000}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}}); const rows=sr.ok?await sr.json():[]; rows.forEach(r=>sentSet.add(String(r.email).toLowerCase())); if(rows.length<1000)break; page++; }
    recipients=recipients.filter(r=>!sentSet.has(r.email.toLowerCase()));
  }
  if(body.maxSend&&body.maxSend>0&&recipients.length>body.maxSend) recipients=recipients.slice(0,body.maxSend);
  if(!recipients.length)return new Response(JSON.stringify({ok:true,message:'Nothing new to send',sent:0,total:0,blastId}),{status:200,headers:CORS});

  // ---- OFFLOAD: large sends go to the background twin (15-min budget) so we never hit the 26s wall ----
  // Guarded by !isInternal so the background run (called with x-internal-key) sends inline instead of re-queuing.
  const BG_THRESHOLD=300;
  if(!isInternal && recipients.length>BG_THRESHOLD){
    const bid2=blastId||`blast_${Date.now()}`;
    try{
      const origin=new URL(req.url).origin;
      await fetch(`${origin}/.netlify/functions/marketing-blast-background`,{method:'POST',headers:{'Content-Type':'application/json','x-internal-key':serviceKey},body:JSON.stringify({...body,blastId:bid2})});
    }catch(_){}
    return new Response(JSON.stringify({ok:true,queued:true,total:recipients.length,blastId:bid2,message:`Queued ${recipients.length} recipients — sending in the background. Refresh in a few minutes to track progress.`}),{status:200,headers:CORS});
  }

  // ---- SEND: batches of 100, one personalized payload per recipient ----
  const BATCH=100; let sent=0,failed=0; const bid=blastId||`blast_${Date.now()}`;
  for(let i=0;i<recipients.length;i+=BATCH){
    const batch=recipients.slice(i,i+BATCH);
    const payload=batch.map(({email,mv})=>({from:'Elite Athlete <support@elite-athlete.app>',to:email,subject:personalize(subject,mv),html:personalize(html,mv).replace('{{EMAIL}}',encodeURIComponent(email)),headers:{'List-Unsubscribe':`<https://elite-athlete.app/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}>, <mailto:support@elite-athlete.app?subject=unsubscribe>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}));
    try{
      const r=await fetch('https://api.resend.com/emails/batch',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const d=await r.json().catch(()=>({}));
      if(r.ok){ sent+=batch.length; await fetch(`${supabaseUrl}/rest/v1/email_blasts`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify(batch.map(b=>({blast_id:bid,email:b.email,subject})))}).catch(()=>{}); }
      else{ failed+=batch.length; console.error('Batch error:',d.message); }
    }catch(e){ failed+=batch.length; console.error('Batch exception:',e.message); }
    if(i+BATCH<recipients.length) await new Promise(r=>setTimeout(r,300));
  }
  return new Response(JSON.stringify({ok:sent>0,message:`${sent} sent · ${failed} failed`,sent,failed,total:recipients.length,blastId:bid}),{status:200,headers:CORS});
};

export const config = { type: "async" };
