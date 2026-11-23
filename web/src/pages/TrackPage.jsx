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
  Calendar,
  Tag,
  Trash2,
  ListMusic,
  Disc3,
  Heart,
  Headphones,
} from 'lucide-react';
import { api, formatCount, formatDuration, timeAgo, formatDate } from '@/api.js';
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
import { TrackCard, TrackStatLine } from '@/components/Cards.jsx';
import { Page, CardGrid, LoadMore } from '@/components/layout/Page.jsx';
import { useAutoLoad } from '@/lib/useAutoLoad.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Modal } from '@/components/Modal.jsx';
import { cn } from '@/lib/utils.js';
import { placeLabel } from '@/lib/places.js';

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
function CommentItem({ comment, trackId, onDelete, isReply = false }) {
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
      <Link to="/artist/$id" params={{ id: String(comment.user?.id) }} className="shrink-0">
        <Avatar
          src={comment.user?.avatar_url}
          name={comment.user?.username}
          size={isReply ? 28 : 36}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Link
            to="/artist/$id"
            params={{ id: String(comment.user?.id) }}
            className="text-sm font-semibold text-foreground hover:underline"
          >
            {comment.user?.username || 'Listener'}
          </Link>
          {comment.creator_liked ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.68rem] font-semibold text-primary"
              title="The artist liked this comment"
            >
              <Heart size={11} fill="currentColor" /> Artist
            </span>
          ) : null}
          <span>{timeAgo(comment.created_at)}</span>
          {comment.timestamp_ms != null ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary tabular-nums hover:bg-primary/25"
              onClick={() => seek(comment.timestamp_ms)}
              title="Jump to this moment"
            >
              <Play size={14} fill="currentColor" /> {formatDuration(comment.timestamp_ms)}
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
      to="/artist/$id"
      params={{ id: String(u.id) }}
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
      to="/playlist/$id"
      params={{ id: String(p.id) }}
      className="flex items-center gap-2.5 rounded-md px-1.5 py-2 transition-colors hover:bg-accent/60"
      onClick={onClose}
    >
      <Artwork src={p.artwork_url} alt={p.title} size={38} rounded={4} kind="playlist" />
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
  if (!people || people.length === 0) return null;

  const shown = people.slice(0, 3);
  const rest = people.length - shown.length;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex -space-x-2">
        {shown.map((u) => (
          <Link
            key={u.id}
            to="/artist/$id"
            params={{ id: String(u.id) }}
            className="relative rounded-full ring-2 ring-background"
            title={u.username}
          >
            <Avatar src={u.avatar_url} name={u.username} size={26} />
          </Link>
        ))}
      </div>
      <p className="min-w-0 text-sm text-muted-foreground">
        {shown.map((u, i) => (
          <span key={u.id}>
            <Link
              to="/artist/$id"
              params={{ id: String(u.id) }}
              className="font-medium text-foreground hover:underline"
            >
              {u.username}
            </Link>
            {i < shown.length - 1 ? ', ' : ''}
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
 * The listener ranking SoundCloud keeps behind its insights page. It is ranked by
 * plays inside a time window, and the numbers only come back for a signed in
 * listener, so the panel renders nothing at all when there is no data.
 */
const LISTENER_WINDOWS = [
  { id: 'DAYS_7', label: 'Last 7 days' },
  { id: 'DAYS_30', label: 'Last 30 days' },
  { id: 'ALL_TIME', label: 'All time' },
];

function TopListeners({ trackId }) {
  const [window, setWindow] = useState('DAYS_30');
  const [fans, setFans] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/api/tracks/${trackId}/listeners?window=${window}&limit=5`)
      .then((r) => !cancelled && setFans(r.fans || []))
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
    <section className="mt-4 rounded-xl border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Headphones size={15} /> Top listeners
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
              {w.label}
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
                to="/artist/$id"
                params={{ id: String(entry.user.id) }}
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

export function TrackPage() {
  const { id } = useParams({ from: '/shell/track/$id' });
  const toast = useToast();
  const { playTrack, isCurrent, playing, togglePlay, duration, seek, queue, audioRef } =
    usePlayer();
  const { isReposted, toggleRepost, deleteComment } = useLibrary();
  const { isAuthed } = useAuth();

  const [track, setTrack] = useState(null);
  const [related, setRelated] = useState([]);
  const [comments, setComments] = useState([]);
  const [nextComments, setNextComments] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [listeners, setListeners] = useState(null);
  const [waveform, setWaveform] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [commentTimestamp, setCommentTimestamp] = useState(null);
  const [counts, setCounts] = useState(null);
  const [alsoLiked, setAlsoLiked] = useState([]);

  const active = isCurrent(track);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTrack(null);
    setWaveform(null);
    setComments([]);
    (async () => {
      try {
        const t = await api.get(`/api/tracks/${id}`);
        if (cancelled) return;
        setTrack(t);
        setLoading(false);

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

        if (isAuthed) {
          api
            .get(`/api/tracks/${id}/listeners?limit=5`)
            .then((r) => !cancelled && setListeners(r.fans || []))
            .catch(() => {});
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/track/${track.id}`);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  if (loading) {
    return (
      <Page>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
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

  if (error || !track) {
    return (
      <Page>
        <ErrorState
          message={error || 'This track could not be found.'}
          onRetry={() => window.location.reload()}
        />
      </Page>
    );
  }

  const reposted = isReposted(track);
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

  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[340px] lg:mx-0">
          <Artwork
            src={track.artwork_url}
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

          {track.user ? (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <Link to="/artist/$id" params={{ id: String(track.user.id) }}>
                <Avatar src={track.user.avatar_url} name={track.user.username} size={30} />
              </Link>
              <Link
                to="/artist/$id"
                params={{ id: String(track.user.id) }}
                className="inline-flex items-center gap-1 text-sm font-semibold hover:underline"
              >
                {track.user.username}
                {track.user.verified ? <BadgeCheck size={16} className="text-primary" /> : null}
              </Link>
              <FollowButton target={track.user} size="sm" />
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

            {/*
             * The heart toggles the like. The count next to it is its own
             * button, because clicking a number should show who is behind it
             * rather than like the track a second time.
             */}
            <Link
              to="/track/$id/likes"
              params={{ id: String(id) }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="See who liked this track"
            >
              {formatCount(track.likes_count)} {track.likes_count === 1 ? 'like' : 'likes'}
            </Link>

            {counts?.playlists?.total > 0 ? (
              <Link
                to="/track/$id/playlists"
                params={{ id: String(id) }}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="See the playlists this track is in"
              >
                <ListMusic size={16} />
                {counts.playlists.complete ? '' : 'More than '}
                {formatCount(counts.playlists.total)}{' '}
                {counts.playlists.total === 1 && counts.playlists.complete ? 'playlist' : 'playlists'}
              </Link>
            ) : null}

            {counts?.albums?.total > 0 ? (
              <Link
                to="/track/$id/albums"
                params={{ id: String(id) }}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="See the albums this track is in"
              >
                <Disc3 size={16} />
                {formatCount(counts.albums.total)}{' '}
                {counts.albums.total === 1 ? 'album' : 'albums'}
              </Link>
            ) : null}

            <Button variant={reposted ? 'secondary' : 'ghost'} onClick={() => toggleRepost(track)}>
              <Repeat2 size={16} /> {reposted ? 'Reposted' : 'Repost'}
            </Button>

            <AddToQueueButton track={track} size={18} />

            <AddToPlaylistButton track={track} size={18} />

            <Button variant="ghost" size="icon" onClick={copyLink} title="Copy link" aria-label="Copy link">
              <Link2 size={16} />
            </Button>

            {track.permalink_url ? (
              <Button variant="ghost" size="icon" asChild title="Open on SoundCloud">
                <a href={track.permalink_url} target="_blank" rel="noreferrer" aria-label="Open on SoundCloud">
                  <Share2 size={16} />
                </a>
              </Button>
            ) : null}
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

          <div className="mt-5">
            <TrackStatLine track={track} />
          </div>

          <AlsoLiked people={alsoLiked} />

          {isAuthed ? <TopListeners trackId={track.id} /> : null}

          {track.description ? (
            <div className="mt-4">
              <p
                className={cn(
                  'text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground',
                  !descExpanded && 'line-clamp-4'
                )}
              >
                {track.description}
              </p>
              {track.description.length > 220 ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-primary hover:underline"
                  onClick={() => setDescExpanded((v) => !v)}
                >
                  {descExpanded ? 'Show less' : 'Show more'}
                </button>
              ) : null}
            </div>
          ) : null}

          {mainTag || tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {mainTag ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-white px-2 py-0.5 text-xs text-white"
                  title="Main tag"
                >
                  <Tag size={14} /> {mainTag}
                </span>
              ) : null}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <Tag size={14} /> {tag}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {track.display_date ? (
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} /> {formatDate(track.display_date)}
              </span>
            ) : null}
            {track.label_name ? <span>Label: {track.label_name}</span> : null}
            {track.license ? <span>{track.license.replace(/-/g, ' ')}</span> : null}
          </div>
        </div>
      </div>

      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <MessageSquare size={18} /> Comments
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {comments.length}
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
            />
          ))}
        </div>

        <LoadMore sentinelRef={commentsSentinel} loading={loadingComments} />
      </section>

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
