import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  Volume1,
  VolumeX,
  ListMusic,
  Loader2,
  Heart,
  UserPlus,
  Check,
} from 'lucide-react';
import { usePlayer, usePlayerTime, usePlayerVolume } from '@/context/PlayerContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { Artwork } from '@/components/Media.jsx';
import { formatDuration, trackArtistName } from '@/api.js';
import { Slider } from '@/components/ui/slider.jsx';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';
import { trackLink, userLink } from '@/lib/scRoute.js';

/* A thin line between the two timestamps, the way SoundCloud draws it. */
function SeekLine({ value, max, onSeek }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  const commit = (clientX) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * max);
  };

  return (
    <div
      ref={ref}
      className="group relative h-1 w-full cursor-pointer rounded-full bg-muted"
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
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      <div
        className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: `calc(${pct}% - 5px)` }}
      />
    </div>
  );
}

/*
 * The volume bar lives inside the icon: hovering opens a vertical slider
 * above it, so the bar itself stays as thin as SoundCloud's. The slider is
 * laid out vertically instead of being rotated, which is what used to leave it
 * cramped and make the drag travel along the wrong axis.
 */
function VolumeControl({ volume, muted, icon: Icon, onToggleMute, onVolume }) {
  const shown = muted ? 0 : Math.round(volume * 100);

  return (
    <div className="group relative flex items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleMute}
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
      >
        <Icon size={15} />
      </Button>

      {/*
       * Open state follows the pointer, plus keyboard focus only. A plain
       * focus-within was sticky here: clicking the slider focuses its thumb,
       * and a mouse click never clears that focus, so the popup stayed open
       * after the pointer left. focus-visible is true only for keyboard users,
       * which keeps the slider reachable by tab without pinning the popup open.
       *
       * It also stays open while the thumb is held. The slider is narrow, so a
       * drag that wanders sideways off the track would otherwise drop the
       * hover and hide the popup halfway through the gesture.
       */}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:active]:pointer-events-auto group-has-[:active]:opacity-100">
        <div className="flex flex-col items-center rounded-lg border bg-popover px-2 py-2 shadow-lg">
          {/*
           * The track is thin, but the box around it is wider so the thumb is
           * easy to hit. A 6px grab target was the other half of the drag
           * feeling unreliable.
           */}
          <div className="flex h-32 w-8 items-center justify-center">
            <Slider
              orientation="vertical"
              className="h-full"
              value={[shown]}
              max={100}
              step={1}
              onValueChange={([v]) => onVolume(v / 100)}
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LikeIndicator({ track }) {
  const { isLiked, toggleLike, isBusy } = useLibrary();
  const { user } = useAuth();
  const liked = isLiked(track);
  const busy = isBusy('like:' + track?.id);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(liked && 'text-rose-500 hover:text-rose-500')}
      onClick={() => toggleLike(track)}
      aria-pressed={liked}
      aria-label={liked ? 'Unlike this track' : 'Like this track'}
      title={user ? (liked ? 'Unlike' : 'Like') : 'Sign in to like'}
    >
      <Heart
        size={16}
        fill={liked ? 'currentColor' : 'none'}
        className={busy ? 'animate-pulse' : ''}
      />
    </Button>
  );
}

