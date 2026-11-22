import { useState } from 'react';
import { Music2, ListMusic, User as UserIcon } from 'lucide-react';
import { artwork as artUrl, avatarUrl, initials } from '../api.js';

export function Artwork({ src, alt = '', size = 200, rounded = 6, kind = 'track', className = '', style }) {
  const [failed, setFailed] = useState(false);
  const url = src ? (kind === 'user' ? avatarUrl(src, 't300x300') : artUrl(src, 't500x500')) : null;

  const Icon = kind === 'user' ? UserIcon : kind === 'playlist' ? ListMusic : Music2;

  return (
    <div
      className={`art ${className}`}
      style={{ width: size, height: size, borderRadius: rounded, ...style }}
    >
      {url && !failed ? (
        <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} draggable={false} />
      ) : (
        <div className="art-fallback" aria-hidden="true">
          <Icon size={Math.max(16, Math.round(size * 0.28))} strokeWidth={1.6} />
        </div>
      )}
    </div>
  );
}

export function Avatar({ src, name, size = 36, className = '', style }) {
  const [failed, setFailed] = useState(false);
  const url = src ? avatarUrl(src, size > 80 ? 't300x300' : 't120x120') : null;

  if (url && !failed) {
    return (
      <img
        className={`avatar ${className}`}
        src={url}
        alt={name || 'Avatar'}
        width={size}
        height={size}
        style={{ width: size, height: size, ...style }}
        loading="lazy"
        onError={() => setFailed(true)}
        draggable={false}
      />
    );
  }

  return (
    <span
      className={`avatar fallback ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)), ...style }}
      aria-label={name || 'Avatar'}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function Skeleton({ w = '100%', h = 14, r = 4, style }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-icon">
          <Icon size={26} strokeWidth={1.6} />
        </div>
      )}
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="empty-state">
      <h3>Something went wrong</h3>
      <p className="muted">{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry} style={{ marginTop: 14 }}>
          Try again
        </button>
      )}
    </div>
  );
}
