import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sc from './sc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';

/*
 * Fala is a stateless SoundCloud front-end.
 *
 * There are no Fala accounts. The browser holds the user's real
 * SoundCloud OAuth token and sends it with every request. This server forwards
 * it to SoundCloud and keeps nothing on disk. Nothing here is a user database.
 */

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

/*
 * SoundCloud pages its lists, so `limit` is only a page size: how many rows to
 * fetch in one go. There is no reason to clamp it to 50, that just hides the
 * rest of a library behind extra round trips. The ceiling only exists to stop
 * a caller asking for something absurd.
 */
const MAX_PAGE = 500;

function pageLimit(query, fallback) {
  const raw = Number(query.get('limit'));
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  return Math.min(MAX_PAGE, n);
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

function readToken(req) {
  const header = String(req.headers['x-sc-token'] || '').trim();
  if (header) return header;
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^OAuth\s+(.+)$/i) || auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function requireToken(ctx) {
  if (!ctx.token) throw new HttpError(401, 'Connect your SoundCloud account first');
  return ctx.token;
}

/* --------------------------- viewer-scoped flags --------------------------- */

// Liked / reposted / followed flags. SoundCloud does not return them inline, so
// they are looked up per token (cached briefly in sc.js).
async function flagsFor(token) {
  if (!token) {
    return {
      likes: new Set(),
      reposts: new Set(),
      follows: new Set(),
      playlistLikes: new Set(),
      me: null,
    };
  }
  const [likes, reposts, follows, playlistLikes, me] = await Promise.all([
    sc.likeIds(token),
    sc.repostIds(token),
    sc.followIds(token),
    sc.playlistLikeIds(token),
    sc.me(token).catch(() => null),
  ]);
  return { likes, reposts, follows, playlistLikes, me };
}

function decorateTrack(track, flags) {
  if (!track) return null;
  return {
    ...track,
    liked: flags?.likes ? flags.likes.has(String(track.id)) : !!track.liked,
    reposted: flags?.reposts ? flags.reposts.has(String(track.id)) : !!track.reposted,
    /*
     * The artist of a track carries the follow state too. Without this the
     * follow button in the player bar had nothing to read and always offered
     * to follow, even for someone already followed.
     */
    user: track.user ? decorateUser(track.user, flags) : track.user,
  };
}

function decorateUser(user, flags) {
  if (!user) return null;
  return {
    ...user,
    is_following: flags?.follows ? flags.follows.has(String(user.id)) : !!user.is_following,
  };
}

function decoratePlaylist(playlist, flags) {
  if (!playlist) return null;
  return {
    ...playlist,
    liked: flags?.playlistLikes
      ? flags.playlistLikes.has(String(playlist.id))
      : !!playlist.liked,
    tracks: playlist.tracks
      ? playlist.tracks.map((t) => decorateTrack(t, flags))
      : playlist.tracks,
    user: playlist.user ? decorateUser(playlist.user, flags) : playlist.user,
  };
}

function decorateItems(items, flags) {
  return (items || []).map((item) => {
    if (!item) return item;
    if (item.kind === 'track') return decorateTrack(item, flags);
    if (item.kind === 'user') return decorateUser(item, flags);
    if (item.kind === 'playlist') return decoratePlaylist(item, flags);
    return item;
  });
}

/* --------------------------------- routes --------------------------------- */

const routes = [];
function route(method, pattern, handler, { bodyLimit } = {}) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => {
        keys.push(k);
        return '/([^/]+)';
      }) +
      '/?$'
  );
  routes.push({ method, re, keys, handler, bodyLimit });
}

/* -------------------------------- session --------------------------------- */

route('GET', '/api/session', async (ctx) => {
  if (!ctx.token) return { account: null };
  try {
    const me = await sc.me(ctx.token);
    return { account: sc.slimUser(me) };
  } catch (err) {
    if (err instanceof sc.ScError && err.status === 401) return { account: null };
    throw err;
  }
});

/* -------------------------------- captcha --------------------------------- */

