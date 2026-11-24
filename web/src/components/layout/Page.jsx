import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Skeleton } from '@/components/ui/skeleton.jsx';

/*
 * One page rhythm for the whole app: the same max width, padding, heading
 * scale and grid. Pages compose these instead of inventing their own spacing.
 */

export function Page({ children, className, wide = false }) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 pt-6 pb-12 sm:px-6 lg:px-8',
        wide ? 'max-w-[1680px]' : 'max-w-[1400px]',
        className
      )}
    >
      {children}
    </div>
  );
}

/*
 * The tinted band behind a detail page's top card. SoundCloud reads a colour
 * out of the cover and lays it across the whole content width, so the card
 * sits on it instead of in a box. The band is painted by a full width layer
 * behind the content, which lets it reach the edges of the page while the card
 * keeps its normal gutters. `tint` is a plain rgb() string; it is mixed toward
 * the page background so the band stays a tint in every theme.
 */
export function DetailHero({ tint, children, className }) {
  return (
    /*
     * `isolate` keeps the band inside this block's own stacking context. Without
     * it a negative z-index layer drops behind the app shell's opaque page
     * background and never shows at all.
     */
    <div className={cn('relative isolate -mt-6 pb-6 pt-6', className)}>
      {tint ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -right-4 -left-4 -z-10 sm:-right-6 sm:-left-6 lg:-right-8 lg:-left-8"
          style={{ backgroundColor: `color-mix(in srgb, ${tint} 30%, var(--background))` }}
        />
      ) : null}
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }) {
  return (
    <div
      className={cn(
        'mb-2 inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-primary uppercase',
        className
      )}
    >
      {children}
    </div>
  );
}

/*
 * The title and its buttons share one row, and the description sits under that
 * row. The buttons used to bottom-align with the whole block, so any page with
 * a description pushed them below the title. Keeping them in the title's own
 * row lines their top edges up whatever else the header carries.
 */
export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <div className={cn('mb-6', className)}>
      {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function Section({ title, description, actions, children, className }) {
  return (
    <section className={cn('mb-10 last:mb-0', className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function CardGrid({ children, className }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
        className
      )}
    >
      {children}
    </div>
  );
}

export function PersonGrid({ children, className }) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}
    >
      {children}
    </div>
  );
}

export function TrackList({ children, className }) {
  return <div className={cn('flex flex-col gap-0.5', className)}>{children}</div>;
}

/*
 * The bottom of every paged list. The element it renders is the sentinel the
 * scroll observer watches, so the wheel doubles as the trigger target.
 */
export function LoadMore({ sentinelRef, loading }) {
  return (
    <div ref={sentinelRef} className="flex h-16 items-center justify-center text-muted-foreground">
      {loading ? (
        <Loader2 size={20} className="animate-spin" aria-label="Loading more" />
      ) : null}
    </div>
  );
}

export function CardGridSkeleton({ count = 12 }) {
  return (
    <CardGrid>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      ))}
    </CardGrid>
  );
}

export function PersonGridSkeleton({ count = 6 }) {
  return (
    <PersonGrid>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </PersonGrid>
  );
}

export function TrackListSkeleton({ count = 8 }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="size-11 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
