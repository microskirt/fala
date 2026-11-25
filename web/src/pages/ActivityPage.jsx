import { useEffect, useMemo, useState } from 'react';
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
import { Page, TrackListSkeleton } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { trackLink, userLink } from '@/lib/scRoute.js';
import { usePlayed } from '@/lib/played.js';
import { buildCommentMarkers } from '@/lib/waveform.js';

/*
 * One song under its author. The cover, a small waveform, the song and its
 * credit, then the actions. The waveform is the artist page's bar in a shorter
 * form: same shape, same comment faces, same two clocks, but it never opens a
 * comment card, because a compact list is not where a comment is read.
 */
function SortedEntry({ entry, context }) {
  const track = entry.track;
  const isRepost = entry.type === 'repost';
  const { samples, comments, rowRef } = useRowData(track);
  const { isCurrent, playTrack, seek } = usePlayer();
  const duration = track?.full_duration || track?.duration || 0;
  const markers = useMemo(
    () => buildCommentMarkers(comments, duration),
    [comments, duration]
  );
  const active = isCurrent(track);

  return (
    <div
      className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50"
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

      {/*
       * A fixed width, because a bar squeezed by a long title would stop
       * showing where its comments sit. The height sits just under the cover's
       * so the two read as a pair.
       */}
      <div className="w-32 shrink-0 sm:w-44">
        <MiniWaveform
          samples={samples}
          markers={markers}
          duration={duration}
          active={active}
          height={56}
          showTip={false}
          onSeek={(ratio) => {
            /*
             * Starting a song and seeking into it happen together, so the
             * track id rides along: the player still holds the previous song
             * for a moment, and the spot has to be parked against this one.
             */
            if (!active) playTrack(track, context);
            seek(ratio * duration, track.id);
          }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <Link
          {...trackLink(track)}
          className="block truncate text-sm font-medium hover:underline"
        >
          {track.title}
        </Link>
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Link {...userLink(track.user)} className="truncate hover:text-foreground">
            {trackArtistName(track)}
          </Link>
          <span aria-hidden="true" className="shrink-0 opacity-60">
            ·
          </span>
          <time
            dateTime={entry.created_at}
            title={formatDate(entry.created_at)}
            className="shrink-0 cursor-default opacity-60"
          >
            {timeAgo(entry.created_at)}
          </time>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <LikeButton track={track} size={16} />
        <RepostButton track={track} size={16} iconOnly />
        <AddToPlaylistButton track={track} size={16} />
        <AddToQueueButton track={track} size={16} />
        <PlayButton track={track} context={context} size="sm" />
      </div>
    </div>
  );
}

/*
 * One author and their recent songs. The header is taller than a song row
 * because it is the thing you scan first. The songs sit under it, always open
 * and indented past the avatar, so the list reads as one author with their
 * tracks beneath them rather than as a set of folds to open one by one.
 */
function AuthorGroup({ author, context }) {
  const count = author.entries.length;
  return (
    <div className="overflow-hidden rounded-xl border bg-card/60">
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
       */}
      <div className="ml-[3.75rem] border-l border-border/60 px-2 pb-2">
        <div className="flex flex-col gap-0.5">
          {author.entries.map((entry, i) => (
            <SortedEntry key={`${entry.track.id}-${i}`} entry={entry} context={context} />
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
   * A song leaves the view once this browser has played it, so the list only
   * carries what is still unheard. The song loaded in the player is the
   * exception: it stays until the listener moves to another song, because a row
   * vanishing under the button that was just pressed would be a jolt. That also
   * covers a return visit, since nothing is loaded when the page opens again.
   * An author whose songs have all gone drops out with them.
   */
  const visibleAuthors = useMemo(
    () =>
      authors
        .map((author) => {
          const entries = author.entries.filter(
            (e) => !played[String(e.track?.id)] || String(e.track?.id) === currentId
          );
          return { ...author, entries, latest: entries[0]?.created_at ?? author.latest };
        })
        .filter((author) => author.entries.length > 0),
    [authors, played, currentId]
  );

  const sortedTracks = useMemo(
    () => visibleAuthors.flatMap((a) => a.entries.map((e) => e.track)).filter(Boolean),
    [visibleAuthors]
  );

  if (!isAuthed) {
    return (
      <Page>
        <div className="relative mb-6">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Activity</h1>
        </div>
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Activity</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {`What each person you follow put out in the last ${days} days, newest first.`}
        </p>
      </div>

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
            <AuthorGroup key={author.user?.id} author={author} context={sortedTracks} />
          ))}
        </div>
      )}
    </Page>
  );
}
