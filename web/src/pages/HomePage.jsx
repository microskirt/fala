import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Play, RefreshCw, Radio, Clock, Heart, MessageSquare } from 'lucide-react';
import { api, formatCount, timeAgo, trackPath, userPath } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { TrackCard, PlaylistCard, SectionScroller, TrackRow } from '../components/Cards.jsx';
import { Artwork, Avatar, Skeleton, ErrorState } from '../components/Media.jsx';
import { PlayButton, LikeButton, AddToPlaylistButton, QueueMenuButton } from '../components/Controls.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function FeedItem({ item }) {
  const { playTrack, playQueue } = usePlayer();
  const isPlaylist = item.type === 'playlist';
  const track = item.track;

  return (
    <div className="feed-item">
      <Avatar src={item.user?.avatar_url} name={item.user?.username} size={38} />
      <div className="feed-body">
        <div className="feed-line">
          <Link to={userPath(item.user)}>
            <strong>{item.user?.username}</strong>
          </Link>
          {item.type === 'like' && 'liked a track'}
          {item.type === 'repost' && 'reposted a track'}
          {item.type === 'playlist' && 'shared a playlist'}
          <span className="dot-sep" />
          <span>{timeAgo(item.created_at)}</span>
        </div>

        {isPlaylist && item.playlist ? (
          <div className="mini-track">
            <Link to={`/playlist/${item.playlist.id}`}>
              <Artwork src={item.playlist.artwork_url} alt={item.playlist.title} size={46} rounded={4} kind="playlist" />
            </Link>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Link className="t" to={`/playlist/${item.playlist.id}`} style={{ display: 'block' }}>
                {item.playlist.title}
              </Link>
              <div className="a">
                {item.playlist.track_count} track{item.playlist.track_count === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        ) : track ? (
          <div className="mini-track">
            <Link to={trackPath(track)}>
              <Artwork src={track.artwork_url} alt={track.title} size={46} rounded={4} />
            </Link>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Link className="t" to={trackPath(track)} style={{ display: 'block' }}>
                {track.title}
              </Link>
              <Link className="a" to={userPath(track.user)} style={{ display: 'block' }}>
                {track.user?.username}
              </Link>
            </div>
            <div className="row" style={{ gap: 2 }}>
              <LikeButton track={track} size={16} />
              <PlayButton track={track} size="sm" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="content-inner">
      <Skeleton w={220} h={26} style={{ marginBottom: 8 }} />
      <Skeleton w={340} h={14} style={{ marginBottom: 26 }} />
      {[0, 1].map((s) => (
        <div key={s} style={{ marginBottom: 34 }}>
          <Skeleton w={180} h={18} style={{ marginBottom: 14 }} />
          <div className="card-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton h={0} style={{ paddingBottom: '100%' }} r={8} />
                <Skeleton w="80%" h={12} style={{ marginTop: 10 }} />
                <Skeleton w="55%" h={11} style={{ marginTop: 7 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HomePage() {
  const { user, isAuthed } = useAuth();
  const { playQueue } = usePlayer();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/home');
      setSections(res.sections || []);
    } catch (err) {
      setError(err.message || 'Could not load your home feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  if (loading) return <HomeSkeleton />;
  if (error) return <div className="content-inner"><ErrorState message={error} onRetry={load} /></div>;

  const heroTracks = sections.find((s) => s.id === 'charts')?.items || [];

  return (
    <div className="content-inner">
      <div className="home-greeting">
        {greeting()}
        {isAuthed && user ? `, ${user.username}` : ''}
      </div>
      <div className="home-sub">
        Here is what is moving on SoundCloud right now — streamed through Wavefront.
      </div>

      {sections.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Radio size={26} strokeWidth={1.6} /></div>
          <h3>Nothing to show yet</h3>
          <p className="muted">Try refreshing, or explore the Discover page for trending music.</p>
          <button type="button" className="btn primary" onClick={load} style={{ marginTop: 14 }}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      ) : (
        sections.map((section) => {
          if (section.kind === 'feed') {
            return (
              <section className="section" key={section.id}>
                <div className="section-head">
                  <div>
                    <h2>{section.title}</h2>
                    {section.subtitle && <div className="section-sub">{section.subtitle}</div>}
                  </div>
                </div>
                <div>
                  {section.items.slice(0, 8).map((item, i) => (
                    <FeedItem key={i} item={item} />
                  ))}
                </div>
              </section>
            );
          }

          const isTracks = section.items.some((i) => i.kind === 'track');

          return (
            <SectionScroller
              key={section.id}
              title={section.title}
              subtitle={section.subtitle}
              action={
                isTracks && section.items.length > 3 ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => playQueue(section.items.filter((t) => t.kind === 'track'), 0)}
                  >
                    <Play size={13} fill="currentColor" /> Play all
                  </button>
                ) : null
              }
            >
              {section.items.map((item) =>
                item.kind === 'track' ? (
                  <TrackCard
                    key={item.id}
                    track={item}
                    context={section.items.filter((t) => t.kind === 'track')}
                  />
                ) : item.kind === 'playlist' ? (
                  <PlaylistCard key={item.id} playlist={item} />
                ) : null
              )}
            </SectionScroller>
          );
        })
      )}
    </div>
  );
}
