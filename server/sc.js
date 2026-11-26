import fs from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const API = 'https://api-v2.soundcloud.com';
// How long one upstream request may take before it is treated as unreachable.
const UPSTREAM_TIMEOUT = 12_000;
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

/*
 * A client id refresh is up to thirteen fetches in a row, and it used to sit
 * inside a request with no time limit at all. One slow asset was therefore able
 * to hold a page open for as long as the socket stayed up; the HAR that led here
 * has an 8.8s `/api/resolve` with nothing else in flight, which is this shape.
 * Every fetch is now bounded, the scan stops after the first few assets, and two
 * requests that need a refresh at the same time share one.
 */
const CLIENT_ID_FETCH_TIMEOUT = 4_000;
/*
 * The per-fetch bound alone is not enough: six slow assets at four seconds each
 * is still most of a minute. The whole refresh gets one deadline, and past it the
 * current id is kept, which is better than holding a page open.
 */
const CLIENT_ID_TOTAL_BUDGET = 6_000;
let clientIdRefresh = null;

function refreshClientId() {
  if (clientIdRefresh) return clientIdRefresh;
  const deadline = Date.now() + CLIENT_ID_TOTAL_BUDGET;
  clientIdRefresh = (async () => {
    const get = (href, accept) => {
      const left = deadline - Date.now();
      if (left <= 0) return Promise.reject(new Error('client id refresh budget spent'));
      return fetch(href, {
        headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) },
        signal: AbortSignal.timeout(Math.min(CLIENT_ID_FETCH_TIMEOUT, left)),
      }).then((r) => r.text());
    };
    try {
      const html = await get('https://soundcloud.com/', 'text/html');
      const assets = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[\w-]+\.js/g)].map(
        (m) => m[0]
      );
      for (const asset of assets.slice(0, 6)) {
        if (Date.now() >= deadline) break;
        try {
          const js = await get(asset);
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
  })().finally(() => {
    clientIdRefresh = null;
  });
  return clientIdRefresh;
}

export function getClientId() {
  return clientId;
}

function withClientId(href) {
  const url = new URL(href, API);
  if (!url.searchParams.get('client_id')) url.searchParams.set('client_id', clientId);
  return url.toString();
}

/*
 * SoundCloud sometimes answers with an HTML challenge page or an empty body
 * instead of JSON. Reading the body as text first turns that into a clear
 * error instead of a bare "Failed to parse JSON" surfacing to the user.
 */
function parseJsonBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // A challenge or error page comes back as HTML, which is a different story
    // from a truncated JSON body, so say which one happened.
    const html = text.trimStart().startsWith('<');
    throw new ScError(
      502,
      html
        ? 'SoundCloud answered with a web page instead of data. Try again in a moment.'
        : 'SoundCloud sent a response Fala could not read. Try again in a moment.'
    );
  }
}

/*
 * A single upstream read. The fetch is bounded by a timeout because api-v2
 * occasionally accepts a connection and then says nothing, and a request that
 * hangs would hold the whole response open. A transport failure is retried
 * once: a dropped DNS lookup or a refused connection is usually a blip, and
 * asking again immediately often succeeds.
 */
async function rawGet(href, { refresh = true, token = null, attempt = 0 } = {}) {
  const url = withClientId(href);
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (token) headers.Authorization = `OAuth ${token}`;
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT) });
  } catch (err) {
    if (attempt === 0) {
      return rawGet(href, { refresh, token, attempt: 1 });
    }
    throw new ScError(
      503,
      'SoundCloud could not be reached. Check the connection and try again.',
      null,
      'UPSTREAM_UNREACHABLE'
    );
  }
  if (!token && (res.status === 401 || res.status === 403) && refresh) {
    const next = await refreshClientId();
    if (next && next !== clientId) return rawGet(href, { refresh: false });
  }
  const text = await res.text();
  if (!res.ok) {
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    throw new ScError(res.status, body?.errors?.[0] || body?.error, body);
  }
  return parseJsonBody(text);
}

/*
 * Personalised responses depend on the caller's token, so they can never share
 * the process-wide cache above. They still repeat a lot within a page render:
 * the Sorted view asks for the same follow list and the same per-person streams
 * on every visit. This second cache is keyed by token and path, holds only
 * reads, and is dropped for a token as soon as that token writes anything.
 */
const tokenReadCache = new Map();
const TOKEN_KEYS_MAX = 120;

function tokenKey(token, href) {
  return `${token}\n${href.replace(/([?&])client_id=[^&]*/g, '$1')}`;
}

function rememberTokenKey(token, key) {
  let keys = tokenReadCache.get(token);
  if (!keys) {
    keys = new Set();
    tokenReadCache.set(token, keys);
  }
  keys.add(key);
  // Keep one token's cached reads bounded without touching anyone else's.
  if (keys.size > TOKEN_KEYS_MAX) {
    const oldest = keys.values().next().value;
    keys.delete(oldest);
    cache.delete(oldest);
  }
}

/*
 * Reads already on the wire, so a page that asks for the same thing twice pays
 * for it once. Several routes decorate their payload through `flagsFor` at the
 * same moment as the page's own request, and on a cold cache every one of those
 * would otherwise open its own socket for `/me` or an id list.
 */
const inflightReads = new Map();

export async function apiGet(href, { ttl = 60_000, token = null } = {}) {
  const key = token
    ? tokenKey(token, href)
    : href.replace(/([?&])client_id=[^&]*/g, '$1');
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const pending = inflightReads.get(key);
  if (pending) return pending;
  const request = rawGet(href, { token })
    .then((data) => {
      cacheSet(key, data, ttl);
      if (token) rememberTokenKey(token, key);
      rememberUsers(data);
      return data;
    })
    .finally(() => inflightReads.delete(key));
  inflightReads.set(key, request);
  return request;
}

const CAPTCHA_MESSAGE =
  'SoundCloud is asking for a captcha check before it allows write actions (likes, ' +
  'reposts, comments, follows and playlists). Reading and streaming still work. ' +
  'Open Settings > Write access in Fala to fix this.';

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
    throw new ScError(res.status, writeErrorMessage(text, parsed, res.status), parsed);
  }
  /*
   * A write changes what this token's reads would return, so its cached reads
   * are dropped here, once, rather than at every call site. Doing it after the
   * response means a failed write keeps the cache it did not invalidate.
   */
  invalidateToken(token);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/*
 * Write errors arrive in a few shapes: a JSON body with errors, a JSON body with
 * error, a plain-text body (api-v2 answers some bad ids with an empty 500) or an
 * HTML page. SoundCloud also has its own "unable to parse JSON" wording when it
 * dislikes the body we sent, which is useless to a listener, so it is replaced.
 */
