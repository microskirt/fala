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
 * Wavefront is a stateless SoundCloud front-end.
 *
 * There are no Wavefront accounts. The browser holds the user's real
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
  if (!token) return { likes: new Set(), reposts: new Set(), follows: new Set(), me: null };
  const [likes, reposts, follows, me] = await Promise.all([
    sc.likeIds(token),
    sc.repostIds(token),
    sc.followIds(token),
    sc.me(token).catch(() => null),
  ]);
  return { likes, reposts, follows, me };
}

function decorateTrack(track, flags) {
  if (!track) return null;
  return {
    ...track,
    liked: flags?.likes ? flags.likes.has(String(track.id)) : !!track.liked,
    reposted: flags?.reposts ? flags.reposts.has(String(track.id)) : !!track.reposted,
  };
}

function decorateUser(user, flags) {
  if (!user) return null;
  return {
    ...user,
    is_following: flags?.follows ? flags.follows.has(String(user.id)) : !!user.is_following,
  };
}

function decorateItems(items, flags) {
  return (items || []).map((item) => {
    if (!item) return item;
    if (item.kind === 'track') return decorateTrack(item, flags);
    if (item.kind === 'user') return decorateUser(item, flags);
    if (item.kind === 'playlist') {
      return {
        ...item,
        tracks: item.tracks ? item.tracks.map((t) => decorateTrack(t, flags)) : item.tracks,
        user: item.user ? decorateUser(item.user, flags) : item.user,
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

/* -------------------------------- library --------------------------------- */

route('GET', '/api/me/likes', async (ctx) => {
  const token = requireToken(ctx);
  const data = await sc.myLikes(token, {
    limit: Math.min(50, Number(ctx.query.get('limit') || 50)),
    next: ctx.query.get('next'),
  });
  const flags = await flagsFor(token);
  return { ...data, collection: data.collection.map((t) => decorateTrack(t, flags)) };
});

route('GET', '/api/me/reposts', async (ctx) => {
  const token = requireToken(ctx);
  const data = await sc.myReposts(token, {
    limit: Math.min(50, Number(ctx.query.get('limit') || 50)),
    next: ctx.query.get('next'),
  });
  return data;
});

route('GET', '/api/me/playlists', async (ctx) => {
  const token = requireToken(ctx);
  return sc.myPlaylists(token, {
    limit: Math.min(50, Number(ctx.query.get('limit') || 50)),
    next: ctx.query.get('next'),
  });
});

route('GET', '/api/me/following', async (ctx) => {
  const token = requireToken(ctx);
  const data = await sc.myFollowing(token, {
    limit: Math.min(50, Number(ctx.query.get('limit') || 50)),
    next: ctx.query.get('next'),
  });
  const flags = await flagsFor(token);
  return { ...data, collection: data.collection.map((u) => decorateUser(u, flags)) };
});

route('GET', '/api/me/history', async (ctx) => {
  const token = requireToken(ctx);
  return sc.myHistory(token, { limit: Math.min(50, Number(ctx.query.get('limit') || 50)) });
});

route('GET', '/api/me/stream', async (ctx) => {
  const token = requireToken(ctx);
  return sc.myStream(token, { limit: Math.min(50, Number(ctx.query.get('limit') || 20)) });
});

/* -------------------------------- search ---------------------------------- */

route('GET', '/api/search', async (ctx) => {
  const q = ctx.query.get('q') || '';
  const filter = ctx.query.get('filter') || 'all';
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 20));
  if (!q.trim() && !next) return { collection: [], next_href: null };
  const data = await sc.search({ q, filter, limit, next });
  const flags = await flagsFor(ctx.token);
  return { ...data, collection: decorateItems(data.collection, flags) };
});

route('GET', '/api/search/suggest', async (ctx) => {
  const q = ctx.query.get('q') || '';
  return { collection: await sc.suggest(q) };
});

route('GET', '/api/next', async (ctx) => {
  const href = ctx.query.get('href');
  const data = await sc.proxyHref(href);
  const flags = await flagsFor(ctx.token);
  return { ...data, collection: decorateItems(data.collection, flags) };
});

/* ---------------------------------- home ---------------------------------- */

route('GET', '/api/home', async (ctx) => {
  const sections = await sc.home();
  const flags = await flagsFor(ctx.token);
  return {
    sections: sections.map((s) => ({ ...s, items: decorateItems(s.items, flags) })),
  };
});

route('GET', '/api/genres', async () => ({ collection: await sc.genres() }));

route('GET', '/api/charts', async (ctx) => {
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 20));
  const data = await sc.charts({ limit, next });
  const flags = await flagsFor(ctx.token);
  return { ...data, collection: decorateItems(data.collection, flags) };
});

route('GET', '/api/system-playlists/:id', async (ctx) => {
  const pl = await sc.systemPlaylist(ctx.params.id);
  const flags = await flagsFor(ctx.token);
  return { ...pl, tracks: (pl.tracks || []).map((t) => decorateTrack(t, flags)) };
});

/* --------------------------------- tracks --------------------------------- */

route('GET', '/api/tracks/:id', async (ctx) => {
  const t = await sc.track(ctx.params.id, { token: ctx.token || null });
  if (!t) throw new HttpError(404, 'Track not found');
  const flags = await flagsFor(ctx.token);
  return decorateTrack(t, flags);
});

route('GET', '/api/tracks/:id/stream', async (ctx) => {
  const quality = ctx.query.get('quality') || 'hq';
  return sc.streamUrl(ctx.params.id, quality);
});

route('GET', '/api/tracks/:id/waveform', async (ctx) => {
  const url = ctx.query.get('url');
  return (await sc.waveform(url)) || { samples: [] };
});

route('GET', '/api/tracks/:id/comments', async (ctx) => {
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 30));
  return sc.comments(ctx.params.id, { limit, next });
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
  const items = await sc.related(ctx.params.id, { limit: Number(ctx.query.get('limit') || 12) });
  const flags = await flagsFor(ctx.token);
  return { collection: decorateItems(items, flags) };
});

