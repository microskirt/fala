import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { LibraryBig } from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useLibrary } from '@/context/LibraryContext.jsx';
import { TrackCard, PlaylistCard, ArtistRow, TrackRow } from '@/components/Cards.jsx';
import { EmptyState } from '@/components/Media.jsx';
import { Page, PageHeader, Section, CardGrid, PersonGrid, TrackList, CardGridSkeleton } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';

function useList(endpoint, deps = []) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(endpoint)
      .then((res) => !cancelled && setItems(res.collection || []))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { items, loading };
}

export function LibraryPage() {
  const { isAuthed, user } = useAuth();
  const { playlists } = useLibrary();
  const likes = useList('/api/me/likes', [isAuthed]);
  const following = useList('/api/me/following', [isAuthed]);
  const history = useList('/api/me/history', [isAuthed]);

  if (!isAuthed) {
    return (
      <Page>
        <PageHeader title="Your library" />
        <EmptyState
          icon={LibraryBig}
          title="Sign in to open your library"
          action={
            <Button asChild>
              <Link to="/login">Connect SoundCloud</Link>
            </Button>
          }
        >
          Your likes, playlists, reposts and history live here.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Your library" description={`Everything saved to @${user.permalink}`} />

      <Section
        title="Playlists"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/playlists">Manage</Link>
          </Button>
        }
      >
        {playlists.length === 0 ? (
          <p className="text-sm text-muted-foreground">No playlists yet. Create one from the Playlists page.</p>
        ) : (
          <CardGrid>
            {playlists.slice(0, 6).map((p) => (
              <PlaylistCard key={p.id} playlist={p} />
            ))}
          </CardGrid>
        )}
      </Section>

      <Section
        title="Recent likes"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/likes">See all</Link>
          </Button>
        }
      >
        {likes.loading ? (
          <CardGridSkeleton count={6} />
        ) : likes.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing liked yet.</p>
        ) : (
          <CardGrid>
            {likes.items.slice(0, 6).map((t) => (
              <TrackCard key={t.id} track={t} context={likes.items} />
            ))}
          </CardGrid>
        )}
      </Section>

      <Section
        title="Following"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/following">See all</Link>
          </Button>
        }
      >
        {following.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">You are not following anyone yet.</p>
        ) : (
          <PersonGrid>
            {following.items.slice(0, 6).map((person) => (
              <ArtistRow key={person.id} user={person} subtitle={person.description} />
            ))}
          </PersonGrid>
        )}
      </Section>

      <Section
        title="Recently played"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/history">See all</Link>
          </Button>
        }
      >
        {history.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing played yet.</p>
        ) : (
          <TrackList>
            {history.items.slice(0, 6).map((t, i) => (
              <TrackRow key={`${t.id}-${i}`} track={t} index={i} context={history.items} />
            ))}
          </TrackList>
        )}
      </Section>
    </Page>
  );
}
