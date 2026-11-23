import { useParams, Link } from '@tanstack/react-router';
import { Heart, ListMusic, Disc3, Repeat2 } from 'lucide-react';
import { formatCount } from '@/api.js';
import { usePagedList } from '@/lib/usePagedList.js';
import { useAutoLoad } from '@/lib/useAutoLoad.js';
import { Artwork, Avatar, ErrorState, EmptyState } from '@/components/Media.jsx';
import { BadgeCheck } from 'lucide-react';
import { userLink, playlistLink } from '@/lib/scRoute.js';
import {
  Page,
  PageHeader,
  PersonGrid,
  CardGrid,
  CardGridSkeleton,
  PersonGridSkeleton,
  LoadMore,
} from '@/components/layout/Page.jsx';

function PersonRow({ user }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
      <Link {...userLink(user)} className="shrink-0">
        <Avatar src={user.avatar_url} name={user.username} size={46} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          {...userLink(user)}
          className="inline-flex items-center gap-1 truncate text-sm font-semibold hover:underline"
        >
          {user.username}
          {user.verified ? <BadgeCheck size={14} className="text-primary" /> : null}
        </Link>
        <div className="truncate text-xs text-muted-foreground">
          {user.followers_count ? `${formatCount(user.followers_count)} followers` : `@${user.permalink}`}
        </div>
      </div>
    </div>
  );
}

function PlaylistTile({ playlist }) {
  if (!playlist) return null;
  return (
    <div className="group min-w-0">
      <Link {...playlistLink(playlist)} className="block overflow-hidden rounded-lg">
        <Artwork
          src={playlist.artwork_url}
          fallback={playlist.user?.avatar_url}
          alt={playlist.title}
          size="100%"
          rounded={0}
          kind="playlist"
        />
      </Link>
      <Link
        {...playlistLink(playlist)}
        className="mt-2.5 block truncate text-sm font-semibold hover:underline"
      >
        {playlist.title}
      </Link>
      {playlist.user ? (
        <Link
          {...userLink(playlist.user)}
          className="block truncate text-xs text-muted-foreground hover:text-foreground"
        >
          {playlist.user.username}
        </Link>
      ) : null}
    </div>
  );
}

/*
 * The three counts under a song used to open modals. They are real pages now,
 * so the list has an address, a back button and the same scroll loader as the
 * rest of the app.
 */
function CollectionPage({ endpoint, title, description, emptyTitle, emptyBody, mode, icon }) {
  // These routes are flat siblings of the song page, so read the params loosely.
  const { id } = useParams({ strict: false });
  const { items, next, loading, loadingMore, error, loadMore } = usePagedList(endpoint(id), {
    limit: 60,
  });
  const sentinelRef = useAutoLoad({ hasMore: !!next, loading: loadingMore, onLoad: loadMore });

  return (
    <Page>
      <PageHeader title={title} description={description} />
      {loading ? (
        mode === 'people' ? <PersonGridSkeleton /> : <CardGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : items.length === 0 ? (
        <EmptyState icon={icon} title={emptyTitle}>
          {emptyBody}
        </EmptyState>
      ) : (
        <>
          {mode === 'people' ? (
            <PersonGrid>
              {items.map((u, i) => (
                <PersonRow key={`${u.id}-${i}`} user={u} />
              ))}
            </PersonGrid>
          ) : (
            <CardGrid>
              {items.map((p, i) => (
                <PlaylistTile key={`${p.id}-${i}`} playlist={p} />
              ))}
            </CardGrid>
          )}
          <LoadMore sentinelRef={sentinelRef} loading={loadingMore} />
        </>
      )}
    </Page>
  );
}

export function TrackLikersPage() {
  return (
    <CollectionPage
      endpoint={(id) => `/api/tracks/${id}/likers`}
      title="Liked by"
      description="Everyone who pressed the heart on this track"
      emptyTitle="Nobody has liked this track yet"
      emptyBody="Be the first one to give it a heart."
      mode="people"
      icon={Heart}
    />
  );
}

export function TrackRepostersPage() {
  return (
    <CollectionPage
      endpoint={(id) => `/api/tracks/${id}/reposters`}
      title="Reposted by"
      description="Everyone who shared this track to their own page"
      emptyTitle="Nobody has reposted this track yet"
      emptyBody="It has not been passed on so far."
      mode="people"
      icon={Repeat2}
    />
  );
}

export function TrackPlaylistsPage() {
  return (
    <CollectionPage
      endpoint={(id) => `/api/tracks/${id}/playlists`}
      title="In playlists"
      description="Playlists that include this track"
      emptyTitle="Not in a playlist yet"
      emptyBody="Nobody has added this track to a playlist so far."
      mode="playlists"
      icon={ListMusic}
    />
  );
}

export function TrackAlbumsPage() {
  return (
    <CollectionPage
      endpoint={(id) => `/api/tracks/${id}/albums`}
      title="In albums"
      description="Albums that include this track"
      emptyTitle="Not on an album yet"
      emptyBody="This track does not belong to an album so far."
      mode="playlists"
      icon={Disc3}
    />
  );
}
