import { db, now, publicUser } from './db.js';

const json = (v) => JSON.stringify(v);

/* ------------------------------- users ------------------------------- */

export const getUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
export const getUserByPermalink = (permalink) =>
  db.prepare('SELECT * FROM users WHERE permalink = ?').get(String(permalink));
export const getUserByEmail = (email) =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(String(email));

export function count(q, ...args) {
  const row = db.prepare(q).get(...args);
  return row ? Number(Object.values(row)[0]) : 0;
}

export function userStats(id) {
  return {
    likes_count: count('SELECT COUNT(*) FROM likes WHERE user_id = ?', id),
    reposts_count: count('SELECT COUNT(*) FROM reposts WHERE user_id = ?', id),
    playlist_count: count('SELECT COUNT(*) FROM playlists WHERE user_id = ? AND is_private = 0', id),
    followers_count: count(
      "SELECT COUNT(*) FROM follows WHERE target_type = 'local-user' AND target_id = ?",
      String(id)
    ),
    followings_count: count('SELECT COUNT(*) FROM follows WHERE user_id = ?', id),
    comments_count: count('SELECT COUNT(*) FROM comments WHERE user_id = ?', id),
  };
}

export function followState(viewerId, targetType, targetId) {
  if (!viewerId) return false;
  return !!db
    .prepare('SELECT 1 FROM follows WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .get(viewerId, targetType, String(targetId));
}

export function enrichLocalUser(u, viewerId) {
  if (!u) return null;
  const base = publicUser(u);
  const stats = userStats(u.id);
  return {
    ...base,
    ...stats,
    is_following: followState(viewerId, 'local-user', u.id),
    is_self: viewerId === u.id,
    totp_enabled: !!u.totp_enabled,
  };
}

export function enrichRemoteUser(u, viewerId) {
  if (!u) return null;
  return {
    ...u,
    is_following: followState(viewerId, 'sc-user', u.id),
  };
}

/* ------------------------------- likes ------------------------------- */

export function likeState(viewerId, trackId) {
  if (!viewerId) return false;
  return !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND track_id = ?').get(viewerId, trackId);
}

export function toggleLike(userId, track) {
  const existing = db
    .prepare('SELECT 1 FROM likes WHERE user_id = ? AND track_id = ?')
    .get(userId, track.id);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(userId, track.id);
    return { liked: false, likes_count: count('SELECT COUNT(*) FROM likes WHERE track_id = ?', track.id) };
  }
  db.prepare(
    'INSERT INTO likes (user_id, track_id, track_json, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, track.id, json(track), now());
  if (track.user?.local) notify(track.user.id, 'like', userId, track);
  return { liked: true, likes_count: count('SELECT COUNT(*) FROM likes WHERE track_id = ?', track.id) };
}

export function trackLikes(trackId) {
  return db
    .prepare('SELECT user_id FROM likes WHERE track_id = ? ORDER BY created_at DESC')
    .all(trackId)
    .map((r) => r.user_id);
}

/* ------------------------------ reposts ------------------------------ */

export function repostState(viewerId, trackId) {
  if (!viewerId) return false;
  return !!db
    .prepare('SELECT 1 FROM reposts WHERE user_id = ? AND track_id = ?')
    .get(viewerId, trackId);
}

export function toggleRepost(userId, track) {
  const existing = db
    .prepare('SELECT 1 FROM reposts WHERE user_id = ? AND track_id = ?')
    .get(userId, track.id);
  if (existing) {
    db.prepare('DELETE FROM reposts WHERE user_id = ? AND track_id = ?').run(userId, track.id);
    return { reposted: false };
  }
  db.prepare(
    'INSERT INTO reposts (user_id, track_id, track_json, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, track.id, json(track), now());
  notify(track.user?.id, 'repost', userId, track);
  return { reposted: true };
}

export function listLikes(userId) {
  return db
    .prepare('SELECT track_json, created_at FROM likes WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((r) => ({ ...JSON.parse(r.track_json), liked_at: r.created_at }));
}

export function listReposts(userId) {
  return db
    .prepare('SELECT track_json, created_at FROM reposts WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((r) => ({ ...JSON.parse(r.track_json), reposted_at: r.created_at }));
}

/* ------------------------------ follows ------------------------------ */

export function toggleFollow(userId, targetType, targetId, targetJson) {
  const existing = db
    .prepare('SELECT 1 FROM follows WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .get(userId, targetType, String(targetId));
  if (existing) {
    db.prepare('DELETE FROM follows WHERE user_id = ? AND target_type = ? AND target_id = ?').run(
      userId,
      targetType,
      String(targetId)
    );
    return { following: false };
  }
  db.prepare(
    'INSERT INTO follows (user_id, target_type, target_id, target_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, targetType, String(targetId), json(targetJson), now());
  if (targetType === 'local-user') notify(Number(targetId), 'follow', userId, null);
  return { following: true };
}

export function listFollowing(userId) {
  return db
    .prepare('SELECT * FROM follows WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((r) => ({
      target_type: r.target_type,
      target_id: r.target_id,
      created_at: r.created_at,
      user: JSON.parse(r.target_json),
    }));
}

export function listFollowers(userId) {
  return db
    .prepare(
      "SELECT user_id, created_at FROM follows WHERE target_type = 'local-user' AND target_id = ? ORDER BY created_at DESC"
    )
    .all(String(userId))
    .map((r) => ({ user: enrichLocalUser(getUserById(r.user_id), userId), created_at: r.created_at }));
}

/* ----------------------------- playlists ----------------------------- */

export function listPlaylistsOf(userId, viewerId) {
  const rows = db
    .prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
  return rows
    .filter((p) => !p.is_private || viewerId === userId)
    .map((p) => hydratePlaylist(p, viewerId));
}

export function getPlaylistRow(id) {
  return db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(id));
}

export function hydratePlaylist(p, viewerId) {
  if (!p) return null;
  const tracks = db
    .prepare('SELECT track_json, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position')
    .all(p.id)
    .map((r) => JSON.parse(r.track_json));
  const owner = getUserById(p.user_id);
  return {
    id: 'local-playlist:' + p.id,
    local_id: p.id,
    kind: 'playlist',
    local: true,
    title: p.title,
    description: p.description || '',
    artwork_url: p.artwork_url || tracks.find((t) => t.artwork_url)?.artwork_url || null,
    is_private: !!p.is_private,
    created_at: p.created_at,
    updated_at: p.updated_at,
    duration: tracks.reduce((a, t) => a + (t.duration || 0), 0),
    track_count: tracks.length,
    user: enrichLocalUser(owner, viewerId),
    tracks,
  };
}

export function createPlaylist(userId, { title, description, is_private }) {
  const t = now();
  const res = db
    .prepare(
      'INSERT INTO playlists (user_id, title, description, is_private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(userId, title || 'Untitled playlist', description || '', is_private ? 1 : 0, t, t);
  return getPlaylistRow(res.lastInsertRowid);
}

export function updatePlaylist(id, userId, fields) {
  const p = getPlaylistRow(id);
  if (!p || p.user_id !== userId) return null;
  const next = {
    title: fields.title ?? p.title,
    description: fields.description ?? p.description,
    artwork_url: fields.artwork_url ?? p.artwork_url,
    is_private: fields.is_private === undefined ? p.is_private : fields.is_private ? 1 : 0,
  };
  db.prepare(
    'UPDATE playlists SET title = ?, description = ?, artwork_url = ?, is_private = ?, updated_at = ? WHERE id = ?'
  ).run(next.title, next.description, next.artwork_url, next.is_private, now(), p.id);
  return getPlaylistRow(id);
}

export function deletePlaylist(id, userId) {
  const p = getPlaylistRow(id);
  if (!p || p.user_id !== userId) return false;
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  return true;
}

export function addTrackToPlaylist(playlistId, track) {
  const p = getPlaylistRow(playlistId);
  if (!p) return null;
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM playlist_tracks WHERE playlist_id = ?')
    .get(playlistId).m;
  db.prepare(
    'INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, track_json, position, added_at) VALUES (?, ?, ?, ?, ?)'
  ).run(playlistId, track.id, json(track), max + 1, now());
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), playlistId);
  return p;
}

export function removeTrackFromPlaylist(playlistId, trackId) {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(
    playlistId,
    Number(trackId)
  );
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), playlistId);
}

