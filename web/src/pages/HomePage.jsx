import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Play, RefreshCw, Radio } from 'lucide-react';
import { api, timeAgo } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { TrackCard, PlaylistCard, ArtistCard, SectionScroller } from '@/components/Cards.jsx';
import { Artwork, Avatar, ErrorState, EmptyState } from '@/components/Media.jsx';
import {
  PlayButton,
  LikeButton,
  AddToQueueButton,
  AddToPlaylistButton,
} from '@/components/Controls.jsx';
import { Page, PageHeader, Section, CardGridSkeleton } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { trackLink, userLink, playlistLink } from '@/lib/scRoute.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const VERB = {
  like: 'liked a track',
  repost: 'reposted a track',
  playlist: 'shared a playlist',
};

function FeedItem({ item }) {
  const isPlaylist = item.type === 'playlist';
  const track = item.track;
  const playlist = item.playlist;

  return (
    <div className="flex gap-3 border-b border-border/60 py-3.5 last:border-0">
      <Link {...userLink(item.user)} className="shrink-0">
        <Avatar src={item.user?.avatar_url} name={item.user?.username} size={38} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-muted-foreground">
          <Link
            {...userLink(item.user)}
            className="font-semibold text-foreground hover:underline"
          >
            {item.user?.username}
          </Link>{' '}
          {VERB[item.type] || 'shared something'}
          <span className="mx-1.5 opacity-40">·</span>
          <span>{timeAgo(item.created_at)}</span>
        </div>

        {isPlaylist && playlist ? (
          <div className="mt-2 flex items-center gap-2.5">
            <Link {...playlistLink(playlist)} className="shrink-0">
              <Artwork
                src={playlist.artwork_url}
                alt={playlist.title}
                size={46}
                rounded={6}
                kind="playlist"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                {...playlistLink(playlist)}
                className="block truncate text-sm font-medium hover:underline"
              >
                {playlist.title}
              </Link>
              <div className="text-xs text-muted-foreground">
                {playlist.track_count} track{playlist.track_count === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        ) : track ? (
          <div className="mt-2 flex items-center gap-2.5">
            <Link {...trackLink(track)} className="shrink-0">
              <Artwork src={track.artwork_url} alt={track.title} size={46} rounded={6} />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                {...trackLink(track)}
                className="block truncate text-sm font-medium hover:underline"
              >
                {track.title}
              </Link>
              {track.user ? (
                <Link
                  {...userLink(track.user)}
                  className="block truncate text-xs text-muted-foreground hover:text-foreground"
                >
                  {track.user.username}
                </Link>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <LikeButton track={track} size={16} />
              <AddToQueueButton track={track} size={16} />
              <AddToPlaylistButton track={track} size={16} />
              <PlayButton track={track} size="sm" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function HomePage() {
  const { user, isAuthed } = useAuth();
  const { playQueue } = usePlayer();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/home');
      setSections(res.sections || []);
    } catch (err) {
      setError(err.message || 'Could not load your home feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  return (
    <Page>
      <PageHeader
        title={`${greeting()}${isAuthed && user ? `, ${user.username}` : ''}`}
        description={
          isAuthed
            ? 'Mixes, stations and tracks picked from what you listen to.'
            : 'Mixes and tracks picked for you by SoundCloud.'
        }
      />

      {loading ? (
        <div className="flex flex-col gap-10">
          {[0, 1].map((s) => (
            <div key={s}>
              <div className="mb-4 h-5 w-40 animate-pulse rounded-md bg-muted" />
              <CardGridSkeleton count={6} />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : sections.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Nothing to show yet"
          action={
            <Button variant="outline" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </Button>
          }
        >
          Try refreshing in a moment.
        </EmptyState>
      ) : (
        sections.map((section) => {
          if (section.kind === 'feed') {
            return (
              <Section
                key={section.id}
                title={section.title}
                description={section.subtitle}
                className="max-w-3xl"
              >
                <div>
                  {section.items.slice(0, 8).map((item, i) => (
                    <FeedItem key={i} item={item} />
                  ))}
                </div>
              </Section>
            );
          }

          const tracks = section.items.filter((i) => i.kind === 'track');
          const isPlaylistish = (kind) =>
            kind === 'playlist' || kind === 'system-playlist' || kind === 'album';

          return (
            <SectionScroller
              key={section.id}
              title={section.title}
              subtitle={section.subtitle}
              action={
                tracks.length > 3 ? (
                  <Button variant="outline" size="sm" onClick={() => playQueue(tracks, 0)}>
                    <Play size={14} fill="currentColor" /> Play all
                  </Button>
                ) : null
              }
            >
              {section.items.map((item, i) =>
                item.kind === 'track' ? (
                  <TrackCard key={`t-${item.id}-${i}`} track={item} context={tracks} />
                ) : isPlaylistish(item.kind) ? (
                  <PlaylistCard key={`p-${item.id}-${i}`} playlist={item} />
                ) : item.kind === 'user' ? (
                  <ArtistCard key={`u-${item.id}-${i}`} user={item} />
                ) : null
              )}
            </SectionScroller>
          );
        })
      )}
    </Page>
  );
}
