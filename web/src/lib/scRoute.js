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

/*
 * Subpages hang off the same slug as the page they belong to, so a list keeps
 * the artist's own address: /artist/song/likes rather than /track/123/likes.
 * The id form stays as the fallback for anything without a permalink.
 */
export function trackSubLink(track, sub) {
  const seg = scSegments(track);
  if (seg && seg.length === 2) {
    return {
      to: `/$artist/$track/${sub}`,
      params: { artist: seg[0], track: seg[1] },
    };
  }
  return { to: `/track/$id/${sub}`, params: { id: String(track?.id) } };
}

export function userSubLink(user, sub) {
  const seg = scSegments(user);
  if (seg && seg.length === 1) {
    return { to: `/$artist/${sub}`, params: { artist: seg[0] } };
  }
  return { to: `/artist/$id/${sub}`, params: { id: String(user?.id) } };
}

/*
 * A playlist subpage keeps the playlist's own address: the likes list lives at
 * /artist/sets/playlist/likes rather than /playlist/123/likes. Generated mixes
 * have no readable address, so they keep the id form.
 */
export function playlistSubLink(playlist, sub) {
  const raw = String(playlist?.id);
  const isSystem = playlist?.kind === 'system-playlist' || raw.startsWith('system:');
  const seg = isSystem ? null : scSegments(playlist);
  if (seg && seg.length === 3 && seg[1] === 'sets') {
    return {
      to: `/$artist/sets/$playlist/${sub}`,
      params: { artist: seg[0], playlist: seg[2] },
    };
  }
  return {
    to: `/playlist/$id/${sub}`,
    params: { id: isSystem ? `system:${raw.replace(/^system:/, '')}` : `sc:${raw}` },
  };
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
