import { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  MapPin,
  Calendar,
  Music2,
  ListMusic,
  Heart,
  Repeat2,
  BadgeCheck,
  Settings2,
  Loader2,
  Play,
  MessageSquare,
  Youtube,
  Instagram,
  Facebook,
  Twitter,
  Globe,
  ExternalLink,
} from 'lucide-react';
import { api, artwork, formatCount, formatDate, formatRelativeDate } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { usePlayer } from '@/context/PlayerContext.jsx';
import { useToast } from '@/context/ToastContext.jsx';
import { Avatar, Skeleton, ErrorState, EmptyState } from '@/components/Media.jsx';
import { PlaylistCard } from '@/components/Cards.jsx';
import { ArtistTrackRow, ArtistTrackRowSkeleton } from '@/components/ArtistTrackRow.jsx';
import { FollowButton } from '@/components/Controls.jsx';
import { Page, CardGrid, LoadMore } from '@/components/layout/Page.jsx';
import { useAutoLoad } from '@/lib/useAutoLoad.js';
import { useArtworkPalette } from '@/lib/artworkColor.js';
import { Modal } from '@/components/Modal.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { cn } from '@/lib/utils.js';
import { placeLabel } from '@/lib/places.js';
import { ClampedText } from '@/components/ClampedText.jsx';
import { resolveUserParam, userSubLink, profileLinkTarget } from '@/lib/scRoute.js';
import { DETAIL_GRID } from '@/lib/layout.js';

const TABS = [
  { id: 'tracks', label: 'Tracks', icon: Music2 },
  { id: 'toptracks', label: 'Popular', icon: Play },
  { id: 'albums', label: 'Albums', icon: ListMusic },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'reposts', label: 'Reposts', icon: Repeat2 },
  { id: 'likes', label: 'Likes', icon: Heart },
];

/*
 * The banner for a profile that has not uploaded one. SoundCloud lays soft
 * colour fields over each other, so this places the picture's four corner
 * colours as wide radial blobs across the strip and lets them bleed into one
 * another. Each blob carries its own alpha rather than being mixed toward the
 * card, so the theme underneath still shows through and the picture stays the
 * only thing setting the colour. With no palette to work from, a plain wash
 * keeps the strip from reading as a flat grey band.
 */
function generatedBanner(palette) {
  if (!palette || !palette.length) {
    return 'linear-gradient(120deg, rgb(0 0 0 / 0.16), transparent 70%)';
  }
  const spots = [
    ['18%', '22%'],
    ['62%', '78%'],
    ['88%', '26%'],
    ['38%', '82%'],
  ];
  const layers = palette.slice(0, 4).map((rgb, i) => {
    const [x, y] = spots[i % spots.length];
    return `radial-gradient(55% 90% at ${x} ${y}, rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.62), transparent 72%)`;
  });
  return layers.join(', ');
}

/*
 * The icon for a link, by the network it names. Anything SoundCloud does not
 * label with a known network is a personal site, which reads as a globe. The
 * set is small on purpose: a row with the wrong logo is worse than a plain one.
 */
const NETWORK_ICON = {
  youtube: Youtube,
  instagram: Instagram,
  facebook: Facebook,
  twitter: Twitter,
  x: Twitter,
  spotify: Music2,
  songkick: Calendar,
  twitch: Play,
  personal: Globe,
};

/*
 * lucide carries no SoundCloud mark, so the cloud is drawn here at the same
 * 15px as the other link icons. The path is the plain logo silhouette, which
 * reads correctly at this size where a detailed version turns to mud.
 */
function SoundCloudIcon({ size = 15, className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z" />
    </svg>
  );
}

function linkLabel(link) {
  if (link.title) return link.title;
  if (link.network && link.network !== 'personal') {
    return link.network.charAt(0).toUpperCase() + link.network.slice(1);
  }
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return link.url;
  }
}

/*
 * The artist's own links, one row each. A SoundCloud address is routed inside
 * the app rather than handed to the browser, so an artist pointing at another
 * artist or one of their songs keeps the reader here. Everything else opens in
 * a new tab, since it leaves the site by design.
 */
