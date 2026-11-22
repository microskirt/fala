import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Play, Flame, Disc3, Headphones, TrendingUp, Music2, ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { TrackCard, PlaylistCard, SectionScroller, TrackRow } from '../components/Cards.jsx';
import { Skeleton, ErrorState, EmptyState } from '../components/Media.jsx';

export function DiscoverPage() {
  const { playQueue } = usePlayer();
  const [genres, setGenres] = useState([]);
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeGenre, setActiveGenre] = useState(null);
  const [genreTracks, setGenreTracks] = useState([]);
  const [genreLoading, setGenreLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, c] = await Promise.all([
        api.get('/api/genres').catch(() => ({ collection: [] })),
        api.get('/api/charts?limit=30').catch(() => ({ collection: [] })),
      ]);
      setGenres(g.collection || []);
      setCharts(c.collection || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openGenre = async (genre) => {
    setActiveGenre(genre);
    setGenreLoading(true);
    setGenreTracks([]);
    try {
      const res = await api.get(`/api/system-playlists/${encodeURIComponent(genre.id)}`);
      setGenreTracks((res.tracks || []).filter((t) => t.kind === 'track'));
    } catch {
      setGenreTracks([]);
    } finally {
      setGenreLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="content-inner">
        <Skeleton w={220} h={28} style={{ marginBottom: 8 }} />
        <Skeleton w={340} h={14} style={{ marginBottom: 26 }} />
        <div className="card-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <Skeleton h={0} style={{ paddingBottom: '100%' }} r={8} />
              <Skeleton w="80%" h={12} style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="content-inner">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="content-inner">
      <div className="home-hero">
        <span className="eyebrow">
          <Flame size={12} /> Discover
        </span>
        <h1>Find your next favourite sound.</h1>
        <p>
          Trending charts, genre stations and editorial picks — all pulled live from the
          SoundCloud catalogue.
        </p>
        {charts.length > 0 && (
          <div className="hero-actions">
            <button type="button" className="btn primary" onClick={() => playQueue(charts, 0)}>
              <Play size={15} fill="currentColor" /> Play the charts
            </button>
          </div>
        )}
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>
              <Disc3 size={19} /> Browse by genre
            </h2>
            <div className="section-sub">Trending tracks in the genres people are playing now</div>
          </div>
        </div>
        <div className="chip-row">
          {genres.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`chip ${activeGenre?.id === g.id ? 'active' : ''}`}
              onClick={() => openGenre(g)}
            >
              {g.title}
            </button>
          ))}
          {genres.length === 0 && <span className="faint">Genre stations are unavailable right now.</span>}
        </div>

        {activeGenre && (
          <div style={{ marginTop: 22 }}>
            <div className="section-toolbar">
              <h3 className="row" style={{ gap: 8 }}>
                <TrendingUp size={16} /> Trending in {activeGenre.title}
              </h3>
              {genreTracks.length > 0 && (
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => playQueue(genreTracks, 0)}
                >
                  <Play size={13} fill="currentColor" /> Play station
                </button>
              )}
            </div>
            {genreLoading ? (
              <div className="card-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} h={0} style={{ paddingBottom: '100%' }} r={8} />
                ))}
              </div>
            ) : genreTracks.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No tracks available for this station right now.
              </p>
            ) : (
              <div className="card-grid">
                {genreTracks.map((t) => (
                  <TrackCard key={t.id} track={t} context={genreTracks} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>
              <TrendingUp size={19} /> Global charts
            </h2>
            <div className="section-sub">The most played tracks across SoundCloud</div>
          </div>
          {charts.length > 0 && (
            <button type="button" className="btn sm" onClick={() => playQueue(charts, 0)}>
              <Play size={13} fill="currentColor" /> Play all
            </button>
          )}
        </div>
        <div className="card-grid">
          {charts.map((t) => (
            <TrackCard key={t.id} track={t} context={charts} />
          ))}
        </div>
      </section>
    </div>
  );
}
