import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import { useTheme } from './ThemeContext.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Follow the account's saved theme once we know who they are.
  useEffect(() => {
    if (user?.settings?.theme) setTheme(user.settings.theme);
  }, [user?.id, user?.settings?.theme, setTheme]);

  const login = useCallback(async (email, password, code) => {
    const res = await api.post('/api/auth/login', { email, password, code });
    if (res && res.mfa_required) return { mfa_required: true };
    setUser(res);
    if (res?.settings?.theme) setTheme(res.settings.theme);
    return res;
  }, [setTheme]);

  const register = useCallback(async (payload) => {
    const res = await api.post('/api/auth/register', payload);
    setUser(res);
    if (res?.settings?.theme) setTheme(res.settings.theme);
    return res;
  }, [setTheme]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {}
    setUser(null);
  }, []);

  const patchSettings = useCallback(
    async (patch) => {
      const res = await api.patch('/api/me/settings', patch);
      setUser(res);
      if (res?.settings?.theme) setTheme(res.settings.theme);
      return res;
    },
    [setTheme]
  );

  const updateProfile = useCallback(async (patch) => {
    const res = await api.patch('/api/me/profile', patch);
    setUser(res);
    return res;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthed: !!user,
      login,
      register,
      logout,
      refresh,
      patchSettings,
      updateProfile,
      setUser,
    }),
    [user, loading, login, register, logout, refresh, patchSettings, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