/*
 * DataDome (SoundCloud's bot check) sits in front of write actions. The browser
 * can solve the challenge, but it is this server that talks to api-v2, so the
 * resulting `datadome` cookie has to end up here. These routes move it across.
 */

route('GET', '/api/captcha', async (ctx) => {
  const token = requireToken(ctx);
  const challenge = await sc.captchaChallenge(token);
  return {
    blocked: challenge.blocked,
    url: challenge.url,
    solved: !!sc.getDdCookie(token),
    clientId: sc.getClientId(),
  };
});

route('POST', '/api/captcha', async (ctx) => {
  const token = requireToken(ctx);
  const raw = String(ctx.body.cookie || '').trim();
  if (!raw) throw new HttpError(400, 'Paste the datadome cookie value first');
  // Accept a full "datadome=...; Path=..." line as well as the bare value.
  const value = raw
    .replace(/^datadome=/i, '')
    .split(';')[0]
    .trim();
  if (!value) throw new HttpError(400, 'That does not look like a datadome cookie');
  // DataDome ties the verdict to the UA that solved it, so keep the browser's.
  const ua = String(ctx.body.ua || '').slice(0, 400).trim();
  sc.setDdCookie(token, value, ua || null);
  return { solved: true };
});

route('DELETE', '/api/captcha', async (ctx) => {
  const token = requireToken(ctx);
  sc.setDdCookie(token, null, null);
  return { solved: false };
});

/* -------------------------------- library --------------------------------- */

route('GET', '/api/me/likes', async (ctx) => {
  const token = requireToken(ctx);
  /*
   * The list and the flags that decorate it are independent, so they are asked
   * for together. Awaiting them one after the other put a whole upstream round
   * trip on every page load for no reason; reads are shared now, so the two
   * cannot duplicate work.
   */
  const [data, flags] = await Promise.all([
    sc.myLikes(token, {
      limit: pageLimit(ctx.query, 50),
      next: ctx.query.get('next'),
    }),
    flagsFor(token),
  ]);
  return { ...data, collection: data.collection.map((t) => decorateTrack(t, flags)) };
});

route('GET', '/api/me/reposts', async (ctx) => {
  const token = requireToken(ctx);
  const [data, flags] = await Promise.all([
    sc.myReposts(token, {
      limit: pageLimit(ctx.query, 50),
      next: ctx.query.get('next'),
    }),
    flagsFor(token),
  ]);
  return { ...data, collection: data.collection.map((t) => decorateTrack(t, flags)) };
});

route('GET', '/api/me/counts', async (ctx) => {
  const token = requireToken(ctx);
  return sc.myCounts(token);
});

route('GET', '/api/me/playlists', async (ctx) => {
  const token = requireToken(ctx);
  return sc.myPlaylists(token, {
    limit: pageLimit(ctx.query, 50),
    next: ctx.query.get('next'),
  });
});

route('GET', '/api/me/following', async (ctx) => {
  const token = requireToken(ctx);
  const [data, flags] = await Promise.all([
    sc.myFollowing(token, {
      limit: pageLimit(ctx.query, 50),
      next: ctx.query.get('next'),
    }),
    flagsFor(token),
  ]);
  return { ...data, collection: data.collection.map((u) => decorateUser(u, flags)) };
});

route('GET', '/api/me/history', async (ctx) => {
  const token = requireToken(ctx);
  const [data, flags] = await Promise.all([
    sc.myHistory(token, { limit: pageLimit(ctx.query, 50) }),
    flagsFor(token),
  ]);
  return { ...data, collection: data.collection.map((t) => decorateTrack(t, flags)) };
});

route('GET', '/api/me/stream', async (ctx) => {
  const token = requireToken(ctx);
  return sc.myStream(token, { limit: pageLimit(ctx.query, 20) });
});

/*
 * The Sorted view: the same events as the stream, grouped by the person who
 * posted or reposted them, and only for the last few days. The window is a
 * preference, so it arrives as a query value and is clamped to the three the
 * settings offer rather than trusting an arbitrary number.
 */
