export function bytes(value: number, locale = 'ru'): string {
  const units =
    locale === 'ru' || locale === 'uk'
      ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
      : ['B', 'KB', 'MB', 'GB', 'TB'];
  if (!Number.isFinite(value) || value <= 0) return `0 ${units[0]}`;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toLocaleString(locale, { maximumFractionDigits: index > 0 ? 1 : 0 })} ${units[index]}`;
}
export const date = (value: string, locale = 'ru') =>
  new Date(value).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
export const startMode = (mode: number) =>
  ({ 2: 'Автоматически', 3: 'Вручную', 4: 'Отключена' })[mode] ?? 'Недоступна';
