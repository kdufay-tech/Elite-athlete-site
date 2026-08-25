// netlify/functions/unsubscribe.js
// Opt-out endpoint. IMPORTANT: a bare GET must NOT unsubscribe — email security
// gateways and link scanners auto-fetch every link (GET), which would silently
// opt real people out and inflate unsubscribe counts. So:
//   GET  -> show a confirmation page with a button that POSTs.
//   POST -> actually unsubscribe (covers RFC 8058 one-click AND the confirm button).
// Called via the List-Unsubscribe header and the footer link:
//   https://elite-athlete.app/.netlify/functions/unsubscribe?email=xxx

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

function page(title, msg, opts = {}) {
  const button = opts.confirmEmail
    ? `<form method="POST" action="https://elite-athlete.app/.netlify/functions/unsubscribe?email=${encodeURIComponent(opts.confirmEmail)}" style="margin:0;">
         <button type="submit" style="display:inline-block;background:#B8962E;color:#0D0D0D;border:none;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px 36px;border-radius:6px;">Confirm Unsubscribe</button>
       </form>`
    : `<a href="https://elite-athlete.app" style="display:inline-block;background:#B8962E;color:#0D0D0D;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px 36px;border-radius:6px;">Back to Elite Athlete</a>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="text-align:center;padding:60px 40px;max-width:480px;"><div style="font-size:10px;letter-spacing:4px;color:#B8962E;margin-bottom:8px;">ELITE ATHLETE</div><h1 style="color:#fff;font-size:28px;margin:0 0 16px;">${title}</h1><p style="color:#888;font-size:15px;line-height:1.6;margin:0 0 32px;">${msg}</p>${button}</div></body></html>`;
}

async function doUnsubscribe(email) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  // Mark unsubscribed in beta_invites (best-effort)
  await fetch(`${supabaseUrl}/rest/v1/beta_invites?email=eq.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'unsubscribed' }),
  }).catch(() => {});
  // Add to the global suppression list so every future blast excludes them
  await fetch(`${supabaseUrl}/rest/v1/email_blasts`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ blast_id: 'unsubscribed', email, subject: 'unsubscribed' }),
  }).catch(() => {});
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  const url = new URL(req.url);
  const email = url.searchParams.get('email');

  // ---- POST: real opt-out (one-click header OR the confirmation button) ----
  if (req.method === 'POST') {
    if (!email) return new Response('Missing email', { status: 400, headers: CORS });
    try {
      await doUnsubscribe(email);
      // 200 is all a one-click mail client needs; browsers get a confirmation page.
      return new Response(
        page("You've been unsubscribed", "You've been removed from Elite Athlete marketing emails. You won't receive any further emails from us."),
        { status: 200, headers: { ...CORS, 'Content-Type': 'text/html' } }
      );
    } catch (err) {
      return new Response(page('Something went wrong', 'Please try again, or email support@elite-athlete.app to unsubscribe.'), { status: 500, headers: { ...CORS, 'Content-Type': 'text/html' } });
    }
  }

  // ---- GET: confirmation page only — do NOT opt out (prevents scanner false-unsubscribes) ----
  if (!email) {
    return new Response(page('Invalid Link', 'This unsubscribe link is invalid or expired.'), { status: 400, headers: { ...CORS, 'Content-Type': 'text/html' } });
  }
  return new Response(
    page('Unsubscribe?', `Click below to stop receiving Elite Athlete emails at <strong style="color:#aaa;">${email.replace(/</g, '&lt;')}</strong>.`, { confirmEmail: email }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'text/html' } }
  );
};
