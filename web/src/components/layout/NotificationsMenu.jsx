import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bell, Heart, Repeat2, ListMusic, MessageSquare, UserPlus, Loader2 } from 'lucide-react';
import { api, timeAgo } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { Avatar, Artwork } from '@/components/Media.jsx';
import { Button } from '@/components/ui/button.jsx';
import { KEYS, readKey, writeKey } from '@/lib/storage.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';

const COPY = {
  'track-like': { verb: 'liked your track', icon: Heart },
  'track-repost': { verb: 'reposted your track', icon: Repeat2 },
  'playlist-like': { verb: 'liked your playlist', icon: ListMusic },
  'playlist-repost': { verb: 'reposted your playlist', icon: ListMusic },
  comment: { verb: 'commented on your track', icon: MessageSquare },
  'comment-like': { verb: 'liked your comment', icon: Heart },
  affiliation: { verb: 'added you as a collaborator', icon: UserPlus },
  follow: { verb: 'followed you', icon: UserPlus },
};

// Newest first, so the first entry identifies the whole batch.
function newestStamp(items) {
  const first = items[0];
  return first ? String(first.id ?? first.created_at ?? '') : '';
}

export function NotificationsMenu() {
  const { isAuthed } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [seen, setSeen] = useState(() => readKey(KEYS.notificationsSeen));

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    // Fetch on mount too, so the dot reflects reality before the menu is opened.
    api
      .get('/api/me/notifications?limit=30')
      .then((res) => !cancelled && setItems(res.collection || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!open || !isAuthed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get('/api/me/notifications?limit=30')
      .then((res) => !cancelled && setItems(res.collection || []))
      .catch((err) => !cancelled && setError(err.message || 'Could not load notifications'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, isAuthed]);

  /*
   * A browser that has never opened the menu has nothing recorded, so it shows
   * the dot once to teach the interaction. Opening the menu stores the newest
   * entry and clears it until something newer actually arrives.
   */
  const hasUnread = useMemo(() => {
    if (!isAuthed || items.length === 0) return false;
    if (seen === null) return true;
    return newestStamp(items) !== seen;
  }, [isAuthed, items, seen]);

  const markSeen = () => {
    const stamp = newestStamp(items);
    if (!stamp) return;
    setSeen(stamp);
    writeKey(KEYS.notificationsSeen, stamp);
  };

  if (!isAuthed) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) markSeen();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={hasUnread ? 'Notifications, unread' : 'Notifications'}
          title="Notifications"
        >
          <Bell size={18} />
          {hasUnread ? (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-background" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-[380px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : error ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{error}</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nothing yet. Likes, reposts and comments on your tracks show up here.
            </p>
          ) : (
            items.map((n) => {
              const meta = COPY[n.type] || { verb: 'sent you an update', icon: Bell };
              const Icon = meta.icon;
              const track = n.track;
              return (
                <div
                  key={n.id}
                  className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent/60"
                >
                  <Link
                    to="/artist/$id"
                    params={{ id: String(n.user?.id) }}
                    className="shrink-0"
                  >
                    <Avatar src={n.user?.avatar_url} name={n.user?.username} size={32} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm leading-snug">
                      <Link
                        to="/artist/$id"
                        params={{ id: String(n.user?.id) }}
                        className="font-semibold hover:underline"
                      >
                        {n.user?.username || 'Someone'}
                      </Link>{' '}
                      <span className="text-muted-foreground">{meta.verb}</span>
                    </div>
                    {n.comment?.body ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {n.comment.body}
                      </p>
                    ) : null}
                    {track ? (
                      <Link
                        to="/track/$id"
                        params={{ id: String(track.id) }}
                        className="mt-1 flex items-center gap-2"
                      >
                        <Artwork src={track.artwork_url} alt={track.title} size={32} rounded={4} />
                        <span className="min-w-0 truncate text-xs font-medium hover:underline">
                          {track.title}
                        </span>
                      </Link>
                    ) : null}
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Icon size={12} /> {timeAgo(n.created_at)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
