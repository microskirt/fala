import { useEffect, useState } from 'react';
import { KEYS, readKey, writeKey } from './storage.js';

/*
 * Which songs this browser has played, so a list can keep marking them after a
 * refresh or after the player has moved on to another song. SoundCloud has no
 * endpoint for this and Fala has no account, so it lives in localStorage.
 *
 * The record is deliberately short lived. A play from three years ago says
 * nothing about the list in front of the listener, and keeping every id forever
 * would grow the entry without bound. Each write drops anything past the age
 * limit, and the count is capped so a busy day cannot fill the quota.
 */
const KEY = KEYS.played;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

function prune(map) {
  const cutoff = Date.now() - MAX_AGE_MS;
  const kept = Object.entries(map)
    .filter(([, at]) => Number.isFinite(at) && at >= cutoff)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept);
}

function read() {
  const raw = readKey(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const kept = prune(parsed);
    /*
     * Loading is also the moment to shed the stale part of the record. A mark
     * older than the window is never read again, so leaving it on disk would
     * only make the entry grow with every listen. The write happens only when
     * the prune actually dropped something, so a clean load costs nothing.
     */
    if (Object.keys(kept).length !== Object.keys(parsed).length) {
      writeKey(KEY, JSON.stringify(kept));
    }
    return kept;
  } catch {
    return {};
  }
}

let current = read();
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(current);
}

/*
 * Called when a song actually starts playing. Re-marking the same song only
 * refreshes its timestamp, so pausing and resuming does not pile up entries.
 */
export function markPlayed(trackId) {
  const id = String(trackId || '');
  if (!id) return;
  const next = prune({ ...current, [id]: Date.now() });
  current = next;
  writeKey(KEY, JSON.stringify(next));
  emit();
}

/*
 * Rows read this map by id. It re-renders when a play is recorded, which is the
 * only time the marks can change.
 */
export function usePlayed() {
  const [map, setMap] = useState(current);
  useEffect(() => {
    const fn = (next) => setMap(next);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return map;
}
