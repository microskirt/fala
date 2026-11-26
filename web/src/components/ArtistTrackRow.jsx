import { memo, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Play, Heart, MessageSquare, Repeat2 } from 'lucide-react';
import {
  formatCount,
  formatDate,
  formatRelativeDate,
  trackArtistName,
} from '@/api.js';
import { Artwork, Skeleton } from '@/components/Media.jsx';
import { Badge } from '@/components/ui/badge.jsx';
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
export const ArtistTrackRow = memo(function ArtistTrackRow({ track, context }) {
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
      {/*
       * The cover takes a fifth of the row on a phone and goes back to its
       * 160px square from `sm`. The column below keeps the height the cover had
       * on the wide layout, so the bar still lands on the cover's middle.
       */}
      <Link
        {...trackLink(track)}
        className="w-20 shrink-0 self-center sm:w-40 sm:self-start"
        aria-label={track.title}
      >
        <Artwork
          src={track.artwork_url}
          fallback={track.user?.avatar_url}
          alt={track.title}
          size="100%"
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
        {/*
         * On a phone the date and tag column is allowed to drop under the title
         * instead of squeezing it to a few letters; `sm:flex-nowrap` restores
         * the single band the wide layout has always used.
         */}
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
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

          <div className="ml-auto flex shrink-0 flex-col items-end gap-1 sm:ml-0">
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
              /*
               * A long genre would otherwise run past the row: the tag caps
               * itself at the corner it lives in and cuts with an ellipsis.
               */
              <Badge
                variant="outline"
                title="Main tag"
                className="max-w-[8rem] truncate border-white text-white sm:max-w-none light:border-foreground light:text-foreground"
              >
                {mainTag}
              </Badge>
            ) : null}
          </div>
        </div>

        {/*
         * The bar is taken out of the flow and centred on the column, which is
         * exactly the cover's height. Laying it in the gap between the rows
         * would put its middle below the cover's middle, because the title
         * block is taller than the footer.
         *
         * A phone cannot afford that: the footer wraps onto a second line, so
         * the column is taller than the cover and a bar pinned to its middle
         * would run under the buttons. There the bar takes its own row between
         * the two bands instead, and only from `sm` is it lifted out again.
         */}
        <div className="w-full py-1 sm:absolute sm:inset-x-0 sm:top-1/2 sm:py-0 sm:-translate-y-1/2">
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
         *
         * On a phone the four buttons and the counts no longer fit on one line,
         * so the footer wraps and the two quietest counts step aside. Plays and
         * likes stay: they are the two people actually read in a list. From
         * `sm` the footer is the single row it always was.
         */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-0.5">
            <LikeButton track={track} size={16} />
            <RepostButton track={track} size={16} iconOnly />
            <AddToPlaylistButton track={track} size={16} />
            <AddToQueueButton track={track} size={16} />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground sm:gap-3">
            <span className="inline-flex items-center gap-1" title="Plays">
              <Play size={14} fill="currentColor" /> {formatCount(track.playback_count)}
            </span>
            <span className="inline-flex items-center gap-1" title="Likes">
              <Heart size={14} /> {formatCount(track.likes_count)}
            </span>
            <span className="hidden items-center gap-1 sm:inline-flex" title="Comments">
              <MessageSquare size={14} /> {formatCount(track.comment_count)}
            </span>
            <span className="hidden items-center gap-1 sm:inline-flex" title="Reposts">
              <Repeat2 size={14} /> {formatCount(track.reposts_count)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

/*
 * The same entry with its content still to come, so the list does not jump when
 * the songs land.
 */
export function ArtistTrackRowSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg px-2 py-2">
      {/* Matches the real row's cover, which is a fifth of the width on a phone. */}
      <Skeleton className="size-20 shrink-0 rounded-lg sm:size-40" />
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
