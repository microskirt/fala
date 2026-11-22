import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Play,
  ListMusic,
  Trash2,
  Pencil,
  Lock,
  Music2,
} from 'lucide-react';
import {
  api,
  formatLongDuration,
  formatDuration,
  timeAgo,
} from '@/api.js';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { Artwork, Avatar, Skeleton, ErrorState, EmptyState } from '@/components/Media.jsx';
import { LikeButton, AddToPlaylistButton, QueueMenuButton, PlayButton } from '@/components/Controls.jsx';
import { Modal, ConfirmDialog } from '@/components/Modal.jsx';
import { Page, TrackList, Eyebrow } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Switch } from '@/components/ui/switch.jsx';

function PlaylistTrackRow({ track, index, context, editable, onRemove }) {
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
      <div className="relative grid w-7 shrink-0 place-items-center text-xs text-muted-foreground">
        <span className="group-hover:opacity-0">{index + 1}</span>
        <span className="absolute opacity-0 group-hover:opacity-100">
          <PlayButton track={track} context={context} size="sm" />
        </span>
      </div>
      <Link to="/track/$id" params={{ id: String(track.id) }} className="shrink-0">
        <Artwork src={track.artwork_url} alt={track.title} size={48} rounded={6} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to="/track/$id"
          params={{ id: String(track.id) }}
          className="block truncate text-sm font-medium hover:underline"
        >
          {track.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">
          {track.user ? (
            <Link
              to="/artist/$id"
              params={{ id: String(track.user.id) }}
              className="hover:text-foreground"
            >
              {track.user.username}
            </Link>
          ) : (
            'Unknown'
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <LikeButton track={track} size={16} />
        <AddToPlaylistButton track={track} size={16} />
        <QueueMenuButton track={track} size={16} />
        {editable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(track)}
            aria-label="Remove from playlist"
            title="Remove from playlist"
          >
            <Trash2 size={14} />
          </Button>
        ) : null}
      </div>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatDuration(track.duration)}
      </span>
    </div>
  );
}

export function PlaylistPage() {
  const { id } = useParams({ from: '/shell/playlist/$id' });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playQueue, addToQueue } = usePlayer();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <Page>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        </div>
      </Page>
    );
  }

  if (error || !playlist) {
    return (
      <Page>
        <ErrorState message={error || 'Playlist not found'} onRetry={load} />
      </Page>
    );
  }

  const tracks = (playlist.tracks || []).filter((t) => t && t.kind === 'track');
  const owner = playlist.user;
  const canEdit = user && owner && String(user.id) === String(owner.id);

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
    if (ok) navigate({ to: '/playlists' });
  };

  const removeTrack = async (track) => {
    const pl = await removeTrackFromPlaylist(playlist.id, track.id);
    if (pl) setPlaylist((prev) => ({ ...prev, tracks: pl.tracks, track_count: pl.track_count }));
  };

  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[280px] lg:mx-0">
          <Artwork
            src={playlist.artwork_url}
            alt={playlist.title}
            size="100%"
            rounded={12}
            kind="playlist"
            className="aspect-square shadow-md"
          />
        </div>

        <div className="min-w-0">
          <Eyebrow>
            {playlist.is_private ? (
              <>
                <Lock size={14} /> Private playlist
              </>
            ) : playlist.is_album ? (
              'Album'
            ) : (
              'Playlist'
            )}
          </Eyebrow>

          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {playlist.title}
          </h1>

          {playlist.description ? (
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {playlist.description}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {owner ? (
              <>
                <Link to="/artist/$id" params={{ id: String(owner.id) }}>
                  <Avatar src={owner.avatar_url} name={owner.username} size={22} />
                </Link>
                <Link
                  to="/artist/$id"
                  params={{ id: String(owner.id) }}
                  className="font-medium text-foreground hover:underline"
                >
                  {owner.username}
                </Link>
                <span className="opacity-40">·</span>
              </>
            ) : null}
            <span>{tracks.length} tracks</span>
            {playlist.duration ? (
              <>
                <span className="opacity-40">·</span>
                <span>{formatLongDuration(playlist.duration)}</span>
              </>
            ) : null}
            {playlist.display_date ? (
              <>
                <span className="opacity-40">·</span>
                <span>{timeAgo(playlist.display_date)}</span>
              </>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              className="rounded-full"
              onClick={() => playQueue(tracks, 0)}
              disabled={tracks.length === 0}
            >
              <Play size={16} fill="currentColor" /> Play
            </Button>
            <Button
              variant="outline"
              onClick={() => addToQueue(tracks)}
              disabled={tracks.length === 0}
            >
              <ListMusic size={16} /> Add to queue
            </Button>
            {canEdit ? (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil size={16} /> Edit
                </Button>
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} /> Delete
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-10">
        {tracks.length === 0 ? (
          <EmptyState icon={Music2} title="This playlist is empty">
            Add tracks from anywhere using the “add to playlist” button.
          </EmptyState>
        ) : (
          <TrackList>
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
          </TrackList>
        )}
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit playlist"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pl-title">Title</Label>
            <Input
              id="pl-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pl-desc">Description</Label>
            <Textarea
              id="pl-desc"
              className="min-h-24"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={2000}
              placeholder="What is this playlist about?"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="leading-tight">
              <div className="text-sm font-medium">Private playlist</div>
              <div className="text-xs text-muted-foreground">Only you can see it when it is private.</div>
            </div>
            <Switch
              checked={form.is_private}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_private: v }))}
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
    </Page>
  );
}