route('GET', '/api/me/stream/sorted', async (ctx) => {
  const token = requireToken(ctx);
  const asked = Number(ctx.query.get('days'));
  const days = [5, 7, 10].includes(asked) ? asked : 7;
  return sc.sortedActivity(token, { days });
});

route('GET', '/api/me/notifications', async (ctx) => {
  const token = requireToken(ctx);
  const [data, flags] = await Promise.all([
    sc.notifications(token, {
      limit: pageLimit(ctx.query, 50),
      next: ctx.query.get('next'),
    }),
    flagsFor(token),
  ]);
  return {
    ...data,
    collection: data.collection.map((n) => ({
      ...n,
      track: n.track ? decorateTrack(n.track, flags) : null,
    })),
  };
});

route('GET', '/api/me/conversations', async (ctx) => {
  const token = requireToken(ctx);
  return sc.conversations(token, {
    limit: pageLimit(ctx.query, 50),
    next: ctx.query.get('next'),
  });
});

route('GET', '/api/me/conversations/:id/messages', async (ctx) => {
  const token = requireToken(ctx);
  return sc.conversationMessages(token, ctx.params.id, {
    limit: pageLimit(ctx.query, 100),
    next: ctx.query.get('next'),
  });
});

route('POST', '/api/me/conversations', async (ctx) => {
  const token = requireToken(ctx);
  const recipientId = ctx.body.recipient_id;
  const body = String(ctx.body.body || '').trim();
  if (!recipientId) throw new HttpError(400, 'Pick someone to message');
  if (!body) throw new HttpError(400, 'Write a message first');
  return { conversation: await sc.startConversation(token, recipientId, body) };
});

route('POST', '/api/me/conversations/:id/messages', async (ctx) => {
  const token = requireToken(ctx);
  const body = String(ctx.body.body || '').trim();
  if (!body) throw new HttpError(400, 'Write a message first');
  return { message: await sc.sendMessage(token, ctx.params.id, body) };
});

/* -------------------------------- search ---------------------------------- */

route('GET', '/api/search', async (ctx) => {
  const q = ctx.query.get('q') || '';
  const filter = ctx.query.get('filter') || 'all';
  const next = ctx.query.get('next');
  const limit = pageLimit(ctx.query, 20);
  if (!q.trim() && !next) return { collection: [], next_href: null };
  const [data, flags] = await Promise.all([
    sc.search({ q, filter, limit, next }),
    flagsFor(ctx.token),
  ]);
  return { ...data, collection: decorateItems(data.collection, flags) };
});

/*
 * Matches in the caller's own library, which SoundCloud prints above the
 * generic results. Only answers when a token is present, because the lists are
 * the caller's; a signed out visit simply gets nothing extra.
 */
route('GET', '/api/search/mine', async (ctx) => {
  const q = ctx.query.get('q') || '';
  if (!ctx.token || !q.trim()) return { people: [], tracks: [], playlists: [] };
  /*
   * The flags are independent of the matches, so both start together. Awaiting
   * them one after the other added a full round of requests to every keystroke.
   */
  const [data, flags] = await Promise.all([
    sc.searchMine(ctx.token, q),
    flagsFor(ctx.token),
  ]);
  return {
    people: (data.people || []).map((u) => decorateUser(u, flags)),
    tracks: data.tracks.map((t) => decorateTrack(t, flags)),
    playlists: data.playlists.map((p) => decoratePlaylist(p, flags)),
  };
});

route('GET', '/api/search/suggest', async (ctx) => {
  const q = ctx.query.get('q') || '';
  return { collection: await sc.suggest(q) };
});

route('GET', '/api/next', async (ctx) => {
  const href = ctx.query.get('href');
  const [data, flags] = await Promise.all([sc.proxyHref(href), flagsFor(ctx.token)]);
  return { ...data, collection: decorateItems(data.collection, flags) };
});

/* ---------------------------------- home ---------------------------------- */

route('GET', '/api/home', async (ctx) => {
  // mixed-selections is personalised only when the token is present.
  const [sections, flags] = await Promise.all([
    sc.home({ token: ctx.token || null }),
    flagsFor(ctx.token),
  ]);
  return {
    sections: sections.map((s) => ({ ...s, items: decorateItems(s.items, flags) })),
  };
});

