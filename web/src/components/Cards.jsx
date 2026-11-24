import { useRef, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Play,
  Heart,
  MessageSquare,
  PlayCircle,
  ListMusic,
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
} from 'lucide-react';
import { Artwork, Avatar } from '@/components/Media.jsx';
import {
  PlayButton,
  LikeButton,
  AddToPlaylistButton,
  AddToQueueButton,
  AddPlaylistToQueueButton,
  QueueMenuButton,
  FollowButton,
} from '@/components/Controls.jsx';
import { formatCount, formatDuration, trackArtistName } from '@/api.js';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { cn } from '@/lib/utils.js';
import { trackLink, userLink, playlistLink } from '@/lib/scRoute.js';

export function TrackCard({ track, context, showStats = true }) {
  const { isCurrent } = usePlayer();
  if (!track) return null;
  /*
   * The button stays on screen for the loaded track, even after the pointer
   * leaves and even while it is paused. On a fresh page load the player already
   * knows what is current, so the right card comes up with its button showing.
   */
  const active = isCurrent(track);
  return (
    <div className="min-w-0">
      {/*
       * The action tray belongs to the cover, not the whole card. Hovering the
       * title, artist or the counts under it used to bring the buttons up too,
       * which read as if the row were one big control. The named group scopes
       * the hover to the artwork alone.
       */}
      <div className="group/art relative overflow-hidden rounded-lg">
        <Link {...trackLink(track)} aria-label={track.title}>
          <Artwork
            src={track.artwork_url}
            fallback={track.user?.avatar_url}
            alt={track.title}
            size="100%"
            rounded={0}
          />
        </Link>
        {/* The overlay is click-through so the artwork link underneath still works. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/60 via-transparent to-transparent p-2.5 transition-opacity group-hover/art:opacity-100 focus-within:opacity-100',
            active ? 'opacity-100' : 'opacity-0'
          )}
        >
          {/*
           * The action tray matches the buttons elsewhere on the page rather
           * than being a pill, so the two shapes do not compete.
           */}
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-md bg-background/85 px-1 py-0.5 shadow-sm backdrop-blur-sm">
            <AddToQueueButton track={track} size={16} />
          </div>
          <div className="pointer-events-auto">
            <PlayButton track={track} context={context} />
          </div>
        </div>
      </div>
      <div className="mt-2.5 min-w-0">
        <Link
          className="block truncate text-sm font-semibold hover:underline"
          {...trackLink(track)}
        >
          {track.title}
        </Link>
        {track.user ? (
          <Link
            className="block truncate text-xs text-muted-foreground hover:text-foreground"
            {...userLink(track.user)}
          >
            {trackArtistName(track)}
          </Link>
        ) : null}
        {showStats ? (
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1" title="Plays">
              <Play size={14} fill="currentColor" /> {formatCount(track.playback_count)}
            </span>
            <span className="inline-flex items-center gap-1" title="Likes">
              <Heart size={14} /> {formatCount(track.likes_count)}
            </span>
            <span className="inline-flex items-center gap-1" title="Comments">
              <MessageSquare size={14} /> {formatCount(track.comment_count)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TrackRow({ track, index, context, showIndex = true, showArt = true }) {
  const { isCurrent } = usePlayer();
  if (!track) return null;
  const isTrack = track.kind === 'track';
  const to = isTrack ? '/track/$id' : '/';
  const params = isTrack ? { id: String(track.id) } : undefined;
  const active = isCurrent(track);

  return (
    /*
     * The hover band bleeds into the page gutter while the row number stays on
     * the same left edge as the heading above it, so list entries never read a
     * step too far right.
     */
    <div className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
      {showIndex ? (
        <div className="relative grid w-7 shrink-0 place-items-center text-xs text-muted-foreground">
          {/*
           * The number gives way to the play button while the pointer is over
           * the row, and stays given way while this is the loaded track, so the
           * button does not blink out when the pointer leaves or the song is
           * paused.
           */}
          <span className={cn('group-hover:opacity-0', active && 'opacity-0')}>
            {typeof index === 'number' ? index + 1 : ''}
          </span>
          {isTrack ? (
            <span
              className={cn(
                'absolute transition-opacity group-hover:opacity-100',
                active ? 'opacity-100' : 'opacity-0'
              )}
            >
              <PlayButton track={track} context={context} size="sm" />
            </span>
          ) : null}
        </div>
      ) : null}
      {showArt ? (
        <Link to={to} params={params} className="shrink-0">
          <Artwork
            src={track.artwork_url}
            fallback={track.user?.avatar_url}
            alt={track.title}
            size={44}
            rounded={6}
          />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <Link to={to} params={params} className="block truncate text-sm font-medium hover:underline">
          {track.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">
          {track.user ? (
            <Link {...userLink(track.user)} className="hover:text-foreground">
              {trackArtistName(track)}
            </Link>
          ) : (
            'Unknown artist'
          )}
          {track.genre ? <span className="mx-1.5 opacity-40">·</span> : null}
          {track.genre}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <LikeButton track={track} size={16} />
        <AddToQueueButton track={track} size={16} />
        <AddToPlaylistButton track={track} size={16} />
        <QueueMenuButton track={track} size={16} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDuration(track.duration)}
      </span>
    </div>
  );
}

export function PlaylistCard({ playlist }) {
  if (!playlist) return null;
  const isSystem =
    playlist.kind === 'system-playlist' || String(playlist.id).startsWith('system:');
  const owner = playlist.user;
  const trackCount = playlist.track_count ?? playlist.tracks?.length ?? 0;

  return (
    <div className="min-w-0">
      {/* The hover tray is scoped to the cover, so the title below does not raise it. */}
      <div className="group/art relative overflow-hidden rounded-lg">
        <Link {...playlistLink(playlist)} className="block" aria-label={playlist.title}>
          {/*
           * A playlist can have no cover of its own. SoundCloud shows the
           * owner's avatar in that case, so pass it as the fallback rather
           * than leaving an empty tile with a music note.
           */}
          <Artwork
            src={playlist.artwork_url}
            fallback={playlist.user?.avatar_url}
            alt={playlist.title}
            size="100%"
            rounded={0}
            kind="playlist"
          />
        </Link>
        {trackCount > 0 ? (
          <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
            <ListMusic size={14} /> {trackCount}
          </span>
        ) : null}
        {/*
         * A mix can be queued without opening it. The tray matches the one on
         * song cards, so the two shapes do not compete, and it sits on the
         * cover where the pointer already goes to open the mix. It is a
         * sibling of the link, never a child, so the two controls cannot
         * swallow each other's clicks.
         */}
        <div className="pointer-events-none absolute inset-0 flex items-end justify-start bg-gradient-to-t from-black/60 via-transparent to-transparent p-2.5 opacity-0 transition-opacity group-hover/art:opacity-100 focus-within:opacity-100">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-md bg-background/85 px-1 py-0.5 shadow-sm backdrop-blur-sm">
            <AddPlaylistToQueueButton playlist={playlist} size={16} />
          </div>
        </div>
      </div>
      <div className="mt-2.5 min-w-0">
        <Link
          {...playlistLink(playlist)}
          className="block truncate text-sm font-semibold hover:underline"
        >
          {playlist.title}
        </Link>
        {/*
         * Recommendation mixes are owned by SoundCloud itself. Printing that
         * under every card says nothing the card does not already say.
         */}
        {owner && !isSystem ? (
          <Link
            {...userLink(owner)}
            className="block truncate text-xs text-muted-foreground hover:text-foreground"
          >
            {owner.username}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function ArtistCard({ user }) {
  if (!user) return null;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/50 px-4 py-6 text-center">
      <Link {...userLink(user)} aria-label={user.username}>
        <Avatar src={user.avatar_url} name={user.username} size={78} />
      </Link>
      <Link
        {...userLink(user)}
        className="mt-1 max-w-full truncate text-sm font-semibold hover:underline"
      >
        {user.username}
      </Link>
      <span className="max-w-full truncate text-xs text-muted-foreground">@{user.permalink}</span>
      <span className="text-xs text-muted-foreground">
        {formatCount(user.followers_count)} follower{(user.followers_count || 0) === 1 ? '' : 's'}
      </span>
      <FollowButton target={user} size="sm" className="mt-1" />
    </div>
  );
}

export function ArtistRow({ user, subtitle }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
      <Link {...userLink(user)} className="shrink-0">
        <Avatar src={user.avatar_url} name={user.username} size={46} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          {...userLink(user)}
          className="inline-flex items-center gap-1 truncate text-sm font-semibold hover:underline"
        >
          {user.username}
          {user.verified ? <BadgeCheck size={14} className="text-primary" /> : null}
        </Link>
        <div className="truncate text-xs text-muted-foreground">@{user.permalink}</div>
        {subtitle ? <div className="line-clamp-1 text-xs text-muted-foreground/80">{subtitle}</div> : null}
      </div>
      <FollowButton target={user} size="sm" />
    </div>
  );
}

export function SectionScroller({ title, subtitle, children, action }) {
  const ref = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [children]);

  const scrollBy = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section className="mb-9">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle ? <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="relative">
        {canPrev ? (
          <button
            type="button"
            className="absolute -left-3 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full border bg-background/95 shadow-md hover:bg-accent"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll left"
          >
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <div
          className="no-scrollbar grid auto-cols-[minmax(160px,1fr)] grid-flow-col gap-4 overflow-x-auto scroll-smooth pb-1"
          ref={ref}
          onScroll={update}
        >
          {children}
        </div>
        {canNext ? (
          <button
            type="button"
            className="absolute -right-3 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full border bg-background/95 shadow-md hover:bg-accent"
            onClick={() => scrollBy(1)}
            aria-label="Scroll right"
          >
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

/*
 * The line under the player: plays only. Likes and comments have their own
 * buttons above, so repeating them here just made the row noisy.
 */
export function TrackStatLine({ track }) {
  if (!track) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <PlayCircle size={14} /> {formatCount(track.playback_count)} plays
      </span>
    </div>
  );
}
