import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Play, Heart, MessageSquare, Repeat2 } from 'lucide-react';
import {
  formatCount,
  formatDate,
  formatRelativeDate,
  trackArtistName,
} from '@/api.js';
import { Artwork, Skeleton } from '@/components/Media.jsx';
import { MiniWaveform, useRowData } from '@/components/MiniWaveform.jsx';
import {
  PlayButton,
  LikeButton,
  RepostButton,
  AddToPlaylistButton,
  AddToQueueButton,
} from '@/components/Controls.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { trackLink } from '@/lib/scRoute.js';
import { buildCommentMarkers } from '@/lib/waveform.js';

/*
 * One song on an artist page, laid out the way SoundCloud lays it out: the
 * cover on the left, then the play button beside the title over its credits, a
 * small waveform with its comments, and a footer with the actions on one side
 * and the numbers on the other. The date and the main tag sit in the top right
 * corner, clear of the title.
 */
export function ArtistTrackRow({ track, context }) {
  const { samples, comments, rowRef } = useRowData(track);
  const { isCurrent, playTrack, seek } = usePlayer();
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
          size={160}
          rounded={8}
        />
      </Link>

      {/*
       * The content is a column the height of the cover, with the title band at
       * the top and the footer at the bottom. The bar is positioned on the
       * column's middle instead of flowing between the two, so its centre is the
       * cover's centre and the footer is not held up short of the bottom edge.
       */}
      <div className="relative flex min-w-0 flex-1 flex-col justify-between">
        {/*
         * Both ends are bands of a set height with their contents centred. The
         * play button is the tallest thing on the left and the buttons are the
         * tallest on the bottom, so a band each keeps their inner margins equal
         * and the entry reads as bracketing the cover evenly.
         */}
        <div className="flex min-h-11 items-center justify-between gap-3">
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

        {/*
         * The bar is taken out of the flow and centred on the column, which is
         * exactly the cover's height. Laying it in the gap between the rows
         * would put its middle below the cover's middle, because the title
         * block is taller than the footer.
         */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">
          <MiniWaveform
            samples={samples}
            markers={markers}
            duration={duration}
            active={active}
            onSeek={(ratio) => {
              /*
               * Starting a song and seeking into it happen together here, so
               * the track id rides along: the player still holds the previous
               * song for a moment, and the spot has to be parked against this
               * one.
               */
              if (!active) playTrack(track, context);
              seek(ratio * duration, track.id);
            }}
          />
        </div>

        {/*
         * Every action stays out, not just the like. A row that hides three of
         * its four buttons makes the listener hunt for them, and on a list this
         * is where the song is dealt with. The footer also ends the same step
         * above the cover's bottom edge as the top row starts below its top
         * edge, so the two bracket the cover evenly and the bar between them
         * lands on the cover's middle.
         */}
        <div className="flex items-center justify-between gap-3">
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
      <Skeleton className="size-40 shrink-0 rounded-lg" />
      <div className="relative flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex min-h-11 items-center gap-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="mt-2 h-2.5 w-1/4" />
          </div>
        </div>
        <Skeleton className="absolute inset-x-0 top-1/2 h-[72px] w-full -translate-y-1/2 rounded" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}
