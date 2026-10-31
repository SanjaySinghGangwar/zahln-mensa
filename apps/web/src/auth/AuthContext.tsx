import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, clearCache, clearVersionCache, setAuthHooks, setCacheScope, t, type Session } from '@zahln/core';

interface AuthContextValue {
  session: Session | null;
  /** Shown on the login screen after a session was lost. */
  sessionLost: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_KEY = 'zahln.session';

/** Only finance users work here; payers and cashiers use the app. */
export class WrongAppError extends Error {
  constructor() {
    super(t('login.wrongApp', { app: 'Zahln Mensa App' }));
    this.name = 'WrongAppError';
  }
}

function loadStoredSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s?.user?.role === 'finance' ? s : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(loadStoredSession);
  const [sessionLost, setSessionLost] = useState(false);
  const sessionRef = useRef<Session | null>(session);
  setCacheScope(session?.user.id ?? null);
  // The password stays in memory only (never stored), so the dashboard can log
  // in again when the 5-minute token ends. After a page reload it is gone and a
  // lost session sends the user to the login screen.
  const credentialsRef = useRef<{ username: string; password: string } | null>(null);
  const reloginRef = useRef<Promise<string | null> | null>(null);

  const setSession = useCallback((s: Session | null) => {
    sessionRef.current = s;
    setCacheScope(s?.user.id ?? null);
    setSessionState(s);
    try {
      // sessionStorage: survives a reload of this tab, gone when the tab closes.
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Install hooks synchronously so the very first request already has them.
  setAuthHooks({
    getToken: () => sessionRef.current?.accessToken ?? null,
    relogin: () => {
      // Single flight: many requests can expire at once, log in only once.
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
      if (s.user.role !== 'finance') throw new WrongAppError();
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
    // Leave no payment data behind on a shared office computer.
    clearCache();
    setSessionLost(false);
    setSession(null);
  }, [setSession]);

  const value = useMemo(() => ({ session, sessionLost, login, logout }), [session, sessionLost, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
