import { useEffect, useState } from 'react';
import { KEYS, readKey, writeKey } from '@/lib/storage.js';

/*
 * Playback preferences live in this browser. There is no Fala account to store
 * them on, and SoundCloud has no endpoint for them.
 */

const KEY = KEYS.prefs;

const DEFAULTS = {
  quality: 'hq',
  autoplay: true,
};

function read() {
  const raw = readKey(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = read();
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(current);
}

export function getPrefs() {
  return current;
}

export function setPrefs(patch) {
  current = { ...current, ...patch };
  writeKey(KEY, JSON.stringify(current));
  emit();
  return current;
}

export function usePrefs() {
  const [prefs, setLocal] = useState(current);
  useEffect(() => {
    const fn = (next) => setLocal(next);
    listeners.add(fn);
    setLocal(current);
    return () => listeners.delete(fn);
  }, []);
  return [prefs, setPrefs];
}
