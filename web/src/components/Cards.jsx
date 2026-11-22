import { useRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play,
  Heart,
  MessageSquare,
  PlayCircle,
  ListMusic,
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
  Clock,
} from 'lucide-react';
import { Artwork, Avatar } from './Media.jsx';
import { PlayButton, LikeButton, AddToPlaylistButton, QueueMenuButton, FollowButton } from './Controls.jsx';
import { formatCount, formatDuration, timeAgo, trackPath, userPath } from '../api.js';

export function TrackCard({ track, context, showStats = true }) {
  if (!track) return null;
  return (
    <div className="track-card">
      <div className="thumb">
        <Link to={trackPath(track)} aria-label={track.title}>
          <Artwork src={track.artwork_url} alt={track.title} size="100%" rounded={0} />
        </Link>
        <div className="thumb-overlay">
          <PlayButton track={track} context={context} size="md" />
        </div>
      </div>
      <div className="meta">
        <Link className="title" to={trackPath(track)}>
          {track.title}
        </Link>
        {track.user && (
          <Link className="sub" to={userPath(track.user)}>
            {track.user.username}
          </Link>
        )}
        {showStats && (
          <div className="stats">
            <span title="Plays">
              <Play size={11} fill="currentColor" /> {formatCount(track.playback_count)}
            </span>
            <span title="Likes">
              <Heart size={11} /> {formatCount(track.likes_count)}
            </span>
            <span title="Comments">
              <MessageSquare size={11} /> {formatCount(track.comment_count)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function TrackRow({ track, index, context, showIndex = true, showArt = true }) {
  if (!track) return null;
  const isTrack = track.kind === 'track';
  return (
    <div className="track-row">
      {showIndex && (
        <div className="idx">
          <span className="num">{typeof index === 'number' ? index + 1 : ''}</span>
          {isTrack && (
            <span className="play-mini">
              <PlayButton track={track} context={context} size="sm" />
            </span>
          )}
        </div>
      )}
      {showArt && (
        <Link to={isTrack ? trackPath(track) : '#'} style={{ display: 'block' }}>
          <Artwork src={track.artwork_url} alt={track.title} size={48} rounded={4} />
        </Link>
      )}
      <div className="info">
        <Link className="title" to={isTrack ? trackPath(track) : '#'}>
          {track.title}
        </Link>
        <div className="sub">
          {track.user ? (
            <Link to={userPath(track.user)}>{track.user.username}</Link>
          ) : (
            'Unknown artist'
          )}
          {track.genre ? <span className="dot-sep">{track.genre}</span> : null}
        </div>
      </div>
      <div className="row-actions">
        <LikeButton track={track} size={16} />
        <AddToPlaylistButton track={track} size={16} />
        <QueueMenuButton track={track} size={16} />
        <span className="dur">{formatDuration(track.duration)}</span>
      </div>
    </div>
  );
}

export function PlaylistCard({ playlist }) {
  if (!playlist) return null;
  const idStr = String(playlist.id);
  const isSystem = playlist.kind === 'system-playlist' || idStr.startsWith('system:');
  const to = isSystem
    ? `/playlist/system:${idStr.replace(/^system:/, '')}`
    : `/playlist/sc:${playlist.id}`;
  const owner = playlist.user;
  const trackCount = playlist.track_count ?? playlist.tracks?.length ?? 0;

  return (
    <div className="playlist-card">
      <Link to={to} className="thumb" aria-label={playlist.title}>
        <Artwork src={playlist.artwork_url} alt={playlist.title} size="100%" rounded={0} kind="playlist" />
        {trackCount > 0 && (
          <span className="count">
            <ListMusic size={11} /> {trackCount}
          </span>
        )}
      </Link>
      <div className="meta">
        <Link className="title" to={to}>
          {playlist.title}
        </Link>
        {owner && (
          <Link className="sub" to={userPath(owner)}>
            {owner.username}
          </Link>
        )}
      </div>
    </div>
  );
}

export function ArtistCard({ user }) {
  if (!user) return null;
  return (
    <div className="artist-card">
      <Link to={userPath(user)} aria-label={user.username}>
        <Avatar src={user.avatar_url} name={user.username} size={78} />
      </Link>
      <Link className="name" to={userPath(user)}>
        {user.username}
      </Link>
      <span className="handle">@{user.permalink}</span>
      <span className="followers">
        {formatCount(user.followers_count)} follower{(user.followers_count || 0) === 1 ? '' : 's'}
      </span>
      <FollowButton target={user} size="sm" />
    </div>
  );
}

export function ArtistRow({ user, subtitle }) {
  if (!user) return null;
  return (
    <div className="artist-row">
      <Link to={userPath(user)}>
        <Avatar src={user.avatar_url} name={user.username} size={46} />
      </Link>
      <div className="who">
        <Link className="name" to={userPath(user)}>
          {user.username}
          {user.verified && <BadgeCheck size={14} color="var(--accent)" />}
        </Link>
        <div className="handle">@{user.permalink}</div>
        {subtitle ? <div className="bio">{subtitle}</div> : null}
      </div>
      <FollowButton target={user} size="sm" />
    </div>
  );
}

export function SectionScroller({ title, subtitle, children, action }) {
  const ref = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [children]);

  const scrollBy = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <div className="section-sub">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      <div className="row-scroller">
        {canPrev && (
          <button
            type="button"
            className="scroll-btn prev"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll left"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="row-track" ref={ref} onScroll={update}>
          {children}
        </div>
        {canNext && (
          <button
            type="button"
            className="scroll-btn next"
            onClick={() => scrollBy(1)}
            aria-label="Scroll right"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </section>
  );
}

export function TrackStatLine({ track }) {
  if (!track) return null;
  return (
    <div className="meta-line">
      <span>
        <PlayCircle size={13} /> {formatCount(track.playback_count)} plays
      </span>
      <span>
        <Heart size={13} /> {formatCount(track.likes_count)} likes
      </span>
      <span>
        <MessageSquare size={13} /> {formatCount(track.comment_count)} comments
      </span>
      {track.display_date && (
        <span>
          <Clock size={13} /> {timeAgo(track.display_date)}
        </span>
      )}
    </div>
  );
}
