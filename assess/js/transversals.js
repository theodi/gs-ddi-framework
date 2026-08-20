import { dataUrls } from './data-urls.js';

const TRANSVERSALS_URL = dataUrls.transversals;

let transversalsCache = null;

export async function loadTransversals() {
  if (transversalsCache) return transversalsCache;
  const res = await fetch(TRANSVERSALS_URL);
  if (!res.ok) throw new Error('Could not load transversals.json');
  transversalsCache = await res.json();
  return transversalsCache;
}

export function getTransversalByName(data, name) {
  return data?.transversals?.find((t) => t.name === name) || null;
}

export function transversalHashSlug(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function transversalFromHashSlug(data, slug) {
  if (!slug || !data?.transversals) return null;
  return data.transversals.find((t) => transversalHashSlug(t.name) === slug) || null;
}
