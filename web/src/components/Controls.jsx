import { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  Heart,
  Repeat2,
  ListPlus,
  ListEnd,
  ListStart,
  Plus,
  Minus,
  UserPlus,
  Check,
  Loader2,
  Share2,
  Link2,
  MoreHorizontal,
} from 'lucide-react';
import { api } from '@/api.js';
import { Artwork } from '@/components/Media.jsx';
import { Modal } from '@/components/Modal.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { cn } from '@/lib/utils.js';

export function PlayButton({ track, context, size = 'md', className }) {
  const { playTrack, togglePlay, isCurrent, playing, buffering } = usePlayer();
  const active = isCurrent(track);
  const isPlaying = active && playing;
  const dim = size === 'lg' ? 24 : size === 'sm' ? 16 : 18;

  return (
    <button
      type="button"
      className={cn(
        'grid place-items-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95',
        size === 'lg' ? 'size-14' : size === 'sm' ? 'size-9' : 'size-11',
        className
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (active) togglePlay();
        else playTrack(track, context);
      }}
      aria-label={isPlaying ? 'Pause' : `Play ${track?.title || 'track'}`}
    >
      {active && buffering && !isPlaying ? (
        <Loader2 size={dim} className="animate-spin" />
      ) : isPlaying ? (
        <Pause size={dim} fill="currentColor" />
      ) : (
        <Play size={dim} fill="currentColor" className="ml-0.5" />
      )}
    </button>
  );
}

function formatLikeCount(track, liked) {
  const base = Number(track?.likes_count || 0) + (liked && !track?.liked ? 1 : 0);
  if (base >= 1_000_000) return (base / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (base >= 1000) return (base / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(base);
}

export function LikeButton({ track, showCount = false, size = 18, className }) {
  const { isLiked, toggleLike, isBusy } = useLibrary();
  const { user } = useAuth();
  const liked = isLiked(track);
  const busy = isBusy('like:' + track?.id);

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
        liked ? 'text-rose-500' : 'text-muted-foreground hover:text-foreground',
        className
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleLike(track);
      }}
      aria-pressed={liked}
      aria-label={liked ? 'Unlike' : 'Like'}
      title={user ? (liked ? 'Unlike' : 'Like') : 'Sign in to like'}
    >
      <Heart size={size} fill={liked ? 'currentColor' : 'none'} className={busy ? 'animate-pulse' : ''} />
      {showCount ? <span className="tabular-nums">{formatLikeCount(track, liked)}</span> : null}
    </button>
  );
}

export function RepostButton({ track, size = 18, className }) {
  const { isReposted, toggleRepost } = useLibrary();
  const reposted = isReposted(track);

  return (
    <Button
      variant={reposted ? 'secondary' : 'ghost'}
      size="sm"
      className={cn(reposted && 'text-primary', className)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleRepost(track);
      }}
      aria-pressed={reposted}
    >
      <Repeat2 size={size} /> {reposted ? 'Reposted' : 'Repost'}
    </Button>
  );
}

export function FollowButton({ target, size = 'default', className }) {
  const { isFollowing, toggleFollow, isBusy } = useLibrary();
  const { user } = useAuth();
  const following = isFollowing(target);
  const busy = isBusy('follow:' + target?.id);
  const self = user && target && String(user.id) === String(target.id);

  if (self) return null;

  return (
    <Button
      variant={following ? 'outline' : 'default'}
      size={size}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFollow(target);
      }}
      disabled={busy}
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : following ? (
        <Check size={14} />
      ) : (
        <UserPlus size={14} />
      )}
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}

/*
 * The playlist picker is a real window, not a menu that closes on the first
 * click. A song is often in several lists at once, and each one needs its own
 * answer: Add where it is missing, Remove where it is already there.
 */
