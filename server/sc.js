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

async function rawGet(href, { refresh = true, token = null } = {}) {
  const url = withClientId(href);
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (token) headers.Authorization = `OAuth ${token}`;
  const res = await fetch(url, { headers });
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
    throw new ScError(res.status, writeErrorMessage(text, parsed, res.status), parsed);
  }
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
  // a Go+ token, so it leads the chain and free accounts fall through.
  hq: ['aac_256k', 'abr_hq', 'aac_160k', 'abr_sq', 'aac_96k'],
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

export async function chartSelections() {
  const data = await apiGet('/charts/selections', { ttl: 600_000 });
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
  return { ...slimPlaylist(data), tracks, track_count: data.track_count ?? total };
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
  return hydrated.length ? { ...slim, tracks: hydrated } : slim;
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
    allTime { fans { fan { urn username permalink permalinkUrl avatarUrl followersCount verified city country } totalPlays } }
    firstPeriod { fans { fan { urn username permalink permalinkUrl avatarUrl followersCount verified city country } totalPlays } }
  }
}`;

/*
 * The listener ranking the insights page shows, for one track. SoundCloud only
 * keeps two windows here: the last `firstPeriodDays` days (seven, at the time of
 * writing) and all time. The windowed query elsewhere in this file ignores the
 * track and answers for the signed in account, so it is not used here.
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
  return {
    window: which === 'firstPeriod' ? 'DAYS_7' : 'ALL_TIME',
    days: block.firstPeriodDays || 7,
    optedOut: !!block.hasArtistOptedOut,
    fans,
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

  return { total, complete };
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

export async function streamUrl(id, quality = 'hq', { token = null } = {}) {
  const data = await apiGet(`/tracks/${id}`, { ttl: 120_000, token });
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
  if (!chosen) {
    // Preset names vary between uploads, so fall back to the quality field.
    const wanted = quality === 'lq' ? ['lq'] : quality === 'sq' ? ['sq', 'lq'] : ['hq', 'sq', 'lq'];
    for (const q of wanted) {
      chosen = transcodings.find((t) => t.quality === q);
      if (chosen) break;
    }
  }
  if (!chosen) chosen = transcodings[0];
  const resolved = await apiGet(chosen.url, { ttl: 60_000, token });
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
  // More bars than a coarse 200 keeps the shape readable at SoundCloud's width.
  const step = Math.max(1, Math.floor(samples.length / 280));
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
  const ALWAYS_HIDDEN = ['soundcloud:selections:buzzing'];

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

/* --------------------------------- writes ---------------------------------- */

export async function like(token, trackId, on) {
  const id = await meId(token);
  await apiWrite(on ? 'PUT' : 'DELETE', `/users/${id}/track_likes/${trackId}`, { token });
  invalidateToken(token);
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
  invalidateToken(token);

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
  return writePlaylist(token, playlistId, merged, ids);
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
 * Updating a playlist means PUTting the whole thing back. The full body carries
 * title and sharing, which is what the UI edits. SoundCloud's own client sends
 * only the track ids when it just reorders, so that is the fallback for when the
 * full body is rejected.
 */
async function writePlaylist(token, playlistId, current, ids) {
  const full = {
    playlist: {
      title: current.title,
      description: current.description || '',
      sharing: current.sharing || 'public',
      tracks: ids.map((id) => ({ id })),
    },
  };
  try {
    const data = await apiWrite('PUT', `/playlists/${playlistId}`, { token, body: full });
    if (data && data.id) return slimPlaylist(data);
  } catch (err) {
    if (err?.code === 'captcha' || err?.status === 401 || err?.status === 403) throw err;
  }
  // Minimal body: the shape SoundCloud's own player sends for track changes.
  const minimal = { playlist: { tracks: ids } };
  try {
    const data = await apiWrite('PUT', `/playlists/${playlistId}`, { token, body: minimal });
    if (data && data.id) return slimPlaylist(data);
  } catch (err) {
    if (err?.code === 'captcha' || err?.status === 401 || err?.status === 403) throw err;
  }
  // Neither shape answered with the playlist, so read it back to show the truth.
  const fresh = await apiGet(`/playlists/${playlistId}`, { token });
  return slimPlaylist(fresh);
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
