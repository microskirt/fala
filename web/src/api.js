import { KEYS, readKey, writeKey } from '@/lib/storage.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/*
 * Fala has no accounts of its own. The user's SoundCloud OAuth token is kept
 * in this browser's localStorage and attached to every API call. The server
 * forwards it to SoundCloud and stores nothing.
 */

export function getToken() {
  return readKey(KEYS.token) || '';
}

export function setToken(token) {
  writeKey(KEYS.token, token || null);
}

async function request(path, { method = 'GET', body, headers, signal } = {}) {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? JSON_HEADERS : {}),
      ...(token ? { 'X-SC-Token': token } : {}),
      ...(headers || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body: body ?? {} }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body: body ?? {} }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body: body ?? {} }),
  del: (path, body, opts) => request(path, { ...opts, method: 'DELETE', body }),
};

export const qs = (params) => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
};

/* --------------------------------- formatting -------------------------------- */

export function formatCount(n) {
  const num = Number(n) || 0;
  if (num < 1000) return String(num);
  const trim = (v) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ''));
  if (num < 1_000_000) return `${trim(num / 1000)}K`;
  if (num < 1_000_000_000) return `${trim(num / 1_000_000)}M`;
  return `${trim(num / 1_000_000_000)}B`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatLongDuration(ms) {
  if (!ms) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function timeAgo(input) {
  if (!input) return '';
  const date = new Date(input);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return '';
  const sec = Math.round(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? '' : 's'} ago`;
  const yr = Math.round(mon / 12);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

export function formatDate(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function artwork(url, size = 't500x500') {
  if (!url) return null;
  return String(url).replace(/-large\.(jpg|png|jpeg|webp)$/i, `-${size}.$1`);
}

export function avatarUrl(url, size = 't120x120') {
  return artwork(url, size);
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function trackPath(track) {
  if (!track) return '#';
  return `/track/${track.id}`;
}

export function userPath(user) {
  if (!user) return '#';
  return `/artist/${user.id}`;
}
