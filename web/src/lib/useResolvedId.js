import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { resolveTrackParam, resolveUserParam, resolvePlaylistParam } from './scRoute.js';

/*
 * Subpages answer on two addresses: the id form (/track/123/likes) and the
 * SoundCloud shaped one that hangs off the artist (/artist/song/likes). The
 * slug form carries words instead of a number, so it has to be resolved once
 * before any list request can run. Both hooks return null until that is done,
 * which lets the page show its skeleton instead of asking for "null".
 */
function useResolvedId(resolver, missing, normalize = (v) => v) {
  const params = useParams({ strict: false });
  const [id, setId] = useState(params.id ? normalize(String(params.id)) : null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (params.id) {
      setId(normalize(String(params.id)));
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
  }, [params.id, params.artist, params.track, params.playlist]);

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

/*
 * A playlist subpage answers on /playlist/<id>/likes and on the slug form
 * /artist/sets/playlist/likes. The id form carries the same `sc:` and `system:`
 * prefixes the playlist page uses, so they are stripped here and the page gets
 * a plain id it can hand to the API.
 */
export function usePlaylistId() {
  return useResolvedId(
    ({ artist, playlist }) => resolvePlaylistParam({ artist, playlist }),
    'Playlist not found',
    // The id form arrives as `sc:<id>` or `system:<id>`, the same way the
    // playlist page receives it. The list API only wants the bare id.
    (raw) => raw.replace(/^(sc|system):/, '')
  );
}
