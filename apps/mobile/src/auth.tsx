import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, clearCache, clearVersionCache, setAuthHooks, setCacheScope, t, type Session } from '@zahln/core';
import { DASHBOARD_URL } from './platform/links';

interface AuthValue {
  session: Session | null;
  sessionLost: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export class WrongAppError extends Error {
  constructor() {
    super(t('login.wrongApp', { app: DASHBOARD_URL }));
    this.name = 'WrongAppError';
  }
}

/**
 * The session lives in memory only. The password is kept in memory too (never
 * written to disk) so the app can log in again when the 5-minute token ends in
 * the middle of a lunch rush. If the app is killed, the user signs in again;
 * a payment that was in flight is still followed because its Idempotency-Key
 * and payment ID are on disk.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const credentialsRef = useRef<{ username: string; password: string } | null>(null);
  const reloginRef = useRef<Promise<string | null> | null>(null);

  const setSession = useCallback((s: Session | null) => {
    sessionRef.current = s;
    setCacheScope(s?.user.id ?? null);
    setSessionState(s);
  }, []);

  setAuthHooks({
    getToken: () => sessionRef.current?.accessToken ?? null,
    relogin: () => {
      // Single flight: when several polls expire together, log in once.
      if (!reloginRef.current) {
        const creds = credentialsRef.current;
        reloginRef.current = (async () => {
          if (!creds) return null;
          try {
            const s = await api.login(creds.username, creds.password);
            setSession(s);
            return s.accessToken;
          } catch {
            return null;
          } finally {
            reloginRef.current = null;
          }
        })();
      }
      return reloginRef.current;
    },
    onSessionLost: () => {
      if (!sessionRef.current) return;
      setSessionLost(true);
      setSession(null);
    },
  });

  const login = useCallback(
    async (username: string, password: string) => {
      const s = await api.login(username, password);
      if (s.user.role === 'finance') throw new WrongAppError();
      credentialsRef.current = { username, password };
      clearVersionCache();
      setSessionLost(false);
      setSession(s);
    },
    [setSession],
  );

  const logout = useCallback(() => {
    credentialsRef.current = null;
    clearVersionCache();
    // A till is shared by many cashiers: leave no payment data behind.
    clearCache();
    setSessionLost(false);
    setSession(null);
  }, [setSession]);

  const value = useMemo(() => ({ session, sessionLost, login, logout }), [session, sessionLost, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
