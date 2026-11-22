import { useEffect } from 'react';
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
  Heart,
  Loader2,
} from 'lucide-react';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { Artwork } from '@/components/Media.jsx';
import { formatDuration } from '@/api.js';
import { Slider } from '@/components/ui/slider.jsx';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

export function Player() {
  const {
    current,
    playing,
    buffering,
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    queueOpen,
    playbackError,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    setShuffle,
    setRepeat,
    setQueueOpen,
  } = usePlayer();
  const { isLiked, toggleLike } = useLibrary();

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const liked = current ? isLiked(current) : false;
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

  return (
    <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur">
      <div className="grid h-(--player-height) grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 sm:grid-cols-[minmax(0,1fr)_minmax(240px,2fr)_minmax(0,1fr)] lg:px-4">
        {/* Now playing */}
        <div className="flex min-w-0 items-center gap-2.5">
          {current ? (
            <>
              <Link to="/track/$id" params={{ id: String(current.id) }} className="shrink-0">
                <Artwork src={current.artwork_url} alt={current.title} size={48} rounded={6} />
              </Link>
              <div className="min-w-0 leading-tight">
                <Link
                  to="/track/$id"
                  params={{ id: String(current.id) }}
                  className="block truncate text-sm font-semibold hover:underline"
                  title={current.title}
                >
                  {current.title}
                </Link>
                {current.user ? (
                  <Link
                    to="/artist/$id"
                    params={{ id: String(current.user.id) }}
                    className="block truncate text-xs text-muted-foreground hover:text-foreground"
                  >
                    {current.user.username}
                  </Link>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('ml-1 hidden shrink-0 sm:inline-flex', liked && 'text-rose-500')}
                onClick={() => toggleLike(current)}
                aria-label={liked ? 'Unlike' : 'Like'}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </Button>
            </>
          ) : (
            <div className="leading-tight">
              <div className="text-sm font-medium text-muted-foreground">Nothing playing</div>
              <div className="text-xs text-muted-foreground/70">Pick a track to get started</div>
            </div>
          )}
        </div>

        {/* Transport */}
        <div className="hidden flex-col items-center gap-1 sm:flex">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(shuffle && 'text-primary')}
              onClick={() => setShuffle((s) => !s)}
              aria-pressed={shuffle}
              aria-label="Shuffle"
            >
              <Shuffle size={16} />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={prev} disabled={!current} aria-label="Previous">
              <SkipBack size={16} fill="currentColor" />
            </Button>
            <Button
              size="icon"
              className="rounded-full"
              onClick={togglePlay}
              disabled={!current}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {buffering && !playing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : playing ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" className="ml-0.5" />
              )}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={next} disabled={!current} aria-label="Next">
              <SkipForward size={16} fill="currentColor" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(repeat !== 'off' && 'text-primary')}
              onClick={() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))}
              aria-label={`Repeat: ${repeat}`}
            >
              {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </Button>
          </div>

          <div className="flex w-full items-center gap-2 text-xs tabular-nums text-muted-foreground">
            <span className="w-9 text-right">{formatDuration(currentTime)}</span>
            <Slider
              value={[total > 0 ? (currentTime / total) * 100 : 0]}
              max={100}
              step={0.1}
              onValueChange={([v]) => seek((v / 100) * total)}
              aria-label="Seek"
            />
            <span className="w-9">{formatDuration(total)}</span>
          </div>
          {playbackError ? (
            <div className="text-xs text-destructive">{playbackError}</div>
          ) : null}
        </div>

        {/* Right controls */}
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(queueOpen && 'text-primary')}
            onClick={() => setQueueOpen((v) => !v)}
            aria-pressed={queueOpen}
            aria-label="Queue"
          >
            <ListMusic size={16} />
          </Button>
          <div className="hidden items-center gap-1.5 md:flex">
            <Button variant="ghost" size="icon-sm" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
              <VolumeIcon size={16} />
            </Button>
            <Slider
              className="w-24"
              value={[muted ? 0 : volume * 100]}
              max={100}
              step={1}
              onValueChange={([v]) => setVolume(v / 100)}
              aria-label="Volume"
            />
          </div>
          <Button
            size="icon"
            className="rounded-full sm:hidden"
            onClick={togglePlay}
            disabled={!current}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
