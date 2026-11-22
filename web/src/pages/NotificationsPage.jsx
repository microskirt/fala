import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Heart, Repeat2, MessageSquare, UserPlus, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { Avatar, Artwork, EmptyState } from '../components/Media.jsx';
import { timeAgo, userPath, trackPath } from '../api.js';

const ICONS = {
  like: Heart,
  repost: Repeat2,
  comment: MessageSquare,
  follow: UserPlus,
};

const VERBS = {
  like: 'liked your track',
  repost: 'reposted your track',
  comment: 'commented on your track',
  follow: 'started following you',
};

export function NotificationsPage() {
  const { isAuthed } = useAuth();
  const { notifications, refreshNotifications, markNotificationsRead, counts } = useLibrary();

  useEffect(() => {
    if (isAuthed) refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  if (!isAuthed) {
    return (
      <div className="content-inner">
        <EmptyState icon={Bell} title="Sign in to see notifications">
          Likes, reposts, comments and new followers will show up here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>{counts.unread > 0 ? `${counts.unread} unread` : 'You are all caught up'}</p>
        </div>
        {counts.unread > 0 && (
          <button type="button" className="btn sm" onClick={markNotificationsRead}>
            <Check size={14} /> Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet">
          When people interact with your tracks or profile, you will see it here.
        </EmptyState>
      ) : (
        <div className="notif-list">
          {notifications.map((n) => {
            const Icon = ICONS[n.type] || Bell;
            const track = n.subject?.track;
            return (
              <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}>
                <Link to={userPath(n.actor)}>
                  <Avatar src={n.actor?.avatar_url} name={n.actor?.username} size={40} />
                </Link>
                <div className="notif-text">
                  <Link to={userPath(n.actor)}>
                    <strong>{n.actor?.username || 'Someone'}</strong>
                  </Link>{' '}
                  {VERBS[n.type] || 'interacted with you'}
                  {n.type === 'comment' && n.subject?.extra ? `: “${n.subject.extra}”` : ''}
                  <div className="row" style={{ gap: 6, marginTop: 4, fontSize: 11.5 }}>
                    <Icon size={12} color="var(--accent)" />
                    <span className="faint">{timeAgo(n.created_at)}</span>
                  </div>
                </div>
                {track && (
                  <Link to={trackPath(track)}>
                    <Artwork src={track.artwork_url} alt={track.title} size={44} rounded={4} />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