route('GET', '/api/genres', async () => ({ collection: await sc.genres() }));

route('GET', '/api/charts', async (ctx) => {
  const next = ctx.query.get('next');
  const limit = pageLimit(ctx.query, 20);
  const [data, flags] = await Promise.all([sc.charts({ limit, next }), flagsFor(ctx.token)]);
  return { ...data, collection: decorateItems(data.collection, flags) };
});

route('GET', '/api/system-playlists/:id', async (ctx) => {
  const [pl, flags] = await Promise.all([
    sc.systemPlaylist(ctx.params.id, { token: ctx.token || null }),
    flagsFor(ctx.token),
  ]);
  return { ...pl, tracks: (pl.tracks || []).map((t) => decorateTrack(t, flags)) };
});

/* --------------------------------- tracks --------------------------------- */

route('GET', '/api/tracks/:id', async (ctx) => {
  const [t, flags] = await Promise.all([
    sc.track(ctx.params.id, { token: ctx.token || null }),
    flagsFor(ctx.token),
  ]);
  if (!t) throw new HttpError(404, 'Track not found');
  return decorateTrack(t, flags);
});

route('GET', '/api/tracks/:id/stream', async (ctx) => {
  const quality = ctx.query.get('quality') || 'hq';
  // The token decides which transcodings exist. Without it SoundCloud never
  // offers the Go+ 256 kbps preset, so pass it through.
  return sc.streamUrl(ctx.params.id, quality, { token: ctx.token || null });
});

route('GET', '/api/tracks/:id/waveform', async (ctx) => {
  const url = ctx.query.get('url');
  // The id lets the server retry with the song's current url when the one the
  // list kept has gone stale, which is what left some bars empty for good.
  return (await sc.waveform(url, ctx.params.id)) || { samples: [] };
});

route('GET', '/api/tracks/:id/comments', async (ctx) => {
  const next = ctx.query.get('next');
  const limit = pageLimit(ctx.query, 30);
  // Signed in, the richer GraphQL list is used: it carries like counts, the
  // author's heart and the first page of replies. Signed out, api-v2 is the only
  // source, and it has none of that.
  if (ctx.token) {
    try {
      const out = await sc.commentThread(ctx.token, ctx.params.id, {
        first: limit,
        after: ctx.query.get('after'),
      });
      return { ...out, next_href: null };
    } catch (err) {
      if (err?.code === 'captcha' || err?.status === 401) throw err;
      // Fall back to the plain list rather than leaving the page empty.
    }
  }
  const out = await sc.comments(ctx.params.id, { limit, next });
  return { ...out, next_cursor: null };
});

route('GET', '/api/tracks/:id/comments/:commentId/replies', async (ctx) => {
  const token = requireToken(ctx);
  return sc.commentReplies(token, ctx.params.id, ctx.params.commentId, {
    first: pageLimit(ctx.query, 20),
    after: ctx.query.get('after'),
  });
});

route('PUT', '/api/tracks/:id/comments/:commentId/like', async (ctx) => {
  const token = requireToken(ctx);
  return sc.likeComment(token, ctx.params.id, ctx.params.commentId, !!ctx.body.on);
});

route('GET', '/api/tracks/:id/listeners', async (ctx) => {
  const token = requireToken(ctx);
  return sc.topListeners(token, ctx.params.id, {
    window: ctx.query.get('window') || 'DAYS_30',
    limit: pageLimit(ctx.query, 5),
  });
});

route('POST', '/api/tracks/:id/comments', async (ctx) => {
  const token = requireToken(ctx);
  const body = String(ctx.body.body || '').trim();
  if (!body) throw new HttpError(400, 'Comment cannot be empty');
  if (body.length > 1000) throw new HttpError(400, 'Comment is too long');
  const comment = await sc.comment(token, ctx.params.id, body, ctx.body.timestamp_ms);
  return { comment };
});

route('DELETE', '/api/comments/:id', async (ctx) => {
  const token = requireToken(ctx);
  return sc.deleteComment(token, ctx.params.id);
});

