import fs from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const API = 'https://api-v2.soundcloud.com';
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const CLIENT_ID_FILE = path.join(DATA_DIR, 'client_id.txt');

let clientId = process.env.SC_CLIENT_ID || '';
if (!clientId) {
  try {
    clientId = fs.readFileSync(CLIENT_ID_FILE, 'utf8').trim();
  } catch {}
}
if (!clientId) clientId = 'glXhJxvYKPM87la70dG2G1bJ03AdA3hN';

const cache = new Map();
const userCache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  if (hit) cache.delete(key);
  return undefined;
}

function cacheSet(key, data, ttl) {
  if (cache.size > 1200) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.exp < now) cache.delete(k);
    if (cache.size > 1200) cache.delete(cache.keys().next().value);
  }
  cache.set(key, { data, exp: Date.now() + ttl });
}

export class ScError extends Error {
  constructor(status, message, body) {
    super(message || `SoundCloud responded ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function refreshClientId() {
  try {
    const res = await fetch('https://soundcloud.com/', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    const html = await res.text();
    const assets = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[\w-]+\.js/g)].map(
      (m) => m[0]
    );
    for (const asset of assets.slice(0, 12)) {
      try {
        const js = await (await fetch(asset, { headers: { 'User-Agent': UA } })).text();
        const m = js.match(/client_id:"([A-Za-z0-9]{20,})"/);
        if (m) {
          clientId = m[1];
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(CLIENT_ID_FILE, clientId);
          return clientId;
        }
      } catch {}
    }
  } catch {}
  return clientId;
}

export function getClientId() {
  return clientId;
}

function withClientId(href) {
  const url = new URL(href, API);
  if (!url.searchParams.get('client_id')) url.searchParams.set('client_id', clientId);
  return url.toString();
}

async function rawGet(href, { refresh = true } = {}) {
  const url = withClientId(href);
  let res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if ((res.status === 401 || res.status === 403) && refresh) {
    const next = await refreshClientId();
    if (next && next !== clientId) return rawGet(href, { refresh: false });
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {}
    throw new ScError(res.status, body?.errors?.[0] || body?.error, body);
  }
  return res.json();
}

export async function apiGet(href, { ttl = 60_000 } = {}) {
  const key = href.replace(/([?&])client_id=[^&]*/g, '$1');
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const data = await rawGet(href);
  cacheSet(key, data, ttl);
  rememberUsers(data);
  return data;
}

function rememberUsers(data) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.kind === 'user' && node.id) userCache.set(String(node.id), node);
    if (node.user && node.user.kind === 'user' && node.user.id)
      userCache.set(String(node.user.id), node.user);
    if (node.track) visit(node.track);
    if (node.playlist) visit(node.playlist);
    if (node.tracks) visit(node.tracks);
    if (node.collection) visit(node.collection);
  };
  visit(data);
}

/* ----------------------------- normalisation ----------------------------- */

const QUALITY_PRESETS = {
  hq: ['aac_160k', 'abr_sq', 'aac_96k'],
  sq: ['aac_96k', 'aac_160k'],
  lq: ['aac_96k'],
};

export function slimUser(u) {
  if (!u) return null;
  if (u.local) return u;
  return {
    id: u.id,
    kind: 'user',
    username: u.username || u.permalink,
    permalink: u.permalink,
    permalink_url: u.permalink_url || `/u/${u.permalink}`,
    avatar_url: u.avatar_url,
    description: u.description || '',
    city: u.city || '',
    country_code: u.country_code || '',
    followers_count: u.followers_count ?? 0,
    followings_count: u.followings_count ?? 0,
    track_count: u.track_count ?? 0,
    playlist_count: u.playlist_count ?? 0,
    likes_count: u.likes_count ?? 0,
    verified: !!u.verified,
    urn: u.urn,
    local: false,
  };
}

export function slimTrack(t) {
  if (!t) return null;
  return {
    id: t.id,
    kind: 'track',
    title: t.title,
    permalink_url: t.permalink_url,
    artwork_url: t.artwork_url,
    duration: t.duration ?? 0,
    full_duration: t.full_duration ?? t.duration ?? 0,
    genre: t.genre || '',
    tag_list: t.tag_list || '',
    created_at: t.created_at,
    display_date: t.display_date,
    likes_count: t.likes_count ?? 0,
    playback_count: t.playback_count ?? 0,
    comment_count: t.comment_count ?? 0,
    reposts_count: t.reposts_count ?? 0,
    streamable: !!t.streamable,
    policy: t.policy,
    monetization_model: t.monetization_model,
    waveform_url: t.waveform_url,
    user: slimUser(t.user),
    local: false,
  };
}

export function fullTrack(t) {
  const base = slimTrack(t);
  if (!base) return null;
  return {
    ...base,
    description: t.description || '',
    label_name: t.label_name || '',
    release_date: t.release_date || null,
    license: t.license || '',
    purchase_url: t.purchase_url || null,
    purchase_title: t.purchase_title || null,
    publisher_metadata: t.publisher_metadata || null,
    embeddable_by: t.embeddable_by,
    downloadable: !!t.downloadable,
    transcodings: (t.media?.transcodings || []).map((x) => ({
      preset: x.preset,
      protocol: x.format?.protocol,
      mime: x.format?.mime_type,
      quality: x.quality,
    })),
  };
}

export function slimPlaylist(p) {
  if (!p) return null;
  return {
    id: p.id,
    kind: p.kind || 'playlist',
    title: p.title,
    description: p.description || '',
    permalink_url: p.permalink_url,
    artwork_url: p.artwork_url || p.calculated_artwork_url || null,
    duration: p.duration ?? 0,
    track_count: p.track_count ?? p.tracks?.length ?? 0,
    likes_count: p.likes_count ?? 0,
    reposts_count: p.reposts_count ?? 0,
    created_at: p.created_at,
    display_date: p.display_date,
    release_date: p.release_date || null,
    genre: p.genre || '',
    is_album: !!p.is_album,
    set_type: p.set_type || '',
    user: slimUser(p.user),
    tracks: Array.isArray(p.tracks) ? p.tracks.map(slimTrack).filter(Boolean) : undefined,
    local: false,
  };
}

function mapCollection(data, mapper) {
  return {
    collection: (data.collection || []).map(mapper).filter(Boolean),
    next_href: stripClientId(data.next_href),
    total_results: data.total_results,
  };
}

export function stripClientId(href) {
  if (!href) return null;
  return href.replace(/([?&])client_id=[^&]*/g, '$1').replace(/[?&]$/, '');
}

/* ------------------------------- endpoints ------------------------------- */

export async function search({ q, filter = 'all', limit = 20, next }) {
  if (next) {
    const data = await apiGet(next, { ttl: 60_000 });
    return mapCollection(data, (item) => mapSearchItem(item));
  }
  const qs = new URLSearchParams({ q: q || '', limit: String(limit), filter });
  const path = filter === 'all' ? `/search?${qs}` : `/search/${filter}?${qs}`;
  const data = await apiGet(path, { ttl: 60_000 });
  return mapCollection(data, (item) => mapSearchItem(item));
}

function mapSearchItem(item) {
  if (!item) return null;
  if (item.kind === 'track') return slimTrack(item);
  if (item.kind === 'user') return slimUser(item);
  if (item.kind === 'playlist' || item.kind === 'system-playlist') return slimPlaylist(item);
  return null;
}

export async function suggest(q) {
  if (!q) return [];
  const data = await apiGet(`/search/queries?q=${encodeURIComponent(q)}&limit=8`, { ttl: 120_000 });
  return (data.collection || []).map((x) => x.query);
}

export async function charts({ limit = 20, next } = {}) {
  if (next) {
    const data = await apiGet(next, { ttl: 300_000 });
    return {
      collection: (data.collection || []).map((x) => slimTrack(x.track || x)).filter(Boolean),
      next_href: stripClientId(data.next_href),
    };
  }
  const data = await apiGet(
    `/charts?kind=trending&genre=soundcloud%3Agenres%3Aall-music&limit=${limit}`,
    { ttl: 300_000 }
  );
  return {
    collection: (data.collection || []).map((x) => slimTrack(x.track || x)).filter(Boolean),
    next_href: stripClientId(data.next_href),
  };
}

export async function mixedSelections() {
  const data = await apiGet('/mixed-selections', { ttl: 600_000 });
  return data.collection || [];
}

export async function chartSelections() {
  const data = await apiGet('/charts/selections', { ttl: 600_000 });
  return data.collection || [];
}

export async function systemPlaylist(id, { trackLimit } = {}) {
  const data = await apiGet(`/system-playlists/${id}`, { ttl: 300_000 });
  let ids = (data.tracks || []).map((t) => t.id).filter(Boolean);
  const total = ids.length;
  if (trackLimit) ids = ids.slice(0, trackLimit);
  const tracks = await tracksByIds(ids);
  return { ...slimPlaylist(data), tracks, track_count: data.track_count ?? total };
}

export async function playlist(id) {
  const data = await apiGet(`/playlists/${id}`, { ttl: 120_000 });
  return slimPlaylist(data);
}

export async function tracksByIds(ids) {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n)))];
  const out = [];
  for (let i = 0; i < clean.length; i += 50) {
    const chunk = clean.slice(i, i + 50);
    try {
      const data = await apiGet(`/tracks?ids=${chunk.join(',')}`, { ttl: 300_000 });
      if (Array.isArray(data)) out.push(...data);
    } catch {}
  }
  const byId = new Map(out.map((t) => [t.id, t]));
  return clean.map((id) => slimTrack(byId.get(id))).filter(Boolean);
}

export async function track(id) {
  const data = await apiGet(`/tracks/${id}`, { ttl: 120_000 });
  return fullTrack(data);
}

export async function user(id) {
  try {
    const data = await apiGet(`/users/${id}`, { ttl: 300_000 });
    return slimUser(data);
  } catch {
    return userCache.get(String(id)) ? slimUser(userCache.get(String(id))) : null;
  }
}

export async function resolve(url) {
  const data = await apiGet(`/resolve?url=${encodeURIComponent(url)}`, { ttl: 300_000 });
  if (data.kind === 'track') return fullTrack(data);
  if (data.kind === 'playlist' || data.kind === 'system-playlist') return slimPlaylist(data);
  if (data.kind === 'user') return slimUser(data);
  return null;
}

export async function userTab(id, tab, { limit = 24, next } = {}) {
  const allowed = ['tracks', 'likes', 'playlists', 'albums', 'followers', 'followings', 'spotlight', 'comments', 'toptracks'];
  if (!allowed.includes(tab)) throw new ScError(400, 'bad tab');
  if (next) {
    const data = await apiGet(next, { ttl: 120_000 });
    return mapCollection(data, (item) => mapUserTabItem(tab, item));
  }
  const data = await apiGet(`/users/${id}/${tab}?limit=${limit}`, { ttl: 120_000 });
  return mapCollection(data, (item) => mapUserTabItem(tab, item));
}

function mapUserTabItem(tab, item) {
  if (!item) return null;
  if (tab === 'followers' || tab === 'followings') return slimUser(item);
  if (item.kind === 'track') return slimTrack(item);
  if (item.kind === 'playlist') return slimPlaylist(item);
  if (item.kind === 'comment') return item;
  return mapSearchItem(item);
}

export async function activity(id, { limit = 20, next } = {}) {
  if (next) {
    const data = await apiGet(next, { ttl: 60_000 });
    return {
      collection: (data.collection || []).map(mapActivityItem).filter(Boolean),
      next_href: stripClientId(data.next_href),
    };
  }
  const data = await apiGet(`/stream/users/${id}?limit=${limit}`, { ttl: 60_000 });
  return {
    collection: (data.collection || []).map(mapActivityItem).filter(Boolean),
    next_href: stripClientId(data.next_href),
  };
}

function mapActivityItem(a) {
  if (!a) return null;
  return {
    type: a.type,
    created_at: a.created_at,
    user: slimUser(a.user),
    track: a.track ? slimTrack(a.track) : null,
    playlist: a.playlist ? slimPlaylist(a.playlist) : null,
  };
}

export async function comments(id, { limit = 30, next } = {}) {
  if (next) {
    const data = await apiGet(next, { ttl: 30_000 });
    return {
      collection: (data.collection || []).map(slimComment).filter(Boolean),
      next_href: stripClientId(data.next_href),
    };
  }
  const data = await apiGet(`/tracks/${id}/comments?limit=${limit}&threaded=1&filter_replies=1`, {
    ttl: 30_000,
  });
  return {
    collection: (data.collection || []).map(slimComment).filter(Boolean),
    next_href: stripClientId(data.next_href),
  };
}

function slimComment(c) {
  if (!c) return null;
  return {
    id: 'sc:' + c.id,
    source: 'soundcloud',
    body: c.body,
    timestamp_ms: c.timestamp ?? null,
    created_at: c.created_at,
    user: slimUser(c.user),
  };
}

export async function related(id, { limit = 12 } = {}) {
  const data = await apiGet(`/tracks/${id}/related?limit=${limit}`, { ttl: 300_000 });
  return (data.collection || []).map(slimTrack).filter(Boolean);
}

export async function reposters(id, { limit = 12 } = {}) {
  const data = await apiGet(`/tracks/${id}/reposters?limit=${limit}`, { ttl: 300_000 });
  return (data.collection || []).map(slimUser).filter(Boolean);
}

export async function likers(id, { limit = 12 } = {}) {
  try {
    const data = await apiGet(`/tracks/${id}/likers?limit=${limit}`, { ttl: 300_000 });
    return (data.collection || []).map(slimUser).filter(Boolean);
  } catch {
    return [];
  }
}

export async function streamUrl(id, quality = 'hq') {
  const data = await apiGet(`/tracks/${id}`, { ttl: 120_000 });
  if (!data.streamable) throw new ScError(404, 'This track is not streamable');
  const policy = String(data.policy || '');
  if (policy === 'BLOCK' || policy === 'SNIP') {
    throw new ScError(403, 'This track is not available for streaming');
  }
  const transcodings = data.media?.transcodings || [];
  if (!transcodings.length) throw new ScError(404, 'No audio available for this track');
  const presets = QUALITY_PRESETS[quality] || QUALITY_PRESETS.hq;
  let chosen = null;
  for (const preset of presets) {
    chosen = transcodings.find((t) => t.preset === preset);
    if (chosen) break;
  }
  if (!chosen) chosen = transcodings[0];
  const resolved = await apiGet(chosen.url, { ttl: 60_000 });
  return {
    url: resolved.url,
    mime: chosen.format?.mime_type,
    protocol: chosen.format?.protocol,
    preset: chosen.preset,
    duration: data.full_duration || data.duration,
  };
}

export async function waveform(url) {
  if (!url) return null;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = await res.json();
  const samples = data.samples || [];
  const step = Math.max(1, Math.floor(samples.length / 200));
  const out = [];
  for (let i = 0; i < samples.length; i += step) out.push(samples[i]);
  return { width: data.width, height: data.height, samples: out };
}

export async function proxyHref(href) {
  if (!href || !/^https:\/\/api-v2\.soundcloud\.com\//.test(href)) {
    throw new ScError(400, 'invalid href');
  }
  const data = await apiGet(href, { ttl: 60_000 });
  return {
    collection: (data.collection || []).map(mapSearchItem).filter(Boolean),
    next_href: stripClientId(data.next_href),
  };
}

/* ------------------------------- home feed ------------------------------- */

export async function home() {
  const sections = [];
  let selections = [];
  try {
    selections = await mixedSelections();
  } catch {}

  for (const sel of selections) {
    const items = sel.items?.collection || [];
    if (!items.length) continue;
    const mapped = items
      .map((item) => {
        if (item.kind === 'playlist') return slimPlaylist(item);
        if (item.kind === 'system-playlist') return slimPlaylist(item);
        if (item.kind === 'track') return slimTrack(item);
        return null;
      })
      .filter(Boolean);
    if (mapped.length) {
      sections.push({
        id: sel.urn || sel.title,
        title: sel.title,
        subtitle: sel.description || '',
        items: mapped,
        kind: 'selections',
      });
    }
  }

  // Trending-by-genre system playlists (hydrated)
  const trending = selections
    .flatMap((s) => s.items?.collection || [])
    .filter((i) => i.kind === 'system-playlist' && i.permalink?.startsWith('trending-by-genre:'));
  if (trending.length) {
    const genreSections = [];
    await Promise.all(
      trending.slice(0, 8).map(async (sp) => {
        try {
          const pl = await systemPlaylist(sp.id, { trackLimit: 12 });
          if (pl.tracks?.length) {
            genreSections.push({
              id: 'genre:' + sp.id,
              title: pl.title,
              subtitle: 'Trending now',
              items: pl.tracks.slice(0, 12),
              kind: 'genre',
              playlistId: sp.id,
            });
          }
        } catch {}
      })
    );
    sections.push(...genreSections);
  }

  try {
    const ch = await charts({ limit: 20 });
    if (ch.collection.length) {
      sections.unshift({
        id: 'charts',
        title: 'Trending right now',
        subtitle: 'The hottest tracks on SoundCloud',
        items: ch.collection,
        kind: 'tracks',
      });
    }
  } catch {}

  return sections;
}

export async function genres() {
  try {
    const selections = await mixedSelections();
    const trending = selections
      .flatMap((s) => s.items?.collection || [])
      .filter((i) => i.kind === 'system-playlist' && i.permalink?.startsWith('trending-by-genre:'));
    return trending.map((sp) => ({
      id: sp.id,
      title: sp.title,
      permalink: sp.permalink,
      artwork_url: sp.artwork_url || sp.calculated_artwork_url || null,
      track_count: sp.track_count ?? null,
    }));
  } catch {
    return [];
  }
}
