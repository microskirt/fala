import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { api } from '../api.js';
import { useAuth } from './AuthContext.jsx';
import { useCaptcha } from './CaptchaContext.jsx';
import { useToast } from './ToastContext.jsx';

/*
 * Everything here talks to the user's real SoundCloud account through the
 * proxy. Nothing is stored locally beyond the token in api.js.
 */

const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const { solve: solveCaptcha } = useCaptcha();

  // A blocked write means SoundCloud wants its bot check solved. Show it, then
  // retry the same request once with the result in place.
  const withCaptcha = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (err) {
        if (err?.code !== 'captcha') throw err;
        const solved = await solveCaptcha();
        if (!solved) throw err;
        return fn();
      }
    },
    [solveCaptcha]
  );

  // Optimistic overrides for this session, layered over SoundCloud's state.
  const [liked, setLiked] = useState(() => new Map());
  const [reposted, setReposted] = useState(() => new Map());
  const [followed, setFollowed] = useState(() => new Map());
  const [busy, setBusy] = useState(() => new Set());
  const [playlists, setPlaylists] = useState([]);
  const [counts, setCounts] = useState({ likes: 0, playlists: 0, following: 0, reposts: 0 });
  // Artists followed during this session, so the following list grows at once
  // instead of waiting for a refetch to notice the new row.
  const [recentFollows, setRecentFollows] = useState([]);

  const markBusy = (key, on) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const isBusy = useCallback((key) => busy.has(key), [busy]);

  const isLiked = useCallback(
    (track) => {
      if (!track) return false;
      const override = liked.get(String(track.id));
      return override === undefined ? !!track.liked : override;
    },
    [liked]
  );

  const isReposted = useCallback(
    (track) => {
      if (!track) return false;
      const override = reposted.get(String(track.id));
      return override === undefined ? !!track.reposted : override;
    },
    [reposted]
  );

  const isFollowing = useCallback(
    (target) => {
      if (!target) return false;
      const override = followed.get(String(target.id));
      return override === undefined ? !!target.is_following : override;
    },
    [followed]
  );

  /* ------------------------------ refresh ------------------------------ */

  const refreshLibrary = useCallback(async () => {
    if (!user) {
      setPlaylists([]);
      setCounts({ likes: 0, playlists: 0, following: 0, reposts: 0 });
      return;
    }
    // The list endpoints carry no totals, so real counts come from the counts
    // endpoint. The playlist list itself only feeds the add-to-playlist menu.
    try {
      const [pl, counts] = await Promise.all([
        api.get('/api/me/playlists?limit=200').catch(() => ({ collection: [] })),
        api.get('/api/me/counts').catch(() => null),
      ]);
      setPlaylists(pl.collection || []);
      if (counts) {
        setCounts({
          likes: counts.likes ?? 0,
          playlists: counts.playlists ?? 0,
          following: counts.following ?? 0,
          reposts: counts.reposts ?? 0,
        });
      }
    } catch {}
  }, [user]);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  /* ------------------------------- likes ------------------------------- */

  const toggleLike = useCallback(
    async (track) => {
      if (!track) return;
      if (!user) {
        toast.error('Connect your SoundCloud account to like tracks');
        return;
      }
      const key = 'like:' + track.id;
      if (busy.has(key)) return;
      const next = !isLiked(track);
      markBusy(key, true);
      setLiked((prev) => new Map(prev).set(String(track.id), next));
      try {
        await withCaptcha(() => api.put(`/api/tracks/${track.id}/like`, { on: next }));
        setCounts((c) => ({ ...c, likes: Math.max(0, c.likes + (next ? 1 : -1)) }));
      } catch (err) {
        setLiked((prev) => {
          const copy = new Map(prev);
          copy.delete(String(track.id));
          return copy;
        });
        toast.error(err.message || 'Could not update like');
      } finally {
        markBusy(key, false);
      }
    },
    [user, busy, toast, isLiked, withCaptcha]
  );

  /*
   * A repost may carry a short caption. Passing nothing keeps the old plain
   * behaviour, which is what the undo path and the small buttons use.
   */
  const toggleRepost = useCallback(
    async (track, caption) => {
      if (!track) return false;
      if (!user) {
        toast.error('Connect your SoundCloud account to repost');
        return false;
      }
      const key = 'repost:' + track.id;
      if (busy.has(key)) return false;
      const next = !isReposted(track);
      markBusy(key, true);
      setReposted((prev) => new Map(prev).set(String(track.id), next));
      try {
        const note = next && typeof caption === 'string' ? caption.trim() : '';
        const result = await withCaptcha(() =>
          api.put(`/api/tracks/${track.id}/repost`, { on: next, caption: note || undefined })
        );
        if (next && result?.captionSaved === false) {
          toast.error('Reposted, but the note was not saved');
        } else {
          toast.success(next ? 'Reposted to your profile' : 'Repost removed');
        }
        return true;
      } catch (err) {
        setReposted((prev) => {
          const copy = new Map(prev);
          copy.delete(String(track.id));
          return copy;
        });
        toast.error(err.message || 'Could not repost');
      } finally {
        markBusy(key, false);
      }
    },
    [user, busy, toast, isReposted, withCaptcha]
  );

  /* ------------------------------ follows ------------------------------ */

  const toggleFollow = useCallback(
    async (target) => {
      if (!target) return;
      if (!user) {
        toast.error('Connect your SoundCloud account to follow artists');
        return;
      }
      const key = 'follow:' + target.id;
      if (busy.has(key)) return;
      const next = !isFollowing(target);
      markBusy(key, true);
      setFollowed((prev) => new Map(prev).set(String(target.id), next));
      try {
        await withCaptcha(() =>
          api.put(`/api/users/${encodeURIComponent(target.id)}/follow`, { on: next })
        );
        setCounts((c) => ({ ...c, following: Math.max(0, c.following + (next ? 1 : -1)) }));
        // The following page reads this, so a fresh follow shows up without a
        // round trip and without the list looking stale.
        setRecentFollows((prev) => {
          const without = prev.filter((u) => String(u.id) !== String(target.id));
          return next ? [target, ...without] : without;
        });
      } catch (err) {
        setFollowed((prev) => {
          const copy = new Map(prev);
          copy.delete(String(target.id));
          return copy;
        });
        toast.error(err.message || 'Could not update follow');
      } finally {
        markBusy(key, false);
      }
    },
    [user, busy, toast, isFollowing, withCaptcha]
  );

  /* ----------------------------- playlists ----------------------------- */

  const createPlaylist = useCallback(
    async (payload) => {
      if (!user) {
        toast.error('Connect your SoundCloud account to create playlists');
        return null;
      }
      try {
        const pl = await withCaptcha(() => api.post('/api/playlists', payload));
        setPlaylists((prev) => [pl, ...prev]);
        setCounts((c) => ({ ...c, playlists: c.playlists + 1 }));
        toast.success('Playlist created on SoundCloud');
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not create playlist');
        return null;
      }
    },
    [user, toast, withCaptcha]
  );

  const updatePlaylist = useCallback(
    async (id, payload) => {
      try {
        const pl = await withCaptcha(() => api.patch(`/api/playlists/${id}`, payload));
        setPlaylists((prev) => prev.map((p) => (String(p.id) === String(pl.id) ? pl : p)));
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not update playlist');
        return null;
      }
    },
    [toast, withCaptcha]
  );

  const deletePlaylist = useCallback(
    async (id) => {
      try {
        await withCaptcha(() => api.del(`/api/playlists/${id}`));
        setPlaylists((prev) => prev.filter((p) => String(p.id) !== String(id)));
        setCounts((c) => ({ ...c, playlists: Math.max(0, c.playlists - 1) }));
        toast.success('Playlist deleted');
        return true;
      } catch (err) {
        toast.error(err.message || 'Could not delete playlist');
        return false;
      }
    },
    [toast, withCaptcha]
  );

  const addTrackToPlaylist = useCallback(
    async (playlistId, track) => {
      try {
        const pl = await withCaptcha(() =>
          api.post(`/api/playlists/${playlistId}/tracks`, { track_id: track.id })
        );
        setPlaylists((prev) => prev.map((p) => (String(p.id) === String(pl.id) ? pl : p)));
        toast.success(`Added to ${pl.title}`);
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not add to playlist');
        return null;
      }
    },
    [toast, withCaptcha]
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId, trackId) => {
      try {
        const pl = await withCaptcha(() =>
          api.del(`/api/playlists/${playlistId}/tracks/${trackId}`)
        );
        setPlaylists((prev) => prev.map((p) => (String(p.id) === String(pl.id) ? pl : p)));
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not remove track');
        return null;
      }
    },
    [toast, withCaptcha]
  );

  /* ------------------------------ comments ----------------------------- */

  const addComment = useCallback(
    async (trackId, body, timestampMs) => {
      if (!user) {
        toast.error('Connect your SoundCloud account to comment');
        return null;
      }
      try {
        const res = await withCaptcha(() =>
          api.post(`/api/tracks/${trackId}/comments`, {
            body,
            timestamp_ms: timestampMs ?? null,
          })
        );
        return res.comment;
      } catch (err) {
        toast.error(err.message || 'Could not post comment');
        return null;
      }
    },
    [user, toast, withCaptcha]
  );

  const deleteComment = useCallback(
    async (commentId) => {
      try {
        await withCaptcha(() => api.del(`/api/comments/${encodeURIComponent(commentId)}`));
        return true;
      } catch (err) {
        toast.error(err.message || 'Could not delete comment');
        return false;
      }
    },
    [toast, withCaptcha]
  );

  const likeComment = useCallback(
    async (trackId, commentId, on) => {
      if (!user) {
        toast.error('Connect your SoundCloud account to like comments');
        return null;
      }
      try {
        return await withCaptcha(() =>
          api.put(
            `/api/tracks/${trackId}/comments/${encodeURIComponent(commentId)}/like`,
            { on: !!on }
          )
        );
      } catch (err) {
        toast.error(err.message || 'Could not like that comment');
        return null;
      }
    },
    [user, toast, withCaptcha]
  );

  const value = useMemo(
    () => ({
      playlists,
      counts,
      recentFollows,
      isLiked,
      isReposted,
      isFollowing,
      isBusy,
      toggleLike,
      toggleRepost,
      toggleFollow,
      createPlaylist,
      updatePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      refreshLibrary,
      addComment,
      deleteComment,
      likeComment,
    }),
    [
      playlists, counts, recentFollows, isLiked, isReposted, isFollowing, isBusy,
      toggleLike, toggleRepost, toggleFollow, createPlaylist, updatePlaylist,
      deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, refreshLibrary,
      addComment, deleteComment, likeComment,
    ]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider');
  return ctx;
}
