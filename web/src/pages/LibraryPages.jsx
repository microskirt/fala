import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Heart,
  ListMusic,
  Repeat2,
  Users,
  History as HistoryIcon,
  Play,
  Plus,
  Trash2,
  Loader2,
  Clock,
  LibraryBig,
} from 'lucide-react';
import { api, formatCount, trackPath, userPath, timeAgo } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { TrackCard, PlaylistCard, ArtistRow, TrackRow } from '../components/Cards.jsx';
import { Artwork, Avatar, Skeleton, ErrorState, EmptyState } from '../components/Media.jsx';
import { Modal } from '../components/Modal.jsx';

function useList(endpoint, deps = []) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(endpoint);
      setItems(res.collection || []);
    } catch (err) {
      setError(err.message || 'Could not load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { items, loading, error, reload: load, setItems };
}

function ListShell({ title, subtitle, children, actions }) {
  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="list-page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function TrackGridSkeleton() {
  return (
    <div className="card-grid">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i}>
          <Skeleton h={0} style={{ paddingBottom: '100%' }} r={8} />
          <Skeleton w="80%" h={12} style={{ marginTop: 10 }} />
          <Skeleton w="55%" h={11} style={{ marginTop: 7 }} />
        </div>
      ))}
    </div>
  );
}

export function LikesPage() {
  const { isAuthed } = useAuth();
  const { playQueue } = usePlayer();
  const { items, loading, error, reload } = useList('/api/me/likes', [isAuthed]);

  if (!isAuthed) {
    return (
      <ListShell title="Likes">
        <EmptyState icon={Heart} title="Sign in to see your likes">
          <Link to="/login" className="link-btn">
            Sign in
          </Link>{' '}
          to build a collection of everything you love.
        </EmptyState>
      </ListShell>
    );
  }

  return (
    <ListShell
      title="Likes"
      subtitle={`${items.length} track${items.length === 1 ? '' : 's'} you have liked`}
      actions={
        items.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => playQueue(items, 0)}>
            <Play size={14} fill="currentColor" /> Play all
          </button>
        ) : null
      }
    >
      {loading ? (
        <TrackGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={Heart} title="No likes yet">
          Tap the heart on any track and it will show up here.
        </EmptyState>
      ) : (
        <div className="card-grid">
          {items.map((t) => (
            <TrackCard key={t.id} track={t} context={items} />
          ))}
        </div>
      )}
    </ListShell>
  );
}

export function RepostsPage() {
  const { isAuthed } = useAuth();
  const { playQueue } = usePlayer();
  const { items, loading, error, reload } = useList('/api/me/reposts', [isAuthed]);

  if (!isAuthed) {
    return (
      <ListShell title="Reposts">
        <EmptyState icon={Repeat2} title="Sign in to see your reposts">
          <Link to="/login" className="link-btn">
            Sign in
          </Link>{' '}
          to share tracks with your followers.
        </EmptyState>
      </ListShell>
    );
  }

  return (
    <ListShell
      title="Reposts"
      subtitle={`${items.length} track${items.length === 1 ? '' : 's'} shared to your profile`}
      actions={
        items.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => playQueue(items, 0)}>
            <Play size={14} fill="currentColor" /> Play all
          </button>
        ) : null
      }
    >
      {loading ? (
        <TrackGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={Repeat2} title="Nothing reposted yet">
          Reposting puts a track on your profile and in your followers’ feeds.
        </EmptyState>
      ) : (
        <div className="card-grid">
          {items.map((t) => (
            <TrackCard key={t.id} track={t} context={items} />
          ))}
        </div>
      )}
    </ListShell>
  );
}

export function HistoryPage() {
  const { isAuthed } = useAuth();
  const { playQueue } = usePlayer();
  const { items, loading, error, reload } = useList('/api/me/history', [isAuthed]);

  if (!isAuthed) {
    return (
      <ListShell title="Listening history">
        <EmptyState icon={HistoryIcon} title="Sign in to keep a history">
          Your recent plays will appear here once you are signed in.
        </EmptyState>
      </ListShell>
    );
  }

  return (
    <ListShell
      title="Listening history"
      subtitle="The last 50 tracks you played on this account"
      actions={
        items.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => playQueue(items, 0)}>
            <Play size={14} fill="currentColor" /> Play all
          </button>
        ) : null
      }
    >
      {loading ? (
        <TrackGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nothing played yet">
          Tracks you listen to will show up here.
        </EmptyState>
      ) : (
        <div className="track-list">
          {items.map((t, i) => (
            <TrackRow key={`${t.id}-${i}`} track={t} index={i} context={items} />
          ))}
        </div>
      )}
    </ListShell>
  );
}

export function FollowingPage() {
  const { isAuthed } = useAuth();
  const { items, loading, error, reload } = useList('/api/me/following', [isAuthed]);

  if (!isAuthed) {
    return (
      <ListShell title="Following">
        <EmptyState icon={Users} title="Sign in to see who you follow">
          Follow artists and people to shape your home feed.
        </EmptyState>
      </ListShell>
    );
  }

  return (
    <ListShell
      title="Following"
      subtitle={`${items.length} account${items.length === 1 ? '' : 's'} you follow`}
    >
      {loading ? (
        <div className="search-user-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={70} r={8} />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={Users} title="You are not following anyone yet">
          Find artists you like and hit follow — their activity lands on your home page.
        </EmptyState>
      ) : (
        <div className="search-user-grid">
          {items.map((entry) => {
            const person = entry.user;
            if (!person) return null;
            return (
              <ArtistRow
                key={`${entry.target_type}-${entry.target_id}`}
                user={person}
                subtitle={
                  entry.target_type === 'local-user' ? 'On Wavefront' : 'On SoundCloud'
                }
              />
            );
          })}
        </div>
      )}
    </ListShell>
  );
}

