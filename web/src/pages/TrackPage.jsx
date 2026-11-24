import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  Play,
  Pause,
  Repeat2,
  MessageSquare,
  Link2,
  Loader2,
  BadgeCheck,
  Trash2,
  ListMusic,
  Disc3,
  Heart,
  MapPin,
  Users,
  PlayCircle,
  Send,
  X,
} from 'lucide-react';
import {
  api,
  formatCount,
  formatDuration,
  timeAgo,
  formatDate,
  formatRelativeDate,
  trackPath,
} from '@/api.js';
import { usePlayer, usePlayerTime } from '@/context/PlayerContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { Artwork, Avatar, Skeleton, ErrorState } from '@/components/Media.jsx';
import {
  LikeButton,
  FollowButton,
  AddToPlaylistButton,
  AddToQueueButton,
} from '@/components/Controls.jsx';
import { TrackCard } from '@/components/Cards.jsx';
import { Page, CardGrid, LoadMore, DetailHero } from '@/components/layout/Page.jsx';
import { useArtworkColor } from '@/lib/artworkColor.js';
import { useAutoLoad } from '@/lib/useAutoLoad.js';
import { Button } from '@/components/ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Modal } from '@/components/Modal.jsx';
import { cn } from '@/lib/utils.js';
import { placeLabel } from '@/lib/places.js';
import { ClampedText } from '@/components/ClampedText.jsx';
import { resolveTrackParam, playlistLink, userLink, trackSubLink } from '@/lib/scRoute.js';
import { DETAIL_GRID } from '@/lib/layout.js';

/*
 * Turns SoundCloud's 0-255 amplitude into a bar height. A straight division
 * leaves mastered tracks looking flat, because most samples sit near the top of
 * the range, and a min-max stretch swings the other way and flattens the peaks.
 * A gentle power curve lifts the quiet parts into view while keeping the loud
 * ones apart, which is the shape SoundCloud's own bars have.
 */
function shapeSamples(samples) {
  return samples.map((s) => {
    const v = Math.pow(Math.min(255, Math.max(0, s)) / 255, 0.6);
    return Math.min(1, Math.max(0.3, v));
  });
}

/*
 * Reads the current colour of a CSS variable so the canvas follows the theme
 * instead of hard coding one palette. A canvas cannot use Tailwind classes.
 */
function themeColor(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/*
 * Darkens a colour by a factor. SoundCloud draws each bar in two tones: a lit
 * upper half and a shaded lower half, so one flat fill per bar is not enough.
 * The canvas cannot use color-mix, so the darker tone is computed here.
 */
function shade(color, factor) {
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
 * The waveform is drawn on a canvas rather than as hundreds of spans. The
 * playhead then moves every animation frame without React re-rendering the
 * bars, which is what made the old version step once per second instead of
 * sliding. Comment avatars sit above the bars where people wrote them.
 */
function Waveform({
  samples,
  currentTime,
  duration,
  onSeek,
  height = 120,
  fill = false,
  markers = [],
  activeMarker = null,
  onMarkerEnter,
  onMarkerLeave,
}) {
  const outerRef = useRef(null);
  const restRef = useRef(null);
  const playedRef = useRef(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);
  const [boxHeight, setBoxHeight] = useState(height);

  const norm = useMemo(() => (samples && samples.length ? shapeSamples(samples) : []), [samples]);
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  // The bars fill the box; the comment faces float over the centre line.
  const h = Math.max(48, fill ? boxHeight : height);

  // Track the pixel box so the bar count and heights follow the real size.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
        setBoxHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    setBoxHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Bar geometry: 2px bars with a 1px gap, like the reference.
  const BAR = 2;
  const GAP = 1;
  /*
   * The bars stop short of the right edge, the way SoundCloud leaves a flat
   * strip for the two clock labels. The strip is wide enough for the longest
   * time the song can show, so neither label ever sits on a bar.
   */
  const clockLabel = formatDuration(duration);
  const gutter = width > 0 ? Math.max(32, clockLabel.length * 7 + 8) : 0;
  const barWidth = Math.max(0, width - gutter);
  const barCount = barWidth > 0 ? Math.max(1, Math.floor((barWidth + GAP) / (BAR + GAP))) : 0;
  const step = barCount > 0 ? (barWidth + GAP) / barCount : 0;
  // The played layer and the playhead are placed against the bar area, so they
  // stop at the last bar rather than running into the clock strip.
  const barFraction = width > 0 ? barWidth / width : 1;

  /*
   * Both layers are painted with the same bar geometry: one in the resting
   * colour, one in the played colour. The played layer is clipped to the
   * playhead, so the boundary is a smooth vertical edge at any fraction of a
   * pixel instead of a whole bar at a time.
   */
  const paint = useCallback(() => {
    if (!width || !norm.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const played = themeColor('--primary', '#ff5500');
    const rest = themeColor('--waveform-bar', '#55565f');
    const minBar = 2;
    const maxBar = h - 2;
    const mid = Math.round(h / 2);

    for (const [canvas, colour] of [
      [restRef.current, rest],
      [playedRef.current, played],
    ]) {
      if (!canvas) continue;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, h);
      /*
       * Each bar is two tones around the centre line: the half above the axis
       * catches the light, the half below sits in shadow. That is what gives
       * SoundCloud's waveform its depth, and it reads even at bar heights of
       * only a few pixels.
       */
      const lit = colour;
      const shaded = shade(colour, 0.55);
      for (let i = 0; i < barCount; i += 1) {
        const t = barCount === 1 ? 0 : i / (barCount - 1);
        const v = norm[Math.min(norm.length - 1, Math.floor(t * norm.length))];
        const bh = Math.max(minBar, Math.round(minBar + v * (maxBar - minBar)));
        const x = Math.round(i * step);
        const top = Math.round(mid - bh / 2);
        const bottom = Math.round(mid + bh / 2);
        ctx.fillStyle = lit;
        ctx.fillRect(x, top, BAR, Math.max(1, mid - top));
        ctx.fillStyle = shaded;
        ctx.fillRect(x, mid, BAR, Math.max(1, bottom - mid));
      }
    }
  }, [width, h, norm, barCount, step]);

  // Redraw on size, data or theme change. The clip below handles the playhead,
  // so no repaint happens while the song plays.
  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const observer = new MutationObserver(() => paint());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => observer.disconnect();
  }, [paint]);

  const commit = (clientX) => {
    const el = outerRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    /*
     * Only the bar area is the track. A click in the flat clock strip lands on
     * the last bar rather than past the end of the song.
     */
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width * barFraction)));
    onSeek?.(ratio);
  };

  if (!samples || samples.length === 0) return null;

  const tip = activeMarker;

  return (
    <div
      className={fill ? 'relative h-full w-full' : 'relative w-full'}
      style={fill ? undefined : { height }}
      ref={outerRef}
    >
      <div className="absolute inset-0">
        <canvas
          ref={restRef}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        />
        <canvas
          ref={playedRef}
          className="absolute inset-0 h-full w-full"
          style={{ clipPath: `inset(0 ${(1 - progress * barFraction) * 100}% 0 0)` }}
          aria-hidden="true"
        />

        {/*
          * The centre axis. SoundCloud draws a hairline through the middle of
          * the bars, which is what the shaded lower half meets. It is drawn
          * over the bars so it stays continuous across quiet passages.
          */}
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-px -translate-y-1/2 bg-foreground/25"
          style={{ width: `${barFraction * 100}%` }}
          aria-hidden="true"
        />

        {/*
          * The playhead. It is a thin bright line over the bars, positioned by
          * percentage so it slides with the frame instead of stepping bar by
          * bar. It stops at the axis rather than running the full height.
          */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-[5] w-0.5 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `${progress * barFraction * 100}%` }}
          aria-hidden="true"
        />

        {/*
          * The hit area sits on top of both layers: the seek target, the drag
          * handler and the keyboard control in one element.
          */}
        <div
          className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            commit(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging.current) commit(e.clientX);
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') onSeek?.(Math.max(0, progress - 0.01));
            if (e.key === 'ArrowRight') onSeek?.(Math.min(1, progress + 0.01));
          }}
          role="slider"
          tabIndex={0}
          aria-label="Seek within track"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        />
      </div>

      {/* One face per place where someone commented, centred on the axis. */}
      {markers.map((m) => (
        <MarkerFace
          key={m.key}
          marker={m}
          active={tip?.key === m.key}
          barFraction={barFraction}
          onSeek={onSeek}
          onEnter={onMarkerEnter}
          onLeave={onMarkerLeave}
        />
      ))}

      {/*
        * The comment card opens along the bottom edge, under the row of faces,
        * instead of across the middle of the bars. Only the lowest bars pass
        * behind it, so the shape of the song stays readable while it is up.
        */}
      {tip ? <WaveformTip marker={tip} width={width} barFraction={barFraction} /> : null}

      {/*
        * The two clocks sit in the flat strip the bars leave at the right, the
        * way SoundCloud places them: where the playhead is on top, the length
        * of the song underneath. Both are right aligned to the card edge and
        * never reach over a bar.
        */}
      <div
        className="pointer-events-none absolute right-0 top-0 z-20 text-right text-xs font-medium tabular-nums text-foreground"
        style={{ width: gutter }}
      >
        {formatDuration(currentTime)}
      </div>
      <div
        className="pointer-events-none absolute bottom-0 right-0 z-20 text-right text-xs tabular-nums text-muted-foreground"
        style={{ width: gutter }}
      >
        {formatDuration(duration)}
      </div>
    </div>
  );
}

