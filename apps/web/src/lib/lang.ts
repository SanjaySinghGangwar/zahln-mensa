import { getLanguage, languageFromLocale, setLanguage, type Lang } from '@zahln/core';

const KEY = 'zahln.lang';

/** Saved choice first, then the browser language. */
export function initLanguage() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* blocked storage */
  }
  const lang: Lang = saved === 'de' || saved === 'en' ? saved : languageFromLocale(navigator.language);
  applyLanguage(lang);
}

export function chooseLanguage(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* blocked storage */
  }
  applyLanguage(lang);
}

function applyLanguage(lang: Lang) {
  setLanguage(lang);
  document.documentElement.lang = getLanguage();
}
