import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Play, Heart, MessageSquare, Repeat2 } from 'lucide-react';
import { api, formatCount, formatDate, formatRelativeDate, trackArtistName } from '@/api.js';
import { Artwork, Skeleton } from '@/components/Media.jsx';
import {
  PlayButton,
  LikeButton,
  RepostButton,
  AddToPlaylistButton,
  AddToQueueButton,
} from '@/components/Controls.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { trackLink } from '@/lib/scRoute.js';
import { cn } from '@/lib/utils.js';
import { shapeSamples, themeColor, barGeometry, paintBars } from '@/lib/waveform.js';

/*
 * Waveform samples are a few hundred numbers and never change for a song, so a
 * list can share them. The map keeps a song's shape after the row scrolls away,
 * and the pending map makes two rows asking at once share one request.
 */
const waveformCache = new Map();
const waveformPending = new Map();

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
      return samples;
    })
    .catch(() => [])
    .finally(() => waveformPending.delete(url));
  waveformPending.set(url, request);
  return request;
}

/*
 * A song only asks for its waveform once it is near the viewport. An artist can
 * list a hundred songs, and fetching every shape at once would put a hundred
 * requests on the server for rows the listener has not scrolled to yet.
 */
function useWaveform(track) {
  const url = track?.waveform_url || '';
  const [samples, setSamples] = useState(() => (url ? waveformCache.get(url) || null : null));
  const [near, setNear] = useState(() => !url || !('IntersectionObserver' in globalThis));
  const rowRef = useRef(null);

  useEffect(() => {
    if (!url) {
      setSamples(null);
      return undefined;
    }
    if (waveformCache.has(url)) {
      setSamples(waveformCache.get(url));
      return undefined;
    }
    setSamples(null);
    setNear(!('IntersectionObserver' in globalThis));
    return undefined;
  }, [url]);

  useEffect(() => {
    const el = rowRef.current;
    if (!url || near || !el) return undefined;
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
  }, [url, near]);

  useEffect(() => {
    if (!near || !url) return undefined;
    let cancelled = false;
    loadWaveform(track).then((next) => {
      if (!cancelled) setSamples(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, url, track?.id]);

  return { samples, rowRef };
}

/*
 * The small waveform under an artist's song row. It is the song page's bar
 * shape in miniature: two tones around a centre axis, the upper half lit and
 * the lower half shaded. It carries no comment faces and is not a seek target,
 * so it reads as the song's signature rather than as a control.
 */
function MiniWaveform({ samples, height = 36 }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);
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

  return (
    <div className="relative mt-2 w-full" style={{ height }} ref={boxRef} aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* The same hairline axis the song page runs through its bars. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground/25" />
    </div>
  );
}

/*
 * One song on an artist page, laid out the way SoundCloud lays it out: the
 * cover on the left, then the title over the credits, a small waveform, and a
 * footer with the actions on one side and the numbers on the other. The date
 * and the main tag sit in the top right corner, clear of the title.
 */
export function ArtistTrackRow({ track, context }) {
  const { samples, rowRef } = useWaveform(track);
  const { isCurrent } = usePlayer();
  if (!track) return null;
  /*
   * The song that is loaded keeps its play button showing, the way every other
   * list in the app does, so the row you are listening to is the one that
   * reads as active even after the pointer leaves.
   */
  const active = isCurrent(track);

  const artist = trackArtistName(track);
  const mainTag = String(track.genre || '').trim();
  const date = track.display_date || null;

  return (
    <div
      className="group -mx-2 flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50"
      ref={rowRef}
    >
      {/*
       * The play button sits over the cover rather than inside the link, so it
       * is its own control and never a button nested in an anchor.
       */}
      <div className="group/art relative shrink-0 self-start overflow-hidden rounded-md">
        <Link {...trackLink(track)} aria-label={track.title}>
          <Artwork
            src={track.artwork_url}
            fallback={track.user?.avatar_url}
            alt={track.title}
            size={72}
            rounded={6}
          />
        </Link>
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity group-hover/art:pointer-events-auto group-hover/art:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
            active ? 'pointer-events-auto opacity-100' : 'opacity-0'
          )}
        >
          <PlayButton track={track} context={context} size="sm" />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* The title is the way into the song; the credits are just a label. */}
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

        <MiniWaveform samples={samples} />

        <div className="mt-2 flex items-center justify-between gap-3">
          {/*
            * The like button stays out, because it is the one action worth
            * reaching for without hovering. The rest of the song actions come
            * up beside it on hover, so the row stays quiet at rest.
            */}
          <div className="flex items-center gap-0.5">
            <LikeButton track={track} size={16} />
            <div className="pointer-events-none flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
              <RepostButton track={track} size={16} iconOnly />
              <AddToPlaylistButton track={track} size={16} />
              <AddToQueueButton track={track} size={16} />
            </div>
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
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="mt-2 h-2.5 w-1/4" />
        <Skeleton className="mt-3 h-9 w-full rounded" />
        <div className="mt-2 flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}