route('GET', '/api/tracks/:id/related', async (ctx) => {
  const [items, flags] = await Promise.all([
    sc.related(ctx.params.id, { limit: Number(ctx.query.get('limit') || 12) }),
    flagsFor(ctx.token),
  ]);
  return { collection: decorateItems(items, flags) };
});

route('GET', '/api/tracks/:id/reposters', async (ctx) => {
  const [data, flags] = await Promise.all([
    sc.reposters(ctx.params.id, {
      limit: pageLimit(ctx.query, 50),
      next: ctx.query.get('next'),
    }),
    flagsFor(ctx.token),
  ]);
  return { ...data, collection: data.collection.map((u) => decorateUser(u, flags)) };
});

route('GET', '/api/tracks/:id/likers', async (ctx) => {
  const [data, flags] = await Promise.all([
    sc.likers(ctx.params.id, {
      limit: pageLimit(ctx.query, 50),
      next: ctx.query.get('next'),
    }),
    flagsFor(ctx.token),
  ]);
  return { ...data, collection: data.collection.map((u) => decorateUser(u, flags)) };
});

route('GET', '/api/tracks/:id/playlists', async (ctx) => {
  return sc.trackPlaylists(ctx.params.id, {
    limit: pageLimit(ctx.query, 50),
    next: ctx.query.get('next'),
  });
});

route('GET', '/api/tracks/:id/albums', async (ctx) => {
  return sc.trackAlbums(ctx.params.id, {
    limit: pageLimit(ctx.query, 50),
    next: ctx.query.get('next'),
  });
});

// Both counts in one call, since the song page shows them side by side.
route('GET', '/api/tracks/:id/collection-counts', async (ctx) => {
  const [playlists, albums] = await Promise.all([
    sc.trackCollectionCount(ctx.params.id, 'playlists').catch(() => ({ total: 0, complete: true })),
    sc.trackCollectionCount(ctx.params.id, 'albums').catch(() => ({ total: 0, complete: true })),
  ]);
  return { playlists, albums };
});

route('GET', '/api/tracks/:id/also-liked', async (ctx) => {
  const token = requireToken(ctx);
  const [data, flags] = await Promise.all([sc.alsoLiked(token, ctx.params.id), flagsFor(token)]);
  return { ...data, collection: data.collection.map((u) => decorateUser(u, flags)) };
});

route('PUT', '/api/tracks/:id/like', async (ctx) => {
  const token = requireToken(ctx);
  return sc.like(token, ctx.params.id, !!ctx.body.on);
});

route('PUT', '/api/tracks/:id/repost', async (ctx) => {
  const token = requireToken(ctx);
  return sc.repost(token, ctx.params.id, !!ctx.body.on, ctx.body.caption);
});

/* --------------------------------- users ---------------------------------- */

route('GET', '/api/users/:id', async (ctx) => {
  /*
   * The profile links come from a second endpoint, so they are fetched beside
   * the user rather than after it. A failure there is not a reason to fail the
   * whole profile: the page renders without the links.
   */
  const [user, links, flags] = await Promise.all([
    sc.user(ctx.params.id),
    sc.webProfiles(ctx.params.id),
    flagsFor(ctx.token),
  ]);
  if (!user) throw new HttpError(404, 'User not found');
  /*
   * api-v2 blanks `created_at` on every public user payload, so an artist's
   * join date is not readable by anyone. The caller's own /me does carry it,
   * so the one profile that can show a real date is the signed in account's
   * own. Everyone else simply has none, which the page leaves out.
   */
  const ownJoin =
    flags.me && String(flags.me.id) === String(user.id) ? flags.me.created_at : null;
  return {
    ...decorateUser(user, flags),
    web_profiles: links,
    created_at: user.created_at || ownJoin || null,
  };
});

