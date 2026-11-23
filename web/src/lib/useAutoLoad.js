import { useEffect, useRef } from 'react';

/*
 * Scroll-driven paging. Every list in Fala uses this instead of a button: when
 * the sentinel at the bottom of the list comes into view and there is another
 * page, the loader runs. The sentinel sits inside the scrolling <main>, which
 * is what the observer watches.
 */
export function useAutoLoad({ hasMore, loading, onLoad, root }) {
  const ref = useRef(null);
  const busyRef = useRef(false);
  // Callers pass an inline loader, which changes on every render. Holding it in
  // a ref keeps the observer attached instead of tearing it down each time.
  const loadRef = useRef(onLoad);

  useEffect(() => {
    loadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    busyRef.current = loading;
  }, [loading]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const scroller = root || el.closest('main') || null;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (busyRef.current) return;
        loadRef.current?.();
      },
      { root: scroller, rootMargin: '600px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, root]);

  return ref;
}
