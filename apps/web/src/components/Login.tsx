import { useState, type FormEvent } from 'react';
import { t } from '@zahln/core';
import { useAuth } from '../auth/AuthContext';
import { ErrorNotice, LanguageSwitch, Notice, Spinner } from './ui';

export function Login() {
  const { login, sessionLost } = useAuth();
  // Test system: the seeded finance login is filled in. Real logins would come from the Studierendenwerk's SSO.
  const [username, setUsername] = useState('finance');
  const [password, setPassword] = useState('test1234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="card login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="login-top">
          <div className="brand brand-lg">
            <span className="brand-mark" aria-hidden="true">
              Z
            </span>{' '}
            Zahln
          </div>
          <LanguageSwitch />
        </div>
        <h1 id="login-title">{t('login.finance')}</h1>
        <p className="muted">{t('login.subtitle')}</p>

        {sessionLost && <Notice tone="warn">{t('login.sessionEnded')}</Notice>}

        <label className="field">
          <span>{t('login.user')}</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>{t('login.password')}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>

        {error !== null && <ErrorNotice error={error} />}

        <button className="btn btn-primary btn-block" disabled={busy || !username}>
          {busy ? <Spinner small /> : null} {busy ? t('login.busy') : t('login.submit')}
        </button>
      </form>
    </main>
  );
}
