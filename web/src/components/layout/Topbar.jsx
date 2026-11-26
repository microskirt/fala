import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Search, X, Menu, LogIn, Loader2 } from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { NotificationsMenu } from '@/components/layout/NotificationsMenu.jsx';
import { MessagesMenu } from '@/components/layout/MessagesMenu.jsx';
import { MineRow, libraryMatches, mineLink } from '@/components/LibraryMatch.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';

const EMPTY_MINE = { people: [], tracks: [], playlists: [] };

export function Topbar({ onToggleSidebar }) {
  const navigate = useNavigate();
  const router = useRouterState({ select: (s) => s.location });
  const { isAuthed } = useAuth();

  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [mine, setMine] = useState(EMPTY_MINE);
  const [mineLoading, setMineLoading] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef(null);
  const shellRef = useRef(null);

  useEffect(() => {
    if (router.pathname === '/search') setTerm(router.search?.q || '');
  }, [router.pathname, router.search]);

  useEffect(() => {
    const onDown = (e) => {
      if (shellRef.current && !shellRef.current.contains(e.target)) setShowSuggest(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(tag)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!term.trim()) {
      setSuggestions([]);
      setMine(EMPTY_MINE);
      setMineLoading(false);
      return;
    }
    /*
     * A signed out visitor has no library to search. The plain suggestions are
     * still worth asking for, so only the library call and its heading are
     * skipped; drawing the heading and then dropping it would just flicker.
     */
    const searchLibrary = !!isAuthed;
    /*
     * The library block puts its heading up straight away and fills in below,
     * so the wait reads as loading rather than as nothing found. The previous
     * rows are cleared at the same time: showing a stale match under the new
     * term would be worse than showing the spinner.
     */
    setMine(EMPTY_MINE);
    setMineLoading(searchLibrary);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const opts = { signal: controller.signal };
      const q = encodeURIComponent(term);
      /*
       * Both questions start together so the library answer does not wait on
       * the suggestions. Each failure is contained: a broken library call still
       * leaves the plain suggestions working, and the other way round.
       */
      const [sug, own] = await Promise.allSettled([
        api.get(`/api/search/suggest?q=${q}`, opts),
        searchLibrary ? api.get(`/api/search/mine?q=${q}`, opts) : Promise.resolve(null),
      ]);
      /*
       * A newer term has already taken over: its own request is in flight and
       * owns the spinner now, so this answer must not touch the state.
       */
      if (controller.signal.aborted) return;
      if (sug.status === 'fulfilled') setSuggestions(sug.value.collection || []);
      if (own.status === 'fulfilled' && own.value) {
        const res = own.value;
        setMine({
          people: res.people || [],
          tracks: res.tracks || [],
          playlists: res.playlists || [],
        });
      }
      setMineLoading(false);
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, isAuthed]);

  const submit = useCallback(
    (value) => {
      const q = String(value ?? term).trim();
      setShowSuggest(false);
      navigate({ to: '/search', search: q ? { q } : {} });
    },
    [term, navigate]
  );

  /*
   * The list is the library matches first, then the plain text suggestions, so
   * the arrow keys and Enter walk it as one column. The matches are links, the
   * suggestions fill the search box, so each keeps its own action.
   */
  const mineRows = useMemo(() => libraryMatches(mine), [mine]);
  const total = mineRows.length + suggestions.length;

  const goToMatch = useCallback(
    (item) => {
      setShowSuggest(false);
      setActiveIdx(-1);
      navigate(mineLink(item));
    },
    [navigate]
  );

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < mineRows.length) goToMatch(mineRows[activeIdx]);
      else if (activeIdx >= mineRows.length && suggestions[activeIdx - mineRows.length]) {
        submit(suggestions[activeIdx - mineRows.length]);
      } else submit();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, total - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setShowSuggest(false);
      inputRef.current?.blur();
    }
  };

  return (
    /*
     * Three equal tracks: the outer two match each other in width, so the
     * search column sits dead centre no matter what the side controls hold.
     *
     * The bar also sits above the page. backdrop-blur gives it a stacking
     * context, but without a z-index it still lost to the scrolling main area
     * that comes later in the DOM, which put the search suggestions behind the
     * song cards. A z-index here lifts the whole bar, and the dropdown with it.
     */
    <header className="relative z-40 grid h-(--topbar-height) shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:grid-cols-[1fr_minmax(0,40rem)_1fr] sm:gap-3 lg:px-5">
      <div className="flex min-w-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onToggleSidebar}
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </Button>
      </div>

      <div className="relative w-full" ref={shellRef}>
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          {/*
           * A plain text input, not type="search": the search type makes the
           * browser draw its own clear button next to ours, which reads as a
           * second, slightly different looking control.
           */}
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search tracks, artists and playlists"
            className="h-9 pl-9 pr-9"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setShowSuggest(true);
              setActiveIdx(-1);
            }}
            onFocus={() => setShowSuggest(true)}
            onKeyDown={onKeyDown}
            aria-label="Search"
          />
          {term ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-1.5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
              onClick={() => {
                setTerm('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={14} />
            </Button>
          ) : null}
        </div>

        {showSuggest && term.trim() && (total > 0 || mineLoading) ? (
          <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
            {/*
             * The heading is up from the first keystroke and the rows fill in
             * under it, so a slow library reads as loading instead of as an
             * empty answer. With nothing found the whole block, heading and
             * all, drops out and the plain suggestions take the space.
             */}
            {mineRows.length > 0 || mineLoading ? (
              <>
                <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  In your library
                </div>
                {mineLoading && mineRows.length === 0 ? (
                  <div className="flex items-center justify-center px-2.5 py-2.5">
                    <Loader2
                      size={16}
                      className="animate-spin text-muted-foreground"
                      aria-label="Searching your library"
                    />
                  </div>
                ) : (
                  mineRows.map((item, i) => (
                    <div key={`mine-${item.kind}-${item.id}`} onMouseEnter={() => setActiveIdx(i)}>
                      <MineRow
                        item={item}
                        active={i === activeIdx}
                        onNavigate={() => goToMatch(item)}
                      />
                    </div>
                  ))
                )}
                {suggestions.length > 0 ? <div className="my-1 h-px bg-border" /> : null}
              </>
            ) : null}
            {suggestions.map((s, i) => {
              const idx = mineRows.length + i;
              return (
                <button
                  key={s + i}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                    idx === activeIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                  }`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => submit(s)}
                >
                  <Search size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{s}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        {isAuthed ? (
          <>
            <MessagesMenu />
            <NotificationsMenu />
          </>
        ) : (
          <Button size="sm" asChild>
            <Link to="/login">
              <LogIn size={16} /> <span className="hidden sm:inline">Connect SoundCloud</span>
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
