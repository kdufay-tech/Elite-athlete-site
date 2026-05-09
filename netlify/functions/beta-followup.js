// netlify/functions/beta-followup.js
// Scheduled: daily 9am UTC. Finds invites sent N days ago with no signup, sends follow-up via Resend.
// Also handles manual trigger from admin panel.
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Content-Type':'application/json'};

function buildHtml(subject, bodyText, inviteUrl, ctaLabel){
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#B8962E;height:4px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background:#111;padding:28px 40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><p style="margin:0 0 2px;font-size:10px;letter-spacing:4px;color:#B8962E;font-family:Arial,sans-serif;">ELITE ATHLETE</p><p style="margin:0;font-size:11px;color:#444;font-family:Arial,sans-serif;">ENGINEERED FOR CHAMPIONS</p></td></tr><tr><td style="background:#B8962E;height:1px;"></td></tr><tr><td style="background:#111;padding:40px;border-left:1px solid #B8962E22;border-right:1px solid #B8962E22;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:32px;"><p style="margin:0;font-size:15px;color:#CCC;line-height:1.7;font-family:Arial,sans-serif;white-space:pre-line;">${bodyText}</p></td></tr><tr><td align="center" style="padding-bottom:36px;"><a href="${inviteUrl}" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:16px 48px;border-radius:6px;font-family:Arial,sans-serif;">${ctaLabel}</a></td></tr><tr><td style="border-top:1px solid #ffffff08;padding-top:24px;"><p style="margin:0;font-size:13px;color:#555;font-family:Arial,sans-serif;">You're receiving this because you signed up for Elite Athlete beta access.</p></td></tr></table></td></tr><tr><td style="background:#0D0D0D;padding:20px 40px;border:1px solid #ffffff08;border-top:none;"><p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;">ELITE ATHLETE &middot; support@elite-athlete.app &middot; elite-athlete.app</p><p style="margin:4px 0 0;font-size:11px;font-family:Arial,sans-serif;"><a href="https://elite-athlete.app/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}" style="color:#555;text-decoration:underline;">Unsubscribe</a></p></td></tr><tr><td style="background:#B8962E;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}

function buildContent(betaType, daysLeft, inviteUrl, originalTemplate){
  const isCoach = betaType==='coach';
  if(isCoach){
    return {
      subject: `Re: Elite Athlete \u2014 quick question for you`,
      body: `Hi Coach,\n\nFollowing up on my note from earlier this week.\n\nQuick question: what\u2019s the biggest performance gap you\u2019re seeing with your athletes right now \u2014 nutrition consistency, recovery tracking, or program adherence?\n\nElite Athlete addresses all three, position-specific for every athlete on your roster.\n\nStill happy to set up free accounts for your entire program \u2014 ${daysLeft} days, no commitment.`,
      cta: 'Claim Your Free Coach Access'
    };
  }
  const hooks = {
    athlete_mfp: `Still using MyFitnessPal? Your position deserves better than generic macros.\n\nElite Athlete builds a nutrition plan and training program specifically for your sport and position. No other app does this.`,
    athlete_strava: `Strava still tracking your miles but not building your game?\n\nElite Athlete gives team sport athletes what Strava can\u2019t: position-specific training, nutrition, and an AI Coach that knows your position\u2019s demands.`,
    generic: `Just checking in \u2014 your Elite Athlete beta invite is still active.\n\nPosition-specific nutrition, training, injury recovery, and AI coaching \u2014 all in one place.`,
  };
  const hook = hooks[originalTemplate]||hooks.generic;
  return {
    subject: `Your Elite Athlete invite is still waiting \u2014 ${daysLeft} days free`,
    body: `Hey,\n\n${hook}\n\nYour personal invite link is still active. ${daysLeft} days of full Elite access. No credit card.`,
    cta: 'Claim Your Free Access'
  };
}

export default async(req)=>{
  if(req.method==='OPTIONS')return new Response('',{status:204,headers:CORS});
  const supabaseUrl=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;
  const resendKey=process.env.RESEND_API_KEY;
  const appUrl=process.env.URL||'https://elite-athlete.app';

  let followupDays=5;
  if(req.method==='POST'){
    try{const b=await req.json();if(b.followup_days)followupDays=parseInt(b.followup_days);}catch{}
  }

  const cutoff=new Date(Date.now()-followupDays*24*60*60*1000).toISOString();
  const today=new Date(Date.now()-(followupDays-1)*24*60*60*1000).toISOString();

  // Fetch pending invites sent around N days ago with no signup and no followup yet
  const invRes=await fetch(
    `${supabaseUrl}/rest/v1/beta_invites?status=eq.sent&sent_at=gte.${new Date(Date.now()-(followupDays+1)*86400000).toISOString()}&sent_at=lte.${new Date(Date.now()-(followupDays-1)*86400000).toISOString()}&followup_sent_at=is.null&select=id,email,beta_type,token,duration_days,template`,
    {headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}}
  );
  const invites=invRes.ok?await invRes.json():[];

  if(!invites.length){
    return new Response(JSON.stringify({ok:true,message:`No follow-up candidates for Day-${followupDays}`,sent:0,failed:0}),{status:200,headers:CORS});
  }

  // Build email batch
  const BATCH=100;
  let sent=0,failed=0;
  const sentIds=[];

  for(let i=0;i<invites.length;i+=BATCH){
    const batch=invites.slice(i,i+BATCH);
    const payload=batch.map(invite=>{
      const inviteUrl=`${appUrl}/accept-invite?token=${invite.token}`;
      const daysLeft=invite.duration_days||45;
      const {subject,body,cta}=buildContent(invite.beta_type,daysLeft,inviteUrl,invite.template);
      const html=buildHtml(subject,body,inviteUrl,cta);
      return {
        from:'Elite Athlete <support@elite-athlete.app>',
        to:invite.email,
        subject,
        html,
        headers:{'List-Unsubscribe':'<mailto:support@elite-athlete.app?subject=unsubscribe>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}
      };
    });

    try{
      const r=await fetch('https://api.resend.com/emails/batch',{
        method:'POST',
        headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      if(r.ok){
        sent+=batch.length;
        sentIds.push(...batch.map(i=>i.id));
      }else{
        failed+=batch.length;
        const d=await r.json();
        console.error('Batch error:',d.message);
      }
    }catch(e){failed+=batch.length;console.error('Batch exception:',e.message);}

    if(i+BATCH<invites.length)await new Promise(r=>setTimeout(r,200));
  }

  // Mark sent invites with followup_sent_at
  if(sentIds.length){
    for(let i=0;i<sentIds.length;i+=100){
      const chunk=sentIds.slice(i,i+100);
      await fetch(`${supabaseUrl}/rest/v1/beta_invites?id=in.(${chunk.join(',')})`,{
        method:'PATCH',
        headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({followup_sent_at:new Date().toISOString(),followup_count:1})
      });
    }
  }

  return new Response(JSON.stringify({
    ok:true,
    message:`Follow-up complete: ${sent} sent, ${failed} failed out of ${invites.length} candidates`,
    sent,failed,total:invites.length
  }),{status:200,headers:CORS});
};
