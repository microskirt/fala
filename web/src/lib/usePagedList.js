import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api.js';

/*
 * One paging implementation for every list in the app. It loads the first page
 * from `url`, then follows SoundCloud's own `next_href` for the rest, so the
 * scroll loader never has to know how a given endpoint paginates.
 */
export function usePagedList(url, { limit } = {}) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(null);

  const nextRef = useRef(null);
  const busyRef = useRef(false);
  const urlRef = useRef(url);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setNext(null);
    nextRef.current = null;
    setError(null);
    setTotal(null);
    setLoading(true);
    busyRef.current = true;

    const base = limit ? `${url}${url.includes('?') ? '&' : '?'}limit=${limit}` : url;
    api
      .get(base)
      .then((res) => {
        if (cancelled) return;
        setItems(res.collection || []);
        setNext(res.next_href || null);
        nextRef.current = res.next_href || null;
        if (typeof res.total_results === 'number') setTotal(res.total_results);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load this list');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        busyRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [url, limit, reloadKey]);

  const loadMore = useCallback(async () => {
    const href = nextRef.current;
    if (!href || busyRef.current) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      const base = urlRef.current;
      const res = await api.get(
        `${base}${base.includes('?') ? '&' : '?'}next=${encodeURIComponent(href)}`
      );
      setItems((prev) => [...prev, ...(res.collection || [])]);
      setNext(res.next_href || null);
      nextRef.current = res.next_href || null;
    } catch (err) {
      setError(err.message || 'Could not load more');
    } finally {
      setLoadingMore(false);
      busyRef.current = false;
    }
  }, []);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  return { items, next, loading, loadingMore, error, total, loadMore, reload, setItems };
}
