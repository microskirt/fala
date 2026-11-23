import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { api, timeAgo, trackArtistName } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { Avatar, Artwork, EmptyState, ErrorState } from '@/components/Media.jsx';
import { PlayButton, AddToQueueButton, AddToPlaylistButton } from '@/components/Controls.jsx';
import { Page, PageHeader, TrackList, TrackListSkeleton } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { trackLink, userLink } from '@/lib/scRoute.js';

/*
 * A `track` entry is either the artist posting their own track or someone
 * reposting a track by another artist. Only the second reads as a repost, and
 * it has to name the original artist.
 */
function describe(item, track) {
  const actor = item.user;
  const owner = track?.user;
  const ownTrack = actor && owner && String(actor.id) === String(owner.id);
  if (item.type === 'track') return ownTrack ? 'shared a track' : 'reposted a track from';
  if (item.type === 'comment') return 'commented';
  if (item.type === 'like') return 'liked a track';
  if (item.type === 'repost') return 'reposted a track from';
  if (item.type === 'follow') return 'followed someone';
  if (item.type === 'playlist') return 'shared a playlist';
  return 'shared something';
}

export function ActivityPage() {
  const { isAuthed } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/me/stream?limit=100');
      setItems(res.collection || []);
    } catch (err) {
      setError(err.message || 'Could not load your activity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthed) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  if (!isAuthed) {
    return (
      <Page>
        <PageHeader title="Activity" />
        <EmptyState
          icon={Activity}
          title="Connect SoundCloud to see your feed"
          action={
            <Button asChild>
              <Link to="/login">Connect SoundCloud</Link>
            </Button>
          }
        >
          New tracks from people you follow appear here.
        </EmptyState>
      </Page>
    );
  }

  const tracks = items.map((x) => x.track).filter(Boolean);

  return (
    <Page>
      <PageHeader
        title="Activity"
        description="New tracks and reposts from the people you follow on SoundCloud."
      />

      {loading ? (
        <TrackListSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState icon={Activity} title="Nothing in your stream yet">
          Follow artists on SoundCloud and their new tracks will land here.
        </EmptyState>
      ) : (
        <TrackList>
          {items.map((item, i) => {
            const track = item.track;
            if (!track) return null;
            return (
              <div
                key={`${track.id}-${i}`}
                className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
              >
                <Link
                  {...userLink(item.user)}
                  className="shrink-0"
                >
                  <Avatar src={item.user?.avatar_url} name={item.user?.username} size={34} />
                </Link>
                <Link {...trackLink(track)} className="shrink-0">
                  <Artwork
                    src={track.artwork_url}
                    fallback={track.user?.avatar_url}
                    alt={track.title}
                    size={52}
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
                    <Link
                      {...userLink(item.user)}
                      className="hover:text-foreground"
                    >
                      {item.user?.username || 'Someone'}
                    </Link>{' '}
                    {describe(item, track)}
                    {track.user && String(track.user.id) !== String(item.user?.id) ? (
                      <>
                        {' '}
                        <Link
                          {...userLink(track.user)}
                          className="hover:text-foreground"
                        >
                          {trackArtistName(track)}
                        </Link>
                      </>
                    ) : null}
                    <span className="opacity-60"> · {timeAgo(item.created_at)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <AddToQueueButton track={track} size={16} />
                  <AddToPlaylistButton track={track} size={16} />
                  <PlayButton track={track} context={tracks} size="sm" />
                </div>
              </div>
            );
          })}
        </TrackList>
      )}
    </Page>
  );
}