/*
 * One comment face. It is memoised so the per frame playhead update does not
 * re-render every avatar on the waveform.
 */
const MarkerFace = memo(function MarkerFace({ marker, onSeek, onEnter, onLeave, active = false, barFraction = 1 }) {
  return (
    <button
      type="button"
      className={cn(
        'absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        /*
         * The face grows the same way it does under the pointer when the
         * playhead reaches its moment and its comment is on screen, so the
         * picture that belongs to the card is the one that reads as active.
         */
        active && 'scale-110'
      )}
      style={{ left: `${marker.ratio * barFraction * 100}%` }}
      onMouseEnter={() => onEnter?.(marker)}
      onMouseLeave={() => onLeave?.(marker)}
      onClick={(e) => {
        e.stopPropagation();
        onSeek?.(marker.ratio);
      }}
      aria-label={`Comment by ${marker.user?.username || 'a listener'} at ${formatDuration(marker.timeMs)}`}
    >
      <Avatar src={marker.user?.avatar_url} name={marker.user?.username} size={22} />
    </button>
  );
});

/*
 * The little card that names the commenter and quotes them. It opens below the
 * faces, outside the bar area, so it never covers the waveform the listener is
 * reading and never gets clipped by it.
 */
function WaveformTip({ marker, width, barFraction = 1 }) {
  const TIP = 224;
  const left = marker.ratio * width * barFraction;
  const x = Math.max(0, Math.min(width - TIP, left - TIP / 2));
  return (
    <div
      className="pointer-events-none absolute bottom-0 z-20 rounded-lg border bg-popover px-3 py-2 text-left shadow-lg"
      style={{ left: width > 0 ? x : 0, width: TIP }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <span className="truncate">{marker.user?.username || 'Listener'}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatDuration(marker.timeMs)}
        </span>
        {marker.count > 1 ? (
          <span className="shrink-0 text-muted-foreground">+{marker.count - 1}</span>
        ) : null}
      </div>
      <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{marker.body}</p>
    </div>
  );
}

/*
 * The waveform subscribes to the playhead on its own, so a moving progress
 * line never re-renders the comment list or the related tracks below it.
 *
 * Comment markers come from the loaded comment list. Each one is placed by its
 * own timestamp, and while the song plays through that moment the comment pops
 * up on its own for a few seconds, the way SoundCloud surfaces it.
 */
function WaveformPlayer({ samples, active, onSeek, durationMs, markers }) {
  const { currentTime, duration } = usePlayerTime();
  const total = duration || durationMs || 0;
  const time = active ? currentTime : 0;
  const [activeMarker, setActiveMarker] = useState(null);

  /*
   * A comment is shown for three seconds from its own moment. Only one shows at
   * a time: if two comments share a second, the nearest one wins.
   */
  const playingMarker = useMemo(() => {
    if (!active || !markers || !markers.length) return null;
    let best = null;
    for (const m of markers) {
      const delta = time - m.timeMs;
      if (delta >= 0 && delta <= 3000) {
        if (!best || m.timeMs > best.timeMs) best = m;
      }
    }
    return best;
  }, [active, markers, time]);

  // A marker hovering under the pointer beats the timed one.
  const tip = activeMarker || playingMarker;

  /*
   * The clocks are drawn by the waveform itself, inside the flat strip its bars
   * leave at the right edge, so they line up with the bar area at any width.
   */
  return (
    <div className="flex h-full flex-col">
      {/* `relative` anchors the clock and the comment popup. */}
      <div className="relative min-h-0 flex-1">
        <Waveform
          samples={samples}
          currentTime={time}
          duration={total}
          onSeek={onSeek}
          fill
          markers={markers}
          activeMarker={tip}
          onMarkerEnter={setActiveMarker}
          onMarkerLeave={() => setActiveMarker(null)}
        />
      </div>
    </div>
  );
}

