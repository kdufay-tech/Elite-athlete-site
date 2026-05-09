// netlify/functions/marketing-blast-background.js
// Background function - runs up to 15 minutes, no timeout issues
// Triggered by marketing-blast.js which returns immediately

const ADMIN_EMAIL='kiszo@taratechent.com';
function buildHtml({headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote}){
  let thumb=thumbnailUrl;
  if(!thumb&&videoUrl){const m=videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);if(m)thumb=`https://img.youtube.com/vi/${m[1]}/maxresdefault.jpg`;}
  const vid=thumb?`<tr><td align="center" style="padding:0 0 32px 0;"><a href="${videoUrl||ctaUrl}" target="_blank"><img src="${thumb}" width="560" style="width:100%;max-width:560px;border-radius:8px;border:2px solid #B8962E;" /></a><p style="margin:8px 0 0;font-size:13px;color:#888;text-align:center;font-family:Arial,sans-serif;">&#9658; Click to watch</p></td></tr>`:'';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background:#111;padding:28px 40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;font-family:Arial,sans-serif;">ELITE ATHLETE</p><p style="margin:0;font-size:11px;color:#444;font-family:Arial,sans-serif;">ENGINEERED FOR CHAMPIONS</p></td></tr><tr><td style="background:#B8962E;height:1px;"></td></tr><tr><td style="background:#111;padding:40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:8px;"><h1 style="margin:0;font-size:32px;font-weight:900;color:#fff;font-family:Arial,sans-serif;">${headline}</h1></td></tr>${subheadline?`<tr><td style="padding-bottom:28px;"><p style="margin:0;font-size:18px;color:#B8962E;font-weight:600;font-family:Arial,sans-serif;">${subheadline}</p></td></tr>`:'<tr><td style="padding-bottom:28px;"></td></tr>'}${vid}<tr><td style="padding-bottom:32px;"><p style="margin:0;font-size:15px;color:#CCC;line-height:1.7;font-family:Arial,sans-serif;white-space:pre-line;">${bodyText}</p></td></tr><tr><td align="center" style="padding-bottom:36px;"><a href="${ctaUrl}" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:16px 48px;border-radius:6px;font-family:Arial,sans-serif;">${ctaText||'Open Elite Athlete'}</a></td></tr><tr><td style="border-top:1px solid #ffffff08;padding-top:24px;"><p style="margin:0;font-size:13px;color:#555;font-family:Arial,sans-serif;">${footerNote||"You're receiving this because we believe Elite Athlete can take your athletic performance to the next level."}</p></td></tr></table></td></tr><tr><td style="background:#0D0D0D;padding:20px 40px;border:1px solid #ffffff08;border-top:none;"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">ELITE ATHLETE &middot; support@elite-athlete.app &middot; elite-athlete.app</p></td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}
export default async(req)=>{
  const resendKey=process.env.RESEND_API_KEY;
  const supabaseUrl=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;
  let body;
  try{body=await req.json();}catch{return;}
  const{subject,headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote,emails}=body;
  if(!emails?.length||!subject||!headline||!bodyText)return;
  const html=buildHtml({headline,subheadline,bodyText,videoUrl,thumbnailUrl,ctaText,ctaUrl,footerNote});
  const BATCH=100;
  for(let i=0;i<emails.length;i+=BATCH){
    const batch=emails.slice(i,i+BATCH);
    const payload=batch.map(email=>({from:'Elite Athlete <support@elite-athlete.app>',to:email,subject,html}));
    try{
      await fetch('https://api.resend.com/emails/batch',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    }catch(e){console.error('Batch error:',e.message);}
    await new Promise(r=>setTimeout(r,1000));
  }
};
export const config={type:'async'};
