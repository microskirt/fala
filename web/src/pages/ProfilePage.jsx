import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Calendar,
  Music2,
  ListMusic,
  Heart,
  Repeat2,
  Users,
  BadgeCheck,
  Pencil,
  Settings2,
  Loader2,
  Radio,
  Play,
  UserPlus,
} from 'lucide-react';
import {
  api,
  formatCount,
  formatDate,
  timeAgo,
  userPath,
  trackPath,
} from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { Artwork, Avatar, Skeleton, ErrorState, EmptyState } from '../components/Media.jsx';
import {
  TrackCard,
  TrackRow,
  PlaylistCard,
  ArtistRow,
  ArtistCard,
} from '../components/Cards.jsx';
import { FollowButton, PlayButton } from '../components/Controls.jsx';

const LOCAL_TABS = [
  { id: 'likes', label: 'Likes', icon: Heart },
  { id: 'reposts', label: 'Reposts', icon: Repeat2 },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'followers', label: 'Followers', icon: Users },
  { id: 'followings', label: 'Following', icon: UserPlus },
];

const REMOTE_TABS = [
  { id: 'tracks', label: 'Tracks', icon: Music2 },
  { id: 'toptracks', label: 'Popular', icon: Play },
  { id: 'albums', label: 'Albums', icon: ListMusic },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'likes', label: 'Likes', icon: Heart },
  { id: 'followers', label: 'Followers', icon: Users },
  { id: 'followings', label: 'Following', icon: UserPlus },
];

function TrackGrid({ items }) {
  const tracks = items.filter((t) => t.kind === 'track');
  return (
    <div className="card-grid">
      {tracks.map((t) => (
        <TrackCard key={t.id} track={t} context={tracks} />
      ))}
    </div>
  );
}

