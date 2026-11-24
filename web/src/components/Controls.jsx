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
  Search,
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

/*
 * `active` is true while this track is the one loaded in the player, playing or
 * paused. Lists use it to keep the button on screen after the pointer leaves,
 * because the song is still the loaded one even when it is paused.
 */
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
  /*
   * The picker opens with a field for narrowing the list. A listener with many
   * playlists should not have to scroll to find one, so the filter sits at the
   * top and takes the focus on open.
   */
  const [query, setQuery] = useState('');
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

  const closePicker = () => {
    setOpen(false);
    setQuery('');
  };

  /*
   * Narrowed by title alone. The field sits above the list and takes the
   * focus on open, so a long list can be cut down by typing straight away.
   */
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? playlists.filter((pl) => (pl.title || '').toLowerCase().includes(needle))
    : playlists;

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
        onClose={closePicker}
        title="Add to playlist"
        description={track?.title ? `Choose where ${track.title} belongs.` : undefined}
      >
        <div className="relative mb-2">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="h-9 pl-8 text-sm"
            placeholder="Search your playlists"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/*
          * A fixed height, not one that grows with the list. The window looks
          * the same whether the account has one playlist or fifty, so opening
          * it never jumps the layout around; the entries scroll inside it.
          * The cap keeps it on screen on a short laptop display.
          */}
        <div className="h-[36rem] max-h-[72vh] space-y-1 overflow-y-auto pr-1">
          {/*
            * Nothing to list means the message sits in the middle of the tall
            * box instead of floating at the top of an otherwise empty area.
            */}
          {!loading && shown.length === 0 ? (
            <div className="grid h-full place-items-center">
              <p className="text-center text-sm text-muted-foreground">
                {playlists.length === 0
                  ? 'You have no playlists yet.'
                  : 'No playlist matches that name.'}
              </p>
            </div>
          ) : null}

          {shown.map((pl) => {
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

/*
 * A mix is queued as a whole, so this has to read its track list first. Cards
 * only carry a summary of the mix, and the playlist page carries the full
 * thing, so fetching here keeps every surface behaving the same way.
 */
export function AddPlaylistToQueueButton({ playlist, size = 16, className }) {
  const { addToQueue } = usePlayer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = playlist?.id != null ? String(playlist.id) : '';
    if (!raw || busy) return;
    setBusy(true);
    try {
      /*
       * Generated mixes arrive as `soundcloud:system-playlists:...` with the
       * kind set, and older callers pass the same id behind a `system:` prefix.
       * Both read through the system playlist route; a normal playlist reads
       * through the sc-playlist one.
       */
      const isSystem =
        playlist?.kind === 'system-playlist' ||
        raw.startsWith('system:') ||
        raw.startsWith('soundcloud:system-playlists:');
      const path = isSystem
        ? `/api/playlists/system:${encodeURIComponent(raw.replace(/^system:/, ''))}`
        : `/api/playlists/sc-playlist:${encodeURIComponent(raw.replace(/^sc:/, ''))}`;
      const res = await api.get(path);
      const tracks = (res.tracks || []).filter((t) => t && t.id);
      if (!tracks.length) {
        toast.error('This mix has no tracks to queue');
        return;
      }
      addToQueue(tracks);
    } catch {
      toast.error('Could not add this mix to the queue');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label="Add mix to queue"
      title="Add mix to queue"
      disabled={busy}
      onClick={add}
    >
      {busy ? <Loader2 size={size} className="animate-spin" /> : <ListEnd size={size} />}
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
