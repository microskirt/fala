import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  Heart,
  ListMusic,
  Clock,
  Trash2,
  Pencil,
  Loader2,
  Lock,
  MoreHorizontal,
  GripVertical,
  Calendar,
  Music2,
} from 'lucide-react';
import {
  api,
  formatCount,
  formatLongDuration,
  formatDuration,
  timeAgo,
  formatDate,
  userPath,
  trackPath,
} from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Artwork, Avatar, Skeleton, ErrorState, EmptyState } from '../components/Media.jsx';
import { LikeButton, AddToPlaylistButton, QueueMenuButton, PlayButton } from '../components/Controls.jsx';
import { Modal, ConfirmDialog } from '../components/Modal.jsx';

function PlaylistTrackRow({ track, index, context, editable, onRemove, onMove }) {
  return (
    <div className="track-row">
      <div className="idx">
        <span className="num">{index + 1}</span>
        <span className="play-mini">
          <PlayButton track={track} context={context} size="sm" />
        </span>
      </div>
      <Link to={trackPath(track)} style={{ display: 'block' }}>
        <Artwork src={track.artwork_url} alt={track.title} size={48} rounded={4} />
      </Link>
      <div className="info">
        <Link className="title" to={trackPath(track)}>
          {track.title}
        </Link>
        <div className="sub">
          {track.user ? <Link to={userPath(track.user)}>{track.user.username}</Link> : 'Unknown'}
        </div>
      </div>
      <div className="row-actions">
        <LikeButton track={track} size={16} />
        <AddToPlaylistButton track={track} size={16} />
        <QueueMenuButton track={track} size={16} />
        <span className="dur">{formatDuration(track.duration)}</span>
        {editable && (
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => onRemove(track)}
            aria-label="Remove from playlist"
            title="Remove from playlist"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playQueue, playTrack } = usePlayer();
  const { updatePlaylist, deletePlaylist, removeTrackFromPlaylist } = useLibrary();
  const toast = useToast();

  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', is_private: false });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // ids come as `system:<id>`, `sc:<id>` or a bare playlist id.
      const idStr = String(id);
      let path;
      if (idStr.startsWith('system:')) {
        path = `/api/playlists/system:${encodeURIComponent(idStr.slice(7))}`;
      } else if (idStr.startsWith('sc:')) {
        path = `/api/playlists/sc-playlist:${idStr.slice(3)}`;
      } else {
        path = `/api/playlists/sc-playlist:${idStr}`;
      }
      const pl = await api.get(path);
      setPlaylist(pl);
      setForm({
        title: pl.title,
        description: pl.description || '',
        is_private: !!pl.is_private,
      });
    } catch (err) {
      setError(err.message || 'Playlist not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="content-inner">
        <div className="playlist-hero">
          <Skeleton h={0} style={{ paddingBottom: '100%' }} r={12} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton w={100} h={11} />
            <Skeleton w="60%" h={30} />
            <Skeleton w="35%" h={13} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="content-inner">
        <ErrorState message={error || 'Playlist not found'} onRetry={load} />
      </div>
    );
  }

  const tracks = (playlist.tracks || []).filter((t) => t && t.kind === 'track');
  const owner = playlist.user;
  const isOwner = user && owner && String(user.id) === String(owner.id);
  const canEdit = isOwner;

  const save = async () => {
    setBusy(true);
    const pl = await updatePlaylist(playlist.id, {
      title: form.title.trim() || 'Untitled playlist',
      description: form.description,
      is_private: form.is_private,
    });
    setBusy(false);
    if (pl) {
      setPlaylist((prev) => ({ ...prev, ...pl }));
      setEditing(false);
      toast.success('Playlist updated');
    }
  };

  const doDelete = async () => {
    setBusy(true);
    const ok = await deletePlaylist(playlist.id);
    setBusy(false);
    if (ok) navigate('/playlists');
  };

  const removeTrack = async (track) => {
    const pl = await removeTrackFromPlaylist(playlist.id, track.id);
    if (pl) setPlaylist((prev) => ({ ...prev, tracks: pl.tracks, track_count: pl.track_count }));
  };

  return (
    <div className="content-inner">
      <div className="playlist-hero">
        <div className="cover">
          <Artwork
            src={playlist.artwork_url}
            alt={playlist.title}
            size="100%"
            rounded={0}
            kind="playlist"
          />
        </div>

        <div className="detail">
          <div className="eyebrow">
            {playlist.is_private ? (
              <>
                <Lock size={12} /> Private playlist
              </>
            ) : playlist.is_album ? (
              'Album'
            ) : (
              'Playlist'
            )}
          </div>
          <h1>{playlist.title}</h1>

          {playlist.description && <div className="description">{playlist.description}</div>}

          <div className="sub-line">
            {owner && (
              <>
                <Link to={userPath(owner)}>
                  <Avatar src={owner.avatar_url} name={owner.username} size={22} />
                </Link>
                <Link to={userPath(owner)}>{owner.username}</Link>
                <span className="dot-sep" />
              </>
            )}
            <span>{tracks.length} tracks</span>
            <span className="dot-sep" />
            <span>{formatLongDuration(playlist.duration)}</span>
            {playlist.display_date && (
              <>
                <span className="dot-sep" />
                <span>{timeAgo(playlist.display_date)}</span>
              </>
            )}
          </div>

          <div className="actions">
            <button
              type="button"
              className="play-fab lg"
              onClick={() => playQueue(tracks, 0)}
              disabled={tracks.length === 0}
              aria-label="Play playlist"
            >
              <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                tracks.forEach((t) => playTrack(t));
              }}
              disabled={tracks.length === 0}
            >
              <ListMusic size={15} /> Add to queue
            </button>
            {canEdit && (
              <>
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  <Pencil size={15} /> Edit
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={15} /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {tracks.length === 0 ? (
        <EmptyState icon={Music2} title="This playlist is empty">
          Add tracks from anywhere using the “add to playlist” button.
        </EmptyState>
      ) : (
        <div className="track-list">
          {tracks.map((track, i) => (
            <PlaylistTrackRow
              key={`${track.id}-${i}`}
              track={track}
              index={i}
              context={tracks}
              editable={canEdit}
              onRemove={removeTrack}
            />
          ))}
        </div>
      )}

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit playlist"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
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
              maxLength={120}
            />
          </label>
          <label className="field">
            <span className="label">Description</span>
            <textarea
              className="textarea"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={2000}
              placeholder="What is this playlist about?"
            />
          </label>
          <div className="setting-row">
            <div className="label-block">
              <strong>Private playlist</strong>
              <span>Only you can see it when it is private.</span>
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

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        title="Delete playlist?"
        message={`“${playlist.title}” will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete playlist"
        danger
        busy={busy}
      />
    </div>
  );
}
