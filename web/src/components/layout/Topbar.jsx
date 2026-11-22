import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Search, X, Bell, Menu, ArrowLeft, ArrowRight, LogIn, TrendingUp } from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { Avatar } from '@/components/Media.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';

export function Topbar({ onToggleSidebar }) {
  const navigate = useNavigate();
  const router = useRouterState({ select: (s) => s.location });
  const { user, isAuthed } = useAuth();

  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
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
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        setSuggestions(res.collection || []);
      } catch {}
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const submit = useCallback(
    (value) => {
      const q = String(value ?? term).trim();
      setShowSuggest(false);
      navigate({ to: '/search', search: q ? { q } : {} });
    },
    [term, navigate]
  );

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && suggestions[activeIdx]) submit(suggestions[activeIdx]);
      else submit();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setShowSuggest(false);
      inputRef.current?.blur();
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur lg:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onToggleSidebar}
        aria-label="Open navigation"
      >
        <Menu size={19} />
      </Button>

      <div className="hidden items-center gap-1 sm:flex">
        <Button variant="ghost" size="icon-sm" onClick={() => window.history.back()} aria-label="Back">
          <ArrowLeft size={17} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => window.history.forward()} aria-label="Forward">
          <ArrowRight size={17} />
        </Button>
      </div>

      <div className="relative mx-auto w-full max-w-md" ref={shellRef}>
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            type="search"
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
            <button
              type="button"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => {
                setTerm('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {showSuggest && term.trim() && suggestions.length > 0 ? (
          <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
            {suggestions.map((s, i) => (
              <button
                key={s + i}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                  i === activeIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                }`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => submit(s)}
              >
                <TrendingUp size={14} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{s}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {isAuthed ? (
          <>
            <Button variant="ghost" size="icon" asChild aria-label="Activity">
              <Link to="/activity">
                <Bell size={18} />
              </Link>
            </Button>
            <Link
              to="/artist/$id"
              params={{ id: String(user.id) }}
              className="rounded-full ring-offset-2 ring-offset-background transition hover:ring-2 hover:ring-primary/50"
              aria-label="Your profile"
            >
              <Avatar src={user.avatar_url} name={user.username} size={32} />
            </Link>
          </>
        ) : (
          <Button size="sm" asChild>
            <Link to="/login">
              <LogIn size={15} /> <span className="hidden sm:inline">Connect SoundCloud</span>
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
