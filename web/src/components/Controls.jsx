import { useState } from 'react';
import {
  Play,
  Pause,
  Heart,
  Repeat2,
  ListPlus,
  ListEnd,
  Plus,
  UserPlus,
  Check,
  Loader2,
  Share2,
  Link2,
  MoreHorizontal,
} from 'lucide-react';
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
  DropdownMenuLabel,
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

export function AddToPlaylistButton({ track, size = 18, className }) {
  const { playlists, addTrackToPlaylist, createPlaylist } = useLibrary();
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

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
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next && !user) {
          toast.error('Sign in to use playlists');
          return;
        }
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="Add to playlist">
          <ListPlus size={size} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {playlists.length === 0 && !creating ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No playlists yet</div>
        ) : null}
        {playlists.map((pl) => (
          <DropdownMenuItem
            key={pl.id}
            onClick={async () => {
              await addTrackToPlaylist(pl.id, track);
              setOpen(false);
            }}
          >
            <ListPlus size={16} />
            <span className="truncate">{pl.title}</span>
            <span className="ml-auto text-xs text-muted-foreground">{pl.track_count}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {creating ? (
          <div className="flex items-center gap-1.5 p-1">
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
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <Plus size={16} /> New playlist
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
          <ListEnd size={16} /> Play next
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => addToQueue(track)}>
          <ListPlus size={16} /> Add to queue
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
