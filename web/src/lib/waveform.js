/*
 * The waveform is drawn on a canvas, and two places draw one: the song page's
 * player and the small bars on an artist's song rows. The shape, the geometry
 * and the two-tone paint live here so the two never drift into different
 * silhouettes.
 */

/*
 * How much of the box the loudest bar may fill. The samples reach the top of the
 * range on a mastered track, so mapping the peak straight onto the box makes
 * every bar touch the edge: the waveform becomes a solid slab with no air around
 * it, and it also grows taller than it used to be. Holding the peak a little
 * under three quarters keeps the margin the bars had before and gives the shape
 * its depth instead of a wall of full-height bars.
 */
const PEAK_FILL = 0.72;

/*
 * Turns SoundCloud's sample amplitudes into bar heights between 0 and 1.
 *
 * The samples are not on a 0-255 scale. SoundCloud scales every track so its
 * loudest moment equals the picture's own `height`, which is 140 on every track
 * sampled, so dividing by 255 leaves a mastered song reaching only 55% of the
 * range. Dividing by the array's own peak instead puts the loudest moment at the
 * top of the scale and lets the quiet passages fall away, which is how
 * SoundCloud's own player reads.
 *
 * A gentle curve above 1 pushes the quiet passages down a little further. A
 * straight reading still comes out flatter than SoundCloud's bars, whose dips
 * drop well below the body of the wave. The floor keeps a near-silent bar
 * visible rather than letting it vanish.
 */
export function shapeSamples(samples) {
  let peak = 0;
  for (const s of samples) if (s > peak) peak = s;
  if (peak <= 0) peak = 1;
  return samples.map((s) => {
    const v = Math.pow(Math.min(1, Math.max(0, s) / peak), 1.1);
    return Math.min(PEAK_FILL, Math.max(0.04, v * PEAK_FILL));
  });
}

/*
 * Reads the current colour of a CSS variable so the canvas follows the theme
 * instead of hard coding one palette. A canvas cannot use Tailwind classes.
 */
export function themeColor(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/*
 * Darkens a colour by a factor. SoundCloud draws each bar in two tones: a lit
 * upper half and a shaded lower half, so one flat fill per bar is not enough.
 * The canvas cannot use color-mix, so the darker tone is computed here.
 */
export function shade(color, factor) {
  const s = String(color).trim();
  let r;
  let g;
  let b;
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return s;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    [r, g, b] = parts;
  }
  if (![r, g, b].every(Number.isFinite)) return s;
  const f = Math.max(0, Math.min(1, factor));
  const to = (v) => Math.round(Math.max(0, Math.min(255, v * f)));
  return `rgb(${to(r)} ${to(g)} ${to(b)})`;
}

/*
 * Comments that carry a moment in the song become markers over the bars.
 * Several people can comment on the same second, so they share one marker and
 * the card names them together rather than stacking faces on one spot. Both the
 * song page and the small waveform on a list use this, so a comment sits on the
 * same spot in either one.
 */
export function buildCommentMarkers(comments, total) {
  if (!total) return [];
  const bySecond = new Map();
  for (const c of comments || []) {
    if (c.timestamp_ms == null) continue;
    const timeMs = Math.max(0, Math.min(total, c.timestamp_ms));
    const key = Math.round(timeMs / 1000);
    if (!bySecond.has(key)) {
      bySecond.set(key, {
        key,
        // `timeMs` is the rounded second for the label; `atMs` is the real
        // moment the face is drawn on, which is where the card should open.
        timeMs: key * 1000,
        atMs: timeMs,
        ratio: timeMs / total,
        user: c.user,
        body: c.body,
        count: 0,
      });
    }
    bySecond.get(key).count += 1;
  }
  return [...bySecond.values()].sort((a, b) => a.timeMs - b.timeMs);
}

/*
 * The marker the playhead is on, or about to reach. A comment is shown for
 * three seconds, starting half a second before the playhead reaches its moment,
 * so the face and its card read as the same event instead of the card arriving
 * after the line has passed.
 */
export function markerAtTime(markers, time, { lead = 500, hold = 3000 } = {}) {
  if (!markers || !markers.length) return null;
  let best = null;
  for (const m of markers) {
    const at = m.atMs ?? m.timeMs;
    const delta = time - at;
    if (delta >= -lead && delta <= hold) {
      if (!best || at > (best.atMs ?? best.timeMs)) best = m;
    }
  }
  return best;
}

/*
 * Bar geometry for a box of a given width: 2px bars with a 1px gap, like the
 * reference. The bars stop short of the right edge by `gutter`, which is the
 * flat strip the song page keeps for its two clocks; a small waveform passes
 * nothing and runs the full width.
 */
export function barGeometry(width, { bar = 2, gap = 1, gutter = 0 } = {}) {
  const barWidth = Math.max(0, width - gutter);
  const barCount = barWidth > 0 ? Math.max(1, Math.floor((barWidth + gap) / (bar + gap))) : 0;
  const step = barCount > 0 ? (barWidth + gap) / barCount : 0;
  const barFraction = width > 0 ? barWidth / width : 1;
  return { bar, gap, barWidth, barCount, step, barFraction };
}

/*
 * Paints one colour layer of bars into a canvas, sized for the device pixel
 * ratio so the bars stay crisp on a retina screen. The song page calls this
 * twice, once in the resting colour and once in the played colour, and clips
 * the second layer to the playhead. The small waveform calls it once.
 */
export function paintBars(canvas, { norm, width, height, geometry, color, minBar = 2 }) {
  if (!canvas || !width || !norm || !norm.length) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { bar, barCount, step } = geometry;
  const maxBar = height - 2;
  const mid = Math.round(height / 2);
  /*
   * Each bar is two tones around the centre line: the half above the axis
   * catches the light, the half below sits in shadow. That is what gives
   * SoundCloud's waveform its depth, and it reads even at bar heights of only a
   * few pixels.
   */
  const lit = color;
  const shaded = shade(color, 0.55);
  for (let i = 0; i < barCount; i += 1) {
    /*
     * A bar stands for a slice of the song, so its height is the average of that
     * slice rather than the loudest sample in it. Taking the loudest value pulls
     * every bar that contains a kick up to the ceiling, which is what turned the
     * waveform into a flat slab. The average keeps a loud stretch tall and a
     * quiet one short, the way SoundCloud's bars step down through a break.
     */
    const from = Math.floor((i * norm.length) / barCount);
    const to = Math.max(from + 1, Math.floor(((i + 1) * norm.length) / barCount));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += norm[j];
    const v = sum / (to - from);
    const bh = Math.max(minBar, Math.round(minBar + v * (maxBar - minBar)));
    const x = Math.round(i * step);
    const top = Math.round(mid - bh / 2);
    const bottom = Math.round(mid + bh / 2);
    ctx.fillStyle = lit;
    ctx.fillRect(x, top, bar, Math.max(1, mid - top));
    ctx.fillStyle = shaded;
    ctx.fillRect(x, mid, bar, Math.max(1, bottom - mid));
  }
}
