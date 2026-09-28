import { validLocale, type Locale } from '../../shared/i18n';
export type Theme = 'dark';
function saved(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function preferredTheme(): Theme {
  return 'dark';
}
export function preferredLocale(): Locale {
  return validLocale(saved('xspeedup.locale') ?? navigator.language.split('-')[0]);
}
export function applyPreferences(theme: Theme, locale: Locale, persist = true) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.lang = locale;
  document.title = 'X SpeedUp';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1d2428');
  if (persist)
    try {
      localStorage.setItem('xspeedup.theme', theme);
      localStorage.setItem('xspeedup.locale', locale);
    } catch {
      /* Session preferences still apply. */
    }
}