route('GET', '/api/users/:id/tab', async (ctx) => {
  const tab = ctx.query.get('tab') || 'tracks';
  const next = ctx.query.get('next');
  const limit = pageLimit(ctx.query, 24);
  /*
   * The first page also carries the tab's real total, so the page can say how
   * much the artist has rather than how much of it is loaded. Later pages skip
   * it: the number does not change while scrolling.
   */
  const [data, total, flags] = await Promise.all([
    sc.userTab(ctx.params.id, tab, { limit, next, token: ctx.token || null }),
    next ? null : sc.userTabTotal(ctx.params.id, tab).catch(() => null),
    flagsFor(ctx.token),
  ]);
  return { ...data, total, collection: decorateItems(data.collection, flags) };
});

route('GET', '/api/users/:id/activity', async (ctx) => {
  const next = ctx.query.get('next');
  const [data, flags] = await Promise.all([
    sc.activity(ctx.params.id, { limit: 20, next, token: ctx.token || null }),
    flagsFor(ctx.token),
  ]);
  return {
    ...data,
    collection: data.collection.map((item) => ({
      ...item,
      user: decorateUser(item.user, flags),
      track: item.track ? decorateTrack(item.track, flags) : null,
    })),
  };
});

route('PUT', '/api/users/:id/follow', async (ctx) => {
  const token = requireToken(ctx);
  return sc.follow(token, ctx.params.id, !!ctx.body.on);
});