function CommentForm({
  track,
  onPosted,
  timestampMs,
  replyTo = null,
  className,
  compact = false,
  active = false,
  onCancel = null,
}) {
  const { addComment } = useLibrary();
  const { user } = useAuth();
  const { currentTime } = usePlayerTime();
  /*
   * SoundCloud has no parent-comment field. A reply is an ordinary comment whose
   * body opens with the other person's @handle, which is also how the thread is
   * rebuilt when it is read back. So the handle is seeded here instead of being
   * sent as a separate relation.
   */
  const [body, setBody] = useState(replyTo?.user?.permalink ? `@${replyTo.user.permalink} ` : '');
  const [busy, setBusy] = useState(false);
  /*
   * In the top card the moment is taken when the field is focused. Until then
   * the placeholder follows the playhead, so the field shows where a comment
   * would land; on focus it holds still at that second.
   */
  const [pinnedAt, setPinnedAt] = useState(null);

  if (!user) {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground',
          className
        )}
      >
        <MessageSquare size={16} />
        <span>
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>{' '}
          to join the conversation.
        </span>
      </div>
    );
  }

  /*
   * Where the comment lands. A reply carries its parent's moment, and the top
   * card uses the moment it froze on focus, or the live playhead if the field
   * was never touched. Either way it is the current spot in the song.
   */
  const atMs = timestampMs != null ? timestampMs : active ? pinnedAt ?? currentTime : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    const comment = await addComment(track.id, body.trim(), atMs);
    if (comment) {
      setBody('');
      // The next comment starts following the playhead again.
      setPinnedAt(null);
      onPosted?.(comment);
    }
    setBusy(false);
  };

  /*
   * The top card keeps the field short and posts with an icon, so the whole
   * action line stays on one row. Replies and the signed-in box keep the
   * labelled button, since they sit on a line of their own.
   */
  if (compact) {
    /*
     * The placeholder is the live spot in the song until the field is focused,
     * when it stops at that second and stays put. Typing clears it the usual
     * way, because a placeholder only shows while the field is empty.
     */
    const liveMs = pinnedAt ?? currentTime;
    const placeholder =
      timestampMs != null
        ? `Comment at ${formatDuration(timestampMs)}…`
        : active
          ? `Comment at ${formatDuration(liveMs)}…`
          : 'Write a comment…';

    return (
      <form className={cn('flex items-center gap-1.5', className)} onSubmit={submit}>
        <Input
          className="h-9 flex-1 border-2 border-muted-foreground/50"
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => {
            if (active && pinnedAt == null) setPinnedAt(currentTime);
          }}
          onBlur={() => {
            // An empty field goes back to following the playhead.
            if (!body.trim()) setPinnedAt(null);
          }}
          maxLength={1000}
          aria-label="Write a comment"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!body.trim() || busy}
          aria-label="Post comment"
          title="Post comment"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </form>
    );
  }

  return (
    <form className={cn('flex items-center gap-2.5', className)} onSubmit={submit}>
      <Avatar src={user.avatar_url} name={user.username} size={38} />
      <Input
        className="flex-1"
        placeholder={
          timestampMs ? `Comment at ${formatDuration(timestampMs)}…` : 'Write a comment…'
        }
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
      />
      {/*
        * A reply can be backed out of. The close button sits just before the
        * post button, so cancelling is a single small step and never needs a
        * reload to get rid of the open field.
        */}
      {onCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label="Cancel reply"
          title="Cancel reply"
        >
          <X size={16} />
        </Button>
      ) : null}
      <Button type="submit" disabled={!body.trim() || busy}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Post'}
      </Button>
    </form>
  );
}

/*
 * One comment, plus its replies when it has any. Likes and the author's heart
 * only exist for signed in listeners, because SoundCloud serves them from its
 * GraphQL gateway behind a token.
 */
