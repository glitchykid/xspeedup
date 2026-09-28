import type { Method, RequestMap } from '../shared/contracts';

const methods = new Set([
  'bench.open',
  'bench.config',
  'bench.complete',
  'bench.close',
  'tuning.status',
  'tuning.start',
  'tuning.heartbeat',
  'tuning.advance',
  'tuning.finish',
  'gaming.status',
  'gaming.start',
  'gaming.stop',
  'gaming.settings',
  'system',
  'cleanup.scan',
  'cleanup.apply',
  'registry.scan',
  'registry.apply',
  'folders.scan',
  'folders.choose',
  'folders.cancel',
  'folders.continue',
  'folders.apply',
  'memory.release',
  'services.list',
  'services.disable',
  'processes.list',
  'processes.close',
  'history.list',
  'history.restore',
]);
const mutations = new Set<Method>([
  'tuning.start',
  'gaming.start',
  'gaming.stop',
  'folders.apply',
  'memory.release',
  'cleanup.apply',
  'registry.apply',
  'services.disable',
  'processes.close',
  'history.restore',
]);
export const isMutation = (method: Method) => mutations.has(method);
type ValidatedRequest = { [M in Method]: { method: M; args: RequestMap[M] } }[Method];
export function validateRequest(method: unknown, input: unknown): ValidatedRequest {
  if (typeof method !== 'string' || !methods.has(method)) throw new Error('Неизвестная операция.');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Некорректный запрос.');
  const args = input as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    'bench.open': [
      'duration',
      'heavy',
      'cpu',
      'ram',
      'automatic',
      'stepSeconds',
      'ssao',
      'bloom',
      'shadows',
    ],
    'tuning.start': ['deviceId', 'stepSeconds'],
    'tuning.heartbeat': ['id'],
    'tuning.advance': ['id'],
    'tuning.finish': ['id', 'completed'],
    'gaming.start': ['serviceIds', 'processes'],
    'cleanup.apply': ['scanId', 'categoryIds'],
    'registry.apply': ['scanId', 'entryIds'],
    'folders.continue': ['scanId'],
    'folders.cancel': ['scanId'],
    'folders.scan': ['scope'],
    'folders.apply': ['scanId', 'entryIds'],
    'memory.release': ['processId', 'startTime'],
    'services.disable': ['serviceIds'],
    'processes.close': ['processId', 'startTime'],
    'history.restore': ['id'],
  };
  const expected = keys[method] ?? [];
  if (
    Object.keys(args).length !== expected.length ||
    Object.keys(args).some((k) => !expected.includes(k))
  )
    throw new Error('Некорректные параметры.');
  for (const key of expected) {
    const value = args[key];
    if (['heavy', 'cpu', 'ram', 'automatic', 'ssao', 'bloom', 'shadows'].includes(key)) {
      if (typeof value !== 'boolean') throw new Error('Invalid benchmark option.');
      continue;
    }
    if (key === 'stepSeconds' || key === 'duration') {
      const minimum = key === 'stepSeconds' ? 10 : 3;
      const maximum = key === 'stepSeconds' ? 120 : 600;
      if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum)
        throw new Error(`Duration must be ${minimum}–${maximum} seconds.`);
      continue;
    }
    if (key === 'completed') {
      if (typeof value !== 'boolean') throw new Error('Некорректный результат тестирования.');
      continue;
    }
    if (key === 'processes') {
      if (
        !Array.isArray(value) ||
        value.length > 10000 ||
        value.some(
          (p) =>
            !p ||
            typeof p !== 'object' ||
            Object.keys(p).length !== 2 ||
            !Number.isSafeInteger(p.id) ||
            p.id <= 0 ||
            typeof p.startTime !== 'string' ||
            !p.startTime.length ||
            p.startTime.length > 100,
        ) ||
        new Set(value.map((p) => p.id)).size !== value.length
      )
        throw new Error('Некорректный список приложений.');
      continue;
    }
    if (key === 'scope') {
      if (value !== 'all' && value !== 'selected') throw new Error('Некорректная область поиска.');
      continue;
    }
    if (key.endsWith('Ids')) {
      if (key === 'entryIds' && value === 'all') continue;
      if (
        !Array.isArray(value) ||
        (value.length === 0 && method !== 'gaming.start') ||
        value.length > (key === 'entryIds' ? 100000 : 256) ||
        value.some((v) => typeof v !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(v))
      )
        throw new Error('Некорректный выбор.');
      if (
        method === 'gaming.start' &&
        (value.length > 3 || value.some((id) => !['DiagTrack', 'MapsBroker', 'Fax'].includes(id)))
      )
        throw new Error('Служба не входит в игровой профиль.');
    } else if (key === 'processId') {
      if (!Number.isSafeInteger(value) || (value as number) <= 0)
        throw new Error('Некорректный процесс.');
    } else if (typeof value !== 'string' || value.length > 100 || value.length === 0)
      throw new Error('Некорректный идентификатор.');
  }
  return { method, args } as ValidatedRequest;
}
