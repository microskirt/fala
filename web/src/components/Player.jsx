import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
  X,
  Trash2,
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { Artwork } from './Media.jsx';
import { formatDuration, trackPath, userPath } from '../api.js';

function SeekBar({ value, max, onChange, className = '', ariaLabel = 'Seek' }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(null);

  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  const positionFromEvent = (e) => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return Math.min(1, Math.max(0, x / rect.width));
  };

  const commit = (e) => {
    const ratio = positionFromEvent(e);
    onChange?.(ratio * max);
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    ref.current?.setPointerCapture?.(e.pointerId);
    setDragging(true);
    commit(e);
  };

  const onPointerMove = (e) => {
    setHover(positionFromEvent(e));
    if (dragging) commit(e);
  };

  const onPointerUp = (e) => {
    if (dragging) commit(e);
    setDragging(false);
    ref.current?.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={ref}
      className={`seek ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onChange?.(Math.min(max, value + 5000));
        if (e.key === 'ArrowLeft') onChange?.(Math.max(0, value - 5000));
      }}
    >
      <div className="seek-track">
        <div className="seek-fill" style={{ width: `${pct}%` }} />
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
    queue,
    index,
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
    playQueue,
    removeFromQueue,
    clearQueue,
  } = usePlayer();
  const { isLiked, toggleLike } = useLibrary();

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const liked = current ? isLiked(current) : false;

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
    <>
      <div className="player" role="region" aria-label="Player">
        <div className="player-track">
          {current ? (
            <>
              <Link to={trackPath(current)}>
                <Artwork src={current.artwork_url} alt={current.title} size={54} rounded={6} />
              </Link>
              <div className="player-meta">
                <Link className="t" to={trackPath(current)} title={current.title}>
                  {current.title}
                </Link>
                {current.user && (
                  <Link className="a" to={userPath(current.user)} title={current.user.username}>
                    {current.user.username}
                  </Link>
                )}
              </div>
              <div className="player-track-actions">
                <button
                  type="button"
                  className={`icon-btn sm ${liked ? 'active' : ''}`}
                  onClick={() => toggleLike(current)}
                  aria-label={liked ? 'Unlike' : 'Like'}
                  title={liked ? 'Unlike' : 'Like'}
                  style={liked ? { color: '#f43f5e' } : undefined}
                >
                  <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
                </button>
              </div>
            </>
          ) : (
            <div className="player-meta">
              <div className="t muted" style={{ fontWeight: 500 }}>
                Nothing playing
              </div>
              <div className="a">Pick a track to get started</div>
            </div>
          )}
        </div>

        <div className="player-center">
          <div className="transport">
            <button
              type="button"
              className={`icon-btn sm ${shuffle ? 'active' : ''}`}
              onClick={() => setShuffle((s) => !s)}
              aria-pressed={shuffle}
              aria-label="Shuffle"
              title="Shuffle"
            >
              <Shuffle size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={prev}
              disabled={!current}
              aria-label="Previous track"
              title="Previous"
            >
              <SkipBack size={17} fill="currentColor" />
            </button>
            <button
              type="button"
              className="play-btn"
              onClick={togglePlay}
              disabled={!current}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {buffering && !playing ? (
                <Loader2 size={17} className="spin" />
              ) : playing ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />
              )}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={next}
              disabled={!current}
              aria-label="Next track"
              title="Next"
            >
              <SkipForward size={17} fill="currentColor" />
            </button>
            <button
              type="button"
              className={`icon-btn sm ${repeat !== 'off' ? 'active' : ''}`}
              onClick={() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))}
              aria-label={`Repeat: ${repeat}`}
              title={`Repeat: ${repeat}`}
            >
              {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
            </button>
          </div>

          <div className="seek-row">
            <span>{formatDuration(currentTime)}</span>
            <SeekBar
              value={currentTime}
              max={duration || current?.duration || 1}
              onChange={seek}
              ariaLabel="Seek"
            />
            <span>{formatDuration(duration || current?.duration || 0)}</span>
          </div>
          {playbackError && (
            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: -2 }}>{playbackError}</div>
          )}
        </div>

        <div className="player-right">
          <button
            type="button"
            className="icon-btn sm queue-btn"
            onClick={() => setQueueOpen((v) => !v)}
            aria-pressed={queueOpen}
            aria-label="Queue"
            title="Queue"
          >
            <ListMusic size={17} />
          </button>
          <div className="volume">
            <button
              type="button"
              className="icon-btn sm"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              title={muted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon size={16} />
            </button>
            <SeekBar
              value={muted ? 0 : volume}
              max={1}
              onChange={setVolume}
              ariaLabel="Volume"
            />
          </div>
          <button
            type="button"
            className="play-fab sm player-mobile-play"
            onClick={togglePlay}
            disabled={!current}
            style={{ display: 'none' }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
        </div>
      </div>

      {queueOpen && (
        <aside className="queue-panel" aria-label="Queue">
          <div className="queue-head">
            <div>
              <h3 style={{ fontSize: 14 }}>Queue</h3>
              <span className="faint" style={{ fontSize: 11.5 }}>
                {queue.length} track{queue.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="row" style={{ gap: 2 }}>
              {queue.length > 0 && (
                <button
                  type="button"
                  className="icon-btn sm"
                  onClick={clearQueue}
                  title="Clear queue"
                  aria-label="Clear queue"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn sm"
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="queue-list">
            {queue.length === 0 && (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <p>Your queue is empty.</p>
              </div>
            )}
            {queue.map((t, i) => (
              <div key={`${t.id}-${i}`} className={`queue-item ${i === index ? 'active' : ''}`}>
                <button
                  type="button"
                  onClick={() => playQueue(queue, i)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}
                >
                  <Artwork src={t.artwork_url} alt={t.title} size={38} rounded={4} />
                  <span style={{ minWidth: 0, lineHeight: 1.3 }}>
                    <span className="truncate" style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>
                      {t.title}
                    </span>
                    <span className="truncate faint" style={{ display: 'block', fontSize: 11.5 }}>
                      {t.user?.username}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn sm"
                  onClick={() => removeFromQueue(t.id)}
                  aria-label="Remove from queue"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