function ProfileLinks({ links }) {
  if (!links || !links.length) return null;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold tracking-tight">Links</h2>
      <ul className="flex flex-col gap-1">
        {links.map((link, i) => {
          const target = profileLinkTarget(link.url);
          /*
           * A SoundCloud address is routed inside Fala, but the row still has
           * to say where it points, so it keeps the SoundCloud mark rather
           * than borrowing the generic globe.
           */
          const Icon = target?.to
            ? SoundCloudIcon
            : NETWORK_ICON[String(link.network || '').toLowerCase()] || Globe;
          const body = (
            <>
              <Icon size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{linkLabel(link)}</span>
              <ExternalLink
                size={13}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              />
            </>
          );
          const row =
            'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent';
          return (
            <li key={`${link.url}-${i}`} className="min-w-0">
              {target?.to ? (
                <Link to={target.to} params={target.params} className={row}>
                  {body}
                </Link>
              ) : (
                <a
                  href={target?.href || link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={row}
                >
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ value, label, to, params }) {
  const inner = (
    <>
      <strong className="font-semibold text-foreground tabular-nums">{formatCount(value)}</strong>{' '}
      {label}
    </>
  );
  if (!to) return <span className="text-xs text-muted-foreground">{inner}</span>;
  return (
    <Link
      to={to}
      params={params}
      className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {inner}
    </Link>
  );
}

export function ProfilePage() {
  /*
   * The artist page answers on both /artist/:id and the SoundCloud shaped
   * /:artist. A slug address carries a permalink, so it is resolved to an id
   * before the profile is fetched.
   */
  const params = useParams({ strict: false });
  const [id, setId] = useState(params.id ? String(params.id) : null);
  const [resolveError, setResolveError] = useState(null);
  const { user: me } = useAuth();
  const { playQueue } = usePlayer();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('tracks');
  const [tabData, setTabData] = useState({ collection: [], next_href: null });
  const [tabLoading, setTabLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();

  /*
   * A profile with no uploaded banner still gets one. SoundCloud builds it out
   * of the artist's picture, so the colours come from the same tiny sample the
   * song band uses. The hook runs before the early returns, as hooks must, and
   * simply answers nothing until the profile and its picture are known.
   */
  const palette = useArtworkPalette(profile?.avatar_url);

  const sendMessage = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.post('/api/me/conversations', { recipient_id: profile.id, body });
      setDraft('');
      setComposeOpen(false);
      toast.success('Message sent');
    } catch (err) {
      toast.error(err.message || 'Could not send that message');
    } finally {
      setSending(false);
    }
  };

  // A slug address has to become an id before the profile can be fetched.
  useEffect(() => {
    let cancelled = false;
    if (params.id) {
      setId(String(params.id));
      setResolveError(null);
      return () => {
        cancelled = true;
      };
    }
    setId(null);
    setLoading(true);
    (async () => {
      try {
        const resolved = await resolveUserParam({ artist: params.artist });
        if (cancelled) return;
        if (!resolved) {
          setResolveError('Profile not found');
          setLoading(false);
          return;
        }
        setResolveError(null);
        setId(resolved);
      } catch (err) {
        if (!cancelled) {
          setResolveError(err.message || 'Profile not found');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, params.artist]);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProfile(null);
    (async () => {
      try {
        const data = await api.get(`/api/users/${encodeURIComponent(id)}`);
        if (cancelled) return;
        setProfile(data);
        setTab('tracks');
      } catch (err) {
        if (!cancelled) setError(err.message || 'Profile not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const loadTab = async (which, next) => {
    if (!profile) return;
    if (next) {
      setLoadingMore(true);
      try {
        const res = await api.get(
          `/api/users/${encodeURIComponent(profile.id)}/tab?tab=${which}&next=${encodeURIComponent(next)}`
        );
        /*
         * Later pages carry no total, so the one from the first page is kept.
         * Without this, loading more rows would blank the pill back to the
         * loaded count, which is the bug the total exists to fix.
         */
        setTabData((prev) => ({
          ...res,
          total: res.total ?? prev.total,
          collection: [...prev.collection, ...(res.collection || [])],
        }));
      } catch {}
      setLoadingMore(false);
      return;
    }
    setTabLoading(true);
    try {
      const res = await api.get(
        `/api/users/${encodeURIComponent(profile.id)}/tab?tab=${which}&limit=100`
      );
      setTabData(res);
    } catch (err) {
      setTabData({ collection: [], next_href: null, error: err.message });
    } finally {
      setTabLoading(false);
    }
  };

  useEffect(() => {
    if (profile && tab) loadTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, tab]);

  const tabSentinel = useAutoLoad({
    hasMore: !!tabData.next_href,
    loading: loadingMore,
    onLoad: () => loadTab(tab, tabData.next_href),
  });

  if (loading) {
    return (
      <Page>
        <Skeleton className="h-44 w-full rounded-xl" />
        <div className="-mt-14 flex gap-4 px-5">
          <Skeleton className="size-28 rounded-full ring-4 ring-background" />
          <div className="flex-1 pt-16">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="mt-2.5 h-3.5 w-36" />
          </div>
        </div>
      </Page>
    );
  }

  if (error || resolveError || !profile) {
    return (
      <Page>
        <ErrorState
          message={error || resolveError || 'Profile not found'}
          onRetry={() => window.location.reload()}
        />
      </Page>
    );
  }

  const isOwn = me && String(me.id) === String(profile.id);
  const tracksOnly = tabData.collection?.filter((i) => i.kind === 'track') || [];
  // Read once, since both the card and the details column want it.
  const place = placeLabel(profile.city, profile.country_code);
  /*
   * Only the signed in account's own join date is readable; api-v2 leaves it
   * blank on everyone else. The server fills it in for the own profile, so this
   * is empty on every other artist and the line simply does not render.
   */
  const joined = profile.created_at || null;

  // Albums and playlists are lists of songs, not songs, so they keep cards.
  const listsTab = tab === 'playlists' || tab === 'albums';

  const renderTab = () => {
    if (tabLoading) {
      if (!listsTab) {
        return (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <ArtistTrackRowSkeleton key={i} />
            ))}
          </div>
        );
      }
      return (
        <CardGrid>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          ))}
        </CardGrid>
      );
    }

    if (tabData.error) {
      return <ErrorState message={tabData.error} onRetry={() => loadTab(tab)} />;
    }

    if (!tabData.collection || tabData.collection.length === 0) {
      return (
        <EmptyState icon={Music2} title={tabData.empty_reason || 'Nothing here yet'}>
          {!tabData.empty_reason && 'When there is something to show, it will appear here.'}
        </EmptyState>
      );
    }

    /*
     * The pill counts what the artist has, not what happens to be loaded. The
     * server sends the tab's own total with the first page; until it arrives,
     * or for a tab that reports none, the loaded rows are the honest fallback.
     * The noun follows the tab, so a likes tab does not call its rows tracks.
     */
    const shown = tabData.total ?? tabData.collection.length;
    const noun =
      { likes: 'like', reposts: 'repost', playlists: 'playlist', albums: 'album' }[tab] ||
      'track';
    const countPill = (
      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
        {formatCount(shown)} {shown === 1 ? noun : `${noun}s`}
      </span>
    );

    if (listsTab) {
      return (
        <div>
          {shown > 1 ? <div className="mb-4">{countPill}</div> : null}
          <CardGrid>
            {tabData.collection.map((p) => (
              <PlaylistCard key={p.id} playlist={p} />
            ))}
          </CardGrid>
        </div>
      );
    }

    /*
     * Songs read as entries here, the way SoundCloud lists an artist's work:
     * the cover, the title over its credits, a small waveform of the song's own
     * shape, and a footer with the actions and the numbers. A plain row of
     * thumbs said nothing about the songs themselves, and a cover grid had room
     * for two actions where a song has four.
     */
    return (
      <div>
        {shown > 1 || tracksOnly.length > 1 ? (
          <div className="mb-4 flex items-center justify-between gap-3">
            {countPill}
            <Button size="sm" onClick={() => playQueue(tracksOnly, 0)}>
              <Play size={14} fill="currentColor" /> Play all
            </Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          {tracksOnly.map((t, i) => (
            <ArtistTrackRow key={`${t.id}-${i}`} track={t} context={tracksOnly} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <Page>
      <div className="overflow-hidden rounded-xl border bg-card">
        {/*
         * Plenty of artists upload a banner with the picture already cut into
         * it, so the overlay has to stay on the spot that banner expects.
         * SoundCloud draws it at 254px tall with a 200px picture 28px from the
         * left, and the image is scaled by height rather than cropped.
         *
         * Those numbers left a strip of empty space on the right: a banner is
         * about 4.8 times wider than it is tall, so at 254px it only reached
         * roughly 1210px in a box nearer 1340px. Scaling all three numbers by
         * the same factor fills the width and keeps the picture aligned, since
         * the baked-in circle grows with the banner.
         */}
        <div
          className="relative h-[280px] w-full bg-muted"
          style={
            profile.banner_url
              ? {
                  backgroundImage: `url(${profile.banner_url})`,
                  backgroundSize: 'auto 100%',
                  backgroundPosition: '0 0',
                  backgroundRepeat: 'no-repeat',
                }
              : { backgroundImage: generatedBanner(palette) }
          }
        >
          <button
            type="button"
            onClick={() => profile.avatar_url && setPhotoOpen(true)}
            disabled={!profile.avatar_url}
            aria-label={profile.avatar_url ? `Open ${profile.username}'s picture` : undefined}
            className={cn(
              'group absolute top-1/2 left-[31px] -translate-y-1/2 rounded-full',
              profile.avatar_url ? 'cursor-zoom-in' : 'cursor-default'
            )}
          >
            <Avatar src={profile.avatar_url} name={profile.username} size={220} />
            {profile.avatar_url ? (
              <span className="pointer-events-none absolute inset-0 rounded-full bg-black/0 transition-colors group-hover:bg-black/20" />
            ) : null}
          </button>
        </div>
        <div className="px-5 pb-6 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">
                {profile.username}
                {profile.verified ? <BadgeCheck size={18} className="text-primary" /> : null}
              </h1>
              <div className="text-sm text-muted-foreground">@{profile.permalink}</div>
            </div>
            <div className="flex items-center gap-2">
              {isOwn ? (
                <Button variant="ghost" asChild>
                  <Link to="/settings">
                    <Settings2 size={16} /> Settings
                  </Link>
                </Button>
              ) : (
                <>
                  {me ? (
                    <Button variant="outline" onClick={() => setComposeOpen(true)}>
                      <MessageSquare size={14} /> Message
                    </Button>
                  ) : null}
                  <FollowButton target={profile} />
                </>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <Stat value={profile.track_count} label="tracks" />
            <Stat value={profile.playlist_count} label="playlists" />
            <Stat
              value={profile.followers_count}
              label="followers"
              {...userSubLink(profile, 'followers')}
            />
            <Stat
              value={profile.followings_count}
              label="following"
              {...userSubLink(profile, 'following')}
            />
          </div>
        </div>
      </div>

      {/*
       * Under the card the page splits the way a song page does: the songs take
       * the wide left column and the artist's own details take the narrow right
       * one. The tabs stay with the songs they switch between, so the right
       * column is steady while the list changes.
       */}
      <div className={cn('mt-8 grid gap-8 lg:items-start', DETAIL_GRID)}>
        <div className="min-w-0">
          <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border pb-px">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  tab === t.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-6">{renderTab()}</div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {/*
           * The box is always here, even for an artist who has filled in
           * nothing. An empty column read as a page that had failed to load;
           * the heading and a plain line say the page is complete and the
           * artist simply has nothing to add.
           */}
          <section className="rounded-xl border bg-card p-4">
            {/* The same heading style as the Links box below it. */}
            <h2 className="mb-3 text-sm font-semibold tracking-tight">Details</h2>
            {/*
             * The join date leads the column, above the location. It reads
             * as "Joined ... ago" and lifts the exact day on hover, the way
             * the song card's upload age does.
             */}
            {joined || place ? (
              <div className="mb-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
                {joined ? (
                  <div className="inline-flex items-center gap-1.5">
                    <Calendar size={14} />
                    <time
                      dateTime={joined}
                      title={formatDate(joined)}
                      className="cursor-default"
                    >
                      Joined {formatRelativeDate(joined)}
                    </time>
                  </div>
                ) : null}
                {place ? (
                  <div className="inline-flex items-center gap-1.5">
                    <MapPin size={14} /> {place}
                  </div>
                ) : null}
              </div>
            ) : null}
            {profile.description ? (
              <ClampedText text={profile.description} lines={6} />
            ) : null}
            {!joined && !place && !profile.description ? (
              <p className="text-xs text-muted-foreground">
                This artist has not added any details.
              </p>
            ) : null}
          </section>

          {profile.web_profiles && profile.web_profiles.length ? (
            <ProfileLinks links={profile.web_profiles} />
          ) : null}
        </aside>
      </div>

      <Modal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title={`Message ${profile.username}`}
        description="Sent through your SoundCloud account."
        footer={
          <>
            <Button variant="outline" onClick={() => setComposeOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={sendMessage} disabled={!draft.trim() || sending}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : null}
              Send
            </Button>
          </>
        }
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message"
          rows={4}
          autoFocus
        />
      </Modal>

      <LoadMore sentinelRef={tabSentinel} loading={loadingMore} />

      {/*
       * The close button sits in the top right corner of the dialog box, so the
       * picture is pushed down past it and kept a little narrower than the box.
       * That way the button always floats clear of the image with a gap, even
       * for a square or landscape picture that fills the width.
       */}
      <Modal open={photoOpen} onClose={() => setPhotoOpen(false)} wide>
        {profile.avatar_url ? (
          <div className="flex justify-center pt-8">
            <img
              src={artwork(profile.avatar_url, 'original')}
              alt={profile.username}
              className="max-h-[58vh] w-auto max-w-full rounded-lg object-contain"
            />
          </div>
        ) : null}
      </Modal>
    </Page>
  );
}