export function reorderPlaylist(playlistId, orderedTrackIds) {
  const stmt = db.prepare(
    'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?'
  );
  orderedTrackIds.forEach((id, idx) => stmt.run(idx, playlistId, Number(id)));
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), playlistId);
}

/* ------------------------------ comments ------------------------------ */

export function listLocalComments(trackId) {
  return db
    .prepare('SELECT * FROM comments WHERE track_id = ? ORDER BY created_at DESC')
    .all(Number(trackId))
    .map((c) => ({
      id: 'local:' + c.id,
      source: 'local',
      body: c.body,
      timestamp_ms: c.timestamp_ms,
      created_at: c.created_at,
      user: enrichLocalUser(getUserById(c.user_id), null),
    }));
}

export function addComment(trackId, userId, body, timestampMs, track) {
  const t = now();
  const res = db
    .prepare(
      'INSERT INTO comments (track_id, user_id, body, timestamp_ms, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(Number(trackId), userId, body, timestampMs ?? null, t);
  notify(track?.user?.id, 'comment', userId, track, body);
  return {
    id: 'local:' + res.lastInsertRowid,
    source: 'local',
    body,
    timestamp_ms: timestampMs ?? null,
    created_at: t,
    user: enrichLocalUser(getUserById(userId), userId),
  };
}

export function deleteComment(commentId, userId) {
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(commentId));
  if (!row) return false;
  if (row.user_id !== userId) return false;
  db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
  return true;
}

