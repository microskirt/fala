import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './components/layout/AppShell.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { SearchPage } from './pages/SearchPage.jsx';
import { DiscoverPage } from './pages/DiscoverPage.jsx';
import { TrackPage } from './pages/TrackPage.jsx';
import { PlaylistPage } from './pages/PlaylistPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { ActivityPage } from './pages/ActivityPage.jsx';
import { LibraryPage } from './pages/LibraryPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import {
  LikesPage,
  RepostsPage,
  FollowingPage,
  PlaylistsPage,
  HistoryPage,
} from './pages/LibraryPages.jsx';

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

// Every signed-in surface shares one shell: sidebar, top bar and player.
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: AppShell,
});

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: HomePage,
});

const searchRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/search',
  validateSearch: (s) => ({ q: str(s.q), filter: str(s.filter, 'all') }),
  component: SearchPage,
});

const discoverRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/discover',
  component: DiscoverPage,
});

const trackRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/track/$id',
  component: TrackPage,
});

const playlistRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/playlist/$id',
  component: PlaylistPage,
});

const artistRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/artist/$id',
  component: ProfilePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  validateSearch: (s) => ({ tab: str(s.tab, 'account') }),
  component: SettingsPage,
});

const activityRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/activity',
  component: ActivityPage,
});

const libraryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/library',
  component: LibraryPage,
});

const likesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/likes',
  component: LikesPage,
});

const repostsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/reposts',
  component: RepostsPage,
});

const followingRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/following',
  component: FollowingPage,
});

const playlistsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/playlists',
  component: PlaylistsPage,
});

const historyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/history',
  component: HistoryPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: AuthPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    homeRoute,
    searchRoute,
    discoverRoute,
    trackRoute,
    playlistRoute,
    artistRoute,
    settingsRoute,
    activityRoute,
    libraryRoute,
    likesRoute,
    repostsRoute,
    followingRoute,
    playlistsRoute,
    historyRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});
