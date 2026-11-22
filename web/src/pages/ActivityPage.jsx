import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { api, timeAgo } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { Avatar, Artwork, EmptyState, ErrorState } from '@/components/Media.jsx';
import { PlayButton } from '@/components/Controls.jsx';
import { Page, PageHeader, TrackList, TrackListSkeleton } from '@/components/layout/Page.jsx';
import { Button } from '@/components/ui/button.jsx';

const VERBS = {
  track: 'shared a track',
  comment: 'commented',
  like: 'liked a track',
  repost: 'reposted',
  follow: 'followed someone',
  playlist: 'shared a playlist',
};

export function ActivityPage() {
  const { isAuthed } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/me/stream?limit=40');
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
                  to="/artist/$id"
                  params={{ id: String(item.user?.id) }}
                  className="shrink-0"
                >
                  <Avatar src={item.user?.avatar_url} name={item.user?.username} size={34} />
                </Link>
                <Link to="/track/$id" params={{ id: String(track.id) }} className="shrink-0">
                  <Artwork src={track.artwork_url} alt={track.title} size={52} rounded={6} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/track/$id"
                    params={{ id: String(track.id) }}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {track.title}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    <Link
                      to="/artist/$id"
                      params={{ id: String(item.user?.id) }}
                      className="hover:text-foreground"
                    >
                      {item.user?.username || 'Someone'}
                    </Link>{' '}
                    {VERBS[item.type] || 'shared something'}
                    <span className="opacity-60"> · {timeAgo(item.created_at)}</span>
                  </div>
                </div>
                <div className="shrink-0">
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
