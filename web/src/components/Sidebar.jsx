import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  Home,
  Search,
  Library,
  Heart,
  ListMusic,
  Repeat2,
  Users,
  Settings,
  Bell,
  LogIn,
  Radio,
  Plus,
  History,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { Avatar } from './Media.jsx';

const THEME_LABELS = { dark: 'Dark', light: 'Light', mocha: 'Catppuccin Mocha' };

export function Sidebar({ open, onNavigate }) {
  const { user, isAuthed, logout } = useAuth();
  const { counts } = useLibrary();
  const { theme, setTheme, themes } = useTheme();
  const navigate = useNavigate();

  const link = (to, icon, label, extra) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
      onClick={onNavigate}
    >
      <span className="nav-icon">{icon}</span>
      <span className="truncate">{label}</span>
      {extra}
    </NavLink>
  );

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <Link to="/" className="brand" onClick={onNavigate}>
        <span className="brand-mark" aria-hidden="true">
          <Radio size={17} strokeWidth={2.4} />
        </span>
        <span>
          Wavefront
          <small>Sound, reimagined</small>
        </span>
      </Link>

      <div className="nav-group">
        {link('/', <Home size={18} />, 'Home')}
        {link('/search', <Search size={18} />, 'Search')}
        {link('/discover', <Radio size={18} />, 'Discover')}
      </div>

      <div className="nav-group">
        <div className="nav-heading">Your library</div>
        {link('/library', <Library size={18} />, 'Library')}
        {isAuthed && link('/likes', <Heart size={18} />, 'Likes', counts.likes ? <span className="nav-count">{counts.likes}</span> : null)}
        {isAuthed &&
          link(
            '/playlists',
            <ListMusic size={18} />,
            'Playlists',
            counts.playlists ? <span className="nav-count">{counts.playlists}</span> : null
          )}
        {isAuthed && link('/reposts', <Repeat2 size={18} />, 'Reposts')}
        {isAuthed && link('/following', <Users size={18} />, 'Following')}
        {isAuthed && link('/history', <History size={18} />, 'History')}
      </div>

      <div className="nav-group">
        <div className="nav-heading">Account</div>
        {isAuthed && link('/notifications', <Bell size={18} />, 'Notifications', counts.unread ? <span className="nav-count">{counts.unread}</span> : null)}
        {link('/settings', <Settings size={18} />, 'Settings')}
      </div>

      <div className="sidebar-footer">
        <div className="theme-dots" role="group" aria-label="Theme">
          {themes.map((t) => (
            <button
              key={t}
              type="button"
              className={`theme-dot ${t}`}
              aria-pressed={theme === t}
              aria-label={THEME_LABELS[t]}
              title={THEME_LABELS[t]}
              onClick={() => setTheme(t)}
            />
          ))}
        </div>

        {isAuthed && user ? (
          <Link to={`/u/${user.permalink}`} className="sidebar-user" onClick={onNavigate}>
            <Avatar src={user.avatar_url} name={user.username} size={34} />
            <div className="who">
              <strong>{user.username}</strong>
              <span>@{user.permalink}</span>
            </div>
          </Link>
        ) : (
          <button
            type="button"
            className="btn primary block"
            onClick={() => {
              onNavigate?.();
              navigate('/login');
            }}
          >
            <LogIn size={15} /> Sign in
          </button>
        )}

        {isAuthed && (
          <button
            type="button"
            className="btn ghost block sm"
            onClick={async () => {
              await logout();
              onNavigate?.();
              navigate('/');
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}
