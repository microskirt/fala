import { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Heart,
  Repeat2,
  MoreHorizontal,
  ListPlus,
  ListEnd,
  Plus,
  UserPlus,
  Check,
  Loader2,
  Share2,
  Link2,
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export function PlayButton({ track, context, size = 'md', className = '' }) {
  const { playTrack, togglePlay, isCurrent, playing, buffering } = usePlayer();
  const active = isCurrent(track);
  const isPlaying = active && playing;
  const sizeClass = size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : '';

  const handle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) togglePlay();
    else playTrack(track, context);
  };

  return (
    <button
      type="button"
      className={`play-fab ${sizeClass} ${className}`}
      onClick={handle}
      aria-label={isPlaying ? 'Pause' : `Play ${track?.title || 'track'}`}
    >
      {active && buffering && !isPlaying ? (
        <Loader2 size={size === 'lg' ? 24 : 18} className="spin" />
      ) : isPlaying ? (
        <Pause size={size === 'lg' ? 24 : 18} fill="currentColor" />
      ) : (
        <Play size={size === 'lg' ? 24 : 18} fill="currentColor" style={{ marginLeft: 2 }} />
      )}
    </button>
  );
}

export function LikeButton({ track, showCount = false, size = 18, className = '' }) {
  const { isLiked, toggleLike, isBusy } = useLibrary();
  const { user } = useAuth();
  const liked = isLiked(track);
  const busy = isBusy('like:' + track?.id);

  return (
    <button
      type="button"
      className={`like-btn ${liked ? 'liked' : ''} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleLike(track);
      }}
      aria-pressed={liked}
      aria-label={liked ? 'Unlike' : 'Like'}
      title={user ? (liked ? 'Unlike' : 'Like') : 'Sign in to like'}
    >
      <Heart size={size} fill={liked ? 'currentColor' : 'none'} className={busy ? 'pulse' : ''} />
      {showCount && <span>{formatLikeCount(track, liked)}</span>}
    </button>
  );
}

function formatLikeCount(track, liked) {
  const base = Number(track?.likes_count || 0) + (liked && !track?.liked ? 1 : 0);
  if (base >= 1_000_000) return (base / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (base >= 1000) return (base / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(base);
}

export function RepostButton({ track, showCount = false, size = 18, className = '' }) {
  const { isReposted, toggleRepost } = useLibrary();
  const reposted = isReposted(track);
  return (
    <button
      type="button"
      className={`icon-btn ${reposted ? 'active' : ''} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleRepost(track);
      }}
      aria-pressed={reposted}
      aria-label={reposted ? 'Undo repost' : 'Repost'}
      title={reposted ? 'Undo repost' : 'Repost'}
      style={{ width: size + 14, height: size + 14 }}
    >
      <Repeat2 size={size} />
      {showCount && <span style={{ fontSize: 12, marginLeft: 2 }}>{track?.reposts_count || 0}</span>}
    </button>
  );
}

export function FollowButton({ target, size = 'md', className = '' }) {
  const { isFollowing, toggleFollow, isBusy } = useLibrary();
  const { user } = useAuth();
  const following = isFollowing(target);
  const busy = isBusy('follow:' + target?.id);
  const self = user && target && String(user.id) === String(target.id);

  if (self) return null;

  return (
    <button
      type="button"
      className={`btn ${following ? '' : 'primary'} ${size === 'sm' ? 'sm' : ''} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFollow(target);
      }}
      disabled={busy}
    >
      {busy ? (
        <Loader2 size={14} className="spin" />
      ) : following ? (
        <Check size={14} />
      ) : (
        <UserPlus size={14} />
      )}
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

export function AddToPlaylistButton({ track, size = 18, className = '' }) {
  const { playlists, addTrackToPlaylist, createPlaylist } = useLibrary();
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error('Sign in to use playlists');
      return;
    }
    setOpen((v) => !v);
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    const pl = await createPlaylist({ title: title.trim() });
    if (pl) {
      await addTrackToPlaylist(pl.id, track);
      setTitle('');
      setCreating(false);
      setOpen(false);
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`icon-btn ${className}`}
        onClick={handleOpen}
        aria-label="Add to playlist"
        title="Add to playlist"
      >
        <ListPlus size={size} />
      </button>
      {open && (
        <div className="menu right" style={{ minWidth: 260, maxHeight: 320, overflowY: 'auto' }}>
          <div
            className="menu-item"
            style={{ cursor: 'default', fontWeight: 600, color: 'var(--text-dim)' }}
          >
            Add to playlist
          </div>
          <div className="menu-sep" />
          {playlists.length === 0 && !creating && (
            <div style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--text-faint)' }}>
              No playlists yet
            </div>
          )}
          {playlists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              className="menu-item"
              onClick={async () => {
                await addTrackToPlaylist(pl.id, track);
                setOpen(false);
              }}
            >
              <ListPlus size={15} />
              <span className="truncate">{pl.title}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
                {pl.track_count}
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          {creating ? (
            <div style={{ padding: 6, display: 'flex', gap: 6 }}>
              <input
                className="input"
                style={{ height: 30, fontSize: 12.5 }}
                placeholder="Playlist name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <button type="button" className="btn primary sm" onClick={handleCreate}>
                Create
              </button>
            </div>
          ) : (
            <button type="button" className="menu-item" onClick={() => setCreating(true)}>
              <Plus size={15} /> New playlist
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function QueueMenuButton({ track, size = 18 }) {
  const { addToQueue, playNextInQueue } = usePlayer();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="icon-btn"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="More actions"
        title="More"
      >
        <MoreHorizontal size={size} />
      </button>
      {open && (
        <div className="menu right">
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              playNextInQueue(track);
              setOpen(false);
            }}
          >
            <ListEnd size={15} /> Play next
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              addToQueue(track);
              setOpen(false);
            }}
          >
            <ListPlus size={15} /> Add to queue
          </button>
          <div className="menu-sep" />
          <ShareMenuItem track={track} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function ShareMenuItem({ track, onDone }) {
  const toast = useToast();
  const url = track?.permalink_url || '';
  const localUrl = track?.id ? `${window.location.origin}/track/${track.id}` : '';
  const shareUrl = localUrl || url;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy link');
    }
    onDone?.();
  };

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: track?.title, url: shareUrl });
        onDone?.();
        return;
      } catch {}
    }
    copy();
  };

  return (
    <>
      <button type="button" className="menu-item" onClick={copy}>
        <Link2 size={15} /> Copy link
      </button>
      <button type="button" className="menu-item" onClick={nativeShare}>
        <Share2 size={15} /> Share…
      </button>
      {url && (
        <a className="menu-item" href={url} target="_blank" rel="noreferrer">
          <Share2 size={15} /> Open on SoundCloud
        </a>
      )}
    </>
  );
}
