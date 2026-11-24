import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Play, Heart, MessageSquare, Repeat2 } from 'lucide-react';
import {
  api,
  formatCount,
  formatDate,
  formatDuration,
  formatRelativeDate,
  trackArtistName,
} from '@/api.js';
import { Artwork, Avatar, Skeleton } from '@/components/Media.jsx';
import {
  PlayButton,
  LikeButton,
  RepostButton,
  AddToPlaylistButton,
  AddToQueueButton,
} from '@/components/Controls.jsx';
import { usePlayer, usePlayerTime } from '@/context/PlayerContext.jsx';
import { trackLink } from '@/lib/scRoute.js';
import { cn } from '@/lib/utils.js';
import {
  shapeSamples,
  themeColor,
  barGeometry,
  paintBars,
  buildCommentMarkers,
  markerAtTime,
} from '@/lib/waveform.js';

/*
 * A song's waveform and its comments never change once uploaded, so a list can
 * share them. The maps keep a song's shape and comments after the row scrolls
 * away, and the pending maps make two rows asking at once share one request.
 */
const waveformCache = new Map();
const waveformPending = new Map();
const commentsCache = new Map();
const commentsPending = new Map();

function cap(map, max) {
  if (map.size > max) map.delete(map.keys().next().value);
}

function loadWaveform(track) {
  const url = track?.waveform_url;
  if (!url) return Promise.resolve([]);
  if (waveformCache.has(url)) return Promise.resolve(waveformCache.get(url));
  if (waveformPending.has(url)) return waveformPending.get(url);
  const request = api
    .get(`/api/tracks/${track.id}/waveform?url=${encodeURIComponent(url)}`)
    .then((res) => {
      const samples = res?.samples || [];
      waveformCache.set(url, samples);
      cap(waveformCache, 400);
      return samples;
    })
    .catch(() => [])
    .finally(() => waveformPending.delete(url));
  waveformPending.set(url, request);
  return request;
}

function loadComments(track) {
  const id = track?.id;
  if (!id) return Promise.resolve([]);
  if (commentsCache.has(id)) return Promise.resolve(commentsCache.get(id));
  if (commentsPending.has(id)) return commentsPending.get(id);
  /*
   * The faces need every comment that carries a moment, not just the newest
   * page, so the whole list is asked for at once. A track with none of its own
   * never gets here, because the row only asks when the count is above zero.
   */
  const request = api
    .get(`/api/tracks/${id}/comments?limit=200`)
    .then((res) => {
      const list = res?.collection || [];
      commentsCache.set(id, list);
      cap(commentsCache, 200);
      return list;
    })
    .catch(() => [])
    .finally(() => commentsPending.delete(id));
  commentsPending.set(id, request);
  return request;
}

/*
 * A song only asks for its shape and its comments once it is near the viewport.
 * An artist can list a hundred songs, and fetching all of them at once would put
 * a hundred requests on the server for rows the listener has not scrolled to.
 */
