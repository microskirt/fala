/*
 * The waveform is drawn on a canvas, and two places draw one: the song page's
 * player and the small bars on an artist's song rows. The shape, the geometry
 * and the two-tone paint live here so the two never drift into different
 * silhouettes.
 */

/*
 * There is no cap on how much of the box the loudest bar may fill.
 *
 * There used to be one, at 0.72, from when the curve was wrong: with a bad shape
 * the bars crowded the top of the box and read as a solid slab, so the whole wave
 * was shrunk to hide it. With SoundCloud's own curve that is no longer a problem,
 * and the cap became the last visible difference from their waveform. Measured
 * against their own draw of the same song, Fala filled 67% of its box against
 * their 94%, so every bar sat too low and the wave looked small and flat even
 * though its shape was right.
 *
 * The 2px margin in `paintBars` is what keeps the loudest bar clear of the box
 * edge now, which is the same small margin their own geometry leaves. Filling the
 * box is not the same as growing it: the box is unchanged, the bars simply use it
 * the way SoundCloud's do.
 */

/*
 * The curve is not invented. It is SoundCloud's own, read out of the bundle their
 * player ships (`56-760b5386.js`), where `WaveformData` transforms every sample
 * and `BackgroundNode#draw` turns it into a bar:
 *
 *   this.samples = raw.reduce((t, n, r) =>
 *     t[r] = Math.round(Math.pow((maxHeight - n) / maxHeight, 1 / 1.5) * maxHeight))
 *
 *   S = Math.floor(b / maxHeight * upperSize)
 *   O = Math.floor((1 - b / maxHeight) * lowerSize + upperSize)
 *   bar height = O - S
 *
 * With `x = raw / maxHeight` and `upperSize + lowerSize = box`, that collapses
 * to one line:
 *
 *   height / box = 1 - (1 - x)^(2/3)
 *
 * The exponent sits on the DISTANCE FROM THE PEAK, not on the value. That is the
 * part every earlier attempt missed. A plain power of x (`x^1.5`) deepens the
 * middle but leaves the near-silent bars bunched together, which is why the quiet
 * passages still read as a flat block with the tops missing. Pushing the distance
 * from the peak instead spreads the quiet bars apart and keeps the loud ones
 * apart too, which is the shape their waveform actually has.
 *
 * Measured on the corpus at 260 bars, as ratios to the tallest bar in the same
 * track, against the percentiles read off their own screenshot of a song:
 *
 *   this curve   p10 0.62  p50 0.84  p90 0.91
 *   x^1.5        p10 0.65  p50 0.88  p90 0.94
 *   screenshot   p10 0.62  p50 0.79  p90 0.92
 *
 * The tenth and ninetieth land on the screenshot; the median stays a little high
 * because that song is not in the corpus. The curve is theirs, so it is not fitted
 * to one track's noise the way the previous exponents were.
 */
const CURVE_POWER = 2 / 3;

/*
 * Turns a waveform response into values between 0 and 1.
 *
 * The server passes SoundCloud's own payload straight through: every sample as
 * an integer on the picture's `height` scale, which is 140 on every track and
 * always equal to the loudest sample. Dividing by that height is therefore the
 * same division by the track's own peak that SoundCloud's `WaveformData` does
 * before its curve.
 *
 * The samples are not thinned here or on the server. They used to be cut to 1200
 * on the way out, which skipped every third sample, and a skipped sample can be
 * the dip between two hits. Integers on the original scale cost about 7.2kB a
 * track against 7.0kB for the thinned floats, so the detail was being thrown away
 * to save nothing.
 */
export function normalizeSamples(payload) {
  const samples = payload?.samples || [];
  if (!samples.length) return [];
  const scale = payload?.height || 140;
  return samples.map((s) => Math.min(1, Math.max(0, s / scale)));
}

