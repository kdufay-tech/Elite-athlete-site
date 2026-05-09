// netlify/functions/unsubscribe.js
// One-click unsubscribe endpoint — marks email as unsubscribed in beta_invites
// Called via link in emails: https://elite-athlete.app/.netlify/functions/unsubscribe?email=xxx

export default async(req)=>{
  const url=new URL(req.url);
  const email=url.searchParams.get('email');
  const supabaseUrl=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;

  const html=(title,msg,color)=>`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="text-align:center;padding:60px 40px;max-width:480px;"><div style="font-size:10px;letter-spacing:4px;color:#B8962E;margin-bottom:8px;">ELITE ATHLETE</div><h1 style="color:#fff;font-size:28px;margin:0 0 16px;">${title}</h1><p style="color:#888;font-size:15px;line-height:1.6;margin:0 0 32px;">${msg}</p><a href="https://elite-athlete.app" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px 36px;border-radius:6px;">Back to Elite Athlete</a></div></body></html>`;

  if(!email){
    return new Response(html('Invalid Link','This unsubscribe link is invalid or expired.','#e74c3c'),{status:400,headers:{'Content-Type':'text/html'}});
  }

  try{
    // Mark as unsubscribed in beta_invites
    const r=await fetch(`${supabaseUrl}/rest/v1/beta_invites?email=eq.${encodeURIComponent(email)}`,{
      method:'PATCH',
      headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({status:'unsubscribed'})
    });

    // Also mark in email_blasts so they are excluded from future blasts
    await fetch(`${supabaseUrl}/rest/v1/email_blasts`,{
      method:'POST',
      headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},
      body:JSON.stringify({blast_id:'unsubscribed',email,subject:'unsubscribed'})
    });

    return new Response(
      html('You\'ve been unsubscribed','You\'ve been successfully removed from Elite Athlete marketing emails. You won\'t receive any further emails from us.'),
      {status:200,headers:{'Content-Type':'text/html'}}
    );
  }catch(err){
    return new Response(html('Something went wrong','Please try again or email support@elite-athlete.app to unsubscribe.'),{status:500,headers:{'Content-Type':'text/html'}});
  }
};
