import type { LocalizedText } from '../types';
import { de } from './de';
import { en, type MessageKey } from './en';

export type { MessageKey } from './en';
export type Lang = 'de' | 'en';

const DICTS: Record<Lang, Record<MessageKey, string>> = { de, en };

let current: Lang = 'de';
const listeners = new Set<() => void>();

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang) {
  if (lang === current) return;
  current = lang;
  listeners.forEach((l) => l());
}

/** For useSyncExternalStore. */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Picks German for German device locales, English otherwise. */
export function languageFromLocale(locale: string | null | undefined): Lang {
  return locale && locale.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export type Vars = Record<string, string | number>;

export function t(key: MessageKey, vars?: Vars): string {
  const template = DICTS[current][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Server-provided text in the current language, falling back to the other one. */
export function localized(text: LocalizedText | null | undefined): string {
  if (!text) return '';
  return (current === 'de' ? text.de || text.en : text.en || text.de) ?? '';
}

/** Locale for number and date formatting. */
export function locale(): string {
  return current === 'de' ? 'de-DE' : 'en-GB';
}
