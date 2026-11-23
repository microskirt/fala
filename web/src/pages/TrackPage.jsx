import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  Play,
  Pause,
  Repeat2,
  MessageSquare,
  Share2,
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
import { Page, CardGrid, LoadMore } from '@/components/layout/Page.jsx';
import { useAutoLoad } from '@/lib/useAutoLoad.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { Modal } from '@/components/Modal.jsx';
import { cn } from '@/lib/utils.js';
import { placeLabel } from '@/lib/places.js';
import { ClampedText } from '@/components/ClampedText.jsx';
import { resolveTrackParam, playlistLink, userLink, trackSubLink } from '@/lib/scRoute.js';

function Waveform({ samples, progress, onSeek, height = 96 }) {
  const ref = useRef(null);
  const dragging = useRef(false);

  if (!samples || samples.length === 0) return null;

  const commit = (clientX) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek?.(ratio);
  };

  return (
    <div
      className="group relative flex w-full cursor-pointer items-center gap-[2px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      ref={ref}
      style={{ height }}
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
      aria-label="Seek within track"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
    >
      {samples.map((s, i) => {
        const played = i / samples.length <= progress;
        // A small floor keeps quiet passages visible as a thin baseline.
        const h = Math.max(3, Math.round((s / 255) * height));
        return (
          <span
            key={i}
            className={cn(
              'block w-full rounded-[1px] transition-colors',
              played ? 'bg-primary' : 'bg-muted-foreground/30 group-hover:bg-muted-foreground/45'
            )}
            style={{ height: h }}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

/*
 * The waveform subscribes to the playhead on its own, so a moving progress
 * line never re-renders the comment list or the related tracks below it.
 */
function WaveformPlayer({ track, samples, active, onSeek, durationMs }) {
  const { currentTime, duration } = usePlayerTime();
  const total = duration || durationMs || 0;
  const progress = active && total > 0 ? Math.min(1, currentTime / total) : 0;

  return (
    <div className="mt-6 flex items-center gap-3">
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatDuration(active ? currentTime : 0)}
      </span>
      <Waveform samples={samples} progress={progress} onSeek={onSeek} />
      <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDuration(track.duration)}
      </span>
    </div>
  );
}

/* Reads the playhead itself so only this button re-renders while playing. */
function TimestampToggle({ active, value, onChange }) {
  const { currentTime } = usePlayerTime();
  if (!active) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onChange(value == null ? currentTime : null)}
    >
      {value == null ? 'Comment at current time' : `Comment at ${formatDuration(value)}`}
    </Button>
  );
}

function CommentForm({ track, onPosted, timestampMs, replyTo = null }) {
  const { addComment } = useLibrary();
  const { user } = useAuth();
  /*
   * SoundCloud has no parent-comment field. A reply is an ordinary comment whose
   * body opens with the other person's @handle, which is also how the thread is
   * rebuilt when it is read back. So the handle is seeded here instead of being
   * sent as a separate relation.
   */
  const [body, setBody] = useState(replyTo?.user?.permalink ? `@${replyTo.user.permalink} ` : '');
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
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

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    const comment = await addComment(track.id, body.trim(), timestampMs);
    if (comment) {
      setBody('');
      onPosted?.(comment);
    }
    setBusy(false);
  };

  return (
    <form className="flex items-center gap-2.5" onSubmit={submit}>
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
          <span>{timeAgo(comment.created_at)}</span>
          {/*
           * The timestamp used to be a themed pill, which made it read like a
           * button competing with the comment itself. It now looks like the
           * "time ago" beside it and only lifts to white on hover, which is
           * enough to show it can be clicked.
           */}
          {comment.timestamp_ms != null ? (
            <button
              type="button"
              className="tabular-nums transition-colors hover:text-foreground"
              onClick={() => seek(comment.timestamp_ms)}
              title="Jump to this moment"
            >
              {formatDuration(comment.timestamp_ms)}
            </button>
          ) : null}
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
  // How many pictures fit when `reserve` pixels stay free on the right.
  const fit = (reserve) =>
    rowWidth ? Math.max(1, Math.floor((rowWidth - reserve - FACE) / STEP) + 1) : 3;
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
 */
const LISTENER_WINDOWS = [
  { id: 'ALL_TIME', label: 'All time' },
  { id: 'DAYS_7', label: 'First 7 days' },
];

function TopListeners({ trackId }) {
  const [window, setWindow] = useState('ALL_TIME');
  const [fans, setFans] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/api/tracks/${trackId}/listeners?window=${window}&limit=5`)
      .then((r) => {
        if (cancelled) return;
        setFans(r.fans || []);
        if (r.days) setDays(r.days);
      })
      .catch(() => !cancelled && setFans([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [trackId, window]);

  // A track with no plays in the window has no ranking, and an empty box would
  // just be noise under the player.
  if (!loading && (!fans || fans.length === 0)) return null;

  return (
    <section className="rounded-xl border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          Top listeners
        </h3>
        <div className="flex gap-1">
          {LISTENER_WINDOWS.map((w) => (
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
              {w.id === 'DAYS_7' ? `First ${days} days` : w.label}
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
        <ol className="mt-2.5 space-y-0.5">
          {fans.map((entry, i) => (
            <li key={`${entry.user.id}-${i}`}>
              <Link
                {...userLink(entry.user)}
                className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/60"
              >
                <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <Avatar src={entry.user.avatar_url} name={entry.user.username} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-sm font-medium">
                    {entry.user.username}
                    {entry.user.verified ? (
                      <BadgeCheck size={13} className="shrink-0 text-primary" />
                    ) : null}
                  </span>
                  {placeLabel(entry.user.city, entry.user.country_code) ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {placeLabel(entry.user.city, entry.user.country_code)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatCount(entry.plays)} {entry.plays === 1 ? 'play' : 'plays'}
                </span>
              </Link>
            </li>
          ))}
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
      <h2 className="text-sm font-semibold tracking-tight">Artist</h2>

      <div className="mt-3 flex items-center gap-3">
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
 * The three numbers a listener cares about. Plays are just a number, while
 * likes and reposts lead to the people behind them, which is why those two are
 * links and the play count is not.
 */
function TrackStats({ track }) {
  const row = 'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors';
  return (
    <section className="rounded-xl border bg-card px-3 py-3">
      <h2 className="px-2 text-sm font-semibold tracking-tight">Stats</h2>
      <div className="mt-2 space-y-0.5">
        <div className={cn(row, 'text-muted-foreground')}>
          <span className="inline-flex items-center gap-1.5">
            <PlayCircle size={14} /> Plays
          </span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatCount(track.playback_count)}
          </span>
        </div>
        <Link
          {...trackSubLink(track, 'likes')}
          className={cn(row, 'text-muted-foreground hover:bg-accent hover:text-foreground')}
          title="See who liked this track"
        >
          <span className="inline-flex items-center gap-1.5">
            <Heart size={14} /> Likes
          </span>
          <span className="font-semibold tabular-nums">{formatCount(track.likes_count)}</span>
        </Link>
        <Link
          {...trackSubLink(track, 'reposts')}
          className={cn(row, 'text-muted-foreground hover:bg-accent hover:text-foreground')}
          title="See who reposted this track"
        >
          <span className="inline-flex items-center gap-1.5">
            <Repeat2 size={14} /> Reposts
          </span>
          <span className="font-semibold tabular-nums">{formatCount(track.reposts_count)}</span>
        </Link>
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
  const [commentTimestamp, setCommentTimestamp] = useState(null);
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

  if (loading) {
    return (
      <Page>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="flex flex-col gap-3.5">
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

  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[280px] lg:mx-0">
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

        <div className="min-w-0">
          {track.policy === 'BLOCK' ? (
            <div className="mb-2">
              <Badge variant="destructive">Unavailable</Badge>
            </div>
          ) : null}

          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {track.title}
          </h1>

          {/*
           * The song's own credits, not the uploader. SoundCloud keeps them in
           * publisher_metadata.artist and they often differ from the account
           * that posted the file. The date sits next to them, relative at first
           * glance and spelled out in full on hover.
           */}
          {metaArtist || track.display_date ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              {metaArtist ? <span className="min-w-0 break-words">{metaArtist}</span> : null}
              {metaArtist && track.display_date ? <span aria-hidden="true">-</span> : null}
              {track.display_date ? (
                <time
                  dateTime={track.display_date}
                  title={formatDate(track.display_date)}
                  className="cursor-default"
                >
                  {formatRelativeDate(track.display_date)}
                </time>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95"
              onClick={() => (active ? togglePlay() : playTrack(track, contextList))}
              aria-label={active && playing ? 'Pause' : 'Play'}
            >
              {active && playing ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" className="ml-0.5" />
              )}
            </button>

            <LikeButton track={track} size={18} />

            <RepostControl track={track} />

            <AddToQueueButton track={track} size={18} />

            <AddToPlaylistButton track={track} size={18} />

            <ShareButton track={track} onCopy={copyLink} />
          </div>

          {waveform ? (
            <WaveformPlayer
              track={track}
              samples={waveform}
              active={active}
              durationMs={track.full_duration || track.duration || 0}
              onSeek={(ratio) => {
                if (!active) playTrack(track, contextList);
                seek(ratio * (track.full_duration || track.duration || 0));
              }}
            />
          ) : null}
        </div>
      </div>

      {/*
       * Below the player the page splits: the words run down the left, and the
       * facts about the song and its artist sit in a narrower column on the
       * right. The comments lose a little width to make room for it, which is
       * the whole point of the split.
       */}
      <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
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

            {track.description ? (
              <ClampedText text={track.description} lines={5} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No description was written for this song.
              </p>
            )}
          </section>

          <section className="mt-12">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                Comments
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                  {commentTotal}
                </span>
              </h2>
              <TimestampToggle
                active={active}
                value={commentTimestamp}
                onChange={setCommentTimestamp}
              />
            </div>

            <CommentForm
              track={track}
              timestampMs={commentTimestamp}
              onPosted={(c) => {
                setComments((prev) => [c, ...prev]);
                setCommentTotal((n) => n + 1);
                setCommentTimestamp(null);
              }}
            />

            <div className="mt-4">
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
          <AlsoLiked people={alsoLiked} />
          {isAuthed ? <TopListeners trackId={track.id} /> : null}
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
 * Two links lead to the same song, so the choice is shown instead of guessed:
 * this copy of the page, or the original on SoundCloud.
 */
function ShareButton({ track, onCopy }) {
  if (!track) return null;
  const here = `${window.location.origin}${trackPath(track)}`;
  const rows = [
    { id: 'fala', label: 'This page', url: here, icon: Link2 },
    track.permalink_url
      ? { id: 'sc', label: 'SoundCloud', url: track.permalink_url, icon: Share2 }
      : null,
  ].filter(Boolean);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Copy link" aria-label="Copy link">
          <Link2 size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            /*
             * Selecting an item closes the menu on its own, so the only work
             * here is handing the address to the copy helper, which raises the
             * toast. No dialog and no page wide overlay.
             */
            <DropdownMenuItem key={row.id} onSelect={() => onCopy(row.url, row.label)}>
              <Icon size={16} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{row.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
