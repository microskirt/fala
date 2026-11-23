import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { api, artwork } from '../api.js';
import { KEYS, readKey, writeKey } from '../lib/storage.js';
import { usePrefs } from '../prefs.js';
import { useToast } from './ToastContext.jsx';

const PlayerContext = createContext(null);

/*
 * The playhead moves every frame, and the player bar and the song waveform are
 * the only things that care. Keeping it in its own context means a moving
 * progress line never re-renders a page full of comments and cards.
 */
const PlayerTimeContext = createContext(0);

function readStoredVolume() {
  const raw = readKey(KEYS.volume);
  if (raw !== null) {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  }
  return 0.85;
}

const FALLBACK_ART = '/icon-512.png';

function sessionArtwork(track) {
  const direct = track?.artwork_url ? artwork(track.artwork_url, 't500x500') : null;
  const avatar = track?.user?.avatar_url ? artwork(track.user.avatar_url, 't300x300') : null;
  const src = direct || avatar || FALLBACK_ART;
  const type = /\.png(\?|$)/i.test(src) || src === FALLBACK_ART ? 'image/png' : 'image/jpeg';
  return [{ src: new URL(src, window.location.origin).href, sizes: '512x512', type }];
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const playingRef = useRef(false);
  const loadIdRef = useRef(0);
  const [prefs] = usePrefs();
  const toast = useToast();

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(readStoredVolume);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [queueOpen, setQueueOpen] = useState(false);
  /*
   * A signed media URL can go stale while it waits in the queue, and hls.js can
   * be left holding a dead stream. Both are recovered by resolving the track
   * once more, so a bump of this counter re-runs the load for the same song.
   */
  const [reloadKey, setReloadKey] = useState(0);
  const retriedRef = useRef(new Set());
  const failRef = useRef(() => {});

  const current = index >= 0 && index < queue.length ? queue[index] : null;
  const quality = prefs.quality || 'hq';

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
    writeKey(KEYS.volume, String(volume));
  }, [volume, muted]);

  /*
   * Drop whatever is loaded. Used when the song changes and when the queue is
   * emptied: the old stream must stop the instant the choice changes, not when
   * the next one happens to be ready.
   */
  const detach = useCallback(() => {
    const audio = audioRef.current;
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch {}
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!current) {
      detach();
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    const loadId = ++loadIdRef.current;
    let cancelled = false;

    // Before any request goes out: silence the previous track and put the
    // playhead back at zero, so the bar and the audio agree immediately.
    detach();
    setBuffering(true);
    setCurrentTime(0);
    setDuration(current.full_duration || current.duration || 0);

    (async () => {
      try {
        const info = await api.get(
          `/api/tracks/${current.id}/stream?quality=${encodeURIComponent(quality)}`
        );
        if (cancelled || loadId !== loadIdRef.current) return;

        const src = info.url;
        const looksHls =
          /\.m3u8(\?|$)/i.test(src) ||
          info.protocol === 'hls' ||
          String(info.mime || '').includes('mpegurl');
        const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl');

        // hls.js owns the media element once attached. Calling audio.load()
        // afterwards resets it and makes the stream error out, which is what
        // used to break playback when switching between queued tracks.
        let usingHls = false;

        if (looksHls && !nativeHls) {
          const mod = await import('hls.js');
          if (cancelled || loadId !== loadIdRef.current) return;
          const Hls = mod.default || mod;
          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            hls.loadSource(src);
            hls.attachMedia(audio);
            hls.on(Hls.Events.ERROR, (_evt, data) => {
              if (data?.fatal) failRef.current();
            });
            hlsRef.current = hls;
            usingHls = true;
          }
        }

        if (!usingHls) {
          audio.src = src;
          audio.load();
        }

        if (info.duration) setDuration(info.duration);
        if (playingRef.current) {
          try {
            await audio.play();
          } catch (err) {
            // An interrupted play is the caller changing its mind, not a fault.
            if (err?.name !== 'AbortError') failRef.current();
            else setPlaying(false);
          }
        }
      } catch {
        if (cancelled || loadId !== loadIdRef.current) return;
        failRef.current();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, quality, reloadKey]);

  /*
   * A failed load is retried once with a fresh stream URL, because the usual
   * cause is a signed URL that expired while the track sat in the queue. Only
   * when the retry fails too does the listener hear about it, and then as a
   * toast: the player bar is not the place for error text.
   */
  useEffect(() => {
    failRef.current = () => {
      const key = current ? String(current.id) : null;
      setBuffering(false);
      setPlaying(false);
      if (!key) return;
      if (!retriedRef.current.has(key)) {
        retriedRef.current.add(key);
        setReloadKey((n) => n + 1);
        return;
      }
      toast.error('This track will not play. Try another one.');
    };
  }, [current, toast]);

  const handleEnded = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => setPlaying(false));
      return;
    }
    setIndex((cur) => {
      if (queue.length === 0) return cur;
      if (shuffle && queue.length > 1) {
        let nextIdx = cur;
        while (nextIdx === cur) nextIdx = Math.floor(Math.random() * queue.length);
        return nextIdx;
      }
      if (cur + 1 < queue.length) return cur + 1;
      if (repeat === 'all') return 0;
      setPlaying(false);
      return cur;
    });
  }, [queue.length, repeat, shuffle]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration * 1000);
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      setPlaying(true);
    };
    const onCanPlay = () => setBuffering(false);
    const onEnded = () => handleEnded();
    const syncTime = () => setCurrentTime((audio.currentTime || 0) * 1000);
    const onError = () => {
      if (!audio.currentSrc) return;
      // The bar never shows this. A stale stream is retried first, and only a
      // repeat failure reaches the listener, as a toast.
      failRef.current();
    };

    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('seeked', syncTime);
    return () => {
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('seeked', syncTime);
    };
  }, [handleEnded]);

  /*
   * `timeupdate` only fires about four times a second, which is why the bar used
   * to jump in visible steps. Read the element every frame instead; React skips
   * the render while the value is unchanged, so a paused track costs nothing.
   */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setCurrentTime((audio.currentTime || 0) * 1000);
      raf = requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const playQueue = useCallback((tracks, startIndex = 0) => {
    const list = (tracks || []).filter((t) => t && t.id);
    if (!list.length) return;
    const safeIndex = Math.max(0, Math.min(startIndex, list.length - 1));
    setQueue(list);
    setIndex(safeIndex);
    setPlaying(true);
    playingRef.current = true;
  }, []);

  const playTrack = useCallback(
    (track, context) => {
      if (!track) return;
      if (Array.isArray(context) && context.length) {
        const idx = context.findIndex((t) => String(t.id) === String(track.id));
        playQueue(context, idx === -1 ? 0 : idx);
        return;
      }
      setQueue((prev) => {
        const existing = prev.findIndex((t) => String(t.id) === String(track.id));
        if (existing !== -1) {
          setIndex(existing);
          setPlaying(true);
          playingRef.current = true;
          return prev;
        }
        setIndex(prev.length);
        setPlaying(true);
        playingRef.current = true;
        return [...prev, track];
      });
    },
    [playQueue]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch((e) => {
          if (e?.name !== 'AbortError') toast.error('Playback could not start');
        });
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [current, toast]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const next = useCallback(() => {
    if (!queue.length) return;
    setIndex((cur) => {
      if (shuffle && queue.length > 1) {
        let nextIdx = cur;
        while (nextIdx === cur) nextIdx = Math.floor(Math.random() * queue.length);
        return nextIdx;
      }
      if (cur + 1 < queue.length) return cur + 1;
      return repeat === 'all' ? 0 : cur;
    });
    setPlaying(true);
    playingRef.current = true;
  }, [queue.length, shuffle, repeat]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    setIndex((cur) => {
      if (cur > 0) return cur - 1;
      return repeat === 'all' && queue.length ? queue.length - 1 : cur;
    });
    setPlaying(true);
    playingRef.current = true;
  }, [queue.length, repeat]);

  const seek = useCallback((ms) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seconds = Math.max(0, ms / 1000);
    try {
      audio.currentTime = seconds;
      setCurrentTime(seconds * 1000);
    } catch {}
  }, []);

  /*
   * Volume and mute stay in sync: dragging to zero mutes, dragging back up
   * unmutes, and unmuting with a zero volume restores an audible level.
   */
  const setVolume = useCallback((v) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    setMuted(clamped === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (muted) {
      // Coming back from muted with a zeroed bar needs an audible level.
      setVolumeState((cur) => (cur > 0 ? cur : 0.6));
      setMuted(false);
    } else {
      setMuted(true);
    }
  }, [muted]);

  const addToQueue = useCallback(
    (input) => {
      const incoming = (Array.isArray(input) ? input : [input]).filter(Boolean);
      if (incoming.length === 0) return;
      setQueue((prev) => {
        const seen = new Set(prev.map((t) => String(t.id)));
        const added = incoming.filter((t) => !seen.has(String(t.id)));
        if (added.length === 0) return prev;
        if (prev.length === 0) {
          setIndex(0);
          setPlaying(true);
          playingRef.current = true;
        }
        return [...prev, ...added];
      });
      toast.success(incoming.length === 1 ? 'Added to queue' : `Added ${incoming.length} tracks to queue`);
    },
    [toast]
  );

  const playNextInQueue = useCallback(
    (track) => {
      if (!track) return;
      setQueue((prev) => {
        const filtered = prev.filter((t) => String(t.id) !== String(track.id));
        const at = Math.max(0, index + 1);
        return [...filtered.slice(0, at), track, ...filtered.slice(at)];
      });
      toast.success('Playing next');
    },
    [index, toast]
  );

  const removeFromQueue = useCallback((trackId) => {
    setQueue((prev) => {
      const idx = prev.findIndex((t) => String(t.id) === String(trackId));
      if (idx === -1) return prev;
      const nextQueue = prev.filter((_, i) => i !== idx);
      setIndex((cur) => {
        if (idx < cur) return cur - 1;
        if (idx === cur) return Math.min(cur, nextQueue.length - 1);
        return cur;
      });
      return nextQueue;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setIndex(-1);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title || 'Unknown track',
        artist: current.user?.username || 'Unknown artist',
        album: 'Fala',
        artwork: sessionArtwork(current),
      });
    } catch {}
  }, [current?.id, current?.title, current?.artwork_url, current?.user?.username, current?.user?.avatar_url]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      } catch {}
    };
  }, [togglePlay, pause, next, prev]);

  const isCurrent = useCallback(
    (track) => !!current && !!track && String(current.id) === String(track.id),
    [current]
  );

  const value = useMemo(
    () => ({
      queue,
      index,
      current,
      playing,
      buffering,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      queueOpen,
      playTrack,
      playQueue,
      togglePlay,
      pause,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      setShuffle,
      setRepeat,
      addToQueue,
      playNextInQueue,
      removeFromQueue,
      clearQueue,
      setQueueOpen,
      isCurrent,
      audioRef,
    }),
    [
      queue, index, current, playing, buffering, duration, volume, muted,
      shuffle, repeat, queueOpen, playTrack, playQueue, togglePlay, pause,
      next, prev, seek, setVolume, toggleMute, addToQueue, playNextInQueue, removeFromQueue,
      clearQueue, isCurrent,
    ]
  );

  const time = useMemo(() => ({ currentTime, duration }), [currentTime, duration]);

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={time}>
        {children}
        <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />
      </PlayerTimeContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}

export function usePlayerTime() {
  return useContext(PlayerTimeContext);
}
