import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureCore, webStorage } from '@zahln/core';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { initLanguage } from './lib/lang';
import './styles.css';

configureCore({
  // Dev: through the Vite proxy. Deployed: straight to the API (it allows CORS).
  apiBase: import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? '/api' : 'https://dev.zahln.de'),
  candidateId: import.meta.env.VITE_CANDIDATE_ID || 'c_111437af73',
  appVersion: __APP_VERSION__,
  storage: webStorage(window.localStorage),
});
initLanguage();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
