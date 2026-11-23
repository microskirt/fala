import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './components/layout/AppShell.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { SearchPage } from './pages/SearchPage.jsx';
import { TrackPage } from './pages/TrackPage.jsx';
import { PlaylistPage } from './pages/PlaylistPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { ActivityPage } from './pages/ActivityPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import {
  TrackLikersPage,
  TrackPlaylistsPage,
  TrackAlbumsPage,
} from './pages/TrackListPages.jsx';
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

const trackRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/track/$id',
  component: TrackPage,
});

// The counts under a song open these instead of a modal.
const trackLikersRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/track/$id/likes',
  component: TrackLikersPage,
});

const trackPlaylistsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/track/$id/playlists',
  component: TrackPlaylistsPage,
});

const trackAlbumsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/track/$id/albums',
  component: TrackAlbumsPage,
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

/*
 * The public addresses, shaped like SoundCloud's own: /artist, /artist/song and
 * /artist/sets/playlist. Static first segments (search, settings, track, ...)
 * outrank these, so the old id routes keep working as aliases.
 */
const slugArtistRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/$artist',
  component: ProfilePage,
});

const slugTrackRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/$artist/$track',
  component: TrackPage,
});

const slugPlaylistRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/$artist/sets/$playlist',
  component: PlaylistPage,
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
    trackRoute,
    trackLikersRoute,
    trackPlaylistsRoute,
    trackAlbumsRoute,
    playlistRoute,
    artistRoute,
    settingsRoute,
    activityRoute,
    likesRoute,
    repostsRoute,
    followingRoute,
    playlistsRoute,
    historyRoute,
    slugArtistRoute,
    slugTrackRoute,
    slugPlaylistRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});
