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
import './styles/globals.css';

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
