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
  canChange: boolean;
}
export interface RegistryScan {
  id: string;
  entries: RegistryEntry[];
  truncated: boolean;
  warnings: string[];
}
export interface FolderScan {
  id: string;
  createdAt: string;
  roots: string[];
  entries: { id: string; path: string; createdUtc: string }[];
  visited: number;
  skipped: number;
  complete: boolean;
  canContinue: boolean;
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
  kind:
    | 'cleanup'
    | 'registry'
    | 'registry-v2'
    | 'services'
    | 'folders'
    | 'memory'
    | 'gaming'
    | 'tuning';
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
  'tuning.status': Record<string, never>;
  'tuning.start': { deviceId: string };
  'tuning.heartbeat': { id: string };
  'tuning.advance': { id: string };
  'tuning.finish': { id: string; completed: boolean };
  'gaming.status': Record<string, never>;
  'gaming.settings': Record<string, never>;
  'gaming.start': { serviceIds: string[]; processes: { id: number; startTime: string }[] };
  'gaming.stop': Record<string, never>;
  system: Record<string, never>;
  'cleanup.scan': Record<string, never>;
  'cleanup.apply': { scanId: string; categoryIds: string[] };
  'registry.scan': Record<string, never>;
  'registry.apply': { scanId: string; entryIds: string[] | 'all' };
  'folders.choose': Record<string, never>;
  'folders.scan': { scope: 'all' | 'selected' };
  'folders.continue': { scanId: string };
  'folders.cancel': { scanId: string };
  'folders.apply': { scanId: string; entryIds: string[] | 'all' };
  'memory.release': { processId: number; startTime: string };
  'services.list': Record<string, never>;
  'services.disable': { serviceIds: string[] };
  'processes.list': Record<string, never>;
  'processes.close': { processId: number; startTime: string };
  'history.list': Record<string, never>;
  'history.restore': { id: string };
}
export interface ResponseMap {
  'tuning.status': TuningStatus;
  'tuning.start': TuningState;
  'tuning.heartbeat': TuningState;
  'tuning.advance': TuningState;
  'tuning.finish': ActionResult;
  'gaming.status': GameStatus;
  'gaming.settings': null;
  'gaming.start': ActionResult;
  'gaming.stop': ActionResult;
  system: SystemInfo;
  'cleanup.scan': CleanupScan;
  'cleanup.apply': ActionResult;
  'registry.scan': RegistryScan;
  'registry.apply': ActionResult;
  'folders.choose': string | null;
  'folders.scan': FolderScan;
  'folders.continue': FolderScan;
  'folders.cancel': FolderScan;
  'folders.apply': ActionResult;
  'memory.release': ActionResult;
  'services.list': ServiceItem[];
  'services.disable': ActionResult;
  'processes.list': ProcessItem[];
  'processes.close': ActionResult;
  'history.list': HistoryItem[];
  'history.restore': ActionResult;
}
export interface GameStatus {
  sessionId: string | null;
  windowsMode: number | null;
  settingAvailable: boolean;
  services: { id: string; state: number; canStop: boolean }[];
}
export interface GpuCapability {
  id: string;
  name: string;
  temperature: number | null;
  core: { current: number; minimum: number; maximum: number } | null;
  memory: { current: number; minimum: number; maximum: number } | null;
  canTune: boolean;
  reason: string;
}
export interface TuningStatus {
  devices: GpuCapability[];
  pending: string[];
  cpu: string;
  cpuTuning: boolean;
  memoryTuning: boolean;
  reason: string;
}
export interface TuningState {
  id: string;
  stage: number;
  core: number;
  memory: number | null;
  temperature: number;
  more: boolean;
}
export type Method = keyof RequestMap;
export interface DesktopApi {
  request<M extends Method>(method: M, args: RequestMap[M]): Promise<ResponseMap[M]>;
}
