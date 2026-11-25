import { useEffect, useState } from 'react';
import { KEYS, readKey, writeKey } from './storage.js';

/*
 * Which rows this browser has heard, keyed by the person who put the song in
 * front of the listener and the song itself.
 *
 * The song id alone is not enough. Two people can repost one track, and both
 * rows then sit in the activity list under different names. A mark keyed by the
 * song took both rows away at once, so listening to one author's repost also
 * cleared it for every other author who posted the same thing. A row is the
 * pair, so the pair is what is stored.
 *
 * The record is deliberately short lived. A play from three years ago says
 * nothing about the list in front of the listener, and keeping every id forever
 * would grow the entry without bound. Each write drops anything past the age
 * limit, and the count is capped so a busy day cannot fill the quota.
 */
const KEY = KEYS.played;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/*
 * Higher than it was for song-only marks, because the same song now takes one
 * entry per author who posted it. The window is what keeps this honest; the cap
 * only exists so a very busy fortnight cannot fill the quota.
 */
const MAX_ENTRIES = 400;

/* A mark is always `<author>:<song>`, and both halves are numeric ids. */
const KEY_SHAPE = /^\d+:\d+$/;

/*
 * The one place the shape of a mark is decided. A row without an author cannot
 * be scoped, so it gets no key at all rather than falling back to the song.
 */
export function playedKey(authorId, trackId) {
  if (authorId === null || authorId === undefined || authorId === '') return null;
  if (trackId === null || trackId === undefined || trackId === '') return null;
  return `${authorId}:${trackId}`;
}

function prune(map) {
  const cutoff = Date.now() - MAX_AGE_MS;
  const kept = Object.entries(map)
    /*
     * A key without both halves is a mark from before this was scoped to the
     * author. It cannot answer for any row now, and honouring it would hide a
     * song this listener may never have heard from that author, so it is shed
     * here instead of being carried around for a fortnight.
     */
    .filter(([key, at]) => KEY_SHAPE.test(key) && Number.isFinite(at) && at >= cutoff)
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
 * Called when a listener starts one author's row. Re-marking the same row only
 * refreshes its timestamp, so pausing and resuming does not pile up entries.
 */
export function markPlayed(authorId, trackId) {
  const key = playedKey(authorId, trackId);
  if (!key) return;
  const next = prune({ ...current, [key]: Date.now() });
  current = next;
  writeKey(KEY, JSON.stringify(next));
  emit();
}

/* True when this exact author's posting of this exact song has been heard. */
export function isPlayed(map, authorId, trackId) {
  const key = playedKey(authorId, trackId);
  return !!key && !!map[key];
}

/*
 * Rows read this map by author and song. It re-renders when a play is recorded,
 * which is the only time the marks can change.
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
