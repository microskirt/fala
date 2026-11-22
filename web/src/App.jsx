import { useEffect, useState } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar.jsx';
import { Topbar } from './components/Topbar.jsx';
import { Player } from './components/Player.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { SearchPage } from './pages/SearchPage.jsx';
import { DiscoverPage } from './pages/DiscoverPage.jsx';
import { TrackPage } from './pages/TrackPage.jsx';
import { PlaylistPage } from './pages/PlaylistPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { NotificationsPage } from './pages/NotificationsPage.jsx';
import {
  LikesPage,
  RepostsPage,
  FollowingPage,
  PlaylistsPage,
  HistoryPage,
  LibraryPage,
} from './pages/LibraryPages.jsx';
import { EmptyState } from './components/Media.jsx';
import { Music2 } from 'lucide-react';
import { Link } from 'react-router-dom';

function NotFound() {
  return (
    <div className="content-inner">
      <EmptyState icon={Music2} title="This page does not exist">
        The link may be broken, or the page may have moved.{' '}
        <Link to="/" className="link-btn">
          Back to home
        </Link>
      </EmptyState>
    </div>
  );
}

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    const scroller = document.querySelector('.content');
    if (scroller) scroller.scrollTop = 0;
  }, [location.pathname, location.search]);
  return null;
}

export default function App() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<Navigate to="/login?mode=register" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

      <div className="main">
        <Topbar
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenAuth={() => {
            window.location.href = '/login';
          }}
        />
        <main className="content">
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/track/:id" element={<TrackPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="/u/:permalink" element={<ProfilePage />} />
            <Route path="/artist/:id" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/likes" element={<LikesPage />} />
            <Route path="/reposts" element={<RepostsPage />} />
            <Route path="/following" element={<FollowingPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>

      <Player />
    </div>
  );
}
