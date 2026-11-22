import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { api } from '../api.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();

  // Sets of ids we have toggled in this session, layered over server state.
  const [liked, setLiked] = useState(() => new Set());
  const [reposted, setReposted] = useState(() => new Set());
  const [followed, setFollowed] = useState(() => new Set());
  const [busy, setBusy] = useState(() => new Set());
  const [playlists, setPlaylists] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [counts, setCounts] = useState({ likes: 0, playlists: 0, following: 0, unread: 0 });

  const markBusy = (key, on) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const isBusy = useCallback((key) => busy.has(key), [busy]);

  const isLiked = useCallback(
    (track) => (track ? liked.has(String(track.id)) || !!track.liked : false),
    [liked]
  );
  const isReposted = useCallback(
    (track) => (track ? reposted.has(String(track.id)) || !!track.reposted : false),
    [reposted]
  );
  const isFollowing = useCallback(
    (u) => (u ? followed.has(String(u.id)) || !!u.is_following : false),
    [followed]
  );

  /* ------------------------------ refresh ------------------------------ */

  const refreshLibrary = useCallback(async () => {
    if (!user) {
      setPlaylists([]);
      setCounts({ likes: 0, playlists: 0, following: 0, unread: 0 });
      setNotifications([]);
      return;
    }
    try {
      const [pl, likes, following, notifs] = await Promise.all([
        api.get('/api/me/playlists').catch(() => ({ collection: [] })),
        api.get('/api/me/likes').catch(() => ({ collection: [] })),
        api.get('/api/me/following').catch(() => ({ collection: [] })),
        api.get('/api/me/notifications').catch(() => ({ collection: [] })),
      ]);
      setPlaylists(pl.collection || []);
      setNotifications(notifs.collection || []);
      setCounts({
        likes: (likes.collection || []).length,
        playlists: (pl.collection || []).length,
        following: (following.collection || []).length,
        unread: (notifs.collection || []).filter((n) => !n.read).length,
      });
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
        toast.error('Sign in to like tracks');
        return;
      }
      const key = 'like:' + track.id;
      if (busy.has(key)) return;
      markBusy(key, true);
      try {
        const res = await api.post(`/api/tracks/${track.id}/like`, { track });
        setLiked((prev) => {
          const next = new Set(prev);
          if (res.liked) next.add(String(track.id));
          else next.delete(String(track.id));
          return next;
        });
        setCounts((c) => ({ ...c, likes: Math.max(0, c.likes + (res.liked ? 1 : -1)) }));
      } catch (err) {
        toast.error(err.message || 'Could not update like');
      } finally {
        markBusy(key, false);
      }
    },
    [user, busy, toast]
  );

  const toggleRepost = useCallback(
    async (track) => {
      if (!track) return;
      if (!user) {
        toast.error('Sign in to repost tracks');
        return;
      }
      const key = 'repost:' + track.id;
      if (busy.has(key)) return;
      markBusy(key, true);
      try {
        const res = await api.post(`/api/tracks/${track.id}/repost`, { track });
        setReposted((prev) => {
          const next = new Set(prev);
          if (res.reposted) next.add(String(track.id));
          else next.delete(String(track.id));
          return next;
        });
        toast.success(res.reposted ? 'Reposted to your profile' : 'Repost removed');
      } catch (err) {
        toast.error(err.message || 'Could not repost');
      } finally {
        markBusy(key, false);
      }
    },
    [user, busy, toast]
  );

  /* ------------------------------ follows ------------------------------ */

  const toggleFollow = useCallback(
    async (target) => {
      if (!target) return;
      if (!user) {
        toast.error('Sign in to follow artists');
        return;
      }
      const key = 'follow:' + target.id;
      if (busy.has(key)) return;
      markBusy(key, true);
      try {
        const res = await api.post(`/api/users/${encodeURIComponent(target.id)}/follow`);
        setFollowed((prev) => {
          const next = new Set(prev);
          if (res.following) next.add(String(target.id));
          else next.delete(String(target.id));
          return next;
        });
        setCounts((c) => ({ ...c, following: Math.max(0, c.following + (res.following ? 1 : -1)) }));
      } catch (err) {
        toast.error(err.message || 'Could not update follow');
      } finally {
        markBusy(key, false);
      }
    },
    [user, busy, toast]
  );

  /* ----------------------------- playlists ----------------------------- */

  const createPlaylist = useCallback(
    async (payload) => {
      if (!user) {
        toast.error('Sign in to create playlists');
        return null;
      }
      try {
        const pl = await api.post('/api/playlists', payload);
        setPlaylists((prev) => [pl, ...prev]);
        setCounts((c) => ({ ...c, playlists: c.playlists + 1 }));
        toast.success('Playlist created');
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not create playlist');
        return null;
      }
    },
    [user, toast]
  );

  const updatePlaylist = useCallback(
    async (id, payload) => {
      try {
        const pl = await api.patch(`/api/playlists/${id}`, payload);
        setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? pl : p)));
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not update playlist');
        return null;
      }
    },
    [toast]
  );

  const deletePlaylist = useCallback(
    async (id) => {
      try {
        await api.del(`/api/playlists/${id}`);
        setPlaylists((prev) => prev.filter((p) => p.id !== id));
        setCounts((c) => ({ ...c, playlists: Math.max(0, c.playlists - 1) }));
        toast.success('Playlist deleted');
        return true;
      } catch (err) {
        toast.error(err.message || 'Could not delete playlist');
        return false;
      }
    },
    [toast]
  );

  const addTrackToPlaylist = useCallback(
    async (playlistId, track) => {
      try {
        const pl = await api.post(`/api/playlists/${playlistId}/tracks`, { track });
        setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? pl : p)));
        toast.success(`Added to ${pl.title}`);
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not add to playlist');
        return null;
      }
    },
    [toast]
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId, trackId) => {
      try {
        const pl = await api.del(`/api/playlists/${playlistId}/tracks/${trackId}`);
        setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? pl : p)));
        return pl;
      } catch (err) {
        toast.error(err.message || 'Could not remove track');
        return null;
      }
    },
    [toast]
  );

  /* --------------------------- notifications --------------------------- */

  const refreshNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get('/api/me/notifications');
      setNotifications(res.collection || []);
      setCounts((c) => ({ ...c, unread: (res.collection || []).filter((n) => !n.read).length }));
    } catch {}
  }, [user]);

  const markNotificationsRead = useCallback(async () => {
    if (!user) return;
    try {
      await api.post('/api/me/notifications/read');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setCounts((c) => ({ ...c, unread: 0 }));
    } catch {}
  }, [user]);

  /* ------------------------------ comments ----------------------------- */

  const addComment = useCallback(
    async (trackId, body, timestampMs) => {
      if (!user) {
        toast.error('Sign in to comment');
        return null;
      }
      try {
        const res = await api.post(`/api/tracks/${trackId}/comments`, {
          body,
          timestamp_ms: timestampMs ?? null,
        });
        return res.comment;
      } catch (err) {
        toast.error(err.message || 'Could not post comment');
        return null;
      }
    },
    [user, toast]
  );

  const deleteComment = useCallback(
    async (commentId) => {
      try {
        await api.del(`/api/comments/${encodeURIComponent(commentId)}`);
        return true;
      } catch (err) {
        toast.error(err.message || 'Could not delete comment');
        return false;
      }
    },
    [toast]
  );

  const value = useMemo(
    () => ({
      playlists,
      notifications,
      counts,
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
      refreshNotifications,
      markNotificationsRead,
      addComment,
      deleteComment,
    }),
    [
      playlists, notifications, counts, isLiked, isReposted, isFollowing, isBusy,
      toggleLike, toggleRepost, toggleFollow, createPlaylist, updatePlaylist,
      deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, refreshLibrary,
      refreshNotifications, markNotificationsRead, addComment, deleteComment,
    ]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider');
  return ctx;
}
