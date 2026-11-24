import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { SearchX, Music2, Users, ListMusic, Disc3 } from 'lucide-react';
import { api, formatCount } from '@/api.js';
import { TrackCard, PlaylistCard, ArtistRow } from '@/components/Cards.jsx';
import { MineRow, libraryMatches } from '@/components/LibraryMatch.jsx';
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
  /* The Everything tab carries no mark of its own, only the label. */
  { id: 'all', label: 'Everything' },
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
  const [mine, setMine] = useState({ people: [], tracks: [], playlists: [] });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  /*
   * The caller's own songs and playlists are a separate question from the
   * catalogue search, so they are fetched on their own and shown above the
   * generic results. A signed out visit answers with nothing and the block
   * stays out of the way.
   */
  useEffect(() => {
    if (!q.trim()) {
      setMine({ people: [], tracks: [], playlists: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/api/search/mine?q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setMine({
            people: res.people || [],
            tracks: res.tracks || [],
            playlists: res.playlists || [],
          });
        }
      } catch {
        if (!cancelled) setMine({ people: [], tracks: [], playlists: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

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

  /* The same order and counts the search bar's suggestion list uses. */
  const mineRows = useMemo(() => libraryMatches(mine), [mine]);

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
                {f.icon ? <f.icon size={14} /> : null} {f.label}
              </button>
            ))}
          </div>
        }
      />

      {/*
       * The caller's own matches lead the page. SoundCloud puts the songs and
       * playlists you already have at the top, because a search for something
       * you own is usually a search for that thing, not a browse.
       */}
      {filter === 'all' && mineRows.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-muted-foreground">
            In your library
          </h2>
          <div className="grid gap-0.5 rounded-xl border bg-card p-1.5 sm:grid-cols-2">
            {mineRows.map((item) => (
              <MineRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {loading ? (
        <CardGridSkeleton count={12} />
      ) : error ? (
        <EmptyState icon={SearchX} title="Search failed">
          {error}
        </EmptyState>
      ) : data.collection.length === 0 &&
        mineRows.length === 0 ? (
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
