import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { db, now, publicUser } from './db.js';
import {
  hashPassword, verifyPassword, generateTotpSecret, verifyTotp, totpUri,
  generateBackupCodes, hashBackupCode, consumeBackupCode,
  createSession, getSessionUser, destroySession, uniquePermalink, purgeExpiredSessions,
} from './auth.js';
import * as store from './store.js';
import * as sc from './sc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';

const COOKIE = 'wf_session';

/* ------------------------------ tiny helpers ------------------------------ */

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const permalinkRe = /^[a-z0-9][a-z0-9_-]{1,31}$/;

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'You need to be signed in');
  return ctx.user;
}

/* ------------------------------ auth payloads ------------------------------ */

function mePayload(user) {
  if (!user) return null;
  return {
    ...store.enrichLocalUser(user, user.id),
    email: user.email,
    settings: {
      theme: user.theme,
      quality: user.quality,
      autoplay: !!user.autoplay,
      normalize: !!user.normalize,
      private_likes: !!user.private_likes,
      show_reposts: !!user.show_reposts,
      email_notifs: !!user.email_notifs,
      seen_intro: !!user.seen_intro,
    },
  };
}

/* ------------------------------- track shaping ------------------------------ */

function decorateTrack(track, viewerId) {
  if (!track) return null;
  const localLikes = store.count('SELECT COUNT(*) FROM likes WHERE track_id = ?', track.id);
  const localReposts = store.count('SELECT COUNT(*) FROM reposts WHERE track_id = ?', track.id);
  return {
    ...track,
    liked: store.likeState(viewerId, track.id),
    reposted: store.repostState(viewerId, track.id),
    likes_count: (track.likes_count || 0) + localLikes,
    reposts_count: (track.reposts_count || 0) + localReposts,
    local_comment_count: store.commentCounts(track.id),
  };
}

function decorateItems(items, viewerId) {
  return (items || []).map((item) => {
    if (!item) return item;
    if (item.kind === 'track') return decorateTrack(item, viewerId);
    if (item.kind === 'user') return store.enrichRemoteUser(item, viewerId);
    if (item.kind === 'playlist') {
      return {
        ...item,
        tracks: item.tracks ? item.tracks.map((t) => decorateTrack(t, viewerId)) : item.tracks,
        user: item.user?.local ? item.user : store.enrichRemoteUser(item.user, viewerId),
      };
    }
    return item;
  });
}

/* --------------------------------- routes --------------------------------- */

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => {
        keys.push(k);
        return '/([^/]+)';
      }) +
      '/?$'
  );
  routes.push({ method, re, keys, handler });
}

/* ------------------------------- auth routes ------------------------------- */

