import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity, Check, Repeat2, Upload } from 'lucide-react';
import { api, timeAgo, formatDate, trackArtistName } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { usePrefs } from '@/prefs.js';
import { Avatar, Artwork, EmptyState, ErrorState } from '@/components/Media.jsx';
import {
  PlayButton,
  LikeButton,
  RepostButton,
  AddToQueueButton,
  AddToPlaylistButton,
} from '@/components/Controls.jsx';
import { Page, TrackList, TrackListSkeleton } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { trackLink, userLink } from '@/lib/scRoute.js';
import { usePlayed } from '@/lib/played.js';
import { cn } from '@/lib/utils.js';

/*
 * A `track` entry is either the artist posting their own track or someone
 * reposting a track by another artist. Only the second reads as a repost, and
 * it has to name the original artist.
 */
function describe(item, track) {
  const actor = item.user;
  const owner = track?.user;
  const ownTrack = actor && owner && String(actor.id) === String(owner.id);
  if (item.type === 'track') return ownTrack ? 'shared a track' : 'reposted a track from';
  if (item.type === 'comment') return 'commented';
  if (item.type === 'like') return 'liked a track';
  if (item.type === 'repost') return 'reposted a track from';
  if (item.type === 'follow') return 'followed someone';
  if (item.type === 'playlist') return 'shared a playlist';
  return 'shared something';
}

/*
 * The two views of Activity are one page, so the switch sits in the header
 * rather than being a route of its own. It is a segmented control: the current
 * view is filled, the other is plain text, and both are one click apart.
 */
function ViewSwitch({ view, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Activity view"
      className="inline-flex items-center gap-0.5 rounded-lg border bg-card p-1"
    >
      {[
        ['sorted', 'Sorted'],
        ['log', 'Log'],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => onChange(id)}
          className={cn(
            // The same shape and weight as the app's buttons, so the switch
            // belongs to the page instead of looking like its own widget.
            'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
            view === id
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/*
 * One row of the plain log: who did what, to which song, and when. The actions
 * stay out rather than appearing on hover, so a song is dealt with from the row
 * without hunting for the buttons first.
 */
function LogEntry({ item, context }) {
  const track = item.track;
  if (!track) return null;
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
      <Link {...userLink(item.user)} className="shrink-0">
        <Avatar src={item.user?.avatar_url} name={item.user?.username} size={34} />
      </Link>
      <Link {...trackLink(track)} className="shrink-0">
        <Artwork
          src={track.artwork_url}
          fallback={track.user?.avatar_url}
          alt={track.title}
          size={52}
          rounded={6}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          {...trackLink(track)}
          className="block truncate text-sm font-medium hover:underline"
        >
          {track.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">
          <Link {...userLink(item.user)} className="hover:text-foreground">
            {item.user?.username || 'Someone'}
          </Link>{' '}
          {describe(item, track)}
          {track.user && String(track.user.id) !== String(item.user?.id) ? (
            <>
              {' '}
              <Link {...userLink(track.user)} className="hover:text-foreground">
                {trackArtistName(track)}
              </Link>
            </>
          ) : null}
          <time
            dateTime={item.created_at}
            title={formatDate(item.created_at)}
            className="cursor-default opacity-60"
          >
            {' '}
            · {timeAgo(item.created_at)}
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
 * One song inside an author's drop down. It is the log row's shape, narrowed to
 * what the Sorted view is about: the song, its own artist credit, and when the
 * author put it out. The badge on the cover says whether that was an upload or
 * a repost, because the same song can arrive either way.
 */
function SortedEntry({ entry, context, played }) {
  const track = entry.track;
  const isRepost = entry.type === 'repost';
  const wasPlayed = !!played[String(track.id)];
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
      <Link {...trackLink(track)} className="relative shrink-0" aria-label={track.title}>
        <Artwork
          src={track.artwork_url}
          fallback={track.user?.avatar_url}
          alt={track.title}
          size={44}
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
          {/*
            * This browser has played the song before. The mark is small and
            * quiet: it is a hint about where the listener left off, not a
            * status that should compete with the title.
            */}
          {wasPlayed ? (
            <span
              title="Played in this browser"
              className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground/80"
            >
              <Check size={11} aria-hidden="true" />
              <span className="sr-only">Played</span>
            </span>
          ) : null}
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
 * One author and their recent songs. The header is taller than a log row
 * because it is the thing you scan first. The songs sit under it, always open
 * and indented past the avatar, so the list reads as one author with their
 * tracks beneath them rather than as a set of folds to open one by one.
 */
function AuthorGroup({ author, context, played }) {
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
            <SortedEntry
              key={`${entry.track.id}-${i}`}
              entry={entry}
              context={context}
              played={played}
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
  // Sorted is the default: what each person put out lately is the question
  // this page is usually opened to answer, and the plain log is one click away.
  const [view, setView] = useState('sorted');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [authors, setAuthors] = useState([]);
  const [sortedLoading, setSortedLoading] = useState(false);
  const [sortedError, setSortedError] = useState(null);

  const days = [5, 7, 10].includes(Number(prefs.sortedDays)) ? Number(prefs.sortedDays) : 7;

  const loadLog = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/me/stream?limit=100');
      setItems(res.collection || []);
    } catch (err) {
      setError(err.message || 'Could not load your activity');
    } finally {
      setLoading(false);
    }
  };

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
    if (isAuthed) loadLog();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed || view !== 'sorted') return;
    loadSorted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, view, days]);

  const logTracks = useMemo(() => items.map((x) => x.track).filter(Boolean), [items]);
  const sortedTracks = useMemo(
    () => authors.flatMap((a) => a.entries.map((e) => e.track)).filter(Boolean),
    [authors]
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
      {/*
       * The switch shares the title's row and is pushed to the right edge, the
       * way a page's main action sits on a list page. On a narrow screen there
       * is no room beside the title, so it drops below instead of crowding it.
       */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight sm:text-3xl">Activity</h1>
          <div className="shrink-0">
            <ViewSwitch view={view} onChange={setView} />
          </div>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {view === 'log'
            ? 'New tracks and reposts from the people you follow on SoundCloud.'
            : `What each person you follow put out in the last ${days} days, newest first.`}
        </p>
      </div>

      {view === 'log' ? (
        loading ? (
          <TrackListSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={loadLog} />
        ) : items.length === 0 ? (
          <EmptyState icon={Activity} title="Nothing in your stream yet">
            Follow artists on SoundCloud and their new tracks will land here.
          </EmptyState>
        ) : (
          <TrackList>
            {items.map((item, i) => (
              <LogEntry key={`${item.track?.id}-${i}`} item={item} context={logTracks} />
            ))}
          </TrackList>
        )
      ) : sortedLoading ? (
        <TrackListSkeleton />
      ) : sortedError ? (
        <ErrorState message={sortedError} onRetry={loadSorted} />
      ) : authors.length === 0 ? (
        <EmptyState icon={Activity} title={`Nothing from the last ${days} days`}>
          The people you follow have not posted or reposted in that window. A longer span is in
          Settings.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {authors.map((author) => (
            <AuthorGroup
              key={author.user?.id}
              author={author}
              context={sortedTracks}
              played={played}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
