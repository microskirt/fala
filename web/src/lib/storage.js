/*
 * Browser storage keys. Everything Fala keeps lives in localStorage, so this
 * module owns the names and migrates values from the old `wf.*` keys once.
 */

const PREFIX = 'fala.';
const LEGACY_PREFIX = 'wf.';

export const KEYS = {
  token: `${PREFIX}sc_token`,
  theme: `${PREFIX}theme`,
  prefs: `${PREFIX}prefs`,
  volume: `${PREFIX}volume`,
};

export function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/* Carry over anything saved before the rename, then drop the old copy. */
export function migrateLegacyKeys() {
  for (const key of Object.values(KEYS)) {
    const legacy = LEGACY_PREFIX + key.slice(PREFIX.length);
    try {
      const value = localStorage.getItem(key);
      const old = localStorage.getItem(legacy);
      if (value === null && old !== null) localStorage.setItem(key, old);
      if (old !== null) localStorage.removeItem(legacy);
    } catch {}
  }
}