route('POST', '/api/auth/register', async (ctx) => {
  const { email, password, username, permalink } = ctx.body;
  if (!email || !emailRe.test(String(email))) throw new HttpError(400, 'Enter a valid email address');
  if (!password || String(password).length < 8)
    throw new HttpError(400, 'Password must be at least 8 characters');
  if (!username || String(username).trim().length < 2)
    throw new HttpError(400, 'Choose a display name (2+ characters)');
  if (store.getUserByEmail(email)) throw new HttpError(409, 'An account with that email already exists');

  const desired = String(permalink || username).toLowerCase();
  if (permalink && !permalinkRe.test(desired))
    throw new HttpError(400, 'Profile URL can use letters, numbers, dashes and underscores');
  const slug = uniquePermalink(desired);

  const res = db
    .prepare(
      `INSERT INTO users (permalink, username, email, password_hash, created_at, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(slug, String(username).trim().slice(0, 60), String(email).trim(), hashPassword(String(password)), now(), null);

  const user = store.getUserById(res.lastInsertRowid);
  const token = createSession(user.id, ctx.req.headers['user-agent'], clientIp(ctx.req));
  setSessionCookie(ctx.res, token);
  return mePayload(user);
});

route('POST', '/api/auth/login', async (ctx) => {
  const { email, password, code } = ctx.body;
  const user = store.getUserByEmail(email || '');
  if (!user || !verifyPassword(String(password || ''), user.password_hash))
    throw new HttpError(401, 'Incorrect email or password');

  if (user.totp_enabled) {
    if (!code) return { mfa_required: true };
    const ok = verifyTotp(user.totp_secret, code) || consumeBackupCode(user, code);
    if (!ok) throw new HttpError(401, 'That code is not valid', { mfa_required: true });
  }

  const token = createSession(user.id, ctx.req.headers['user-agent'], clientIp(ctx.req));
  setSessionCookie(ctx.res, token);
  return mePayload(store.getUserById(user.id));
});

route('POST', '/api/auth/logout', async (ctx) => {
  destroySession(ctx.token);
  clearSessionCookie(ctx.res);
  return { ok: true };
});

route('GET', '/api/auth/me', async (ctx) => mePayload(ctx.user));

route('GET', '/api/auth/check-permalink', async (ctx) => {
  const value = String(ctx.query.get('value') || '').toLowerCase();
  if (!permalinkRe.test(value)) return { available: false, reason: 'invalid' };
  return { available: !store.getUserByPermalink(value) };
});

/* ------------------------------- totp routes ------------------------------- */

route('POST', '/api/auth/totp/setup', async (ctx) => {
  const user = requireUser(ctx);
  const secret = generateTotpSecret();
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, user.id);
  return { secret, uri: totpUri(secret, user.email) };
});

route('POST', '/api/auth/totp/enable', async (ctx) => {
  const user = requireUser(ctx);
  const fresh = store.getUserById(user.id);
  if (!fresh.totp_secret) throw new HttpError(400, 'Start setup first');
  if (!verifyTotp(fresh.totp_secret, ctx.body.code))
    throw new HttpError(400, 'That code did not match — check your authenticator clock');
  const codes = generateBackupCodes();
  const hashed = codes.map(hashBackupCode);
  db.prepare('UPDATE users SET totp_enabled = 1, backup_codes = ? WHERE id = ?').run(
    JSON.stringify(hashed),
    user.id
  );
  return { ok: true, backup_codes: codes };
});

route('POST', '/api/auth/totp/disable', async (ctx) => {
  const user = requireUser(ctx);
  if (!verifyPassword(String(ctx.body.password || ''), user.password_hash))
    throw new HttpError(401, 'Password is incorrect');
  db.prepare(
    'UPDATE users SET totp_enabled = 0, totp_secret = NULL, backup_codes = NULL WHERE id = ?'
  ).run(user.id);
  return { ok: true };
});

route('POST', '/api/auth/password', async (ctx) => {
  const user = requireUser(ctx);
  if (!verifyPassword(String(ctx.body.current || ''), user.password_hash))
    throw new HttpError(401, 'Current password is incorrect');
  const next = String(ctx.body.next || '');
  if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  return { ok: true };
});

/* ------------------------------ profile routes ----------------------------- */

route('PATCH', '/api/me/profile', async (ctx) => {
  const user = requireUser(ctx);
  const b = ctx.body;
  const fields = {
    username: b.username !== undefined ? String(b.username).trim().slice(0, 60) : user.username,
    bio: b.bio !== undefined ? String(b.bio).slice(0, 2000) : user.bio,
    city: b.city !== undefined ? String(b.city).slice(0, 80) : user.city,
    country_code: b.country_code !== undefined ? String(b.country_code).slice(0, 2).toUpperCase() : user.country_code,
    avatar_url: b.avatar_url !== undefined ? b.avatar_url || null : user.avatar_url,
    banner_url: b.banner_url !== undefined ? b.banner_url || null : user.banner_url,
  };
  if (!fields.username) throw new HttpError(400, 'Display name cannot be empty');
  db.prepare(
    'UPDATE users SET username = ?, bio = ?, city = ?, country_code = ?, avatar_url = ?, banner_url = ? WHERE id = ?'
  ).run(fields.username, fields.bio, fields.city, fields.country_code, fields.avatar_url, fields.banner_url, user.id);
  return mePayload(store.getUserById(user.id));
});

route('PATCH', '/api/me/settings', async (ctx) => {
  const user = requireUser(ctx);
  const b = ctx.body;
  const pick = (key, fallback) => (b[key] === undefined ? fallback : b[key]);
  const theme = ['dark', 'light', 'mocha'].includes(b.theme) ? b.theme : user.theme;
  const quality = ['hq', 'sq', 'lq'].includes(b.quality) ? b.quality : user.quality;
  db.prepare(
    `UPDATE users SET theme = ?, quality = ?, autoplay = ?, normalize = ?, private_likes = ?,
       show_reposts = ?, email_notifs = ?, seen_intro = ? WHERE id = ?`
  ).run(
    theme,
    quality,
    pick('autoplay', user.autoplay) ? 1 : 0,
    pick('normalize', user.normalize) ? 1 : 0,
    pick('private_likes', user.private_likes) ? 1 : 0,
    pick('show_reposts', user.show_reposts) ? 1 : 0,
    pick('email_notifs', user.email_notifs) ? 1 : 0,
    pick('seen_intro', user.seen_intro) ? 1 : 0,
    user.id
  );
  return mePayload(store.getUserById(user.id));
});

route('DELETE', '/api/me', async (ctx) => {
  const user = requireUser(ctx);
  if (!verifyPassword(String(ctx.body.password || ''), user.password_hash))
    throw new HttpError(401, 'Password is incorrect');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  destroySession(ctx.token);
  clearSessionCookie(ctx.res);
  return { ok: true };
});

route('GET', '/api/me/history', async (ctx) => {
  const user = requireUser(ctx);
  return { collection: store.history(user.id, 50).map((t) => decorateTrack(t, user.id)) };
});

route('GET', '/api/me/likes', async (ctx) => {
  const user = requireUser(ctx);
  return { collection: store.listLikes(user.id).map((t) => decorateTrack(t, user.id)) };
});

route('GET', '/api/me/reposts', async (ctx) => {
  const user = requireUser(ctx);
  return { collection: store.listReposts(user.id).map((t) => decorateTrack(t, user.id)) };
});

route('GET', '/api/me/playlists', async (ctx) => {
  const user = requireUser(ctx);
  return { collection: store.listPlaylistsOf(user.id, user.id) };
});

route('GET', '/api/me/following', async (ctx) => {
  const user = requireUser(ctx);
  return { collection: store.listFollowing(user.id) };
});

route('GET', '/api/me/notifications', async (ctx) => {
  const user = requireUser(ctx);
  return { collection: store.listNotifications(user.id) };
});

route('POST', '/api/me/notifications/read', async (ctx) => {
  const user = requireUser(ctx);
  store.markNotificationsRead(user.id);
  return { ok: true };
});

/* -------------------------------- search ---------------------------------- */

route('GET', '/api/search', async (ctx) => {
  const q = ctx.query.get('q') || '';
  const filter = ctx.query.get('filter') || 'all';
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 20));
  if (!q.trim() && !next) return { collection: [], next_href: null };
  const data = await sc.search({ q, filter, limit, next });
  return { ...data, collection: decorateItems(data.collection, ctx.user?.id) };
});

route('GET', '/api/search/suggest', async (ctx) => {
  const q = ctx.query.get('q') || '';
  return { collection: await sc.suggest(q) };
});

route('GET', '/api/next', async (ctx) => {
  const href = ctx.query.get('href');
  const data = await sc.proxyHref(href);
  return { ...data, collection: decorateItems(data.collection, ctx.user?.id) };
});

/* ---------------------------------- home ---------------------------------- */

route('GET', '/api/home', async (ctx) => {
  const sections = await sc.home();
  const out = sections.map((s) => ({
    ...s,
    items: decorateItems(s.items, ctx.user?.id),
  }));
  if (ctx.user) {
    const feed = store.localFeed(ctx.user.id);
    if (feed.length) {
      out.unshift({
        id: 'following',
        title: 'From people you follow',
        subtitle: 'Fresh activity from your Wavefront network',
        items: feed,
        kind: 'feed',
      });
    }
  }
  return { sections: out };
});

route('GET', '/api/genres', async () => ({ collection: await sc.genres() }));

route('GET', '/api/charts', async (ctx) => {
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 20));
  const data = await sc.charts({ limit, next });
  return { ...data, collection: decorateItems(data.collection, ctx.user?.id) };
});

route('GET', '/api/system-playlists/:id', async (ctx) => {
  const pl = await sc.systemPlaylist(ctx.params.id);
  return {
    ...pl,
    tracks: (pl.tracks || []).map((t) => decorateTrack(t, ctx.user?.id)),
  };
});

/* --------------------------------- tracks --------------------------------- */

route('GET', '/api/tracks/:id', async (ctx) => {
  const t = await sc.track(ctx.params.id);
  if (!t) throw new HttpError(404, 'Track not found');
  const user = ctx.user;
  const localLikes = store.trackLikes(t.id);
  return {
    ...decorateTrack(t, user?.id),
    liked_by: localLikes.map((id) => store.enrichLocalUser(store.getUserById(id), user?.id)),
  };
});

route('GET', '/api/tracks/:id/stream', async (ctx) => {
  const quality = ctx.query.get('quality') || ctx.user?.quality || 'hq';
  const info = await sc.streamUrl(ctx.params.id, quality);
  if (ctx.user) {
    try {
      const t = await sc.track(ctx.params.id);
      store.recordPlay(ctx.user.id, t);
    } catch {}
  }
  return info;
});

route('GET', '/api/tracks/:id/waveform', async (ctx) => {
  const url = ctx.query.get('url');
  return (await sc.waveform(url)) || { samples: [] };
});

route('GET', '/api/tracks/:id/comments', async (ctx) => {
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 30));
  let remote = { collection: [], next_href: null };
  try {
    remote = await sc.comments(ctx.params.id, { limit, next });
  } catch {}
  if (next) return remote;
  const local = store.listLocalComments(ctx.params.id);
  return { ...remote, collection: [...local, ...remote.collection] };
});

route('POST', '/api/tracks/:id/comments', async (ctx) => {
  const user = requireUser(ctx);
  const body = String(ctx.body.body || '').trim();
  if (!body) throw new HttpError(400, 'Comment cannot be empty');
  if (body.length > 1000) throw new HttpError(400, 'Comment is too long');
  const track = await sc.track(ctx.params.id).catch(() => null);
  const comment = store.addComment(ctx.params.id, user.id, body, ctx.body.timestamp_ms, track);
  return { comment };
});

route('DELETE', '/api/comments/:id', async (ctx) => {
  const user = requireUser(ctx);
  const id = String(ctx.params.id);
  if (id.startsWith('local:')) {
    const ok = store.deleteComment(id.slice(6), user.id);
    if (!ok) throw new HttpError(403, 'You can only delete your own comments');
    return { ok: true };
  }
  throw new HttpError(403, 'Comments from SoundCloud cannot be deleted here');
});

route('GET', '/api/tracks/:id/related', async (ctx) => {
  const items = await sc.related(ctx.params.id, { limit: Number(ctx.query.get('limit') || 12) });
  return { collection: decorateItems(items, ctx.user?.id) };
});

route('GET', '/api/tracks/:id/reposters', async (ctx) => {
  const remote = await sc.reposters(ctx.params.id, { limit: 12 }).catch(() => []);
  const localRows = db
    .prepare('SELECT user_id FROM reposts WHERE track_id = ?')
    .all(Number(ctx.params.id));
  const local = localRows
    .map((r) => store.enrichLocalUser(store.getUserById(r.user_id), ctx.user?.id))
    .filter(Boolean);
  return { collection: [...local, ...remote.map((u) => store.enrichRemoteUser(u, ctx.user?.id))] };
});

route('POST', '/api/tracks/:id/like', async (ctx) => {
  const user = requireUser(ctx);
  const track = ctx.body.track || (await sc.track(ctx.params.id));
  if (!track) throw new HttpError(404, 'Track not found');
  return store.toggleLike(user.id, track);
});

route('POST', '/api/tracks/:id/repost', async (ctx) => {
  const user = requireUser(ctx);
  const track = ctx.body.track || (await sc.track(ctx.params.id));
  if (!track) throw new HttpError(404, 'Track not found');
  return store.toggleRepost(user.id, track);
});

/* --------------------------------- users ---------------------------------- */

route('GET', '/api/users/:id', async (ctx) => {
  const id = String(ctx.params.id);
  if (id.startsWith('local:')) {
    const local = store.getUserById(id.slice(6));
    if (!local) throw new HttpError(404, 'User not found');
    return store.enrichLocalUser(local, ctx.user?.id);
  }
  const user = await sc.user(id);
  if (!user) throw new HttpError(404, 'User not found');
  return store.enrichRemoteUser(user, ctx.user?.id);
});

route('GET', '/api/users/:id/tab', async (ctx) => {
  const id = String(ctx.params.id);
  const tab = ctx.query.get('tab') || 'tracks';
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 24));

  if (id.startsWith('local:')) {
    const localId = Number(id.slice(6));
    const local = store.getUserById(localId);
    if (!local) throw new HttpError(404, 'User not found');
    if (tab === 'tracks') {
      return { collection: [], next_href: null, empty_reason: 'Local profiles do not host uploaded tracks' };
    }
    if (tab === 'likes') {
      if (local.private_likes && ctx.user?.id !== localId)
        return { collection: [], next_href: null, empty_reason: 'This user keeps their likes private' };
      return { collection: store.listLikes(localId).map((t) => decorateTrack(t, ctx.user?.id)), next_href: null };
    }
    if (tab === 'reposts') {
      return { collection: store.listReposts(localId).map((t) => decorateTrack(t, ctx.user?.id)), next_href: null };
    }
    if (tab === 'playlists') {
      return { collection: store.listPlaylistsOf(localId, ctx.user?.id), next_href: null };
    }
    if (tab === 'followers') {
      return { collection: store.listFollowers(localId), next_href: null };
    }
    if (tab === 'followings') {
      return { collection: store.listFollowing(localId), next_href: null };
    }
    return { collection: [], next_href: null };
  }

  const data = await sc.userTab(id, tab, { limit, next });
  return { ...data, collection: decorateItems(data.collection, ctx.user?.id) };
});

route('GET', '/api/users/:id/activity', async (ctx) => {
  const id = String(ctx.params.id);
  const next = ctx.query.get('next');
  if (id.startsWith('local:')) {
    const localId = Number(id.slice(6));
    const feed = store.localFeed(localId);
    return { collection: feed, next_href: null };
  }
  const data = await sc.activity(id, { limit: 20, next });
  return {
    ...data,
    collection: data.collection.map((item) => ({
      ...item,
      user: store.enrichRemoteUser(item.user, ctx.user?.id),
      track: item.track ? decorateTrack(item.track, ctx.user?.id) : null,
    })),
  };
});

route('POST', '/api/users/:id/follow', async (ctx) => {
  const user = requireUser(ctx);
  const id = String(ctx.params.id);
  if (id.startsWith('local:')) {
    const targetId = Number(id.slice(6));
    if (targetId === user.id) throw new HttpError(400, 'You cannot follow yourself');
    const target = store.getUserById(targetId);
    if (!target) throw new HttpError(404, 'User not found');
    const result = store.toggleFollow(user.id, 'local-user', targetId, publicUser(target));
    return {
      ...result,
      followers_count: store.count(
        "SELECT COUNT(*) FROM follows WHERE target_type = 'local-user' AND target_id = ?",
        String(targetId)
      ),
    };
  }
  const target = await sc.user(id);
  if (!target) throw new HttpError(404, 'User not found');
  return store.toggleFollow(user.id, 'sc-user', id, target);
});

route('GET', '/api/resolve', async (ctx) => {
  const url = ctx.query.get('url');
  if (!url) throw new HttpError(400, 'Missing url');
  let normalized = String(url).trim();
  if (normalized.startsWith('/u/')) {
    const local = store.getUserByPermalink(normalized.slice(3));
    if (local) return store.enrichLocalUser(local, ctx.user?.id);
    throw new HttpError(404, 'User not found');
  }
  if (!/^https?:\/\//.test(normalized)) normalized = 'https://soundcloud.com/' + normalized.replace(/^\/+/, '');
  const data = await sc.resolve(normalized);
  if (!data) throw new HttpError(404, 'Nothing found at that URL');
  if (data.kind === 'track') return decorateTrack(data, ctx.user?.id);
  if (data.kind === 'user') return store.enrichRemoteUser(data, ctx.user?.id);
  return data;
});

/* -------------------------------- playlists -------------------------------- */

route('GET', '/api/playlists/:id', async (ctx) => {
  const id = String(ctx.params.id);
  if (id.startsWith('local-playlist:')) {
    const row = store.getPlaylistRow(Number(id.split(':')[1]));
    if (!row) throw new HttpError(404, 'Playlist not found');
    if (row.is_private && ctx.user?.id !== row.user_id) throw new HttpError(403, 'This playlist is private');
    const pl = store.hydratePlaylist(row, ctx.user?.id);
    return { ...pl, tracks: pl.tracks.map((t) => decorateTrack(t, ctx.user?.id)) };
  }
  if (id.startsWith('sc-playlist:')) {
    const pl = await sc.playlist(Number(id.split(':')[1]));
    if (!pl) throw new HttpError(404, 'Playlist not found');
    return { ...pl, tracks: (pl.tracks || []).map((t) => decorateTrack(t, ctx.user?.id)) };
  }
  const pl = await sc.playlist(id);
  if (!pl) throw new HttpError(404, 'Playlist not found');
  return { ...pl, tracks: (pl.tracks || []).map((t) => decorateTrack(t, ctx.user?.id)) };
});

route('POST', '/api/playlists', async (ctx) => {
  const user = requireUser(ctx);
  const row = store.createPlaylist(user.id, ctx.body || {});
  return store.hydratePlaylist(row, user.id);
});

route('PATCH', '/api/playlists/:id', async (ctx) => {
  const user = requireUser(ctx);
  const localId = Number(String(ctx.params.id).replace(/^local-playlist:/, ''));
  const row = store.updatePlaylist(localId, user.id, ctx.body || {});
  if (!row) throw new HttpError(404, 'Playlist not found');
  return store.hydratePlaylist(row, user.id);
});

route('DELETE', '/api/playlists/:id', async (ctx) => {
  const user = requireUser(ctx);
  const localId = Number(String(ctx.params.id).replace(/^local-playlist:/, ''));
  if (!store.deletePlaylist(localId, user.id)) throw new HttpError(404, 'Playlist not found');
  return { ok: true };
});

route('POST', '/api/playlists/:id/tracks', async (ctx) => {
  const user = requireUser(ctx);
  const localId = Number(String(ctx.params.id).replace(/^local-playlist:/, ''));
  const row = store.getPlaylistRow(localId);
  if (!row || row.user_id !== user.id) throw new HttpError(404, 'Playlist not found');
  const track = ctx.body.track || (ctx.body.track_id ? await sc.track(ctx.body.track_id) : null);
  if (!track) throw new HttpError(400, 'Missing track');
  store.addTrackToPlaylist(localId, track);
  return store.hydratePlaylist(store.getPlaylistRow(localId), user.id);
});

route('DELETE', '/api/playlists/:id/tracks/:trackId', async (ctx) => {
  const user = requireUser(ctx);
  const localId = Number(String(ctx.params.id).replace(/^local-playlist:/, ''));
  const row = store.getPlaylistRow(localId);
  if (!row || row.user_id !== user.id) throw new HttpError(404, 'Playlist not found');
  store.removeTrackFromPlaylist(localId, ctx.params.trackId);
  return store.hydratePlaylist(store.getPlaylistRow(localId), user.id);
});

route('POST', '/api/playlists/:id/reorder', async (ctx) => {
  const user = requireUser(ctx);
  const localId = Number(String(ctx.params.id).replace(/^local-playlist:/, ''));
  const row = store.getPlaylistRow(localId);
  if (!row || row.user_id !== user.id) throw new HttpError(404, 'Playlist not found');
  store.reorderPlaylist(localId, ctx.body.order || []);
  return store.hydratePlaylist(store.getPlaylistRow(localId), user.id);
});

/* --------------------------------- static --------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, urlPath) {
  let baseDir = path.join(ROOT, 'dist');
  if (DEV) baseDir = path.join(ROOT, 'web');

  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  const full = path.join(baseDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(baseDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const tryFile = (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? p : null);

  let file = tryFile(full);
  if (!file && DEV && rel !== '/index.html') {
    const idx = tryFile(path.join(ROOT, 'index.html'));
    if (idx) {
      const html = fs.readFileSync(idx, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
  }
  if (!file) {
    const spa = tryFile(path.join(baseDir, 'index.html'));
    if (spa) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(spa));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  fs.createReadStream(file).pipe(res);
}

/* -------------------------------- dispatcher ------------------------------- */

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const cookies = parseCookies(req);
  const token = cookies[COOKIE] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = getSessionUser(token);

  const ctx = {
    req,
    res,
    user,
    token,
    query: url.searchParams,
    params: {},
    body: {},
  };

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        ctx.body = await readBody(req);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, 'Could not read request body');
      }
    }
    const out = await r.handler(ctx);
    if (out === undefined) return json(res, 204, {});
    return json(res, 200, out);
  }

  throw new HttpError(404, 'Unknown API route');
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  Promise.resolve()
    .then(() => handle(req, res))
    .catch((err) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.message, ...(err.extra || {}) });
        return;
      }
      if (err instanceof sc.ScError) {
        const status = err.status === 404 ? 404 : err.status === 403 ? 403 : 502;
        json(res, status, { error: err.message || 'SoundCloud request failed' });
        return;
      }
      console.error('[error]', req.method, req.url, err);
      json(res, 500, { error: 'Something went wrong on our side' });
    })
    .finally(() => {
      if (process.env.LOG_REQUESTS) {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    });
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 1000 * 60 * 60).unref();

server.listen(PORT, HOST, () => {
  console.log(`Wavefront listening on http://${HOST}:${PORT}${DEV ? ' (dev)' : ''}`);
});