route('GET', '/api/tracks/:id/reposters', async (ctx) => {
  const remote = await sc.reposters(ctx.params.id, { limit: 12 }).catch(() => []);
  const flags = await flagsFor(ctx.token);
  return { collection: remote.map((u) => decorateUser(u, flags)) };
});

route('PUT', '/api/tracks/:id/like', async (ctx) => {
  const token = requireToken(ctx);
  return sc.like(token, ctx.params.id, !!ctx.body.on);
});

route('PUT', '/api/tracks/:id/repost', async (ctx) => {
  const token = requireToken(ctx);
  return sc.repost(token, ctx.params.id, !!ctx.body.on);
});

/* --------------------------------- users ---------------------------------- */

route('GET', '/api/users/:id', async (ctx) => {
  const user = await sc.user(ctx.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  const flags = await flagsFor(ctx.token);
  return decorateUser(user, flags);
});

route('GET', '/api/users/:id/tab', async (ctx) => {
  const tab = ctx.query.get('tab') || 'tracks';
  const next = ctx.query.get('next');
  const limit = Math.min(50, Number(ctx.query.get('limit') || 24));
  const data = await sc.userTab(ctx.params.id, tab, { limit, next, token: ctx.token || null });
  const flags = await flagsFor(ctx.token);
  return { ...data, collection: decorateItems(data.collection, flags) };
});

route('GET', '/api/users/:id/activity', async (ctx) => {
  const next = ctx.query.get('next');
  const data = await sc.activity(ctx.params.id, { limit: 20, next, token: ctx.token || null });
  const flags = await flagsFor(ctx.token);
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
  const data = await sc.resolve(normalized);
  if (!data) throw new HttpError(404, 'Nothing found at that URL');
  const flags = await flagsFor(ctx.token);
  if (data.kind === 'track') return decorateTrack(data, flags);
  if (data.kind === 'user') return decorateUser(data, flags);
  return data;
});

/* -------------------------------- playlists -------------------------------- */

route('GET', '/api/playlists/:id', async (ctx) => {
  let id = ctx.params.id;
  if (id.startsWith('system:')) {
    const pl = await sc.systemPlaylist(decodeURIComponent(id.slice(7)));
    const flags = await flagsFor(ctx.token);
    return { ...pl, tracks: (pl.tracks || []).map((t) => decorateTrack(t, flags)) };
  }
  if (id.startsWith('sc-playlist:')) id = id.slice('sc-playlist:'.length);
  const pl = await sc.playlist(id, { token: ctx.token || null });
  if (!pl) throw new HttpError(404, 'Playlist not found');
  const flags = await flagsFor(ctx.token);
  return { ...pl, tracks: (pl.tracks || []).map((t) => decorateTrack(t, flags)) };
});

route('POST', '/api/playlists', async (ctx) => {
  const token = requireToken(ctx);
  const title = String(ctx.body.title || '').trim();
  if (!title) throw new HttpError(400, 'Give your playlist a title');
  return sc.createPlaylist(token, {
    title,
    description: ctx.body.description,
    is_private: !!ctx.body.is_private,
  });
});

route('PATCH', '/api/playlists/:id', async (ctx) => {
  const token = requireToken(ctx);
  return sc.updatePlaylist(token, ctx.params.id, ctx.body || {});
});

route('DELETE', '/api/playlists/:id', async (ctx) => {
  const token = requireToken(ctx);
  return sc.deletePlaylist(token, ctx.params.id);
});

route('POST', '/api/playlists/:id/tracks', async (ctx) => {
  const token = requireToken(ctx);
  const trackId = ctx.body.track_id ?? ctx.body.track?.id;
  if (!trackId) throw new HttpError(400, 'Missing track');
  return sc.addTrackToPlaylist(token, ctx.params.id, trackId);
});

route('DELETE', '/api/playlists/:id/tracks/:trackId', async (ctx) => {
  const token = requireToken(ctx);
  return sc.removeTrackFromPlaylist(token, ctx.params.id, ctx.params.trackId);
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
        const status = [401, 403, 404, 429].includes(err.status) ? err.status : 502;
        json(res, status, {
          error: err.message || 'SoundCloud request failed',
          ...(err.code ? { code: err.code } : {}),
        });
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

server.listen(PORT, HOST, () => {
  console.log(`Wavefront listening on http://${HOST}:${PORT}${DEV ? ' (dev)' : ''}`);
});
