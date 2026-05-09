const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Content-Type':'application/json'};
const ADMIN_EMAIL='kiszo@taratechent.com';
function buildHtml({headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote}){
  let thumb=thumbnailUrl;
  if(!thumb&&videoUrl){const m=videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);if(m)thumb=`https://img.youtube.com/vi/${m[1]}/maxresdefault.jpg`;}
  const vid=thumb?`<tr><td align="center" style="padding:0 0 32px 0;"><a href="${videoUrl||ctaUrl}" target="_blank"><img src="${thumb}" width="560" style="width:100%;max-width:560px;border-radius:8px;border:2px solid #B8962E;" /></a><p style="margin:8px 0 0;font-size:13px;color:#888;text-align:center;font-family:Arial,sans-serif;">&#9658; Click to watch</p></td></tr>`:'';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background:#111;padding:28px 40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;font-family:Arial,sans-serif;">ELITE ATHLETE</p><p style="margin:0;font-size:11px;color:#444;font-family:Arial,sans-serif;">ENGINEERED FOR CHAMPIONS</p></td><td align="right"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">elite-athlete.app</p></td></tr></table></td></tr><tr><td style="background:#B8962E;height:1px;"></td></tr><tr><td style="background:#111;padding:40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:8px;"><h1 style="margin:0;font-size:32px;font-weight:900;color:#fff;font-family:Arial,sans-serif;">${headline}</h1></td></tr>${subheadline?`<tr><td style="padding-bottom:28px;"><p style="margin:0;font-size:18px;color:#B8962E;font-weight:600;font-family:Arial,sans-serif;">${subheadline}</p></td></tr>`:'<tr><td style="padding-bottom:28px;"></td></tr>'}${vid}<tr><td style="padding-bottom:32px;"><p style="margin:0;font-size:15px;color:#CCC;line-height:1.7;font-family:Arial,sans-serif;white-space:pre-line;">${bodyText}</p></td></tr><tr><td align="center" style="padding-bottom:36px;"><a href="${ctaUrl}" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:16px 48px;border-radius:6px;font-family:Arial,sans-serif;">${ctaText||'Open Elite Athlete'}</a></td></tr><tr><td style="border-top:1px solid #ffffff08;padding-top:24px;"><p style="margin:0;font-size:13px;color:#555;font-family:Arial,sans-serif;">${footerNote||"You're receiving this because we believe Elite Athlete can take your athletic performance to the next level."}</p></td></tr></table></td></tr><tr><td style="background:#0D0D0D;padding:20px 40px;border:1px solid #ffffff08;border-top:none;"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">ELITE ATHLETE &middot; support@elite-athlete.app &middot; elite-athlete.app</p><p style="margin:4px 0 0;font-size:11px;font-family:Arial,sans-serif;"><a href="https://elite-athlete.app/.netlify/functions/unsubscribe?email={{EMAIL}}" style="color:#555;text-decoration:underline;">Unsubscribe</a></p></td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}
