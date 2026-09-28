import { validLocale, type Locale } from '../../shared/i18n';
export type Theme = 'light' | 'dark';
function saved(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function preferredTheme(): Theme {
  const value = saved('xspeedup.theme');
  return value === 'light' || value === 'dark'
    ? value
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
}
export function preferredLocale(): Locale {
  return validLocale(saved('xspeedup.locale') ?? navigator.language.split('-')[0]);
}
export function applyPreferences(theme: Theme, locale: Locale, persist = true) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.lang = locale;
  document.title = 'X SpeedUp';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#101729' : '#eef3fc');
  if (persist)
    try {
      localStorage.setItem('xspeedup.theme', theme);
      localStorage.setItem('xspeedup.locale', locale);
    } catch {
      /* Session preferences still apply. */
    }
}
