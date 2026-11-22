import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { api } from '../api.js';
import { usePrefs } from '../prefs.js';
import { useToast } from './ToastContext.jsx';

const PlayerContext = createContext(null);

const VOLUME_KEY = 'wf.volume';

function readStoredVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
    }
  } catch {}
  return 0.85;
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
  const [playbackError, setPlaybackError] = useState(null);

  const current = index >= 0 && index < queue.length ? queue[index] : null;
  const quality = prefs.quality || 'hq';

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
  }, [volume, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!current) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    const loadId = ++loadIdRef.current;
    let cancelled = false;
    setPlaybackError(null);
    setBuffering(true);
    setCurrentTime(0);
    setDuration(current.full_duration || current.duration || 0);

    (async () => {
      try {
        const info = await api.get(
          `/api/tracks/${current.id}/stream?quality=${encodeURIComponent(quality)}`
        );
        if (cancelled || loadId !== loadIdRef.current) return;

        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const src = info.url;
        const looksHls =
          /\.m3u8(\?|$)/i.test(src) ||
          info.protocol === 'hls' ||
          String(info.mime || '').includes('mpegurl');
        const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl');

        if (looksHls && !nativeHls) {
          const mod = await import('hls.js');
          if (cancelled || loadId !== loadIdRef.current) return;
          const Hls = mod.default || mod;
          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            hls.loadSource(src);
            hls.attachMedia(audio);
            hls.on(Hls.Events.ERROR, (_evt, data) => {
              if (data?.fatal) {
                setPlaybackError('This track could not be streamed right now.');
                setBuffering(false);
                setPlaying(false);
              }
            });
            hlsRef.current = hls;
          } else {
            audio.src = src;
          }
        } else {
          audio.src = src;
        }

        if (info.duration) setDuration(info.duration);
        audio.load();
        if (playingRef.current) {
          try {
            await audio.play();
          } catch {
            setPlaying(false);
          }
        }
      } catch (err) {
        if (cancelled || loadId !== loadIdRef.current) return;
        setPlaybackError(err.message || 'Could not load this track');
        setBuffering(false);
        setPlaying(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, quality]);

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

    const onTime = () => setCurrentTime(audio.currentTime * 1000);
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
    const onError = () => {
      if (!audio.currentSrc) return;
      setBuffering(false);
      setPlaybackError('Playback error — skipping is available in the queue.');
      setPlaying(false);
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [handleEnded]);

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

  const setVolume = useCallback(
    (v) => {
      const clamped = Math.max(0, Math.min(1, v));
      setVolumeState(clamped);
      if (clamped > 0 && muted) setMuted(false);
    },
    [muted]
  );

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const addToQueue = useCallback(
    (track) => {
      if (!track) return;
      setQueue((prev) => {
        if (prev.some((t) => String(t.id) === String(track.id))) return prev;
        if (prev.length === 0) {
          setIndex(0);
          setPlaying(true);
          playingRef.current = true;
        }
        return [...prev, track];
      });
      toast.success('Added to queue');
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
        album: 'Wavefront',
        artwork: current.artwork_url
          ? [{ src: current.artwork_url, sizes: '500x500', type: 'image/jpeg' }]
          : [],
      });
    } catch {}
  }, [current?.id, current?.title, current?.artwork_url, current?.user?.username]);

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
      currentTime,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      queueOpen,
      playbackError,
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
      queue, index, current, playing, buffering, currentTime, duration, volume, muted,
      shuffle, repeat, queueOpen, playbackError, playTrack, playQueue, togglePlay, pause,
      next, prev, seek, setVolume, toggleMute, addToQueue, playNextInQueue, removeFromQueue,
      clearQueue, isCurrent,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
