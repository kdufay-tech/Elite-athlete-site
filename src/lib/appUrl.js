// ─────────────────────────────────────────────────────────────
// src/lib/appUrl.js
// The app's PUBLIC origin - the one a link can be sent to someone else.
//
// WHY THIS EXISTS
//   `window.location.origin` is correct on the web and WRONG in every native
//   build. Capacitor serves the bundled app from its own scheme:
//     Android (androidScheme "https")  ->  https://localhost
//     iOS                              ->  capacitor://localhost
//   Both are internal to the device. A link built from them is not merely
//   ugly, it is unreachable by anyone - including the person who made it.
//
//   That shipped: a recruiting share created in the Android app produced
//   https://localhost/s/<token>, and the QR encoded the same string, so the
//   coach who scanned it got ERR_CONNECTION_REFUSED. Found 2026-09-08 in
//   internal testing of 1.0.6. The web build was unaffected, which is exactly
//   why it passed testing on the web the same day.
//
//   Any URL that LEAVES the device - a share link, an email redirect, a QR -
//   must come from here. `window.location.origin` is only safe for something
//   the same device will consume.
// ─────────────────────────────────────────────────────────────
import { Capacitor } from '@capacitor/core';

/** The site this app is published at. Never the Capacitor internal scheme. */
export const PUBLIC_ORIGIN = 'https://elite-athlete.app';

/** Origin to build outbound links from: the real site on native, itself on web. */
export const APP_ORIGIN =
  Capacitor.getPlatform() === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : PUBLIC_ORIGIN;
