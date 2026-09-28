export function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toLocaleString('ru-RU', { maximumFractionDigits: index > 0 ? 1 : 0 })} ${units[index]}`;
}
export const date = (value: string) =>
  new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
export const startMode = (mode: number) =>
  ({ 2: 'Автоматически', 3: 'Вручную', 4: 'Отключена' })[mode] ?? 'Недоступна';
