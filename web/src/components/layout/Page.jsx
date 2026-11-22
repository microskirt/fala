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

export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
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
