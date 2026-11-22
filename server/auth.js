import crypto from 'node:crypto';
import { db, now } from './db.js';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

/* ---------------- password hashing (scrypt) ---------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (test.length !== expected.length) return false;
  return crypto.timingSafeEqual(test, expected);
}

/* ---------------- TOTP (RFC 6238) ---------------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

export function verifyTotp(secret, token, window = 1) {
  if (!secret || !/^\d{6}$/.test(String(token || '').trim())) return false;
  const counter = Math.floor(Date.now() / 30000);
  const supplied = String(token).trim();
  for (let i = -window; i <= window; i++) {
    const expected = totpCode(secret, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return true;
  }
  return false;
}

export function totpUri(secret, account, issuer = 'Wavefront') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ---------------- backup codes ---------------- */

export function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
  }
  return codes;
}

export function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code).replace(/[\s-]/g, '').toUpperCase()).digest('hex');
}

export function consumeBackupCode(user, code) {
  if (!user.backup_codes) return false;
  const list = JSON.parse(user.backup_codes || '[]');
  const h = hashBackupCode(code);
  const idx = list.indexOf(h);
  if (idx === -1) return false;
  list.splice(idx, 1);
  db.prepare('UPDATE users SET backup_codes = ? WHERE id = ?').run(JSON.stringify(list), user.id);
  return true;
}

/* ---------------- sessions ---------------- */

export function createSession(userId, userAgent = '', ip = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const t = Date.now();
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, userId, t, t + SESSION_TTL, String(userAgent).slice(0, 300), String(ip).slice(0, 100));
  return token;
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) || null;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

/* ---------------- misc ---------------- */

export function uniquePermalink(base) {
  let slug = String(base || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'user';
  let candidate = slug;
  let n = 1;
  while (db.prepare('SELECT 1 FROM users WHERE permalink = ?').get(candidate)) {
    candidate = `${slug}-${n++}`;
  }
  return candidate;
}

export { now };
