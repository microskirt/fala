import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity, Repeat2, Upload } from 'lucide-react';
import { api, timeAgo, formatDate, trackArtistName } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { usePrefs } from '@/prefs.js';
import { Avatar, Artwork, EmptyState, ErrorState } from '@/components/Media.jsx';
import {
  PlayButton,
  LikeButton,
  RepostButton,
  AddToQueueButton,
  AddToPlaylistButton,
} from '@/components/Controls.jsx';
import { MiniWaveform, useRowData } from '@/components/MiniWaveform.jsx';
import { Page, PageHeader, TrackListSkeleton } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { trackLink, userLink } from '@/lib/scRoute.js';
import { usePlayed, markPlayed, playedKey, isPlayed } from '@/lib/played.js';
import { buildCommentMarkers } from '@/lib/waveform.js';

/*
 * One song under its author. The cover, a small waveform, the song and its
 * credit, then the actions. The waveform is the artist page's bar in a shorter
 * form: same shape, same comment faces, same two clocks, but it never opens a
 * comment card, because a compact list is not where a comment is read.
 */
const SortedEntry = memo(function SortedEntry({ entry, author, context, onPlay, pinned }) {
  const track = entry.track;
  const isRepost = entry.type === 'repost';
  const { samples, comments, rowRef } = useRowData(track);
  const { isCurrent, playTrack, seek } = usePlayer();
  const duration = track?.full_duration || track?.duration || 0;
  const markers = useMemo(
    () => buildCommentMarkers(comments, duration),
    [comments, duration]
  );
  /*
   * Playing is a property of the row, not of the song. The player only knows
   * the song, so two authors who put up the same track both look loaded while
   * one of them is. The row this page started is remembered in `pinned`, and
   * that is what decides which copy carries the playing state.
   */
  const rowKey = playedKey(author?.user?.id, track?.id);
  const active = isCurrent(track) && (!pinned?.key || pinned.key === rowKey);

  /*
   * Starting this row is what marks it heard, and the author is part of the
   * mark. The same song can sit under two people here, so a mark that only knew
   * the song would take both rows away when one of them was opened.
   */
  const choose = useCallback(() => {
    markPlayed(author?.user?.id, track?.id);
    onPlay?.(track, author);
  }, [author, track, onPlay]);

  return (
    /*
     * On a phone the row cannot hold the cover, the title, the bar and five
     * buttons on one line, so it wraps: the cover and title keep the first
     * line, and the bar and buttons share a second one. `sm:contents` puts the
     * pair back as plain children of the row on the wide layout.
     */
    <div
      className="group flex flex-wrap items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50 sm:flex-nowrap"
      ref={rowRef}
    >
      <Link {...trackLink(track)} className="relative shrink-0" aria-label={track.title}>
        <Artwork
          src={track.artwork_url}
          fallback={track.user?.avatar_url}
          alt={track.title}
          size={64}
          rounded={6}
        />
        {/*
         * The mark says how the song reached the author. It is decorative: the
         * cover link already carries the song title, and a label here would be
         * read as a second, competing name for the same link.
         */}
        <span
          title={isRepost ? 'Reposted' : 'Posted'}
          aria-hidden="true"
          className="absolute -bottom-1 -left-1 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm"
        >
          {isRepost ? <Repeat2 size={11} /> : <Upload size={11} />}
        </span>
      </Link>

      <div className="min-w-0 flex-1">
        {/*
         * A long title wraps onto a second line instead of being cut off at the
         * bar. Two lines is the limit: past that the row would grow taller than
         * its own cover, so the clamp adds the ellipsis there. A title that fits
         * on one line keeps the exact place it had, because the block only takes
         * the height its text needs.
         */}
        <Link
          {...trackLink(track)}
          className="line-clamp-2 text-sm font-medium hover:underline"
        >
          {track.title}
        </Link>
        {/*
         * The credit is one flowing line of text rather than three boxes in a
         * row: the name can wrap, and the separator and the time then follow it
         * at the end of that last line instead of being pinned to the right of a
         * truncated name. It is not clamped, because a clamp would swallow the
         * time along with the overflow, and the time is the part that has to stay
         * readable. The time itself never breaks, so "2 days ago" stays one unit.
         */}
        <div className="text-xs text-muted-foreground">
          <Link {...userLink(track.user)} className="hover:text-foreground">
            {trackArtistName(track)}
          </Link>
          <span aria-hidden="true" className="opacity-60">
            {' · '}
          </span>
          <time
            dateTime={entry.created_at}
            title={formatDate(entry.created_at)}
            className="cursor-default whitespace-nowrap opacity-60"
          >
            {timeAgo(entry.created_at)}
          </time>
        </div>
      </div>

      {/*
       * The title and the bar split the space between the cover and the buttons
       * evenly, so the bar always begins at the same point on the row no matter
       * how long the title is. A fixed width gave a short title a long empty
       * stretch and a long title a short bar; an even split keeps every row
       * reading the same way.
       *
       * On a phone there is no room to split: the bar takes a line of its own
       * under the title and the buttons sit under it, so nothing is squeezed
       * to nothing. `sm:contents` hands the pair back to the row on the wide
       * layout, where they keep their old places.
       */}
      <div className="flex basis-full flex-col gap-2 sm:contents">
        <div className="min-w-0 sm:w-auto sm:min-w-0 sm:flex-1">
          <MiniWaveform
            samples={samples}
            markers={markers}
            duration={duration}
            active={active}
            height={64}
            hoverTip
            playingTip={false}
            onSeek={(ratio) => {
              /*
               * Starting a song and seeking into it happen together, so the
               * track id rides along: the player still holds the previous song
               * for a moment, and the spot has to be parked against this one.
               */
              if (!active) {
                playTrack(track, context);
                choose();
              }
              seek(ratio * duration, track.id);
            }}
          />
        </div>

        <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-auto">
          <LikeButton track={track} size={16} />
          <RepostButton track={track} size={16} iconOnly />
          <AddToPlaylistButton track={track} size={16} />
          <AddToQueueButton track={track} size={16} />
          {/* The row, not the button, knows which author this start belongs to. */}
          <PlayButton track={track} context={context} size="sm" onPlay={choose} />
        </div>
      </div>
    </div>
  );
});

