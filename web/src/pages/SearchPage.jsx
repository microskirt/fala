import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { SearchX, Music2, Users, ListMusic, Disc3, Sparkles } from 'lucide-react';
import { api, formatCount } from '@/api.js';
import { TrackCard, PlaylistCard, ArtistRow } from '@/components/Cards.jsx';
import { EmptyState } from '@/components/Media.jsx';
import {
  Page,
  PageHeader,
  CardGrid,
  PersonGrid,
  CardGridSkeleton,
  LoadMore,
} from '@/components/layout/Page.jsx';
import { useAutoLoad } from '@/lib/useAutoLoad.js';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

const FILTERS = [
  { id: 'all', label: 'Everything', icon: Sparkles },
  { id: 'tracks', label: 'Tracks', icon: Music2 },
  { id: 'users', label: 'People', icon: Users },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'albums', label: 'Albums', icon: Disc3 },
];

function SeeAll({ onClick }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      See all
    </Button>
  );
}

export function SearchPage() {
  const { q = '', filter = 'all' } = useSearch({ from: '/shell/search' });
  const navigate = useNavigate();
  const [data, setData] = useState({ collection: [], next_href: null, total_results: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!q.trim()) {
      setData({ collection: [], next_href: null, total_results: 0 });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await api.get(
          `/api/search?q=${encodeURIComponent(q)}&filter=${filter}&limit=100`
        );
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q, filter]);

  const loadMore = async () => {
    if (!data.next_href || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.get(`/api/next?href=${encodeURIComponent(data.next_href)}`);
      setData((prev) => ({
        ...res,
        collection: [...prev.collection, ...res.collection],
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const sentinel = useAutoLoad({
    hasMore: !!data.next_href,
    loading: loadingMore,
    onLoad: loadMore,
  });

  const setFilter = (next) => {
    navigate({
      to: '/search',
      search: (prev) => ({ ...prev, filter: next === 'all' ? undefined : next }),
      replace: true,
    });
  };

  const grouped = useMemo(() => {
    const g = { tracks: [], users: [], playlists: [] };
    for (const item of data.collection) {
      if (item.kind === 'track') g.tracks.push(item);
      else if (item.kind === 'user') g.users.push(item);
      else if (item.kind === 'playlist') g.playlists.push(item);
    }
    return g;
  }, [data.collection]);

  if (!q.trim()) {
    return (
      <Page>
        <EmptyState icon={Music2} title="Search the catalogue">
          Look for tracks, artists, playlists and albums. Try “ambient”, “lo-fi beats” or an artist
          name.
        </EmptyState>
      </Page>
    );
  }

  const countLabel = loading
    ? 'Searching…'
    : data.total_results
      ? `${formatCount(data.total_results)} results`
      : `${data.collection.length} results`;

  return (
    <Page className="pb-24">
      <PageHeader
        title={`Results for “${q}”`}
        description={countLabel}
        actions={
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/40 p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                  filter === f.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <f.icon size={14} /> {f.label}
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <CardGridSkeleton count={12} />
      ) : error ? (
        <EmptyState icon={SearchX} title="Search failed">
          {error}
        </EmptyState>
      ) : data.collection.length === 0 ? (
        <EmptyState icon={SearchX} title="No results">
          Nothing matched “{q}”. Try a different spelling or a broader term.
        </EmptyState>
      ) : filter === 'all' ? (
        <div className="flex flex-col gap-10">
          {grouped.users.length > 0 ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">People</h2>
                <SeeAll onClick={() => setFilter('users')} />
              </div>
              <PersonGrid>
                {grouped.users.slice(0, 6).map((u) => (
                  <ArtistRow key={u.id} user={u} subtitle={u.description} />
                ))}
              </PersonGrid>
            </section>
          ) : null}

          {grouped.tracks.length > 0 ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Tracks</h2>
                <SeeAll onClick={() => setFilter('tracks')} />
              </div>
              <CardGrid>
                {grouped.tracks.slice(0, 12).map((t) => (
                  <TrackCard key={t.id} track={t} context={grouped.tracks} />
                ))}
              </CardGrid>
            </section>
          ) : null}

          {grouped.playlists.length > 0 ? (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Playlists &amp; albums</h2>
                <SeeAll onClick={() => setFilter('playlists')} />
              </div>
              <CardGrid>
                {grouped.playlists.slice(0, 12).map((p) => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </CardGrid>
            </section>
          ) : null}
        </div>
      ) : filter === 'users' ? (
        <PersonGrid>
          {grouped.users.map((u) => (
            <ArtistRow key={u.id} user={u} subtitle={u.description} />
          ))}
        </PersonGrid>
      ) : filter === 'tracks' ? (
        <CardGrid>
          {grouped.tracks.map((t) => (
            <TrackCard key={t.id} track={t} context={grouped.tracks} />
          ))}
        </CardGrid>
      ) : (
        <CardGrid>
          {grouped.playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
        </CardGrid>
      )}

      <LoadMore sentinelRef={sentinel} loading={loadingMore} />
    </Page>
  );
}