function FollowIndicator({ user }) {
  const { isFollowing, toggleFollow, isBusy } = useLibrary();
  const { user: me } = useAuth();
  if (!user) return null;
  if (me && String(me.id) === String(user.id)) return null;
  const following = isFollowing(user);
  const busy = isBusy('follow:' + user.id);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(following && 'text-primary hover:text-primary')}
      onClick={() => toggleFollow(user)}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${user.username}` : `Follow ${user.username}`}
      title={following ? 'Following' : 'Follow'}
      disabled={busy}
    >
      {busy ? (
        <Loader2 size={16} className="animate-spin" />
      ) : following ? (
        <Check size={16} />
      ) : (
        <UserPlus size={16} />
      )}
    </Button>
  );
}

export function Player() {
  const {
    current,
    playing,
    buffering,
    shuffle,
    repeat,
    queueOpen,
    togglePlay,
    next,
    prev,
    seek,
    setShuffle,
    setRepeat,
    setQueueOpen,
  } = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  // Volume sits in its own context so dragging the slider re-renders only this
  // bar rather than every page and card that reads the player.
  const { volume, muted, setVolume, toggleMute } = usePlayerVolume();

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const total = duration || current?.duration || 0;

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const toggled = 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary';

  return (
    <div className="shrink-0 border-t border-border bg-card/90 backdrop-blur">
      <div className="flex h-(--player-height) items-center gap-1.5 px-2 sm:gap-3 sm:px-3 lg:px-4">
        {/* 1. Transport */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={prev}
            disabled={!current}
            aria-label="Previous track"
            title="Previous"
          >
            <SkipBack size={16} fill="currentColor" />
          </Button>
          <Button
            size="icon"
            className="rounded-full"
            onClick={togglePlay}
            disabled={!current}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {buffering && !playing ? (
              <Loader2 size={15} className="animate-spin" />
            ) : playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="ml-0.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={next}
            disabled={!current}
            aria-label="Next track"
            title="Next"
          >
            <SkipForward size={16} fill="currentColor" />
          </Button>
        </div>

        {/* 2. Shuffle */}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('hidden shrink-0 sm:inline-flex', shuffle && toggled)}
          onClick={() => setShuffle((s) => !s)}
          aria-pressed={shuffle}
          aria-label="Shuffle"
          title="Shuffle"
        >
          <Shuffle size={15} />
        </Button>

        {/* 3. Loop */}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('hidden shrink-0 sm:inline-flex', repeat !== 'off' && toggled)}
          onClick={() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))}
          aria-pressed={repeat !== 'off'}
          aria-label={`Repeat: ${repeat}`}
          title={repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
        >
          {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
        </Button>

        {/* 4. Elapsed, line, total */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {formatDuration(currentTime)}
          </span>
          <div className="min-w-[60px] flex-1">
            <SeekLine value={currentTime} max={total} onSeek={seek} />
          </div>
          <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatDuration(total)}
          </span>
        </div>

        {/* 5. Now playing: two lines, never taller than the thumbnail */}
        <div className="flex w-[190px] shrink-0 items-center gap-2 overflow-hidden lg:w-[260px]">
          {current ? (
            <>
              <Link
                {...trackLink(current)}
                className="shrink-0"
                title={current.title}
              >
                <Artwork
                  src={current.artwork_url}
                  fallback={current.user?.avatar_url}
                  alt={current.title}
                  size={40}
                  rounded={4}
                />
              </Link>
              <div className="flex h-10 min-w-0 flex-col justify-center leading-tight">
                {current.user ? (
                  <Link
                    {...userLink(current.user)}
                    className="truncate text-xs text-muted-foreground hover:text-foreground"
                  >
                    {trackArtistName(current)}
                  </Link>
                ) : null}
                <Link
                  {...trackLink(current)}
                  className="truncate text-sm font-semibold hover:underline"
                  title={current.title}
                >
                  {current.title}
                </Link>
              </div>
            </>
          ) : (
            <div className="leading-tight text-muted-foreground">
              <div className="text-xs">Nothing playing</div>
              <div className="text-sm font-medium">Pick a track</div>
            </div>
          )}
        </div>

        {/* 6 and 7. Like, follow */}
        <div className="flex shrink-0 items-center gap-0.5">
          {current ? <LikeIndicator track={current} /> : null}
          {current?.user ? <FollowIndicator user={current.user} /> : null}
        </div>

        {/* Extras SoundCloud keeps on the far right */}
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('hidden sm:inline-flex', queueOpen && toggled)}
            data-queue-toggle=""
            onClick={() => setQueueOpen((v) => !v)}
            aria-pressed={queueOpen}
            aria-label="Queue"
            title="Queue"
          >
            <ListMusic size={15} />
          </Button>
          <div className="hidden md:block">
            <VolumeControl
              volume={volume}
              muted={muted}
              icon={VolumeIcon}
              onToggleMute={toggleMute}
              onVolume={setVolume}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
