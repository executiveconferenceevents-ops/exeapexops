// ─── "Remember me on this phone" for exhibitors ───────────────────────────────
// After an exhibitor enters the event code and accepts the privacy notice, we keep
// a small pass on their phone so they don't have to enter the code again.
// The pass expires 3 days after the event ends (or 14 days if no end date is set),
// and the code is re-checked with the server every time the app opens, so a code
// the organiser changes or an event that closes stops working straight away.
// What is stored: event slug, event code, stand number, privacy-acknowledgement id.
// Nothing personal (no names, phone numbers or emails).

const PASS_KEY = 'apexops-exhibitor-pass-v1';
const DAY = 24 * 60 * 60 * 1000;

function read() {
  try { return JSON.parse(window.localStorage.getItem(PASS_KEY) || 'null'); }
  catch { return null; }
}
function write(pass) {
  try {
    if (pass) window.localStorage.setItem(PASS_KEY, JSON.stringify(pass));
    else window.localStorage.removeItem(PASS_KEY);
  } catch { /* private browsing: the exhibitor will just enter the code again */ }
}

function expiryFor(event) {
  const end = event?.breakdown_end_date || event?.event_end_date;
  const endTime = end ? new Date(`${end}T23:59:59`).getTime() : NaN;
  return Number.isFinite(endTime) ? endTime + 3 * DAY : Date.now() + 14 * DAY;
}

/** Save (or refresh) the pass once the exhibitor is verified and has accepted the notice. */
export function saveExhibitorPass(event) {
  if (!event?.slug || !event?.accessCode) return;
  const existing = read();
  write({
    slug: event.slug,
    accessCode: event.accessCode,
    privacyAcknowledgementId: event.privacyAcknowledgementId || '',
    privacyNoticeVersion: event.privacyNoticeVersion || '',
    stand: existing?.slug === event.slug ? existing.stand || '' : '',
    expiresAt: expiryFor(event),
  });
}

/** Returns the saved pass, or null if there is none or it has expired. */
export function loadExhibitorPass() {
  const pass = read();
  if (!pass?.slug || !pass?.accessCode) return null;
  if (pass.expiresAt && Date.now() > pass.expiresAt) { write(null); return null; }
  return pass;
}

export function forgetExhibitorPass() { write(null); }

export function saveExhibitorStand(slug, stand) {
  const pass = read();
  if (pass && pass.slug === slug) write({ ...pass, stand: stand || '' });
}

export function loadExhibitorStand(slug) {
  const pass = loadExhibitorPass();
  return pass && pass.slug === slug ? pass.stand || '' : '';
}
