import { dataUrls } from './data-urls.js';

export const DEMO_SESSION_ID = 'demo-jordan-chen';

let cached = null;

export function isDemoSessionId(id) {
  return String(id || '') === DEMO_SESSION_ID;
}

/** Completed example assessment: static JSON, not localStorage. */
export async function loadDemoSession() {
  if (cached) return cached;
  const res = await fetch(dataUrls.demoSession);
  if (!res.ok) throw new Error('Could not load the example assessment.');
  const session = await res.json();
  session.id = DEMO_SESSION_ID;
  cached = session;
  return session;
}
