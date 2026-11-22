import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  Heart,
  Repeat2,
  MessageSquare,
  ListPlus,
  Download,
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
import { api, formatCount, formatDuration, timeAgo, formatDate, userPath, trackPath } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Artwork, Avatar, Skeleton, ErrorState, EmptyState } from '../components/Media.jsx';
import { PlayButton, LikeButton, RepostButton, FollowButton, AddToPlaylistButton, QueueMenuButton } from '../components/Controls.jsx';
import { TrackCard, TrackRow, TrackStatLine } from '../components/Cards.jsx';

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
      className="waveform"
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
            className={`bar ${played ? 'played' : ''}`}
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
      <div className="comment-form">
        <div className="notice" style={{ flex: 1 }}>
          <MessageSquare size={15} />
          <span>
            <Link to="/login" className="link-btn">Sign in</Link> to join the conversation.
          </span>
        </div>
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
    <form className="comment-form" onSubmit={submit}>
      <Avatar src={user.avatar_url} name={user.username} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          className="input"
          placeholder={
            timestampMs
              ? `Comment at ${formatDuration(timestampMs)}…`
              : 'Write a comment…'
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
        />
      </div>
      <button type="submit" className="btn primary" disabled={!body.trim() || busy}>
        {busy ? <Loader2 size={14} className="spin" /> : 'Post'}
      </button>
    </form>
  );
}

