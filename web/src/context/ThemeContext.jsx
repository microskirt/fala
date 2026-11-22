import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { KEYS, readKey, writeKey } from '@/lib/storage.js';

const ThemeContext = createContext(null);

const THEMES = ['dark', 'light', 'mocha'];

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : theme === 'mocha' ? '#1e1e2e' : '#121212');
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const saved = readKey(KEYS.theme);
    if (THEMES.includes(saved)) return saved;
    return 'dark';
  });

  useEffect(() => {
    applyTheme(theme);
    writeKey(KEYS.theme, theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (THEMES.includes(next)) setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((cur) => THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
