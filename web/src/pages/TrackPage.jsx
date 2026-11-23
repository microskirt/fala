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
  Music2,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { api, formatDuration, timeAgo, formatDate } from '@/api.js';
import { usePlayer } from '@/context/PlayerContext.jsx';
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
import { Page, CardGrid, Eyebrow } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { cn } from '@/lib/utils.js';

function Waveform({ samples, progress, onSeek, height = 56 }) {
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
      className="flex w-full cursor-pointer items-center gap-px"
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
      role="slider"
      aria-label="Seek within track"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
    >
      {samples.map((s, i) => {
        const played = i / samples.length <= progress;
        const h = Math.max(6, Math.round((s / 255) * height));
        return (
          <span
            key={i}
            className={cn(
              'block w-full rounded-full transition-colors',
              played ? 'bg-primary' : 'bg-muted-foreground/35'
            )}
            style={{ height: h }}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

function CommentForm({ track, onPosted, timestampMs }) {
  const { addComment } = useLibrary();
  const { user } = useAuth();
  const [body, setBody] = useState('');
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

function CommentItem({ comment, onDelete }) {
  const { user } = useAuth();
  const { seek } = usePlayer();
  const canDelete = user && comment.user && String(user.id) === String(comment.user.id);

  return (
    <div className="group flex gap-3 border-b border-border/60 py-3.5 last:border-0">
      <Link to="/artist/$id" params={{ id: String(comment.user?.id) }} className="shrink-0">
        <Avatar src={comment.user?.avatar_url} name={comment.user?.username} size={36} />
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
          {comment.source === 'soundcloud' ? (
            <Badge variant="secondary">SoundCloud</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-relaxed break-words">{comment.body}</p>
      </div>
      {canDelete ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => onDelete(comment.id)}
          aria-label="Delete comment"
        >
          <Trash2 size={14} />
        </Button>
      ) : null}
    </div>
  );
}

export function TrackPage() {
  const { id } = useParams({ from: '/shell/track/$id' });
  const toast = useToast();
  const { playTrack, isCurrent, playing, togglePlay, currentTime, duration, seek, queue } =
    usePlayer();
  const { isReposted, toggleRepost, deleteComment } = useLibrary();

  const [track, setTrack] = useState(null);
  const [related, setRelated] = useState([]);
  const [comments, setComments] = useState([]);
  const [nextComments, setNextComments] = useState(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [waveform, setWaveform] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [commentTimestamp, setCommentTimestamp] = useState(null);

  const active = isCurrent(track);
  const progress = active && duration > 0 ? Math.min(1, currentTime / duration) : 0;

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

        const c = await api.get(`/api/tracks/${id}/comments?limit=100`);
        if (!cancelled) {
          setComments(c.collection || []);
          setNextComments(c.next_href || null);
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
  }, [id]);

  const loadMoreComments = async () => {
    if (!nextComments || loadingComments) return;
    setLoadingComments(true);
    try {
      const res = await api.get(
        `/api/tracks/${id}/comments?next=${encodeURIComponent(nextComments)}`
      );
      setComments((prev) => [...prev, ...(res.collection || [])]);
      setNextComments(res.next_href || null);
    } catch {}
    setLoadingComments(false);
  };

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
  const tags = (track.tag_list || '')
    .split(/\s+/)
    .map((t) => t.replace(/^"|"$/g, ''))
    .filter(Boolean)
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
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Eyebrow className="mb-0">
              <Music2 size={14} /> {track.genre || 'Track'}
            </Eyebrow>
            {track.policy === 'BLOCK' ? <Badge variant="destructive">Unavailable</Badge> : null}
          </div>

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

            <LikeButton track={track} showCount size={18} />

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
            <div className="mt-6 flex items-center gap-3">
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {formatDuration(active ? currentTime : 0)}
              </span>
              <Waveform
                samples={waveform}
                progress={progress}
                onSeek={(ratio) => {
                  if (!active) playTrack(track, contextList);
                  seek(ratio * (track.full_duration || track.duration || 0));
                }}
              />
              <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatDuration(track.duration)}
              </span>
            </div>
          ) : null}

          <div className="mt-5">
            <TrackStatLine track={track} />
          </div>

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

          {tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Link
                  key={tag}
                  to="/search"
                  search={{ q: tag }}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <Tag size={14} /> {tag}
                </Link>
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
          {active ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCommentTimestamp(commentTimestamp ? null : currentTime)}
            >
              {commentTimestamp ? 'Cancel timestamp' : 'Comment at current time'}
            </Button>
          ) : null}
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
            <CommentItem key={c.id} comment={c} onDelete={handleDeleteComment} />
          ))}
        </div>

        {nextComments ? (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={loadMoreComments} disabled={loadingComments}>
              {loadingComments ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ChevronDown size={14} />
              )}
              {loadingComments ? 'Loading…' : 'Load more comments'}
            </Button>
          </div>
        ) : null}
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
