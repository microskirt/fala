import { Link } from '@tanstack/react-router';
import { BadgeCheck } from 'lucide-react';
import { Artwork, Avatar } from '@/components/Media.jsx';
import { trackLink, playlistLink, userLink } from '@/lib/scRoute.js';
import { cn } from '@/lib/utils.js';

/*
 * The own-library match, shared by the search page and the search bar's
 * suggestion list. SoundCloud leads both with the things you already have,
 * because a search for something in your library is usually a search for that
 * thing, and both places show it the same way: cover, title, and what it is.
 */

/* Where a match points. The suggestion list also needs it for the keyboard. */
export function mineLink(item) {
  if (item.kind === 'user') return userLink(item);
  if (item.kind === 'track') return trackLink(item);
  return playlistLink(item);
}

/*
 * The order and the counts. People first, then songs, then one mix, and only a
 * few of each: this is a shortcut into the library, not a second result list.
 */
export function libraryMatches(mine) {
  return [
    ...(mine?.people || []).slice(0, 2),
    ...(mine?.tracks || []).slice(0, 2),
    ...(mine?.playlists || []).slice(0, 1),
  ];
}

export function MineRow({ item, active = false, onNavigate }) {
  if (!item) return null;
  const isPerson = item.kind === 'user';
  const isTrack = item.kind === 'track';
  const subtitle = isPerson
    ? `@${item.permalink}`
    : isTrack
      ? item.user?.username || ''
      : item.user?.username
        ? `${item.user.username}${item.is_album ? ' · album' : ''}`
        : item.is_album
          ? 'Album'
          : 'Playlist';

  return (
    <Link
      {...mineLink(item)}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
      )}
    >
      {isPerson ? (
        <Avatar src={item.avatar_url} name={item.username} size={40} />
      ) : (
        <Artwork
          src={item.artwork_url}
          fallback={item.user?.avatar_url}
          alt={item.title}
          size={40}
          rounded={4}
          kind={isTrack ? 'track' : 'playlist'}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate text-sm font-medium">
          {isPerson ? item.username : item.title}
          {isPerson && item.verified ? (
            <BadgeCheck size={13} className="shrink-0 text-primary" />
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </Link>
  );
}
