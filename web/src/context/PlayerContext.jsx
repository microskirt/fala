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

/*
 * Volume changes on every pixel of a slider drag, and the player bar is the
 * only thing that shows it. Leaving it in the main context re-rendered every
 * page and card that calls usePlayer, which made the drag feel like it was
 * catching up in steps. Its own context keeps a drag to the bar alone.
 */
const PlayerVolumeContext = createContext(null);

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
  /*
   * Clicking a waveform on a song that is not loaded yet asks for a position
   * the audio element cannot take, because it has no media at that moment. The
   * spot is parked here, with the song it belongs to, and applied once the
   * metadata arrives, so the song starts where the listener clicked instead of
   * at the top.
   */
  const pendingSeekRef = useRef(null);

  const current = index >= 0 && index < queue.length ? queue[index] : null;
  const quality = prefs.quality || 'hq';
  /*
   * The media event listeners are attached once, so they read the loaded track
   * from a ref instead of from a stale closure. A parked seek is only applied
   * to the song it was asked for.
   */
  const currentIdRef = useRef(null);
  useEffect(() => {
    currentIdRef.current = current ? String(current.id) : null;
  }, [current]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  /*
   * The audible change is instant, but the saved value is written once the
   * drag settles. A slider drag fires many times a second, and a synchronous
   * localStorage write on each one is what made the knob feel like it was
   * sticking. Losing the last write on a hard reload is not a real risk.
   */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
    const id = setTimeout(() => writeKey(KEYS.volume, String(volume)), 150);
    return () => clearTimeout(id);
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
        /*
         * A protected track needs a content decryption module to unlock its
         * audio. Without one there is no point attaching the stream: it would
         * only fail while decoding. Say it plainly and stop.
         */
        if (info.drm && typeof navigator.requestMediaKeySystemAccess !== 'function') {
          setBuffering(false);
          setPlaying(false);
          toast.error('This track is protected and cannot be played in this browser');
          return;
        }
        const looksHls =
          /\.m3u8(\?|$)/i.test(src) ||
          info.protocol === 'hls' ||
          info.protocol === 'ctr-encrypted-hls' ||
          String(info.mime || '').includes('mpegurl');
        const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl');
        const drm = !!(info.drm && info.licenseUrl);

        // hls.js owns the media element once attached. Calling audio.load()
        // afterwards resets it and makes the stream error out, which is what
        // used to break playback when switching between queued tracks.
        let usingHls = false;

        /*
         * A protected stream always goes through hls.js, even where native HLS
         * exists, because the native path only knows FairPlay and this manifest
         * is keyed for Widevine.
         */
        if (looksHls && (!nativeHls || drm)) {
          const mod = await import('hls.js');
          if (cancelled || loadId !== loadIdRef.current) return;
          const Hls = mod.default || mod;
          if (!Hls.isSupported() && drm) {
            setBuffering(false);
            setPlaying(false);
            toast.error('This track is protected and cannot be played in this browser');
            return;
          }
          if (Hls.isSupported()) {
            /*
             * A protected upload has no plain stream, so the manifest carries
             * a Widevine key line and the player has to ask a licence server
             * for the key through the browser's own CDM. hls.js does that when
             * `emeEnabled` is on and a licence URL is configured. The licence
             * token from the stream response rides along as `license_token`,
             * which is how SoundCloud's own player authenticates the request.
             */
            const config = { enableWorker: true, lowLatencyMode: false };
            if (drm) {
              const token = info.licenseAuthToken || '';
              config.emeEnabled = true;
              config.drmSystems = {
                'com.widevine.alpha': { licenseUrl: info.licenseUrl },
              };
              config.licenseXhrSetup = (xhr, url) => {
                const target = new URL(url);
                if (token) target.searchParams.set('license_token', token);
                xhr.open('POST', target.toString(), true);
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
              };
            }
            const hls = new Hls(config);
            hls.loadSource(src);
            hls.attachMedia(audio);
            hls.on(Hls.Events.ERROR, (_evt, data) => {
              if (!data?.fatal) return;
              /*
               * A key system that is missing or refuses the licence is not a
               * stale URL, so retrying the same track would ask the same
               * question twice. Say plainly that it cannot play here.
               */
              if (drm && data.type === 'keySystemError') {
                setBuffering(false);
                setPlaying(false);
                toast.error('This track is protected and cannot be played in this browser');
                return;
              }
              failRef.current();
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
      } catch (err) {
        if (cancelled || loadId !== loadIdRef.current) return;
        /*
         * A DRM only track is not a stale URL, so retrying it would just ask
         * the same question twice. Say plainly that it cannot play here.
         */
        if (err?.code === 'DRM_PROTECTED') {
          setBuffering(false);
          setPlaying(false);
          toast.error(err.message || 'This track is protected and cannot be played here');
          return;
        }
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
    /*
     * A click that arrived before the media did is applied here, once the
     * element knows how long the song is. It is dropped if the queue has since
     * moved to a different track, so a slow load never drags a stale position
     * onto the next song.
     */
    const applyPendingSeek = () => {
      const parked = pendingSeekRef.current;
      if (!parked) return;
      if (parked.id && currentIdRef.current && parked.id !== currentIdRef.current) {
        pendingSeekRef.current = null;
        return;
      }
      pendingSeekRef.current = null;
      const seconds = Math.max(0, parked.ms / 1000);
      try {
        audio.currentTime = seconds;
        setCurrentTime(seconds * 1000);
      } catch {}
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

    /*
     * `loadedmetadata` is the first moment the element will accept a position.
     * Both the duration and the parked seek are read there; `durationchange`
     * also fires when a stream reports its length late, so it gets the same
     * treatment.
     */
    const onMeta = () => {
      onDuration();
      applyPendingSeek();
    };

    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('seeked', syncTime);
    return () => {
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onMeta);
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

  const seek = useCallback((ms, trackId) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seconds = Math.max(0, ms / 1000);
    /*
     * A click on a song that has not been loaded yet lands before there is any
     * media, and the element silently ignores a position it cannot take. The
     * spot is parked with the track it belongs to and applied as soon as the
     * metadata is in, so the song starts under the pointer instead of at zero.
     *
     * The caller passes the track id when it is starting a song in the same
     * breath, because the queue state has not landed yet and the current track
     * is still the previous one at this moment.
     */
    const targetId = trackId != null ? String(trackId) : currentIdRef.current;
    /*
     * Parked when the media is not there yet, and also when the caller named a
     * different song than the one loaded: the element still holds the previous
     * stream at that point, and moving its playhead would seek the wrong song.
     */
    const forLoadedSong = !targetId || targetId === currentIdRef.current;
    if (!forLoadedSong || audio.readyState === 0 || !audio.currentSrc) {
      pendingSeekRef.current = { id: targetId, ms: seconds * 1000 };
      setCurrentTime(seconds * 1000);
      return;
    }
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

  /*
   * Clearing means dropping everything that is waiting, not stopping what is
   * playing right now. The current song stays as the only entry, so the sound
   * keeps going and the bar does not go blank under the listener.
   */
  const clearQueue = useCallback(() => {
    setQueue((prev) => {
      const keep = index >= 0 && index < prev.length ? prev[index] : null;
      if (!keep) return [];
      setIndex(0);
      return [keep];
    });
  }, [index]);

  /* Drag and drop in the queue: move one row to another place in the list. */
  const moveInQueue = useCallback((from, to) => {
    setQueue((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const nextQueue = [...prev];
      const [moved] = nextQueue.splice(from, 1);
      nextQueue.splice(to, 0, moved);
      // Follow the playing song so the highlight stays on the right row.
      setIndex((cur) => {
        if (cur === from) return to;
        if (from < cur && to >= cur) return cur - 1;
        if (from > cur && to <= cur) return cur + 1;
        return cur;
      });
      return nextQueue;
    });
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
      setShuffle,
      setRepeat,
      addToQueue,
      playNextInQueue,
      removeFromQueue,
      clearQueue,
      moveInQueue,
      setQueueOpen,
      isCurrent,
      audioRef,
    }),
    [
      queue, index, current, playing, buffering, duration, volume, muted,
      shuffle, repeat, queueOpen, playTrack, playQueue, togglePlay, pause,
      next, prev, seek, setVolume, toggleMute, addToQueue, playNextInQueue, removeFromQueue,
      clearQueue, moveInQueue, isCurrent,
    ]
  );

  const time = useMemo(() => ({ currentTime, duration }), [currentTime, duration]);

  const volumeValue = useMemo(
    () => ({ volume, muted, setVolume, toggleMute }),
    [volume, muted, setVolume, toggleMute]
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={time}>
        <PlayerVolumeContext.Provider value={volumeValue}>
          {children}
          <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />
        </PlayerVolumeContext.Provider>
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

/*
 * Volume and mute live apart from the rest of the player so a slider drag does
 * not re-render every card on the page. Only the player bar reads this.
 */
export function usePlayerVolume() {
  const ctx = useContext(PlayerVolumeContext);
  if (!ctx) throw new Error('usePlayerVolume must be used inside PlayerProvider');
  return ctx;
}