route('GET', '/api/resolve', async (ctx) => {
  const url = ctx.query.get('url');
  if (!url) throw new HttpError(400, 'Missing url');
  let normalized = String(url).trim();
  if (!/^https?:\/\//.test(normalized)) normalized = 'https://soundcloud.com/' + normalized.replace(/^\/+/, '');
  /*
   * Resolving a slug is the first thing a page does, so its latency is the whole
   * wait before anything renders. The lookup and the flags are independent and
   * now go out together: this endpoint is the one the HAR shows at 8.8s.
   */
  const [data, flags] = await Promise.all([sc.resolve(normalized), flagsFor(ctx.token)]);
  if (!data) throw new HttpError(404, 'Nothing found at that URL');
  if (data.kind === 'track') return decorateTrack(data, flags);
  if (data.kind === 'user') return decorateUser(data, flags);
  return data;
});

/* -------------------------------- playlists -------------------------------- */

route('GET', '/api/playlists/:id', async (ctx) => {
  let id = ctx.params.id;
  if (id.startsWith('system:')) {
    const [pl, flags] = await Promise.all([
      sc.systemPlaylist(decodeURIComponent(id.slice(7)), { token: ctx.token || null }),
      flagsFor(ctx.token),
    ]);
    return { ...pl, tracks: (pl.tracks || []).map((t) => decorateTrack(t, flags)) };
  }
  if (id.startsWith('sc-playlist:')) id = id.slice('sc-playlist:'.length);
  const [pl, flags] = await Promise.all([
    sc.playlist(id, { token: ctx.token || null }),
    flagsFor(ctx.token),
  ]);
  if (!pl) throw new HttpError(404, 'Playlist not found');
  return decoratePlaylist(pl, flags);
});

route('PUT', '/api/playlists/:id/like', async (ctx) => {
  const token = requireToken(ctx);
  return sc.likePlaylist(token, ctx.params.id, !!ctx.body.on);
});

// Who liked the playlist, for the counter on the playlist page.
route('GET', '/api/playlists/:id/likers', async (ctx) => {
  let id = ctx.params.id;
  if (id.startsWith('sc-playlist:')) id = id.slice('sc-playlist:'.length);
  const [data, flags] = await Promise.all([
    sc.playlistLikers(id, {
      limit: pageLimit(ctx.query, 50),
      next: ctx.query.get('next'),
    }),
    flagsFor(ctx.token),
  ]);
  return { ...data, collection: data.collection.map((u) => decorateUser(u, flags)) };
});

// A cover arrives as a data URI, so these two allow a larger body than the
// megabyte the rest of the API works within.
const ARTWORK_BODY_LIMIT = 8_000_000;

route(
  'POST',
  '/api/playlists',
  async (ctx) => {
    const token = requireToken(ctx);
    const title = String(ctx.body.title || '').trim();
    if (!title) throw new HttpError(400, 'Give your playlist a title');
    return sc.createPlaylist(token, {
      title,
      description: ctx.body.description,
      is_private: !!ctx.body.is_private,
      artwork: ctx.body.artwork,
    });
  },
  { bodyLimit: ARTWORK_BODY_LIMIT }
);

route(
  'PATCH',
  '/api/playlists/:id',
  async (ctx) => {
    const token = requireToken(ctx);
    return sc.updatePlaylist(token, ctx.params.id, ctx.body || {});
  },
  { bodyLimit: ARTWORK_BODY_LIMIT }
);

route('DELETE', '/api/playlists/:id', async (ctx) => {
  const token = requireToken(ctx);
  return sc.deletePlaylist(token, ctx.params.id);
});

route('POST', '/api/playlists/:id/tracks', async (ctx) => {
  const token = requireToken(ctx);
  const trackId = ctx.body.track_id ?? ctx.body.track?.id;
  if (!trackId) throw new HttpError(400, 'Missing track');
  try {
    return await sc.addTrackToPlaylist(token, ctx.params.id, trackId);
  } catch (err) {
    // Playlist writes fail in ways that are hard to see from the UI, so keep the
    // shape of the failure in the log. The token never goes in there.
    console.error('[playlist] add failed', {
      playlist: ctx.params.id,
      track: trackId,
      status: err?.status,
      code: err?.code,
      message: err?.message,
    });
    throw err;
  }
});

route('DELETE', '/api/playlists/:id/tracks/:trackId', async (ctx) => {
  const token = requireToken(ctx);
  return sc.removeTrackFromPlaylist(token, ctx.params.id, ctx.params.trackId);
});

/* -------------------------------- artwork --------------------------------- */

/*
 * Some covers sit on a SoundCloud host that sends no `access-control-allow-
 * origin`, so a canvas cannot read their pixels and the tinted band behind a
 * card comes out empty. The system playlist covers (Daily Drops, Weekly Wave,
 * Your Mix) are exactly that case. Fetching the image here and handing it back
 * from our own origin makes the canvas readable. Only SoundCloud image hosts
 * are allowed through, so this never becomes an open proxy.
 */
const ARTWORK_HOST = /(^|\.)(sndcdn\.com|soundcloud\.cloud)$/i;
const ARTWORK_MAX = 4_000_000;

async function proxyArtwork(res, raw) {
  let target;
  try {
    target = new URL(String(raw || ''));
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad url');
    return;
  }
  if (target.protocol !== 'https:' || !ARTWORK_HOST.test(target.hostname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
    return;
  }
  let upstream;
  try {
    upstream = await fetch(target, {
      headers: { Accept: 'image/*', 'User-Agent': 'Fala/1.0' },
      redirect: 'follow',
    });
  } catch {
    res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Upstream failed');
    return;
  }
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !type.startsWith('image/')) {
    res.writeHead(upstream.ok ? 415 : upstream.status, { 'Content-Type': 'text/plain' }).end('No image');
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length > ARTWORK_MAX) {
    res.writeHead(413, { 'Content-Type': 'text/plain' }).end('Too large');
    return;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

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

  const file = tryFile(full);
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

  /*
   * Covers that cannot be read cross-origin come back through here. It answers
   * with image bytes rather than JSON, so it is handled before the route table.
   */
  if (pathname === '/api/artwork') {
    await proxyArtwork(res, url.searchParams.get('url'));
    return;
  }

  const ctx = {
    req,
    res,
    token: readToken(req),
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
        ctx.body = await readBody(req, r.bodyLimit || 1_000_000);
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
        const status = [401, 403, 404, 429].includes(err.status) ? err.status : 502;
        json(res, status, {
          error: err.message || 'SoundCloud request failed',
          ...(err.code ? { code: err.code } : {}),
        });
        return;
      }
      console.error('[error]', req.method, req.url, err);
      json(res, 500, { error: 'Something went wrong' });
    })
    .finally(() => {
      if (process.env.LOG_REQUESTS) {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    });
});

server.listen(PORT, HOST, () => {
  console.log(`Fala listening on http://${HOST}:${PORT}${DEV ? ' (dev)' : ''}`);
});
