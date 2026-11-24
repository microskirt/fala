import { useEffect, useState } from 'react';
import { artwork } from '@/api.js';

/*
 * SoundCloud's track, playlist and profile payloads carry no colour field. The
 * only thing close is `visuals`, which is the video visualiser and is null for
 * almost every upload. The band behind the top card is therefore sampled from
 * the artwork in the browser, and sndcdn sends `access-control-allow-origin: *`
 * on its images so a canvas can read the pixels.
 *
 * The sample is taken from a tiny copy of the cover, cached by URL, and mixed
 * toward the page background so the band stays a tint instead of a slab that
 * swallows the text in whichever theme is active.
 */
const cache = new Map();

/*
 * Some covers live on a host that sends no CORS header, so the canvas is
 * tainted and the pixels cannot be read. The system playlist covers are that
 * case, which is why those cards had no band. Asking our own server for the
 * bytes puts the image on this origin, where the canvas can read it.
 */
function proxied(url) {
  return `/api/artwork?url=${encodeURIComponent(url)}`;
}

function sample(url) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const N = 24;
        const canvas = document.createElement('canvas');
        canvas.width = N;
        canvas.height = N;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, N, N);
        const { data } = ctx.getImageData(0, 0, N, N);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          // A transparent pixel says nothing about the cover.
          if (data[i + 3] < 128) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (!n) return resolve(null);
        resolve([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
      } catch {
        // A cover without CORS headers taints the canvas and cannot be read.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/*
 * Read the cover directly when the host allows it, and only fall back to the
 * server copy when that fails. Most covers are on a host that already sends
 * the CORS header, so the common path stays one request.
 */
async function averageColor(url) {
  const direct = await sample(url);
  if (direct) return direct;
  return sample(proxied(url));
}

/*
 * The band colour for one cover. The raw average is pulled most of the way to
 * the page background, which keeps light covers from turning the card into a
 * grey box in the dark theme and dark covers from vanishing in the light one.
 */
export function useArtworkColor(src) {
  const url = src ? artwork(src, 't200x200') : null;
  const [rgb, setRgb] = useState(() => (url && cache.has(url) ? cache.get(url) : null));

  useEffect(() => {
    if (!url) {
      setRgb(null);
      return undefined;
    }
    if (cache.has(url)) {
      setRgb(cache.get(url));
      return undefined;
    }
    let live = true;
    averageColor(url).then((value) => {
      cache.set(url, value);
      if (live) setRgb(value);
    });
    return () => {
      live = false;
    };
  }, [url]);

  return rgb;
}
