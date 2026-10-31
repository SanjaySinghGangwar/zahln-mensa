import { beforeEach } from 'vitest';
import { configureCore, memoryStorage } from '../config';
import { setLanguage } from '../i18n';

// Tests talk to "/api" like the dashboard does behind its dev proxy.
beforeEach(() => {
  configureCore({ apiBase: 'http://localhost/api', storage: memoryStorage(), appVersion: '1.0.0' });
  setLanguage('en');
});
