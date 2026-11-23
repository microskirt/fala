import { api, scPath } from '@/api.js';

/*
 * Addresses in this app look like SoundCloud's: /artist, /artist/song and
 * /artist/sets/playlist. A page therefore receives either a numeric id (from
 * the older id routes, still linked from a few places) or the words from the
 * permalink. These helpers turn the words back into the id the API wants.
 */

export function scSegments(obj) {
  const path = scPath(obj);
  if (!path) return null;
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

export async function resolveTrackParam({ id, artist, track }) {
  if (id) return String(id);
  if (!artist || !track) return null;
  const data = await api.get(
    `/api/resolve?url=${encodeURIComponent(`${artist}/${track}`)}`
  );
  return data && data.kind === 'track' ? String(data.id) : null;
}

export async function resolveUserParam({ id, artist }) {
  if (id) return String(id);
  if (!artist) return null;
  const data = await api.get(`/api/resolve?url=${encodeURIComponent(artist)}`);
  return data && data.kind === 'user' ? String(data.id) : null;
}

export async function resolvePlaylistParam({ id, artist, playlist }) {
  if (id) return String(id);
  if (!artist || !playlist) return null;
  const data = await api.get(
    `/api/resolve?url=${encodeURIComponent(`${artist}/sets/${playlist}`)}`
  );
  return data && (data.kind === 'playlist' || data.kind === 'system-playlist')
    ? String(data.id)
    : null;
}

/* Route + params for a link. Falls back to the id route when no permalink. */
export function trackLink(track) {
  const seg = scSegments(track);
  if (seg && seg.length === 2) {
    return { to: '/$artist/$track', params: { artist: seg[0], track: seg[1] } };
  }
  return { to: '/track/$id', params: { id: String(track?.id) } };
}

export function userLink(user) {
  const seg = scSegments(user);
  if (seg && seg.length === 1) {
    return { to: '/$artist', params: { artist: seg[0] } };
  }
  return { to: '/artist/$id', params: { id: String(user?.id) } };
}

export function playlistLink(playlist) {
  const raw = String(playlist?.id);
  const isSystem = playlist?.kind === 'system-playlist' || raw.startsWith('system:');
  /*
   * Generated mixes live at /discover/sets/... on SoundCloud, which is not a
   * real artist page and cannot be resolved back to an id. They keep the id
   * route, which is the only address that reads them.
   */
  const seg = isSystem ? null : scSegments(playlist);
  if (seg && seg.length === 3 && seg[1] === 'sets') {
    return {
      to: '/$artist/sets/$playlist',
      params: { artist: seg[0], playlist: seg[2] },
    };
  }
  return {
    to: '/playlist/$id',
    params: { id: isSystem ? `system:${raw.replace(/^system:/, '')}` : `sc:${raw}` },
  };
}