function CommentItem({ comment, trackId, onDelete, onReplied, isReply = false }) {
  const { user } = useAuth();
  const { seek } = usePlayer();
  const { likeComment } = useLibrary();
  const [liked, setLiked] = useState(!!comment.liked);
  const [likes, setLikes] = useState(comment.likes || 0);
  const [replying, setReplying] = useState(false);
  const [replies, setReplies] = useState(comment.replies || []);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyCursor, setReplyCursor] = useState(comment.replies_cursor || null);
  const canDelete = user && comment.user && String(user.id) === String(comment.user.id);
  const canInteract = !!user && !!trackId;

  const toggleLike = async () => {
    if (!canInteract) return;
    const next = !liked;
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    const res = await likeComment(trackId, comment.id, next);
    if (!res) {
      setLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    }
  };

  const loadMoreReplies = async () => {
    if (!replyCursor || loadingReplies) return;
    setLoadingReplies(true);
    try {
      const res = await api.get(
        `/api/tracks/${trackId}/comments/${comment.id}/replies?after=${encodeURIComponent(replyCursor)}`
      );
      setReplies((prev) => [...prev, ...(res.collection || [])]);
      setReplyCursor(res.next_cursor || null);
    } catch {}
    setLoadingReplies(false);
  };

  return (
    <div
      className={cn(
        'group flex gap-3 py-3.5',
        isReply ? 'border-0 pl-0' : 'border-b border-border/60 last:border-0'
      )}
    >
      <Link {...userLink(comment.user)} className="shrink-0">
        <Avatar
          src={comment.user?.avatar_url}
          name={comment.user?.username}
          size={isReply ? 28 : 36}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Link
            {...userLink(comment.user)}
            className="text-sm font-semibold text-foreground hover:underline"
          >
            {comment.user?.username || 'Listener'}
          </Link>
          {/*
           * The moment in the song leads the meta line, the way SoundCloud
           * reads it: "at 0:42 · 3 days ago". Only the time itself lifts on
           * hover, because only it is the button that seeks; the "at" and the
           * posted date stay plain text.
           */}
          {comment.timestamp_ms != null ? (
            <>
              <span className="inline-flex items-center gap-1">
                <span>at</span>
                <button
                  type="button"
                  className="tabular-nums transition-colors hover:text-foreground"
                  onClick={() => seek(comment.timestamp_ms)}
                  title="Jump to this moment"
                >
                  {formatDuration(comment.timestamp_ms)}
                </button>
              </span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{timeAgo(comment.created_at)}</span>
        </div>
        <p className="mt-1 text-sm leading-relaxed break-words">{comment.body}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {canInteract ? (
            <button
              type="button"
              onClick={toggleLike}
              className={cn(
                'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                liked && 'text-primary hover:text-primary'
              )}
              aria-pressed={liked}
              aria-label={liked ? 'Remove like from comment' : 'Like comment'}
            >
              <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
              {likes > 0 ? <span className="tabular-nums">{formatCount(likes)}</span> : null}
            </button>
          ) : likes > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Heart size={13} /> {formatCount(likes)}
            </span>
          ) : null}

          {comment.creator_liked ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.68rem] font-semibold text-primary"
              title="The artist liked this comment"
            >
              <Heart size={11} fill="currentColor" /> Liked by artist
            </span>
          ) : null}

          {!isReply && canInteract ? (
            <button
              type="button"
              onClick={() => setReplying((v) => !v)}
              className="transition-colors hover:text-foreground"
            >
              Reply
            </button>
          ) : null}

          {canDelete ? (
            <button
              type="button"
              onClick={() => onDelete(comment.id)}
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              aria-label="Delete comment"
            >
              <Trash2 size={12} /> Delete
            </button>
          ) : null}
        </div>

        {replying ? (
          <div className="mt-2">
            <CommentForm
              track={{ id: trackId }}
              replyTo={comment}
              onCancel={() => setReplying(false)}
              onPosted={(reply) => {
                setReplies((prev) => [...prev, reply]);
                setReplying(false);
                onReplied?.();
              }}
            />
          </div>
        ) : null}

        {replies.length > 0 ? (
          <div className="mt-2 border-l border-border/60 pl-3.5">
            {replies.map((r) => (
              <CommentItem
                key={r.id}
                comment={r}
                trackId={trackId}
                onDelete={onDelete}
                onReplied={onReplied}
                isReply
              />
            ))}
            {replyCursor ? (
              <button
                type="button"
                onClick={loadMoreReplies}
                disabled={loadingReplies}
                className="py-1 text-xs font-medium text-primary hover:underline"
              >
                {loadingReplies ? 'Loading replies' : 'Show more replies'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function userRow(u, onClose) {
  return (
    <Link
      key={u.id}
      {...userLink(u)}
      className="flex items-center gap-2.5 rounded-md px-1.5 py-2 transition-colors hover:bg-accent/60"
      onClick={onClose}
    >
      <Avatar src={u.avatar_url} name={u.username} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate text-sm font-medium">
          {u.username}
          {u.verified ? <BadgeCheck size={14} className="text-primary" /> : null}
        </span>
        {u.followers_count ? (
          <span className="block text-xs text-muted-foreground">
            {formatCount(u.followers_count)} followers
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function playlistRow(p, onClose) {
  return (
    <Link
      key={p.id}
      {...playlistLink(p)}
      className="flex items-center gap-2.5 rounded-md px-1.5 py-2 transition-colors hover:bg-accent/60"
      onClick={onClose}
    >
      <Artwork
        src={p.artwork_url}
        fallback={p.user?.avatar_url}
        alt={p.title}
        size={38}
        rounded={4}
        kind="playlist"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{p.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {p.user?.username ? `${p.user.username} · ` : ''}
          {formatCount(p.track_count)} tracks
        </span>
      </span>
    </Link>
  );
}

/*
 * "People you follow also liked this". Three names at most, with the remainder
 * behind a count that opens the whole list.
 */
function AlsoLiked({ people }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef(null);
  const [rowWidth, setRowWidth] = useState(0);

  /*
   * The stack fills whatever room the card has, so the width is measured rather
   * than assumed. A resize observer keeps it right when the sidebar changes
   * width or the window is resized.
   */
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setRowWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setRowWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  if (!people || people.length === 0) return null;

  /*
   * 26px pictures overlap by 8px, so the row is 8px wider than a bare face and
   * every extra one adds 18px. The stack fills the card from the left edge, and
   * when not everyone fits the "..." chip takes the far right slot, so the row
   * runs to the same margin on both sides instead of stopping after the last
   * picture.
   */
  const FACE = 26;
  const STEP = 18;
  const GAP = 8;
  /*
   * How many pictures fit when `reserve` pixels stay free on the right. Until
   * the row has been measured nothing is hidden: assuming a small number here
   * would push everyone past the third picture behind the dots, even with a
   * row wide enough to show them all.
   */
  const fit = (reserve) => {
    if (!rowWidth) return people.length;
    return Math.max(1, Math.floor((rowWidth - reserve - FACE) / STEP) + 1);
  };
  const crowded = people.length > fit(0);
  const faces = crowded ? people.slice(0, fit(FACE + GAP)) : people;

  // The sentence stays short no matter how many faces fit above it.
  const named = people.slice(0, 3);
  const rest = people.length - named.length;

  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <div ref={rowRef} className="flex items-center pb-2">
        <div className="flex min-w-0 items-center -space-x-2">
          {faces.map((u) => (
            <Link
              key={u.id}
              {...userLink(u)}
              className="relative shrink-0 rounded-full ring-2 ring-background"
              title={u.username}
            >
              <Avatar src={u.avatar_url} name={u.username} size={FACE} />
            </Link>
          ))}
        </div>
        {crowded ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative z-10 ml-auto flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-background transition-colors hover:bg-accent hover:text-foreground"
            style={{ width: FACE, height: FACE }}
            title={`${people.length} people you follow liked this`}
          >
            ...
          </button>
        ) : null}
      </div>
      <p className="min-w-0 text-sm text-muted-foreground">
        {named.map((u, i) => (
          <span key={u.id}>
            <Link
              {...userLink(u)}
              className="font-medium text-foreground hover:underline"
            >
              {u.username}
            </Link>
            {i < named.length - 1 ? ', ' : ''}
          </span>
        ))}
        {rest > 0 ? (
          <>
            {' and '}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setOpen(true)}
            >
              {rest} more following {rest === 1 ? 'person' : 'people'}
            </button>
            {' liked this'}
          </>
        ) : (
          ' liked this'
        )}
      </p>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="People you follow who liked this"
        wide
      >
        <div className="max-h-[60vh] overflow-y-auto">
          {people.map((u) => userRow(u, () => setOpen(false)))}
        </div>
      </Modal>
    </div>
  );
}

/*
 * The listener ranking SoundCloud keeps behind its insights page, for this
 * track. It only offers two windows: the first week and all time. The numbers
 * come from a signed-in-only endpoint, so the panel stays out of the way when
 * there is no token or no data.
 *
 * All time also says where the signed in account itself stands, which is how
 * SoundCloud lets you find yourself in a ranking you are not part of. That
 * extra row is all time only, because the first week window does not report it.
 */
const LISTENER_WINDOWS = [
  { id: 'ALL_TIME', label: 'All time' },
  { id: 'DAYS_7', label: 'First week' },
];

/*
 * One place in the ranking. The number is a tight column on the left, the face
 * and name follow it without a wide gap, and the play count sits flush right.
 * SoundCloud keeps the name close to the rank, so the gap between them stays
 * small instead of the number floating on its own.
 */
function ListenerRow({ rank, user, plays, isViewer = false }) {
  return (
    <Link
      {...userLink(user)}
      className={cn(
        'flex items-center gap-2 rounded-md py-1.5 transition-colors hover:bg-accent/60',
        isViewer && 'bg-primary/10'
      )}
    >
      <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
        {rank}
      </span>
      <Avatar src={user.avatar_url} name={user.username} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate text-sm font-medium">
          <span className="truncate">{user.username}</span>
          {user.verified ? <BadgeCheck size={13} className="shrink-0 text-primary" /> : null}
          {isViewer ? (
            <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              You
            </span>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatCount(plays)} {plays === 1 ? 'play' : 'plays'}
      </span>
    </Link>
  );
}

function TopListeners({ trackId }) {
  const { user: me } = useAuth();
  const [window, setWindow] = useState('ALL_TIME');
  const [fans, setFans] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [days, setDays] = useState(7);
  const [available, setAvailable] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/api/tracks/${trackId}/listeners?window=${window}&limit=5`)
      .then((r) => {
        if (cancelled) return;
        setFans(r.fans || []);
        setViewer(r.viewer || null);
        if (r.days) setDays(r.days);
        if (Array.isArray(r.windows)) setAvailable(r.windows);
      })
      .catch(() => {
        if (cancelled) return;
        setFans([]);
        setViewer(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [trackId, window]);

  /*
   * A young track has no all time ranking yet, so SoundCloud only answers with
   * the first period. The tabs follow whatever the server reports instead of
   * always drawing both, and the first window that has rows is the one shown.
   */
  const shownWindows = useMemo(() => {
    if (!available || available.length === 0) return LISTENER_WINDOWS;
    return LISTENER_WINDOWS.filter((w) => available.includes(w.id));
  }, [available]);

  useEffect(() => {
    if (!available || available.length === 0) return;
    if (!available.includes(window)) setWindow(available[0]);
  }, [available, window]);

  // A track with no plays in the window has no ranking, and an empty box would
  // just be noise under the player.
  if (!loading && (!fans || fans.length === 0)) return null;

  /*
   * When the account is already in the shown ranks, that row is marked instead
   * of repeating it underneath. Otherwise the standing gets its own row at the
   * bottom, set apart by a rule so it does not read as the next place.
   */
  const inList = viewer != null && viewer.rank <= fans.length;
  const ownRow = viewer != null && !inList && me ? viewer : null;

  return (
    <section className="rounded-xl border bg-card px-4 py-3.5">
      {/*
       * The window tabs open the box on the left, where the title used to sit
       * before it was removed, so the card starts with its controls instead of
       * an empty corner.
       */}
      <div className="flex flex-wrap items-center justify-start gap-2">
        <div className="flex gap-1">
          {shownWindows.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWindow(w.id)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                window === w.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {/*
                * A young track only has a shorter window, and naming the real
                * number of days is the honest label there. Once the window is
                * the full seven days it reads as a week.
                */}
              {w.id === 'DAYS_7' && days !== 7 ? `First ${days} days` : w.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <ol className="mt-2.5">
          {fans.map((entry, i) => (
            <li key={`${entry.user.id}-${i}`}>
              <ListenerRow
                rank={i + 1}
                user={entry.user}
                plays={entry.plays}
                isViewer={inList && viewer.rank === i + 1}
              />
            </li>
          ))}
          {ownRow ? (
            <li className="mt-1.5 border-t pt-1.5">
              <ListenerRow
                rank={ownRow.rank}
                user={me}
                plays={ownRow.plays}
                isViewer
              />
            </li>
          ) : null}
        </ol>
      )}
    </section>
  );
}

/*
 * Who made the song, as its own card in the side column. The thumbnail, name,
 * follower and track counts and the place all come straight from the track's
 * own user, so nothing extra is fetched. There is deliberately no message
 * button here: that belongs on the artist page, not on a song.
 */
function ArtistCard({ user }) {
  if (!user) return null;
  const place = placeLabel(user.city, user.country_code);

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <Link {...userLink(user)} className="shrink-0">
          <Avatar src={user.avatar_url} name={user.username} size={56} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            {...userLink(user)}
            className="inline-flex max-w-full items-center gap-1 truncate text-sm font-semibold hover:underline"
            title={user.username}
          >
            <span className="truncate">{user.username}</span>
            {user.verified ? <BadgeCheck size={15} className="shrink-0 text-primary" /> : null}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users size={12} /> {formatCount(user.followers_count)} followers
            </span>
            <span>
              {formatCount(user.track_count)} {user.track_count === 1 ? 'track' : 'tracks'}
            </span>
          </div>
          {place ? (
            <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin size={12} /> {place}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <FollowButton target={user} size="sm" className="w-full" />
      </div>
    </section>
  );
}

/*
 * The song's numbers, laid out the way SoundCloud shows them: a box per figure
 * with the count on top and the word under it, rather than a list of rows. Likes
 * and reposts lead to the people behind them, so those two are links; plays and
 * comments have nowhere to go and stay plain.
 */
function StatTile({ label, value, icon: Icon, to, title }) {
  const body = (
    <>
      <span className="text-lg font-semibold leading-none tabular-nums">{value}</span>
      <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
        {Icon ? <Icon size={12} /> : null}
        {label}
      </span>
    </>
  );

  const base = 'flex flex-col items-center justify-center rounded-lg border bg-muted/30 px-2 py-2.5 text-center';

  if (!to) return <div className={base}>{body}</div>;

  return (
    <Link
      {...to}
      title={title}
      className={cn(base, 'transition-colors hover:border-primary/40 hover:bg-accent')}
    >
      {body}
    </Link>
  );
}

/*
 * Plays, likes and reposts are the numbers people actually scan for, so they
 * share one row. The comment count is left to the comment box itself, where
 * it already appears as the heading.
 */
function TrackStats({ track }) {
  return (
    /*
     * The tiles say what they are, so the box needs no heading of its own. The
     * numbers start at the top edge instead of under a label.
     */
    <section className="rounded-xl border bg-card px-4 py-3.5">
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Plays" value={formatCount(track.playback_count)} icon={PlayCircle} />
        <StatTile
          label="Likes"
          value={formatCount(track.likes_count)}
          icon={Heart}
          to={trackSubLink(track, 'likes')}
          title="See who liked this song"
        />
        <StatTile
          label="Reposts"
          value={formatCount(track.reposts_count)}
          icon={Repeat2}
          to={trackSubLink(track, 'reposts')}
          title="See who reposted this song"
        />
      </div>
    </section>
  );
}

/*
 * Which playlists and albums hold this song. These used to sit in the top card
 * as two loose links, which made them read like actions. They are facts about
 * the song, so they belong in a box with the rest of them, below Top listeners.
 */
function TrackCollections({ counts, track }) {
  const playlists = counts?.playlists;
  const albums = counts?.albums;
  const hasPlaylists = playlists?.total > 0;
  const hasAlbums = albums?.total > 0;
  if (!hasPlaylists && !hasAlbums) return null;

  const row =
    'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

  return (
    <section className="rounded-xl border bg-card px-3 py-3">
      <h2 className="px-2 text-sm font-semibold tracking-tight">Appears in</h2>
      <div className="mt-2 space-y-0.5">
        {hasPlaylists ? (
          <Link
            {...trackSubLink(track, 'playlists')}
            className={row}
            title="See the playlists this track is in"
          >
            <span className="inline-flex items-center gap-1.5">
              <ListMusic size={14} /> Playlists
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {playlists.complete ? '' : 'More than '}
              {formatCount(playlists.total)}
            </span>
          </Link>
        ) : null}
        {hasAlbums ? (
          <Link
            {...trackSubLink(track, 'albums')}
            className={row}
            title="See the albums this track is in"
          >
            <span className="inline-flex items-center gap-1.5">
              <Disc3 size={14} /> Albums
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatCount(albums.total)}
            </span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

export function TrackPage() {
  /*
   * The song page answers on both /track/:id and the SoundCloud shaped
   * /:artist/:track. A slug address carries words, so it is resolved to an id
   * once before any of the usual requests run.
   */
  const params = useParams({ strict: false });
  const [id, setId] = useState(params.id ? String(params.id) : null);
  const [resolveError, setResolveError] = useState(null);
  const toast = useToast();
  const { playTrack, isCurrent, playing, togglePlay, duration, seek, queue, audioRef } =
    usePlayer();
  const { deleteComment } = useLibrary();
  const { isAuthed } = useAuth();

  const [track, setTrack] = useState(null);
  const [related, setRelated] = useState([]);
  const [comments, setComments] = useState([]);
  const [nextComments, setNextComments] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [waveform, setWaveform] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [counts, setCounts] = useState(null);
  const [alsoLiked, setAlsoLiked] = useState([]);
  /*
   * The user object inside a track is a cut down copy, and its track count is
   * often zero even for an artist with dozens of uploads. The artist card asks
   * the user endpoint for the real record instead.
   */
  const [artist, setArtist] = useState(null);
  // SoundCloud's own total counts replies, so it is used instead of the number
  // of top-level rows loaded so far.
  const [commentTotal, setCommentTotal] = useState(0);

  const active = isCurrent(track);

  // A slug address has to become an id before anything else can be fetched.
  useEffect(() => {
    let cancelled = false;
    if (params.id) {
      setId(String(params.id));
      setResolveError(null);
      return () => {
        cancelled = true;
      };
    }
    setId(null);
    setLoading(true);
    (async () => {
      try {
        const resolved = await resolveTrackParam({
          artist: params.artist,
          track: params.track,
        });
        if (cancelled) return;
        if (!resolved) {
          setResolveError('Track not found');
          setLoading(false);
          return;
        }
        setResolveError(null);
        setId(resolved);
      } catch (err) {
        if (!cancelled) {
          setResolveError(err.message || 'Track not found');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, params.artist, params.track]);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTrack(null);
    setWaveform(null);
    setComments([]);
    setArtist(null);
    (async () => {
      try {
        const t = await api.get(`/api/tracks/${id}`);
        if (cancelled) return;
        setTrack(t);
        setCommentTotal(t.comment_count || 0);
        setLoading(false);

        if (t.user?.id) {
          api
            .get(`/api/users/${t.user.id}`)
            .then((u) => !cancelled && setArtist(u))
            .catch(() => {});
        }

        if (t.waveform_url) {
          api
            .get(`/api/tracks/${id}/waveform?url=${encodeURIComponent(t.waveform_url)}`)
            .then((w) => !cancelled && setWaveform(w.samples || []))
            .catch(() => {});
        }

        api
          .get(`/api/tracks/${id}/related?limit=24`)
          .then((r) => !cancelled && setRelated(r.collection || []))
          .catch(() => {});

        api
          .get(`/api/tracks/${id}/collection-counts`)
          .then((c) => !cancelled && setCounts(c))
          .catch(() => {});

        if (isAuthed) {
          api
            .get(`/api/tracks/${id}/also-liked`)
            .then((r) => !cancelled && setAlsoLiked(r.collection || []))
            .catch(() => {});
        }

        const c = await api.get(`/api/tracks/${id}/comments?limit=100`);
        if (!cancelled) {
          setComments(c.collection || []);
          setNextComments(c.next_href || null);
          setNextCursor(c.next_cursor || null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Track not found');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isAuthed]);

  const loadMoreComments = async () => {
    if (loadingComments) return;
    if (!nextComments && !nextCursor) return;
    setLoadingComments(true);
    try {
      // Signed in, the richer list pages by cursor. Signed out, api-v2 pages by
      // next_href. Only one of the two is ever set.
      const path = nextCursor
        ? `/api/tracks/${id}/comments?after=${encodeURIComponent(nextCursor)}`
        : `/api/tracks/${id}/comments?next=${encodeURIComponent(nextComments)}`;
      const res = await api.get(path);
      setComments((prev) => [...prev, ...(res.collection || [])]);
      setNextComments(res.next_href || null);
      setNextCursor(res.next_cursor || null);
    } catch {}
    setLoadingComments(false);
  };

  const commentsSentinel = useAutoLoad({
    hasMore: !!(nextComments || nextCursor),
    loading: loadingComments,
    onLoad: loadMoreComments,
  });

  const handleDeleteComment = async (commentId) => {
    const ok = await deleteComment(commentId);
    if (ok) setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const copyLink = async (url, label) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} link copied`);
    } catch {
      toast.error('Could not copy link');
    }
  };

  /*
   * Comments that carry a moment in the song become faces over the waveform.
   * Several people can comment on the same second, so they share one marker and
   * the tip lists them together rather than stacking avatars on one spot. This
   * stays above the early returns so the hook order never changes.
   */
  const commentMarkers = useMemo(() => {
    const total = track?.full_duration || track?.duration || 0;
    if (!total) return [];
    const bySecond = new Map();
    for (const c of comments) {
      if (c.timestamp_ms == null) continue;
      const timeMs = Math.max(0, Math.min(total, c.timestamp_ms));
      const key = Math.round(timeMs / 1000);
      if (!bySecond.has(key)) {
        bySecond.set(key, {
          key,
          timeMs: key * 1000,
          ratio: timeMs / total,
          user: c.user,
          body: c.body,
          count: 0,
        });
      }
      bySecond.get(key).count += 1;
    }
    return [...bySecond.values()].sort((a, b) => a.timeMs - b.timeMs);
  }, [comments, track?.full_duration, track?.duration]);

  /*
   * The band behind the card takes its colour from the cover. SoundCloud does
   * not send this colour over the API, so it is sampled from the artwork and
   * falls back to a plain page when the pixels cannot be read.
   */
  const cover = useArtworkColor(track?.artwork_url || track?.user?.avatar_url);
  const tint = cover ? `rgb(${cover[0]} ${cover[1]} ${cover[2]})` : null;

  if (loading) {
    return (
      <Page>
        {/* The cover lands on the right, so the skeleton does too. */}
        <div className={cn('grid gap-8', DETAIL_GRID)}>
          <Skeleton className="aspect-square w-full rounded-xl lg:order-2" />
          <div className="flex flex-col gap-3.5 lg:order-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="mt-3 h-10 w-1/2" />
          </div>
        </div>
      </Page>
    );
  }

  if (error || resolveError || !track) {
    return (
      <Page>
        <ErrorState
          message={error || resolveError || 'This track could not be found.'}
          onRetry={() => window.location.reload()}
        />
      </Page>
    );
  }

  const contextList =
    queue.length && active ? queue : [track, ...related.filter((r) => r.kind === 'track')];
  /*
   * SoundCloud repeats the genre inside tag_list, so drop it there: the main
   * tag is rendered first and on its own, never twice.
   */
  const mainTag = (track.genre || '').trim();
  const mainKey = mainTag.toLowerCase();
  const tags = (track.tag_list || '')
    .split(/\s+/)
    .map((t) => t.replace(/^"|"$/g, ''))
    .filter(Boolean)
    .filter((t) => t.toLowerCase() !== mainKey)
    .slice(0, 12);
  // The credits for the song itself, which SoundCloud stores apart from the
  // account that uploaded it.
  const metaArtist = String(track.publisher_metadata?.artist || '').trim();
  /*
   * The credit line reads "artist · date", with each part dropped when the
   * song has nothing to say about it. Building it as a list keeps the
   * separators between the parts that exist instead of leaving a gap where a
   * missing one would have been. The quality marks are not credits, so they
   * are kept apart and follow a single separator of their own.
   */
  const creditParts = [];
  if (metaArtist) {
    creditParts.push({
      key: 'artist',
      node: <span className="min-w-0 break-words">{metaArtist}</span>,
    });
  }
  if (track.display_date) {
    creditParts.push({
      key: 'date',
      node: (
        <time
          dateTime={track.display_date}
          title={formatDate(track.display_date)}
          className="cursor-default"
        >
          {formatRelativeDate(track.display_date)}
        </time>
      ),
    });
  }
  /*
   * The quality marks are little light blocks, the way SoundCloud draws them:
   * a filled chip with the letter knocked out of it. They sit together after
   * one separator instead of each carrying a dot of its own, and the pointer
   * stays an ordinary arrow so the line does not read as a help link.
   */
  const badgeClass =
    'inline-flex h-4 items-center rounded-[3px] bg-foreground px-1 text-[10px] font-bold leading-none tracking-wide text-background no-underline';
  const badgeParts = [];
  if (track.lossless) {
    badgeParts.push({
      key: 'hd',
      node: (
        <abbr title="Uploaded in lossless quality" className={badgeClass}>
          HD
        </abbr>
      ),
    });
  }
  if (track.explicit) {
    badgeParts.push({
      key: 'explicit',
      node: (
        <abbr title="Explicit" className={badgeClass}>
          E
        </abbr>
      ),
    });
  }

  return (
    <Page>
      <DetailHero tint={tint}>
        <div className={cn('grid gap-8', DETAIL_GRID)}>
        {/*
         * The cover takes the right column at the same width as the boxes under
         * the card, so the page keeps one right edge. It stays first in the
         * markup, which is the order a phone should stack it in.
         */}
        <div className="mx-auto w-full max-w-[20rem] lg:order-2 lg:mx-0">
          {/*
           * Some uploads carry no artwork at all, and SoundCloud shows the
           * artist avatar for those instead of a blank tile.
           */}
          <Artwork
            src={track.artwork_url}
            fallback={track.user?.avatar_url}
            alt={track.title}
            size="100%"
            rounded={12}
            className="aspect-square shadow-md"
          />
        </div>

        {/*
         * The title rides the top edge and the action row rides the bottom
         * edge. The padding that used to hold them off the border is given to
         * the gaps around the bars instead, so the waveform keeps exactly the
         * height it had while the two rows move out to meet the edges.
         */}
        <div className="flex min-w-0 flex-col lg:order-1">
          {track.policy === 'BLOCK' ? (
            <div className="mb-2">
              <Badge variant="destructive">Unavailable</Badge>
            </div>
          ) : null}

          {/* The play button leads the card, with the title and credits beside it. */}
          <div className="flex items-start gap-4">
            <button
              type="button"
              className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95"
              onClick={() => (active ? togglePlay() : playTrack(track, contextList))}
              aria-label={active && playing ? 'Pause' : 'Play'}
            >
              {active && playing ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" className="ml-0.5" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {track.title}
              </h1>

              {/*
               * The song's own credits, not the uploader. SoundCloud keeps them in
               * publisher_metadata.artist and they often differ from the account
               * that posted the file. The date sits next to them, relative at first
               * glance and spelled out in full on hover.
               */}
              {creditParts.length > 0 || badgeParts.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                  {creditParts.map((part, i) => (
                    <span key={part.key} className="inline-flex min-w-0 items-center gap-x-1.5">
                      {i > 0 ? <span aria-hidden="true">·</span> : null}
                      {part.node}
                    </span>
                  ))}
                  {/*
                    * One dot borders the credits off from the quality marks,
                    * and the marks then sit next to each other with no dot
                    * between them.
                    */}
                  {badgeParts.length > 0 ? (
                    <span className="inline-flex items-center gap-x-1.5">
                      {creditParts.length > 0 ? <span aria-hidden="true">·</span> : null}
                      {badgeParts.map((part) => (
                        <span key={part.key} className="inline-flex items-center">
                          {part.node}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {waveform ? (
            /*
             * Taller than the old strip, because the bars now carry the
             * two-tone depth and the comment faces sit over the centre line.
             * The clock lives under the bars instead of beside them, so the
             * waveform keeps the full width of the card.
             */
            <div className="mt-3.5 min-h-[180px] flex-1">
              <WaveformPlayer
                samples={waveform}
                active={active}
                durationMs={track.full_duration || track.duration || 0}
                markers={commentMarkers}
                onSeek={(ratio) => {
                  if (!active) playTrack(track, contextList);
                  seek(ratio * (track.full_duration || track.duration || 0));
                }}
              />
            </div>
          ) : null}

          {/*
           * The action line, in SoundCloud's order: like, the comment field,
           * copy link, repost, add to playlist and add to queue. The comment
           * field lives here now instead of under the comments heading, so a
           * listener can say something without scrolling. Its moment comes
           * from the playhead, so there is no separate timestamp control.
           */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <LikeButton track={track} size={18} />

            <CommentForm
              track={track}
              className="min-w-0 flex-1"
              compact
              active={active}
              onPosted={(c) => {
                setComments((prev) => [c, ...prev]);
                setCommentTotal((n) => n + 1);
              }}
            />

            <CopyLinkButton track={track} onCopy={copyLink} />

            <RepostControl track={track} />

            <AddToPlaylistButton track={track} size={18} />

            <AddToQueueButton track={track} size={18} />
          </div>
        </div>
      </div>
      </DetailHero>

      {/*
       * Below the player the page splits: the words run down the left, and the
       * facts about the song and its artist sit in a narrower column on the
       * right. The comments lose a little width to make room for it, which is
       * the whole point of the split.
       */}
      <div className={cn('mt-12 grid gap-8 lg:items-start', DETAIL_GRID)}>
        <div className="min-w-0">
          {/*
           * Everything known about the song sits together here: the tags it
           * was uploaded with, then the uploader's own words. The section is
           * always present, since the tags alone are worth showing, and the
           * description keeps its first lines visible before any expansion.
           */}
          <section>
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Details</h2>

            {mainTag || tags.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {mainTag ? (
                  <span
                    className="rounded-md border border-white px-2 py-0.5 text-xs text-white"
                    title="Main tag"
                  >
                    {mainTag}
                  </span>
                ) : null}
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            {/*
             * The label and the license are small print, so they share one
             * line right under the tags instead of taking a row each.
             */}
            {track.label_name || track.license ? (
              <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {track.label_name ? <span>Label: {track.label_name}</span> : null}
                {track.label_name && track.license ? <span aria-hidden="true">-</span> : null}
                {track.license ? (
                  <span>License: {track.license.replace(/-/g, ' ')}</span>
                ) : null}
              </div>
            ) : null}

            {/*
             * No description means nothing to say. A line explaining that a
             * description is absent is just noise under the tags, so the block
             * closes after them.
             */}
            {track.description ? <ClampedText text={track.description} lines={5} /> : null}
          </section>

          <section className="mt-12">
            {/*
             * The comment field sits in the top card now, so this section only
             * carries the heading and the thread.
             */}
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
              Comments
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {commentTotal}
              </span>
            </h2>

            <div>
              {comments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No comments yet. Be the first to say something.
                </p>
              ) : null}
              {comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  trackId={track.id}
                  onDelete={handleDeleteComment}
                  onReplied={() => setCommentTotal((n) => n + 1)}
                />
              ))}
            </div>

            <LoadMore sentinelRef={commentsSentinel} loading={loadingComments} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <ArtistCard user={artist || track.user} />
          <TrackStats track={track} />
          {isAuthed ? <TopListeners trackId={track.id} /> : null}
          <AlsoLiked people={alsoLiked} />
          <TrackCollections counts={counts} track={track} />
        </aside>
      </div>

      {related.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">You might also like</h2>
          <CardGrid>
            {related.map((t) => (
              <TrackCard key={t.id} track={t} context={related} />
            ))}
          </CardGrid>
        </section>
      ) : null}

    </Page>
  );
}

/*
 * Reposting from the song page offers a short note, which SoundCloud shows
 * alongside the repost in the feed. The note is optional: the X in the corner
 * closes the field and reposts with nothing attached, which is what the plain
 * button did in one click before. Undoing a repost skips the field entirely,
 * since there is no note to write.
 */
function RepostControl({ track }) {
  const { isReposted, toggleRepost, isBusy } = useLibrary();
  const { user } = useAuth();
  const reposted = isReposted(track);
  const busy = isBusy('repost:' + track?.id);

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef(null);
  const fieldRef = useRef(null);

  // Escape and a click outside both close the field without writing anything.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e) => {
      const el = wrapRef.current;
      if (el && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  const submit = async (text) => {
    setSaving(true);
    const ok = await toggleRepost(track, text);
    setSaving(false);
    if (ok) {
      setOpen(false);
      setNote('');
    }
  };

  const onClick = () => {
    // Signing in and undoing are both single clicks with nothing to write.
    if (!user || reposted) {
      toggleRepost(track);
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant={reposted ? 'secondary' : 'ghost'}
        size="icon"
        onClick={onClick}
        aria-pressed={reposted}
        aria-expanded={open}
        aria-label={reposted ? 'Undo repost' : 'Repost'}
        title={reposted ? 'Reposted' : 'Repost'}
        disabled={busy}
      >
        <Repeat2 size={16} />
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border bg-popover p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Add a note to the repost
            </span>
            <button
              type="button"
              onClick={() => submit('')}
              disabled={saving}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Repost without a note"
              title="Repost without a note"
            >
              <X size={14} />
            </button>
          </div>

          <Textarea
            ref={fieldRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={140}
            rows={3}
            placeholder="Say something about this song"
            aria-label="Repost note"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(note);
              }
            }}
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {140 - note.length}
            </span>
            <Button size="sm" onClick={() => submit(note)} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Repost'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/*
 * Two links are worth having. The page address opens this site, and the
 * SoundCloud address opens the original upload for people who would rather use
 * the source. The button asks which one instead of guessing.
 */
function CopyLinkButton({ track, onCopy }) {
  if (!track) return null;
  const here = `${window.location.origin}${trackPath(track)}`;
  const original = track.permalink_url || null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Copy link" aria-label="Copy link">
          <Link2 size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onCopy(here, 'This host')}>
          This host
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => original && onCopy(original, 'SoundCloud')}
          disabled={!original}
        >
          SoundCloud
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
