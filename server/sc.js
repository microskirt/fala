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
  constructor(status, message, body, code) {
    super(message || `SoundCloud responded ${status}`);
    this.status = status;
    this.body = body;
    this.code = code;
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

async function rawGet(href, { refresh = true, token = null } = {}) {
  const url = withClientId(href);
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (token) headers.Authorization = `OAuth ${token}`;
  const res = await fetch(url, { headers });
  if (!token && (res.status === 401 || res.status === 403) && refresh) {
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

export async function apiGet(href, { ttl = 60_000, token = null } = {}) {
  // Personalised responses depend on the caller's token, so never share them
  // through the process-wide cache.
  if (token) {
    const data = await rawGet(href, { token });
    rememberUsers(data);
    return data;
  }
  const key = href.replace(/([?&])client_id=[^&]*/g, '$1');
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const data = await rawGet(href);
  cacheSet(key, data, ttl);
  rememberUsers(data);
  return data;
}

const CAPTCHA_MESSAGE =
  'SoundCloud is asking for a captcha check before it allows write actions (likes, ' +
  'reposts, comments, follows and playlists). Reading and streaming still work. ' +
  'Open Settings → Write access in Fala to fix this.';

const ddCookies = new Map();

/*
 * DataDome ties its verdict to the User-Agent that solved the challenge. The
 * browser solves it, but this server replays it, so the browser's UA is stored
 * next to the cookie and sent on every write afterwards.
 */
export function setDdCookie(token, value, ua) {
  if (!token) return;
  if (value) ddCookies.set(token, { value, ua: ua || UA });
  else ddCookies.delete(token);
}

export function getDdCookie(token) {
  return (token && ddCookies.get(token)?.value) || '';
}

export function getDdUa(token) {
  return (token && ddCookies.get(token)?.ua) || UA;
}

/*
 * Ask SoundCloud for a fresh challenge without touching the account.
 * A PUT to a track id that cannot exist is rejected by the captcha layer first;
 * if it ever got through it would 404, so nothing is liked, reposted or created.
 */
export async function captchaChallenge(token) {
  if (!token) throw new ScError(401, 'Connect your SoundCloud account first');
  const url = withClientId('/me/track_reposts/0');
  const dd = getDdCookie(token);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'User-Agent': getDdUa(token),
      Authorization: `OAuth ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://soundcloud.com',
      Referer: 'https://soundcloud.com/',
      ...(dd ? { Cookie: `datadome=${dd}` } : {}),
    },
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (parsed?.url && String(parsed.url).includes('captcha-delivery')) {
    return { blocked: true, url: parsed.url };
  }
  // No challenge: this network is already allowed to write.
  return { blocked: false, url: null };
}

export async function apiWrite(method, href, { token, body } = {}) {
  if (!token) throw new ScError(401, 'Connect your SoundCloud account first');
  const url = withClientId(href);
  const dd = getDdCookie(token);
  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': getDdUa(token),
      Authorization: `OAuth ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://soundcloud.com',
      Referer: 'https://soundcloud.com/',
      ...(dd ? { Cookie: `datadome=${dd}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 403 && text.includes('captcha-delivery')) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    throw new ScError(403, CAPTCHA_MESSAGE, { url: parsed?.url || null }, 'captcha');
  }
  if (res.status === 401) {
    throw new ScError(401, 'SoundCloud rejected this token. It may have expired, so paste a fresh one.', null, 'token');
  }
  if (!res.ok) {
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}
    throw new ScError(res.status, parsed?.errors?.[0] || parsed?.error || `SoundCloud responded ${res.status}`, parsed);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
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

  return {
    id: u.id,
    kind: 'user',
    username: u.username || u.permalink,
    permalink: u.permalink,
    permalink_url: u.permalink_url || `https://soundcloud.com/${u.permalink}`,
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
    created_at: u.created_at || null,
    first_name: u.first_name || '',
    last_name: u.last_name || '',
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

export async function playlist(id, { token = null } = {}) {
  const data = await apiGet(`/playlists/${id}`, { ttl: 120_000, token });
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

export async function track(id, { token = null } = {}) {
  const data = await apiGet(`/tracks/${id}`, { ttl: 120_000, token });
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

export async function userTab(id, tab, { limit = 24, next, token = null } = {}) {
  const allowed = ['tracks', 'likes', 'playlists', 'albums', 'followers', 'followings', 'spotlight', 'comments', 'toptracks'];
  if (!allowed.includes(tab)) throw new ScError(400, 'bad tab');
  if (next) {
    const data = await apiGet(next, { ttl: 120_000, token });
    return mapCollection(data, (item) => mapUserTabItem(tab, item));
  }
  const data = await apiGet(`/users/${id}/${tab}?limit=${limit}`, { ttl: 120_000, token });
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

export async function activity(id, { limit = 20, next, token = null } = {}) {
  if (next) {
    const data = await apiGet(next, { ttl: 60_000, token });
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
    id: c.id,
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

/* --------------------------- authenticated account -------------------------- */

// Short-lived per-token caches. Fala stores no account data on disk; these
// only avoid re-fetching the same thing several times per page render.
const tokenCache = new Map();

function tokenEntry(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit;
  const entry = { me: null, exp: Date.now() + 60_000 };
  tokenCache.set(token, entry);
  if (tokenCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of tokenCache) if (v.exp < now) tokenCache.delete(k);
  }
  return entry;
}

export async function me(token) {
  if (!token) return null;
  const entry = tokenEntry(token);
  if (entry.me) return entry.me;
  const data = await apiGet('/me', { token });
  entry.me = data;
  return data;
}

export async function meId(token) {
  const data = await me(token);
  if (!data) throw new ScError(401, 'Connect your SoundCloud account first');
  return data.id;
}

async function idSet(href, token) {
  const entry = tokenEntry(token);
  entry.sets = entry.sets || new Map();
  const hit = entry.sets.get(href);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const data = await apiGet(href, { token });
  const ids = new Set((data.collection || []).map((v) => String(v.id ?? v)));
  entry.sets.set(href, { ids, exp: Date.now() + 30_000 });
  return ids;
}

export async function likeIds(token) {
  try {
    return await idSet('/me/track_likes/ids', token);
  } catch {
    return new Set();
  }
}

export async function repostIds(token) {
  try {
    return await idSet('/me/track_reposts/ids', token);
  } catch {
    return new Set();
  }
}

export async function followIds(token) {
  try {
    const id = await meId(token);
    return await idSet(`/users/${id}/followings/ids`, token);
  } catch {
    return new Set();
  }
}

export function invalidateToken(token) {
  if (token) tokenCache.delete(token);
}

/* ------------------------------- library reads ------------------------------ */

export async function myLikes(token, { limit = 50, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/users/${id}/track_likes?limit=${limit}`, { token });
  return mapCollection(data, slimTrack);
}

export async function myReposts(token, { limit = 50, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/stream/users/${id}/reposts?limit=${limit}`, { token });
  return mapCollection(data, (item) => {
    if (!item) return null;
    if (item.track) return slimTrack(item.track);
    if (item.kind === 'track') return slimTrack(item);
    return null;
  });
}

export async function myPlaylists(token, { limit = 50, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/users/${id}/playlists?limit=${limit}`, { token });
  return mapCollection(data, slimPlaylist);
}

export async function myFollowing(token, { limit = 50, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/users/${id}/followings?limit=${limit}`, { token });
  return mapCollection(data, slimUser);
}

export async function myHistory(token, { limit = 50 } = {}) {
  const data = await apiGet(`/me/play-history/tracks?limit=${limit}`, { token });
  return {
    collection: (data.collection || [])
      .map((entry) => slimTrack(entry.track))
      .filter(Boolean),
    next_href: null,
  };
}

export async function myStream(token, { limit = 20 } = {}) {
  const data = await apiGet(`/stream?limit=${limit}`, { token });
  return {
    collection: (data.collection || []).map(mapActivityItem).filter(Boolean),
    next_href: stripClientId(data.next_href),
  };
}

/* --------------------------------- writes ---------------------------------- */

export async function like(token, trackId, on) {
  const id = await meId(token);
  await apiWrite(on ? 'PUT' : 'DELETE', `/users/${id}/track_likes/${trackId}`, { token });
  invalidateToken(token);
  return { liked: !!on };
}

export async function repost(token, trackId, on) {
  await apiWrite(on ? 'PUT' : 'DELETE', `/me/track_reposts/${trackId}`, { token });
  invalidateToken(token);
  return { reposted: !!on };
}

export async function follow(token, userId, on) {
  await apiWrite(on ? 'POST' : 'DELETE', `/me/followings/${userId}`, { token });
  invalidateToken(token);
  return { following: !!on };
}

export async function comment(token, trackId, body, timestampMs) {
  const payload = { comment: { body } };
  if (timestampMs != null) payload.comment.timestamp = Math.round(timestampMs);
  const data = await apiWrite('POST', `/tracks/${trackId}/comments`, { token, body: payload });
  return slimComment(data) || data;
}

export async function deleteComment(token, commentId) {
  await apiWrite('DELETE', `/comments/${commentId}`, { token });
  return { ok: true };
}

export async function createPlaylist(token, { title, description, is_private }) {
  const id = await meId(token);
  const payload = {
    playlist: {
      title,
      description: description || '',
      sharing: is_private ? 'private' : 'public',
      tracks: [],
    },
  };
  const data = await apiWrite('POST', `/playlists?user_id=${id}`, { token, body: payload });
  return slimPlaylist(data);
}

export async function updatePlaylist(token, playlistId, patch) {
  const current = await apiGet(`/playlists/${playlistId}`, { token });
  const payload = {
    playlist: {
      title: patch.title ?? current.title,
      description: patch.description ?? current.description,
      sharing: patch.is_private === undefined
        ? current.sharing
        : patch.is_private
          ? 'private'
          : 'public',
      tracks: (current.tracks || []).map((t) => ({ id: t.id })),
    },
  };
  const data = await apiWrite('PUT', `/playlists/${playlistId}`, { token, body: payload });
  return slimPlaylist(data);
}

export async function deletePlaylist(token, playlistId) {
  await apiWrite('DELETE', `/playlists/${playlistId}`, { token });
  return { ok: true };
}

export async function addTrackToPlaylist(token, playlistId, trackId) {
  const current = await apiGet(`/playlists/${playlistId}`, { token });
  const ids = (current.tracks || []).map((t) => t.id);
  if (!ids.includes(Number(trackId))) ids.push(Number(trackId));
  const payload = {
    playlist: {
      title: current.title,
      description: current.description || '',
      sharing: current.sharing || 'public',
      tracks: ids.map((id) => ({ id })),
    },
  };
  const data = await apiWrite('PUT', `/playlists/${playlistId}`, { token, body: payload });
  return slimPlaylist(data);
}

export async function removeTrackFromPlaylist(token, playlistId, trackId) {
  const current = await apiGet(`/playlists/${playlistId}`, { token });
  const ids = (current.tracks || [])
    .map((t) => t.id)
    .filter((id) => String(id) !== String(trackId));
  const payload = {
    playlist: {
      title: current.title,
      description: current.description || '',
      sharing: current.sharing || 'public',
      tracks: ids.map((id) => ({ id })),
    },
  };
  const data = await apiWrite('PUT', `/playlists/${playlistId}`, { token, body: payload });
  return slimPlaylist(data);
}