function useRowData(track) {
  const url = track?.waveform_url || '';
  const id = track?.id || null;
  const wantsComments = (track?.comment_count || 0) > 0;
  const [samples, setSamples] = useState(() => (url ? waveformCache.get(url) || null : null));
  const [comments, setComments] = useState(() =>
    id && commentsCache.has(id) ? commentsCache.get(id) : null
  );
  const [near, setNear] = useState(() => !('IntersectionObserver' in globalThis));
  const rowRef = useRef(null);

  useEffect(() => {
    if (near) return undefined;
    const el = rowRef.current;
    if (!el) {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    if (url && !waveformCache.has(url)) {
      loadWaveform(track).then((next) => {
        if (!cancelled) setSamples(next);
      });
    }
    if (wantsComments && id && !commentsCache.has(id)) {
      loadComments(track).then((next) => {
        if (!cancelled) setComments(next);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, url, id, wantsComments]);

  return { samples, comments, rowRef };
}

/*
 * The current time on its own. It subscribes to the playhead, so it is only
 * rendered for the row that is actually loaded: every other row shows a still
 * 0:00 and never re-renders while the song plays.
 */
function LiveCurrentTime() {
  const time = usePlayerTime();
  return (
    <span className="pointer-events-none absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums backdrop-blur-sm">
      {formatDuration(time)}
    </span>
  );
}

/*
 * Watches the playhead for the loaded row and reports the comment it is on. It
 * only exists while this song is the loaded one, so the subscription is one row
 * wide rather than one per song in the list.
 */
function PlayingDriver({ markers, onMarker }) {
  const time = usePlayerTime();
  const marker = useMemo(() => markerAtTime(markers, time), [markers, time]);
  useEffect(() => {
    onMarker(marker);
  }, [marker, onMarker]);
  return null;
}

/*
 * One comment face on the small waveform. It is the same note the big waveform
 * draws, only smaller: a picture hung just under the axis, naming its comment on
 * hover. It is not a control, so it takes no focus and does not seek.
 */
function MiniFace({ marker, active, onEnter, onLeave }) {
  return (
    <span
      role="img"
      className={cn(
        'absolute top-1/2 z-10 mt-1 -translate-x-1/2 rounded-full ring-2 ring-background transition-transform hover:scale-110',
        active && 'scale-110'
      )}
      style={{ left: `${marker.ratio * 100}%` }}
      onMouseEnter={() => onEnter(marker)}
      onMouseLeave={() => onLeave(marker)}
      aria-label={`Comment by ${marker.user?.username || 'a listener'} at ${formatDuration(marker.timeMs)}`}
    >
      <Avatar src={marker.user?.avatar_url} name={marker.user?.username} size={14} />
    </span>
  );
}

/*
 * The comment card for the small waveform, shrunk with the bars and placed just
 * under them so it never hides the shape it belongs to.
 */
function MiniTip({ marker, width }) {
  const TIP = 150;
  const tipWidth = width > 0 ? Math.min(TIP, width) : TIP;
  const left = marker.ratio * width;
  const x = Math.max(0, Math.min(width - tipWidth, left - tipWidth / 2));
  return (
    <div
      className="pointer-events-none absolute top-full z-30 mt-1 rounded-md border bg-popover px-2 py-1 text-left shadow-lg"
      style={{ left: width > 0 ? x : 0, width: tipWidth }}
    >
      <div className="flex items-center gap-1 text-[11px] font-medium">
        <span className="truncate">{marker.user?.username || 'Listener'}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatDuration(marker.timeMs)}
        </span>
        {marker.count > 1 ? (
          <span className="shrink-0 text-muted-foreground">+{marker.count - 1}</span>
        ) : null}
      </div>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{marker.body}</p>
    </div>
  );
}

/*
 * The small waveform under an artist's song row. It is the song page's bar shape
 * in miniature, with its comment faces on the same spots and its own clocks at
 * either end. It is not a seek target, so it reads as the song's signature
 * rather than as a control.
 */
function MiniWaveform({ samples, markers, duration, active, height = 44 }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState(null);
  const [playing, setPlaying] = useState(null);
  const norm = useMemo(() => (samples && samples.length ? shapeSamples(samples) : []), [samples]);
  const geometry = useMemo(() => barGeometry(width), [width]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (!('ResizeObserver' in globalThis)) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const paint = () => {
    paintBars(canvasRef.current, {
      norm,
      width,
      height,
      geometry,
      color: themeColor('--waveform-bar', '#55565f'),
      minBar: 1,
    });
  };

  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, norm, geometry]);

  useEffect(() => {
    const observer = new MutationObserver(() => paint());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, norm, geometry]);

  // A song that stops being the loaded one must not keep a comment up.
  useEffect(() => {
    if (!active) setPlaying(null);
  }, [active]);

  const tip = hovered || playing;

  return (
    <div className="relative mt-2 w-full" style={{ height }} ref={boxRef}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {/* The same hairline axis the song page runs through its bars. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground/25" />

      {markers.map((m) => (
        <MiniFace
          key={m.key}
          marker={m}
          active={tip?.key === m.key}
          onEnter={setHovered}
          onLeave={() => setHovered(null)}
        />
      ))}

      {active ? <PlayingDriver markers={markers} onMarker={setPlaying} /> : null}
      {tip ? <MiniTip marker={tip} width={width} /> : null}

      {/*
        * The clocks read like SoundCloud's own on a list: the playhead on the
        * left, the length on the right, each in a small dark pill so they stay
        * legible over the bars. The big song page keeps its two plain times in
        * the flat strip at the right; this is the list's own shape.
        */}
      {active ? (
        <LiveCurrentTime />
      ) : (
        <span className="pointer-events-none absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums backdrop-blur-sm">
          0:00
        </span>
      )}
      <span className="pointer-events-none absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums text-muted-foreground backdrop-blur-sm">
        {formatDuration(duration)}
      </span>
    </div>
  );
}

/*
 * One song on an artist page, laid out the way SoundCloud lays it out: the
 * cover on the left, then the play button beside the title over its credits, a
 * small waveform with its comments, and a footer with the actions on one side
 * and the numbers on the other. The date and the main tag sit in the top right
 * corner, clear of the title.
 */
export function ArtistTrackRow({ track, context }) {
  const { samples, comments, rowRef } = useRowData(track);
  const { isCurrent } = usePlayer();
  const duration = track?.full_duration || track?.duration || 0;
  // Stays above the early return so the hook order never changes.
  const markers = useMemo(
    () => buildCommentMarkers(comments, duration),
    [comments, duration]
  );
  if (!track) return null;
  const active = isCurrent(track);

  const artist = trackArtistName(track);
  const mainTag = String(track.genre || '').trim();
  const date = track.display_date || null;

  return (
    <div
      className="group -mx-2 flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50"
      ref={rowRef}
    >
      <Link {...trackLink(track)} className="shrink-0 self-start" aria-label={track.title}>
        <Artwork
          src={track.artwork_url}
          fallback={track.user?.avatar_url}
          alt={track.title}
          size={72}
          rounded={6}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {/*
             * The play button lives beside the title rather than over the
             * cover, so a song is started from the row itself and the picture
             * stays a plain way into the song.
             */}
            <PlayButton track={track} context={context} size="sm" className="size-8 shrink-0" />
            <div className="min-w-0">
              {/* The title is the way into the song; the credits are a label. */}
              <Link
                {...trackLink(track)}
                className="block truncate text-sm font-medium hover:underline"
              >
                {track.title}
              </Link>
              {artist ? (
                <div className="truncate text-xs text-muted-foreground">{artist}</div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            {date ? (
              <time
                dateTime={date}
                title={formatDate(date)}
                className="cursor-default text-xs text-muted-foreground"
              >
                {formatRelativeDate(date)}
              </time>
            ) : null}
            {mainTag ? (
              <span
                className="rounded-md border border-white px-2 py-0.5 text-xs text-white"
                title="Main tag"
              >
                {mainTag}
              </span>
            ) : null}
          </div>
        </div>

        <MiniWaveform
          samples={samples}
          markers={markers}
          duration={duration}
          active={active}
        />

        {/*
         * Every action stays out, not just the like. A row that hides three of
         * its four buttons makes the listener hunt for them, and on a list this
         * is where the song is dealt with.
         */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-0.5">
            <LikeButton track={track} size={16} />
            <RepostButton track={track} size={16} iconOnly />
            <AddToPlaylistButton track={track} size={16} />
            <AddToQueueButton track={track} size={16} />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1" title="Plays">
              <Play size={14} fill="currentColor" /> {formatCount(track.playback_count)}
            </span>
            <span className="inline-flex items-center gap-1" title="Likes">
              <Heart size={14} /> {formatCount(track.likes_count)}
            </span>
            <span className="inline-flex items-center gap-1" title="Comments">
              <MessageSquare size={14} /> {formatCount(track.comment_count)}
            </span>
            <span className="inline-flex items-center gap-1" title="Reposts">
              <Repeat2 size={14} /> {formatCount(track.reposts_count)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * The same entry with its content still to come, so the list does not jump when
 * the songs land.
 */
export function ArtistTrackRowSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg px-2 py-2">
      <Skeleton className="size-[72px] shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="mt-2 h-2.5 w-1/4" />
          </div>
        </div>
        <Skeleton className="mt-3 h-11 w-full rounded" />
        <div className="mt-2 flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}
