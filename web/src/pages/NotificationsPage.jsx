import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Heart, Repeat2, MessageSquare, UserPlus, Play, Loader2 } from 'lucide-react';
import { api, timeAgo, userPath, trackPath } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Avatar, Artwork, EmptyState, ErrorState, Skeleton } from '../components/Media.jsx';
import { PlayButton } from '../components/Controls.jsx';

const VERBS = {
  track: 'shared a track',
  comment: 'commented',
  like: 'liked a track',
  repost: 'reposted',
  follow: 'followed someone',
  playlist: 'shared a playlist',
};

export function NotificationsPage() {
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
      <div className="content-inner">
        <EmptyState icon={Activity} title="Connect SoundCloud to see your feed">
          Your SoundCloud stream — new tracks from people you follow — appears here.
          <div style={{ marginTop: 14 }}>
            <Link to="/login" className="btn primary">
              Connect SoundCloud
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>New tracks and reposts from the people you follow on SoundCloud.</p>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} h={64} r={8} />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState icon={Activity} title="Nothing in your stream yet">
          Follow artists on SoundCloud and their new tracks will land here.
        </EmptyState>
      ) : (
        <div className="track-list">
          {items.map((item, i) => {
            const track = item.track;
            if (!track) return null;
            return (
              <div className="track-row" key={`${track.id}-${i}`}>
                <div style={{ width: 34, flex: 'none' }}>
                  <Link to={userPath(item.user)}>
                    <Avatar src={item.user?.avatar_url} name={item.user?.username} size={34} />
                  </Link>
                </div>
                <Link to={trackPath(track)} style={{ flex: 'none' }}>
                  <Artwork src={track.artwork_url} alt={track.title} size={52} rounded={6} />
                </Link>
                <div className="row-main">
                  <Link className="title" to={trackPath(track)}>
                    {track.title}
                  </Link>
                  <div className="sub">
                    <Link to={userPath(item.user)}>{item.user?.username || 'Someone'}</Link>{' '}
                    {VERBS[item.type] || 'shared something'}
                    <span className="faint"> · {timeAgo(item.created_at)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <PlayButton track={track} context={items.map((x) => x.track).filter(Boolean)} size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
