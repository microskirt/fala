import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Play,
  ListMusic,
  Trash2,
  Pencil,
  Lock,
  Music2,
  Heart,
} from 'lucide-react';
import {
  api,
  formatCount,
  formatLongDuration,
  formatDuration,
  timeAgo,
  trackArtistName,
} from '@/api.js';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { Artwork, Avatar, Skeleton, ErrorState, EmptyState } from '@/components/Media.jsx';
import {
  LikeButton,
  AddToPlaylistButton,
  AddToQueueButton,
  QueueMenuButton,
  PlayButton,
} from '@/components/Controls.jsx';
import { Modal, ConfirmDialog } from '@/components/Modal.jsx';
import { ClampedText } from '@/components/ClampedText.jsx';
import { PlaylistArtworkField } from '@/components/PlaylistArtwork.jsx';
import { Page, TrackList, Eyebrow, DetailHero } from '@/components/layout/Page.jsx';
import { useArtworkColor } from '@/lib/artworkColor.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { trackLink, userLink, resolvePlaylistParam, playlistSubLink } from '@/lib/scRoute.js';
import { cn } from '@/lib/utils.js';
import { DETAIL_GRID } from '@/lib/layout.js';

function PlaylistTrackRow({ track, index, context }) {
  const { isCurrent } = usePlayer();
  /*
   * The loaded track keeps its play button on screen once the pointer leaves,
   * and after a reload the player already knows which track that is. Switching
   * to another track moves the button there.
   */
  const active = isCurrent(track);
  return (
    /*
     * The negative margin and matching padding let the hover band bleed into
     * the page gutter while the row number itself sits on the same left edge
     * as the title above. Without it every entry reads a step too far right.
     */
    <div className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
      <div className="relative grid w-7 shrink-0 place-items-center text-xs text-muted-foreground">
        <span className={cn('group-hover:opacity-0', active && 'opacity-0')}>{index + 1}</span>
        <span
          className={cn(
            'absolute transition-opacity group-hover:pointer-events-auto group-hover:opacity-100',
            active ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <PlayButton track={track} context={context} size="sm" />
        </span>
      </div>
      <Link {...trackLink(track)} className="shrink-0">
        <Artwork
          src={track.artwork_url}
          fallback={track.user?.avatar_url}
          alt={track.title}
          size={44}
          rounded={6}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          {...trackLink(track)}
          className="block truncate text-sm font-medium hover:underline"
        >
          {track.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">
          {track.user ? (
            <Link
              {...userLink(track.user)}
              className="hover:text-foreground"
            >
              {trackArtistName(track)}
            </Link>
          ) : (
            'Unknown'
          )}
        </div>
      </div>
      {/*
       * Hidden until the row is hovered, and not clickable while hidden. A
       * phone has no hover, so the tray is left out there and the title takes
       * the width it would have eaten.
       */}
      <div className="pointer-events-none hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 sm:flex">
        <LikeButton track={track} size={16} />
        <AddToQueueButton track={track} size={16} />
        <AddToPlaylistButton track={track} size={16} />
        <QueueMenuButton track={track} size={16} />
      </div>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatDuration(track.duration)}
      </span>
    </div>
  );
}

export function PlaylistPage() {
  /*
   * A playlist answers on /playlist/:id and on the SoundCloud shaped
   * /:artist/sets/:playlist. The slug form carries words, so it is resolved to
   * a numeric id before the playlist is fetched.
   */
  const params = useParams({ strict: false });
  const id = params.id ? String(params.id) : null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playQueue, addToQueue } = usePlayer();
  const { updatePlaylist, deletePlaylist, isPlaylistLiked, togglePlaylistLike } = useLibrary();
  const toast = useToast();

  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // `artwork` is a data URI, null to remove, or undefined to leave alone.
  const [form, setForm] = useState({
    title: '',
    description: '',
    is_private: false,
    artwork: undefined,
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // A slug address has to become a numeric id before the playlist is read.
      let idStr = id;
      if (!idStr) {
        const resolved = await resolvePlaylistParam({
          artist: params.artist,
          playlist: params.playlist,
        });
        if (!resolved) throw new Error('Playlist not found');
        idStr = `sc:${resolved}`;
      }
      // ids come as `system:<id>`, `sc:<id>` or a bare playlist id.
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
        artwork: undefined,
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
  }, [id, params.artist, params.playlist]);

  /*
   * The band behind the top card takes its colour from the cover, the same way
   * the song page does. It stays above the early returns so the hook order
   * never changes while the playlist loads.
   */
  const cover = useArtworkColor(playlist?.artwork_url || playlist?.user?.avatar_url);
  const tint = cover ? `rgb(${cover[0]} ${cover[1]} ${cover[2]})` : null;

  if (loading) {
    return (
      <Page>
        {/* The cover lands on the right, so the skeleton does too. */}
        <div className={cn('grid gap-8', DETAIL_GRID)}>
          <Skeleton className="aspect-square w-full rounded-xl lg:order-2" />
          <div className="flex flex-col gap-3 lg:order-1">
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
  /*
   * Recommendation mixes come from SoundCloud itself and have no person behind
   * them. The owner line is dropped for those, and so is the "Based on ..."
   * description, because the title already says what the mix is about.
   */
  const isSystem =
    playlist.kind === 'system-playlist' || String(playlist.id).startsWith('system:');
  const owner = isSystem ? null : playlist.user;
  const description = /^based on\b/i.test(playlist.description || '') ? '' : playlist.description;
  const canEdit = user && owner && String(user.id) === String(owner.id);
  const liked = isPlaylistLiked(playlist);
  // The button flips the state at once, so the number beside the track count
  // follows the same step instead of waiting for the playlist to be refetched.
  const likesCount = Math.max(0, Number(playlist.likes_count || 0) + (liked && !playlist.liked ? 1 : 0));

  const save = async () => {
    setBusy(true);
    const pl = await updatePlaylist(playlist.id, {
      title: form.title.trim() || 'Untitled playlist',
      description: form.description,
      is_private: form.is_private,
      artwork: form.artwork,
    });
    setBusy(false);
    if (pl) {
      setPlaylist((prev) => ({ ...prev, ...pl }));
      // The cover is saved now, so the field goes back to "leave it alone"
      // rather than holding a data URI that would be sent again.
      setForm((f) => ({ ...f, artwork: undefined }));
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

  return (
    <Page>
      {/*
       * The cover sits on the right on wide screens, so the text column starts
       * at the page edge and the picture anchors the other side. It stays first
       * in the markup, which is the order it should stack in on a phone.
       */}
      <DetailHero tint={tint}>
        <div className={cn('grid gap-8', DETAIL_GRID)}>
          <div className="mx-auto w-full max-w-[20rem] lg:order-2 lg:mx-0">
          <Artwork
            src={playlist.artwork_url}
            fallback={playlist.user?.avatar_url}
            alt={playlist.title}
            size="100%"
            rounded={12}
            kind="playlist"
            className="aspect-square shadow-md"
          />
        </div>

        <div className="min-w-0 lg:order-1">
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

          {/* A long, unbroken title wraps instead of running past the card. */}
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            {playlist.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {owner ? (
              <>
                <Link {...userLink(owner)}>
                  <Avatar src={owner.avatar_url} name={owner.username} size={22} />
                </Link>
                <Link
                  {...userLink(owner)}
                  className="font-medium text-foreground hover:underline"
                >
                  {owner.username}
                </Link>
                <span className="opacity-40">·</span>
              </>
            ) : null}
            <span>{tracks.length} tracks</span>
            {/*
             * The like count opens the people behind it, the same way the
             * count under a song does. It only reads as a link on hover, so
             * the meta row stays quiet at rest. Albums do not carry the like
             * action, so they do not show its count either.
             */}
            {playlist.is_album ? null : (
              <>
                <span className="opacity-40">·</span>
                <Link
                  {...playlistSubLink(playlist, 'likes')}
                  className="rounded-sm transition-colors hover:text-foreground"
                  title="See who liked this playlist"
                >
                  {formatCount(likesCount)} {likesCount === 1 ? 'like' : 'likes'}
                </Link>
              </>
            )}
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
            {/*
             * Same shape as the outline buttons beside it: default size, so
             * the radius and height come from the shared button variants. The
             * old pill shape was taller and rounder than its neighbours.
             */}
            <Button onClick={() => playQueue(tracks, 0)} disabled={tracks.length === 0}>
              <Play size={16} fill="currentColor" /> Play
            </Button>
            <Button
              variant="outline"
              onClick={() => addToQueue(tracks)}
              disabled={tracks.length === 0}
            >
              <ListMusic size={16} /> Add to queue
            </Button>
            {/*
             * Albums share this page but not the like action, so the button is
             * only there for playlists. The like sits between the two queue
             * actions and the owner controls, so the shared actions stay
             * together and the edits keep their own group at the end.
             */}
            {playlist.is_album ? null : (
              <Button
                variant="outline"
                onClick={() => togglePlaylistLike(playlist)}
                aria-pressed={liked}
                className={cn(liked && 'text-primary')}
                title={user ? (liked ? 'Unlike this playlist' : 'Like this playlist') : 'Sign in to like'}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} /> Like
              </Button>
            )}
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

          {/*
           * The description closes the left column. It used to sit between the
           * title and the credits, which pushed the meta row and the buttons
           * down and left a ragged edge. Reading it last keeps every page on
           * the same rhythm: eyebrow, title, credits, actions, notes.
           */}
          {description ? (
            <div className="mt-5 max-w-2xl">
              <ClampedText text={description} lines={6} />
            </div>
          ) : null}
        </div>
      </div>
      </DetailHero>

      <div className="mt-10">
        {tracks.length === 0 ? (
          <EmptyState icon={Music2} title="This playlist is empty">
            Add tracks from anywhere using the "add to playlist" button.
          </EmptyState>
        ) : (
          <TrackList>
            {tracks.map((track, i) => (
              <PlaylistTrackRow
                key={`${track.id}-${i}`}
                track={track}
                index={i}
                context={tracks}
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
              {busy ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <PlaylistArtworkField
            artwork={form.artwork}
            existingUrl={playlist.artwork_url}
            fallback={playlist.user?.avatar_url}
            disabled={busy}
            onChange={(artwork) => setForm((f) => ({ ...f, artwork }))}
          />
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
        message={`"${playlist.title}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete playlist"
        danger
        busy={busy}
      />
    </Page>
  );
}
