import { useEffect, useState } from 'react';
import { Flame, Play, TrendingUp } from 'lucide-react';
import { api } from '@/api.js';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { TrackCard } from '@/components/Cards.jsx';
import { ErrorState } from '@/components/Media.jsx';
import { Page, Section, CardGrid, CardGridSkeleton, Eyebrow } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

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
      <Page>
        <div className="mb-8 flex flex-col gap-2">
          <div className="h-7 w-52 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded-md bg-muted" />
        </div>
        <CardGridSkeleton count={12} />
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <ErrorState message={error} onRetry={load} />
      </Page>
    );
  }

  return (
    <Page>
      <div className="relative mb-10 overflow-hidden rounded-xl border bg-card p-6 sm:p-9">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(70% 120% at 15% 0%, color-mix(in srgb, var(--primary) 20%, transparent), transparent 70%)',
          }}
        />
        <div className="relative max-w-2xl">
          <Eyebrow>
            <Flame size={14} /> Discover
          </Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Find something new to play.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Trending charts, genre stations and editorial picks, all pulled live from the
            SoundCloud catalogue.
          </p>
          {charts.length > 0 ? (
            <Button className="mt-5" onClick={() => playQueue(charts, 0)}>
              <Play size={16} fill="currentColor" /> Play the charts
            </Button>
          ) : null}
        </div>
      </div>

      <Section title="Browse by genre" description="Trending tracks in the genres people are playing now">
        <div className="flex flex-wrap gap-2">
          {genres.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => openGenre(g)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                activeGenre?.id === g.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              )}
            >
              {g.title}
            </button>
          ))}
          {genres.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              Genre stations are unavailable right now.
            </span>
          ) : null}
        </div>

        {activeGenre ? (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <TrendingUp size={16} /> Trending in {activeGenre.title}
              </h3>
              {genreTracks.length > 0 ? (
                <Button size="sm" onClick={() => playQueue(genreTracks, 0)}>
                  <Play size={14} fill="currentColor" /> Play station
                </Button>
              ) : null}
            </div>
            {genreLoading ? (
              <CardGridSkeleton count={6} />
            ) : genreTracks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tracks available for this station right now.
              </p>
            ) : (
              <CardGrid>
                {genreTracks.map((t) => (
                  <TrackCard key={t.id} track={t} context={genreTracks} />
                ))}
              </CardGrid>
            )}
          </div>
        ) : null}
      </Section>

      <Section
        title={
          <span className="inline-flex items-center gap-2">
            <TrendingUp size={18} /> Global charts
          </span>
        }
        description="The most played tracks across SoundCloud"
        actions={
          charts.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => playQueue(charts, 0)}>
              <Play size={14} fill="currentColor" /> Play all
            </Button>
          ) : null
        }
      >
        <CardGrid>
          {charts.map((t) => (
            <TrackCard key={t.id} track={t} context={charts} />
          ))}
        </CardGrid>
      </Section>
    </Page>
  );
}