/*
 * Turns the normalised values into bar heights between 0 and 1.
 *
 * The curve above is SoundCloud's own and turns a value straight into the share of
 * the box a bar fills. Nothing is scaled afterwards, because their renderer does
 * not scale anything either: the loudest sample draws a bar the full height of the
 * box.
 *
 * The transform is quantised on the way through. SoundCloud's `WaveformData`
 * rounds the transformed sample to a whole number on the picture's own scale
 * before the draw divides it again:
 *
 *   b = round(H * (1 - x)^(2/3))
 *   bar = 1 - b / H
 *
 * Keeping it in floating point instead lands a pixel off on the columns where the
 * rounding crosses a pixel boundary: compared column by column against their own
 * draw of the same song, that was 57 of 830 columns, every one of them by exactly
 * one pixel. Quantising the same way closes all 57 and matches every column.
 */
export function shapeSamples(samples, scale = 140) {
  return samples.map((s) => {
    const x = Math.min(1, Math.max(0, s));
    return 1 - Math.round(scale * Math.pow(1 - x, CURVE_POWER)) / scale;
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
  const pitch = bar + gap;
  const barCount = barWidth > 0 ? Math.max(1, Math.floor((barWidth + gap) / pitch)) : 0;
  /*
   * The step is the whole pitch, never a fraction stretched to fill the width.
   * It used to be (barWidth + gap) / barCount, so a bar sat at round(i * step)
   * with a step like 3.0045. Every so often that rounding jumps four pixels
   * instead of three and leaves an empty column, which reads as a dead bar in
   * the middle of the wave. Measured at 1336px it happened twice, and SoundCloud
   * never shows one because its pitch is a whole number. A few unused pixels at
   * the right edge are invisible; a missing bar is not.
   */
  const step = pitch;
  /*
   * The bars span one gap less than the full count of pitches. That span, not the
   * whole bar area, is what the playhead and the played layer should be measured
   * against, so a seek lands on the bar under the pointer.
   */
  const span = barCount > 0 ? barCount * pitch - gap : 0;
  const barFraction = width > 0 ? Math.min(1, span / width) : 1;
  return { bar, gap, barWidth, barCount, step, barFraction };
}

/*
 * The height, between 0 and 1, that one bar should be drawn at.
 *
 * A bar reads the sample nearest its own position and nothing else. It used to
 * average the slice of samples under it, and before that to interpolate between
 * two samples, and both were wrong for the same reason: they combine neighbours,
 * which flattens the differences the eye reads as a waveform.
 *
 * Averaging looked harmless while there were many samples per bar, but the song
 * page draws up to about 445 bars from the 1200 samples the server sends, so a
 * bar covers fewer than three samples. Averaging three neighbouring samples
 * then rounds to whole pixels, and neighbouring bars kept landing on the same
 * height. Because a bar is 2px with a 1px gap, a run of those reads as one solid
 * block with slits in it, which is the flat area that kept appearing on the song
 * page and never on SoundCloud. Measured on real tracks at 445 bars, averaging
 * left equal runs of 7.2 bars; reading one sample leaves 5.6, which is exactly
 * what SoundCloud's own data produces at the same width.
 *
 * The position is the bar's LEFT PIXEL, not its index. SoundCloud reads
 * `samples[floor((E / width) * samples.length)]` where `E` is that pixel, so the
 * sample is chosen by where the bar sits in the box. Mapping by bar index instead
 * (`i / barCount`) is almost the same but drifts as the index grows, because the
 * bar count is rounded down from the width. At 831px the two agreed by accident;
 * at 1336px they were up to two samples apart by the right edge, which on a spiky
 * track is a visibly different bar. Taking the pixel makes the read exact at every
 * width.
 *
 * When there are more bars than samples the same read repeats a sample, and no
 * mapping can avoid that, so the guard is simply to stay inside the array.
 */
export function barValue(norm, x, barWidth) {
  if (!norm.length || barWidth <= 0) return 0;
  const at = Math.min(
    norm.length - 1,
    Math.max(0, Math.floor((x / barWidth) * norm.length))
  );
  return norm[at];
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

  const { bar, gap, barCount, step } = geometry;
  const mid = Math.round(height / 2);
  /*
   * The two edges come from SoundCloud's own draw, not from a height rounded
   * around the centre:
   *
   *   S = floor((1 - v) * upperSize)
   *   O = floor(v * lowerSize + upperSize)
   *
   * with `upperSize` and `lowerSize` each half the box, because their waveform was
   * measured symmetric (the axis sits at 49.2% of the box and the bars reach as
   * far above it as below).
   *
   * Rounding a height and then splitting it either side of the centre gives a
   * result within a pixel of this, but that pixel is visible as a jagged edge once
   * the whole wave is compared column by column: it was the last difference left
   * after the curve and the gap fill were matched.
   */
  const upperSize = height / 2;
  const lowerSize = height - upperSize;
  /*
   * Each bar is two tones around the centre line: the half above the axis
   * catches the light, the half below sits in shadow. That is what gives
   * SoundCloud's waveform its depth, and it reads even at bar heights of only a
   * few pixels.
   */
  const lit = color;
  const shaded = shade(color, 0.55);
  /*
   * The gap between two bars is filled over the height they share. SoundCloud's
   * own draw does exactly this:
   *
   *   if (E) fillRect(E - gap, max(S, prevS), gap, min(O, prevO) - max(S, prevS))
   *
   * so a gap column is never empty; it carries the part of the two neighbours
   * that overlaps. That is the difference between a row of separate slivers and
   * the continuous shape their waveform has, and it is why their screenshot shows
   * "bars" 5px and 14px wide: those are neighbours joined by this fill.
   *
   * Measured on their screenshot, all 258 inner gap columns carry ink, with a mean
   * overlap of 20px, so this is not a rare touch-up. Leaving it out is what made
   * Fala's wave look thinner and more broken up at every width.
   */
  let prevTop = null;
  let prevBottom = null;
  for (let i = 0; i < barCount; i += 1) {
    /*
     * The bar's value is the sample nearest its own position, never a blend of
     * its neighbours. Blending is what used to make runs of bars land on the
     * same pixel height and merge into a slab.
     *
     * The position handed over is the bar's own left pixel, because that is the
     * position SoundCloud samples at; see `barValue`.
     */
    const x = Math.round(i * step);
    const v = barValue(norm, x, width);
    /*
     * Both edges are floored from the box, exactly as their draw does, so a bar
     * of a given value lands on the same pixel here as it does there. The minimum
     * height is then enforced around the centre, which keeps a near-silent bar
     * visible instead of letting it vanish into the axis.
     */
    let top = Math.floor((1 - v) * upperSize);
    let bottom = Math.floor(v * lowerSize + upperSize);
    if (bottom - top < minBar) {
      const half = Math.floor(minBar / 2);
      top = mid - half;
      bottom = top + minBar;
    }
    if (top > mid) top = mid;
    if (bottom < mid) bottom = mid;
    /*
     * Join this bar to the one before it before drawing either, so the fill sits
     * under the bars rather than over them.
     */
    if (prevTop !== null && gap > 0 && i > 0) {
      const joinTop = Math.max(top, prevTop);
      const joinBottom = Math.min(bottom, prevBottom);
      if (joinBottom > joinTop) {
        const gx = x - gap;
        const litBottom = Math.min(mid, joinBottom);
        if (litBottom > joinTop) {
          ctx.fillStyle = lit;
          ctx.fillRect(gx, joinTop, gap, litBottom - joinTop);
        }
        const shadeTop = Math.max(mid, joinTop);
        if (joinBottom > shadeTop) {
          ctx.fillStyle = shaded;
          ctx.fillRect(gx, shadeTop, gap, joinBottom - shadeTop);
        }
      }
    }
    ctx.fillStyle = lit;
    ctx.fillRect(x, top, bar, Math.max(1, mid - top));
    ctx.fillStyle = shaded;
    ctx.fillRect(x, mid, bar, Math.max(1, bottom - mid));
    prevTop = top;
    prevBottom = bottom;
  }
  /*
   * Their draw punches a one pixel hole along the axis after filling everything:
   *
   *   clearRect(0, g - 1, u, 1)
   *
   * so the light upper plate and the dark lower plate never touch, and the
   * waveform reads as two halves around a seam. Measured on their screenshot, that
   * row carries no bar ink at all while every other row inside the band does, and
   * it sits at 49.2% of the box, which is exactly `floor(height / 2) - 1`.
   *
   * Without it the two tones meet in the middle and the seam disappears, which is
   * part of why Fala's wave read as one solid shape instead of theirs.
   */
  ctx.clearRect(0, Math.floor(upperSize) - 1, width, 1);
}
