import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { resolveTrackParam, resolveUserParam } from './scRoute.js';

/*
 * Subpages answer on two addresses: the id form (/track/123/likes) and the
 * SoundCloud shaped one that hangs off the artist (/artist/song/likes). The
 * slug form carries words instead of a number, so it has to be resolved once
 * before any list request can run. Both hooks return null until that is done,
 * which lets the page show its skeleton instead of asking for "null".
 */
function useResolvedId(resolver, missing) {
  const params = useParams({ strict: false });
  const [id, setId] = useState(params.id ? String(params.id) : null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (params.id) {
      setId(String(params.id));
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    setId(null);
    (async () => {
      try {
        const resolved = await resolver(params);
        if (cancelled) return;
        if (!resolved) setError(missing);
        else {
          setError(null);
          setId(resolved);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || missing);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The resolver is a module level function, so the params are the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, params.artist, params.track]);

  return { id, error };
}

export function useTrackId() {
  return useResolvedId(
    ({ artist, track }) => resolveTrackParam({ artist, track }),
    'Track not found'
  );
}

export function useUserId() {
  return useResolvedId(
    ({ artist }) => resolveUserParam({ artist }),
    'Profile not found'
  );
}