export function AddToPlaylistButton({ track, size = 18, className }) {
  const { playlists, addTrackToPlaylist, removeTrackFromPlaylist, createPlaylist } = useLibrary();
  const { user } = useAuth();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  // Playlist ids known to hold this song. Filled from the server, then kept in
  // step locally so the row flips to Remove the moment the write lands.
  const [contained, setContained] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(false);

  const trackId = track?.id;

  useEffect(() => {
    if (!open || !trackId) return undefined;
    let cancelled = false;
    setLoading(true);
    api
      .get(`/api/tracks/${trackId}/playlists?limit=200`)
      .then((res) => {
        if (cancelled) return;
        setContained(new Set((res.collection || []).map((p) => String(p.id))));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, trackId]);

  // A playlist that already lists the song is known to contain it, even when
  // the collection endpoint leaves it out (private lists, for one).
  const has = (pl) =>
    contained.has(String(pl.id)) ||
    (Array.isArray(pl.tracks) && pl.tracks.some((t) => String(t?.id) === String(trackId)));

  const openPicker = () => {
    if (!user) {
      toast.error('Sign in to use playlists');
      return;
    }
    setOpen(true);
  };

  const toggle = async (pl) => {
    const inside = has(pl);
    setBusyId(pl.id);
    const result = inside
      ? await removeTrackFromPlaylist(pl.id, trackId)
      : await addTrackToPlaylist(pl.id, track);
    setBusyId(null);
    if (!result) return;
    setContained((prev) => {
      const next = new Set(prev);
      if (inside) next.delete(String(pl.id));
      else next.add(String(pl.id));
      return next;
    });
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    const pl = await createPlaylist({ title: title.trim() });
    if (!pl) return;
    const added = await addTrackToPlaylist(pl.id, track);
    if (added) setContained((prev) => new Set(prev).add(String(pl.id)));
    setTitle('');
    setCreating(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        onClick={openPicker}
        aria-label="Add to playlist"
        title="Add to playlist"
      >
        <ListPlus size={size} />
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add to playlist"
        description={track?.title ? `Choose where ${track.title} belongs.` : undefined}
      >
        <div className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
          {playlists.length === 0 && !loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              You have no playlists yet.
            </p>
          ) : null}

          {playlists.map((pl) => {
            const inside = has(pl);
            const busy = String(busyId) === String(pl.id);
            return (
              <div
                key={pl.id}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
              >
                <Artwork
                  src={pl.artwork_url}
                  fallback={pl.user?.avatar_url}
                  alt={pl.title}
                  size={40}
                  rounded={6}
                  kind="playlist"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{pl.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {pl.track_count ?? pl.tracks?.length ?? 0} tracks
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={inside ? 'outline' : 'secondary'}
                  className="w-[5.5rem] shrink-0"
                  disabled={busy}
                  onClick={() => toggle(pl)}
                >
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : inside ? (
                    <Minus size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                  {inside ? 'Remove' : 'Add'}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="mt-3 border-t pt-3">
          {creating ? (
            <div className="flex items-center gap-1.5">
              <Input
                className="h-8 text-xs"
                placeholder="Playlist name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <Button size="sm" onClick={handleCreate}>
                Create
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} /> New playlist
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

export function AddToQueueButton({ track, size = 18, className }) {
  const { addToQueue } = usePlayer();
  const toast = useToast();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label="Add to queue"
      title="Add to queue"
      onClick={() => {
        addToQueue(track);
        toast.success('Added to queue');
      }}
    >
      <ListEnd size={size} />
    </Button>
  );
}

export function QueueMenuButton({ track, size = 18 }) {
  const { addToQueue, playNextInQueue } = usePlayer();
  const toast = useToast();

  const shareUrl = track?.id ? `${window.location.origin}/track/${track.id}` : track?.permalink_url || '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More actions">
          <MoreHorizontal size={size} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => playNextInQueue(track)}>
          <ListStart size={16} /> Play next
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => addToQueue(track)}>
          <ListEnd size={16} /> Add to queue
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copy}>
          <Link2 size={16} /> Copy link
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            if (navigator.share) {
              try {
                await navigator.share({ title: track?.title, url: shareUrl });
                return;
              } catch {}
            }
            copy();
          }}
        >
          <Share2 size={16} /> Share…
        </DropdownMenuItem>
        {track?.permalink_url ? (
          <DropdownMenuItem asChild>
            <a href={track.permalink_url} target="_blank" rel="noreferrer">
              <Share2 size={16} /> Open on SoundCloud
            </a>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
