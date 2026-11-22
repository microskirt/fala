import { useEffect, useState } from 'react';

/*
 * Playback preferences live in this browser. There is no Wavefront account to
 * store them on, and SoundCloud has no endpoint for them.
 */

const KEY = 'wf.prefs';

const DEFAULTS = {
  quality: 'hq',
  autoplay: true,
  normalize: false,
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
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
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
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
