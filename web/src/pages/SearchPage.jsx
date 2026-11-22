import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { SearchX, Music2, Users, ListMusic, Disc3, Loader2, Play } from 'lucide-react';
import { api, formatCount, trackPath, userPath } from '../api.js';
import { TrackCard, TrackRow, PlaylistCard, ArtistRow } from '../components/Cards.jsx';
import { EmptyState, Skeleton } from '../components/Media.jsx';

const FILTERS = [
  { id: 'all', label: 'Everything', icon: SparkIcon },
  { id: 'tracks', label: 'Tracks', icon: Music2 },
  { id: 'users', label: 'People', icon: Users },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'albums', label: 'Albums', icon: Disc3 },
];

function SparkIcon(props) {
  return <Play {...props} />;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const filter = params.get('filter') || 'all';
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
          `/api/search?q=${encodeURIComponent(q)}&filter=${filter}&limit=30`
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

  const setFilter = (next) => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('filter');
    else p.set('filter', next);
    setParams(p);
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
      <div className="content-inner">
        <EmptyState icon={Music2} title="Search the catalogue">
          Look for tracks, artists, playlists and albums. Try “ambient”, “lo-fi beats” or an artist
          name.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>Results for “{q}”</h1>
          <p>
            {loading
              ? 'Searching…'
              : data.total_results
              ? `${formatCount(data.total_results)} results`
              : `${data.collection.length} results`}
          </p>
        </div>
      </div>

      <div className="search-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <Skeleton h={0} style={{ paddingBottom: '100%' }} r={8} />
              <Skeleton w="80%" h={12} style={{ marginTop: 10 }} />
              <Skeleton w="55%" h={11} style={{ marginTop: 7 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <EmptyState title="Search failed" icon={SearchX}>
          {error}
        </EmptyState>
      ) : data.collection.length === 0 ? (
        <EmptyState icon={SearchX} title="No results">
          Nothing matched “{q}”. Try a different spelling or a broader term.
        </EmptyState>
      ) : filter === 'all' ? (
        <>
          {grouped.users.length > 0 && (
            <div className="search-group">
              <h2>
                People
                <button type="button" onClick={() => setFilter('users')}>
                  See all
                </button>
              </h2>
              <div className="search-user-grid">
                {grouped.users.slice(0, 6).map((u) => (
                  <ArtistRow key={u.id} user={u} subtitle={u.description} />
                ))}
              </div>
            </div>
          )}

          {grouped.tracks.length > 0 && (
            <div className="search-group">
              <h2>
                Tracks
                <button type="button" onClick={() => setFilter('tracks')}>
                  See all
                </button>
              </h2>
              <div className="card-grid">
                {grouped.tracks.slice(0, 12).map((t) => (
                  <TrackCard key={t.id} track={t} context={grouped.tracks} />
                ))}
              </div>
            </div>
          )}

          {grouped.playlists.length > 0 && (
            <div className="search-group">
              <h2>
                Playlists &amp; albums
                <button type="button" onClick={() => setFilter('playlists')}>
                  See all
                </button>
              </h2>
              <div className="card-grid">
                {grouped.playlists.slice(0, 12).map((p) => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : filter === 'users' ? (
        <div className="search-user-grid">
          {grouped.users.map((u) => (
            <ArtistRow key={u.id} user={u} subtitle={u.description} />
          ))}
        </div>
      ) : filter === 'tracks' ? (
        <div className="card-grid">
          {grouped.tracks.map((t) => (
            <TrackCard key={t.id} track={t} context={grouped.tracks} />
          ))}
        </div>
      ) : (
        <div className="card-grid">
          {grouped.playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
        </div>
      )}

      {data.next_href && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
          <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 size={15} className="spin" /> : null}
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
