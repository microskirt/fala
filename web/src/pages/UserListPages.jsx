import { useEffect, useState } from 'react';
import { Users, UserPlus } from 'lucide-react';
import { api } from '@/api.js';
import { usePagedList } from '@/lib/usePagedList.js';
import { useAutoLoad } from '@/lib/useAutoLoad.js';
import { useUserId } from '@/lib/useResolvedId.js';
import { ErrorState, EmptyState } from '@/components/Media.jsx';
import { ArtistRow } from '@/components/Cards.jsx';
import { Page, PageHeader, PersonGrid, PersonGridSkeleton, LoadMore } from '@/components/layout/Page.jsx';

/*
 * Followers and following used to open a list under the tabs on the profile,
 * which mixed them in with the artist's own uploads. They are their own pages
 * now, with an address and a back button, the same way the counts under a song
 * open their own lists.
 */
function UserListPage({ tab, title, description, emptyTitle, emptyBody, icon }) {
  // The list answers on the id form and on the artist slug form.
  const { id, error: resolveError } = useUserId();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    api
      .get(`/api/users/${encodeURIComponent(id)}`)
      .then((data) => !cancelled && setProfile(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  const { items, next, loading, loadingMore, error, loadMore } = usePagedList(
    id ? `/api/users/${encodeURIComponent(id)}/tab?tab=${tab}` : '',
    { limit: 60 }
  );
  const sentinelRef = useAutoLoad({ hasMore: !!next, loading: loadingMore, onLoad: loadMore });

  return (
    <Page>
      <PageHeader
        title={title}
        description={profile ? description(profile.username) : description('this artist')}
      />
      {resolveError ? (
        <ErrorState message={resolveError} onRetry={() => window.location.reload()} />
      ) : !id || loading ? (
        <PersonGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : items.length === 0 ? (
        <EmptyState icon={icon} title={emptyTitle}>
          {emptyBody}
        </EmptyState>
      ) : (
        <>
          <PersonGrid>
            {items.map((person, i) => (
              <ArtistRow key={`${person.id}-${i}`} user={person} />
            ))}
          </PersonGrid>
          <LoadMore sentinelRef={sentinelRef} loading={loadingMore} />
        </>
      )}
    </Page>
  );
}

export function UserFollowersPage() {
  return (
    <UserListPage
      tab="followers"
      title="Followers"
      description={(name) => `People who follow ${name}`}
      emptyTitle="No followers yet"
      emptyBody="Nobody has followed this artist so far."
      icon={Users}
    />
  );
}

export function UserFollowingPage() {
  return (
    <UserListPage
      tab="followings"
      title="Following"
      description={(name) => `People ${name} follows`}
      emptyTitle="Not following anyone"
      emptyBody="This artist does not follow anyone so far."
      icon={UserPlus}
    />
  );
}