export default async(req)=>{
  if(req.method==='OPTIONS')return new Response('',{status:204,headers:CORS});
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:CORS});
  const token=(req.headers.get('authorization')||'').replace('Bearer ','').trim();
  if(!token)return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  const supabaseUrl=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;
  const resendKey=process.env.RESEND_API_KEY;
  if(!resendKey)return new Response(JSON.stringify({error:'RESEND_API_KEY not configured'}),{status:500,headers:CORS});
  const userRes=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:`Bearer ${token}`}});
  const userData=userRes.ok?await userRes.json():null;
  if(!userData?.email||userData.email!==ADMIN_EMAIL)return new Response(JSON.stringify({error:'Admin access required'}),{status:403,headers:CORS});
  let body;
  try{body=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS});}
  const{subject,headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote,audience='invited',testEmail}=body;
  if(!subject||!headline||!bodyText||!ctaUrl)return new Response(JSON.stringify({error:'subject, headline, bodyText, ctaUrl required'}),{status:400,headers:CORS});
  const html=buildHtml({headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote});
  if(testEmail){
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Elite Athlete <support@elite-athlete.app>',to:testEmail,subject,html})});
    const d=await r.json();
    return new Response(JSON.stringify(r.ok?{ok:true,message:`Test sent to ${testEmail}`}:{ok:false,error:d.message}),{status:200,headers:CORS});
  }
  let emails=[];
  if(audience==='invited'||audience==='all'){
    let page=0;
    while(true){
      const r=await fetch(`${supabaseUrl}/rest/v1/beta_invites?status=in.(sent,pending)&status=neq.unsubscribed&select=email&limit=1000&offset=${page*1000}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
      const data=r.ok?await r.json():[];
      emails.push(...data.map(i=>i.email).filter(Boolean));
      if(data.length<1000)break;
      page++;
    }
  }
  if(audience==='users'||audience==='all'){
    const pr=await fetch(`${supabaseUrl}/rest/v1/profiles?select=user_id`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
    const profiles=pr.ok?await pr.json():[];
    const seen=new Set();
    for(const p of profiles){
      if(!p.user_id||seen.has(p.user_id))continue;
      seen.add(p.user_id);
      const ur=await fetch(`${supabaseUrl}/auth/v1/admin/users/${p.user_id}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
      if(ur.ok){const u=await ur.json();if(u.email)emails.push(u.email);}
    }
  }
  emails=[...new Set(emails)];
  if(!emails.length)return new Response(JSON.stringify({error:'No recipients found'}),{status:400,headers:CORS});
  // Generate blast_id on page 0, caller must pass it back for subsequent pages
  const blastId=body.blastId||(body.page===0||!body.page?`blast_${Date.now()}`:null);
  if(!blastId)return new Response(JSON.stringify({error:'blastId required for page>0'}),{status:400,headers:CORS});
  // Skip emails already sent in this blast (dedup on retry)
  if(body.page>0||body.blastId){
    const sentRes=await fetch(`${supabaseUrl}/rest/v1/email_blasts?blast_id=eq.${blastId}&select=email`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
    const sentRows=sentRes.ok?await sentRes.json():[];
    const sentSet=new Set(sentRows.map(r=>r.email));
    emails=emails.filter(e=>!sentSet.has(e));
  }
  // Page-based sending: each call sends PAGE_SIZE emails, caller increments page
  const PAGE_SIZE=500;
  const page=body.page||0;
  const pageEmails=emails.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const totalPages=Math.ceil(emails.length/PAGE_SIZE);
  const hasMore=(page+1)<totalPages;
  if(!pageEmails.length)return new Response(JSON.stringify({ok:true,message:'All emails sent',sent:0,total:emails.length,hasMore:false}),{status:200,headers:CORS});
  const BATCH=50;
  let sent=0,failed=0;
  for(let i=0;i<pageEmails.length;i+=BATCH){
    const batch=pageEmails.slice(i,i+BATCH);
    const batchPayload=batch.map(email=>({from:'Elite Athlete <support@elite-athlete.app>',to:email,subject,html:html.replace('{{EMAIL}}',encodeURIComponent(email)),headers:{'List-Unsubscribe':'<mailto:support@elite-athlete.app?subject=unsubscribe>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}));
    try{
      const r=await fetch('https://api.resend.com/emails/batch',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify(batchPayload)});
      const d=await r.json();
      if(r.ok){
        sent+=batch.length;
        // Record sent emails to prevent duplicates
        const records=batch.map(e=>({blast_id:blastId,email:e,subject}));
        await fetch(`${supabaseUrl}/rest/v1/email_blasts`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify(records)});
      }
      else{failed+=batch.length;console.error('Batch error:',d.message);}
    }catch(e){failed+=batch.length;console.error('Batch exception:',e.message);}
    if(i+BATCH<pageEmails.length)await new Promise(r=>setTimeout(r,300));
  }
  return new Response(JSON.stringify({ok:sent>0,message:`Page ${page+1}/${totalPages}: ${sent} sent · ${failed} failed`,sent,failed,total:emails.length,page,totalPages,hasMore,blastId}),{status:200,headers:CORS});
};
