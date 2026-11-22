import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PlayerProvider } from './context/PlayerContext.jsx';
import { LibraryProvider } from './context/LibraryContext.jsx';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <LibraryProvider>
              <PlayerProvider>
                <App />
              </PlayerProvider>
            </LibraryProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