/*
 * One author and their recent songs. The header is taller than a song row
 * because it is the thing you scan first. The songs sit under it, always open
 * and indented past the avatar, so the list reads as one author with their
 * tracks beneath them rather than as a set of folds to open one by one.
 */
function AuthorGroup({ author, context, onPlay, pinned }) {
  const count = author.entries.length;
  return (
    /*
     * No `overflow-hidden` here. A comment card on the small waveform hangs
     * below its row, and the last song in a group had that card cut off by the
     * card's own bottom edge. Nothing inside paints out to the rounded corners:
     * the header has no background and the song rows are inset by the padding,
     * so the corner still reads clean while the card is free to show.
     */
    <div className="rounded-xl border bg-card/60">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Link {...userLink(author.user)} className="shrink-0">
          <Avatar src={author.user?.avatar_url} name={author.user?.username} size={48} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            {...userLink(author.user)}
            className="block truncate text-sm font-semibold hover:underline"
          >
            {author.user?.username || 'Someone'}
          </Link>
          <div className="truncate text-xs text-muted-foreground">
            {count} {count === 1 ? 'song' : 'songs'} · latest {timeAgo(author.latest)}
          </div>
        </div>
      </div>
      {/*
       * The rule and the left inset are what make the songs read as belonging
       * to the author above them instead of as the next row in one flat list.
       * A phone cannot spare the full avatar width for that inset, so the songs
       * tuck in closer there and the rule still carries the grouping.
       */}
      <div className="ml-2 border-l border-border/60 px-2 pb-2 sm:ml-[3.75rem]">
        <div className="flex flex-col gap-0.5">
          {author.entries.map((entry, i) => (
            <SortedEntry
              key={`${entry.track.id}-${i}`}
              entry={entry}
              author={author}
              context={context}
              onPlay={onPlay}
              pinned={pinned}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ActivityPage() {
  const { isAuthed } = useAuth();
  const [prefs] = usePrefs();
  const played = usePlayed();
  const { current } = usePlayer();
  const currentId = current?.id ? String(current.id) : null;
  /*
   * The song just started from this list. It is the only played song allowed to
   * stay on screen, and only while the player is still on it: the row would
   * otherwise vanish under the button that was just pressed. The pin is dropped
   * the moment the player holds any other song, so stepping back through the
   * queue to a played song cannot bring its row back.
   */
  const [pinned, setPinned] = useState(null);

  /*
   * The pin names the row, not the song, for the same reason the mark does. The
   * pair is dropped once the player holds a different song, so stepping back
   * through the queue to something already heard cannot bring its row back.
   */
  useEffect(() => {
    if (pinned && pinned.trackId !== currentId) setPinned(null);
  }, [pinned, currentId]);

  const onPlay = useCallback((track, author) => {
    const key = playedKey(author?.user?.id, track?.id);
    if (key) setPinned({ key, trackId: String(track.id) });
  }, []);

  const [authors, setAuthors] = useState([]);
  const [sortedLoading, setSortedLoading] = useState(false);
  const [sortedError, setSortedError] = useState(null);

  const days = [5, 7, 10].includes(Number(prefs.sortedDays)) ? Number(prefs.sortedDays) : 7;

  const loadSorted = async () => {
    setSortedLoading(true);
    setSortedError(null);
    try {
      const res = await api.get(`/api/me/stream/sorted?days=${days}`);
      setAuthors(res.collection || []);
    } catch (err) {
      setSortedError(err.message || 'Could not load the sorted activity');
    } finally {
      setSortedLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthed) return;
    loadSorted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, days]);

  /*
   * The track object is the row's identity. The queue keeps the exact objects
   * this page handed it, so the map below names the one row a track came from
   * even when two authors posted the same song.
   */
  const authorByTrack = useMemo(() => {
    const map = new Map();
    for (const author of authors) {
      for (const entry of author.entries || []) {
        if (entry.track) map.set(entry.track, author.user);
      }
    }
    return map;
  }, [authors]);

  /*
   * The row the player is on stays on screen while it plays; the row it moved
   * away from is the one that leaves. A skip in the player bar changes the song
   * without going through `choose`, and marking the song that was skipped to at
   * the moment it started made it vanish under the finger that had just pressed
   * skip. So the mark lands on the song being left behind, and the song that
   * took its place is pinned, exactly as a row's own play button pins it.
   *
   * The row is found by the track object the player holds. The queue keeps the
   * exact objects this page handed it, and two authors can post the same song,
   * so matching the object names the one row instead of taking every posting of
   * that song away. The refs remember the last song this page accounted for, so
   * opening Activity while something plays from elsewhere does not mark it: only
   * a change of song while the page is up counts.
   */
  const handledIdRef = useRef(null);
  const handledTrackRef = useRef(null);
  useEffect(() => {
    if (!current?.id || !authors.length) return;
    const id = String(current.id);
    if (handledIdRef.current === id) return;

    const previous = handledTrackRef.current;
    handledIdRef.current = id;
    handledTrackRef.current = current;

    // The song being left behind is the one that has now been heard.
    if (previous && String(previous.id) !== id) {
      const prevAuthor = authorByTrack.get(previous);
      if (prevAuthor) {
        markPlayed(prevAuthor.id, previous.id);
      } else {
        /*
         * A queue started elsewhere holds its own copy of the track, so it
         * cannot name the row by object. One author posting it is still
         * unambiguous; two or more are left alone rather than clearing all of
         * them on a guess.
         */
        const posters = authors.filter((a) =>
          (a.entries || []).some((e) => String(e.track?.id) === String(previous.id))
        );
        if (posters.length === 1) markPlayed(posters[0].user?.id, previous.id);
      }
    }

    // The song now playing keeps its row until something else starts.
    const author = authorByTrack.get(current);
    if (author) {
      const key = playedKey(author.user?.id, current.id);
      if (key) setPinned({ key, trackId: id });
    }
  }, [current, authors, authorByTrack]);

  /*
   * A song leaves the view once this browser has played it, so the list only
   * carries what is still unheard. The one exception is the song pinned above,
   * and only while the player is still on it. Filtering on the loaded song
   * instead would resurrect every played song the listener stepped back to.
   * An author whose songs have all gone drops out with them.
   */
  const visibleAuthors = useMemo(
    () =>
      authors
        .map((author) => {
          const entries = author.entries.filter((e) => {
            const key = playedKey(author.user?.id, e.track?.id);
            if (!key) return true;
            /*
             * The mark belongs to this author's posting of this song. A song
             * another author put up is a different row and stays, which is the
             * whole point of storing the pair.
             */
            if (!isPlayed(played, author.user?.id, e.track?.id)) return true;
            return key === pinned?.key;
          });
          return { ...author, entries, latest: entries[0]?.created_at ?? author.latest };
        })
        .filter((author) => author.entries.length > 0),
    [authors, played, pinned]
  );

  const sortedTracks = useMemo(
    () => visibleAuthors.flatMap((a) => a.entries.map((e) => e.track)).filter(Boolean),
    [visibleAuthors]
  );

  if (!isAuthed) {
    return (
      <Page>
        <PageHeader title="Activity" />
        <EmptyState
          icon={Activity}
          title="Connect SoundCloud to see your feed"
          action={
            <Button asChild>
              <Link to="/login">Connect SoundCloud</Link>
            </Button>
          }
        >
          New tracks from people you follow appear here.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Activity"
        description={`What each person you follow put out in the last ${days} days, newest first.`}
      />

      {sortedLoading ? (
        <TrackListSkeleton />
      ) : sortedError ? (
        <ErrorState message={sortedError} onRetry={loadSorted} />
      ) : authors.length === 0 ? (
        <EmptyState icon={Activity} title={`Nothing from the last ${days} days`}>
          The people you follow have not posted or reposted in that window. A longer span is in
          Settings.
        </EmptyState>
      ) : visibleAuthors.length === 0 ? (
        <EmptyState icon={Activity} title="You have heard everything here">
          Songs drop out once you play them. New ones appear as people post.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleAuthors.map((author) => (
            <AuthorGroup
              key={author.user?.id}
              author={author}
              context={sortedTracks}
              onPlay={onPlay}
              pinned={pinned}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
