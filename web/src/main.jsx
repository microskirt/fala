import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { CaptchaProvider } from './context/CaptchaContext.jsx';
import { LibraryProvider } from './context/LibraryContext.jsx';
import { PlayerProvider } from './context/PlayerContext.jsx';
import { Toaster } from './components/ui/sonner.jsx';
import { TooltipProvider } from './components/ui/tooltip.jsx';
import { router } from './router.jsx';
import { migrateLegacyKeys } from './lib/storage.js';
import { installInputModality } from './lib/inputModality.js';
import './styles/globals.css';

migrateLegacyKeys();
installInputModality();

/*
 * PWA plumbing lives here rather than in a component so it runs once, before
 * the router mounts, and never re-runs on navigation or re-render.
 */
function installPwa() {
  if (typeof window === 'undefined') return;

  /*
   * The install prompt is a one-shot event the browser fires before
   * `beforeinstallprompt` is usable. Stashing it lets UI call prompt() later
   * instead of the browser showing its own mini-infobar.
   */
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__falaInstallPrompt = event;
    window.dispatchEvent(new CustomEvent('fala:installprompt', { detail: event }));
  });

  window.addEventListener('appinstalled', () => {
    window.__falaInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('fala:appinstalled'));
  });

  /*
   * Only production registers a worker: the dev server rewrites modules and
   * the SW would cache half-built bundles, which is painful to debug.
   */
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

installPwa();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <CaptchaProvider>
            <LibraryProvider>
              <PlayerProvider>
                <RouterProvider router={router} />
                <Toaster />
              </PlayerProvider>
            </LibraryProvider>
          </CaptchaProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
);