export function ProfilePage() {
  const { permalink, id: remoteId } = useParams();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const { playQueue } = usePlayer();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null);
  const [tabData, setTabData] = useState({ collection: [], next_href: null });
  const [tabLoading, setTabLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const isLocal = !!permalink;
  const tabs = isLocal ? LOCAL_TABS : REMOTE_TABS;

  const loadProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      let data;
      if (isLocal) {
        data = await api.get(`/api/resolve?url=${encodeURIComponent('/u/' + permalink)}`);
      } else {
        data = await api.get(`/api/users/${remoteId}`);
      }
      setProfile(data);
      const isOwn = me && String(me.id) === String(data.id);
      const first = isLocal
        ? isOwn || !data.private_likes
          ? 'likes'
          : 'reposts'
        : 'tracks';
      setTab(first);
    } catch (err) {
      setError(err.message || 'Profile not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permalink, remoteId]);

  const loadTab = async (which, next) => {
    if (!profile) return;
    if (next) {
      setLoadingMore(true);
      try {
        const res = await api.get(
          `/api/users/${encodeURIComponent(profile.id)}/tab?tab=${which}&next=${encodeURIComponent(next)}`
        );
        setTabData((prev) => ({
          ...res,
          collection: [...prev.collection, ...(res.collection || [])],
        }));
      } catch {}
      setLoadingMore(false);
      return;
    }
    setTabLoading(true);
    try {
      const res = await api.get(
        `/api/users/${encodeURIComponent(profile.id)}/tab?tab=${which}&limit=30`
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

  if (loading) {
    return (
      <div className="content-inner">
        <div className="profile-hero">
          <Skeleton h={190} r={0} />
          <div style={{ display: 'flex', gap: 18, padding: '0 26px 24px', marginTop: -52 }}>
            <Skeleton w={116} h={116} r={999} />
            <div style={{ flex: 1, paddingTop: 58 }}>
              <Skeleton w={220} h={24} />
              <Skeleton w={140} h={13} style={{ marginTop: 10 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="content-inner">
        <ErrorState message={error || 'Profile not found'} onRetry={loadProfile} />
      </div>
    );
  }

  const isOwn = me && String(me.id) === String(profile.id);
  const tracksOnly = tabData.collection?.filter((i) => i.kind === 'track') || [];

  const renderTab = () => {
    if (tabLoading) {
      return (
        <div className="card-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <Skeleton h={0} style={{ paddingBottom: '100%' }} r={8} />
              <Skeleton w="80%" h={12} style={{ marginTop: 10 }} />
              <Skeleton w="55%" h={11} style={{ marginTop: 7 }} />
            </div>
          ))}
        </div>
      );
    }

    if (tabData.error) return <ErrorState message={tabData.error} onRetry={() => loadTab(tab)} />;

    if (!tabData.collection || tabData.collection.length === 0) {
      const reason = tabData.empty_reason;
      return (
        <EmptyState icon={Music2} title={reason || 'Nothing here yet'}>
          {!reason && 'When there is something to show, it will appear here.'}
        </EmptyState>
      );
    }

    if (tab === 'followers' || tab === 'followings') {
      return (
        <div className="search-user-grid">
          {tabData.collection.map((entry, i) => {
            const person = entry.user || entry;
            if (!person) return null;
            return <ArtistRow key={`${person.id}-${i}`} user={person} subtitle={person.description} />;
          })}
        </div>
      );
    }

    if (tab === 'playlists' || tab === 'albums') {
      return (
        <div className="card-grid">
          {tabData.collection.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
        </div>
      );
    }

    // track-ish lists
    return (
      <div>
        {tracksOnly.length > 1 && (
          <div className="section-toolbar">
            <span className="pill-count">{tracksOnly.length} tracks</span>
            <button type="button" className="btn sm primary" onClick={() => playQueue(tracksOnly, 0)}>
              <Play size={13} fill="currentColor" /> Play all
            </button>
          </div>
        )}
        <div className="card-grid">
          {tracksOnly.map((t) => (
            <TrackCard key={t.id} track={t} context={tracksOnly} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="content-inner">
      <div className="profile-hero">
        <div
          className="banner"
          style={
            profile.banner_url
              ? { backgroundImage: `url(${profile.banner_url})` }
              : {
                  backgroundImage:
                    'linear-gradient(120deg, color-mix(in srgb, var(--accent) 30%, var(--bg-elev-2)), var(--bg-elev-2))',
                }
          }
        />
        <div className="hero-body">
          <Avatar
            className="hero-avatar"
            src={profile.avatar_url}
            name={profile.username}
            size={124}
          />
          <div className="hero-main">
            <h1>
              {profile.username}
              {profile.verified && <BadgeCheck size={20} color="var(--accent)" />}
              {profile.local && <span className="badge accent">Wavefront</span>}
            </h1>
            <div className="hero-handle">@{profile.permalink}</div>

            <div className="profile-stats">
              <span className="stat">
                <strong>{formatCount(profile.track_count)}</strong> tracks
              </span>
              <span className="stat">
                <strong>{formatCount(profile.playlist_count)}</strong> playlists
              </span>
              <span className="stat">
                <strong>{formatCount(profile.followers_count)}</strong> followers
              </span>
              <span className="stat">
                <strong>{formatCount(profile.followings_count)}</strong> following
              </span>
            </div>

            {profile.description && <div className="profile-bio">{profile.description}</div>}

            <div className="profile-meta">
              {profile.city && (
                <span>
                  <MapPin size={12} /> {profile.city}
                </span>
              )}
              {profile.country_code && <span>{profile.country_code}</span>}
              {profile.created_at && (
                <span>
                  <Calendar size={12} /> Joined {formatDate(profile.created_at)}
                </span>
              )}
            </div>
          </div>

          <div className="hero-actions">
            {isOwn ? (
              <>
                <Link className="btn" to="/settings?tab=profile">
                  <Pencil size={15} /> Edit profile
                </Link>
                <Link className="btn ghost" to="/settings">
                  <Settings2 size={15} /> Settings
                </Link>
              </>
            ) : (
              <>
                <FollowButton target={profile} />
                {profile.permalink_url && !profile.local && (
                  <a
                    className="btn ghost"
                    href={profile.permalink_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    SoundCloud
                  </a>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {renderTab()}

      {tabData.next_href && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <button
            type="button"
            className="btn"
            onClick={() => loadTab(tab, tabData.next_href)}
            disabled={loadingMore}
          >
            {loadingMore ? <Loader2 size={14} className="spin" /> : null}
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
