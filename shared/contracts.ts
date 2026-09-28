export interface SystemInfo {
  machine: string;
  os: string;
  isAdmin: boolean;
  processorCount: number;
  totalMemory: number;
  availableMemory: number;
  driveTotal: number;
  driveFree: number;
  uptimeSeconds: number;
  user: string;
}
export interface CleanupCategory {
  id: string;
  name: string;
  description: string;
  files: number;
  bytes: number;
  skipped: number;
  samples: string[];
}
export interface CleanupScan {
  id: string;
  createdAt: string;
  categories: CleanupCategory[];
  truncated: boolean;
}
export interface RegistryEntry {
  id: string;
  name: string;
  key: string;
  value: string;
  reason: string;
}
export interface RegistryScan {
  id: string;
  entries: RegistryEntry[];
}
export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  impact: string;
  profiles: string[];
  installed: boolean;
  status: string;
  startMode: number;
  canChange: boolean;
}
export interface ProcessItem {
  id: number;
  name: string;
  memory: number;
  title: string;
  startTime: string;
}
export interface HistoryItem {
  id: string;
  createdAt: string;
  kind: 'cleanup' | 'registry' | 'services';
  summary: string;
  canRestore: boolean;
  restored: boolean;
  details: string[];
}
export interface ActionResult {
  message: string;
  changed: number;
  skipped: number;
  bytes: number;
  details: string[];
}
export interface RequestMap {
  system: Record<string, never>;
  'cleanup.scan': Record<string, never>;
  'cleanup.apply': { scanId: string; categoryIds: string[] };
  'registry.scan': Record<string, never>;
  'registry.apply': { scanId: string; entryIds: string[] };
  'services.list': Record<string, never>;
  'services.disable': { serviceIds: string[] };
  'processes.list': Record<string, never>;
  'processes.close': { processId: number; startTime: string };
  'history.list': Record<string, never>;
  'history.restore': { id: string };
}
export interface ResponseMap {
  system: SystemInfo;
  'cleanup.scan': CleanupScan;
  'cleanup.apply': ActionResult;
  'registry.scan': RegistryScan;
  'registry.apply': ActionResult;
  'services.list': ServiceItem[];
  'services.disable': ActionResult;
  'processes.list': ProcessItem[];
  'processes.close': ActionResult;
  'history.list': HistoryItem[];
  'history.restore': ActionResult;
}
export type Method = keyof RequestMap;
export interface DesktopApi {
  request<M extends Method>(method: M, args: RequestMap[M]): Promise<ResponseMap[M]>;
}