function writeErrorMessage(text, parsed, status) {
  const raw =
    parsed?.errors?.[0] ||
    parsed?.error ||
    (typeof parsed?.message === 'string' ? parsed.message : null);
  if (raw) {
    if (/unable to parse json|invalid json|json parse/i.test(raw)) {
      return 'SoundCloud could not read the playlist update. Try again in a moment.';
    }
    return raw;
  }
  const trimmed = (text || '').trim();
  if (trimmed.startsWith('<')) return 'SoundCloud answered with a web page instead of data. Try again in a moment.';
  if (status === 500) return 'SoundCloud could not apply that change. Try again in a moment.';
  return `SoundCloud responded ${status}`;
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
  // 256 kbps is a Go+ preset. SoundCloud only lists it when the request carries
  // a Go+ token, so it leads the chain and free accounts fall through to 160.
  hq: ['aac_256k', 'abr_hq', 'aac_160k', 'abr_sq', 'aac_96k'],
  // Standard is the 160 kbps stream, which every account can play. 96 is the
  // data saver, one step below, and is never what Standard should land on.
  sq: ['aac_160k', 'abr_sq', 'aac_96k'],
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
    banner_url:
      u.visuals && u.visuals.enabled !== false && u.visuals.visuals?.length
        ? u.visuals.visuals[0].visual_url
        : null,
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
    /*
     * The song's own artist credit, which often differs from the account that
     * uploaded the file. Lists show this name but still link to the uploader,
     * so it has to travel with every track, not just the full song page.
     */
    publisher_metadata: t.publisher_metadata || null,
    /*
     * The two marks SoundCloud prints beside a song's credits. Explicit is a
     * plain flag in publisher_metadata. Lossless has no field of its own: a
     * lossless upload is the only thing that earns the 256k AAC preset, so the
     * transcoding list is the signal.
     */
    explicit: !!t.publisher_metadata?.explicit,
    lossless: (t.media?.transcodings || []).some(
      (x) => x.preset === 'aac_256k' || x.preset === 'abr_hq'
    ),
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
    artwork_url:
      p.artwork_url ||
      p.calculated_artwork_url ||
      (Array.isArray(p.tracks) ? p.tracks.find((t) => t?.artwork_url)?.artwork_url : null) ||
      null,
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

export async function mixedSelections({ token = null } = {}) {
  // With a token SoundCloud returns the personalised shelves ("Mixed for you",
  // "Made for you", "More of what you like"). Without it, generic editorial.
  const data = await apiGet('/mixed-selections', { ttl: 600_000, token });
  return data.collection || [];
}

// Personalised system playlists (mixes, made for you, more of what you like)
// only resolve for the owning account, so the caller's token has to go along.
export async function systemPlaylist(id, { trackLimit, token = null } = {}) {
  const data = await apiGet(`/system-playlists/${id}`, { ttl: 300_000, token });
  let ids = (data.tracks || []).map((t) => t.id).filter(Boolean);
  const total = ids.length;
  if (trackLimit) ids = ids.slice(0, trackLimit);
  const tracks = await tracksByIds(ids);
  const slim = slimPlaylist(data);
  /*
   * These mixes carry only track ids inline, so slimPlaylist finds no cover to
   * borrow and the band behind the card comes out empty. Once the tracks are
   * fetched, the first one with artwork can stand in for the mix.
   */
  if (!slim.artwork_url) {
    slim.artwork_url = tracks.find((t) => t?.artwork_url)?.artwork_url || null;
  }
  return { ...slim, tracks, track_count: data.track_count ?? total };
}

export async function playlist(id, { token = null } = {}) {
  const data = await apiGet(`/playlists/${id}`, { ttl: 120_000, token });
  const slim = slimPlaylist(data);
  /*
   * SoundCloud hydrates only the first handful of tracks inline and leaves the
   * rest as bare stubs with just an id. Those render as "Unknown" rows with no
   * artwork and a 0:00 length, so fetch the full objects for them.
   */
  const raw = data.tracks || [];
  const incomplete = raw.some((t) => t && t.id && !t.title);
  if (!incomplete) return slim;
  const ids = raw.map((t) => (t && t.id != null ? t.id : null)).filter((v) => v != null);
  const hydrated = await tracksByIds(ids);
  if (!hydrated.length) return slim;
  /*
   * A playlist with no cover of its own borrows the first track's, but the
   * inline stubs carry no artwork, so the borrow above found nothing. The
   * hydrated tracks do, and without this the "Liked by ..." shelves open on a
   * page with no band.
   */
  const artwork = slim.artwork_url || hydrated.find((t) => t?.artwork_url)?.artwork_url || null;
  return { ...slim, artwork_url: artwork, tracks: hydrated };
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

/*
 * The links an artist puts on their profile live at their own endpoint, keyed
 * by the full urn rather than the plain id, and they are not part of the user
 * payload. A profile with none answers with an empty list, which is not an
 * error, so that case is folded into the same empty result.
 */
export async function webProfiles(id) {
  if (!id) return [];
  const urn = String(id).startsWith('soundcloud:users:')
    ? String(id)
    : `soundcloud:users:${id}`;
  try {
    const list = await apiGet(`/users/${encodeURIComponent(urn)}/web-profiles`, {
      ttl: 300_000,
    });
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => p && p.url)
      .map((p) => ({
        url: p.url,
        network: p.network || 'personal',
        title: p.title || '',
        username: p.username || '',
      }));
  } catch {
    return [];
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
  const allowed = ['tracks', 'likes', 'playlists', 'albums', 'followers', 'followings', 'spotlight', 'comments', 'toptracks', 'reposts'];
  if (!allowed.includes(tab)) throw new ScError(400, 'bad tab');
  if (next) {
    const data = await apiGet(next, { ttl: 120_000, token });
    return mapCollection(data, (item) => mapUserTabItem(tab, item));
  }
  // Reposts live on the activity stream, not on /users/:id/reposts.
  const url =
    tab === 'reposts'
      ? `/stream/users/${id}/reposts?limit=${limit}`
      : `/users/${id}/${tab}?limit=${limit}`;
  const data = await apiGet(url, { ttl: 120_000, token });
  return mapCollection(data, (item) => mapUserTabItem(tab, item));
}

/*
 * A tab's own counter, so the page can say how much the artist really has
 * instead of how much of it happens to be loaded. Three tabs carry an official
 * counter on the user object; albums and reposts have none at all, so those
 * two are counted by walking their list. The walk is cached, so switching back
 * and forth between tabs costs nothing.
 */
export async function userTabTotal(id, tab) {
  const counter = {
    tracks: 'track_count',
    likes: 'likes_count',
    playlists: 'playlist_count',
  }[tab];
  if (counter) {
    const account = await user(id);
    return account ? Number(account[counter] || 0) : null;
  }
  const listPath =
    tab === 'albums'
      ? `/users/${id}/albums?limit=200`
      : tab === 'reposts'
        ? `/stream/users/${id}/reposts?limit=200`
        : null;
  if (!listPath) return null;
  /*
   * The repost stream mixes songs and playlists, but the tab lists only the
   * songs. Counting both would print a number larger than the list can ever
   * reach, so only the rows this tab renders are counted.
   */
  const countsRow = (item) =>
    tab === 'reposts' ? !!(item?.track || item?.kind === 'track') : true;
  const key = `tabtotal:${tab}:${id}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  let total = 0;
  let next = listPath;
  let pages = 0;
  try {
    while (next && pages < 60) {
      const data = await apiGet(next, { ttl: 120_000 });
      total += (data.collection || []).filter(countsRow).length;
      next = stripClientId(data.next_href);
      pages += 1;
    }
  } catch {
    // A page that fails mid walk keeps the count so far rather than blanking
    // the pill; the cache only holds a finished walk.
    return total || null;
  }
  cacheSet(key, total, 300_000);
  return total;
}

function mapUserTabItem(tab, item) {
  if (!item) return null;
  if (tab === 'followers' || tab === 'followings') return slimUser(item);
  if (tab === 'reposts' || tab === 'likes') {
    return slimTrack(item.track || (item.kind === 'track' ? item : null));
  }
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

/* ------------------------------ notifications ----------------------------- */

// SoundCloud's notification feed lives at /activities. It is scoped to the
// caller's token and lists who liked or reposted their tracks.
export async function notifications(token, { limit = 50, next } = {}) {
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/activities?limit=${limit}`, { token });
  return mapCollection(data, (a) => {
    if (!a) return null;
    /*
     * Comments and mentions both carry the comment, and the comment carries the
     * track. A reply to a comment arrives as `mention`, not `comment`, which is
     * why those used to fall through to a generic sentence.
     */
    const comment = a.comment || null;
    const track = a.track || comment?.track || null;
    return {
      id: a.uuid || a.cursor,
      type: a.type,
      created_at: a.created_at,
      user: a.user ? slimUser(a.user) : null,
      track: track ? slimTrack(track) : null,
      playlist: a.playlist ? slimPlaylist(a.playlist) : null,
      comment: comment
        ? {
            id: comment.id,
            body: comment.body || '',
            timestamp_ms: comment.timestamp ?? null,
          }
        : null,
    };
  });
}

/* ------------------------------ conversations ----------------------------- */

function slimMessage(m) {
  if (!m) return null;
  const content = typeof m.content === 'string' ? m.content : '';
  /*
   * SoundCloud identifies the author of a message with `sender_urn`
   * ("soundcloud:users:123"), not with `sender_id` or `user_id`. Reading the
   * wrong field made every message look like it came from the other person, so
   * the thread rendered as one flat list of grey bubbles.
   */
  const urn = m.sender_urn || m.user_urn || '';
  const urnId = urn ? Number(String(urn).split(':').pop()) : null;
  return {
    id: m.id,
    content,
    created_at: m.sent_at || m.created_at || null,
    sender_id:
      (Number.isFinite(urnId) && urnId) ||
      m.sender_id ||
      m.user_id ||
      m.user?.id ||
      null,
    user: m.user ? slimUser(m.user) : null,
  };
}

function slimConversation(c) {
  if (!c) return null;
  return {
    id: c.id,
    kind: 'conversation',
    users: (c.users || []).map(slimUser).filter(Boolean),
    read: !!c.read,
    last_message: slimMessage(c.last_message),
  };
}

export async function conversations(token, { limit = 50, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/users/${id}/conversations?limit=${limit}`, { token });
  return mapCollection(data, slimConversation);
}

/*
 * Messages are addressed by the *other person*, not by a conversation id.
 * `/users/:me/conversations/:other/messages` reads the thread and
 * `POST /users/:me/conversations/:other` sends into it, creating it on first
 * use. Passing a conversation URN instead makes SoundCloud answer
 * "Did not get or could not parse the 'other' param."
 */
export async function conversationMessages(token, otherId, { limit = 100, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(
        `/users/${id}/conversations/${encodeURIComponent(otherId)}/messages?limit=${limit}`,
        { token }
      );
  return mapCollection(data, slimMessage);
}

// Sends a message to `recipientId`, opening the conversation if needed.
export async function startConversation(token, recipientId, body) {
  const id = await meId(token);
  await apiWrite('POST', `/users/${id}/conversations/${encodeURIComponent(recipientId)}`, {
    token,
    body: { message: { content: body } },
  });
  return { recipient_id: Number(recipientId), content: body };
}

export async function sendMessage(token, recipientId, body) {
  return startConversation(token, recipientId, body);
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

/* ------------------------------- graphql ---------------------------------- */

/*
 * The web app talks to a separate GraphQL gateway for the parts of SoundCloud
 * that api-v2 never exposed: listener rankings, comment reactions (likes and the
 * track author's heart) and comment replies. Every call here needs the listener's
 * own token, which is why none of it is available signed out.
 */
const GRAPH_HOST = 'https://graph.soundcloud.com/graphql';

async function graphql(token, { query, variables }) {
  if (!token) throw new ScError(401, 'Connect your SoundCloud account first');
  // The gateway sits behind the same bot check as api-v2, so the solved cookie
  // and the user agent that solved it have to ride along. Without them every
  // write through here comes back as a captcha challenge.
  const dd = getDdCookie(token);
  const res = await fetch(GRAPH_HOST, {
    method: 'POST',
    headers: {
      'User-Agent': getDdUa(token),
      Authorization: `OAuth ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://soundcloud.com',
      Referer: 'https://soundcloud.com/',
      ...(dd ? { Cookie: `datadome=${dd}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (text.includes('captcha-delivery')) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    throw new ScError(403, CAPTCHA_MESSAGE, { url: parsed?.url || null }, 'captcha');
  }
  if (res.status === 401) {
    throw new ScError(
      401,
      'SoundCloud rejected this token. It may have expired, so paste a fresh one.',
      null,
      'token'
    );
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!data) {
    throw new ScError(
      res.status === 200 ? 502 : res.status,
      'SoundCloud sent a response Fala could not read. Try again in a moment.'
    );
  }
  if (Array.isArray(data.errors) && data.errors.length) {
    const first = data.errors[0];
    throw new ScError(
      res.status === 200 ? 400 : res.status,
      first?.message || 'SoundCloud could not run that request'
    );
  }
  return data.data || {};
}

function graphUserId(urn) {
  if (!urn) return null;
  const tail = String(urn).split(':').pop();
  const n = Number(tail);
  return Number.isFinite(n) ? n : null;
}

function slimGraphUser(u) {
  if (!u) return null;
  const country = u.country ? String(u.country) : '';
  return {
    id: graphUserId(u.urn),
    kind: 'user',
    username: u.username || u.permalink || 'Listener',
    permalink: u.permalink || null,
    permalink_url:
      u.permalinkUrl || (u.permalink ? `https://soundcloud.com/${u.permalink}` : null),
    avatar_url: u.avatarUrl || null,
    followers_count: u.followersCount ?? 0,
    verified: !!u.verified,
    city: u.city || '',
    country_code: country.length === 2 ? country.toUpperCase() : '',
    country: country.length === 2 ? '' : country,
  };
}

const TOP_FANS_QUERY = `
query TopFans($trackUrn: ID!) {
  topFans(input: {trackUrn: $trackUrn}) {
    firstPeriodDays
    hasArtistOptedOut
    allTime {
      viewer { currentRank totalPlays }
      fans { fan { urn username permalink permalinkUrl avatarUrl followersCount verified city country } totalPlays }
    }
    firstPeriod { fans { fan { urn username permalink permalinkUrl avatarUrl followersCount verified city country } totalPlays } }
  }
}`;

/*
 * The listener ranking the insights page shows, for one track. SoundCloud only
 * keeps two windows here: the last `firstPeriodDays` days (seven, at the time of
 * writing) and all time. The windowed query elsewhere in this file ignores the
 * track and answers for the signed in account, so it is not used here.
 *
 * All time also carries a `viewer` block: where the signed in account itself
 * stands. SoundCloud leaves it null when the account never played the track, and
 * the first period tab has no viewer block at all, so only all time asks for it.
 */
export async function topListeners(token, trackId, { window = 'ALL_TIME', limit = 5 } = {}) {
  const data = await graphql(token, {
    query: TOP_FANS_QUERY,
    variables: { trackUrn: `soundcloud:tracks:${trackId}` },
  });
  const block = data.topFans || {};
  const which = window === 'DAYS_7' ? 'firstPeriod' : 'allTime';
  const rows = block[which]?.fans || [];
  const fans = rows
    .slice(0, limit)
    .map((row) => ({ plays: row?.totalPlays ?? 0, user: slimGraphUser(row?.fan) }))
    .filter((row) => row.user);

  // The viewer's own standing, when there is one to report.
  const seen = block.allTime?.viewer || null;
  const viewer =
    which === 'allTime' && seen && seen.currentRank != null
      ? { rank: seen.currentRank, plays: seen.totalPlays ?? 0 }
      : null;

  /*
   * A young track has no all time ranking yet, and SoundCloud only answers with
   * the first period. Reporting which windows carry rows lets the card show one
   * tab instead of two, with the one that has data selected.
   */
  const hasAllTime = (block.allTime?.fans || []).length > 0;
  const hasFirst = (block.firstPeriod?.fans || []).length > 0;
  const windows = [];
  if (hasAllTime) windows.push('ALL_TIME');
  if (hasFirst) windows.push('DAYS_7');
  if (windows.length === 0) windows.push('ALL_TIME');

  return {
    window: which === 'firstPeriod' ? 'DAYS_7' : 'ALL_TIME',
    windows,
    days: block.firstPeriodDays || 7,
    optedOut: !!block.hasArtistOptedOut,
    fans,
    viewer,
  };
}

const COMMENT_REACTIONS = `
      reactions {
        creatorReaction(creatorUrn: $creatorUrn)
        userReaction
        reactionCounts { reactionTypeValueUrn count }
      }`;

const COMMENT_USER = `
      user { urn username permalink permalinkUrl avatarUrl followersCount city country verified }`;

const COMMENT_THREAD_QUERY = `
query TrackPageCommentsList($urn: ID!, $options: TrackCommentsOptionsInput, $creatorUrn: String) {
  trackComments(trackUrn: $urn, options: $options) {
    comments {
      urn
      body
      createdAt
      trackTime${COMMENT_REACTIONS}${COMMENT_USER}
      replies {
        total
        comments {
          urn
          body
          createdAt
          trackTime${COMMENT_REACTIONS}${COMMENT_USER}
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { endCursor }
  }
}`;

const COMMENT_REPLIES_QUERY = `
query TrackPageCommentReplies($trackUrn: ID!, $commentUrn: ID!, $options: TrackCommentRepliesOptionsInput, $creatorUrn: String) {
  trackCommentReplies(trackUrn: $trackUrn, commentUrn: $commentUrn, options: $options) {
    comments {
      urn
      body
      createdAt
      trackTime${COMMENT_REACTIONS}${COMMENT_USER}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const COMMENT_LIKE_MUTATION = `
mutation LikeTrackComment($commentUrn: String!, $trackUrn: String!) {
  upsertInteraction(input: {
    targetUrn: $commentUrn
    parentUrn: $trackUrn
    interactionTypeUrn: "sc:interactiontype:reaction"
    interactionTypeValueUrn: "sc:interactiontypevalue:like"
  }) { __typename }
}`;

const COMMENT_UNLIKE_MUTATION = `
mutation UnlikeTrackComment($commentUrn: String!, $trackUrn: String!) {
  removeInteraction(input: {
    targetUrn: $commentUrn
    parentUrn: $trackUrn
    interactionTypeUrn: "sc:interactiontype:reaction"
    interactionTypeValueUrn: "sc:interactiontypevalue:like"
  })
}`;

function mapGraphComment(c) {
  if (!c) return null;
  const counts = c.reactions?.reactionCounts || [];
  const likes = counts.reduce(
    (n, r) => (/like/i.test(r?.reactionTypeValueUrn || '') ? n + (r?.count || 0) : n),
    0
  );
  const replies = (c.replies?.comments || []).map(mapGraphComment).filter(Boolean);
  return {
    id: graphUserId(c.urn),
    urn: c.urn,
    source: 'soundcloud',
    body: c.body,
    timestamp_ms: c.trackTime ?? null,
    created_at: c.createdAt,
    user: slimGraphUser(c.user),
    likes,
    liked: !!c.reactions?.userReaction,
    creator_liked: !!c.reactions?.creatorReaction,
    replies,
    replies_total: c.replies?.total ?? replies.length,
    replies_cursor: c.replies?.pageInfo?.endCursor || null,
    replies_more: !!c.replies?.pageInfo?.hasNextPage,
  };
}

async function trackAuthorUrn(trackId, token) {
  try {
    const data = await apiGet(`/tracks/${trackId}`, { ttl: 120_000, token });
    return data?.user?.id ? `soundcloud:users:${data.user.id}` : null;
  } catch {
    return null;
  }
}

/*
 * Comments with their reactions and first page of replies. This is the only
 * route that can show like counts, the author's heart and replies, so it is used
 * whenever a token is present. Signed out callers keep the plain api-v2 list.
 */
export async function commentThread(token, trackId, { first = 30, after = null } = {}) {
  const creatorUrn = await trackAuthorUrn(trackId, token);
  const options = { first, sort: 'NEWEST' };
  if (after) options.after = after;
  const data = await graphql(token, {
    query: COMMENT_THREAD_QUERY,
    variables: {
      urn: `soundcloud:tracks:${trackId}`,
      options,
      creatorUrn,
    },
  });
  const block = data.trackComments || {};
  return {
    collection: (block.comments || []).map(mapGraphComment).filter(Boolean),
    next_cursor: block.pageInfo?.endCursor || null,
  };
}

export async function commentReplies(token, trackId, commentId, { first = 20, after = null } = {}) {
  const creatorUrn = await trackAuthorUrn(trackId, token);
  const options = { first };
  if (after) options.after = after;
  const data = await graphql(token, {
    query: COMMENT_REPLIES_QUERY,
    variables: {
      trackUrn: `soundcloud:tracks:${trackId}`,
      commentUrn: `soundcloud:comments:${commentId}`,
      options,
      creatorUrn,
    },
  });
  const block = data.trackCommentReplies || {};
  return {
    collection: (block.comments || []).map(mapGraphComment).filter(Boolean),
    next_cursor: block.pageInfo?.endCursor || null,
  };
}

export async function likeComment(token, trackId, commentId, on) {
  await graphql(token, {
    query: on ? COMMENT_LIKE_MUTATION : COMMENT_UNLIKE_MUTATION,
    variables: {
      commentUrn: `soundcloud:comments:${commentId}`,
      trackUrn: `soundcloud:tracks:${trackId}`,
    },
  });
  return { liked: !!on };
}

export async function related(id, { limit = 12 } = {}) {
  const data = await apiGet(`/tracks/${id}/related?limit=${limit}`, { ttl: 300_000 });
  return (data.collection || []).map(slimTrack).filter(Boolean);
}

export async function reposters(id, { limit = 12, next } = {}) {
  const data = next
    ? await apiGet(next)
    : await apiGet(`/tracks/${id}/reposters?limit=${limit}`, { ttl: 300_000 });
  return mapCollection(data, slimUser);
}

export async function likers(id, { limit = 50, next } = {}) {
  const data = next
    ? await apiGet(next)
    : await apiGet(`/tracks/${id}/likers?limit=${limit}`, { ttl: 120_000 });
  return mapCollection(data, slimUser);
}

/*
 * A playlist keeps its likers on its own endpoint. The shape is the same as
 * the track list, so the page behind it can reuse the same people grid.
 */
export async function playlistLikers(id, { limit = 50, next } = {}) {
  const data = next
    ? await apiGet(next)
    : await apiGet(`/playlists/${id}/likers?limit=${limit}`, { ttl: 120_000 });
  return mapCollection(data, slimUser);
}

// The playlists a track sits in, and the albums separately, since a track can
// appear in both and the song page shows the counts apart.
async function trackCollections(id, kind, { limit = 50, next } = {}) {
  const data = next
    ? await apiGet(next)
    : await apiGet(`/tracks/${id}/${kind}?limit=${limit}`, { ttl: 300_000 });
  return mapCollection(data, slimPlaylist);
}

export async function trackPlaylists(id, opts = {}) {
  return trackCollections(id, 'playlists', opts);
}

export async function trackAlbums(id, opts = {}) {
  return trackCollections(id, 'albums', opts);
}

/*
 * SoundCloud returns no total for these collections, so the count is a bounded
 * walk over the pages. Popular tracks sit in thousands of playlists and nobody
 * needs an exact figure, so it stops early and reports that it did.
 */
export async function trackCollectionCount(id, kind, { pages = 5, pageSize = 200 } = {}) {
  /*
   * The finished count is cached for longer than the pages it was built from.
   * The walk is serial and can run five pages deep, and it used to re-run on
   * every visit to a song even when the answer had not changed; the HAR that led
   * here shows a 6.1s and a 3.9s one. The count is a display figure and moves
   * slowly, so a few minutes of reuse is safe.
   */
  const key = `collcount:${kind}:${id}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  let total = 0;
  let next = null;
  let complete = false;

  for (let i = 0; i < pages; i += 1) {
    const page = await trackCollections(id, kind, { limit: pageSize, next });
    total += page.collection.length;
    next = page.next_href;
    if (!next) {
      complete = true;
      break;
    }
  }

  const result = { total, complete };
  /*
   * An unfinished walk is only cached briefly: it is a lower bound that says
   * "more than this", and a later visit may as well try again. A finished one
   * is the real number and can sit longer.
   */
  cacheSet(key, result, complete ? 600_000 : 60_000);
  return result;
}

/*
 * People the caller follows who liked a track. SoundCloud has no server-side
 * filter for this, so the two lists are intersected here. Liking is spread over
 * many pages, so a bounded number of pages is scanned before giving up.
 */
export async function alsoLiked(token, trackId, { pages = 6 } = {}) {
  const following = await followIds(token);
  if (!following.size) return { collection: [], following_count: 0, more: 0 };

  const found = [];
  let next = null;
  for (let i = 0; i < pages; i += 1) {
    const page = await likers(trackId, { limit: 200, next });
    for (const user of page.collection) {
      if (following.has(String(user.id))) found.push(user);
    }
    next = page.next_href;
    if (!next) break;
  }

  return { collection: found, following_count: following.size, more: Math.max(0, found.length - 3) };
}

/*
 * Widevine licences for encrypted SoundCloud streams. The endpoint answers a
 * CDM challenge, not a raw PSSH, and the resolved stream carries the
 * `licenseAuthToken` that has to ride along as `license_token`. SoundCloud's own
 * player posts to exactly this address, and it sends `access-control-allow-
 * origin: *`, so the browser can talk to it directly.
 */
const WIDEVINE_LICENSE_URL = 'https://license.media-streaming.soundcloud.cloud/playback/widevine';

export async function streamUrl(id, quality = 'hq', { token = null } = {}) {
  const data = await apiGet(`/tracks/${id}`, { ttl: 120_000, token });
  if (!data.streamable) throw new ScError(404, 'This track is not streamable');
  const policy = String(data.policy || '');
  if (policy === 'BLOCK' || policy === 'SNIP') {
    throw new ScError(403, 'This track is not available for streaming');
  }
  const transcodings = data.media?.transcodings || [];
  if (!transcodings.length) throw new ScError(404, 'No audio available for this track');
  /*
   * A monetised upload lists DRM variants (`cbc-encrypted-hls` for FairPlay,
   * `ctr-encrypted-hls` for Widevine) and sometimes no plain stream at all. A
   * plain stream is always preferred when it exists, because it needs no key
   * exchange. When there is none, the CTR variant can still play through EME:
   * its manifest carries a Widevine PSSH and the resolved URL carries the
   * licence token. The FairPlay variant is skipped, since its `skd://` key is
   * only usable by Safari's own key system.
   */
  const plain = transcodings.filter(
    (t) => !/encrypted/i.test(String(t.format?.protocol || ''))
  );
  const widevine = transcodings.filter(
    (t) => String(t.format?.protocol || '') === 'ctr-encrypted-hls'
  );
  const pool = plain.length ? plain : widevine;
  if (!pool.length) {
    throw new ScError(
      403,
      'This track is protected by SoundCloud and cannot be played here',
      null,
      'DRM_PROTECTED'
    );
  }
  const drm = !plain.length;
  /*
   * Preset names vary between uploads, so the quality chain is tried first and
   * the coarse quality field after it. Encrypted uploads also list a few
   * variants that resolve to nothing (`abr_sq` is a 404), so a candidate that
   * will not resolve is skipped rather than failing the whole track.
   */
  const presets = QUALITY_PRESETS[quality] || QUALITY_PRESETS.hq;
  const wanted = quality === 'lq' ? ['lq'] : quality === 'sq' ? ['sq', 'lq'] : ['hq', 'sq', 'lq'];
  const ordered = [];
  const add = (t) => {
    if (t && !ordered.includes(t)) ordered.push(t);
  };
  for (const preset of presets) for (const t of pool) if (t.preset === preset) add(t);
  for (const q of wanted) for (const t of pool) if (t.quality === q) add(t);
  for (const t of pool) add(t);

  for (const chosen of ordered.slice(0, 6)) {
    let resolved = null;
    try {
      resolved = await apiGet(chosen.url, { ttl: 60_000, token });
    } catch {
      continue;
    }
    if (!resolved?.url) continue;
    const out = {
      url: resolved.url,
      mime: chosen.format?.mime_type,
      protocol: chosen.format?.protocol,
      preset: chosen.preset,
      duration: data.full_duration || data.duration,
      drm,
    };
    if (drm) {
      out.licenseUrl = WIDEVINE_LICENSE_URL;
      out.licenseAuthToken = resolved.licenseAuthToken || null;
      if (!out.licenseAuthToken) continue;
    }
    return out;
  }
  throw new ScError(404, 'No audio available for this track');
}

/*
 * One waveform picture, thinned to a bar count the bars can actually draw. A url
 * from a feed can be stale or already gone, and SoundCloud answers those with a
 * 404 or a body with no samples; both come back as null so the caller can try
 * the song's current url instead.
 */
async function waveformAt(url) {
  if (!url) return null;
  /*
   * A shape never changes once the song is uploaded, so it is kept for a day.
   * Without this the proxy downloaded the same picture from SoundCloud on every
   * visit, which is the wait that put the bars behind the rest of the page. A
   * dead url answers with nothing and is not cached, so the retry against the
   * song's current url still happens.
   */
  const cacheKey = `waveform\n${url}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const samples = data.samples || [];
  if (!samples.length) return null;
  /*
   * The payload is passed through as SoundCloud ships it: every sample, as an
   * integer on the picture's `height` scale. Nothing is thinned and nothing is
   * rescaled.
   *
   * Everything before this thinned the samples to 1200 and rescaled them to three
   * decimals, which cost about 7.0kB a track. Sending all 1800 as integers costs
   * about 7.2kB, so the detail was being dropped to save nothing. A skipped
   * sample can be the dip between two hits, and no curve can put a dip back that
   * the payload no longer contains. That is the flat stretch that survived every
   * attempt at the shape: the shape was being fitted to data that had already lost
   * the detail.
   *
   * `height` is 140 on every track SoundCloud serves and the loudest sample always
   * equals it, so the client dividing by it is the same division by the track's
   * own peak that their `WaveformData` does. The integers are already the levels
   * they use, so keeping them exact means no two original levels collapse onto one
   * value the way two-decimal rounding made them.
   */
  const height = data.height || 140;
  const clamped = samples.map((s) => Math.min(height, Math.max(0, Math.round(s))));
  const shape = { width: data.width, height, samples: clamped };
  cacheSet(cacheKey, shape, 86_400_000);
  return shape;
}

/*
 * The shape for a song, tried against the url the caller handed over first and
 * then against the song's own current url. Lists hand over a url they were given
 * when the feed was fetched, and that copy can be dead by the time the row is
 * drawn, which is how a bar used to stay empty on every visit.
 */
export async function waveform(url, trackId = null) {
  const first = await waveformAt(url);
  if (first) return first;
  if (!trackId) return null;
  try {
    const t = await apiGet(`/tracks/${trackId}`, { ttl: 120_000 });
    if (t?.waveform_url && t.waveform_url !== url) return waveformAt(t.waveform_url);
  } catch {}
  return null;
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

/*
 * Playlists inside the home shelves arrive without a `tracks` array, so the
 * borrow-the-first-track-cover fallback in slimPlaylist has nothing to read and
 * the card renders with no image. The standalone playlist endpoint does carry
 * the tracks, so the cover is fetched for the handful of playlists per shelf
 * that need one. Cached, because the home feed is requested on every visit.
 */
const coverCache = new Map();

async function playlistCover(entry, token) {
  const id = Number(entry?.id);
  if (!Number.isFinite(id)) return null;
  /*
   * A private playlist only resolves for its owner, so the cache is keyed by
   * the token as well. Otherwise one listener's cover could be served to
   * another, and a private one would leak through the shared entry.
   */
  const key = `${token || ''}:${id}`;
  const hit = coverCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  let url = null;
  try {
    const data = await apiGet(`/playlists/${id}`, { ttl: 120_000, token });
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    url =
      data.artwork_url ||
      data.calculated_artwork_url ||
      tracks.find((t) => t && t.artwork_url)?.artwork_url ||
      null;
  } catch {}
  coverCache.set(key, { url, exp: Date.now() + 300_000 });
  if (coverCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of coverCache) if (v.exp < now) coverCache.delete(k);
  }
  return url;
}

// Fills in the missing covers for one shelf, in parallel and only where needed.
async function addMissingCovers(entries, token) {
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry || entry.artwork_url) return;
      if (entry.kind !== 'playlist' && entry.kind !== 'album') return;
      const cover = await playlistCover(entry, token);
      if (cover) entry.artwork_url = cover;
    })
  );
  return entries;
}

export async function home({ token = null } = {}) {
  const sections = [];
  let selections = [];
  try {
    selections = await mixedSelections({ token });
  } catch {}

  // Editorial and promo shelves that SoundCloud serves to everyone. A signed-in
  // listener asked for their own activity, so these are dropped for them.
  const GENERIC = [
    'trending-by-genre-playlists',
    'personalised-curated-global',
    'promo-campaign',
    'artist-stations-global',
  ];

  // Shelves nobody asked for, shown to signed-in and anonymous visitors alike.
  // The stations shelf is dropped for everyone, not just signed-in listeners.
  const ALWAYS_HIDDEN = [
    'soundcloud:selections:buzzing',
    'soundcloud:selections:artist-stations',
  ];

  for (const sel of selections) {
    const urn = String(sel.urn || '');
    if (ALWAYS_HIDDEN.some((g) => urn.includes(g))) continue;
    if (token && GENERIC.some((g) => urn.includes(g))) continue;
    const items = sel.items?.collection || [];
    if (!items.length) continue;
    /*
     * SoundCloud repeats the same mix several times in one shelf, and repeats
     * playlists across shelves. A shelf should show each thing once, so the
     * first occurrence wins and later duplicates are dropped.
     */
    const seen = new Set();
    const mapped = items
      .map((item) => {
        if (item.kind === 'playlist') return slimPlaylist(item);
        if (item.kind === 'system-playlist') return slimPlaylist(item);
        if (item.kind === 'track') return slimTrack(item);
        return null;
      })
      .filter(Boolean)
      .filter((entry) => {
        const key = `${entry.kind || 'track'}:${entry.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (mapped.length) {
      // Playlists here arrive without their tracks, so a card with no cover of
      // its own has to borrow one from the playlist itself.
      await addMissingCovers(mapped, token);
      sections.push({
        id: sel.urn || sel.title,
        title: sel.title,
        subtitle: sel.description || '',
        items: mapped,
        kind: 'selections',
      });
    }
  }

  // Trending-by-genre system playlists (hydrated). Signed-in listeners get
  // their own shelves instead of the generic genre stations.
  const trending = token
    ? []
    : selections
        .flatMap((s) => s.items?.collection || [])
        .filter((i) => i.kind === 'system-playlist' && i.permalink?.startsWith('trending-by-genre:'));
  if (trending.length) {
    const genreSections = [];
    await Promise.all(
      trending.slice(0, 8).map(async (sp) => {
        try {
          const pl = await systemPlaylist(sp.id, { trackLimit: 12, token });
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

  // Generic charts are the anonymous fallback. Signed-in listeners get their
  // own mixes, so the global chart shelf would just be noise.
  if (!token) {
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
  }

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

/*
 * The like, repost and follow sets, walked once and kept.
 *
 * These used to hang off the per-token entry, which is thrown away after sixty
 * seconds. Every rollover therefore re-walked every page of every list, and
 * because the walk is serial that landed on whatever request came next: the same
 * page took a second on a warm cache and eight on a cold one. The HAR that led
 * here shows exactly that, an 8.4s `/api/me/likes` with nothing else in flight.
 *
 * The sets now live in their own map with a long life. A write clears the token's
 * entries through `invalidateToken`, so a like or a follow still shows up at
 * once; nothing here goes stale on its own. A walk already running is shared, so
 * the several routes that decorate a page at once pay for one walk between them.
 */
const idSetCache = new Map();
const idSetPending = new Map();
const ID_SET_TTL = 10 * 60_000;

function idSetKey(token, href) {
  return `${token}\n${href}`;
}

/*
 * Keep the set cache bounded. A visit normally has one token, but reconnecting
 * leaves the old token's entries behind until they age out, so the expired ones
 * are swept before the oldest live entry is dropped.
 */
function capIdSets() {
  if (idSetCache.size <= 400) return;
  const now = Date.now();
  for (const [k, v] of idSetCache) if (v.exp < now) idSetCache.delete(k);
  if (idSetCache.size > 400) idSetCache.delete(idSetCache.keys().next().value);
}

async function idSet(href, token, { maxPages = 40 } = {}) {
  const key = idSetKey(token, href);
  const hit = idSetCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const pending = idSetPending.get(key);
  if (pending) return pending;
  const request = (async () => {
    const ids = new Set();
    /*
     * The ids endpoints answer ten entries at a time unless a page size is
     * asked for, so an account with a few thousand likes paid for hundreds of
     * serial round trips every time this set went cold. That was the whole wait
     * on the first song after a pause. The largest page SoundCloud serves is
     * 200, which brings the same walk down to a handful of requests.
     */
    let next = /[?&]limit=/.test(href)
      ? href
      : href + (href.includes('?') ? '&' : '?') + 'limit=200';
    let pages = 0;
    while (next && pages < maxPages) {
      /*
       * A page that fails mid walk keeps what was already read instead of
       * throwing the whole set away. The caller treats a short set as a reason
       * to top up from the list, so a partial answer still moves things forward.
       */
      let data;
      try {
        data = await apiGet(next, { token });
      } catch {
        break;
      }
      for (const v of data.collection || []) ids.add(String(v?.id ?? v));
      next = data.next_href ? stripClientId(data.next_href) : null;
      pages += 1;
    }
    idSetCache.set(key, { ids, exp: Date.now() + ID_SET_TTL });
    capIdSets();
    return ids;
  })().finally(() => idSetPending.delete(key));
  idSetPending.set(key, request);
  return request;
}

/*
 * Builds the like set from the likes list itself, which is the same source the
 * likes page reads, so a song shown there can never disagree with its heart.
 */
async function likesFromList(token, ids, expected, maxPages = 25) {
  try {
    const id = await meId(token);
    let next = `/users/${id}/track_likes?limit=200`;
    let pages = 0;
    while (next && pages < maxPages && (!expected || ids.size < expected)) {
      const data = await apiGet(next, { token });
      for (const item of data.collection || []) {
        const trackId = item?.track?.id ?? (item?.kind === 'track' ? item.id : null);
        if (trackId != null) ids.add(String(trackId));
      }
      next = data.next_href ? stripClientId(data.next_href) : null;
      pages += 1;
    }
  } catch {}
  return ids;
}

export async function likeIds(token) {
  /*
   * The finished set is cached under its own key, because it can be filled from
   * two sources: the ids endpoint, and the likes list when that endpoint answers
   * short. It shares the long life and the in-flight sharing of `idSet`.
   */
  const key = idSetKey(token, 'likes:full');
  const hit = idSetCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const pending = idSetPending.get(key);
  if (pending) return pending;
  const request = (async () => {
    let ids = new Set();
    try {
      ids = await idSet('/me/track_likes/ids', token);
      const account = await me(token).catch(() => null);
      const expected = Number(account?.likes_count || 0);
      /*
       * The ids endpoint can come back empty or capped without saying so, while
       * the list endpoint is the one the likes page reads. Whenever the set is
       * empty or short of the account's own count, the list is walked to fill it.
       */
      if (ids.size === 0 || (expected && ids.size < expected)) {
        ids = await likesFromList(token, new Set(ids), expected);
      }
    } catch {
      ids = new Set();
    }
    idSetCache.set(key, { ids, exp: Date.now() + ID_SET_TTL });
    capIdSets();
    return ids;
  })().finally(() => idSetPending.delete(key));
  idSetPending.set(key, request);
  return request;
}

export async function playlistLikeIds(token) {
  try {
    return await idSet('/me/playlist_likes/ids', token);
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
  if (!token) return;
  tokenCache.delete(token);
  // A write changes what the reads would return, so drop every cached read
  // that belongs to this token and let the next page render fetch it again.
  const keys = tokenReadCache.get(token);
  if (keys) {
    for (const key of keys) cache.delete(key);
    tokenReadCache.delete(token);
  }
  /*
   * The like, repost and follow sets live longer than the rest, so they have to
   * be dropped here too. This is what keeps them honest: within a visit they do
   * not expire, so a like or a follow has to show at once rather than later.
   */
  const prefix = `${token}\n`;
  for (const key of [...idSetCache.keys()]) {
    if (key.startsWith(prefix)) idSetCache.delete(key);
  }
  libraryCache.delete(token);
}

/* ------------------------------- library reads ------------------------------ */

export async function myLikes(token, { limit = 200, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/users/${id}/track_likes?limit=${limit}`, { token });
  // Likes arrive as { kind: 'like', track: {...} } wrappers, not bare tracks.
  return mapCollection(data, (item) =>
    slimTrack(item?.track || (item?.kind === 'track' ? item : null))
  );
}

export async function myReposts(token, { limit = 200, next } = {}) {
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

// The list endpoints never report a total, so counts come from the account
// object when it carries one. Some accounts report 0 there, so fall back to
// walking the pages. Bounded so a huge library cannot stall the sidebar.
export async function myCounts(token, { maxPages = 16, pageSize = 200 } = {}) {
  const id = await meId(token);
  /*
   * Counts have to match what the list pages actually show, so they are walked
   * with the same mapping the pages use. The account object's own totals drift
   * from the lists: it counts playlist reposts the repost page drops, and it can
   * lag behind a playlist created moments ago.
   */
  const walk = async (first, mapper) => {
    let href = first;
    let total = 0;
    let pages = 0;
    while (href && pages < maxPages) {
      const data = await apiGet(href, { token });
      total += (data.collection || []).map(mapper).filter(Boolean).length;
      href = data.next_href ? stripClientId(data.next_href) : null;
      pages += 1;
    }
    return total;
  };
  const asTrack = (item) => slimTrack(item?.track || (item?.kind === 'track' ? item : null));
  const asRepost = (item) => {
    if (!item) return null;
    if (item.track) return slimTrack(item.track);
    if (item.kind === 'track') return slimTrack(item);
    return null;
  };
  const [likes, following, playlists, reposts] = await Promise.all([
    walk(`/users/${id}/track_likes?limit=${pageSize}`, asTrack).catch(() => 0),
    walk(`/users/${id}/followings?limit=${pageSize}`, slimUser).catch(() => 0),
    walk(`/users/${id}/playlists?limit=${pageSize}`, slimPlaylist).catch(() => 0),
    walk(`/stream/users/${id}/reposts?limit=${pageSize}`, asRepost).catch(() => 0),
  ]);
  return { likes, following, playlists, reposts };
}

export async function myPlaylists(token, { limit = 200, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/users/${id}/playlists?limit=${limit}`, { token });
  return mapCollection(data, slimPlaylist);
}

/*
 * Pages of the caller's own library, kept for a short while per token. The
 * search bar asks on every keystroke, and the four lists behind this change
 * slowly, so a page already walked is reused instead of fetched again. The
 * entry also remembers where the last walk stopped, which lets the next query
 * resume from there. Nothing is written to disk.
 */
const libraryCache = new Map();

function libraryEntry(token) {
  const hit = libraryCache.get(token);
  if (hit && hit.exp > Date.now()) return hit;
  const entry = { exp: Date.now() + 30_000, lists: new Map() };
  libraryCache.set(token, entry);
  if (libraryCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of libraryCache) if (v.exp < now) libraryCache.delete(k);
  }
  return entry;
}

/*
 * Walk one library list until enough matches are found. The wanted count is
 * small, and the newest pages hold the things a listener is most likely to be
 * looking for, so most queries stop after the first page instead of reading the
 * whole library. Everything walked stays in the per-token cache.
 */
async function walkLibrary(token, first, map, match, want, maxPages) {
  const entry = libraryEntry(token);
  let state = entry.lists.get(first);
  if (!state) {
    state = {
      items: [],
      seen: new Set(),
      href: first,
      done: false,
      pages: 0,
      queue: Promise.resolve(),
    };
    entry.lists.set(first, state);
  }

  /*
   * Walks of one list take turns. Two searches can arrive together, the bar
   * and the page both asking as the term settles, and a walk is not atomic:
   * if both read the same page they each add its rows, and the next search
   * then answers with the same person twice. Queued one behind the other, the
   * second walk usually finds its answer in what the first already read and
   * never fetches at all.
   */
  const run = state.queue.then(() => walkOnce(token, state, map, match, want, maxPages));
  state.queue = run.catch(() => {});
  return run;
}

async function walkOnce(token, state, map, match, want, maxPages) {
  /*
   * Rows are kept by id. Paginating a list that is still being written can
   * hand the same row back on two pages, which would otherwise show twice.
   */
  const keyOf = (item) => `${item.kind || ''}:${item.id}`;
  const found = [];
  const foundSeen = new Set();
  const take = (item) => {
    const key = keyOf(item);
    if (foundSeen.has(key)) return;
    foundSeen.add(key);
    found.push(item);
  };
  for (const item of state.items) if (match(item)) take(item);

  while (!state.done && found.length < want) {
    const href = state.href;
    if (!href) {
      state.done = true;
      break;
    }
    const data = await apiGet(href, { token });
    for (const item of data.collection || []) {
      const mapped = map(item);
      if (!mapped) continue;
      const key = keyOf(mapped);
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      state.items.push(mapped);
      if (match(mapped)) take(mapped);
    }
    state.href = data.next_href ? stripClientId(data.next_href) : null;
    state.pages += 1;
    if (!state.href || state.pages >= maxPages) state.done = true;
  }
  return found.slice(0, want);
}

/*
 * Matches in the caller's own library. SoundCloud's search has no "mine"
 * filter, so the query is run against the followed people, the liked songs and
 * the playlists the caller owns or likes, and the titles are matched here.
 *
 * Only a few rows are shown, so only a few are looked for: a listener with
 * thousands of likes still gets an answer from the first page or two. The page
 * bound is a backstop for a query that matches nothing at all.
 */
export async function searchMine(
  token,
  q,
  { maxPages = 10, pageSize = 200, want = { people: 2, tracks: 2, playlists: 1 } } = {}
) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return { people: [], tracks: [], playlists: [] };

  const matches = (item) => {
    const title = String(item?.title || '').toLowerCase();
    const artist = String(item?.user?.username || '').toLowerCase();
    return title.includes(needle) || artist.includes(needle);
  };

  /*
   * People are matched on the name they show and the permalink, so "gabber"
   * finds a followed account called Gabber Industries Berlin but not one whose
   * description happens to mention it. A follow match is a person, not a
   * result, so it only answers on the name.
   */
  const matchesPerson = (user) => {
    const name = String(user?.username || '').toLowerCase();
    const permalink = String(user?.permalink || '').toLowerCase();
    return name.includes(needle) || permalink.includes(needle);
  };

  const id = await meId(token);
  const asTrack = (item) => slimTrack(item?.track || (item?.kind === 'track' ? item : null));
  const asLikedPlaylist = (item) =>
    slimPlaylist(item?.playlist || (item?.kind === 'playlist' ? item : null));

  const [people, tracks, owned, liked] = await Promise.all([
    walkLibrary(
      token,
      `/users/${id}/followings?limit=${pageSize}`,
      slimUser,
      matchesPerson,
      want.people,
      maxPages
    ).catch(() => []),
    walkLibrary(
      token,
      `/users/${id}/track_likes?limit=${pageSize}`,
      asTrack,
      matches,
      want.tracks,
      maxPages
    ).catch(() => []),
    walkLibrary(
      token,
      `/users/${id}/playlists?limit=${pageSize}`,
      slimPlaylist,
      matches,
      want.playlists,
      maxPages
    ).catch(() => []),
    walkLibrary(
      token,
      `/users/${id}/playlist_likes?limit=${pageSize}`,
      asLikedPlaylist,
      matches,
      want.playlists,
      maxPages
    ).catch(() => []),
  ]);

  // A playlist can be both owned and liked, so the two lists are merged by id.
  const seen = new Set();
  const playlists = [];
  for (const p of [...owned, ...liked]) {
    if (!p || seen.has(String(p.id))) continue;
    seen.add(String(p.id));
    playlists.push(p);
  }

  return { people, tracks, playlists: playlists.slice(0, want.playlists) };
}

export async function myFollowing(token, { limit = 200, next } = {}) {
  const id = await meId(token);
  const data = next
    ? await apiGet(next, { token })
    : await apiGet(`/users/${id}/followings?limit=${limit}`, { token });
  return mapCollection(data, slimUser);
}

export async function myHistory(token, { limit = 200 } = {}) {
  const data = await apiGet(`/me/play-history/tracks?limit=${limit}`, { token });
  /*
   * Playing one track three times in a row writes three history rows. The list
   * is a record of what was listened to, not of how often, so the newest entry
   * for a track is kept and the repeats are dropped.
   */
  const seen = new Set();
  const collection = (data.collection || [])
    .map((entry) => slimTrack(entry.track))
    .filter(Boolean)
    .filter((track) => {
      const key = String(track.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { collection, next_href: null };
}

export async function myStream(token, { limit = 50 } = {}) {
  const data = await apiGet(`/stream?limit=${limit}`, { token });
  return {
    collection: (data.collection || []).map(mapActivityItem).filter(Boolean),
    next_href: stripClientId(data.next_href),
  };
}

/*
 * The Sorted view of the activity feed.
 *
 * The plain stream is one long list of events. Sorted answers the other
 * question: what did each person you follow put out lately, and when. So it
 * groups the same events by their author, keeps only the last `days`, and puts
 * the newest first inside each author.
 *
 * An author is either the person who made the event, or, for a repost, the
 * person who reposted it. Only tracks are kept: a comment, a like or a new
 * follower is not something an author "put out". Each entry records which of
 * the two it was, because the list marks an upload and a repost differently.
 *
 * The people walked are the ones you follow, capped by `maxPeople`, because the
 * feed itself only reaches so far back and a follow with no recent activity is
 * not worth a row. The walk stops early once an event is older than the window,
 * since the stream is newest first.
 */
export function groupActivity(results, cutoff) {
  const authors = new Map();
  for (const { person, collection } of results) {
    const entries = [];
    for (const event of collection || []) {
      const when = event?.created_at ? new Date(event.created_at).getTime() : NaN;
      if (!Number.isFinite(when)) continue;
      // The stream is newest first, so the first old event ends this author.
      if (when < cutoff) break;
      const track = event.track;
      if (!track || !track.id) continue;
      /*
       * A track event is an upload when the event's author owns the track, and
       * a repost when someone else's track is passed on. The repost event type
       * says the same thing directly, but checking the owner covers the events
       * that arrive as a plain track.
       */
      const ownerId = track.user?.id;
      const repost = String(ownerId) !== String(person.id);
      entries.push({
        type: repost ? 'repost' : 'post',
        created_at: event.created_at,
        track: slimTrack(track),
      });
    }
    if (!entries.length) continue;
    // Newest first, so the top of the drop down is the latest thing they did.
    entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    authors.set(String(person.id), {
      user: person,
      latest: entries[0].created_at,
      entries,
    });
  }

  /*
   * The authors themselves are ordered by their latest event, so the list reads
   * as "who did something most recently" rather than alphabetically.
   */
  return [...authors.values()].sort((a, b) => new Date(b.latest) - new Date(a.latest));
}

export async function sortedActivity(token, { days = 7, maxPeople = 60, maxTopUp = 24 } = {}) {
  const windowMs = Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const me = await meId(token);
  const follows = await apiGet(`/users/${me}/followings?limit=${maxPeople}`, { token });
  const people = (follows.collection || []).map(slimUser).filter(Boolean);

  /*
   * The aggregate feed is one request and already covers the busiest people,
   * so it seeds the grouping. Each followed account is then topped up with its
   * own stream only if the feed did not mention it: walking every follow on
   * every visit was dozens of sockets for a handful of authors, and the first
   * one to fail took the whole view down with it.
   */
  const results = [];
  const seen = new Set();
  // Kept so an unreachable SoundCloud is reported as such. Without it, every
  // failed request was swallowed and the view claimed nobody had posted.
  let upstreamError = null;
  try {
    const feed = await apiGet('/stream?limit=200', { token, ttl: 120_000 });
    const byAuthor = new Map();
    for (const event of feed.collection || []) {
      const actor = event?.user;
      if (!actor?.id) continue;
      const key = String(actor.id);
      if (!byAuthor.has(key)) {
        // The actor can be a partial object with no username; skipping it is
        // better than rendering an author row with nothing to name it.
        const person = slimUser(actor);
        if (!person) continue;
        byAuthor.set(key, { person, collection: [] });
      }
      byAuthor.get(key).collection.push(event);
    }
    for (const [key, group] of byAuthor) {
      seen.add(key);
      results.push(group);
    }
  } catch (err) {
    // The per-person streams below can still fill the view on their own.
    upstreamError = err;
  }

  /*
   * The top-up covers the quieter follows the feed never reached. It is capped
   * and fetched a few at a time so a long follow list cannot turn one page
   * load into a hundred simultaneous requests. A failure for one account
   * leaves that account out instead of blanking the view.
   */
  const missing = people.filter((p) => !seen.has(String(p.id))).slice(0, maxTopUp);
  const POOL = 6;
  let attempted = 0;
  let failed = 0;
  for (let i = 0; i < missing.length; i += POOL) {
    const batch = missing.slice(i, i + POOL);
    const settled = await Promise.all(
      batch.map(async (person) => {
        attempted += 1;
        try {
          const data = await apiGet(`/stream/users/${person.id}?limit=50`, {
            token,
            ttl: 120_000,
          });
          return { person, collection: data.collection || [] };
        } catch (err) {
          failed += 1;
          upstreamError = upstreamError || err;
          return { person, collection: [] };
        }
      })
    );
    results.push(...settled);
  }

  const collection = groupActivity(results, cutoff);
  /*
   * If the feed failed and so did every top-up, an empty list would read as
   * "nobody posted" when the truth is that SoundCloud was not reachable. Report
   * the upstream problem so the page can show it and offer a retry.
   */
  if (!collection.length && upstreamError && failed > 0 && failed === attempted) {
    throw upstreamError;
  }

  return {
    collection,
    days,
    cutoff: new Date(cutoff).toISOString(),
  };
}

/* --------------------------------- writes ---------------------------------- */

export async function like(token, trackId, on) {
  const id = await meId(token);
  await apiWrite(on ? 'PUT' : 'DELETE', `/users/${id}/track_likes/${trackId}`, { token });
  return { liked: !!on };
}

export async function likePlaylist(token, playlistId, on) {
  const id = await meId(token);
  await apiWrite(on ? 'PUT' : 'DELETE', `/users/${id}/playlist_likes/${playlistId}`, { token });
  return { liked: !!on };
}

/*
 * A repost can carry a short caption. SoundCloud stores it on its own endpoint
 * after the repost exists, so the caption is a second write. If that write is
 * refused the repost itself still stands, and the caller is told the note was
 * dropped rather than being shown a failure for the whole action.
 */
export async function repost(token, trackId, on, caption) {
  await apiWrite(on ? 'PUT' : 'DELETE', `/me/track_reposts/${trackId}`, { token });

  const text = typeof caption === 'string' ? caption.trim() : '';
  if (!on || !text) return { reposted: !!on, captionSaved: null };

  try {
    await apiWrite('PUT', `/me/track_reposts/${trackId}/caption`, {
      token,
      body: { caption: text },
    });
    return { reposted: true, captionSaved: true };
  } catch {
    return { reposted: true, captionSaved: false };
  }
}

export async function follow(token, userId, on) {
  await apiWrite(on ? 'POST' : 'DELETE', `/me/followings/${userId}`, { token });
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

/*
 * A cover travels as `artwork_data`, the same field SoundCloud's own uploader
 * uses. Three cases matter: undefined leaves the current cover alone, null asks
 * for it to be removed, and a data URI replaces it.
 */
function withArtwork(payload, artwork) {
  if (artwork === undefined) return payload;
  return { ...payload, artwork_data: artwork };
}

export async function createPlaylist(token, { title, description, is_private, artwork }) {
  const id = await meId(token);
  const payload = withArtwork(
    {
      title,
      description: description || '',
      sharing: is_private ? 'private' : 'public',
      tracks: [],
    },
    artwork
  );
  const data = await apiWrite('POST', `/playlists?user_id=${id}`, {
    token,
    body: { playlist: payload },
  });
  /*
   * Creation can accept the cover or quietly ignore it. The created record is
   * the only honest source, so a requested cover that did not land is reported
   * as dropped rather than being assumed to have worked.
   */
  const slim = slimPlaylist(data);
  // Nothing to remove on a brand new playlist, so a null cover is not a miss.
  const saved =
    artwork === undefined || artwork === null ? null : !!(slim && slim.artwork_url);
  return { ...slim, artworkSaved: saved };
}

export async function updatePlaylist(token, playlistId, patch) {
  const current = await apiGet(`/playlists/${playlistId}`, { token });
  const ids = playlistTrackIds(current.tracks);
  const merged = {
    ...current,
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    sharing:
      patch.is_private === undefined
        ? current.sharing
        : patch.is_private
          ? 'private'
          : 'public',
  };
  return writePlaylist(token, playlistId, merged, ids, patch.artwork);
}

export async function deletePlaylist(token, playlistId) {
  await apiWrite('DELETE', `/playlists/${playlistId}`, { token });
  return { ok: true };
}

/*
 * Playlist tracks come back as a mix of full objects and bare stubs, and a
 * playlist can hold entries with no id at all. Sending those back is what makes
 * SoundCloud answer with its own "unable to parse JSON" error, so only real ids
 * ever go out.
 */
function playlistTrackIds(tracks) {
  return (Array.isArray(tracks) ? tracks : [])
    .map((t) => (t && t.id != null ? Number(t.id) : null))
    .filter((id) => Number.isFinite(id));
}

/*
 * The PUT answer is a receipt, not the playlist: it comes back without its
 * tracks and often without a cover. Handing that straight to the caller is what
 * made a playlist read "0 tracks" and lose its thumbnail after an add, both in
 * the picker and in the library grid, until the page was opened and fetched
 * again. So the saved playlist is read back and that is what is returned. When
 * the read fails the previous record is kept and only the track count is
 * corrected, which is still better than a hollow card.
 */
async function savedPlaylist(token, playlistId, current, ids, artwork, saved) {
  let fresh = null;
  try {
    fresh = await apiGet(`/playlists/${playlistId}`, { token });
  } catch {}
  const base = fresh ? slimPlaylist(fresh) : null;
  const merged = base || {
    ...slimPlaylist(current),
    track_count: ids.length,
  };
  let coverSaved = null;
  if (artwork !== undefined) {
    // SoundCloud answers 200 whether or not it kept the cover, so the record
    // that came back decides. Removing one counts as saved once it is gone.
    coverSaved = artwork === null ? !merged.artwork_url : !!merged.artwork_url;
  } else if (saved !== undefined) {
    coverSaved = saved;
  }
  return { ...merged, artworkSaved: coverSaved };
}

/*
 * Updating a playlist means PUTting the whole thing back. The full body carries
 * title and sharing, which is what the UI edits. SoundCloud's own client sends
 * only the track ids when it just reorders, so that is the fallback for when the
 * full body is rejected.
 */
async function writePlaylist(token, playlistId, current, ids, artwork) {
  const full = {
    playlist: withArtwork(
      {
        title: current.title,
        description: current.description || '',
        sharing: current.sharing || 'public',
        tracks: ids.map((id) => ({ id })),
      },
      artwork
    ),
  };
  try {
    const data = await apiWrite('PUT', `/playlists/${playlistId}`, { token, body: full });
    if (data && data.id) {
      return savedPlaylist(token, playlistId, current, ids, artwork);
    }
  } catch (err) {
    if (err?.code === 'captcha' || err?.status === 401 || err?.status === 403) throw err;
  }
  // Minimal body: the shape SoundCloud's own player sends for track changes.
  // It carries no cover, so a requested cover is reported as dropped rather
  // than being quietly lost behind a successful-looking write.
  const minimal = { playlist: { tracks: ids } };
  try {
    const data = await apiWrite('PUT', `/playlists/${playlistId}`, { token, body: minimal });
    if (data && data.id) {
      return savedPlaylist(token, playlistId, current, ids, artwork, false);
    }
  } catch (err) {
    if (err?.code === 'captcha' || err?.status === 401 || err?.status === 403) throw err;
  }
  // Neither shape answered with the playlist, so read it back to show the truth.
  return savedPlaylist(token, playlistId, current, ids, artwork, false);
}

export async function addTrackToPlaylist(token, playlistId, trackId) {
  const current = await apiGet(`/playlists/${playlistId}`, { token });
  const ids = playlistTrackIds(current.tracks);
  const wanted = Number(trackId);
  if (!Number.isFinite(wanted)) throw new ScError(400, 'That track cannot be added');
  if (!ids.includes(wanted)) ids.push(wanted);
  return writePlaylist(token, playlistId, current, ids);
}

export async function removeTrackFromPlaylist(token, playlistId, trackId) {
  const current = await apiGet(`/playlists/${playlistId}`, { token });
  const ids = playlistTrackIds(current.tracks).filter((id) => String(id) !== String(trackId));
  return writePlaylist(token, playlistId, current, ids);
}
