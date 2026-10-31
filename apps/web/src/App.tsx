import type React from 'react';
import { t } from '@zahln/core';
import { useLanguage } from '@zahln/core/react';
import { useAuth } from './auth/AuthContext';
import { Login } from './components/Login';
import { LanguageSwitch, OfflineBanner } from './components/ui';
import { Dashboard } from './features/Dashboard';

/** Back to the start screen: drops tabs and open details from the URL. */
function goHome(e: React.MouseEvent) {
  e.preventDefault();
  if (window.location.search) {
    window.history.pushState(null, '', window.location.pathname);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  window.scrollTo({ top: 0 });
}

export default function App() {
  // Re-render everything when the language changes.
  useLanguage();
  const { session, logout } = useAuth();

  function signOut() {
    window.history.replaceState(null, '', window.location.pathname);
    logout();
  }

  if (!session)
    return (
      <>
        <OfflineBanner />
        <Login />
      </>
    );

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand brand-home" href="/" onClick={goHome} aria-label={`${t('app.name')} — home`} title="Home">
          <span className="brand-mark" aria-hidden="true">
            Z
          </span>{' '}
          Zahln <span className="brand-sub">Studierendenwerk</span>
        </a>
        <div className="topbar-user">
          <LanguageSwitch dark />
          <span className="topbar-name">
            <span className="topbar-display">{session.user.displayName}</span>
          </span>
          <button className="btn btn-sm" onClick={signOut}>
            {t('common.logout')}
          </button>
        </div>
      </header>
      <OfflineBanner />
      <main id="main" tabIndex={-1}>
        <Dashboard key={session.user.id} />
      </main>
    </div>
  );
}