export function commentCounts(trackId) {
  return count('SELECT COUNT(*) FROM comments WHERE track_id = ?', Number(trackId));
}

/* ------------------------------- history ------------------------------- */

export function recordPlay(userId, track) {
  if (!userId) return;
  db.prepare('INSERT INTO plays (user_id, track_id, track_json, played_at) VALUES (?, ?, ?, ?)').run(
    userId,
    track.id,
    json(track),
    now()
  );
  db.prepare(
    'DELETE FROM plays WHERE user_id = ? AND id NOT IN (SELECT id FROM plays WHERE user_id = ? ORDER BY played_at DESC LIMIT 500)'
  ).run(userId, userId);
}

export function history(userId, limit = 40) {
  const rows = db
    .prepare('SELECT track_json, played_at FROM plays WHERE user_id = ? ORDER BY played_at DESC LIMIT ?')
    .all(userId, limit);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const t = JSON.parse(r.track_json);
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ ...t, played_at: r.played_at });
  }
  return out;
}

/* ---------------------------- notifications ---------------------------- */

export function notify(targetUserId, type, actorId, subject, extra) {
  if (!targetUserId || typeof targetUserId !== 'number') return;
  if (targetUserId === actorId) return;
  const actor = getUserById(actorId);
  if (!actor) return;
  // Only local accounts can receive notifications. SoundCloud user ids are not
  // rows in our users table, so skip them rather than trip the foreign key.
  const target = getUserById(targetUserId);
  if (!target) return;
  db.prepare(
    'INSERT INTO notifications (user_id, type, actor_id, actor_json, subject_json, created_at, read) VALUES (?, ?, ?, ?, ?, ?, 0)'
  ).run(
    targetUserId,
    type,
    actorId,
    json(publicUser(actor)),
    json({ track: subject || null, extra: extra || null }),
    now()
  );
}

export function listNotifications(userId) {
  return db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(userId)
    .map((n) => ({
      id: n.id,
      type: n.type,
      read: !!n.read,
      created_at: n.created_at,
      actor: JSON.parse(n.actor_json || 'null'),
      subject: JSON.parse(n.subject_json || 'null'),
    }));
}

export function markNotificationsRead(userId) {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
}

/* -------------------------------- feed -------------------------------- */

export function localFeed(userId) {
  const follows = db
    .prepare("SELECT target_id FROM follows WHERE user_id = ? AND target_type = 'local-user'")
    .all(userId)
    .map((r) => Number(r.target_id));
  if (!follows.length) return [];
  const marks = follows.map(() => '?').join(',');
  const items = [];
  const likes = db
    .prepare(`SELECT * FROM likes WHERE user_id IN (${marks}) ORDER BY created_at DESC LIMIT 40`)
    .all(...follows);
  for (const l of likes) {
    items.push({
      type: 'like',
      created_at: l.created_at,
      user: enrichLocalUser(getUserById(l.user_id), userId),
      track: JSON.parse(l.track_json),
    });
  }
  const reposts = db
    .prepare(`SELECT * FROM reposts WHERE user_id IN (${marks}) ORDER BY created_at DESC LIMIT 40`)
    .all(...follows);
  for (const r of reposts) {
    items.push({
      type: 'repost',
      created_at: r.created_at,
      user: enrichLocalUser(getUserById(r.user_id), userId),
      track: JSON.parse(r.track_json),
    });
  }
  const pls = db
    .prepare(
      `SELECT * FROM playlists WHERE user_id IN (${marks}) AND is_private = 0 ORDER BY created_at DESC LIMIT 20`
    )
    .all(...follows);
  for (const p of pls) {
    items.push({
      type: 'playlist',
      created_at: p.created_at,
      user: enrichLocalUser(getUserById(p.user_id), userId),
      playlist: hydratePlaylist(p, userId),
    });
  }
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return items.slice(0, 60);
}
