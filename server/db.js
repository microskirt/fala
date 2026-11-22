import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'wavefront.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  permalink     TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  banner_url    TEXT,
  bio           TEXT DEFAULT '',
  city          TEXT DEFAULT '',
  country_code  TEXT DEFAULT '',
  created_at    TEXT NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  backup_codes  TEXT,
  theme         TEXT NOT NULL DEFAULT 'dark',
  quality       TEXT NOT NULL DEFAULT 'hq',
  autoplay      INTEGER NOT NULL DEFAULT 1,
  normalize     INTEGER NOT NULL DEFAULT 0,
  private_likes INTEGER NOT NULL DEFAULT 0,
  show_reposts  INTEGER NOT NULL DEFAULT 1,
  email_notifs  INTEGER NOT NULL DEFAULT 1,
  seen_intro    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip         TEXT
);

CREATE TABLE IF NOT EXISTS likes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   INTEGER NOT NULL,
  track_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS reposts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   INTEGER NOT NULL,
  track_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS follows (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  target_json TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  artwork_url TEXT,
  is_private  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL,
  track_json  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  added_at    TEXT NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id     INTEGER NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  timestamp_ms INTEGER,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   INTEGER NOT NULL,
  track_json TEXT NOT NULL,
  played_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,
  actor_id  INTEGER,
  actor_json TEXT,
  subject_json TEXT,
  created_at TEXT NOT NULL,
  read      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_likes_track ON likes(track_id);
CREATE INDEX IF NOT EXISTS idx_comments_track ON comments(track_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id, played_at);
CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, created_at);
`);

export const now = () => new Date().toISOString();

export function publicUser(u) {
  if (!u) return null;
  return {
    id: 'local:' + u.id,
    local_id: u.id,
    kind: 'user',
    local: true,
    username: u.username,
    permalink: u.permalink,
    permalink_url: '/u/' + u.permalink,
    avatar_url: u.avatar_url,
    banner_url: u.banner_url,
    description: u.bio || '',
    city: u.city || '',
    country_code: u.country_code || '',
    created_at: u.created_at,
    urn: 'local:users:' + u.id,
    verified: false,
    badges: { pro: false, verified: false },
  };
}
