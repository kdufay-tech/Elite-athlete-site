// netlify/functions/_mail.js
// One place for where replies to Elite Athlete mail go.
//
// 2026-09-24: support@elite-athlete.app is a Workspace mailbox nobody reads;
// 6,091 coaches were emailed from it on Sep 15-16 and any reply landed there.
// Every outbound message now carries Reply-To eku@taradome.com (the read
// inbox) AND support@ (so the archive is complete). Resend accepts an array.
export const REPLY_TO = ['eku@taradome.com', 'support@elite-athlete.app'];

// Where operational alerts (canary failures, etc.) go. Both, for the same reason.
export const ALERT_TO = ['eku@taradome.com', 'support@elite-athlete.app'];
