import type { Method, RequestMap } from '../shared/contracts';

const methods = new Set([
  'system',
  'cleanup.scan',
  'cleanup.apply',
  'registry.scan',
  'registry.apply',
  'folders.scan',
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
  'folders.apply',
  'memory.release',
  'cleanup.apply',
  'registry.apply',
  'services.disable',
  'processes.close',
  'history.restore',
]);
export const isMutation = (method: Method) => mutations.has(method);
export function validateRequest(
  method: unknown,
  input: unknown,
): { method: Method; args: RequestMap[Method] } {
  if (typeof method !== 'string' || !methods.has(method)) throw new Error('Неизвестная операция.');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Некорректный запрос.');
  const args = input as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    'cleanup.apply': ['scanId', 'categoryIds'],
    'registry.apply': ['scanId', 'entryIds'],
    'folders.continue': ['scanId'],
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
    if (key.endsWith('Ids')) {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > 256 ||
        value.some((v) => typeof v !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(v))
      )
        throw new Error('Некорректный выбор.');
    } else if (key === 'processId') {
      if (!Number.isSafeInteger(value) || (value as number) <= 0)
        throw new Error('Некорректный процесс.');
    } else if (typeof value !== 'string' || value.length > 100 || value.length === 0)
      throw new Error('Некорректный идентификатор.');
  }
  return { method: method as Method, args: args as RequestMap[Method] };
}
