import { useState } from 'react';
import { Music2, ListMusic, User as UserIcon, AlertTriangle } from 'lucide-react';
import { artwork as artUrl, avatarUrl, initials } from '@/api.js';
import { Avatar as AvatarPrimitive, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Skeleton as SkeletonPrimitive } from '@/components/ui/skeleton.jsx';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

export function Artwork({ src, alt = '', size = 200, rounded = 8, kind = 'track', className, style }) {
  const [failed, setFailed] = useState(false);
  const url = src ? (kind === 'user' ? avatarUrl(src, 't300x300') : artUrl(src, 't500x500')) : null;
  const Icon = kind === 'user' ? UserIcon : kind === 'playlist' ? ListMusic : Music2;

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden bg-muted',
        className
      )}
      style={{ width: size, height: size, borderRadius: rounded, ...style }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        <Icon
          className="text-muted-foreground/60"
          size={Math.max(16, Math.round((typeof size === 'number' ? size : 80) * 0.3))}
          strokeWidth={1.6}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function Avatar({ src, name, size = 36, className, style }) {
  const [failed, setFailed] = useState(false);
  const url = src ? avatarUrl(src, size > 80 ? 't300x300' : 't120x120') : null;

  return (
    <AvatarPrimitive
      className={cn('shrink-0', className)}
      style={{ width: size, height: size, ...style }}
    >
      {url && !failed ? (
        <AvatarImage src={url} alt={name || 'Avatar'} onError={() => setFailed(true)} />
      ) : null}
      <AvatarFallback className="text-[0.7em]" style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}>
        {initials(name)}
      </AvatarFallback>
    </AvatarPrimitive>
  );
}

export function Skeleton({ w = '100%', h = 14, r = 6, className, style }) {
  return (
    <SkeletonPrimitive
      className={cn(className)}
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-6 py-16 text-center">
      {Icon ? (
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon size={22} strokeWidth={1.6} />
        </div>
      ) : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{children}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle size={22} strokeWidth={1.6} />
      </div>
      <h3 className="text-base font-semibold">Something went wrong</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
