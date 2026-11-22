import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Search,
  X,
  Bell,
  Menu,
  ArrowLeft,
  ArrowRight,
  LogIn,
  UserPlus,
  Command,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { Avatar } from './Media.jsx';

export function Topbar({ onToggleSidebar, onOpenAuth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthed } = useAuth();
  const { counts } = useLibrary();

  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef(null);
  const shellRef = useRef(null);

  // Keep the search field in sync with ?q= when on the search page.
  useEffect(() => {
    if (location.pathname === '/search') {
      const q = new URLSearchParams(location.search).get('q') || '';
      setTerm(q);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onDown = (e) => {
      if (shellRef.current && !shellRef.current.contains(e.target)) setShowSuggest(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const isSlash = e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (isSlash) {
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
      if (!q) {
        navigate('/search');
        return;
      }
      navigate(`/search?q=${encodeURIComponent(q)}`);
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
    <header className="topbar">
      <button
        type="button"
        className="icon-btn back-btn"
        onClick={onToggleSidebar}
        aria-label="Open navigation"
      >
        <Menu size={19} />
      </button>

      <div className="nav-arrows">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={() => navigate(1)} aria-label="Forward">
          <ArrowRight size={18} />
        </button>
      </div>

      <div className="search-shell" ref={shellRef}>
        <div className="input-wrap">
          <Search size={16} />
          <input
            ref={inputRef}
            className="input"
            type="search"
            placeholder="Search tracks, artists and playlists"
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
              className="icon-btn sm search-clear"
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

        {showSuggest && term.trim() && suggestions.length > 0 && (
          <div className="suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <button
                key={s + i}
                type="button"
                className={`suggestion ${i === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => submit(s)}
                role="option"
                aria-selected={i === activeIdx}
              >
                <TrendingUp size={14} />
                <span className="truncate">{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="topbar-actions">
        {isAuthed ? (
          <>
            <Link
              to="/notifications"
              className="icon-btn"
              aria-label={`Notifications${counts.unread ? ` (${counts.unread} unread)` : ''}`}
              title="Notifications"
              style={{ position: 'relative' }}
            >
              <Bell size={18} />
              {counts.unread > 0 && <span className="notif-dot" />}
            </Link>
            <Link to={`/u/${user.permalink}`} className="avatar-btn" aria-label="Your profile">
              <Avatar src={user.avatar_url} name={user.username} size={32} />
            </Link>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost sm" onClick={() => onOpenAuth('login')}>
              <LogIn size={15} /> <span>Sign in</span>
            </button>
            <button type="button" className="btn primary sm" onClick={() => onOpenAuth('register')}>
              <UserPlus size={15} /> <span>Create account</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}
