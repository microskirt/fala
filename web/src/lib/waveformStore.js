import { api } from '@/api.js';
import { normalizeSamples } from '@/lib/waveform.js';

/*
 * A song's shape, shared by every view that draws it.
 *
 * A waveform never changes once the song is uploaded, yet the song page and the
 * small rows each kept their own copy and their own request. Opening a song from
 * a list therefore downloaded a shape the list already had, and the page only
 * asked after its own track request had landed, so the bars appeared a beat or
 * three after the rest of the page.
 *
 * The cache is keyed by the song's id, because that is the only handle the song
 * page has before its track payload arrives, and it also remembers which url
 * belongs to which id so a list row holding only the url finds it again. The
 * pending map makes the page's early ask and a row's later one share a single
 * request instead of racing.
 */
const byId = new Map();
const urlToId = new Map();
const pending = new Map();

function cap(map, max) {
  if (map.size > max) map.delete(map.keys().next().value);
}

export function peekWaveformSamples(track) {
  const id = track?.id;
  if (id && byId.has(String(id))) return byId.get(String(id));
  const url = track?.waveform_url || '';
  if (url && urlToId.has(url)) return byId.get(urlToId.get(url)) || null;
  return null;
}

export function loadWaveformSamples(track) {
  const id = track?.id;
  if (!id) return Promise.resolve([]);
  const key = String(id);
  const url = track?.waveform_url || '';

  const known = peekWaveformSamples(track);
  if (known) {
    // A row that knows its url teaches the cache the pairing, so the same song
    // found later by url alone still lands on this entry.
    if (url && !urlToId.has(url)) urlToId.set(url, key);
    return Promise.resolve(known);
  }
  if (pending.has(key)) return pending.get(key);

  /*
   * The server sends SoundCloud's own payload: every sample as an integer on the
   * picture's height scale. It is divided down to 0-1 here, once, so everything
   * downstream keeps working on normalised values and the cache never holds two
   * different scales.
   */
  const ask = () =>
    api
      .get(`/api/tracks/${id}/waveform${url ? `?url=${encodeURIComponent(url)}` : ''}`)
      .then((res) => normalizeSamples(res))
      .catch(() => []);

  const request = ask()
    /*
     * A url carried over from a feed can be stale, and SoundCloud answers a dead
     * one with nothing. Asking once more is only worth it when a url was given:
     * an id-only request already falls back to the song's current url on the
     * server, so a second identical ask would only repeat the same miss.
     */
    .then((samples) => (samples.length || !url ? samples : ask()))
    .then((samples) => {
      if (samples.length) {
        byId.set(key, samples);
        if (url) urlToId.set(url, key);
        cap(byId, 400);
        cap(urlToId, 400);
      }
      return samples;
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}
