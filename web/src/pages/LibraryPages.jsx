import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Heart,
  ListMusic,
  Repeat2,
  Users,
  History as HistoryIcon,
  Play,
  Plus,
  Loader2,
} from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { TrackCard, PlaylistCard, ArtistRow, TrackRow } from '@/components/Cards.jsx';
import { ErrorState, EmptyState } from '@/components/Media.jsx';
import { Modal } from '@/components/Modal.jsx';
import {
  Page,
  PageHeader,
  CardGrid,
  PersonGrid,
  TrackList,
  CardGridSkeleton,
  TrackListSkeleton,
  PersonGridSkeleton,
} from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Switch } from '@/components/ui/switch.jsx';

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

function SignInPrompt({ icon, title, children }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      action={
        <Button asChild>
          <Link to="/login">Connect SoundCloud</Link>
        </Button>
      }
    >
      {children}
    </EmptyState>
  );
}

function TrackCollectionPage({
  title,
  description,
  endpoint,
  icon,
  emptyTitle,
  emptyBody,
  signedOutTitle,
  signedOutBody,
}) {
  const { isAuthed } = useAuth();
  const { playQueue } = usePlayer();
  const { items, loading, error, reload } = useList(endpoint, [isAuthed]);

  if (!isAuthed) {
    return (
      <Page>
        <PageHeader title={title} />
        <SignInPrompt icon={icon} title={signedOutTitle}>
          {signedOutBody}
        </SignInPrompt>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={title}
        description={description(items.length)}
        actions={
          items.length > 0 ? (
            <Button onClick={() => playQueue(items, 0)}>
              <Play size={14} fill="currentColor" /> Play all
            </Button>
          ) : null
        }
      />
      {loading ? (
        <CardGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={icon} title={emptyTitle}>
          {emptyBody}
        </EmptyState>
      ) : (
        <CardGrid>
          {items.map((t) => (
            <TrackCard key={t.id} track={t} context={items} />
          ))}
        </CardGrid>
      )}
    </Page>
  );
}

export function LikesPage() {
  return (
    <TrackCollectionPage
      title="Likes"
      endpoint="/api/me/likes"
      icon={Heart}
      signedOutTitle="Sign in to see your likes"
      signedOutBody="Connect SoundCloud to build a collection of everything you love."
      description={(n) => `${n} track${n === 1 ? '' : 's'} you have liked`}
      emptyTitle="No likes yet"
      emptyBody="Tap the heart on any track and it will show up here."
    />
  );
}

export function RepostsPage() {
  return (
    <TrackCollectionPage
      title="Reposts"
      endpoint="/api/me/reposts"
      icon={Repeat2}
      signedOutTitle="Sign in to see your reposts"
      signedOutBody="Connect SoundCloud to share tracks with your followers."
      description={(n) => `${n} track${n === 1 ? '' : 's'} shared to your profile`}
      emptyTitle="Nothing reposted yet"
      emptyBody="Reposting puts a track on your profile and in your followers feeds."
    />
  );
}

export function HistoryPage() {
  const { isAuthed } = useAuth();
  const { playQueue } = usePlayer();
  const { items, loading, error, reload } = useList('/api/me/history', [isAuthed]);

  if (!isAuthed) {
    return (
      <Page>
        <PageHeader title="Listening history" />
        <SignInPrompt icon={HistoryIcon} title="Sign in to keep a history">
          Your recent plays will appear here once you are signed in.
        </SignInPrompt>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Listening history"
        description="The last 50 tracks you played on this account"
        actions={
          items.length > 0 ? (
            <Button onClick={() => playQueue(items, 0)}>
              <Play size={14} fill="currentColor" /> Play all
            </Button>
          ) : null
        }
      />
      {loading ? (
        <TrackListSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nothing played yet">
          Tracks you listen to will show up here.
        </EmptyState>
      ) : (
        <TrackList>
          {items.map((t, i) => (
            <TrackRow key={`${t.id}-${i}`} track={t} index={i} context={items} />
          ))}
        </TrackList>
      )}
    </Page>
  );
}

export function FollowingPage() {
  const { isAuthed } = useAuth();
  const { items, loading, error, reload } = useList('/api/me/following', [isAuthed]);

  if (!isAuthed) {
    return (
      <Page>
        <PageHeader title="Following" />
        <SignInPrompt icon={Users} title="Sign in to see who you follow">
          Follow artists and people to shape your home feed.
        </SignInPrompt>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Following"
        description={`${items.length} account${items.length === 1 ? '' : 's'} you follow`}
      />
      {loading ? (
        <PersonGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={Users} title="You are not following anyone yet">
          Find artists you like and hit follow - their activity lands on your home page.
        </EmptyState>
      ) : (
        <PersonGrid>
          {items.map((person) => (
            <ArtistRow key={person.id} user={person} subtitle={person.description} />
          ))}
        </PersonGrid>
      )}
    </Page>
  );
}

export function PlaylistsPage() {
  const { isAuthed } = useAuth();
  const { playlists, createPlaylist } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', is_private: false });
  const [busy, setBusy] = useState(false);

  if (!isAuthed) {
    return (
      <Page>
        <PageHeader title="Playlists" />
        <SignInPrompt icon={ListMusic} title="Sign in to build playlists">
          Connect SoundCloud to collect tracks into playlists.
        </SignInPrompt>
      </Page>
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
    <Page>
      <PageHeader
        title="Playlists"
        description={`${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> New playlist
          </Button>
        }
      />

      {playlists.length === 0 ? (
        <EmptyState
          icon={ListMusic}
          title="No playlists yet"
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Create your first playlist
            </Button>
          }
        >
          Playlists are a great way to group tracks for a mood, a set or a drive.
        </EmptyState>
      ) : (
        <CardGrid>
          {playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
        </CardGrid>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New playlist"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !form.title.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create playlist
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-pl-title">Title</Label>
            <Input
              id="new-pl-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Late night drive"
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-pl-desc">Description</Label>
            <Textarea
              id="new-pl-desc"
              className="min-h-24"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional"
              maxLength={2000}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="leading-tight">
              <div className="text-sm font-medium">Private</div>
              <div className="text-xs text-muted-foreground">Only you can see this playlist.</div>
            </div>
            <Switch
              checked={form.is_private}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_private: v }))}
            />
          </div>
        </div>
      </Modal>
    </Page>
  );
}
