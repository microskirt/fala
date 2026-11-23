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
} from 'lucide-react';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { Artwork } from '@/components/Media.jsx';
import { formatDuration } from '@/api.js';
import { Slider } from '@/components/ui/slider.jsx';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

/*
 * A thin seek line rather than a full slider row. SoundCloud keeps its bottom
 * bar short, so the scrubber lives above the controls instead of inside them.
 */
function SeekLine({ value, max, onSeek }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  const commit = (clientX) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * max);
  };

  return (
    <div
      ref={ref}
      className="group relative h-1.5 w-full cursor-pointer bg-muted"
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
      <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} />
      <div
        className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: `calc(${pct}% - 5px)` }}
      />
    </div>
  );
}

/*
 * The volume bar lives inside the icon: hovering opens a vertical slider
 * above it, so the bar itself stays as thin as SoundCloud's.
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

      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <div className="flex flex-col items-center gap-2 rounded-lg border bg-popover px-2.5 py-3 shadow-lg">
          <span className="text-[10px] tabular-nums text-muted-foreground">{shown}</span>
          {/* Radix sliders are horizontal, so the vertical bar is a rotated one. */}
          <div className="flex h-24 w-6 items-center justify-center">
            <Slider
              className="w-24 origin-center -rotate-90"
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
      <SeekLine value={currentTime} max={total} onSeek={seek} />

      <div className="flex h-(--player-height) items-center gap-2 px-2.5 sm:gap-3 lg:px-4">
        {/* Transport, kept left so nothing stacks vertically. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('hidden sm:inline-flex', shuffle && toggled)}
            onClick={() => setShuffle((s) => !s)}
            aria-pressed={shuffle}
            aria-label="Shuffle"
            title="Shuffle"
          >
            <Shuffle size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={prev}
            disabled={!current}
            aria-label="Previous"
            title="Previous"
          >
            <SkipBack size={15} fill="currentColor" />
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
            aria-label="Next"
            title="Next"
          >
            <SkipForward size={15} fill="currentColor" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('hidden sm:inline-flex', repeat !== 'off' && toggled)}
            onClick={() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))}
            aria-pressed={repeat !== 'off'}
            aria-label={`Repeat: ${repeat}`}
            title={repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
          >
            {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
          </Button>
          <span className="ml-1.5 hidden shrink-0 text-xs tabular-nums text-muted-foreground md:inline">
            {formatDuration(currentTime)} / {formatDuration(total)}
          </span>
        </div>

        {/* Now playing */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 border-l border-border pl-2.5 sm:pl-3">
          {current ? (
            <>
              <Link to="/track/$id" params={{ id: String(current.id) }} className="shrink-0">
                <Artwork src={current.artwork_url} alt={current.title} size={36} rounded={4} />
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
            </>
          ) : (
            <div className="leading-tight">
              <div className="text-sm font-medium text-muted-foreground">Nothing playing</div>
              <div className="hidden text-xs text-muted-foreground/70 sm:block">
                Pick a track to get started
              </div>
            </div>
          )}
          {playbackError ? (
            <div className="ml-auto shrink-0 text-xs text-destructive">{playbackError}</div>
          ) : null}
        </div>

        {/* Right controls */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(queueOpen && toggled)}
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