function CommentItem({ comment, onDelete }) {
  const { user } = useAuth();
  const { seek } = usePlayer();
  const canDelete = user && comment.user && String(user.id) === String(comment.user.id);

  return (
    <div className="comment">
      <Link to={userPath(comment.user)}>
        <Avatar src={comment.user?.avatar_url} name={comment.user?.username} size={36} />
      </Link>
      <div className="body">
        <div className="head">
          <Link to={userPath(comment.user)}>
            <strong>{comment.user?.username || 'Listener'}</strong>
          </Link>
          <span>{timeAgo(comment.created_at)}</span>
          {comment.timestamp_ms != null && (
            <button
              type="button"
              className="stamp"
              onClick={() => seek(comment.timestamp_ms)}
              title="Jump to this moment"
            >
              <Play size={9} fill="currentColor" /> {formatDuration(comment.timestamp_ms)}
            </button>
          )}
          {comment.source === 'soundcloud' && (
            <span className="badge" style={{ height: 18, fontSize: 10 }}>SoundCloud</span>
          )}
        </div>
        <div className="text">{comment.body}</div>
      </div>
      {canDelete && (
        <button
          type="button"
          className="icon-btn sm"
          onClick={() => onDelete(comment.id)}
          aria-label="Delete comment"
          title="Delete comment"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export function TrackPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { playTrack, isCurrent, playing, togglePlay, currentTime, duration, seek, queue } = usePlayer();
  const { isLiked, isReposted, toggleLike, toggleRepost, deleteComment } = useLibrary();

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
          .get(`/api/tracks/${id}/related?limit=12`)
          .then((r) => !cancelled && setRelated(r.collection || []))
          .catch(() => {});

        const c = await api.get(`/api/tracks/${id}/comments?limit=30`);
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
      <div className="content-inner">
        <div className="track-hero">
          <Skeleton h={0} style={{ paddingBottom: '100%' }} r={12} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Skeleton w={120} h={12} />
            <Skeleton w="70%" h={30} />
            <Skeleton w="40%" h={14} />
            <Skeleton w="55%" h={40} style={{ marginTop: 12 }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !track) {
    return (
      <div className="content-inner">
        <ErrorState message={error || 'This track could not be found.'} onRetry={() => navigate(0)} />
      </div>
    );
  }

  const liked = isLiked(track);
  const reposted = isReposted(track);
  const contextList = queue.length && active ? queue : [track, ...related.filter((r) => r.kind === 'track')];
  const tags = (track.tag_list || '')
    .split(/\s+/)
    .map((t) => t.replace(/^"|"$/g, ''))
    .filter(Boolean)
    .slice(0, 12);

  return (
    <div className="content-inner">
      <div className="track-hero">
        <div className="cover">
          <Artwork src={track.artwork_url} alt={track.title} size="100%" rounded={0} />
        </div>

        <div className="detail">
          <div className="eyebrow">
            <Music2 size={13} /> {track.genre || 'Track'}
            {track.policy === 'BLOCK' && <span className="badge accent">Unavailable</span>}
          </div>
          <h1>{track.title}</h1>

          <div className="artist-line">
            {track.user && (
              <>
                <Link to={userPath(track.user)}>
                  <Avatar src={track.user.avatar_url} name={track.user.username} size={30} />
                </Link>
                <Link className="name" to={userPath(track.user)}>
                  {track.user.username}
                </Link>
                {track.user.verified && <BadgeCheck size={15} color="var(--accent)" />}
                <FollowButton target={track.user} size="sm" />
              </>
            )}
          </div>

          <div className="actions">
            <button
              type="button"
              className="play-fab lg"
              onClick={() => (active ? togglePlay() : playTrack(track, contextList))}
              aria-label={active && playing ? 'Pause' : 'Play'}
            >
              {active && playing ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
              )}
            </button>

            <LikeButton track={track} showCount size={19} />
            <button
              type="button"
              className={`btn ${reposted ? '' : 'ghost'}`}
              onClick={() => toggleRepost(track)}
              style={reposted ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              <Repeat2 size={16} /> {reposted ? 'Reposted' : 'Repost'}
            </button>
            <AddToPlaylistButton track={track} size={18} />
            <button type="button" className="icon-btn" onClick={copyLink} title="Copy link" aria-label="Copy link">
              <Link2 size={17} />
            </button>
            {track.permalink_url && (
              <a
                className="icon-btn"
                href={track.permalink_url}
                target="_blank"
                rel="noreferrer"
                title="Open on SoundCloud"
                aria-label="Open on SoundCloud"
              >
                <Share2 size={17} />
              </a>
            )}
          </div>

          {waveform ? (
            <div className="waveform-wrap" style={{ marginTop: 4 }}>
              <span className="wave-time">{formatDuration(active ? currentTime : 0)}</span>
              <Waveform
                samples={waveform}
                progress={progress}
                onSeek={(ratio) => {
                  if (!active) playTrack(track, contextList);
                  seek(ratio * (track.full_duration || track.duration || 0));
                }}
              />
              <span className="wave-time right">{formatDuration(track.duration)}</span>
            </div>
          ) : null}

          <TrackStatLine track={track} />

          {track.description && (
            <div>
              <div className={`description ${descExpanded ? 'expanded' : ''}`}>{track.description}</div>
              {track.description.length > 220 && (
                <button
                  type="button"
                  className="desc-toggle"
                  onClick={() => setDescExpanded((v) => !v)}
                >
                  {descExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          <div className="tag-row">
            {tags.map((tag) => (
              <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`} className="badge">
                <Tag size={10} /> {tag}
              </Link>
            ))}
          </div>

          <div className="meta-line">
            {track.display_date && (
              <span>
                <Calendar size={13} /> {formatDate(track.display_date)}
              </span>
            )}
            {track.label_name && <span>Label: {track.label_name}</span>}
            {track.license && <span>{track.license.replace(/-/g, ' ')}</span>}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>
            <MessageSquare size={18} /> Comments
            <span className="pill-count">{comments.length}</span>
          </h2>
          {active && (
            <button
              type="button"
              className="btn sm"
              onClick={() => setCommentTimestamp(commentTimestamp ? null : currentTime)}
            >
              {commentTimestamp ? 'Cancel timestamp' : 'Comment at current time'}
            </button>
          )}
        </div>

        <CommentForm
          track={track}
          timestampMs={commentTimestamp}
          onPosted={(c) => {
            setComments((prev) => [c, ...prev]);
            setCommentTimestamp(null);
          }}
        />

        <div className="comments">
          {comments.length === 0 && (
            <div className="empty-state" style={{ padding: '28px 20px' }}>
              <p className="muted">No comments yet. Be the first to say something.</p>
            </div>
          )}
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} onDelete={handleDeleteComment} />
          ))}
        </div>

        {nextComments && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn" onClick={loadMoreComments} disabled={loadingComments}>
              {loadingComments ? <Loader2 size={14} className="spin" /> : <ChevronDown size={14} />}
              {loadingComments ? 'Loading…' : 'Load more comments'}
            </button>
          </div>
        )}
      </div>

      {related.length > 0 && (
        <div className="section">
          <div className="section-head">
            <h2>You might also like</h2>
          </div>
          <div className="card-grid">
            {related.map((t) => (
              <TrackCard key={t.id} track={t} context={related} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
