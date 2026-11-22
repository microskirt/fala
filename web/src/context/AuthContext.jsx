import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { api, getToken, setToken } from '../api.js';
import { useTheme } from './ThemeContext.jsx';

/*
 * Auth here is only ever the user's real SoundCloud account. Wavefront never
 * creates accounts and never stores passwords. The token lives in this browser
 * and is forwarded by the proxy.
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setAccount(null);
      setLoading(false);
      return null;
    }
    try {
      const res = await api.get('/api/session');
      setAccount(res?.account || null);
      return res?.account || null;
    } catch {
      setAccount(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = useCallback(
    async (token) => {
      const clean = String(token || '').trim();
      if (!clean) throw new Error('Paste your SoundCloud oauth_token');
      setToken(clean);
      try {
        const res = await api.get('/api/session');
        if (!res?.account) {
          setToken('');
          throw new Error('SoundCloud did not accept that token. Make sure you copied oauth_token.');
        }
        setAccount(res.account);
        return res.account;
      } catch (err) {
        setToken('');
        setAccount(null);
        throw err;
      }
    },
    []
  );

  const disconnect = useCallback(async () => {
    setToken('');
    setAccount(null);
  }, []);

  const applyTheme = useCallback(
    (next) => {
      setTheme(next);
    },
    [setTheme]
  );

  const value = useMemo(
    () => ({
      account,
      user: account,
      loading,
      isAuthed: !!account,
      connect,
      disconnect,
      logout: disconnect,
      refresh,
      setTheme: applyTheme,
    }),
    [account, loading, connect, disconnect, refresh, applyTheme]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
