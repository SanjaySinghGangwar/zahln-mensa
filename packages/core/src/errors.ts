import { isApiError } from './client';
import { t, type MessageKey } from './i18n';
import { en } from './i18n/en';

/** A message the user can act on, in the current language. */
export function describeError(e: unknown): string {
  if (isApiError(e)) {
    const key = `error.${e.code}` as MessageKey;
    // `||` (not `??`) so an empty detail or title from the server never shows a blank message.
    const base = key in en ? t(key) : e.problem.detail || e.problem.title || t('error.generic');
    return e.unknownOutcome ? `${base} ${t('error.unknownOutcome')}` : base;
  }
  if (e instanceof Error && e.message) return e.message;
  return t('error.generic');
}