export function PlaylistsPage() {
  const { isAuthed } = useAuth();
  const { playlists, createPlaylist, refreshLibrary } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', is_private: false });
  const [busy, setBusy] = useState(false);

  if (!isAuthed) {
    return (
      <ListShell title="Playlists">
        <EmptyState icon={ListMusic} title="Sign in to build playlists">
          <Link to="/login" className="link-btn">
            Sign in
          </Link>{' '}
          to collect tracks into playlists.
        </EmptyState>
      </ListShell>
    );
  }

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    const pl = await createPlaylist({
      title: form.title.trim(),
      description: form.description,
      is_private: form.is_private,
    });
    setBusy(false);
    if (pl) {
      setCreating(false);
      setForm({ title: '', description: '', is_private: false });
    }
  };

  return (
    <ListShell
      title="Playlists"
      subtitle={`${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`}
      actions={
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New playlist
        </button>
      }
    >
      {playlists.length === 0 ? (
        <EmptyState icon={ListMusic} title="No playlists yet">
          Playlists are a great way to group tracks for a mood, a set or a drive.
          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Create your first playlist
            </button>
          </div>
        </EmptyState>
      ) : (
        <div className="card-grid">
          {playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New playlist"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={submit}
              disabled={busy || !form.title.trim()}
            >
              {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
              Create playlist
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field">
            <span className="label">Title</span>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Late night drive"
              maxLength={120}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="label">Description</span>
            <textarea
              className="textarea"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional"
              maxLength={2000}
            />
          </label>
          <div className="setting-row">
            <div className="label-block">
              <strong>Private</strong>
              <span>Only you can see this playlist.</span>
            </div>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={form.is_private}
              onClick={() => setForm((f) => ({ ...f, is_private: !f.is_private }))}
            />
          </div>
        </div>
      </Modal>
    </ListShell>
  );
}

export function LibraryPage() {
  const { isAuthed, user } = useAuth();
  const { playlists } = useLibrary();
  const { playQueue } = usePlayer();
  const likes = useList('/api/me/likes', [isAuthed]);
  const reposts = useList('/api/me/reposts', [isAuthed]);
  const following = useList('/api/me/following', [isAuthed]);
  const history = useList('/api/me/history', [isAuthed]);

  if (!isAuthed) {
    return (
      <ListShell title="Your library">
        <EmptyState icon={LibraryBig} title="Sign in to open your library">
          Your likes, playlists, reposts and history live here.
          <div style={{ marginTop: 14 }}>
            <Link to="/login" className="btn primary">
              Sign in
            </Link>
          </div>
        </EmptyState>
      </ListShell>
    );
  }

  return (
    <ListShell title="Your library" subtitle={`Everything saved to @${user.permalink}`}>
      <div className="section">
        <div className="section-head">
          <h2>
            <ListMusic size={18} /> Playlists
            <span className="pill-count">{playlists.length}</span>
          </h2>
          <Link className="btn sm" to="/playlists">
            Manage
          </Link>
        </div>
        {playlists.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No playlists yet. Create one from the Playlists page.
          </p>
        ) : (
          <div className="card-grid">
            {playlists.slice(0, 6).map((p) => (
              <PlaylistCard key={p.id} playlist={p} />
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>
            <Heart size={18} /> Recent likes
            <span className="pill-count">{likes.items.length}</span>
          </h2>
          <Link className="btn sm" to="/likes">
            See all
          </Link>
        </div>
        {likes.loading ? (
          <TrackGridSkeleton />
        ) : likes.items.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Nothing liked yet.
          </p>
        ) : (
          <div className="card-grid">
            {likes.items.slice(0, 6).map((t) => (
              <TrackCard key={t.id} track={t} context={likes.items} />
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>
            <Users size={18} /> Following
            <span className="pill-count">{following.items.length}</span>
          </h2>
          <Link className="btn sm" to="/following">
            See all
          </Link>
        </div>
        {following.items.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            You are not following anyone yet.
          </p>
        ) : (
          <div className="search-user-grid">
            {following.items.slice(0, 6).map((entry) => (
              <ArtistRow
                key={`${entry.target_type}-${entry.target_id}`}
                user={entry.user}
                subtitle={entry.target_type === 'local-user' ? 'On Wavefront' : 'On SoundCloud'}
              />
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>
            <Clock size={18} /> Recently played
            <span className="pill-count">{history.items.length}</span>
          </h2>
          <Link className="btn sm" to="/history">
            See all
          </Link>
        </div>
        {history.items.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Nothing played yet.
          </p>
        ) : (
          <div className="track-list">
            {history.items.slice(0, 6).map((t, i) => (
              <TrackRow key={`${t.id}-${i}`} track={t} index={i} context={history.items} />
            ))}
          </div>
        )}
      </div>
    </ListShell>
  );
}
